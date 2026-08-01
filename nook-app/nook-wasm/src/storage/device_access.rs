//! Non-secret, versioned metadata for the Devices & access dashboard.
//!
//! This companion record is deliberately separate from `device_identity_wrapped`.
//! Corrupt or future descriptive metadata must never block device-key unlock.

use serde::{Deserialize, Serialize};

use crate::NookError;

use super::indexed_db::{idb_delete_key, idb_get_string, idb_put_string};

const DEVICE_ACCESS_PROFILE_KEY: &str = "device_access_profile";
const DEVICE_ACCESS_PROFILE_VERSION: u32 = 1;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PasskeyBrowserObservation {
    pub attachment: nook_core::PasskeyAuthenticatorAttachment,
    pub transports: Vec<String>,
    pub backup_state: nook_core::PasskeyBackupState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aaguid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_environment: Option<String>,
}

impl PasskeyBrowserObservation {
    pub(crate) fn merge_usage(&mut self, usage: Self) {
        if self.attachment == nook_core::PasskeyAuthenticatorAttachment::Unknown {
            self.attachment = usage.attachment;
        }
        if self.transports.is_empty() {
            self.transports = usage.transports;
        }
        if usage.backup_state != nook_core::PasskeyBackupState::Unknown {
            self.backup_state = usage.backup_state;
        }
        if self.aaguid.is_none() {
            self.aaguid = usage.aaguid;
        }
        if usage.client_environment.is_some() {
            self.client_environment = usage.client_environment;
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PasskeyAccessProfile {
    #[serde(default)]
    pub nook_name: String,
    #[serde(default)]
    pub provider_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<nook_core::IsoTimestamp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<nook_core::IsoTimestamp>,
    #[serde(default)]
    pub observation: PasskeyBrowserObservation,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedVaultAccess {
    #[serde(default)]
    pub device_id: String,
    pub store_id: String,
    pub verified_at: nook_core::IsoTimestamp,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceAccessProfile {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passkey: Option<PasskeyAccessProfile>,
    #[serde(default)]
    pub verified_vaults: Vec<VerifiedVaultAccess>,
}

impl Default for DeviceAccessProfile {
    fn default() -> Self {
        Self {
            version: DEVICE_ACCESS_PROFILE_VERSION,
            passkey: None,
            verified_vaults: Vec::new(),
        }
    }
}

pub(crate) async fn load_device_access_profile() -> Result<DeviceAccessProfile, NookError> {
    let Some(raw) = idb_get_string(DEVICE_ACCESS_PROFILE_KEY).await? else {
        return Ok(DeviceAccessProfile::default());
    };
    let profile: DeviceAccessProfile = serde_json::from_str(&raw).map_err(|error| {
        NookError::IndexedDb(format!("Device access profile parse error: {error}"))
    })?;
    if profile.version != DEVICE_ACCESS_PROFILE_VERSION {
        return Err(NookError::IndexedDb(format!(
            "Unsupported device access profile version: {}",
            profile.version
        )));
    }
    Ok(profile)
}

async fn save_device_access_profile(profile: &DeviceAccessProfile) -> Result<(), NookError> {
    let json = serde_json::to_string(profile).map_err(|error| {
        NookError::IndexedDb(format!("Device access profile serialize error: {error}"))
    })?;
    idb_put_string(DEVICE_ACCESS_PROFILE_KEY, &json).await
}

pub(crate) async fn record_passkey_created(
    nook_name: &str,
    observation: PasskeyBrowserObservation,
) -> Result<(), NookError> {
    let now = browser_timestamp();
    let mut profile = load_device_access_profile().await.unwrap_or_default();
    let provider_label = profile
        .passkey
        .as_ref()
        .map_or_else(String::new, |passkey| passkey.provider_label.clone());
    profile.passkey = Some(PasskeyAccessProfile {
        nook_name: nook_name.trim().to_owned(),
        provider_label,
        created_at: Some(now.clone()),
        last_used_at: Some(now),
        observation,
    });
    save_device_access_profile(&profile).await
}

pub(crate) async fn record_passkey_used(
    observation: PasskeyBrowserObservation,
) -> Result<(), NookError> {
    let mut profile = load_device_access_profile().await.unwrap_or_default();
    let passkey = profile
        .passkey
        .get_or_insert_with(PasskeyAccessProfile::default);
    passkey.last_used_at = Some(browser_timestamp());
    passkey.observation.merge_usage(observation);
    save_device_access_profile(&profile).await
}

pub(crate) async fn set_passkey_provider_label(label: &str) -> Result<(), NookError> {
    let normalized = nook_core::normalize_device_access_provider_label(label)
        .map_err(|error| NookError::Database(error.to_string()))?;
    let mut profile = load_device_access_profile().await.unwrap_or_default();
    let passkey = profile
        .passkey
        .get_or_insert_with(PasskeyAccessProfile::default);
    passkey.provider_label = normalized;
    save_device_access_profile(&profile).await
}

pub(crate) async fn record_verified_vault_access(
    device_id: &str,
    store_id: &str,
) -> Result<(), NookError> {
    if device_id.trim().is_empty() || store_id.trim().is_empty() {
        return Ok(());
    }
    let mut profile = load_device_access_profile().await.unwrap_or_default();
    profile
        .verified_vaults
        .retain(|entry| entry.device_id != device_id || entry.store_id != store_id);
    profile.verified_vaults.push(VerifiedVaultAccess {
        device_id: device_id.to_owned(),
        store_id: store_id.to_owned(),
        verified_at: browser_timestamp(),
    });
    save_device_access_profile(&profile).await
}

pub(crate) async fn delete_device_access_profile() -> Result<(), NookError> {
    idb_delete_key(DEVICE_ACCESS_PROFILE_KEY).await
}

fn browser_timestamp() -> nook_core::IsoTimestamp {
    nook_core::IsoTimestamp::from_trusted(js_sys::Date::new_0().to_iso_string().into())
}
