use super::super::{CeremonyState, NookVaultManager, VaultNameState};
use super::StoredSentinelGenesisDelivery;
use crate::storage::indexed_db::{
    clear_sentinel_genesis_finalization_pending, load_sentinel_genesis_finalization_pending,
    save_sentinel_genesis_finalization_pending, save_sentinel_genesis_share_delivery,
    save_to_indexed_db,
};
use crate::{NookError, NookSentinelGenesisFinalizeResult};
use nook_core::{
    SentinelGenesisOutput, SentinelGenesisPhase, SigningIdentity, VaultMetaState, VaultNameRef,
    VaultStoreIdentityRef, VaultUnlock, VaultVersionWrite,
};
use serde::{Deserialize, Serialize};
use std::mem;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingSentinelGenesisFinalization {
    store_id: String,
    vault_name: VaultNameState,
    architecture: nook_core::VaultArchitecture,
    yaml: String,
    request: nook_core::SentinelGenesisRequest,
    participants: Vec<nook_core::SentinelGenesisParticipant>,
    deliveries: Vec<nook_core::SentinelGenesisShareDelivery>,
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn has_pending_sentinel_genesis_finalization(&self) -> Result<bool, JsError> {
        Ok(load_sentinel_genesis_finalization_pending()
            .await?
            .is_some())
    }

    #[wasm_bindgen]
    pub async fn resume_pending_sentinel_genesis_finalization(
        &mut self,
    ) -> Result<NookSentinelGenesisFinalizeResult, JsError> {
        let pending_json = load_sentinel_genesis_finalization_pending()
            .await?
            .ok_or_else(|| JsError::new("No Sentinel finalization is pending."))?;
        let pending: PendingSentinelGenesisFinalization = serde_json::from_str(&pending_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        self.complete_sentinel_genesis_finalization(pending).await
    }

    /// Atomically create the complete encrypted Sentinel projection. No vault key
    /// is installed in the browser session; opening still requires quorum.
    #[wasm_bindgen]
    pub async fn finalize_sentinel_genesis(
        &mut self,
    ) -> Result<NookSentinelGenesisFinalizeResult, JsError> {
        if let Some(pending_json) = load_sentinel_genesis_finalization_pending().await? {
            let pending: PendingSentinelGenesisFinalization =
                serde_json::from_str(&pending_json)
                    .map_err(|error| NookError::Serialization(error.to_string()))?;
            return self.complete_sentinel_genesis_finalization(pending).await;
        }

        let signing = self.ensure_signing_identity().await?;
        self.issue_sentinel_genesis(
            &signing,
            #[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
            IssuanceCheckpoint::Live,
        )
        .await
    }
}

impl NookVaultManager {
    async fn issue_sentinel_genesis(
        &mut self,
        signing: &SigningIdentity,
        #[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
        checkpoint: IssuanceCheckpoint,
    ) -> Result<NookSentinelGenesisFinalizeResult, JsError> {
        let session = match mem::replace(&mut self.sentinel_genesis, CeremonyState::Inactive) {
            CeremonyState::Active(session) => session,
            CeremonyState::Inactive => {
                return Err(JsError::new("No Sentinel genesis ceremony is active."));
            }
        };
        let genesis_request = session.request().clone();
        let ready = match session.prepare(signing.signing_key()) {
            Ok(ready) => ready,
            Err(rejected) => {
                let (session, error) = rejected.into_parts();
                self.sentinel_genesis_phase = SentinelGenesisPhase::from_session(&session);
                self.sentinel_genesis = CeremonyState::Active(session);
                return Err(error.into());
            }
        };
        // Issuance is terminal for this collecting owner, including future Drop.
        self.sentinel_genesis_phase = SentinelGenesisPhase::Inactive;
        let output = SentinelGenesisOutput::from_ready(ready)?;
        let participants = output.participants;
        let store_id = output.store_id.as_str().to_owned();
        let vault_name = self.vault.vault_name.clone();
        let yaml = nook_core::serialize_stored_yaml_with_unlock_name_architecture(
            &output.stored_records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned(&store_id),
            match &vault_name {
                VaultNameState::Unnamed => VaultNameRef::Unnamed,
                VaultNameState::Named(name) => VaultNameRef::Named(name),
            },
            VaultVersionWrite::Initial,
            &output.architecture,
        )?;
        let pending = PendingSentinelGenesisFinalization {
            store_id,
            vault_name,
            architecture: output.architecture,
            yaml: yaml.into_inner(),
            request: genesis_request,
            participants,
            deliveries: output.participant_deliveries,
        };
        let pending_json = serde_json::to_string(&pending)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        // This public/encrypted plan is the commit marker. Every subsequent
        // write is idempotent and a retry resumes this exact store/root.
        #[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
        checkpoint.before_save().await;
        save_sentinel_genesis_finalization_pending(&pending_json).await?;
        #[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
        checkpoint.after_save()?;
        self.complete_sentinel_genesis_finalization(pending).await
    }
}

impl NookVaultManager {
    async fn complete_sentinel_genesis_finalization(
        &mut self,
        pending: PendingSentinelGenesisFinalization,
    ) -> Result<NookSentinelGenesisFinalizeResult, JsError> {
        let format = nook_core::detect_stored_format(&pending.yaml)?;
        let records = nook_core::deserialize_stored(&pending.yaml, format)?;
        pending.architecture.validate_records(&records)?;

        save_to_indexed_db(&pending.yaml).await?;
        self.vault.reset();
        self.vault.store_id.clone_from(&pending.store_id);
        self.vault.vault_name.clone_from(&pending.vault_name);
        self.vault.architecture = pending.architecture.clone();
        self.vault.meta = VaultMetaState::from_stored_records(&records);
        self.vault.last_synced_content.clone_from(&pending.yaml);
        self.event_log.reset();
        self.ensure_sentinel_genesis_event(&pending.participants, &pending.deliveries)
            .await?;

        let identity = self.device_identity()?;
        let own_delivery = pending
            .deliveries
            .iter()
            .find(|delivery| delivery.device_id == *identity.device_id())
            .ok_or_else(|| {
                JsError::new("Sentinel genesis did not issue the initiator's encrypted share.")
            })?;
        let _ = nook_core::accept_sentinel_genesis_share_delivery(
            own_delivery,
            &pending.request,
            &identity,
        )?;
        let stored_json = serde_json::to_string(&StoredSentinelGenesisDelivery {
            request: pending.request.clone(),
            delivery: own_delivery.clone(),
        })
        .map_err(|error| NookError::Serialization(error.to_string()))?;
        save_sentinel_genesis_share_delivery(
            &pending.store_id,
            identity.device_id().as_str(),
            &stored_json,
        )
        .await?;
        clear_sentinel_genesis_finalization_pending().await?;
        self.sentinel_genesis = CeremonyState::Inactive;
        self.sentinel_genesis_phase = SentinelGenesisPhase::DeliveringShares;

        Ok(NookSentinelGenesisFinalizeResult::from_core(
            pending.store_id,
            pending.architecture,
            &pending.participants,
            &pending.deliveries,
        )?)
    }
}

// A narrow test checkpoint surrounds the existing journal write; production
// performs exactly the original write and completion operations.
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
enum IssuanceCheckpoint {
    Live,
    BeforeSavePending,
    AfterSaveFailure,
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
impl IssuanceCheckpoint {
    async fn before_save(&self) {
        use std::future;
        if matches!(self, Self::BeforeSavePending) {
            future::pending::<()>().await;
        }
    }
    fn after_save(self) -> Result<(), NookError> {
        match self {
            Self::AfterSaveFailure => Err(NookError::Database(
                "injected failure after genesis journal persistence".to_owned(),
            )),
            Self::Live | Self::BeforeSavePending => Ok(()),
        }
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use crate::storage::{event_db, indexed_db};
    use js_sys::Reflect;
    use nook_core::{DeviceIdentity, StartSentinelGenesisArgs};
    use std::future::Future;
    use std::task::{Context, Poll, Waker};
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct Fixture {
        manager: NookVaultManager,
        signer: SigningIdentity,
    }
    impl Fixture {
        async fn new() -> anyhow::Result<Self> {
            clear_sentinel_genesis_finalization_pending().await?;
            let identity = DeviceIdentity::generate()?;
            let mut manager = NookVaultManager::new();
            manager.device.identity_private_key = identity.secret_string().as_str().to_owned();
            let signer = manager.ensure_signing_identity().await?;
            let session = Self::args().start(&identity, &signer)?;
            manager.sentinel_genesis_phase = SentinelGenesisPhase::from_session(&session);
            manager.sentinel_genesis = CeremonyState::Active(session);
            manager.assign_vault_name("Genesis fixture");
            Ok(Self { manager, signer })
        }
        fn args() -> StartSentinelGenesisArgs {
            StartSentinelGenesisArgs {
                label: "Owner".to_owned(),
                participant_count: 2,
                threshold: 2,
            }
        }
        fn complete_roster(&mut self) -> anyhow::Result<()> {
            let session =
                match mem::replace(&mut self.manager.sentinel_genesis, CeremonyState::Inactive) {
                    CeremonyState::Active(session) => session,
                    CeremonyState::Inactive => {
                        return Err(anyhow::anyhow!("fixture session missing"));
                    }
                };
            let peer = DeviceIdentity::generate()?;
            let peer_signer = SigningIdentity::generate()?.0;
            let response = nook_core::respond_to_sentinel_genesis_request(
                session.request(),
                &peer,
                &peer_signer,
                "Peer".to_owned(),
            )?;
            let session = session.collect(response)?;
            self.manager.sentinel_genesis_phase = SentinelGenesisPhase::from_session(&session);
            self.manager.sentinel_genesis = CeremonyState::Active(session);
            Ok(())
        }
        fn assert_consumed(&self) {
            assert!(matches!(
                self.manager.sentinel_genesis,
                CeremonyState::Inactive
            ));
            assert_eq!(
                self.manager.sentinel_genesis_status().phase(),
                SentinelGenesisPhase::Inactive
            );
            assert!(!self.manager.vault.crypto.is_unlocked());
        }
    }

    #[wasm_bindgen_test]
    async fn preparation_rejection_preserves_session_and_phase() -> anyhow::Result<()> {
        let mut fixture = Fixture::new().await?;
        let wrong = SigningIdentity::generate()?.0;
        assert!(
            fixture
                .manager
                .issue_sentinel_genesis(&wrong, IssuanceCheckpoint::Live)
                .await
                .is_err()
        );
        assert_eq!(
            fixture.manager.sentinel_genesis_status().phase(),
            SentinelGenesisPhase::CollectingParticipants
        );
        fixture.complete_roster()?;
        assert!(
            fixture
                .manager
                .issue_sentinel_genesis(&wrong, IssuanceCheckpoint::Live)
                .await
                .is_err()
        );
        assert_eq!(
            fixture.manager.sentinel_genesis_status().phase(),
            SentinelGenesisPhase::ReadyToFinalize
        );
        assert!(matches!(
            fixture.manager.sentinel_genesis,
            CeremonyState::Active(_)
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn dropping_issued_future_cannot_restore_the_roster() -> anyhow::Result<()> {
        let mut fixture = Fixture::new().await?;
        fixture.complete_roster()?;
        let mut future = Box::pin(
            fixture
                .manager
                .issue_sentinel_genesis(&fixture.signer, IssuanceCheckpoint::BeforeSavePending),
        );
        assert!(matches!(
            future
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop())),
            Poll::Pending
        ));
        drop(future);
        fixture.assert_consumed();
        assert!(
            load_sentinel_genesis_finalization_pending()
                .await?
                .is_none()
        );
        assert!(
            fixture
                .manager
                .issue_sentinel_genesis(&fixture.signer, IssuanceCheckpoint::Live)
                .await
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn uncertain_write_keeps_exact_output_blocks_start_and_resumes() -> anyhow::Result<()> {
        let mut fixture = Fixture::new().await?;
        fixture.complete_roster()?;
        let failed = fixture
            .manager
            .issue_sentinel_genesis(&fixture.signer, IssuanceCheckpoint::AfterSaveFailure)
            .await;
        let error = failed
            .err()
            .ok_or_else(|| anyhow::anyhow!("injected post-save failure missing"))?;
        let value = JsValue::from(error);
        let message = Reflect::get(&value, &JsValue::from_str("message"))
            .map_err(|_| anyhow::anyhow!("error message unavailable"))?
            .as_string();
        assert_eq!(
            message.as_deref(),
            Some("Database error: injected failure after genesis journal persistence")
        );
        fixture.assert_consumed();
        let journal = load_sentinel_genesis_finalization_pending()
            .await?
            .ok_or_else(|| anyhow::anyhow!("issued output must remain durable"))?;
        let pending: PendingSentinelGenesisFinalization = serde_json::from_str(&journal)?;
        assert!(
            fixture
                .manager
                .start_sentinel_genesis(Fixture::args())
                .await
                .is_err()
        );
        assert_eq!(
            load_sentinel_genesis_finalization_pending().await?,
            Some(journal)
        );
        // There is no collecting capability: this public entry must read the journal.
        let result = fixture
            .manager
            .finalize_sentinel_genesis()
            .await
            .map_err(|_| anyhow::anyhow!("durable genesis completion failed"))?;
        assert_eq!(result.store_id(), pending.store_id);
        assert_eq!(fixture.manager.vault.store_id, pending.store_id);
        let expected = nook_core::deserialize_stored(
            &pending.yaml,
            nook_core::detect_stored_format(&pending.yaml)?,
        )?;
        let actual = fixture.manager.stored_records_snapshot();
        assert_eq!(actual.len(), expected.len());
        assert!(expected.iter().all(|record| actual.contains(record)));
        assert_eq!(
            fixture.manager.sentinel_genesis_status().phase(),
            SentinelGenesisPhase::DeliveringShares
        );
        assert!(!fixture.manager.vault.crypto.is_unlocked());
        assert!(
            load_sentinel_genesis_finalization_pending()
                .await?
                .is_none()
        );
        event_db::clear_local_event_store(&pending.store_id).await?;
        let stored = indexed_db::load_sentinel_genesis_share_delivery(
            &pending.store_id,
            fixture.manager.device_identity()?.device_id().as_str(),
        )
        .await?
        .ok_or_else(|| anyhow::anyhow!("own delivery missing"))?;
        let stored: StoredSentinelGenesisDelivery = serde_json::from_str(&stored)?;
        assert_eq!(stored.request, pending.request);
        assert!(pending.deliveries.contains(&stored.delivery));
        Ok(())
    }
}
