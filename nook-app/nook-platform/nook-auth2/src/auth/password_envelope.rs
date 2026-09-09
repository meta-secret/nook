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
//! See `.cortex/teams/dev-core/product-specs/password-envelope.md` for the full design.

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::VaultKeys;
use crate::errors::{
    AgeCryptoError, PasswordError, PasswordResult, RejectedPasswordEnvelopeVersion,
};
use crate::{AgeArmoredCiphertext, PasswordCharacterCount, PasswordWorkFactor, SymmetricKey};
use age::{
    scrypt,
    secrecy::{self, ExposeSecret},
    x25519,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    iter, mem,
};
use zeroize::{Zeroize, Zeroizing};

/// Scrypt work factor for human-chosen passwords (~1s on a 2024 mid-tier laptop).
/// Intentionally higher than `VaultCrypto`'s `log_n = 15`, which is tuned for
/// 128-bit random keys with no brute-force surface.
pub const PASSWORD_SCRYPT_LOG_N: PasswordWorkFactor = PasswordWorkFactor(18);

/// Recommended minimum password length. UI layers should enforce a stricter
/// entropy policy; this is the absolute floor below which we refuse to wrap.
pub const PASSWORD_MIN_LENGTH: PasswordCharacterCount = PasswordCharacterCount::VAULT_MINIMUM;

/// Recommended floor for creating a new password-backed vault.
pub const PASSWORD_RECOMMENDED_MIN_LENGTH: PasswordCharacterCount =
    PasswordCharacterCount::RECOMMENDED_MINIMUM;

/// Password policy for password-backed vault unlock entries.
pub struct PasswordPolicy;

impl PasswordPolicy {
    #[must_use]
    pub fn min_length() -> PasswordCharacterCount {
        PASSWORD_MIN_LENGTH
    }

    #[must_use]
    pub fn is_long_enough(password: &str) -> bool {
        password.len() >= PASSWORD_MIN_LENGTH.into()
    }

    #[must_use]
    pub fn recommended_min_length() -> PasswordCharacterCount {
        PASSWORD_RECOMMENDED_MIN_LENGTH
    }

    #[must_use]
    pub fn is_recommended_length(password: &str) -> bool {
        password.trim().len() >= PASSWORD_RECOMMENDED_MIN_LENGTH.into()
    }
}

/// A labelled password unlock slot. Each entry wraps the same vault keys with
/// a distinct password so devices (or people) can maintain separate credentials.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
pub struct PasswordUnlockEntry {
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub envelope: PasswordEnvelope,
}

/// On-disk password envelope. Salt + KDF params are embedded in the age
/// header; the `kdf` / `work_factor` fields are redundant hints for tooling.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
pub struct PasswordEnvelope {
    pub version: PasswordEnvelopeVersion,
    pub kdf: String,
    pub work_factor: PasswordWorkFactor,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub recipient: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub wrapped_keys: String,
    pub ciphertext: String,
}

/// Supported persisted password-envelope wire versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, tsify::Tsify)]
#[serde(try_from = "u32")]
pub struct PasswordEnvelopeVersion(u32);

impl PasswordEnvelopeVersion {
    pub const LEGACY: Self = Self(1);
    pub const CURRENT: Self = Self(2);
}

impl From<PasswordEnvelopeVersion> for u32 {
    fn from(value: PasswordEnvelopeVersion) -> Self {
        value.0
    }
}

impl TryFrom<u32> for PasswordEnvelopeVersion {
    type Error = RejectedPasswordEnvelopeVersion;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: admits the existing numeric wire representation"
        )
    )]
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::LEGACY),
            2 => Ok(Self::CURRENT),
            _ => Err(RejectedPasswordEnvelopeVersion::from_raw(value)),
        }
    }
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
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(from = "VaultUnlockTagged")]
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

