//! Portable classification and safe identifiers for the Devices & access surface.
//!
//! Browser ceremony details are observations, never authorization policy. This
//! module keeps protection naming and safe passkey identifiers consistent for
//! every host without exposing credential bytes or private device material.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{DeviceId, IsoTimestamp, StoreId, WrappedDeviceIdentity};

mod passkey_keeper;
mod passkey_observation;

pub use passkey_keeper::{PasskeyKeeperKind, passkey_keeper_kind};
pub use passkey_observation::*;

pub const DEVICE_ACCESS_PROVIDER_LABEL_MAX_CHARS: usize = 80;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct DeviceAccessProfileVersion(u32);

impl DeviceAccessProfileVersion {
    #[must_use]
    pub const fn is_current(self) -> bool {
        self.0 == DEVICE_ACCESS_PROFILE_VERSION.0
    }

    #[must_use]
    pub const fn is_future(self) -> bool {
        self.0 > DEVICE_ACCESS_PROFILE_VERSION.0
    }
}

pub const DEVICE_ACCESS_PROFILE_VERSION: DeviceAccessProfileVersion = DeviceAccessProfileVersion(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessProviderLabelError {
    TooLong,
    ContainsControlCharacter,
}

impl std::fmt::Display for DeviceAccessProviderLabelError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLong => formatter.write_str("passkey provider label is too long"),
            Self::ContainsControlCharacter => {
                formatter.write_str("passkey provider label contains a control character")
            }
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessProtectionKind {
    Missing,
    CompanionSession,
    PasskeyStandard,
    PasskeyAntiHacker,
    PinOrPassphrase,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessIdentityState {
    Missing,
    Locked,
    Unlocked,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyAccessProfile {
    #[serde(default)]
    pub credential_fingerprint: String,
    #[serde(default)]
    pub nook_name: String,
    #[serde(default)]
    pub provider_label: String,
    #[serde(
        default,
        deserialize_with = "passkey_observation::deserialize_created_at_evidence"
    )]
    pub created_at: PasskeyCreatedAtEvidence,
    #[serde(
        default,
        deserialize_with = "passkey_observation::deserialize_last_used_at_evidence"
    )]
    pub last_used_at: PasskeyLastUsedAtEvidence,
    #[serde(default)]
    pub observation: PasskeyBrowserObservation,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedVaultAccess {
    #[serde(deserialize_with = "deserialize_verified_device_id")]
    pub device_id: DeviceId,
    #[serde(deserialize_with = "deserialize_verified_store_id")]
    pub store_id: StoreId,
    pub verified_at: IsoTimestamp,
}

fn deserialize_verified_device_id<'de, D>(deserializer: D) -> Result<DeviceId, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = String::deserialize(deserializer)?;
    DeviceId::parse(&raw).map_err(serde::de::Error::custom)
}

fn deserialize_verified_store_id<'de, D>(deserializer: D) -> Result<StoreId, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = String::deserialize(deserializer)?;
    StoreId::parse(&raw).map_err(serde::de::Error::custom)
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAccessProfile {
    pub version: DeviceAccessProfileVersion,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passkey: Option<PasskeyAccessProfile>,
    #[serde(default)]
    pub verified_vaults: Vec<VerifiedVaultAccess>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DeviceAccessProfileDecodeResult {
    Current(Box<DeviceAccessProfile>),
    RecoverableDefault,
    FutureVersion,
}

#[derive(Deserialize)]
struct DeviceAccessProfileVersionEnvelope {
    version: DeviceAccessProfileVersion,
}

#[must_use]
pub fn decode_device_access_profile(raw: &str) -> DeviceAccessProfileDecodeResult {
    let Ok(envelope) = serde_json::from_str::<DeviceAccessProfileVersionEnvelope>(raw) else {
        return DeviceAccessProfileDecodeResult::RecoverableDefault;
    };
    if envelope.version.is_future() {
        return DeviceAccessProfileDecodeResult::FutureVersion;
    }
    if !envelope.version.is_current() {
        return DeviceAccessProfileDecodeResult::RecoverableDefault;
    }
    match serde_json::from_str::<DeviceAccessProfile>(raw) {
        Ok(profile)
            if profile
                .passkey
                .as_ref()
                .is_none_or(|passkey| !passkey.credential_fingerprint.trim().is_empty()) =>
        {
            DeviceAccessProfileDecodeResult::Current(Box::new(profile))
        }
        Ok(_) | Err(_) => DeviceAccessProfileDecodeResult::RecoverableDefault,
    }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessProfileTransitionError {
    CredentialChanged,
}

impl std::fmt::Display for DeviceAccessProfileTransitionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CredentialChanged => {
                formatter.write_str("passkey changed before its provider label was saved")
            }
        }
    }
}

