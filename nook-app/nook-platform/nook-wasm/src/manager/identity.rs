//! Identity-directory commands that require the unlocked local app key.

use crate::BrowserProviderVaultIdentityObservations;
use crate::NookDatabase;
use crate::NookIdentityDirectorySnapshot;
#[cfg(test)]
use crate::identity_record;
#[cfg(test)]
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
            let store = NookDatabase::load_local_event_store_strict(current_store_id)
                .await
                .map_err(|error| JsError::new(&error.to_string()))?;
            match store.load_graph(current_store_id) {
                Ok(graph) => CurrentVaultReplaceability::from_event_graph(&graph, current_store_id),
                Err(_) => CurrentVaultReplaceability::Unknown,
            }
        };
        let identities = NookIdentityDirectorySnapshot::provider_vault_identity_observations(
            BrowserProviderVaultIdentityObservations {
                session_app_id: &self.device.public_app_id(),
                store_id: &provider_store_id,
            },
        )
        .await
        .map_err(|error| JsError::new(&error.to_string()))?;
        Ok(NookProviderVaultDecisionProjection::from_core(
            current_vault.project_provider_vault_decision(identities),
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
            (session_unlocked).into(),
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
            (session_unlocked).into(),
            store_id,
        ))
    }
}

#[cfg(test)]
mod tests {
    use crate::manager::session::DeviceSessionState;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn locked_session_keeps_its_public_app_id() {
        let device = DeviceSessionState {
            id: "app_companion_session".to_owned(),
            identity_private_key: String::new(),
            ..Default::default()
        };

        assert_eq!(device.public_app_id(), "app_companion_session");
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn identity_snapshot_requests_validate_selected_store_ids() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        let identity = nook_core::DeviceIdentity::generate()?;
        manager.device.id = identity.device_id().to_string();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        assert!(manager.identity_directory_snapshot_request().is_ok());
        let store_id = nook_core::StoreId::generate()?;
        assert!(
            manager
                .selected_vault_identity_context_request(store_id.as_str())
                .is_ok()
        );
        assert!(
            manager
                .selected_vault_identity_context_request("invalid-store")
                .is_err()
        );
        Ok(())
    }
}