impl From<VaultUnlockTagged> for VaultUnlock {
    fn from(tagged: VaultUnlockTagged) -> Self {
        match tagged {
            VaultUnlockTagged::Keys => Self::Keys,
            VaultUnlockTagged::Password { entries } => Self::Passwords { entries },
        }
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

impl PasswordEnvelope {
    /// Whether this envelope can be rewrapped without the password plaintext.
    #[must_use]
    pub fn supports_key_rewrap(&self) -> bool {
        self.version == PasswordEnvelopeVersion::CURRENT
    }

    /// Verify a password without exposing the unwrapped keys.
    #[must_use]
    pub fn verify_password(&self, password: &str) -> bool {
        PasswordEnvelopeResolution::new(self, password)
            .resolve()
            .is_ok()
    }

    fn encode_keys(keys: &VaultKeys) -> PasswordResult<Zeroizing<String>> {
        let encoded = serde_json::to_string(&EnvelopePlaintext {
            secrets_key: keys.secrets_key.as_str().to_owned(),
            members_key: keys.members_key.as_str().to_owned(),
        })
        .map_err(PasswordError::EnvelopePlaintextSerialize)?;
        Ok(Zeroizing::new(encoded))
    }

    fn encrypt_recipient(
        recipient: &x25519::Recipient,
        plaintext: &[u8],
    ) -> PasswordResult<AgeArmoredCiphertext> {
        use age::armor::{ArmoredWriter, Format};

        let encryptor =
            age::Encryptor::with_recipients(iter::once(recipient as &dyn age::Recipient)).map_err(
                |error| PasswordError::Age(AgeCryptoError::EnvelopeEncryptSetup(error.to_string())),
            )?;
        let mut armored = Vec::new();
        let armor_writer =
            ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor).map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeArmorWrap(error.to_string()))
            })?;
        let mut writer = encryptor.wrap_output(armor_writer).map_err(|error| {
            PasswordError::Age(AgeCryptoError::EnvelopeEncrypt(error.to_string()))
        })?;
        writer.write_all(plaintext).map_err(|error| {
            PasswordError::Age(AgeCryptoError::EnvelopeWrite(error.to_string()))
        })?;
        writer
            .finish()
            .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeFinish(error.to_string())))?
            .finish()
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeArmorFinish(error.to_string()))
            })?;
        String::from_utf8(armored)
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeInvalidUtf8(error.to_string()))
            })
            .map(AgeArmoredCiphertext::from_trusted_armored)
    }

    fn decrypt_identity(
        identity: &x25519::Identity,
        armored: &[u8],
    ) -> PasswordResult<Zeroizing<Vec<u8>>> {
        use age::armor::ArmoredReader;

        let decryptor =
            age::Decryptor::new_buffered(ArmoredReader::new(armored)).map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeDecryptSetup(error.to_string()))
            })?;
        let mut reader = decryptor
            .decrypt(iter::once(identity as &dyn age::Identity))
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeDecrypt(error.to_string()))
            })?;
        let mut plaintext = Zeroizing::new(Vec::new());
        reader
            .read_to_end(&mut plaintext)
            .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeRead(error.to_string())))?;
        Ok(plaintext)
    }

    fn encrypt_scrypt(
        recipient: &scrypt::Recipient,
        plaintext: &[u8],
    ) -> PasswordResult<AgeArmoredCiphertext> {
        use age::armor::{ArmoredWriter, Format};

        let encryptor =
            age::Encryptor::with_recipients(iter::once(recipient as &dyn age::Recipient)).map_err(
                |error| PasswordError::Age(AgeCryptoError::EnvelopeEncryptSetup(error.to_string())),
            )?;

        let mut armored = Vec::new();
        let armor_writer =
            ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor).map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeArmorWrap(error.to_string()))
            })?;
        let mut writer = encryptor.wrap_output(armor_writer).map_err(|error| {
            PasswordError::Age(AgeCryptoError::EnvelopeEncrypt(error.to_string()))
        })?;
        writer.write_all(plaintext).map_err(|error| {
            PasswordError::Age(AgeCryptoError::EnvelopeWrite(error.to_string()))
        })?;
        writer
            .finish()
            .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeFinish(error.to_string())))?
            .finish()
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeArmorFinish(error.to_string()))
            })?;

        String::from_utf8(armored)
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeInvalidUtf8(error.to_string()))
            })
            .map(AgeArmoredCiphertext::from_trusted_armored)
    }

    fn decrypt_scrypt(
        identity: &scrypt::Identity,
        armored: &[u8],
    ) -> PasswordResult<Zeroizing<Vec<u8>>> {
        use age::armor::ArmoredReader;

        let decryptor =
            age::Decryptor::new_buffered(ArmoredReader::new(armored)).map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeDecryptSetup(error.to_string()))
            })?;
        let mut reader = decryptor
            .decrypt(iter::once(identity as &dyn age::Identity))
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeDecrypt(error.to_string()))
            })?;

        let mut plaintext = Zeroizing::new(Vec::new());
        reader
            .read_to_end(&mut plaintext)
            .map_err(|error| PasswordError::Age(AgeCryptoError::EnvelopeRead(error.to_string())))?;
        Ok(plaintext)
    }
}

