//! Identity-directory commands that require the unlocked local app key.

use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::NookVaultManager;
use crate::identity_record::{NookIdentityDirectorySnapshotRequest, NookIdentitySnapshot};
use crate::storage::identity_record::update_identity_directory;

#[wasm_bindgen]
impl NookVaultManager {
    pub fn identity_directory_snapshot_request(
        &self,
    ) -> Result<NookIdentityDirectorySnapshotRequest, JsError> {
        let session_app_id = if self.device.identity_private_key.is_empty() {
            String::new()
        } else {
            self.device_identity()
                .map(|identity| identity.app_id().as_str().to_owned())
                .unwrap_or_default()
        };
        Ok(NookIdentityDirectorySnapshotRequest::new(session_app_id))
    }

    pub async fn create_identity(&self, label: String) -> Result<NookIdentitySnapshot, JsError> {
        let app_key = self
            .device_identity()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let current_app_id = app_key.app_id().as_str().to_owned();
        update_identity_directory(move |directory| {
            directory
                .create_identity(&label, &app_key, None)
                .map_err(|error| crate::NookError::Database(error.to_string()))?;
            directory
                .selected()
                .map(|record| {
                    NookIdentitySnapshot::from_record(record, Some(current_app_id.as_str()))
                })
                .map_err(|error| crate::NookError::Database(error.to_string()))
        })
        .await
        .map_err(|error| JsError::new(&error.to_string()))
    }
}
