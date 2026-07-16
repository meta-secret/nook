//! Passkey-PRF setup, unlock, and recovery orchestration.

use super::NookVaultManager;
use crate::passkey_browser;
use crate::storage::{auth_providers, indexed_db};
use crate::{NookError, NookExtensionIdentityHandoff, NookPasskeySetup, NookPasskeyUnlockOptions};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::{Zeroize, Zeroizing};

fn ensure_extension_identity_handoff_source(
    application: nook_core::VaultApplication,
) -> Result<(), NookError> {
    if application == nook_core::VaultApplication::Extension {
        return Ok(());
    }
    Err(NookError::Database(
        "Extension device identity handoff requires the extension application capability."
            .to_owned(),
    ))
}

pub(in crate::manager) fn ensure_extension_identity_handoff_target(
    application: nook_core::VaultApplication,
) -> Result<(), NookError> {
    if application == nook_core::VaultApplication::Simple
        || application == nook_core::VaultApplication::UnifiedDevelopment
    {
        return Ok(());
    }
    Err(NookError::Database(
        "Extension device identity handoff requires the Simple Vault application capability."
            .to_owned(),
    ))
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Require passkey authorization again before any device-key operation.
    #[wasm_bindgen(js_name = lockDeviceIdentity)]
    pub fn lock_device_identity(&mut self) {
        self.device.identity_private_key.zeroize();
        self.event_log.signing_seed.zeroize();
        self.extension_identity_handoff_active = false;
    }

    /// Export the unlocked extension identity for a single in-memory handoff to
    /// the paired Simple Vault page. The caller must keep this value out of
    /// durable browser storage and URLs.
    #[wasm_bindgen(js_name = exportExtensionDeviceIdentityForHandoff)]
    pub async fn export_extension_device_identity_for_handoff(
        &mut self,
    ) -> Result<NookExtensionIdentityHandoff, JsError> {
        ensure_extension_identity_handoff_source(self.application)?;
        let identity_secret = self.device_identity()?.secret_string().into_inner();
        self.ensure_signing_identity().await?;
        Ok(NookExtensionIdentityHandoff::new(
            identity_secret,
            self.event_log.signing_seed.clone(),
        ))
    }

    /// Adopt the extension's already-unlocked identity for this in-memory
    /// Simple Vault session. This intentionally does not write the identity to
    /// the site's `IndexedDB`: it remains owned by the extension and is cleared
    /// by the ordinary session lock path.
    #[wasm_bindgen(js_name = adoptExtensionDeviceIdentityForHandoff)]
    pub fn adopt_extension_device_identity_for_handoff(
        &mut self,
        mut identity_secret: String,
        mut signing_seed: String,
    ) -> Result<(), JsError> {
        if let Err(error) = ensure_extension_identity_handoff_target(self.application) {
            identity_secret.zeroize();
            signing_seed.zeroize();
            return Err(error.into());
        }
        let result = (|| -> Result<(String, String, String), JsError> {
            let identity = nook_core::DeviceIdentity::from_secret_str(
                &nook_core::DeviceIdentitySecret::parse(&identity_secret)?,
            )?;
            nook_core::SigningIdentity::from_seed_hex_stored(&signing_seed)?;
            Ok((
                identity.device_id().to_string(),
                identity_secret.clone(),
                signing_seed.clone(),
            ))
        })();
        identity_secret.zeroize();
        signing_seed.zeroize();
        let (device_id, private_key, signing_seed) = result?;
        self.device.identity_private_key.zeroize();
        self.event_log.signing_seed.zeroize();
        self.device.id = device_id;
        self.device.identity_private_key = private_key;
        self.event_log.signing_seed = signing_seed;
        self.extension_identity_handoff_active = true;
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::{NookVaultManager, ensure_extension_identity_handoff_target};

    #[test]
    fn extension_identity_handoff_is_memory_only_and_simple_only() {
        let identity = nook_core::DeviceIdentity::generate().expect("identity");
        let mut extension = NookVaultManager::new();
        extension.application = nook_core::VaultApplication::Extension;
        extension.device.id = identity.device_id().to_string();
        extension.device.identity_private_key = identity.secret_string().into_inner();

        let (_, signing_seed) = nook_core::SigningIdentity::generate().expect("signing identity");
        let handoff = identity.secret_string().into_inner();

        let mut simple = NookVaultManager::new();
        simple.application = nook_core::VaultApplication::Simple;
        simple
            .adopt_extension_device_identity_for_handoff(handoff, signing_seed.as_str().to_owned())
            .expect("simple accepts handoff");
        assert_eq!(simple.device.id, identity.device_id().as_str());
        assert_eq!(
            simple.device_identity().expect("identity").public_key(),
            identity.public_key()
        );
        assert_eq!(simple.event_log.signing_seed, signing_seed.as_str());
        assert!(!simple.auth_provider_persistence_allowed());

        simple.lock_device_identity();
        assert!(simple.device.identity_private_key.is_empty());
        assert!(simple.event_log.signing_seed.is_empty());
        assert!(simple.auth_provider_persistence_allowed());

        let mut sentinel = NookVaultManager::new();
        sentinel.application = nook_core::VaultApplication::Sentinel;
        assert!(ensure_extension_identity_handoff_target(sentinel.application).is_err());
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
