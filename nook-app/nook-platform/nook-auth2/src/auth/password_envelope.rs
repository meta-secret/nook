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
//! See `.cortex/dev-core/product-specs/password-envelope.md` for the full design.

use crate::VaultKeys;
use crate::errors::{AgeCryptoError, PasswordError, PasswordResult};
use crate::{AgeArmoredCiphertext, SymmetricKey};
use age::secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use zeroize::{Zeroize, Zeroizing};

/// Scrypt work factor for human-chosen passwords (~1s on a 2024 mid-tier laptop).
/// Intentionally higher than `VaultCrypto`'s `log_n = 15`, which is tuned for
/// 128-bit random keys with no brute-force surface.
pub const PASSWORD_SCRYPT_LOG_N: u8 = 18;

/// Recommended minimum password length. UI layers should enforce a stricter
/// entropy policy; this is the absolute floor below which we refuse to wrap.
pub const PASSWORD_MIN_LENGTH: usize = 5;

/// Recommended floor for creating a new password-backed vault.
pub const PASSWORD_RECOMMENDED_MIN_LENGTH: usize = 8;

#[must_use]
pub fn vault_password_min_length() -> usize {
    PASSWORD_MIN_LENGTH
}

#[must_use]
pub fn is_vault_password_long_enough(password: &str) -> bool {
    password.len() >= PASSWORD_MIN_LENGTH
}

#[must_use]
pub fn vault_password_recommended_min_length() -> usize {
    PASSWORD_RECOMMENDED_MIN_LENGTH
}

#[must_use]
pub fn is_vault_password_recommended_length(password: &str) -> bool {
    password.trim().len() >= PASSWORD_RECOMMENDED_MIN_LENGTH
}

/// A labelled password unlock slot. Each entry wraps the same vault keys with
/// a distinct password so devices (or people) can maintain separate credentials.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PasswordUnlockEntry {
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub envelope: PasswordEnvelope,
}

/// On-disk password envelope. Salt + KDF params are embedded in the age
/// header; the `kdf` / `work_factor` fields are redundant hints for tooling.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PasswordEnvelope {
    pub version: u32,
    pub kdf: String,
    pub work_factor: u8,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub recipient: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub wrapped_keys: String,
    pub ciphertext: String,
}

/// The vault's active unlock mechanism — mutually exclusive across variants.
///
/// Serialised as YAML with `type:` tag plus per-variant data. When embedded
/// in the local materialized vault projection, the whole `unlock:` block is omitted for keys mode
/// (the default); backup passwords use `password_entries` instead.
///
/// ```yaml
/// # keys mode — no unlock: section
/// # OR password-only:
/// unlock:
///   type: password
///   entries:
///     - id: ...
///       label: "john's password"
///       created_at: ...
///       envelope: { version, kdf, work_factor, ciphertext }
/// ```
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
    },
}

impl Serialize for VaultUnlock {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Keys => VaultUnlockTagged::Keys.serialize(serializer),
            Self::Passwords { entries } => VaultUnlockTagged::Password {
                entries: entries.clone(),
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
            VaultUnlockTagged::Password { entries } => Self::Passwords { entries },
        })
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

    pub fn password_entry(&self, id: &str) -> PasswordResult<&PasswordUnlockEntry> {
        self.password_entries()
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| PasswordError::EntryNotFound {
                entry_id: id.to_owned(),
            })
    }

    pub fn password_envelope(&self) -> PasswordResult<&PasswordEnvelope> {
        self.password_entries()
            .first()
            .map(|entry| &entry.envelope)
            .ok_or(PasswordError::EnvelopeNotFound)
    }
}

/// Build a new labelled password entry from resolved vault keys.
pub fn create_password_entry(
    keys: &VaultKeys,
    id: &str,
    label: &str,
    created_at: &str,
    password: &str,
) -> PasswordResult<PasswordUnlockEntry> {
    create_password_entry_with_work_factor(
        keys,
        id,
        label,
        created_at,
        password,
        PASSWORD_SCRYPT_LOG_N,
    )
}

