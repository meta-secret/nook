//! Password-based wrap of `secrets_key` + `members_key`.
//!
//! Provides an alternative unwrap path to the per-device X25519 auth rows so
//! a new device can self-enroll using only a user-supplied password (typically
//! delivered out-of-band via QR).
//!
//! A vault picks **exactly one** unlock mode via `VaultUnlock`:
//! - `Keys`: per-device `auth:` envelopes + join/approve flow (the historical
//!   default).
//! - `Passwords { entries }`: one or more scrypt-wrapped envelopes, each with a
//!   user-chosen label — any matching password unlocks the same vault keys.
//!
//! Future variants (hardware token, social recovery, …) extend the enum
//! without altering the storage layout.
//!
//! See `.cortex/product-specs/password-envelope.md` for the full design.

use crate::multi_device::VaultKeys;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

/// Scrypt work factor for human-chosen passwords (~1s on a 2024 mid-tier laptop).
/// Intentionally higher than `VaultCrypto`'s `log_n = 15`, which is tuned for
/// 128-bit random keys with no brute-force surface.
pub const PASSWORD_SCRYPT_LOG_N: u8 = 18;

/// Recommended minimum password length. UI layers should enforce a stricter
/// entropy policy; this is the absolute floor below which we refuse to wrap.
pub const PASSWORD_MIN_LENGTH: usize = 5;

/// A labelled password unlock slot. Each entry wraps the same vault keys with
/// a distinct password so devices (or people) can maintain separate credentials.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PasswordUnlockEntry {
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub envelope: PasswordEnvelope,
}

/// Default label used when migrating a legacy single-envelope vault.
pub const LEGACY_PASSWORD_ENTRY_LABEL: &str = "Vault password";

/// On-disk password envelope. Salt + KDF params are embedded in the age
/// header; the `kdf` / `work_factor` fields are redundant hints for tooling.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PasswordEnvelope {
    pub version: u32,
    pub kdf: String,
    pub work_factor: u8,
    pub ciphertext: String,
}

