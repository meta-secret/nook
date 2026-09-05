use super::super::{CeremonyState, NookVaultManager, VaultNameState};
use super::StoredSentinelGenesisDelivery;
use crate::storage::indexed_db::{
    clear_sentinel_genesis_finalization_pending, load_sentinel_genesis_finalization_pending,
    save_sentinel_genesis_finalization_pending, save_sentinel_genesis_share_delivery,
    save_to_indexed_db,
};
use crate::{NookError, NookSentinelGenesisFinalizeResult};
use nook_core::{
    SentinelGenesisPhase, VaultMetaState, VaultNameRef, VaultStoreIdentityRef, VaultUnlock,
    VaultVersionWrite,
};
use serde::{Deserialize, Serialize};
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
        let session = self
            .sentinel_genesis
            .get("No Sentinel genesis ceremony is active.")?
            .clone();
        let genesis_request = session.request.clone();
        let participants = session.participants().to_vec();
        let output = nook_core::finalize_sentinel_genesis(session, &signing)?;
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
        save_sentinel_genesis_finalization_pending(&pending_json).await?;
        self.sentinel_genesis = CeremonyState::Inactive;
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
        let meta = VaultMetaState::from_stored_records(&records)?;

        save_to_indexed_db(&pending.yaml).await?;
        self.vault.reset();
        self.vault.store_id.clone_from(&pending.store_id);
        self.vault.vault_name.clone_from(&pending.vault_name);
        self.vault.architecture = pending.architecture.clone();
        self.vault.meta = meta;
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