impl std::error::Error for DeviceAccessProfileTransitionError {}

impl DeviceAccessProfile {
    pub fn set_passkey_provider_label(
        &mut self,
        credential_fingerprint: &str,
        provider_label: String,
    ) -> Result<(), DeviceAccessProfileTransitionError> {
        if self
            .passkey
            .as_ref()
            .is_some_and(|passkey| passkey.credential_fingerprint != credential_fingerprint)
        {
            return Err(DeviceAccessProfileTransitionError::CredentialChanged);
        }
        if let Some(passkey) = self.passkey.as_mut() {
            passkey.provider_label = provider_label;
            return Ok(());
        }
        self.passkey = Some(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            provider_label,
            ..PasskeyAccessProfile::default()
        });
        Ok(())
    }

    pub fn record_passkey_created(
        &mut self,
        credential_fingerprint: &str,
        nook_name: &str,
        observation: PasskeyBrowserObservation,
        now: IsoTimestamp,
        ceremony: PasskeyCreationCeremony,
    ) {
        self.passkey = Some(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            nook_name: nook_name.trim().to_owned(),
            provider_label: String::new(),
            created_at: PasskeyCreatedAtEvidence::Known {
                timestamp: now.clone(),
            },
            last_used_at: match ceremony {
                PasskeyCreationCeremony::RegistrationOnly => {
                    PasskeyLastUsedAtEvidence::NotYetObserved
                }
                PasskeyCreationCeremony::RegistrationAndAssertion => {
                    PasskeyLastUsedAtEvidence::Known { timestamp: now }
                }
            },
            observation,
        });
    }

    pub fn record_passkey_used(
        &mut self,
        credential_fingerprint: &str,
        observation: PasskeyBrowserObservation,
        now: IsoTimestamp,
    ) {
        if let Some(passkey) = self
            .passkey
            .as_mut()
            .filter(|passkey| passkey.credential_fingerprint == credential_fingerprint)
        {
            passkey.last_used_at = PasskeyLastUsedAtEvidence::Known { timestamp: now };
            passkey.observation.merge_usage(observation);
            return;
        }
        self.passkey = Some(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            last_used_at: PasskeyLastUsedAtEvidence::Known { timestamp: now },
            observation,
            ..PasskeyAccessProfile::default()
        });
    }

    pub fn record_verified_vault_access(
        &mut self,
        device_id: &DeviceId,
        store_id: &StoreId,
        now: IsoTimestamp,
    ) {
        self.verified_vaults
            .retain(|entry| &entry.device_id != device_id || &entry.store_id != store_id);
        self.verified_vaults.push(VerifiedVaultAccess {
            device_id: device_id.clone(),
            store_id: store_id.clone(),
            verified_at: now,
        });
    }
}

#[must_use]
pub fn classify_device_access_protection(
    record: Option<&WrappedDeviceIdentity>,
) -> DeviceAccessProtectionKind {
    match record {
        None => DeviceAccessProtectionKind::Missing,
        Some(WrappedDeviceIdentity::PasskeyDerived(_)) => {
            DeviceAccessProtectionKind::PasskeyStandard
        }
        Some(WrappedDeviceIdentity::PasskeyWrappedLocal(_)) => {
            DeviceAccessProtectionKind::PasskeyAntiHacker
        }
        Some(WrappedDeviceIdentity::Pin(_)) => DeviceAccessProtectionKind::PinOrPassphrase,
    }
}

