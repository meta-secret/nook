//! Identity-directory commands that require the unlocked local app key.

use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::NookVaultManager;
use crate::identity_record::NookIdentityDirectorySnapshotRequest;

#[wasm_bindgen]
impl NookVaultManager {
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
        let store_id = nook_core::StoreId::parse(store_id)
            .map_err(|error| JsError::new(&error.to_string()))?;
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
    #[test]
    fn locked_session_keeps_its_public_app_id() {
        let device = super::super::session::DeviceSessionState {
            id: "app_companion_session".to_owned(),
            identity_private_key: String::new(),
            ..Default::default()
        };

        assert_eq!(device.public_app_id(), "app_companion_session");
    }
}