/// Build a labelled password entry with an explicit scrypt work factor.
///
/// This is primarily for browser test builds, where the age crate cannot
/// calibrate scrypt in wasm and high work factors block Chromium's main thread.
pub fn create_password_entry_with_work_factor(
    keys: &VaultKeys,
    id: &str,
    label: &str,
    created_at: &str,
    password: &str,
    work_factor: u8,
) -> PasswordResult<PasswordUnlockEntry> {
    let trimmed_label = label.trim();
    if trimmed_label.is_empty() {
        return Err(PasswordError::LabelEmpty);
    }
    Ok(PasswordUnlockEntry {
        id: id.to_owned(),
        label: trimmed_label.to_owned(),
        created_at: created_at.to_owned(),
        envelope: attach_password_envelope_with_work_factor(keys, password, work_factor)?,
    })
}

/// Resolve keys using a specific password entry.
pub fn resolve_keys_from_entry(
    entry: &PasswordUnlockEntry,
    password: &str,
) -> PasswordResult<VaultKeys> {
    resolve_keys_from_password(&entry.envelope, password)
}

/// Verify a password against a specific entry.
#[must_use]
pub fn verify_password_entry(entry: &PasswordUnlockEntry, password: &str) -> bool {
    resolve_keys_from_entry(entry, password).is_ok()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Zeroize)]
struct EnvelopePlaintext {
    secrets_key: String,
    members_key: String,
}

const LEGACY_ENVELOPE_VERSION: u32 = 1;
const ENVELOPE_VERSION: u32 = 2;
const ENVELOPE_KDF: &str = "scrypt";

/// Whether an envelope can follow a security-epoch key rotation without the
/// password plaintext.
#[must_use]
pub fn password_envelope_supports_key_rewrap(envelope: &PasswordEnvelope) -> bool {
    envelope.version == ENVELOPE_VERSION
}

/// Wrap `secrets_key` + `members_key` with a password-derived scrypt key.
pub fn attach_password_envelope(
    keys: &VaultKeys,
    password: &str,
) -> PasswordResult<PasswordEnvelope> {
    attach_password_envelope_with_work_factor(keys, password, PASSWORD_SCRYPT_LOG_N)
}

/// Wrap `secrets_key` + `members_key` with an explicit scrypt work factor.
pub fn attach_password_envelope_with_work_factor(
    keys: &VaultKeys,
    password: &str,
    work_factor: u8,
) -> PasswordResult<PasswordEnvelope> {
    if !(1..64).contains(&work_factor) {
        return Err(PasswordError::InvalidWorkFactor);
    }
    if !is_vault_password_long_enough(password) {
        return Err(PasswordError::TooShort {
            min: PASSWORD_MIN_LENGTH,
        });
    }

    let plaintext = encode_keys(keys)?;
    let wrapping_identity = age::x25519::Identity::generate();
    let recipient = wrapping_identity.to_public();
    let wrapped_keys = age_encrypt_recipient(&recipient, plaintext.as_bytes())?;
    let wrapping_identity = wrapping_identity.to_string();

    let secret = age::secrecy::SecretString::from(password.to_owned());
    let mut password_recipient = age::scrypt::Recipient::new(secret);
    password_recipient.set_work_factor(work_factor);
    let ciphertext = age_encrypt_scrypt(
        &password_recipient,
        wrapping_identity.expose_secret().as_bytes(),
    )?;

    Ok(PasswordEnvelope {
        version: ENVELOPE_VERSION,
        kdf: ENVELOPE_KDF.to_owned(),
        work_factor,
        recipient: recipient.to_string(),
        wrapped_keys: wrapped_keys.as_str().to_owned(),
        ciphertext: ciphertext.as_str().to_owned(),
    })
}

fn encode_keys(keys: &VaultKeys) -> PasswordResult<Zeroizing<String>> {
    let encoded = serde_json::to_string(&EnvelopePlaintext {
        secrets_key: keys.secrets_key.as_str().to_owned(),
        members_key: keys.members_key.as_str().to_owned(),
    })
    .map_err(PasswordError::EnvelopePlaintextSerialize)?;
    Ok(Zeroizing::new(encoded))
}

/// Re-wrap a version-2 password credential to fresh vault keys without the password.
pub fn rewrap_password_envelope(
    envelope: &PasswordEnvelope,
    keys: &VaultKeys,
) -> PasswordResult<PasswordEnvelope> {
    if envelope.version != ENVELOPE_VERSION {
        return Err(PasswordError::UnsupportedEnvelopeVersion {
            version: envelope.version,
        });
    }
    let recipient = envelope
        .recipient
        .parse::<age::x25519::Recipient>()
        .map_err(|error| {
            PasswordError::Age(AgeCryptoError::EnvelopeEncryptSetup(error.to_string()))
        })?;
    let plaintext = encode_keys(keys)?;
    let wrapped_keys = age_encrypt_recipient(&recipient, plaintext.as_bytes())?;
    let mut rewrapped = envelope.clone();
    wrapped_keys
        .as_str()
        .clone_into(&mut rewrapped.wrapped_keys);
    Ok(rewrapped)
}

