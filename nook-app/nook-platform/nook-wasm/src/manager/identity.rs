//! Identity-directory commands that require the unlocked local app key.

use crate::identity_record;
use crate::storage::event_db;
use nook_core::{CurrentVaultReplaceability, StoreId};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::NookVaultManager;
use crate::identity_record::NookIdentityDirectorySnapshotRequest;
use crate::types::NookProviderVaultDecisionProjection;

#[wasm_bindgen]
impl NookVaultManager {
    pub async fn provider_vault_decision_request(
        &self,
        provider_store_id: String,
    ) -> Result<NookProviderVaultDecisionProjection, JsError> {
        let provider_store_id =
            StoreId::parse(&provider_store_id).map_err(|error| JsError::new(&error.to_string()))?;
        let current_store_id = self.vault.store_id.trim();
        let current_vault = if current_store_id.is_empty() {
            CurrentVaultReplaceability::Unknown
        } else {
            let store = event_db::load_local_event_store_strict(current_store_id)
                .await
                .map_err(|error| JsError::new(&error.to_string()))?;
            match store.load_graph(current_store_id) {
                Ok(graph) => {
                    nook_core::classify_current_vault_replaceability(&graph, current_store_id)
                }
                Err(_) => CurrentVaultReplaceability::Unknown,
            }
        };
        let identities = identity_record::provider_vault_identity_observations(
            &self.device.public_app_id(),
            &provider_store_id,
        )
        .await
        .map_err(|error| JsError::new(&error.to_string()))?;
        Ok(NookProviderVaultDecisionProjection::from_core(
            nook_core::project_provider_vault_decision(current_vault, identities),
        ))
    }

    pub fn identity_directory_snapshot_request(
        &self,
    ) -> Result<NookIdentityDirectorySnapshotRequest, JsError> {
        // The public session ID survives locking. Keeping it here prevents a
        // locked companion session from falling back to this browser's
        // persisted app key and borrowing its identity evidence.
        let session_app_id = self.device.public_app_id();
        let session_unlocked = !self.device.identity_private_key.is_empty();
        Ok(NookIdentityDirectorySnapshotRequest::new(
            session_app_id,
            session_unlocked,
        ))
    }

    pub fn selected_vault_identity_context_request(
        &self,
        store_id: &str,
    ) -> Result<NookIdentityDirectorySnapshotRequest, JsError> {
        let store_id =
            StoreId::parse(store_id).map_err(|error| JsError::new(&error.to_string()))?;
        let session_app_id = self.device.public_app_id();
        let session_unlocked = !self.device.identity_private_key.is_empty();
        Ok(NookIdentityDirectorySnapshotRequest::for_selected_vault(
            session_app_id,
            session_unlocked,
            store_id,
        ))
    }
}

#[cfg(test)]
mod tests {
    use crate::manager::session::DeviceSessionState;

    #[test]
    fn locked_session_keeps_its_public_app_id() {
        let device = DeviceSessionState {
            id: "app_companion_session".to_owned(),
            identity_private_key: String::new(),
            ..Default::default()
        };

        assert_eq!(device.public_app_id(), "app_companion_session");
    }
}
