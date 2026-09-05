//! Terminal Sentinel completion owns cleanup from reconstruction through access.

use super::super::verified_access::VerifiedVaultAccessFlow;
use super::super::{CeremonyState, NookVaultManager};
use crate::{NookError, NookSecretRecord};
use nook_core::{
    DeviceIdentity, MultiDeviceError, SentinelUnlockPolicy, SentinelUnlockQuorum,
    SentinelUnlockSession, StoreId, VaultMetaState, VaultType,
};
#[cfg(test)]
use std::future;
use std::mem;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn finalize_sentinel_unlock(&mut self) -> Result<Vec<NookSecretRecord>, JsError> {
        let identity = self.ensure_device_identity()?;
        let session = self.take_sentinel_unlock()?;
        let quorum = match session.into_quorum(&identity) {
            Ok(quorum) => quorum,
            Err(rejected) => {
                let (session, error) = rejected.into_parts();
                self.sentinel_unlock = CeremonyState::Active(session);
                return Err(error.into());
            }
        };
        Ok(PendingUnlockCompletion::new(self)
            .complete(quorum, &identity)
            .await?)
    }
}

impl NookVaultManager {
    pub(super) fn take_sentinel_unlock(&mut self) -> Result<SentinelUnlockSession, JsError> {
        match mem::replace(&mut self.sentinel_unlock, CeremonyState::Inactive) {
            CeremonyState::Active(session) => Ok(session),
            CeremonyState::Inactive => Err(JsError::new("No Sentinel unlock ceremony is active.")),
        }
    }
}

enum CompletionState {
    Pending,
    Committed,
}

struct PendingUnlockCompletion<'a> {
    manager: &'a mut NookVaultManager,
    state: CompletionState,
    #[cfg(test)]
    checkpoint: CompletionCheckpoint,
}

impl<'a> PendingUnlockCompletion<'a> {
    fn new(manager: &'a mut NookVaultManager) -> Self {
        Self {
            manager,
            state: CompletionState::Pending,
            #[cfg(test)]
            checkpoint: CompletionCheckpoint::Live,
        }
    }

    async fn complete(
        mut self,
        quorum: SentinelUnlockQuorum<'_>,
        identity: &DeviceIdentity,
    ) -> Result<Vec<NookSecretRecord>, NookError> {
        if self.manager.vault.architecture.vault_type != VaultType::Sentinel {
            return Err(MultiDeviceError::InvalidSentinelUnlockSession.into());
        }
        let store_id = StoreId::parse(&self.manager.vault.store_id)?;
        let policy = self.manager.vault.architecture.sentinel.policy()?;
        quorum.check_context(
            &store_id,
            SentinelUnlockPolicy {
                threshold: policy.threshold.into(),
                required_participants: policy.required_participants.into(),
            },
        )?;
        let keys = quorum.finalize()?;
        let records = self.manager.stored_records_snapshot();
        let meta = VaultMetaState::from_stored_records(&records)?;
        self.manager
            .apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        self.manager.vault.meta = meta;
        #[cfg(test)]
        self.checkpoint
            .before(self.manager, CompletionStep::EventLogRead)
            .await?;
        if self.manager.event_log_has_events().await? {
            #[cfg(test)]
            self.checkpoint
                .before(self.manager, CompletionStep::Projection)
                .await?;
            self.manager.apply_event_projection_to_session().await?;
        }
        #[cfg(test)]
        self.checkpoint
            .before(self.manager, CompletionStep::Persistence)
            .await?;
        self.manager.persist_projection_cache().await?;
        #[cfg(test)]
        self.checkpoint
            .before(self.manager, CompletionStep::CatalogPurge)
            .await?;
        self.manager.purge_legacy_plaintext_search_catalog().await?;
        #[cfg(test)]
        self.checkpoint
            .before(self.manager, CompletionStep::AccessResult)
            .await?;
        let records = VerifiedVaultAccessFlow::SentinelUnlock
            .complete(
                self.manager.get_records(),
                identity.device_id(),
                &self.manager.vault.store_id,
            )
            .await?;
        self.state = CompletionState::Committed;
        Ok(records)
    }
}