impl PasswordUnlockEntry {
    /// Verify a password without exposing the unwrapped keys.
    #[must_use]
    pub fn verify_password(&self, password: &str) -> bool {
        PasswordEntryResolution::new(self, password)
            .resolve()
            .is_ok()
    }
}

/// Borrowed vault keys and password metadata awaiting consuming entry issuance.
pub struct PasswordEntryIssuance<'a> {
    keys: &'a VaultKeys,
    id: &'a str,
    label: &'a str,
    created_at: &'a str,
    password: &'a str,
    work_factor: PasswordWorkFactor,
}

impl<'a> PasswordEntryIssuance<'a> {
    #[must_use]
    pub fn new(
        keys: &'a VaultKeys,
        id: &'a str,
        label: &'a str,
        created_at: &'a str,
        password: &'a str,
    ) -> Self {
        Self::with_work_factor(keys, id, label, created_at, password, PASSWORD_SCRYPT_LOG_N)
    }

    #[must_use]
    pub fn with_work_factor(
        keys: &'a VaultKeys,
        id: &'a str,
        label: &'a str,
        created_at: &'a str,
        password: &'a str,
        work_factor: PasswordWorkFactor,
    ) -> Self {
        Self {
            keys,
            id,
            label,
            created_at,
            password,
            work_factor,
        }
    }

    /// Consume the issuance state into one labelled password entry.
    pub fn issue(self) -> PasswordResult<PasswordUnlockEntry> {
        let trimmed_label = self.label.trim();
        if trimmed_label.is_empty() {
            return Err(PasswordError::LabelEmpty);
        }
        Ok(PasswordUnlockEntry {
            id: self.id.to_owned(),
            label: trimmed_label.to_owned(),
            created_at: self.created_at.to_owned(),
            envelope: PasswordEnvelopeAttachment::with_work_factor(
                self.keys,
                self.password,
                self.work_factor,
            )
            .attach()?,
        })
    }
}

/// Borrowed vault keys and password awaiting consuming envelope attachment.
pub struct PasswordEnvelopeAttachment<'a> {
    keys: &'a VaultKeys,
    password: &'a str,
    work_factor: PasswordWorkFactor,
}

impl<'a> PasswordEnvelopeAttachment<'a> {
    #[must_use]
    pub fn new(keys: &'a VaultKeys, password: &'a str) -> Self {
        Self::with_work_factor(keys, password, PASSWORD_SCRYPT_LOG_N)
    }

    #[must_use]
    pub fn with_work_factor(
        keys: &'a VaultKeys,
        password: &'a str,
        work_factor: PasswordWorkFactor,
    ) -> Self {
        Self {
            keys,
            password,
            work_factor,
        }
    }

