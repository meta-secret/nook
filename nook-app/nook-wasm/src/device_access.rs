//! Read-only dashboard projection for browser device and vault access metadata.

use wasm_bindgen::prelude::wasm_bindgen;

use crate::storage::{device_access, indexed_db};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookDeviceAccessTextKind {
    Unknown,
    Known,
}

#[derive(Clone)]
enum NookDeviceAccessTextValue {
    Unknown,
    Known(String),
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDeviceAccessText(NookDeviceAccessTextValue);

impl NookDeviceAccessText {
    fn from_string(value: String) -> Self {
        if value.is_empty() {
            Self(NookDeviceAccessTextValue::Unknown)
        } else {
            Self(NookDeviceAccessTextValue::Known(value))
        }
    }

    fn from_option(value: Option<String>) -> Self {
        value.map_or_else(
            || Self(NookDeviceAccessTextValue::Unknown),
            Self::from_string,
        )
    }
}

#[wasm_bindgen]
impl NookDeviceAccessText {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> NookDeviceAccessTextKind {
        match self.0 {
            NookDeviceAccessTextValue::Unknown => NookDeviceAccessTextKind::Unknown,
            NookDeviceAccessTextValue::Known(_) => NookDeviceAccessTextKind::Known,
        }
    }

    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            NookDeviceAccessTextValue::Unknown => {
                Err(wasm_bindgen::JsError::new("Device access value is unknown"))
            }
            NookDeviceAccessTextValue::Known(value) => Ok(value.clone()),
        }
    }
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
    last_local_update_at: NookDeviceAccessText,
    verified_at: NookDeviceAccessText,
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
        match self.verified_at.kind() {
            NookDeviceAccessTextKind::Unknown => NookDeviceVaultAccessState::Unknown,
            NookDeviceAccessTextKind::Known => NookDeviceVaultAccessState::Verified,
        }
    }

    #[wasm_bindgen(getter, js_name = verifiedAt)]
    pub fn verified_at(&self) -> NookDeviceAccessText {
        self.verified_at.clone()
    }

    #[wasm_bindgen(getter, js_name = lastLocalUpdateAt)]
    pub fn last_local_update_at(&self) -> NookDeviceAccessText {
        self.last_local_update_at.clone()
    }
}

#[wasm_bindgen]
pub struct NookDeviceAccessSnapshot {
    protection: nook_core::DeviceAccessProtectionKind,
    identity_state: nook_core::DeviceAccessIdentityState,
    device_id: NookDeviceAccessText,
    credential_id: NookDeviceAccessText,
    user_handle_id: NookDeviceAccessText,
    passkey_name: NookDeviceAccessText,
    provider_label: NookDeviceAccessText,
    created_at: NookDeviceAccessText,
    last_used_at: NookDeviceAccessText,
    attachment: NookPasskeyAttachmentState,
    transports: NookDeviceAccessText,
    backup_state: NookPasskeyBackupState,
    aaguid: NookDeviceAccessText,
    observed_browser: nook_core::PasskeyObservedBrowser,
    observed_platform: nook_core::PasskeyObservedPlatform,
    vaults: Vec<NookDeviceVaultAccess>,
}

#[wasm_bindgen]
impl NookDeviceAccessSnapshot {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn protection(&self) -> nook_core::DeviceAccessProtectionKind {
        self.protection
    }

    #[wasm_bindgen(getter, js_name = identityState)]
    #[must_use]
    pub fn identity_state(&self) -> nook_core::DeviceAccessIdentityState {
        self.identity_state
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> NookDeviceAccessText {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> NookDeviceAccessText {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = userHandleId)]
    pub fn user_handle_id(&self) -> NookDeviceAccessText {
        self.user_handle_id.clone()
    }

    #[wasm_bindgen(getter, js_name = passkeyName)]
    pub fn passkey_name(&self) -> NookDeviceAccessText {
        self.passkey_name.clone()
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> NookDeviceAccessText {
        self.provider_label.clone()
    }

    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> NookDeviceAccessText {
        self.created_at.clone()
    }

    #[wasm_bindgen(getter, js_name = lastUsedAt)]
    pub fn last_used_at(&self) -> NookDeviceAccessText {
        self.last_used_at.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn attachment(&self) -> NookPasskeyAttachmentState {
        self.attachment
    }

    #[wasm_bindgen(getter)]
    pub fn transports(&self) -> NookDeviceAccessText {
        self.transports.clone()
    }

    #[wasm_bindgen(getter, js_name = backupState)]
    #[must_use]
    pub fn backup_state(&self) -> NookPasskeyBackupState {
        self.backup_state
    }

    #[wasm_bindgen(getter)]
    pub fn aaguid(&self) -> NookDeviceAccessText {
        self.aaguid.clone()
    }

    #[wasm_bindgen(getter, js_name = observedBrowser)]
    #[must_use]
    pub fn observed_browser(&self) -> nook_core::PasskeyObservedBrowser {
        self.observed_browser
    }

    #[wasm_bindgen(getter, js_name = observedPlatform)]
    #[must_use]
    pub fn observed_platform(&self) -> nook_core::PasskeyObservedPlatform {
        self.observed_platform
    }

    #[wasm_bindgen(js_name = vaults)]
    pub fn vaults(&self) -> Vec<NookDeviceVaultAccess> {
        self.vaults.clone()
    }
}

#[wasm_bindgen(js_name = deviceAccessSnapshot)]
pub async fn device_access_snapshot(
    session_device_id: String,
) -> Result<NookDeviceAccessSnapshot, wasm_bindgen::JsError> {
    let protected = indexed_db::load_wrapped_device_identity().await?;
    let session_device_id = session_device_id.trim();
    let identity_state = nook_core::classify_device_access_identity_state(
        session_device_id,
        protected.as_ref().map(|(device_id, _)| device_id.as_str()),
    );
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
            .map(|access| access.verified_at.to_string());
        vaults.push(NookDeviceVaultAccess {
            store_id: entry.store_id,
            label: entry.label,
            last_local_update_at: NookDeviceAccessText::from_option(
                entry
                    .last_unlocked_at
                    .map(|timestamp| timestamp.to_string()),
            ),
            verified_at: NookDeviceAccessText::from_option(verified_at),
        });
    }
    vaults.sort_by(|left, right| left.label.cmp(&right.label));

    Ok(NookDeviceAccessSnapshot {
        protection,
        identity_state,
        device_id: NookDeviceAccessText::from_string(device_id),
        credential_id: NookDeviceAccessText::from_string(credential_id),
        user_handle_id: NookDeviceAccessText::from_string(user_handle_id),
        passkey_name: NookDeviceAccessText::from_string(passkey.nook_name),
        provider_label: NookDeviceAccessText::from_string(passkey.provider_label),
        created_at: NookDeviceAccessText::from_option(
            passkey.created_at.map(|value| value.to_string()),
        ),
        last_used_at: NookDeviceAccessText::from_option(
            passkey.last_used_at.map(|value| value.to_string()),
        ),
        attachment: attachment_state(passkey.observation.attachment),
        transports: NookDeviceAccessText::from_string(passkey.observation.transports.join(", ")),
        backup_state: backup_state(passkey.observation.backup_state),
        aaguid: NookDeviceAccessText::from_option(passkey.observation.aaguid),
        observed_browser: passkey.observation.browser,
        observed_platform: passkey.observation.platform,
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