/// Unwrap a password envelope to recover `secrets_key` + `members_key`.
pub fn resolve_keys_from_password(
    envelope: &PasswordEnvelope,
    password: &str,
) -> PasswordResult<VaultKeys> {
    if envelope.version != ENVELOPE_VERSION && envelope.version != LEGACY_ENVELOPE_VERSION {
        tracing::warn!(
            scope = "password-envelope",
            version = envelope.version,
            supported = ENVELOPE_VERSION,
            "unsupported password envelope version"
        );
        return Err(PasswordError::UnsupportedEnvelopeVersion {
            version: envelope.version,
        });
    }
    if envelope.kdf != ENVELOPE_KDF {
        tracing::warn!(
            scope = "password-envelope",
            kdf = envelope.kdf.as_str(),
            supported = ENVELOPE_KDF,
            "unsupported password envelope kdf"
        );
        return Err(PasswordError::UnsupportedEnvelopeKdf {
            kdf: envelope.kdf.clone(),
        });
    }

    let secret = age::secrecy::SecretString::from(password.to_owned());
    let identity = age::scrypt::Identity::new(secret);
    let mut password_plaintext = age_decrypt_scrypt(&identity, envelope.ciphertext.as_bytes())?;
    let mut plaintext_bytes = if envelope.version == LEGACY_ENVELOPE_VERSION {
        Zeroizing::new(std::mem::take(&mut *password_plaintext))
    } else {
        let wrapping_identity_text = Zeroizing::new(
            String::from_utf8(std::mem::take(&mut *password_plaintext))
                .map_err(PasswordError::EnvelopePlaintextUtf8)?,
        );
        let wrapping_identity = wrapping_identity_text
            .parse::<age::x25519::Identity>()
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeDecryptSetup(error.to_string()))
            })?;
        age_decrypt_identity(&wrapping_identity, envelope.wrapped_keys.as_bytes())?
    };
    let plaintext_str = Zeroizing::new(
        String::from_utf8(std::mem::take(&mut *plaintext_bytes))
            .map_err(PasswordError::EnvelopePlaintextUtf8)?,
    );
    let parsed = Zeroizing::new(
        serde_json::from_str::<EnvelopePlaintext>(plaintext_str.as_str())
            .map_err(PasswordError::EnvelopePlaintextJson)?,
    );

    Ok(VaultKeys {
        secrets_key: SymmetricKey::parse(&parsed.secrets_key)?,
        members_key: SymmetricKey::parse(&parsed.members_key)?,
    })
}

fn age_encrypt_recipient(
    recipient: &age::x25519::Recipient,
    plaintext: &[u8],
) -> PasswordResult<AgeArmoredCiphertext> {
    use age::armor::{ArmoredWriter, Format};

    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(recipient as &dyn age::Recipient))
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeEncryptSetup(error.to_string()))
            })?;
    let mut armored = Vec::new();
    let armor_writer =
        ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor).map_err(|error| {
            PasswordError::Age(AgeCryptoError::EnvelopeArmorWrap(error.to_string()))
        })?;
    let mut writer = encryptor
        .wrap_output(armor_writer)
        .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeEncrypt(error.to_string())))?;
    writer
        .write_all(plaintext)
        .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeWrite(error.to_string())))?;
    writer
        .finish()
        .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeFinish(error.to_string())))?
        .finish()
        .map_err(|error| {
            PasswordError::Age(AgeCryptoError::EnvelopeArmorFinish(error.to_string()))
        })?;
    String::from_utf8(armored)
        .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeInvalidUtf8(error.to_string())))
        .map(AgeArmoredCiphertext::from_trusted_armored)
}

