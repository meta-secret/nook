//! Local device-protection persistence and destructive recovery.

use super::NookVaultManager;
use crate::NookError;
use crate::storage::{auth_providers, indexed_db};
use nook_core::{AppId, DeviceIdentity, DeviceProtectionStatus, DriveEventParent, StorageMode};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

#[wasm_bindgen]
impl NookVaultManager {
    /// Resolve the persisted app identity targeted by locked local recovery.
    #[wasm_bindgen]
    pub async fn local_identity_recovery_app_id(&self) -> Result<String, JsError> {
        self.load_protected_local_identity()
            .await?
            .map(|(app_id, _)| app_id)
            .ok_or_else(|| JsError::new("No protected local identity found for recovery."))
    }

    /// Zeroize this tab before another tab performs destructive local recovery.
    #[wasm_bindgen]
    pub fn quiesce_for_local_recovery(&mut self) {
        self.reset_vault_session();
        self.device.identity_private_key.zeroize();
        self.device.extension_handoff_private_key.zeroize();
        self.device.id.clear();
        self.storage.access_token.zeroize();
        self.storage.remote_ref.clear();
        self.storage.remote_path.clear();
        self.storage.drive_event_parent = DriveEventParent::AppDataFolder;
        self.storage.mode = StorageMode::Local;
    }

    /// Destructive local recovery: forget the inaccessible identity and its
    /// identity-sealed provider credentials, preserving local encrypted vaults.
    #[wasm_bindgen]
    pub async fn reset_device_protection_for_recovery(
        &mut self,
        expected_app_id: &str,
    ) -> Result<(), JsError> {
        let expected_app_id = if expected_app_id.trim().is_empty() {
            AppId::parse(&self.device.public_app_id()).ok()
        } else {
            Some(AppId::parse(expected_app_id)?)
        };
        self.quiesce_for_local_recovery();
        let recovery = indexed_db::delete_device_identity_for_recovery(expected_app_id).await?;
        if recovery.has_remaining_local_identities {
            if let Some(app_id) = recovery.retired_app_id.as_ref() {
                auth_providers::delete_auth_providers_for_app_id(app_id).await?;
            }
        } else {
            auth_providers::delete_auth_providers_db().await?;
        }
        recovery.complete().await?;
        Ok(())
    }
}

impl NookVaultManager {
    pub(super) async fn load_protected_local_identity(
        &self,
    ) -> Result<Option<(String, nook_core::WrappedDeviceIdentity)>, NookError> {
        let session_app_id = self.device.public_app_id();
        if session_app_id.is_empty() {
            indexed_db::load_wrapped_device_identity().await
        } else {
            indexed_db::load_wrapped_device_identity_for_app_id(&session_app_id).await
        }
    }

    pub(super) async fn persisted_device_protection_status(
        &self,
    ) -> Result<nook_core::DeviceProtectionStatus, NookError> {
        let Some((_, wrapped)) = self.load_protected_local_identity().await? else {
            return Ok(DeviceProtectionStatus::Missing);
        };
        DeviceProtectionStatus::from_persisted(wrapped.protection_mode()).ok_or_else(|| {
            NookError::IndexedDb(format!(
                "Unsupported persisted device-protection status: {}",
                wrapped.protection_mode()
            ))
        })
    }

    pub(super) fn clear_failed_device_protection(&mut self) {
        self.device.id.clear();
        self.lock_device_identity();
    }

    pub(super) async fn save_passkey_material(
        &mut self,
        material: &nook_core::PasskeyDeviceIdentityMaterial,
    ) -> Result<String, NookError> {
        let identity = DeviceIdentity::from_secret_str(material.identity_secret())?;
        self.persist_and_adopt_local_identity(identity, material.record())
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::super::{PendingExtensionIdentityEnrollment, PendingExtensionIdentityHandoff};
    use super::*;
    use nook_core::{SigningIdentity, StorageMode};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn handoff_projection_and_quiesce_clear_sensitive_session_state() -> Result<(), NookError> {
        let (signing, signing_seed) = SigningIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        assert!(!manager.extension_identity_handoff_requires_connect());
        manager.device.pending_extension_handoff = Some(PendingExtensionIdentityHandoff {
            enrollment: PendingExtensionIdentityEnrollment::VaultCreation { authorizer: None },
            authorizer_signing: None,
            signing_public_key: signing.public_key(),
            handoff_signing_seed: signing_seed.as_str().to_owned(),
            persist_signing_seed: false,
            previous_session_signing_seed: "previous-seed".to_owned(),
        });
        assert!(manager.extension_identity_handoff_requires_connect());
        manager.confirm_extension_identity_handoff();
        assert!(!manager.extension_identity_handoff_requires_connect());

        manager.device.id = "device-id".to_owned();
        manager.device.identity_private_key = "private-key".to_owned();
        manager.device.extension_handoff_private_key = "handoff-key".to_owned();
        manager.event_log.signing_seed = "signing-seed".to_owned();
        manager.storage.access_token = "provider-token".to_owned();
        manager.storage.remote_ref = "owner/repo".to_owned();
        manager.storage.remote_path = "vault.yaml".to_owned();
        manager.storage.mode = StorageMode::Github;

        manager.quiesce_for_local_recovery();

        assert!(manager.device.id.is_empty());
        assert!(manager.device.identity_private_key.is_empty());
        assert!(manager.device.extension_handoff_private_key.is_empty());
        assert!(manager.event_log.signing_seed.is_empty());
        assert!(manager.storage.access_token.is_empty());
        assert!(manager.storage.remote_ref.is_empty());
        assert!(manager.storage.remote_path.is_empty());
        assert_eq!(manager.storage.mode, StorageMode::Local);
        Ok(())
    }
}