/// The vault's active unlock mechanism — mutually exclusive across variants.
///
/// Serialised as YAML with `type:` tag plus per-variant data:
///
/// ```yaml
/// unlock:
///   type: keys
/// # OR
/// unlock:
///   type: password
///   entries:
///     - id: ...
///       label: "john's password"
///       created_at: ...
///       envelope: { version, kdf, work_factor, ciphertext }
/// ```
///
/// Legacy vaults may still carry a single `envelope:` under `type: password`;
/// those are migrated into a one-entry `entries` list on read.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum VaultUnlock {
    #[default]
    Keys,
    Passwords {
        entries: Vec<PasswordUnlockEntry>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
enum VaultUnlockTagged {
    Keys,
    Password {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        entries: Vec<PasswordUnlockEntry>,
        #[serde(default, skip_serializing)]
        envelope: Option<PasswordEnvelope>,
    },
}

impl Serialize for VaultUnlock {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Keys => VaultUnlockTagged::Keys.serialize(serializer),
            Self::Passwords { entries } => VaultUnlockTagged::Password {
                entries: entries.clone(),
                envelope: None,
            }
            .serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for VaultUnlock {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let tagged = VaultUnlockTagged::deserialize(deserializer)?;
        Ok(match tagged {
            VaultUnlockTagged::Keys => Self::Keys,
            VaultUnlockTagged::Password { entries, envelope } => {
                if !entries.is_empty() {
                    Self::Passwords { entries }
                } else if let Some(envelope) = envelope {
                    Self::Passwords {
                        entries: vec![legacy_password_entry(envelope)],
                    }
                } else {
                    Self::Keys
                }
            }
        })
    }
}

fn legacy_password_entry(envelope: PasswordEnvelope) -> PasswordUnlockEntry {
    PasswordUnlockEntry {
        id: "legacy".to_owned(),
        label: LEGACY_PASSWORD_ENTRY_LABEL.to_owned(),
        created_at: String::new(),
        envelope,
    }
}

impl VaultUnlock {
    #[must_use]
    pub fn is_password(&self) -> bool {
        matches!(self, Self::Passwords { .. })
    }

    #[must_use]
    pub fn password_entries(&self) -> &[PasswordUnlockEntry] {
        match self {
            Self::Passwords { entries } => entries.as_slice(),
            Self::Keys => &[],
        }
    }

    #[must_use]
    pub fn password_entry(&self, id: &str) -> Option<&PasswordUnlockEntry> {
        self.password_entries().iter().find(|entry| entry.id == id)
    }

    #[must_use]
    pub fn password_envelope(&self) -> Option<&PasswordEnvelope> {
        self.password_entries().first().map(|entry| &entry.envelope)
    }
}

/// Build a new labelled password entry from resolved vault keys.
pub fn create_password_entry(
    keys: &VaultKeys,
    id: &str,
    label: &str,
    created_at: &str,
    password: &str,
) -> Result<PasswordUnlockEntry, String> {
    let trimmed_label = label.trim();
    if trimmed_label.is_empty() {
        return Err("Password label cannot be empty.".to_owned());
    }
    Ok(PasswordUnlockEntry {
        id: id.to_owned(),
        label: trimmed_label.to_owned(),
        created_at: created_at.to_owned(),
        envelope: attach_password_envelope(keys, password)?,
    })
}

/// Resolve keys using a specific password entry.
pub fn resolve_keys_from_entry(
    entry: &PasswordUnlockEntry,
    password: &str,
) -> Result<VaultKeys, String> {
    resolve_keys_from_password(&entry.envelope, password)
}

/// Verify a password against a specific entry.
#[must_use]
pub fn verify_password_entry(entry: &PasswordUnlockEntry, password: &str) -> bool {
    resolve_keys_from_entry(entry, password).is_ok()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EnvelopePlaintext {
    secrets_key: String,
    members_key: String,
}

const ENVELOPE_VERSION: u32 = 1;
const ENVELOPE_KDF: &str = "scrypt";

/// Wrap `secrets_key` + `members_key` with a password-derived scrypt key.
pub fn attach_password_envelope(
    keys: &VaultKeys,
    password: &str,
) -> Result<PasswordEnvelope, String> {
    if password.len() < PASSWORD_MIN_LENGTH {
        return Err(format!(
            "Password must be at least {} characters.",
            PASSWORD_MIN_LENGTH
        ));
    }

    let plaintext = serde_json::to_string(&EnvelopePlaintext {
        secrets_key: keys.secrets_key.clone(),
        members_key: keys.members_key.clone(),
    })
    .map_err(|e| format!("Failed to serialize envelope plaintext: {}", e))?;

    let secret = age::secrecy::SecretString::from(password.to_owned());
    let mut recipient = age::scrypt::Recipient::new(secret);
    recipient.set_work_factor(PASSWORD_SCRYPT_LOG_N);

    let ciphertext = age_encrypt_scrypt(&recipient, plaintext.as_bytes())?;

    Ok(PasswordEnvelope {
        version: ENVELOPE_VERSION,
        kdf: ENVELOPE_KDF.to_owned(),
        work_factor: PASSWORD_SCRYPT_LOG_N,
        ciphertext,
    })
}

/// Unwrap a password envelope to recover `secrets_key` + `members_key`.
pub fn resolve_keys_from_password(
    envelope: &PasswordEnvelope,
    password: &str,
) -> Result<VaultKeys, String> {
    if envelope.version != ENVELOPE_VERSION {
        return Err(format!(
            "Unsupported password envelope version: {}",
            envelope.version
        ));
    }
    if envelope.kdf != ENVELOPE_KDF {
        return Err(format!(
            "Unsupported password envelope KDF: {}",
            envelope.kdf
        ));
    }

    let secret = age::secrecy::SecretString::from(password.to_owned());
    let identity = age::scrypt::Identity::new(secret);
    let plaintext_bytes = age_decrypt_scrypt(&identity, envelope.ciphertext.as_bytes())?;
    let plaintext_str = String::from_utf8(plaintext_bytes)
        .map_err(|e| format!("Envelope plaintext is not valid UTF-8: {}", e))?;
    let parsed: EnvelopePlaintext = serde_json::from_str(&plaintext_str)
        .map_err(|e| format!("Invalid envelope plaintext JSON: {}", e))?;

    Ok(VaultKeys {
        secrets_key: parsed.secrets_key,
        members_key: parsed.members_key,
    })
}

/// Verify a password decrypts the envelope without exposing the unwrapped keys.
#[must_use]
pub fn verify_password(envelope: &PasswordEnvelope, password: &str) -> bool {
    resolve_keys_from_password(envelope, password).is_ok()
}

fn age_encrypt_scrypt(
    recipient: &age::scrypt::Recipient,
    plaintext: &[u8],
) -> Result<String, String> {
    use age::armor::{ArmoredWriter, Format};

    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(recipient as &dyn age::Recipient))
            .map_err(|e| format!("Envelope encryption setup error: {}", e))?;

    let mut armored = Vec::new();
    let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
        .map_err(|e| format!("Envelope armor wrap error: {}", e))?;
    let mut writer = encryptor
        .wrap_output(armor_writer)
        .map_err(|e| format!("Envelope encryption error: {}", e))?;
    writer
        .write_all(plaintext)
        .map_err(|e| format!("Envelope write error: {}", e))?;
    writer
        .finish()
        .map_err(|e| format!("Envelope finish error: {}", e))?
        .finish()
        .map_err(|e| format!("Envelope armor finish error: {}", e))?;

    String::from_utf8(armored).map_err(|e| format!("Envelope armor is not UTF-8: {}", e))
}

fn age_decrypt_scrypt(identity: &age::scrypt::Identity, armored: &[u8]) -> Result<Vec<u8>, String> {
    use age::armor::ArmoredReader;

    let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(armored))
        .map_err(|e| format!("Envelope decryption setup error: {}", e))?;
    let mut reader = decryptor
        .decrypt(std::iter::once(identity as &dyn age::Identity))
        .map_err(|e| format!("Envelope decryption error (wrong password?): {}", e))?;

    let mut plaintext = Vec::new();
    reader
        .read_to_end(&mut plaintext)
        .map_err(|e| format!("Envelope read error: {}", e))?;
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_keys() -> VaultKeys {
        VaultKeys {
            secrets_key: "deadbeefdeadbeefdeadbeefdeadbeef".repeat(2),
            members_key: "abadcafeabadcafeabadcafeabadcafe".repeat(2),
        }
    }

    #[test]
    fn roundtrip_attach_and_resolve() {
        let keys = sample_keys();
        let envelope = attach_password_envelope(&keys, "correct horse battery staple").unwrap();
        assert_eq!(envelope.version, 1);
        assert_eq!(envelope.kdf, "scrypt");
        assert!(envelope.ciphertext.contains("BEGIN AGE ENCRYPTED FILE"));

        let resolved =
            resolve_keys_from_password(&envelope, "correct horse battery staple").unwrap();
        assert_eq!(resolved, keys);
    }

    #[test]
    fn wrong_password_fails() {
        let envelope =
            attach_password_envelope(&sample_keys(), "correct horse battery staple").unwrap();
        let err = resolve_keys_from_password(&envelope, "wrong password something else");
        assert!(err.is_err());
        assert!(!verify_password(&envelope, "wrong password something else"));
        assert!(verify_password(&envelope, "correct horse battery staple"));
    }

    #[test]
    fn short_password_rejected() {
        let err = attach_password_envelope(&sample_keys(), "abc").unwrap_err();
        assert!(err.contains("at least"));
    }

    #[test]
    fn unsupported_version_rejected() {
        let mut envelope =
            attach_password_envelope(&sample_keys(), "correct horse battery staple").unwrap();
        envelope.version = 99;
        assert!(resolve_keys_from_password(&envelope, "correct horse battery staple").is_err());
    }

    #[test]
    fn unsupported_kdf_rejected() {
        let mut envelope =
            attach_password_envelope(&sample_keys(), "correct horse battery staple").unwrap();
        envelope.kdf = "argon2".to_owned();
        assert!(resolve_keys_from_password(&envelope, "correct horse battery staple").is_err());
    }

    #[test]
    fn ciphertext_is_nondeterministic() {
        let keys = sample_keys();
        let a = attach_password_envelope(&keys, "correct horse battery staple").unwrap();
        let b = attach_password_envelope(&keys, "correct horse battery staple").unwrap();
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn vault_unlock_keys_variant_serialises_with_type_tag() {
        let yaml = serde_yaml::to_string(&VaultUnlock::Keys).unwrap();
        assert!(yaml.contains("type: keys"));
        assert!(!yaml.contains("envelope:"));

        let parsed: VaultUnlock = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, VaultUnlock::Keys);
        assert!(!parsed.is_password());
        assert!(parsed.password_envelope().is_none());
    }

    #[test]
    fn vault_unlock_password_variant_roundtrips() {
        let envelope =
            attach_password_envelope(&sample_keys(), "correct horse battery staple").unwrap();
        let value = VaultUnlock::Passwords {
            entries: vec![PasswordUnlockEntry {
                id: "entry-1".to_owned(),
                label: "john's password".to_owned(),
                created_at: "2026-06-23T00:00:00Z".to_owned(),
                envelope: envelope.clone(),
            }],
        };
        let yaml = serde_yaml::to_string(&value).unwrap();
        assert!(yaml.contains("type: password"));
        assert!(yaml.contains("entries:"));
        assert!(yaml.contains("john's password"));

        let parsed: VaultUnlock = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.is_password());
        assert_eq!(parsed.password_entries().len(), 1);
        assert_eq!(
            parsed.password_envelope().map(|e| e.ciphertext.trim()),
            Some(envelope.ciphertext.trim()),
        );
    }

    #[test]
    fn legacy_single_envelope_deserialises_to_one_entry() {
        let envelope =
            attach_password_envelope(&sample_keys(), "correct horse battery staple").unwrap();
        let unlock = VaultUnlock::Passwords {
            entries: vec![legacy_password_entry(envelope)],
        };
        let yaml = serde_yaml::to_string(&unlock).unwrap();
        let reparsed: VaultUnlock = serde_yaml::from_str(&yaml).unwrap();
        assert!(reparsed.is_password());
        assert_eq!(reparsed.password_entries().len(), 1);
    }
}