    /// Consume the attachment state into one password envelope.
    pub fn attach(self) -> PasswordResult<PasswordEnvelope> {
        let raw_work_factor = u8::from(self.work_factor);
        if !(1..64).contains(&raw_work_factor) {
            return Err(PasswordError::InvalidWorkFactor);
        }
        if !PasswordPolicy::is_long_enough(self.password) {
            return Err(PasswordError::TooShort {
                min: PASSWORD_MIN_LENGTH,
            });
        }

        let plaintext = PasswordEnvelope::encode_keys(self.keys)?;
        let wrapping_identity = x25519::Identity::generate();
        let recipient = wrapping_identity.to_public();
        let wrapped_keys = PasswordEnvelope::encrypt_recipient(&recipient, plaintext.as_bytes())?;
        let wrapping_identity = wrapping_identity.to_string();

        let secret = secrecy::SecretString::from(self.password.to_owned());
        let mut password_recipient = scrypt::Recipient::new(secret);
        password_recipient.set_work_factor(raw_work_factor);
        let ciphertext = PasswordEnvelope::encrypt_scrypt(
            &password_recipient,
            wrapping_identity.expose_secret().as_bytes(),
        )?;

        Ok(PasswordEnvelope {
            version: PasswordEnvelopeVersion::CURRENT,
            kdf: ENVELOPE_KDF.to_owned(),
            work_factor: self.work_factor,
            recipient: recipient.to_string(),
            wrapped_keys: wrapped_keys.as_str().to_owned(),
            ciphertext: ciphertext.as_str().to_owned(),
        })
    }
}

/// Borrowed password envelope and password awaiting consuming key resolution.
pub struct PasswordEnvelopeResolution<'a> {
    envelope: &'a PasswordEnvelope,
    password: &'a str,
}

impl<'a> PasswordEnvelopeResolution<'a> {
    #[must_use]
    pub fn new(envelope: &'a PasswordEnvelope, password: &'a str) -> Self {
        Self { envelope, password }
    }

    /// Consume the resolution state into the wrapped vault keys.
    pub fn resolve(self) -> PasswordResult<VaultKeys> {
        if self.envelope.kdf != ENVELOPE_KDF {
            tracing::warn!(
                scope = "password-envelope",
                kdf = self.envelope.kdf.as_str(),
                supported = ENVELOPE_KDF,
                "unsupported password envelope kdf"
            );
            return Err(PasswordError::UnsupportedEnvelopeKdf {
                kdf: self.envelope.kdf.clone(),
            });
        }

        let secret = secrecy::SecretString::from(self.password.to_owned());
        let identity = scrypt::Identity::new(secret);
        let mut password_plaintext =
            PasswordEnvelope::decrypt_scrypt(&identity, self.envelope.ciphertext.as_bytes())?;
        let mut plaintext_bytes = if self.envelope.version == PasswordEnvelopeVersion::LEGACY {
            Zeroizing::new(mem::take(&mut *password_plaintext))
        } else {
            let wrapping_identity_text = Zeroizing::new(
                String::from_utf8(mem::take(&mut *password_plaintext))
                    .map_err(PasswordError::EnvelopePlaintextUtf8)?,
            );
            let wrapping_identity =
                wrapping_identity_text
                    .parse::<x25519::Identity>()
                    .map_err(|error| {
                        PasswordError::Age(AgeCryptoError::EnvelopeDecryptSetup(error.to_string()))
                    })?;
            PasswordEnvelope::decrypt_identity(
                &wrapping_identity,
                self.envelope.wrapped_keys.as_bytes(),
            )?
        };
        let plaintext_str = Zeroizing::new(
            String::from_utf8(mem::take(&mut *plaintext_bytes))
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
}

/// Borrowed password entry and password awaiting consuming key resolution.
pub struct PasswordEntryResolution<'a> {
    entry: &'a PasswordUnlockEntry,
    password: &'a str,
}

impl<'a> PasswordEntryResolution<'a> {
    #[must_use]
    pub fn new(entry: &'a PasswordUnlockEntry, password: &'a str) -> Self {
        Self { entry, password }
    }

