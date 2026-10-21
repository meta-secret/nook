//! Secret-free detail projection for one stored website passkey.
//!
//! The detail panel needs more than the persisted list metadata, but never the
//! private key. This projection is built on demand from a freshly decrypted
//! record and carries only public credential facts.

use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::i18n_keys;
use crate::{PasskeyCredentialKey, PasskeySecret, PasskeySignatureCount};
use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::fmt;

/// Signature algorithm of a stored passkey credential key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyKeyAlgorithm {
    /// ECDSA over P-256 with SHA-256 (COSE algorithm -7).
    Es256,
}

impl PasskeyKeyAlgorithm {
    #[must_use]
    pub const fn translation_key(self) -> &'static str {
        match self {
            Self::Es256 => i18n_keys::VAULT_FIELDS_PASSKEY_ALGORITHM_ES256,
        }
    }
}

/// Whether the website can offer this passkey without first asking for a username.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyDiscoverability {
    Discoverable,
    NonDiscoverable,
}

impl PasskeyDiscoverability {
    #[must_use]
    pub const fn translation_key(self) -> &'static str {
        match self {
            Self::Discoverable => i18n_keys::VAULT_FIELDS_PASSKEY_DISCOVERABLE_YES,
            Self::NonDiscoverable => i18n_keys::VAULT_FIELDS_PASSKEY_DISCOVERABLE_NO,
        }
    }
}

/// Backup eligibility and state reported for the credential (`WebAuthn` BE/BS flags).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyBackupStatus {
    NotEligible,
    EligibleNotBackedUp,
    BackedUp,
}

impl PasskeyBackupStatus {
    #[must_use]
    pub const fn translation_key(self) -> &'static str {
        match self {
            Self::NotEligible => i18n_keys::VAULT_FIELDS_PASSKEY_BACKUP_NOT_ELIGIBLE,
            Self::EligibleNotBackedUp => i18n_keys::VAULT_FIELDS_PASSKEY_BACKUP_NOT_BACKED_UP,
            Self::BackedUp => i18n_keys::VAULT_FIELDS_PASSKEY_BACKUP_BACKED_UP,
        }
    }
}

/// SSH-style public key fingerprint: `SHA256:` plus unpadded standard base64 of
/// the SHA-256 digest over the credential's COSE public key bytes.
#[derive(Clone, PartialEq, Eq)]
pub struct PasskeyPublicKeyFingerprint(String);

impl PasskeyPublicKeyFingerprint {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for PasskeyPublicKeyFingerprint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PasskeyPublicKeyFingerprint([REDACTED])")
    }
}

impl fmt::Display for PasskeyPublicKeyFingerprint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Public facts about one stored passkey for its detail panel.
///
/// The private key is absent by construction. Identifying values stay redacted
/// in `Debug` output.
#[derive(Clone, PartialEq, Eq)]
pub struct PasskeyDetails {
    /// Base64url credential ID, exactly as the website knows it.
    pub credential_id: String,
    /// Website display name, present only when it adds information beyond the RP ID.
    pub relying_party_name: Option<String>,
    /// Account user name, present only when it differs from the display name.
    pub distinct_user_name: Option<String>,
    pub algorithm: PasskeyKeyAlgorithm,
    pub public_key_fingerprint: PasskeyPublicKeyFingerprint,
    pub signature_count: PasskeySignatureCount,
    pub discoverability: PasskeyDiscoverability,
    pub backup_status: PasskeyBackupStatus,
}

impl fmt::Debug for PasskeyDetails {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasskeyDetails")
            .field("credential_id", &"[REDACTED]")
            .field(
                "relying_party_name",
                &self.relying_party_name.as_ref().map(|_| "[REDACTED]"),
            )
            .field(
                "distinct_user_name",
                &self.distinct_user_name.as_ref().map(|_| "[REDACTED]"),
            )
            .field("algorithm", &self.algorithm)
            .field("public_key_fingerprint", &self.public_key_fingerprint)
            .field("signature_count", &self.signature_count)
            .field("discoverability", &self.discoverability)
            .field("backup_status", &self.backup_status)
            .finish()
    }
}