fn age_decrypt_identity(
    identity: &age::x25519::Identity,
    armored: &[u8],
) -> PasswordResult<Zeroizing<Vec<u8>>> {
    use age::armor::ArmoredReader;

    let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(armored)).map_err(|error| {
        PasswordError::Age(AgeCryptoError::EnvelopeDecryptSetup(error.to_string()))
    })?;
    let mut reader = decryptor
        .decrypt(std::iter::once(identity as &dyn age::Identity))
        .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeDecrypt(error.to_string())))?;
    let mut plaintext = Zeroizing::new(Vec::new());
    reader
        .read_to_end(&mut plaintext)
        .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeRead(error.to_string())))?;
    Ok(plaintext)
}

/// Verify a password decrypts the envelope without exposing the unwrapped keys.
#[must_use]
pub fn verify_password(envelope: &PasswordEnvelope, password: &str) -> bool {
    resolve_keys_from_password(envelope, password).is_ok()
}

fn age_encrypt_scrypt(
    recipient: &age::scrypt::Recipient,
    plaintext: &[u8],
) -> PasswordResult<AgeArmoredCiphertext> {
    use age::armor::{ArmoredWriter, Format};

    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(recipient as &dyn age::Recipient))
            .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeEncryptSetup(e.to_string())))?;

    let mut armored = Vec::new();
    let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeArmorWrap(e.to_string())))?;
    let mut writer = encryptor
        .wrap_output(armor_writer)
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeEncrypt(e.to_string())))?;
    writer
        .write_all(plaintext)
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeWrite(e.to_string())))?;
    writer
        .finish()
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeFinish(e.to_string())))?
        .finish()
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeArmorFinish(e.to_string())))?;

    String::from_utf8(armored)
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeInvalidUtf8(e.to_string())))
        .map(AgeArmoredCiphertext::from_trusted_armored)
}

