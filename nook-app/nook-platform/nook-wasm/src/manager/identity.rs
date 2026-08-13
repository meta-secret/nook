//! Identity-directory commands that require the unlocked local app key.

use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::NookVaultManager;
use crate::identity_record::NookIdentitySnapshot;
use crate::storage::identity_record::update_identity_directory;

#[wasm_bindgen]
impl NookVaultManager {
    pub async fn create_identity(&self, label: String) -> Result<NookIdentitySnapshot, JsError> {
        let app_key = self
            .device_identity()
            .map_err(|error| JsError::new(&error.to_string()))?;
        update_identity_directory(move |directory| {
            directory
                .create_identity(&label, &app_key, None)
                .map_err(|error| crate::NookError::Database(error.to_string()))?;
            directory
                .selected()
                .map(NookIdentitySnapshot::from_record)
                .map_err(|error| crate::NookError::Database(error.to_string()))
        })
        .await
        .map_err(|error| JsError::new(&error.to_string()))
    }
}