impl PasskeySecret {
    /// Build the secret-free detail projection for this passkey.
    ///
    /// # Errors
    ///
    /// Returns [`SecretPayloadError::InvalidPasskey`] when the stored public key
    /// is not canonical base64url or the backup flags are contradictory.
    pub fn details(&self) -> SecretPayloadResult<PasskeyDetails> {
        Ok(PasskeyDetails {
            credential_id: self.credential_id.clone(),
            relying_party_name: (!self.rp_name.is_empty()
                && !self.rp_name.eq_ignore_ascii_case(&self.rp_id))
            .then(|| self.rp_name.clone()),
            distinct_user_name: (self.user_name != self.user_display_name)
                .then(|| self.user_name.clone()),
            algorithm: self.key.algorithm(),
            public_key_fingerprint: self.key.public_key_fingerprint()?,
            signature_count: self.signature_count,
            discoverability: if self.discoverable {
                PasskeyDiscoverability::Discoverable
            } else {
                PasskeyDiscoverability::NonDiscoverable
            },
            backup_status: match (self.backup_eligible, self.backup_state) {
                (false, false) => PasskeyBackupStatus::NotEligible,
                (true, false) => PasskeyBackupStatus::EligibleNotBackedUp,
                (true, true) => PasskeyBackupStatus::BackedUp,
                (false, true) => {
                    return Err(SecretPayloadError::InvalidPasskey {
                        reason: "backup state requires backup eligibility".to_owned(),
                    });
                }
            },
        })
    }
}

impl PasskeyCredentialKey {
    #[must_use]
    pub fn algorithm(&self) -> PasskeyKeyAlgorithm {
        match self {
            Self::Es256 { .. } => PasskeyKeyAlgorithm::Es256,
        }
    }

