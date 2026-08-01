//! Portable classification and safe identifiers for the Devices & access surface.
//!
//! Browser ceremony details are observations, never authorization policy. This
//! module keeps protection naming and safe passkey identifiers consistent for
//! every host without exposing credential bytes or private device material.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::WrappedDeviceIdentity;

pub const DEVICE_ACCESS_PROVIDER_LABEL_MAX_CHARS: usize = 80;

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

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyObservedBrowser {
    #[default]
    Unknown,
    Edge,
    Firefox,
    Chrome,
    Safari,
    Other,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyObservedPlatform {
    #[default]
    Unknown,
    Android,
    AppleMobile,
    MacOs,
    Windows,
    Linux,
    Other,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Deserialize, Ord, PartialEq, PartialOrd, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyTransport {
    Ble,
    Hybrid,
    Internal,
    Nfc,
    Usb,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyAuthenticatorAttachment {
    #[default]
    Unknown,
    Platform,
    CrossPlatform,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyBackupState {
    #[default]
    Unknown,
    NotEligible,
    Eligible,
    BackedUp,
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
    session_device_id: &str,
    persisted_device_id: Option<&str>,
) -> DeviceAccessIdentityState {
    if !session_device_id.trim().is_empty() {
        DeviceAccessIdentityState::Unlocked
    } else if persisted_device_id.is_some() {
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
    fn distinguishes_missing_locked_and_unlocked_identity_sessions() {
        assert_eq!(
            classify_device_access_identity_state("", None),
            DeviceAccessIdentityState::Missing
        );
        assert_eq!(
            classify_device_access_identity_state("", Some("device-persisted")),
            DeviceAccessIdentityState::Locked
        );
        assert_eq!(
            classify_device_access_identity_state("device-session", Some("device-persisted")),
            DeviceAccessIdentityState::Unlocked
        );
        assert_eq!(
            classify_device_access_identity_state("device-companion", None),
            DeviceAccessIdentityState::Unlocked
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
}