    /// Consume the resolution state into the wrapped vault keys.
    pub fn resolve(self) -> PasswordResult<VaultKeys> {
        PasswordEnvelopeResolution::new(&self.entry.envelope, self.password).resolve()
    }
}

/// Borrowed current envelope and replacement keys awaiting consuming rewrap.
pub struct PasswordEnvelopeRewrap<'a> {
    envelope: &'a PasswordEnvelope,
    keys: &'a VaultKeys,
}

impl<'a> PasswordEnvelopeRewrap<'a> {
    #[must_use]
    pub fn new(envelope: &'a PasswordEnvelope, keys: &'a VaultKeys) -> Self {
        Self { envelope, keys }
    }

    /// Consume the rewrap state into a fresh envelope with the same password.
    pub fn rewrap(self) -> PasswordResult<PasswordEnvelope> {
        if self.envelope.version != PasswordEnvelopeVersion::CURRENT {
            return Err(PasswordError::UnsupportedEnvelopeVersion {
                version: RejectedPasswordEnvelopeVersion::from_raw(self.envelope.version.into()),
            });
        }
        let recipient = self
            .envelope
            .recipient
            .parse::<x25519::Recipient>()
            .map_err(|error| {
                PasswordError::Age(AgeCryptoError::EnvelopeEncryptSetup(error.to_string()))
            })?;
        let plaintext = PasswordEnvelope::encode_keys(self.keys)?;
        let wrapped_keys = PasswordEnvelope::encrypt_recipient(&recipient, plaintext.as_bytes())?;
        let mut rewrapped = self.envelope.clone();
        wrapped_keys
            .as_str()
            .clone_into(&mut rewrapped.wrapped_keys);
        Ok(rewrapped)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Zeroize)]
struct EnvelopePlaintext {
    secrets_key: String,
    members_key: String,
}

const ENVELOPE_KDF: &str = "scrypt";

#[cfg(test)]
mod tests {
    use super::*;

    struct TestFixtures;

    impl TestFixtures {
        fn sample_keys() -> anyhow::Result<VaultKeys> {
            Ok(VaultKeys {
                secrets_key: SymmetricKey::parse(&"deadbeefdeadbeefdeadbeefdeadbeef".repeat(2))?,
                members_key: SymmetricKey::parse(&"abadcafeabadcafeabadcafeabadcafe".repeat(2))?,
            })
        }
    }

    #[test]
    fn roundtrip_attach_and_resolve() -> anyhow::Result<()> {
        let keys = TestFixtures::sample_keys()?;
        let envelope =
            PasswordEnvelopeAttachment::new(&keys, "correct horse battery staple").attach()?;
        assert_eq!(envelope.version, PasswordEnvelopeVersion::CURRENT);
        assert_eq!(envelope.kdf, "scrypt");
        assert!(
            envelope
                .ciphertext
                .as_str()
                .contains("BEGIN AGE ENCRYPTED FILE")
        );

        let resolved =
            PasswordEnvelopeResolution::new(&envelope, "correct horse battery staple").resolve()?;
        assert_eq!(resolved, keys);
        Ok(())
    }

    #[test]
    fn rewrap_preserves_password_and_updates_keys() -> anyhow::Result<()> {
        let keys = TestFixtures::sample_keys()?;
        let envelope =
            PasswordEnvelopeAttachment::new(&keys, "correct horse battery staple").attach()?;
        let new_keys = VaultKeys {
            secrets_key: SymmetricKey::parse(&"cafebabecafebabecafebabecafebabe".repeat(2))?,
            members_key: SymmetricKey::parse(&"01234567012345670123456701234567".repeat(2))?,
        };
        let rewrapped = PasswordEnvelopeRewrap::new(&envelope, &new_keys).rewrap()?;

        assert_eq!(rewrapped.ciphertext, envelope.ciphertext);
        assert_eq!(rewrapped.recipient, envelope.recipient);
        assert_ne!(rewrapped.wrapped_keys, envelope.wrapped_keys);
        assert_eq!(
            PasswordEnvelopeResolution::new(&rewrapped, "correct horse battery staple")
                .resolve()?,
            new_keys
        );
        Ok(())
    }

