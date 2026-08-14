use super::super::{CeremonyState, NookVaultManager, VaultNameState};
use super::{SentinelDeliveryIdentityBinding, StoredSentinelGenesisDelivery};
use crate::storage::indexed_db::{
    clear_sentinel_genesis_finalization_pending, load_sentinel_genesis_finalization_pending,
    save_sentinel_genesis_finalization_pending, save_sentinel_genesis_share_delivery,
    save_to_indexed_db,
};
use crate::{NookError, NookSentinelGenesisFinalizeResult};
use serde::{Deserialize, Deserializer, Serialize, de::Error as _};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingSentinelGenesisFinalization {
    store_id: String,
    identity_binding: PendingSentinelIdentityBinding,
    vault_name: VaultNameState,
    architecture: nook_core::VaultArchitecture,
    yaml: String,
    request: nook_core::SentinelGenesisRequest,
    participants: Vec<nook_core::SentinelGenesisParticipant>,
    deliveries: Vec<nook_core::SentinelGenesisShareDelivery>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PendingSentinelIdentityBinding {
    LegacyUnbound,
    Bound {
        #[serde(rename = "identityId")]
        identity_id: nook_core::IdentityId,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingSentinelGenesisWire {
    store_id: String,
    #[serde(default)]
    identity_binding: Option<PendingSentinelIdentityBinding>,
    #[serde(default)]
    identity_id: Option<nook_core::IdentityId>,
    vault_name: VaultNameState,
    architecture: nook_core::VaultArchitecture,
    yaml: String,
    request: nook_core::SentinelGenesisRequest,
    participants: Vec<nook_core::SentinelGenesisParticipant>,
    deliveries: Vec<nook_core::SentinelGenesisShareDelivery>,
}

impl<'de> Deserialize<'de> for PendingSentinelGenesisFinalization {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = PendingSentinelGenesisWire::deserialize(deserializer)?;
        let identity_binding = migrate_identity_binding(wire.identity_binding, wire.identity_id)
            .map_err(D::Error::custom)?;
        Ok(Self {
            store_id: wire.store_id,
            identity_binding,
            vault_name: wire.vault_name,
            architecture: wire.architecture,
            yaml: wire.yaml,
            request: wire.request,
            participants: wire.participants,
            deliveries: wire.deliveries,
        })
    }
}

fn migrate_identity_binding(
    current: Option<PendingSentinelIdentityBinding>,
    legacy_identity_id: Option<nook_core::IdentityId>,
) -> Result<PendingSentinelIdentityBinding, &'static str> {
    Ok(match (current, legacy_identity_id) {
        (Some(binding), None) => binding,
        (None, Some(identity_id)) => PendingSentinelIdentityBinding::Bound { identity_id },
        (None, None) => PendingSentinelIdentityBinding::LegacyUnbound,
        (Some(_), Some(_)) => {
            return Err("Sentinel finalization has both current and legacy identity binding");
        }
    })
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
        let ceremony = self
            .sentinel_genesis
            .get("No Sentinel genesis ceremony is active.")?;
        let session = ceremony.session.clone();
        let identity_id = ceremony.identity_id.clone();
        let genesis_request = session.request.clone();
        let participants = session.participants().to_vec();
        let output = nook_core::finalize_sentinel_genesis(session, &signing)?;
        let store_id = output.store_id.as_str().to_owned();
        let vault_name = self.vault.vault_name.clone();
        let yaml = nook_core::serialize_stored_yaml_with_unlock_name_architecture(
            &output.stored_records,
            &nook_core::VaultUnlock::Keys,
            &[],
            nook_core::VaultStoreIdentityRef::Assigned(&store_id),
            match &vault_name {
                VaultNameState::Unnamed => nook_core::VaultNameRef::Unnamed,
                VaultNameState::Named(name) => nook_core::VaultNameRef::Named(name),
            },
            nook_core::VaultVersionWrite::Initial,
            &output.architecture,
        )?;
        let pending = PendingSentinelGenesisFinalization {
            store_id,
            identity_binding: PendingSentinelIdentityBinding::Bound { identity_id },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_sentinel_identity_binding_has_named_migration_states() -> anyhow::Result<()> {
        let identity_id = nook_core::IdentityId::generate()?;
        assert!(matches!(
            migrate_identity_binding(None, None),
            Ok(PendingSentinelIdentityBinding::LegacyUnbound)
        ));
        assert!(matches!(
            migrate_identity_binding(None, Some(identity_id.clone())),
            Ok(PendingSentinelIdentityBinding::Bound { identity_id: migrated })
                if migrated == identity_id
        ));
        assert!(
            migrate_identity_binding(
                Some(PendingSentinelIdentityBinding::LegacyUnbound),
                Some(identity_id),
            )
            .is_err()
        );
        Ok(())
    }
}

impl NookVaultManager {
    async fn complete_sentinel_genesis_finalization(
        &mut self,
        mut pending: PendingSentinelGenesisFinalization,
    ) -> Result<NookSentinelGenesisFinalizeResult, JsError> {
        let identity = self.device_identity()?;
        let identity_id = match &pending.identity_binding {
            PendingSentinelIdentityBinding::Bound { identity_id } => identity_id.clone(),
            PendingSentinelIdentityBinding::LegacyUnbound => {
                let label = match &pending.vault_name {
                    VaultNameState::Named(name) if !name.trim().is_empty() => name.as_str(),
                    _ => "Personal",
                };
                // Active selection is mutable and cannot prove which identity began
                // a legacy ceremony. Resolve only an unambiguous app-key binding.
                let identity_id =
                    crate::storage::identity_record::ensure_unambiguous_identity_for_app_key(
                        &identity, label,
                    )
                    .await?
                    .identity_id;
                pending.identity_binding = PendingSentinelIdentityBinding::Bound {
                    identity_id: identity_id.clone(),
                };
                let upgraded = serde_json::to_string(&pending)
                    .map_err(|error| NookError::Serialization(error.to_string()))?;
                save_sentinel_genesis_finalization_pending(&upgraded).await?;
                identity_id
            }
        };
        let format = nook_core::detect_stored_format(&pending.yaml)?;
        let records = nook_core::deserialize_stored(&pending.yaml, format)?;
        pending.architecture.validate_records(&records)?;

        save_to_indexed_db(&pending.yaml).await?;
        self.vault.reset();
        self.vault.store_id.clone_from(&pending.store_id);
        self.vault.vault_name.clone_from(&pending.vault_name);
        self.vault.architecture = pending.architecture.clone();
        self.vault.meta = nook_core::VaultMetaState::from_stored_records(&records);
        self.vault.last_synced_content.clone_from(&pending.yaml);
        self.event_log.reset();
        self.ensure_sentinel_genesis_event(&pending.participants, &pending.deliveries)
            .await?;

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
            identity_binding: SentinelDeliveryIdentityBinding::Bound {
                identity_id: identity_id.clone(),
            },
        })
        .map_err(|error| NookError::Serialization(error.to_string()))?;
        save_sentinel_genesis_share_delivery(
            &pending.store_id,
            identity.device_id().as_str(),
            &stored_json,
        )
        .await?;
        let store_id = nook_core::StoreId::parse(&pending.store_id)
            .map_err(|error| NookError::Database(error.to_string()))?;
        crate::storage::identity_record::associate_sentinel_vault_with_identity(
            &identity_id,
            &identity,
            store_id,
        )
        .await?;
        clear_sentinel_genesis_finalization_pending().await?;
        self.sentinel_genesis = CeremonyState::Inactive;
        self.sentinel_genesis_phase = nook_core::SentinelGenesisPhase::DeliveringShares;

        Ok(NookSentinelGenesisFinalizeResult::from_core(
            pending.store_id,
            pending.architecture,
            &pending.participants,
            &pending.deliveries,
        )?)
    }
}
