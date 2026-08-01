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
    pub transports: Vec<nook_core::PasskeyTransport>,
    pub backup_state: nook_core::PasskeyBackupState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aaguid: Option<String>,
    #[serde(default)]
    pub browser: nook_core::PasskeyObservedBrowser,
    #[serde(default)]
    pub platform: nook_core::PasskeyObservedPlatform,
    // Version 1 persisted an English `clientEnvironment` sentence. Accept and
    // discard it so existing metadata remains readable without leaking English
    // presentation text back into localized UI.
    #[serde(default, alias = "clientEnvironment", skip_serializing)]
    pub(crate) legacy_client_environment: Option<String>,
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
        if usage.browser != nook_core::PasskeyObservedBrowser::Unknown {
            self.browser = usage.browser;
        }
        if usage.platform != nook_core::PasskeyObservedPlatform::Unknown {
            self.platform = usage.platform;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PasskeyCreationCeremony {
    RegistrationOnly,
    RegistrationAndAssertion,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PasskeyAccessProfile {
    #[serde(default)]
    pub credential_fingerprint: String,
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

impl DeviceAccessProfile {
    fn record_passkey_created(
        &mut self,
        credential_fingerprint: &str,
        nook_name: &str,
        observation: PasskeyBrowserObservation,
        now: nook_core::IsoTimestamp,
        ceremony: PasskeyCreationCeremony,
    ) {
        self.passkey = Some(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            nook_name: nook_name.trim().to_owned(),
            // This reminder belongs to one credential. A replacement may be
            // stored by a different provider, so require fresh user evidence.
            provider_label: String::new(),
            created_at: Some(now.clone()),
            last_used_at: match ceremony {
                PasskeyCreationCeremony::RegistrationOnly => None,
                PasskeyCreationCeremony::RegistrationAndAssertion => Some(now),
            },
            observation,
        });
    }

    fn record_passkey_used(
        &mut self,
        credential_fingerprint: &str,
        observation: PasskeyBrowserObservation,
        now: nook_core::IsoTimestamp,
    ) {
        if let Some(passkey) = self
            .passkey
            .as_mut()
            .filter(|passkey| passkey.credential_fingerprint == credential_fingerprint)
        {
            passkey.last_used_at = Some(now);
            passkey.observation.merge_usage(observation);
            return;
        }
        self.passkey = Some(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            last_used_at: Some(now),
            observation,
            ..PasskeyAccessProfile::default()
        });
    }

    fn record_verified_vault_access(
        &mut self,
        device_id: &str,
        store_id: &str,
        now: nook_core::IsoTimestamp,
    ) {
        self.verified_vaults
            .retain(|entry| entry.device_id != device_id || entry.store_id != store_id);
        self.verified_vaults.push(VerifiedVaultAccess {
            device_id: device_id.to_owned(),
            store_id: store_id.to_owned(),
            verified_at: now,
        });
    }
}

#[derive(Debug, PartialEq, Eq)]
enum DecodedDeviceAccessProfile {
    Current(DeviceAccessProfile),
    RecoverableDefault,
    FutureVersion,
}

#[derive(Debug, PartialEq, Eq)]
enum DeviceAccessProfileUpdate {
    Writable(DeviceAccessProfile),
    PreserveFutureVersion,
}

impl DeviceAccessProfileUpdate {
    fn into_interactive_profile(self) -> Result<DeviceAccessProfile, NookError> {
        match self {
            Self::Writable(profile) => Ok(profile),
            Self::PreserveFutureVersion => Err(NookError::Database(
                "errors.device_access.profile_version_incompatible".to_owned(),
            )),
        }
    }
}

#[derive(Deserialize)]
struct DeviceAccessProfileVersion {
    version: u32,
}

fn decode_device_access_profile(raw: &str) -> DecodedDeviceAccessProfile {
    let Ok(version) = serde_json::from_str::<DeviceAccessProfileVersion>(raw) else {
        return DecodedDeviceAccessProfile::RecoverableDefault;
    };
    if version.version > DEVICE_ACCESS_PROFILE_VERSION {
        return DecodedDeviceAccessProfile::FutureVersion;
    }
    if version.version != DEVICE_ACCESS_PROFILE_VERSION {
        return DecodedDeviceAccessProfile::RecoverableDefault;
    }
    serde_json::from_str(raw).map_or(
        DecodedDeviceAccessProfile::RecoverableDefault,
        DecodedDeviceAccessProfile::Current,
    )
}

pub(crate) async fn load_device_access_profile() -> Result<DeviceAccessProfile, NookError> {
    let Some(raw) = idb_get_string(DEVICE_ACCESS_PROFILE_KEY).await? else {
        return Ok(DeviceAccessProfile::default());
    };
    Ok(match decode_device_access_profile(&raw) {
        DecodedDeviceAccessProfile::Current(profile) => profile,
        DecodedDeviceAccessProfile::RecoverableDefault
        | DecodedDeviceAccessProfile::FutureVersion => DeviceAccessProfile::default(),
    })
}

async fn load_device_access_profile_for_update() -> Result<DeviceAccessProfileUpdate, NookError> {
    let Some(raw) = idb_get_string(DEVICE_ACCESS_PROFILE_KEY).await? else {
        return Ok(DeviceAccessProfileUpdate::Writable(
            DeviceAccessProfile::default(),
        ));
    };
    Ok(match decode_device_access_profile(&raw) {
        DecodedDeviceAccessProfile::Current(profile) => {
            DeviceAccessProfileUpdate::Writable(profile)
        }
        DecodedDeviceAccessProfile::RecoverableDefault => {
            DeviceAccessProfileUpdate::Writable(DeviceAccessProfile::default())
        }
        DecodedDeviceAccessProfile::FutureVersion => {
            DeviceAccessProfileUpdate::PreserveFutureVersion
        }
    })
}

async fn save_device_access_profile(profile: &DeviceAccessProfile) -> Result<(), NookError> {
    let json = serde_json::to_string(profile).map_err(|error| {
        NookError::IndexedDb(format!("Device access profile serialize error: {error}"))
    })?;
    idb_put_string(DEVICE_ACCESS_PROFILE_KEY, &json).await
}

pub(crate) async fn record_passkey_created(
    credential_fingerprint: &str,
    nook_name: &str,
    observation: PasskeyBrowserObservation,
    ceremony: PasskeyCreationCeremony,
) -> Result<(), NookError> {
    let now = browser_timestamp();
    let DeviceAccessProfileUpdate::Writable(mut profile) =
        load_device_access_profile_for_update().await?
    else {
        return Ok(());
    };
    profile.record_passkey_created(
        credential_fingerprint,
        nook_name,
        observation,
        now,
        ceremony,
    );
    save_device_access_profile(&profile).await
}

pub(crate) async fn record_passkey_used(
    credential_fingerprint: &str,
    observation: PasskeyBrowserObservation,
) -> Result<(), NookError> {
    let DeviceAccessProfileUpdate::Writable(mut profile) =
        load_device_access_profile_for_update().await?
    else {
        return Ok(());
    };
    profile.record_passkey_used(credential_fingerprint, observation, browser_timestamp());
    save_device_access_profile(&profile).await
}

pub(crate) async fn set_passkey_provider_label(label: &str) -> Result<(), NookError> {
    let normalized = nook_core::normalize_device_access_provider_label(label)
        .map_err(|error| NookError::Database(error.to_string()))?;
    let mut profile = load_device_access_profile_for_update()
        .await?
        .into_interactive_profile()?;
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
    let DeviceAccessProfileUpdate::Writable(mut profile) =
        load_device_access_profile_for_update().await?
    else {
        return Ok(());
    };
    profile.record_verified_vault_access(device_id, store_id, browser_timestamp());
    save_device_access_profile(&profile).await
}

pub(crate) async fn delete_device_access_profile() -> Result<(), NookError> {
    idb_delete_key(DEVICE_ACCESS_PROFILE_KEY).await
}

fn browser_timestamp() -> nook_core::IsoTimestamp {
    nook_core::IsoTimestamp::from_trusted(js_sys::Date::new_0().to_iso_string().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn timestamp(value: &str) -> nook_core::IsoTimestamp {
        nook_core::IsoTimestamp::from_trusted(value.to_owned())
    }

    fn observation() -> PasskeyBrowserObservation {
        PasskeyBrowserObservation {
            attachment: nook_core::PasskeyAuthenticatorAttachment::Platform,
            transports: vec![nook_core::PasskeyTransport::Internal],
            backup_state: nook_core::PasskeyBackupState::Eligible,
            aaguid: Some("aaguid-one".to_owned()),
            browser: nook_core::PasskeyObservedBrowser::Safari,
            platform: nook_core::PasskeyObservedPlatform::MacOs,
            legacy_client_environment: None,
        }
    }

    #[test]
    fn corrupt_and_future_profiles_degrade_to_empty_metadata() {
        assert_eq!(
            decode_device_access_profile("not-json"),
            DecodedDeviceAccessProfile::RecoverableDefault
        );
        assert_eq!(
            decode_device_access_profile(r#"{"version":999,"verifiedVaults":[]}"#),
            DecodedDeviceAccessProfile::FutureVersion
        );
    }

    #[test]
    fn future_profiles_reject_interactive_updates() {
        assert!(
            DeviceAccessProfileUpdate::PreserveFutureVersion
                .into_interactive_profile()
                .is_err()
        );
    }

    #[test]
    fn passkey_creation_replaces_credential_metadata_and_usage_merges_observations()
    -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:first",
            "First credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        assert_eq!(
            profile
                .passkey
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("created passkey profile is missing"))?
                .last_used_at,
            None
        );
        profile
            .passkey
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("created passkey profile is missing"))?
            .provider_label = "Bitwarden".to_owned();

        let mut replacement = observation();
        replacement.aaguid = Some("aaguid-two".to_owned());
        replacement.transports = vec![nook_core::PasskeyTransport::Hybrid];
        profile.record_passkey_created(
            "passkey:replacement",
            "Replacement credential",
            replacement,
            timestamp("2026-02-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationAndAssertion,
        );
        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("replacement passkey profile is missing"))?;
        assert_eq!(passkey.nook_name, "Replacement credential");
        assert!(passkey.provider_label.is_empty());
        assert_eq!(passkey.observation.aaguid.as_deref(), Some("aaguid-two"));
        assert_eq!(
            passkey.last_used_at,
            Some(timestamp("2026-02-01T00:00:00.000Z"))
        );

        let usage = PasskeyBrowserObservation {
            attachment: nook_core::PasskeyAuthenticatorAttachment::Unknown,
            transports: Vec::new(),
            backup_state: nook_core::PasskeyBackupState::BackedUp,
            aaguid: None,
            browser: nook_core::PasskeyObservedBrowser::Firefox,
            platform: nook_core::PasskeyObservedPlatform::Linux,
            legacy_client_environment: None,
        };
        profile.record_passkey_used(
            "passkey:replacement",
            usage,
            timestamp("2026-03-01T00:00:00.000Z"),
        );
        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("used passkey profile is missing"))?;
        assert_eq!(
            passkey.observation.transports,
            [nook_core::PasskeyTransport::Hybrid]
        );
        assert_eq!(passkey.observation.aaguid.as_deref(), Some("aaguid-two"));
        assert_eq!(
            passkey.observation.backup_state,
            nook_core::PasskeyBackupState::BackedUp
        );
        assert_eq!(
            passkey.observation.browser,
            nook_core::PasskeyObservedBrowser::Firefox
        );
        assert_eq!(
            passkey.observation.platform,
            nook_core::PasskeyObservedPlatform::Linux
        );
        Ok(())
    }

    #[test]
    fn passkey_usage_clears_metadata_when_the_credential_fingerprint_changes() -> anyhow::Result<()>
    {
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:old",
            "Old credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        profile
            .passkey
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("created passkey profile is missing"))?
            .provider_label = "Old provider".to_owned();

        let recovered_observation = PasskeyBrowserObservation {
            attachment: nook_core::PasskeyAuthenticatorAttachment::Unknown,
            transports: Vec::new(),
            backup_state: nook_core::PasskeyBackupState::BackedUp,
            aaguid: None,
            browser: nook_core::PasskeyObservedBrowser::Firefox,
            platform: nook_core::PasskeyObservedPlatform::Linux,
            legacy_client_environment: None,
        };
        profile.record_passkey_used(
            "passkey:recovered",
            recovered_observation.clone(),
            timestamp("2026-02-01T00:00:00.000Z"),
        );

        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("recovered passkey profile is missing"))?;
        assert_eq!(passkey.credential_fingerprint, "passkey:recovered");
        assert!(passkey.nook_name.is_empty());
        assert!(passkey.provider_label.is_empty());
        assert_eq!(passkey.created_at, None);
        assert_eq!(passkey.observation, recovered_observation);
        Ok(())
    }

    #[test]
    fn verified_access_is_scoped_by_identity_and_store_and_refreshes_one_pair() -> anyhow::Result<()>
    {
        let mut profile = DeviceAccessProfile::default();
        profile.record_verified_vault_access(
            "device-a",
            "store-one",
            timestamp("2026-01-01T00:00:00.000Z"),
        );
        profile.record_verified_vault_access(
            "device-b",
            "store-one",
            timestamp("2026-02-01T00:00:00.000Z"),
        );
        profile.record_verified_vault_access(
            "device-a",
            "store-one",
            timestamp("2026-03-01T00:00:00.000Z"),
        );

        assert_eq!(profile.verified_vaults.len(), 2);
        let refreshed = profile
            .verified_vaults
            .iter()
            .find(|entry| entry.device_id == "device-a")
            .ok_or_else(|| anyhow::anyhow!("verified device and vault pair is missing"))?;
        assert_eq!(refreshed.verified_at, timestamp("2026-03-01T00:00:00.000Z"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn profile_persistence_can_be_replaced_and_deleted() -> Result<(), NookError> {
        delete_device_access_profile().await?;
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:persisted",
            "Persisted credential",
            observation(),
            timestamp("2026-04-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        save_device_access_profile(&profile).await?;
        assert_eq!(load_device_access_profile().await?, profile);

        delete_device_access_profile().await?;
        assert_eq!(
            load_device_access_profile().await?,
            DeviceAccessProfile::default()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn future_profile_is_preserved_during_best_effort_updates() -> Result<(), NookError> {
        const FUTURE_PROFILE: &str = r#"{"version":999,"futureField":"keep-me"}"#;
        idb_put_string(DEVICE_ACCESS_PROFILE_KEY, FUTURE_PROFILE).await?;

        record_verified_vault_access("device-a", "store-one").await?;
        assert!(set_passkey_provider_label("1Password").await.is_err());
        assert_eq!(
            idb_get_string(DEVICE_ACCESS_PROFILE_KEY).await?.as_deref(),
            Some(FUTURE_PROFILE)
        );

        delete_device_access_profile().await?;
        Ok(())
    }
}