    #[test]
    fn wrong_password_fails() -> anyhow::Result<()> {
        let keys = TestFixtures::sample_keys()?;
        let envelope =
            PasswordEnvelopeAttachment::new(&keys, "correct horse battery staple").attach()?;
        let err =
            PasswordEnvelopeResolution::new(&envelope, "wrong password something else").resolve();
        assert!(err.is_err());
        assert!(!envelope.verify_password("wrong password something else"));
        assert!(envelope.verify_password("correct horse battery staple"));
        Ok(())
    }

    #[test]
    fn short_password_rejected() -> anyhow::Result<()> {
        let keys = TestFixtures::sample_keys()?;
        let err = PasswordEnvelopeAttachment::new(&keys, "abc")
            .attach()
            .err()
            .ok_or_else(|| anyhow::anyhow!("password envelope test should reject invalid input"))?;
        assert!(err.to_string().contains("at least"));
        Ok(())
    }

    #[test]
    fn exposes_password_length_floor() {
        assert_eq!(usize::from(PasswordPolicy::min_length()), 5);
        assert!(!PasswordPolicy::is_long_enough("1234"));
        assert!(PasswordPolicy::is_long_enough("12345"));
    }

    #[test]
    fn exposes_recommended_password_length_floor() {
        assert_eq!(usize::from(PasswordPolicy::recommended_min_length()), 8);
        assert!(!PasswordPolicy::is_recommended_length("1234567"));
        assert!(PasswordPolicy::is_recommended_length("12345678"));
        assert!(!PasswordPolicy::is_recommended_length(" 1234567 "));
    }

    #[test]
    fn password_envelope_versions_roundtrip_as_validated_scalars() -> anyhow::Result<()> {
        for version in [
            PasswordEnvelopeVersion::LEGACY,
            PasswordEnvelopeVersion::CURRENT,
        ] {
            let encoded = serde_json::to_string(&version)?;
            assert_eq!(
                serde_json::from_str::<PasswordEnvelopeVersion>(&encoded)?,
                version
            );
        }
        for unsupported in ["0", "3", "99", "4294967296"] {
            assert!(serde_json::from_str::<PasswordEnvelopeVersion>(unsupported).is_err());
        }
        Ok(())
    }

    #[test]
    fn legacy_envelope_requires_explicit_upgrade_before_key_rewrap() -> anyhow::Result<()> {
        let keys = TestFixtures::sample_keys()?;
        let current =
            PasswordEnvelopeAttachment::new(&keys, "correct horse battery staple").attach()?;
        let mut legacy = current.clone();
        legacy.version = PasswordEnvelopeVersion::LEGACY;

        assert!(current.supports_key_rewrap());
        assert!(!legacy.supports_key_rewrap());
        Ok(())
    }

    #[test]
    fn unsupported_kdf_rejected() -> anyhow::Result<()> {
        let keys = TestFixtures::sample_keys()?;
        let mut envelope =
            PasswordEnvelopeAttachment::new(&keys, "correct horse battery staple").attach()?;
        envelope.kdf = "argon2".to_owned();
        assert!(
            PasswordEnvelopeResolution::new(&envelope, "correct horse battery staple")
                .resolve()
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn ciphertext_is_nondeterministic() -> anyhow::Result<()> {
        let keys = TestFixtures::sample_keys()?;
        let a = PasswordEnvelopeAttachment::new(&keys, "correct horse battery staple").attach()?;
        let b = PasswordEnvelopeAttachment::new(&keys, "correct horse battery staple").attach()?;
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
        let keys = TestFixtures::sample_keys()?;
        let envelope =
            PasswordEnvelopeAttachment::new(&keys, "correct horse battery staple").attach()?;
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
