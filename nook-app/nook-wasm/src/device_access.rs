//! Read-only dashboard projection for browser device and vault access metadata.

use wasm_bindgen::prelude::wasm_bindgen;

use crate::storage::{device_access, indexed_db};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookDeviceAccessValueState {
    Unknown,
    Known,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookDeviceVaultAccessState {
    Unknown,
    Verified,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookPasskeyAttachmentState {
    Unknown,
    Platform,
    CrossPlatform,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookPasskeyBackupState {
    Unknown,
    NotEligible,
    Eligible,
    BackedUp,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDeviceVaultAccess {
    store_id: String,
    label: String,
    last_unlocked_at: String,
    verified_at: String,
}

#[wasm_bindgen]
impl NookDeviceVaultAccess {
    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = accessState)]
    #[must_use]
    pub fn access_state(&self) -> NookDeviceVaultAccessState {
        if self.verified_at.is_empty() {
            NookDeviceVaultAccessState::Unknown
        } else {
            NookDeviceVaultAccessState::Verified
        }
    }

    #[wasm_bindgen(getter, js_name = verifiedAt)]
    pub fn verified_at(&self) -> String {
        self.verified_at.clone()
    }

    #[wasm_bindgen(getter, js_name = lastUnlockedState)]
    #[must_use]
    pub fn last_unlocked_state(&self) -> NookDeviceAccessValueState {
        value_state(&self.last_unlocked_at)
    }

    #[wasm_bindgen(getter, js_name = lastUnlockedAt)]
    pub fn last_unlocked_at(&self) -> String {
        self.last_unlocked_at.clone()
    }
}

#[wasm_bindgen]
pub struct NookDeviceAccessSnapshot {
    protection: nook_core::DeviceAccessProtectionKind,
    device_id: String,
    credential_id: String,
    user_handle_id: String,
    passkey_name: String,
    provider_label: String,
    created_at: String,
    last_used_at: String,
    attachment: NookPasskeyAttachmentState,
    transports: String,
    backup_state: NookPasskeyBackupState,
    aaguid: String,
    client_environment: String,
    vaults: Vec<NookDeviceVaultAccess>,
}

#[wasm_bindgen]
impl NookDeviceAccessSnapshot {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn protection(&self) -> nook_core::DeviceAccessProtectionKind {
        self.protection
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> String {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = userHandleId)]
    pub fn user_handle_id(&self) -> String {
        self.user_handle_id.clone()
    }

    #[wasm_bindgen(getter, js_name = passkeyName)]
    pub fn passkey_name(&self) -> String {
        self.passkey_name.clone()
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> String {
        self.provider_label.clone()
    }

    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> String {
        self.created_at.clone()
    }

    #[wasm_bindgen(getter, js_name = lastUsedAt)]
    pub fn last_used_at(&self) -> String {
        self.last_used_at.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn attachment(&self) -> NookPasskeyAttachmentState {
        self.attachment
    }

    #[wasm_bindgen(getter)]
    pub fn transports(&self) -> String {
        self.transports.clone()
    }

    #[wasm_bindgen(getter, js_name = backupState)]
    #[must_use]
    pub fn backup_state(&self) -> NookPasskeyBackupState {
        self.backup_state
    }

    #[wasm_bindgen(getter)]
    pub fn aaguid(&self) -> String {
        self.aaguid.clone()
    }

    #[wasm_bindgen(getter, js_name = clientEnvironment)]
    pub fn client_environment(&self) -> String {
        self.client_environment.clone()
    }

    #[wasm_bindgen(js_name = vaults)]
    pub fn vaults(&self) -> Vec<NookDeviceVaultAccess> {
        self.vaults.clone()
    }

    #[wasm_bindgen(js_name = passkeyNameState)]
    #[must_use]
    pub fn passkey_name_state(&self) -> NookDeviceAccessValueState {
        value_state(&self.passkey_name)
    }

    #[wasm_bindgen(js_name = providerLabelState)]
    #[must_use]
    pub fn provider_label_state(&self) -> NookDeviceAccessValueState {
        value_state(&self.provider_label)
    }

    #[wasm_bindgen(js_name = createdAtState)]
    #[must_use]
    pub fn created_at_state(&self) -> NookDeviceAccessValueState {
        value_state(&self.created_at)
    }

    #[wasm_bindgen(js_name = lastUsedAtState)]
    #[must_use]
    pub fn last_used_at_state(&self) -> NookDeviceAccessValueState {
        value_state(&self.last_used_at)
    }

    #[wasm_bindgen(js_name = aaguidState)]
    #[must_use]
    pub fn aaguid_state(&self) -> NookDeviceAccessValueState {
        value_state(&self.aaguid)
    }

    #[wasm_bindgen(js_name = clientEnvironmentState)]
    #[must_use]
    pub fn client_environment_state(&self) -> NookDeviceAccessValueState {
        value_state(&self.client_environment)
    }
}

#[wasm_bindgen(js_name = deviceAccessSnapshot)]
pub async fn device_access_snapshot(
    session_device_id: String,
) -> Result<NookDeviceAccessSnapshot, wasm_bindgen::JsError> {
    let protected = indexed_db::load_wrapped_device_identity().await?;
    let session_device_id = session_device_id.trim();
    let session_uses_companion = !session_device_id.is_empty()
        && protected
            .as_ref()
            .is_none_or(|(persisted_device_id, _)| persisted_device_id != session_device_id);
    let protection = if session_uses_companion {
        nook_core::DeviceAccessProtectionKind::CompanionSession
    } else {
        nook_core::classify_device_access_protection(protected.as_ref().map(|(_, record)| record))
    };
    let (device_id, credential_id, user_handle_id) = if session_uses_companion {
        (session_device_id.to_owned(), String::new(), String::new())
    } else {
        match &protected {
            Some((device_id, record)) => {
                let credential_id = record
                    .credential_id_bytes()
                    .map(|bytes| nook_core::passkey_credential_identifier(&bytes))
                    .unwrap_or_default();
                let user_handle_id = record
                    .user_handle_bytes()
                    .map(|bytes| nook_core::passkey_user_handle_identifier(&bytes))
                    .unwrap_or_default();
                (device_id.clone(), credential_id, user_handle_id)
            }
            None => (String::new(), String::new(), String::new()),
        }
    };
    let profile = device_access::load_device_access_profile()
        .await
        .unwrap_or_default();
    let passkey = if session_uses_companion {
        device_access::PasskeyAccessProfile::default()
    } else {
        profile.passkey.unwrap_or_default()
    };
    let mut vaults = Vec::new();
    for entry in indexed_db::list_vault_registry_entries().await? {
        let verified_at = profile
            .verified_vaults
            .iter()
            .find(|access| access.device_id == device_id && access.store_id == entry.store_id)
            .map_or_else(String::new, |access| access.verified_at.to_string());
        vaults.push(NookDeviceVaultAccess {
            store_id: entry.store_id,
            label: entry.label,
            last_unlocked_at: entry
                .last_unlocked_at
                .map_or_else(String::new, |timestamp| timestamp.to_string()),
            verified_at,
        });
    }
    vaults.sort_by(|left, right| left.label.cmp(&right.label));

    Ok(NookDeviceAccessSnapshot {
        protection,
        device_id,
        credential_id,
        user_handle_id,
        passkey_name: passkey.nook_name,
        provider_label: passkey.provider_label,
        created_at: passkey
            .created_at
            .map_or_else(String::new, |value| value.to_string()),
        last_used_at: passkey
            .last_used_at
            .map_or_else(String::new, |value| value.to_string()),
        attachment: attachment_state(passkey.observation.attachment),
        transports: passkey.observation.transports.join(", "),
        backup_state: backup_state(passkey.observation.backup_state),
        aaguid: passkey.observation.aaguid.unwrap_or_default(),
        client_environment: passkey.observation.client_environment.unwrap_or_default(),
        vaults,
    })
}

#[wasm_bindgen(js_name = setDeviceAccessPasskeyProviderLabel)]
pub async fn set_device_access_passkey_provider_label(
    label: String,
) -> Result<(), wasm_bindgen::JsError> {
    device_access::set_passkey_provider_label(&label)
        .await
        .map_err(Into::into)
}

fn value_state(value: &str) -> NookDeviceAccessValueState {
    if value.is_empty() {
        NookDeviceAccessValueState::Unknown
    } else {
        NookDeviceAccessValueState::Known
    }
}

fn attachment_state(
    value: nook_core::PasskeyAuthenticatorAttachment,
) -> NookPasskeyAttachmentState {
    match value {
        nook_core::PasskeyAuthenticatorAttachment::Unknown => NookPasskeyAttachmentState::Unknown,
        nook_core::PasskeyAuthenticatorAttachment::Platform => NookPasskeyAttachmentState::Platform,
        nook_core::PasskeyAuthenticatorAttachment::CrossPlatform => {
            NookPasskeyAttachmentState::CrossPlatform
        }
    }
}

fn backup_state(value: nook_core::PasskeyBackupState) -> NookPasskeyBackupState {
    match value {
        nook_core::PasskeyBackupState::Unknown => NookPasskeyBackupState::Unknown,
        nook_core::PasskeyBackupState::NotEligible => NookPasskeyBackupState::NotEligible,
        nook_core::PasskeyBackupState::Eligible => NookPasskeyBackupState::Eligible,
        nook_core::PasskeyBackupState::BackedUp => NookPasskeyBackupState::BackedUp,
    }
}
