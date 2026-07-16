//! Passkey-PRF setup, unlock, and recovery orchestration.

use super::NookVaultManager;
use crate::passkey_browser;
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
        self.device.extension_handoff_private_key.zeroize();
    }

    /// Create a one-time age recipient for an extension identity handoff.
    /// The matching private key remains inside this manager's Rust state.
    #[wasm_bindgen(js_name = beginExtensionIdentityHandoff)]
    pub fn begin_extension_identity_handoff(&mut self) -> Result<String, JsError> {
        self.device.extension_handoff_private_key.zeroize();
        let recipient = nook_core::DeviceIdentity::generate()?;
        self.device.extension_handoff_private_key = recipient.secret_string().into_inner();
        Ok(recipient.public_key().into_inner())
    }

    /// Seal the currently unlocked extension identity to a one-time website
    /// recipient. Plaintext private material never crosses the WASM boundary.
    #[wasm_bindgen(js_name = sealExtensionIdentityHandoff)]
    pub async fn seal_extension_identity_handoff(
        &mut self,
        recipient_public_key: &str,
        nonce: &str,
    ) -> Result<String, JsError> {
        let identity = self.ensure_device_identity()?;
        self.ensure_signing_identity().await?;
        let recipient_public_key = nook_core::DevicePublicKey::parse(recipient_public_key)?;
        Ok(nook_core::seal_extension_identity_handoff(
            &identity,
            &self.event_log.signing_seed,
            &recipient_public_key,
            nonce,
        )?
        .into_inner())
    }

    /// Open and validate an extension identity handoff, then adopt both the age
    /// identity and its matching event-signing seed for this in-memory session.
    #[wasm_bindgen(js_name = finishExtensionIdentityHandoff)]
    pub fn finish_extension_identity_handoff(
        &mut self,
        envelope: &str,
        nonce: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
    ) -> Result<(), JsError> {
        let private_key = Zeroizing::new(std::mem::take(
            &mut self.device.extension_handoff_private_key,
        ));
        if private_key.is_empty() {
            return Err(NookError::Decryption(
                "Extension identity handoff was not initialized.".to_owned(),
            )
            .into());
        }
        let recipient = nook_core::DeviceIdentity::from_secret_str(
            &nook_core::DeviceIdentitySecret::parse(&private_key)?,
        )?;
        let material = nook_core::open_extension_identity_handoff(
            &recipient,
            &nook_core::AgeArmoredCiphertext::parse(envelope)?,
            nonce,
            &nook_core::DeviceId::parse(expected_device_id)?,
            &nook_core::DevicePublicKey::parse(expected_device_public_key)?,
            &nook_core::DeviceSigningPublicKey::parse(expected_device_signing_public_key)?,
        )?;
        let (identity, signing_seed) = material.into_parts();

        self.device.identity_private_key.zeroize();
        self.event_log.signing_seed.zeroize();
        self.device.id = identity.device_id().as_str().to_owned();
        self.device.identity_private_key = identity.secret_string().into_inner();
        self.event_log.signing_seed = signing_seed;
        Ok(())
    }

    /// Clear every secret installed by a failed external identity
    /// authorization, including the event-log signing seed.
    #[wasm_bindgen(js_name = rollbackExtensionIdentityHandoff)]
    pub fn rollback_extension_identity_handoff(&mut self) {
        self.lock_device_identity();
        self.reset_vault_session();
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

    /// Return the product device-protection mode persisted during device setup.
    #[wasm_bindgen(js_name = deviceProtectionDeviceMode)]
    pub async fn device_protection_device_mode(&self) -> Result<Option<String>, JsError> {
        Ok(indexed_db::device_identity_device_mode()
            .await?
            .map(str::to_owned))
    }

    #[wasm_bindgen(js_name = beginDeviceProtection)]
    pub async fn begin_device_protection(&mut self) -> Result<NookPasskeySetup, JsError> {
        if self.device.identity_private_key.is_empty()
            && matches!(
                indexed_db::device_identity_protection_status().await?,
                "passkey" | "pin"
            )
        {
            return Err(NookError::Decryption(
                "errors.device_protection.authorization_required".to_owned(),
            )
            .into());
        }

        let setup = nook_core::DeviceKeyProtectionSetup::generate()?;
        Ok(NookPasskeySetup::from_core(&setup))
    }

    #[wasm_bindgen(js_name = setupDeviceProtectionWithPasskey)]
    pub async fn setup_device_protection_with_passkey(
        &mut self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
    ) -> Result<(), JsError> {
        self.setup_device_protection_with_passkey_mode(rp_id, rp_name, passkey_label, "standard")
            .await
    }

    #[wasm_bindgen(js_name = setupDeviceProtectionWithPasskeyMode)]
    pub async fn setup_device_protection_with_passkey_mode(
        &mut self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
        device_mode: &str,
    ) -> Result<(), JsError> {
        let mode = passkey_mode_from_device_mode(device_mode)?;
        let setup = self.begin_device_protection().await?;
        let user_handle = setup.user_handle();
        let prf_input = setup.prf_input();
        let creation_options = passkey_browser::creation_options(
            rp_id,
            rp_name,
            passkey_label,
            &user_handle,
            &prf_input,
        )?;
        let credential = passkey_browser::create_credential(&creation_options).await?;
        let credential_id = passkey_browser::credential_id(&credential)?;
        let create_prf_output = passkey_browser::prf_output(&credential, true)?.map(Zeroizing::new);
        let resolution = nook_core::resolve_passkey_registration_for_mode(
            &credential_id,
            &user_handle,
            &prf_input,
            create_prf_output.as_deref().map(Vec::as_slice),
            mode,
        )?;
        let material = match resolution {
            nook_core::PasskeyRegistrationResolution::Complete(material) => *material,
            nook_core::PasskeyRegistrationResolution::NeedsAssertion(request) => {
                let request_options = passkey_browser::request_options(
                    rp_id,
                    request.credential_id(),
                    request.prf_input(),
                )?;
                let credential = passkey_browser::get_credential(&request_options).await?;
                let prf_output = Zeroizing::new(passkey_browser::require_prf_output(&credential)?);
                nook_core::finish_passkey_device_identity_for_mode(
                    request.credential_id(),
                    &user_handle,
                    request.prf_input(),
                    prf_output.as_slice(),
                    mode,
                )?
            }
        };
        let result = self.save_passkey_material(&material).await;
        let device_id = result?;
        let updated_label =
            passkey_browser::passkey_label_with_device_id(passkey_label, &device_id);
        passkey_browser::signal_current_user_details(rp_id, &user_handle, &updated_label).await;
        Ok(())
    }

    #[wasm_bindgen(js_name = finishDeviceProtection)]
    pub async fn finish_device_protection(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        prf_input: Vec<u8>,
        prf_output: Vec<u8>,
    ) -> Result<(), JsError> {
        self.finish_device_protection_with_mode(
            credential_id,
            user_handle,
            prf_input,
            prf_output,
            "standard".to_owned(),
        )
        .await
    }

    #[wasm_bindgen(js_name = finishDeviceProtectionWithMode)]
    pub async fn finish_device_protection_with_mode(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        prf_input: Vec<u8>,
        mut prf_output: Vec<u8>,
        device_mode: String,
    ) -> Result<(), JsError> {
        let mode = passkey_mode_from_device_mode(&device_mode)?;
        let result = async {
            let material = nook_core::finish_passkey_device_identity_for_mode(
                &credential_id,
                &user_handle,
                &prf_input,
                &prf_output,
                mode,
            )?;
            self.save_passkey_material(&material).await
        }
        .await;
        prf_output.zeroize();
        result.map(|_| ()).map_err(Into::into)
    }

    #[wasm_bindgen(js_name = recoverDeviceProtectionWithPasskey)]
    pub async fn recover_device_protection_with_passkey(
        &mut self,
        rp_id: &str,
    ) -> Result<(), JsError> {
        let request_options = passkey_browser::recovery_options(rp_id)?;
        let credential = passkey_browser::get_credential(&request_options).await?;
        let credential_id = passkey_browser::credential_id(&credential)?;
        let user_handle = passkey_browser::assertion_user_handle(&credential)?;
        let prf_output = passkey_browser::require_prf_output(&credential)?;
        self.recover_device_protection_with_passkey_material(credential_id, user_handle, prf_output)
            .await
    }

    #[wasm_bindgen(js_name = recoverDeviceProtectionWithPasskeyMaterial)]
    pub async fn recover_device_protection_with_passkey_material(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        mut prf_output: Vec<u8>,
    ) -> Result<(), JsError> {
        let result = async {
            let material = nook_core::recover_passkey_device_identity(
                &credential_id,
                &user_handle,
                &prf_output,
            )?;
            self.save_passkey_material(&material).await
        }
        .await;
        prf_output.zeroize();
        result.map(|_| ()).map_err(Into::into)
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

    #[wasm_bindgen(js_name = unlockDeviceProtectionWithPasskey)]
    pub async fn unlock_device_protection_with_passkey(
        &mut self,
        rp_id: &str,
    ) -> Result<(), JsError> {
        let options = self.passkey_unlock_options().await?;
        let request_options = options.request_options(rp_id)?;
        let credential = passkey_browser::get_credential(&request_options).await?;
        let prf_output = passkey_browser::require_prf_output(&credential)?;
        self.unlock_device_identity(prf_output).await
    }

    #[wasm_bindgen(js_name = unlockDeviceIdentity)]
    pub async fn unlock_device_identity(&mut self, mut prf_output: Vec<u8>) -> Result<(), JsError> {
        let result: Result<(), NookError> = async {
            let (stored_device_id, record) = indexed_db::load_wrapped_device_identity()
                .await?
                .ok_or_else(|| {
                    NookError::IndexedDb("No passkey-protected device identity found.".to_owned())
                })?;
            let secret =
                nook_core::unlock_passkey_device_identity(&stored_device_id, &record, &prf_output)?;
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
        self.device.extension_handoff_private_key.zeroize();
        self.device.id.clear();
        self.storage.access_token.zeroize();
        self.storage.remote_ref.clear();
        self.storage.remote_path.clear();
        self.storage.drive_event_parent = nook_core::DriveEventParent::AppDataFolder;
        self.storage.mode = nook_core::StorageMode::Local;
        indexed_db::delete_device_identity_for_recovery().await?;
        auth_providers::delete_auth_providers_db().await?;
        Ok(())
    }
}

fn passkey_mode_from_device_mode(
    device_mode: &str,
) -> Result<nook_core::PasskeyDeviceProtectionMode, JsError> {
    match nook_core::DeviceMode::parse(device_mode)
        .map_err(|error| JsError::new(&error.to_string()))?
    {
        nook_core::DeviceMode::Standard => Ok(nook_core::PasskeyDeviceProtectionMode::Standard),
        nook_core::DeviceMode::AntiHacker => Ok(nook_core::PasskeyDeviceProtectionMode::AntiHacker),
    }
}

impl NookVaultManager {
    pub(in crate::manager) async fn save_passkey_material(
        &mut self,
        material: &nook_core::PasskeyDeviceIdentityMaterial,
    ) -> Result<String, NookError> {
        indexed_db::save_wrapped_device_identity(material.device_id(), material.record()).await?;
        self.device.id = material.device_id().to_owned();
        self.device.identity_private_key = material.identity_secret().clone().into_inner();
        Ok(self.device.id.clone())
    }
}