    fn public_key_fingerprint(&self) -> SecretPayloadResult<PasskeyPublicKeyFingerprint> {
        let encoded = match self {
            Self::Es256 {
                public_key_cose, ..
            } => public_key_cose.encoded(),
        };
        let cose_bytes =
            URL_SAFE_NO_PAD
                .decode(encoded)
                .map_err(|_| SecretPayloadError::InvalidPasskey {
                    reason: "public key is not canonical base64url".to_owned(),
                })?;
        let digest = Sha256::digest(&cose_bytes);
        Ok(PasskeyPublicKeyFingerprint(format!(
            "SHA256:{}",
            STANDARD_NO_PAD.encode(digest)
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PASSKEY_SECRET_VERSION, PasskeyPrivateKeyPkcs8, PasskeyPublicKeyCose};

    /// `head -c 77 /dev/zero | tr '\0' '\n' | openssl dgst -sha256 -binary | base64`, unpadded.
    const FINGERPRINT_OF_77_BYTES_OF_10: &str =
        "SHA256:9+DIAhGaEvPhUkquTXtzDLd10GrycDMuT91vONRZCiY";

    fn passkey(private_key: &str) -> anyhow::Result<PasskeySecret> {
        Ok(PasskeySecret {
            version: PASSKEY_SECRET_VERSION,
            rp_id: "login.example.com".to_owned(),
            rp_name: "Example Login".to_owned(),
            credential_id: URL_SAFE_NO_PAD.encode([8_u8; 32]),
            user_handle: URL_SAFE_NO_PAD.encode([9_u8; 32]),
            user_name: "alice@example.com".to_owned(),
            user_display_name: "Alice".to_owned(),
            key: PasskeyCredentialKey::Es256 {
                private_key_pkcs8: PasskeyPrivateKeyPkcs8::parse(private_key.to_owned())?,
                public_key_cose: PasskeyPublicKeyCose::parse(URL_SAFE_NO_PAD.encode([10_u8; 77]))?,
            },
            signature_count: 42.into(),
            discoverable: true,
            backup_eligible: true,
            backup_state: true,
        })
    }

    #[test]
    fn details_carry_public_credential_facts_and_known_fingerprint() -> anyhow::Result<()> {
        let private_key = URL_SAFE_NO_PAD.encode([7_u8; 96]);
        let details = passkey(&private_key)?.details()?;

        assert_eq!(details.credential_id, URL_SAFE_NO_PAD.encode([8_u8; 32]));
        assert_eq!(details.relying_party_name.as_deref(), Some("Example Login"));
        assert_eq!(
            details.distinct_user_name.as_deref(),
            Some("alice@example.com")
        );
        assert_eq!(details.algorithm, PasskeyKeyAlgorithm::Es256);
        assert_eq!(
            details.algorithm.translation_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_ALGORITHM_ES256
        );
        assert_eq!(
            details.public_key_fingerprint.as_str(),
            FINGERPRINT_OF_77_BYTES_OF_10
        );
        assert_eq!(
            details.public_key_fingerprint.to_string(),
            FINGERPRINT_OF_77_BYTES_OF_10
        );
        assert_eq!(u32::from(details.signature_count), 42);
        assert_eq!(
            details.discoverability,
            PasskeyDiscoverability::Discoverable
        );
        assert_eq!(details.backup_status, PasskeyBackupStatus::BackedUp);
        Ok(())
    }

    #[test]
    fn details_and_debug_never_contain_private_key_or_identifying_values() -> anyhow::Result<()> {
        let private_key = URL_SAFE_NO_PAD.encode([7_u8; 96]);
        let details = passkey(&private_key)?.details()?;
        let debug = format!("{details:?}");

        assert!(!debug.contains(&private_key));
        assert!(!debug.contains(&details.credential_id));
        assert!(!debug.contains("alice@example.com"));
        assert!(!debug.contains("Example Login"));
        assert!(!debug.contains(FINGERPRINT_OF_77_BYTES_OF_10));
        assert!(debug.contains("Es256"));
        assert!(debug.contains("BackedUp"));
        Ok(())
    }

    #[test]
    fn redundant_names_are_omitted_from_details() -> anyhow::Result<()> {
        let mut value = passkey(&URL_SAFE_NO_PAD.encode([7_u8; 96]))?;
        value.rp_name = "LOGIN.example.com".to_owned();
        value.user_display_name = value.user_name.clone();

        let details = value.details()?;

        assert_eq!(details.relying_party_name, None);
        assert_eq!(details.distinct_user_name, None);
        Ok(())
    }

    #[test]
    fn backup_and_discoverability_flags_map_to_labelled_states() -> anyhow::Result<()> {
        let mut value = passkey(&URL_SAFE_NO_PAD.encode([7_u8; 96]))?;
        value.backup_state = false;
        let eligible = value.details()?;
        assert_eq!(
            eligible.backup_status,
            PasskeyBackupStatus::EligibleNotBackedUp
        );
        assert_eq!(
            eligible.backup_status.translation_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_BACKUP_NOT_BACKED_UP
        );

        value.backup_eligible = false;
        value.discoverable = false;
        let device_bound = value.details()?;
        assert_eq!(device_bound.backup_status, PasskeyBackupStatus::NotEligible);
        assert_eq!(
            device_bound.backup_status.translation_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_BACKUP_NOT_ELIGIBLE
        );
        assert_eq!(
            device_bound.discoverability.translation_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_DISCOVERABLE_NO
        );
        assert_eq!(
            PasskeyBackupStatus::BackedUp.translation_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_BACKUP_BACKED_UP
        );
        assert_eq!(
            PasskeyDiscoverability::Discoverable.translation_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_DISCOVERABLE_YES
        );
        Ok(())
    }

    #[test]
    fn contradictory_backup_flags_fail_instead_of_guessing() -> anyhow::Result<()> {
        let mut value = passkey(&URL_SAFE_NO_PAD.encode([7_u8; 96]))?;
        value.backup_eligible = false;
        value.backup_state = true;

        assert!(matches!(
            value.details(),
            Err(SecretPayloadError::InvalidPasskey { .. })
        ));
        Ok(())
    }
}