#[must_use]
pub fn classify_device_access_identity_state(
    session_unlocked: bool,
    session_device_id: &str,
    persisted_device_id: Option<&str>,
) -> DeviceAccessIdentityState {
    if session_unlocked {
        DeviceAccessIdentityState::Unlocked
    } else if !session_device_id.trim().is_empty() || persisted_device_id.is_some() {
        DeviceAccessIdentityState::Locked
    } else {
        DeviceAccessIdentityState::Missing
    }
}

/// Stable, non-secret correlation id for a Nook-managed `WebAuthn` credential.
#[must_use]
pub fn passkey_credential_identifier(credential_id: &[u8]) -> String {
    short_identifier("passkey", credential_id)
}

/// Stable, non-secret correlation id for the RP-scoped `WebAuthn` user handle.
#[must_use]
pub fn passkey_user_handle_identifier(user_handle: &[u8]) -> String {
    short_identifier("user", user_handle)
}

pub fn normalize_device_access_provider_label(
    value: &str,
) -> Result<String, DeviceAccessProviderLabelError> {
    let value = value.trim();
    if value.chars().count() > DEVICE_ACCESS_PROVIDER_LABEL_MAX_CHARS {
        return Err(DeviceAccessProviderLabelError::TooLong);
    }
    if value.chars().any(char::is_control) {
        return Err(DeviceAccessProviderLabelError::ContainsControlCharacter);
    }
    Ok(value.to_owned())
}