fn age_decrypt_scrypt(
    identity: &age::scrypt::Identity,
    armored: &[u8],
) -> PasswordResult<Zeroizing<Vec<u8>>> {
    use age::armor::ArmoredReader;

    let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(armored))
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeDecryptSetup(e.to_string())))?;
    let mut reader = decryptor
        .decrypt(std::iter::once(identity as &dyn age::Identity))
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeDecrypt(e.to_string())))?;

    let mut plaintext = Zeroizing::new(Vec::new());
    reader
        .read_to_end(&mut plaintext)
        .map_err(|e| PasswordError::Age(AgeCryptoError::EnvelopeRead(e.to_string())))?;
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_keys() -> anyhow::Result<VaultKeys> {
        Ok(VaultKeys {
            secrets_key: SymmetricKey::parse(&"deadbeefdeadbeefdeadbeefdeadbeef".repeat(2))?,
            members_key: SymmetricKey::parse(&"abadcafeabadcafeabadcafeabadcafe".repeat(2))?,
        })
    }

    #[test]
    fn roundtrip_attach_and_resolve() -> anyhow::Result<()> {
        let keys = sample_keys()?;
        let envelope = attach_password_envelope(&keys, "correct horse battery staple")?;
        assert_eq!(envelope.version, 2);
        assert_eq!(envelope.kdf, "scrypt");
        assert!(
            envelope
                .ciphertext
                .as_str()
                .contains("BEGIN AGE ENCRYPTED FILE")
        );

        let resolved = resolve_keys_from_password(&envelope, "correct horse battery staple")?;
        assert_eq!(resolved, keys);
        Ok(())
    }

    #[test]
    fn rewrap_preserves_password_and_updates_keys() -> anyhow::Result<()> {
        let envelope = attach_password_envelope(&sample_keys()?, "correct horse battery staple")?;
        let new_keys = VaultKeys {
            secrets_key: SymmetricKey::parse(&"cafebabecafebabecafebabecafebabe".repeat(2))?,
            members_key: SymmetricKey::parse(&"01234567012345670123456701234567".repeat(2))?,
        };
        let rewrapped = rewrap_password_envelope(&envelope, &new_keys)?;

        assert_eq!(rewrapped.ciphertext, envelope.ciphertext);
        assert_eq!(rewrapped.recipient, envelope.recipient);
        assert_ne!(rewrapped.wrapped_keys, envelope.wrapped_keys);
        assert_eq!(
            resolve_keys_from_password(&rewrapped, "correct horse battery staple")?,
            new_keys
        );
        Ok(())
    }

    #[test]
    fn wrong_password_fails() -> anyhow::Result<()> {
        let envelope = attach_password_envelope(&sample_keys()?, "correct horse battery staple")?;
        let err = resolve_keys_from_password(&envelope, "wrong password something else");
        assert!(err.is_err());
        assert!(!verify_password(&envelope, "wrong password something else"));
        assert!(verify_password(&envelope, "correct horse battery staple"));
        Ok(())
    }

    #[test]
    fn short_password_rejected() -> anyhow::Result<()> {
        let err = attach_password_envelope(&sample_keys()?, "abc")
            .err()
            .ok_or_else(|| anyhow::anyhow!("password envelope test should reject invalid input"))?;
        assert!(err.to_string().contains("at least"));
        Ok(())
    }

    #[test]
    fn exposes_password_length_floor() {
        assert_eq!(vault_password_min_length(), 5);
        assert!(!is_vault_password_long_enough("1234"));
        assert!(is_vault_password_long_enough("12345"));
    }

    #[test]
    fn exposes_recommended_password_length_floor() {
        assert_eq!(vault_password_recommended_min_length(), 8);
        assert!(!is_vault_password_recommended_length("1234567"));
        assert!(is_vault_password_recommended_length("12345678"));
        assert!(!is_vault_password_recommended_length(" 1234567 "));
    }

    #[test]
    fn unsupported_version_rejected() -> anyhow::Result<()> {
        let mut envelope =
            attach_password_envelope(&sample_keys()?, "correct horse battery staple")?;
        envelope.version = 99;
        assert!(resolve_keys_from_password(&envelope, "correct horse battery staple").is_err());
        Ok(())
    }

    #[test]
    fn legacy_envelope_requires_explicit_upgrade_before_key_rewrap() -> anyhow::Result<()> {
        let current = attach_password_envelope(&sample_keys()?, "correct horse battery staple")?;
        let mut legacy = current.clone();
        legacy.version = LEGACY_ENVELOPE_VERSION;

        assert!(password_envelope_supports_key_rewrap(&current));
        assert!(!password_envelope_supports_key_rewrap(&legacy));
        Ok(())
    }

    #[test]
    fn unsupported_kdf_rejected() -> anyhow::Result<()> {
        let mut envelope =
            attach_password_envelope(&sample_keys()?, "correct horse battery staple")?;
        envelope.kdf = "argon2".to_owned();
        assert!(resolve_keys_from_password(&envelope, "correct horse battery staple").is_err());
        Ok(())
    }

    #[test]
    fn ciphertext_is_nondeterministic() -> anyhow::Result<()> {
        let keys = sample_keys()?;
        let a = attach_password_envelope(&keys, "correct horse battery staple")?;
        let b = attach_password_envelope(&keys, "correct horse battery staple")?;
        assert_ne!(a.ciphertext, b.ciphertext);
        Ok(())
    }

    #[test]
    fn vault_unlock_keys_variant_serialises_with_type_tag() -> anyhow::Result<()> {
        let yaml = serde_yaml::to_string(&VaultUnlock::Keys)?;
        assert!(yaml.as_str().contains("type: keys"));
        assert!(!yaml.as_str().contains("envelope:"));

        let parsed: VaultUnlock = serde_yaml::from_str(&yaml)?;
        assert_eq!(parsed, VaultUnlock::Keys);
        assert!(!parsed.is_password());
        assert!(matches!(
            parsed.password_envelope(),
            Err(PasswordError::EnvelopeNotFound)
        ));
        Ok(())
    }

    #[test]
    fn vault_unlock_password_variant_roundtrips() -> anyhow::Result<()> {
        let envelope = attach_password_envelope(&sample_keys()?, "correct horse battery staple")?;
        let value = VaultUnlock::Passwords {
            entries: vec![PasswordUnlockEntry {
                id: "entry-1".to_owned(),
                label: "john's password".to_owned(),
                created_at: "2026-06-23T00:00:00Z".to_owned(),
                envelope: envelope.clone(),
            }],
        };
        let yaml = serde_yaml::to_string(&value)?;
        assert!(yaml.as_str().contains("type: password"));
        assert!(yaml.as_str().contains("entries:"));
        assert!(yaml.as_str().contains("john's password"));

        let parsed: VaultUnlock = serde_yaml::from_str(&yaml)?;
        assert!(parsed.is_password());
        assert_eq!(parsed.password_entries().len(), 1);
        assert_eq!(
            parsed.password_envelope()?.ciphertext.trim(),
            envelope.ciphertext.trim(),
        );
        Ok(())
    }
}
