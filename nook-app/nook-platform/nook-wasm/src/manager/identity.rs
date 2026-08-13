//! Identity-directory commands that require the unlocked local app key.

use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::NookVaultManager;
use crate::identity_record::NookIdentitySnapshot;
use crate::storage::identity_record::{load_identity_directory, save_identity_directory};

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = createIdentity)]
    pub async fn create_identity(&self, label: String) -> Result<NookIdentitySnapshot, JsError> {
        let app_key = self
            .device_identity()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let mut directory = load_identity_directory()
            .await
            .map_err(|error| JsError::new(&error.to_string()))?;
        directory
            .create_identity(&label, &app_key, None)
            .map_err(|error| JsError::new(&error.to_string()))?;
        let snapshot = NookIdentitySnapshot::from_record(
            directory
                .selected()
                .map_err(|error| JsError::new(&error.to_string()))?,
        );
        save_identity_directory(&directory)
            .await
            .map_err(|error| JsError::new(&error.to_string()))?;
        Ok(snapshot)
    }
}
