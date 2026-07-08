//! Passkey-PRF setup, unlock, and recovery orchestration.

use super::NookVaultManager;
use crate::storage::{auth_providers, indexed_db};
use crate::{NookError, NookPasskeySetup, NookPasskeyUnlockOptions};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::{Zeroize, Zeroizing};

#[wasm_bindgen]
impl NookVaultManager {
    /// Require passkey authorization again before any device-key operation.
    #[wasm_bindgen(js_name = lockDeviceIdentity)]
    pub fn lock_device_identity(&mut self) {
        self.device.identity_private_key.zeroize();
    }

    #[wasm_bindgen(js_name = deviceProtectionStatus)]
    pub async fn device_protection_status(&self) -> Result<String, JsError> {
        if !self.device.identity_private_key.is_empty() {
            return Ok("unlocked".to_owned());
        }
        Ok(indexed_db::device_identity_protection_status()
            .await?
            .to_owned())
    }

    #[wasm_bindgen(js_name = beginDeviceProtection)]
    pub async fn begin_device_protection(&mut self) -> Result<NookPasskeySetup, JsError> {
        if self.device.identity_private_key.is_empty() {
            if matches!(
                indexed_db::device_identity_protection_status().await?,
                "passkey" | "pin"
            ) {
                return Err(NookError::Decryption(
                    "errors.device_protection.authorization_required".to_owned(),
                )
                .into());
            }
            let identity = nook_core::DeviceIdentity::generate()?;
            self.device.id = identity.device_id().to_string();
            self.device.identity_private_key = identity.secret_string().into_inner();
        }

        let setup = nook_core::DeviceKeyProtectionSetup::generate()?;
        Ok(NookPasskeySetup::from_core(&setup))
    }

    #[wasm_bindgen(js_name = finishDeviceProtection)]
    pub async fn finish_device_protection(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        prf_input: Vec<u8>,
        mut prf_output: Vec<u8>,
    ) -> Result<(), JsError> {
        let result = async {
            let identity = self.device_identity()?;
            let record = nook_core::wrap_device_identity(
                &identity.secret_string(),
                &credential_id,
                &user_handle,
                &prf_input,
                &prf_output,
            )?;
            indexed_db::save_wrapped_device_identity(&self.device.id, &record).await
        }
        .await;
        prf_output.zeroize();
        result.map_err(Into::into)
    }

    #[wasm_bindgen(js_name = finishPinDeviceProtection)]
    pub async fn finish_pin_device_protection(&mut self, pin: String) -> Result<(), JsError> {
        let pin = Zeroizing::new(pin);
        let result = async {
            if self.device.identity_private_key.is_empty() {
                if matches!(
                    indexed_db::device_identity_protection_status().await?,
                    "passkey" | "pin"
                ) {
                    return Err(NookError::Decryption(
                        "errors.device_protection.authorization_required".to_owned(),
                    ));
                }
                let identity = nook_core::DeviceIdentity::generate()?;
                self.device.id = identity.device_id().to_string();
                self.device.identity_private_key = identity.secret_string().into_inner();
            }

            let identity = self.device_identity()?;
            let record = nook_core::wrap_device_identity_with_pin(&identity.secret_string(), &pin)?;
            indexed_db::save_wrapped_device_identity(&self.device.id, &record).await
        }
        .await;
        result.map_err(Into::into)
    }

    #[wasm_bindgen(js_name = passkeyUnlockOptions)]
    pub async fn passkey_unlock_options(&self) -> Result<NookPasskeyUnlockOptions, JsError> {
        let (_, record) = indexed_db::load_wrapped_device_identity()
            .await?
            .ok_or_else(|| {
                NookError::IndexedDb("No passkey-protected device identity found.".to_owned())
            })?;
        Ok(NookPasskeyUnlockOptions::from_core(&record)?)
    }

    #[wasm_bindgen(js_name = unlockDeviceIdentity)]
    pub async fn unlock_device_identity(&mut self, mut prf_output: Vec<u8>) -> Result<(), JsError> {
        let result = async {
            let (stored_device_id, record) = indexed_db::load_wrapped_device_identity()
                .await?
                .ok_or_else(|| {
                    NookError::IndexedDb("No passkey-protected device identity found.".to_owned())
                })?;
            let secret = nook_core::unwrap_device_identity(&record, &prf_output)?;
            let identity = nook_core::DeviceIdentity::from_secret_str(&secret)?;
            if identity.device_id().as_str() != stored_device_id {
                return Err(NookError::Decryption(
                    "Protected device identity does not match device_id.".to_owned(),
                ));
            }
            self.device.id = stored_device_id;
            self.device.identity_private_key = secret.into_inner();
            Ok(())
        }
        .await;
        prf_output.zeroize();
        result.map_err(Into::into)
    }

    #[wasm_bindgen(js_name = unlockPinDeviceIdentity)]
    pub async fn unlock_pin_device_identity(&mut self, pin: String) -> Result<(), JsError> {
        let pin = Zeroizing::new(pin);
        let result = async {
            let (stored_device_id, record) = indexed_db::load_wrapped_device_identity()
                .await?
                .ok_or_else(|| {
                    NookError::IndexedDb("No PIN-protected device identity found.".to_owned())
                })?;
            let secret = nook_core::unwrap_device_identity_with_pin(&record, &pin)?;
            let identity = nook_core::DeviceIdentity::from_secret_str(&secret)?;
            if identity.device_id().as_str() != stored_device_id {
                return Err(NookError::Decryption(
                    "Protected device identity does not match device_id.".to_owned(),
                ));
            }
            self.device.id = stored_device_id;
            self.device.identity_private_key = secret.into_inner();
            Ok(())
        }
        .await;
        result.map_err(Into::into)
    }

    /// Destructive local recovery: forget the inaccessible identity and its
    /// identity-sealed provider credentials, preserving local encrypted vaults.
    #[wasm_bindgen(js_name = resetDeviceProtectionForRecovery)]
    pub async fn reset_device_protection_for_recovery(&mut self) -> Result<(), JsError> {
        self.reset_vault_session();
        self.device.identity_private_key.zeroize();
        self.device.id.clear();
        self.storage.access_token.zeroize();
        self.storage.remote_ref.clear();
        self.storage.remote_path.clear();
        self.storage.mode = nook_core::StorageMode::Local;
        indexed_db::delete_device_identity_for_recovery().await?;
        auth_providers::delete_auth_providers_db().await?;
        Ok(())
    }
}