fn short_identifier(prefix: &str, bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{prefix}_{}", hex::encode(&digest[..8]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeviceIdentity, DeviceKeyProtectionSetup, PasskeyDeviceProtectionMode,
        passkey_derived_device_identity_record, passkey_wrapped_device_identity_record,
        wrap_device_identity_with_pin,
    };

    #[test]
    fn classifies_every_persisted_protection_shape() -> anyhow::Result<()> {
        let setup = DeviceKeyProtectionSetup::generate()?;
        let standard = passkey_derived_device_identity_record(
            &[7; 32],
            setup.user_handle(),
            setup.prf_input(),
        )?;
        let identity = DeviceIdentity::generate()?;
        let anti_hacker = passkey_wrapped_device_identity_record(
            &[8; 32],
            setup.user_handle(),
            setup.prf_input(),
            &[9; 32],
            &identity.secret_string(),
        )?;
        assert_eq!(
            anti_hacker.device_mode()?,
            PasskeyDeviceProtectionMode::AntiHacker.as_str()
        );
        let pin = wrap_device_identity_with_pin(&identity.secret_string(), "six words")?;

        assert_eq!(
            classify_device_access_protection(None),
            DeviceAccessProtectionKind::Missing
        );
        assert_eq!(
            classify_device_access_protection(Some(&standard)),
            DeviceAccessProtectionKind::PasskeyStandard
        );
        assert_eq!(
            classify_device_access_protection(Some(&anti_hacker)),
            DeviceAccessProtectionKind::PasskeyAntiHacker
        );
        assert_eq!(
            classify_device_access_protection(Some(&pin)),
            DeviceAccessProtectionKind::PinOrPassphrase
        );
        Ok(())
    }

    #[test]
    fn safe_identifiers_are_stable_and_do_not_embed_source_bytes() {
        let credential = passkey_credential_identifier(b"credential bytes");
        let user = passkey_user_handle_identifier(b"user handle");

        assert_eq!(
            credential,
            passkey_credential_identifier(b"credential bytes")
        );
        assert!(credential.starts_with("passkey_"));
        assert!(user.starts_with("user_"));
        assert!(!credential.contains("credential"));
        assert_eq!(credential.len(), "passkey_".len() + 16);
    }

    #[test]
    fn passkey_transports_use_stable_typed_serialization() -> anyhow::Result<()> {
        let transports = [PasskeyTransport::Hybrid, PasskeyTransport::Internal];
        let serialized = serde_json::to_string(&transports)?;
        assert_eq!(serialized, r#"["hybrid","internal"]"#);
        assert_eq!(
            serde_json::from_str::<Vec<PasskeyTransport>>(&serialized)?,
            transports
        );
        Ok(())
    }

    #[test]
    fn device_access_profile_version_is_typed_and_validated_during_decode() -> anyhow::Result<()> {
        let profile = DeviceAccessProfile::default();
        let serialized = serde_json::to_string(&profile)?;
        let decoded: DeviceAccessProfile = serde_json::from_str(&serialized)?;

        assert!(decoded.version.is_current());
        assert_eq!(
            decode_device_access_profile(&serialized),
            DeviceAccessProfileDecodeResult::Current(Box::new(profile))
        );
        assert_eq!(
            decode_device_access_profile(r#"{"version":0,"verifiedVaults":[]}"#),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            decode_device_access_profile(r#"{"version":999,"verifiedVaults":[]}"#),
            DeviceAccessProfileDecodeResult::FutureVersion
        );
        assert_eq!(
            decode_device_access_profile("not-json"),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            decode_device_access_profile(
                r#"{"version":1,"verifiedVaults":[{"storeId":"store-one","verifiedAt":"2026-01-01T00:00:00.000Z"}]}"#,
            ),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            decode_device_access_profile(
                r#"{"version":1,"verifiedVaults":[{"deviceId":"","storeId":"store-one","verifiedAt":"2026-01-01T00:00:00.000Z"}]}"#,
            ),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert!(matches!(
            decode_device_access_profile(
                r#"{"version":1,"verifiedVaults":[{"deviceId":"0123456789abcdef","storeId":"store_testtoken11","verifiedAt":"2026-01-01T00:00:00.000Z"}]}"#,
            ),
            DeviceAccessProfileDecodeResult::Current(_)
        ));
        assert_eq!(
            decode_device_access_profile(
                r#"{"version":1,"verifiedVaults":[{"deviceId":"0123456789abcdef","storeId":"store-one","verifiedAt":"2026-01-01T00:00:00.000Z"}]}"#,
            ),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            decode_device_access_profile(
                r#"{"version":1,"passkey":{"providerLabel":"stale provider"},"verifiedVaults":[]}"#,
            ),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        Ok(())
    }

    #[test]
    fn distinguishes_missing_locked_and_unlocked_identity_sessions() {
        assert_eq!(
            classify_device_access_identity_state(false, "", None),
            DeviceAccessIdentityState::Missing
        );
        assert_eq!(
            classify_device_access_identity_state(false, "", Some("device-persisted")),
            DeviceAccessIdentityState::Locked
        );
        assert_eq!(
            classify_device_access_identity_state(
                false,
                "device-persisted",
                Some("device-persisted")
            ),
            DeviceAccessIdentityState::Locked
        );
        assert_eq!(
            classify_device_access_identity_state(true, "device-session", Some("device-persisted")),
            DeviceAccessIdentityState::Unlocked
        );
        assert_eq!(
            classify_device_access_identity_state(true, "device-companion", None),
            DeviceAccessIdentityState::Unlocked
        );
        assert_eq!(
            classify_device_access_identity_state(false, "device-companion", None),
            DeviceAccessIdentityState::Locked
        );
    }

    #[test]
    fn normalizes_user_provider_labels_without_inventing_provider_identity() {
        assert_eq!(
            normalize_device_access_provider_label("  Proton Pass  "),
            Ok("Proton Pass".to_owned())
        );
        assert_eq!(
            normalize_device_access_provider_label("   "),
            Ok(String::new())
        );
        assert_eq!(
            normalize_device_access_provider_label(&"x".repeat(81)),
            Err(DeviceAccessProviderLabelError::TooLong)
        );
        assert_eq!(
            normalize_device_access_provider_label("Apple\nPasswords"),
            Err(DeviceAccessProviderLabelError::ContainsControlCharacter)
        );
    }

    fn timestamp(value: &str) -> IsoTimestamp {
        IsoTimestamp::from_trusted(value.to_owned())
    }

    fn observation() -> PasskeyBrowserObservation {
        PasskeyBrowserObservation {
            attachment: PasskeyAuthenticatorAttachment::Platform,
            transports: vec![PasskeyTransport::Internal],
            backup_state: PasskeyBackupState::Eligible,
            aaguid: Some("aaguid-one".to_owned()),
            browser: PasskeyObservedBrowser::Safari,
            platform: PasskeyObservedPlatform::MacOs,
            legacy_client_environment: None,
        }
    }

    #[test]
    fn credential_replacement_resets_provider_and_records_creation_evidence() -> anyhow::Result<()>
    {
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:first",
            "First credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        profile.set_passkey_provider_label("passkey:first", "Bitwarden".to_owned())?;

        profile.record_passkey_created(
            "passkey:replacement",
            " Replacement credential ",
            observation(),
            timestamp("2026-02-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationAndAssertion,
        );

        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("replacement passkey profile is missing"))?;
        assert_eq!(passkey.nook_name, "Replacement credential");
        assert!(passkey.provider_label.is_empty());
        assert_eq!(
            passkey.last_used_at,
            PasskeyLastUsedAtEvidence::Known {
                timestamp: timestamp("2026-02-01T00:00:00.000Z")
            }
        );
        Ok(())
    }

    #[test]
    fn matching_usage_merges_new_observations_without_erasing_creation_evidence()
    -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:current",
            "Current credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        profile.record_passkey_used(
            "passkey:current",
            PasskeyBrowserObservation {
                backup_state: PasskeyBackupState::BackedUp,
                browser: PasskeyObservedBrowser::Firefox,
                platform: PasskeyObservedPlatform::Linux,
                ..PasskeyBrowserObservation::default()
            },
            timestamp("2026-03-01T00:00:00.000Z"),
        );

        let passkey = profile
            .passkey
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("passkey profile is missing"))?;
        assert_eq!(passkey.observation.transports, [PasskeyTransport::Internal]);
        assert_eq!(
            passkey.observation.backup_state,
            PasskeyBackupState::BackedUp
        );
        assert_eq!(passkey.observation.browser, PasskeyObservedBrowser::Firefox);
        assert_eq!(
            passkey.created_at,
            PasskeyCreatedAtEvidence::Known {
                timestamp: timestamp("2026-01-01T00:00:00.000Z")
            }
        );
        Ok(())
    }

    #[test]
    fn provider_label_transition_rejects_a_replaced_credential() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile.record_passkey_created(
            "passkey:current",
            "Current credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );

        assert_eq!(
            profile.set_passkey_provider_label("passkey:stale", "Bitwarden".to_owned()),
            Err(DeviceAccessProfileTransitionError::CredentialChanged)
        );
        assert!(
            profile
                .passkey
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("passkey profile is missing"))?
                .provider_label
                .is_empty()
        );
        Ok(())
    }

    #[test]
    fn verified_access_refreshes_only_the_matching_device_and_vault_pair() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        let device_a = DeviceId::parse("0123456789abcdef")?;
        let device_b = DeviceId::parse("fedcba9876543210")?;
        let store_id = StoreId::parse("store_testtoken11")?;
        profile.record_verified_vault_access(
            &device_a,
            &store_id,
            timestamp("2026-01-01T00:00:00.000Z"),
        );
        profile.record_verified_vault_access(
            &device_b,
            &store_id,
            timestamp("2026-02-01T00:00:00.000Z"),
        );
        profile.record_verified_vault_access(
            &device_a,
            &store_id,
            timestamp("2026-03-01T00:00:00.000Z"),
        );

        assert_eq!(profile.verified_vaults.len(), 2);
        assert_eq!(
            profile.verified_vaults[1].verified_at,
            timestamp("2026-03-01T00:00:00.000Z")
        );
        Ok(())
    }
}