impl Drop for PendingUnlockCompletion<'_> {
    fn drop(&mut self) {
        if matches!(self.state, CompletionState::Pending) {
            self.manager.reset_vault_session();
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompletionStep {
    EventLogRead,
    Projection,
    Persistence,
    CatalogPurge,
    AccessResult,
}

#[cfg(test)]
enum CompletionCheckpoint {
    Live,
    FailAt(CompletionStep),
    PendingAt(CompletionStep),
}

#[cfg(test)]
impl CompletionCheckpoint {
    async fn before(
        &self,
        manager: &NookVaultManager,
        step: CompletionStep,
    ) -> Result<(), NookError> {
        assert!(manager.vault.crypto.is_unlocked());
        assert!(!manager.vault.secrets_key.is_empty());
        assert!(!manager.vault.members_key.is_empty());
        if matches!(
            step,
            CompletionStep::CatalogPurge | CompletionStep::AccessResult
        ) {
            assert!(!manager.vault.last_synced_content.is_empty());
        }
        match self {
            Self::FailAt(target) if *target == step => Err(NookError::Database(
                "injected Sentinel completion failure".to_owned(),
            )),
            Self::PendingAt(target) if *target == step => future::pending().await,
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{
        DeviceMode, SentinelUnlockSigning, SentinelVaultUnlockState, SigningIdentity,
        VaultArchitecture,
    };
    use std::future::Future;
    use std::task::{Context, Poll, Waker};

    struct Fixture {
        identity: DeviceIdentity,
        signer: SigningIdentity,
        participant: DeviceIdentity,
        participant_signer: SigningIdentity,
        output: nook_core::SentinelGenesisOutput,
    }

    impl Fixture {
        fn require_invalid_key(result: Result<(), NookError>) -> anyhow::Result<()> {
            match result {
                Err(NookError::Database(message)) => {
                    use nook_core::ValidationError;
                    assert_eq!(message, ValidationError::SymmetricKeyInvalid.to_string());
                    Ok(())
                }
                Err(error) => Err(error.into()),
                Ok(()) => Err(anyhow::anyhow!("invalid vault key must be rejected")),
            }
        }

        fn new() -> anyhow::Result<Self> {
            let identity = DeviceIdentity::generate()?;
            let signer = SigningIdentity::generate()?.0;
            let participant = DeviceIdentity::generate()?;
            let participant_signer = SigningIdentity::generate()?.0;
            let mut genesis = nook_core::start_sentinel_genesis(
                &identity,
                &signer,
                nook_core::StartSentinelGenesisArgs {
                    label: "Requester".to_owned(),
                    participant_count: 2,
                    threshold: 2,
                },
            )?;
            let response = nook_core::respond_to_sentinel_genesis_request(
                &nook_core::sentinel_genesis_request(&genesis),
                &participant,
                &participant_signer,
                "Participant".to_owned(),
            )?;
            nook_core::add_sentinel_genesis_response(&mut genesis, response)?;
            let output = nook_core::finalize_sentinel_genesis(genesis, &signer)?;
            Ok(Self {
                identity,
                signer,
                participant,
                participant_signer,
                output,
            })
        }

        fn session(
            &self,
            records: &[nook_core::StoredSecretRecord],
        ) -> anyhow::Result<SentinelUnlockSession> {
            Ok(self.signer.start_sentinel_unlock(
                self.output.store_id.clone(),
                SentinelUnlockPolicy {
                    threshold: 2.into(),
                    required_participants: 2.into(),
                },
                records,
                &self.identity,
            )?)
        }

        fn ready_session(
            &self,
            records: &[nook_core::StoredSecretRecord],
        ) -> anyhow::Result<SentinelUnlockSession> {
            let mut session = self.session(records)?;
            let request = session.request();
            for (identity, signer) in [
                (&self.identity, &self.signer),
                (&self.participant, &self.participant_signer),
            ] {
                let response = signer.respond_to_sentinel_unlock_request(
                    request.clone(),
                    &self.output.stored_records,
                    identity,
                    &self.signer.public_key(),
                )?;
                session = session
                    .collect(response)
                    .map_err(|rejected| rejected.into_parts().1)?;
            }
            Ok(session)
        }

        fn manager(&self) -> anyhow::Result<NookVaultManager> {
            let mut manager = NookVaultManager::new();
            manager.vault.store_id = self.output.store_id.to_string();
            manager.vault.architecture = self.output.architecture.clone();
            manager.vault.meta = VaultMetaState::from_stored_records(&self.output.stored_records)?;
            manager.device.identity_private_key = self.identity.secret_string().as_str().to_owned();
            manager.storage.access_token = "configured-test-provider".to_owned();
            manager.event_log.signing_seed = "ephemeral-test-seed".to_owned();
            manager.sync_outbox.access_token = "pending-test-token".to_owned();
            Ok(manager)
        }

        fn assert_reset(&self, manager: &NookVaultManager) {
            assert!(manager.vault.secrets_key.is_empty());
            assert!(manager.vault.members_key.is_empty());
            assert!(!manager.vault.crypto.is_unlocked());
            assert!(manager.stored_records_snapshot().is_empty());
            assert!(manager.vault.store_id.is_empty());
            assert!(manager.vault.last_synced_content.is_empty());
            assert!(manager.vault.password_entries.is_empty());
            assert!(!manager.vault.search_catalog.is_ready());
            assert!(manager.vault.search_catalog_store_id.is_empty());
            assert_eq!(manager.vault.search_catalog_pending_bucket_mask, 0);
            assert!(matches!(manager.sentinel_unlock, CeremonyState::Inactive));
            assert!(matches!(manager.sentinel_genesis, CeremonyState::Inactive));
            assert!(matches!(
                manager.pending_sentinel_genesis_request,
                CeremonyState::Inactive
            ));
            assert!(!manager.event_log.enabled);
            assert!(manager.event_log.signing_seed.is_empty());
            assert!(manager.event_log.key_epoch.is_empty());
            assert!(manager.event_log.heads.is_empty());
            assert!(manager.sync_outbox.access_token.is_empty());
            assert_eq!(manager.storage.access_token, "configured-test-provider");
            assert_eq!(
                manager.device.identity_private_key,
                self.identity.secret_string().as_str()
            );
        }
    }

    #[test]
    fn partial_key_installation_is_reset() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut manager = fixture.manager()?;
        {
            let completion = PendingUnlockCompletion::new(&mut manager);
            Fixture::require_invalid_key(
                completion
                    .manager
                    .apply_vault_keys("invalid", "partially-installed"),
            )?;
            assert_eq!(completion.manager.vault.members_key, "partially-installed");
            assert_eq!(completion.manager.vault.secrets_key, "invalid");
        }
        fixture.assert_reset(&manager);
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::AwaitingShares
        );
        Ok(())
    }

    #[test]
    fn dropping_polled_completion_resets_installed_keys() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut manager = fixture.manager()?;
        let quorum = fixture
            .ready_session(&fixture.output.stored_records)?
            .into_quorum(&fixture.identity)
            .map_err(|rejected| rejected.into_parts().1)?;
        let mut completion = PendingUnlockCompletion::new(&mut manager);
        completion.checkpoint = CompletionCheckpoint::PendingAt(CompletionStep::EventLogRead);
        let mut future = Box::pin(completion.complete(quorum, &fixture.identity));
        assert!(matches!(
            future
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop())),
            Poll::Pending
        ));
        drop(future);
        fixture.assert_reset(&manager);
        Ok(())
    }

    #[test]
    fn failure_after_reconstruction_resets_installed_keys() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut manager = fixture.manager()?;
        let quorum = fixture
            .ready_session(&fixture.output.stored_records)?
            .into_quorum(&fixture.identity)
            .map_err(|rejected| rejected.into_parts().1)?;
        let mut completion = PendingUnlockCompletion::new(&mut manager);
        completion.checkpoint = CompletionCheckpoint::FailAt(CompletionStep::EventLogRead);
        let mut future = Box::pin(completion.complete(quorum, &fixture.identity));
        assert!(matches!(
            future
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop())),
            Poll::Ready(Err(_))
        ));
        drop(future);
        fixture.assert_reset(&manager);
        Ok(())
    }

    #[test]
    fn current_context_mismatch_is_terminal_before_key_installation() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        for mismatch in 0..4 {
            let mut manager = fixture.manager()?;
            match mismatch {
                0 => manager.vault.store_id = nook_core::generate_store_id()?.to_string(),
                1 => manager.vault.architecture = VaultArchitecture::default(),
                2 => {
                    manager.vault.architecture = VaultArchitecture::sentinel_personal(
                        DeviceMode::Standard,
                        nook_core::SentinelPolicy {
                            threshold: 3,
                            required_participants: 3,
                            ready_participants: 3,
                        },
                    )
                }
                _ => manager.vault.store_id = "invalid-store".to_owned(),
            }
            let quorum = fixture
                .ready_session(&fixture.output.stored_records)?
                .into_quorum(&fixture.identity)
                .map_err(|rejected| rejected.into_parts().1)?;
            let mut future = Box::pin(
                PendingUnlockCompletion::new(&mut manager).complete(quorum, &fixture.identity),
            );
            assert!(matches!(
                future
                    .as_mut()
                    .poll(&mut Context::from_waker(Waker::noop())),
                Poll::Ready(Err(_))
            ));
            drop(future);
            fixture.assert_reset(&manager);
        }
        Ok(())
    }

    #[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
    mod browser {
        use super::*;
        use crate::storage::event_db;
        use nook_core::{EventId, IsoTimestamp, Sha256Hex, VaultOperation};
        use wasm_bindgen_test::wasm_bindgen_test;

        #[wasm_bindgen_test]
        async fn invalid_json_and_below_quorum_preserve_the_session() -> anyhow::Result<()> {
            let fixture = Fixture::new()?;
            let mut manager = fixture.manager()?;
            let session = fixture.session(&fixture.output.stored_records)?;
            let request = session.request();
            manager.sentinel_unlock = CeremonyState::Active(session);
            assert!(
                manager
                    .add_sentinel_unlock_response("invalid-json")
                    .is_err()
            );
            assert!(manager.finalize_sentinel_unlock().await.is_err());
            let stored = manager
                .sentinel_unlock
                .get("retained")
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            assert_eq!(stored.request(), request);
            assert_eq!(stored.status().collected, 0.into());
            assert_eq!(manager.vault.store_id, fixture.output.store_id.as_str());
            Ok(())
        }

        #[wasm_bindgen_test]
        async fn reconstruction_failure_consumes_and_resets_the_ceremony() -> anyhow::Result<()> {
            let fixture = Fixture::new()?;
            let mut manager = fixture.manager()?;
            // Valid contributions cannot finalize against an absent original share set.
            manager.sentinel_unlock = CeremonyState::Active(fixture.ready_session(&[])?);
            assert!(manager.finalize_sentinel_unlock().await.is_err());
            fixture.assert_reset(&manager);
            Ok(())
        }

        #[wasm_bindgen_test]
        async fn every_asynchronous_failure_resets_and_success_commits() -> anyhow::Result<()> {
            let fixture = Fixture::new()?;
            for step in [
                CompletionStep::EventLogRead,
                CompletionStep::Projection,
                CompletionStep::Persistence,
                CompletionStep::CatalogPurge,
                CompletionStep::AccessResult,
            ] {
                let mut manager = fixture.manager()?;
                // A signed genesis root needs VaultImported before its Sentinel operations.
                let mut operations = vec![VaultOperation::VaultImported {
                    source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                }];
                operations.extend(nook_core::sentinel_genesis_operations(&fixture.output));
                let epoch = EventId::from_sha256_hex(
                    nook_core::sha256_hex(fixture.output.store_id.as_str().as_bytes()).as_str(),
                )?;
                let (event, bytes) = nook_core::build_signed_event(nook_core::AppendEventInput {
                    store_id: &fixture.output.store_id,
                    actor_id: &fixture.signer.actor_id()?,
                    signing_identity: &fixture.signer,
                    parents: Vec::new(),
                    key_epoch: &epoch,
                    created_at: &IsoTimestamp::from_trusted("2026-09-04T00:00:00Z".to_owned()),
                    operations,
                })?;
                let event_id = event.validate_envelope(&fixture.output.store_id)?;
                event_db::save_event_bytes(
                    fixture.output.store_id.as_str(),
                    event_id.as_str(),
                    &bytes,
                )
                .await?;
                let quorum = fixture
                    .ready_session(&fixture.output.stored_records)?
                    .into_quorum(&fixture.identity)
                    .map_err(|rejected| rejected.into_parts().1)?;
                let mut completion = PendingUnlockCompletion::new(&mut manager);
                completion.checkpoint = CompletionCheckpoint::FailAt(step);
                let error = completion
                    .complete(quorum, &fixture.identity)
                    .await
                    .err()
                    .ok_or_else(|| anyhow::anyhow!("checkpoint must fail"))?;
                assert!(
                    error
                        .to_string()
                        .contains("injected Sentinel completion failure"),
                    "completion failed before injected {step:?}; error variant: {:?}",
                    mem::discriminant(&error)
                );
                fixture.assert_reset(&manager);
                event_db::clear_local_event_store(fixture.output.store_id.as_str()).await?;
            }
            let mut manager = fixture.manager()?;
            manager.sentinel_unlock =
                CeremonyState::Active(fixture.ready_session(&fixture.output.stored_records)?);
            let records = manager
                .finalize_sentinel_unlock()
                .await
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            assert!(records.is_empty());
            assert!(manager.vault.crypto.is_unlocked());
            assert!(!manager.vault.secrets_key.is_empty());
            assert!(!manager.vault.last_synced_content.is_empty());
            assert!(matches!(manager.sentinel_unlock, CeremonyState::Inactive));
            assert!(manager.finalize_sentinel_unlock().await.is_err());
            assert!(manager.vault.crypto.is_unlocked());
            manager.reset_vault_session();
            Ok(())
        }
    }
}
