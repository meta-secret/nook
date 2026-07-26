//! Typed key-access and crypto strings.

use crate::CompactToken;
use crate::errors::{ValidationError, ValidationResult};
use age::x25519::{Identity, Recipient};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use zeroize::Zeroize;

const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";
const HEX_32_BYTE_LEN: usize = 64;

#[doc(hidden)]
#[macro_export]
macro_rules! transparent_str_newtype {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(String);

        impl $name {
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }

            #[must_use]
            pub fn into_inner(mut self) -> String {
                std::mem::take(&mut self.0)
            }

            #[must_use]
            pub fn from_trusted(value: String) -> Self {
                Self(value)
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.0)
            }
        }
    };
}

transparent_str_newtype!(SymmetricKey);
transparent_str_newtype!(AgeArmoredCiphertext);
transparent_str_newtype!(DevicePublicKey);
transparent_str_newtype!(MemberLabel);
transparent_str_newtype!(PasswordEntryId);
transparent_str_newtype!(OpaqueCiphertext);
transparent_str_newtype!(DecryptedPlaintext);
transparent_str_newtype!(SigningSeedHex);

impl DecryptedPlaintext {
    pub fn zeroize_plaintext(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for DecryptedPlaintext {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DeviceIdentitySecret(String);

impl DeviceIdentitySecret {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        std::mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for DeviceIdentitySecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DeviceIdentitySecret([REDACTED])")
    }
}

impl fmt::Display for DeviceIdentitySecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for DeviceIdentitySecret {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for DeviceIdentitySecret {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl Drop for DeviceIdentitySecret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl SymmetricKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let key = raw.trim();
        if key.len() != HEX_32_BYTE_LEN || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::SymmetricKeyInvalid);
        }
        Ok(Self(key.to_owned()))
    }

    pub fn generate() -> ValidationResult<Self> {
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).map_err(|_| ValidationError::SymmetricKeyInvalid)?;
        Ok(Self(hex::encode(bytes)))
    }
}

impl<'de> Deserialize<'de> for SymmetricKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

impl AgeArmoredCiphertext {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        if !raw.contains(AGE_ARMOR_MARKER) {
            return Err(ValidationError::AgeArmoredInvalid);
        }
        Ok(Self(raw.to_owned()))
    }

    #[must_use]
    pub fn from_trusted_armored(value: String) -> Self {
        Self(value)
    }
}

impl<'de> Deserialize<'de> for AgeArmoredCiphertext {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

impl DevicePublicKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let key = raw.trim();
        key.parse::<Recipient>()
            .map(|_| Self(key.to_owned()))
            .map_err(|_| ValidationError::DevicePublicKeyInvalid)
    }
}

impl<'de> Deserialize<'de> for DevicePublicKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

impl DeviceIdentitySecret {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let secret = raw.trim();
        secret
            .parse::<Identity>()
            .map(|_| Self(secret.to_owned()))
            .map_err(|_| ValidationError::DeviceIdentitySecretInvalid)
    }
}

impl<'de> Deserialize<'de> for DeviceIdentitySecret {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

impl SigningSeedHex {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let seed = raw.trim();
        if seed.len() != HEX_32_BYTE_LEN || !seed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::SigningSeedInvalid);
        }
        Ok(Self(seed.to_owned()))
    }
}

impl<'de> Deserialize<'de> for SigningSeedHex {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// Bare SHA-256 hex digest (64 chars).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Sha256Hex(String);

impl Sha256Hex {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let hex = raw.trim();
        if hex.len() != HEX_32_BYTE_LEN || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::Sha256HexInvalid);
        }
        Ok(Self(hex.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for Sha256Hex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for Sha256Hex {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for Sha256Hex {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Sha256Hex {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// Ed25519 verifying-key state used by persisted membership and event records.
///
/// Model an unavailable key explicitly instead of using `Option<T>` in domain
/// code. Current signed events require an `Ed25519Hex` value.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DeviceSigningPublicKey {
    #[default]
    Unavailable,
    Ed25519Hex(String),
}

impl DeviceSigningPublicKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let hex = raw.trim();
        if hex.is_empty() {
            return Ok(Self::Unavailable);
        }
        if hex.len() != HEX_32_BYTE_LEN || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::DeviceSigningPublicKeyInvalid);
        }
        Ok(Self::Ed25519Hex(hex.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Unavailable => "",
            Self::Ed25519Hex(value) => value,
        }
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        match self {
            Self::Unavailable => String::new(),
            Self::Ed25519Hex(value) => value,
        }
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        if value.is_empty() {
            Self::Unavailable
        } else {
            Self::Ed25519Hex(value)
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self, Self::Unavailable)
    }
}

impl fmt::Display for DeviceSigningPublicKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for DeviceSigningPublicKey {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Serialize for DeviceSigningPublicKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for DeviceSigningPublicKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// RFC 3339 timestamp string (`created_at`, `enrolled_at`, `requested_at`, ...).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct IsoTimestamp(String);

impl IsoTimestamp {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let ts = raw.trim();
        if ts.is_empty() {
            return Err(ValidationError::IsoTimestampInvalid);
        }
        if !ts.contains('T') && !ts.chars().any(|ch| ch.is_ascii_digit()) {
            return Err(ValidationError::IsoTimestampInvalid);
        }
        Ok(Self(ts.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for IsoTimestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for IsoTimestamp {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for IsoTimestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for IsoTimestamp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

impl PasswordEntryId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let id = raw.trim();
        if id.is_empty() {
            return Err(ValidationError::PasswordEntryIdInvalid);
        }
        CompactToken::parse(id)?;
        Ok(Self(id.to_owned()))
    }
}

impl<'de> Deserialize<'de> for PasswordEntryId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for MemberLabel {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(Self(raw))
    }
}

impl<'de> Deserialize<'de> for OpaqueCiphertext {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(Self(raw))
    }
}

/// Alias for compact URL-safe base64 ids (`generate_id` — 11 chars).
pub type Url64EncodedString = CompactToken;

#[cfg(test)]
mod tests {
    use super::*;
    use age::secrecy::ExposeSecret;
    use age::x25519::Identity;

    #[test]
    fn symmetric_key_roundtrip_and_generate() {
        let key = SymmetricKey::generate().expect("wire test setup should succeed");
        assert_eq!(key.as_str().len(), 64);
        assert_eq!(
            SymmetricKey::parse(key.as_str()).expect("wire test setup should succeed"),
            key
        );
        assert_eq!(key.to_string(), key.as_str());
        assert_eq!(key.into_inner().len(), 64);
    }

    #[test]
    fn age_armored_accepts_valid_armor() {
        let armor = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n-----END AGE ENCRYPTED FILE-----";
        let parsed = AgeArmoredCiphertext::parse(armor).expect("wire test setup should succeed");
        assert_eq!(parsed.as_str(), armor);
        let trusted = AgeArmoredCiphertext::from_trusted_armored(armor.to_owned());
        assert_eq!(parsed, trusted);
    }

    #[test]
    fn device_keys_parse_from_generated_identity() {
        let identity = Identity::generate();
        let public = identity.to_public().to_string();
        let secret = identity.to_string().expose_secret().to_owned();
        let pk = DevicePublicKey::parse(&public).expect("wire test setup should succeed");
        assert_eq!(pk.as_str(), public);
        let sk = DeviceIdentitySecret::parse(&secret).expect("wire test setup should succeed");
        assert_eq!(sk.as_str(), secret);
        assert_eq!(format!("{sk:?}"), "DeviceIdentitySecret([REDACTED])");
    }

    #[test]
    fn sha256_hex_parse_and_serde() {
        let hex = Sha256Hex::from_trusted("deadbeef".repeat(8));
        assert_eq!(
            Sha256Hex::parse(hex.as_str()).expect("wire test setup should succeed"),
            hex
        );
        assert!(Sha256Hex::parse("short").is_err());
        let roundtripped: Sha256Hex = serde_json::from_str(
            &serde_json::to_string(&hex).expect("wire test setup should succeed"),
        )
        .expect("wire test setup should succeed");
        assert_eq!(roundtripped, hex);
    }

    #[test]
    fn device_signing_public_key_names_unavailable_and_ed25519_states() {
        assert_eq!(
            DeviceSigningPublicKey::parse("").expect("wire test setup should succeed"),
            DeviceSigningPublicKey::Unavailable
        );
        let pk = DeviceSigningPublicKey::from_trusted("ab".repeat(32));
        assert!(matches!(&pk, DeviceSigningPublicKey::Ed25519Hex(_)));
        assert_eq!(
            DeviceSigningPublicKey::parse(pk.as_str()).expect("wire test setup should succeed"),
            pk
        );
        assert!(DeviceSigningPublicKey::parse("not-hex").is_err());
    }

    #[test]
    fn password_entry_id_requires_compact_token() {
        let id = PasswordEntryId::parse("pwdentry001").expect("wire test setup should succeed");
        assert_eq!(
            PasswordEntryId::parse(id.as_str()).expect("wire test setup should succeed"),
            id
        );
        assert!(PasswordEntryId::parse("").is_err());
        assert!(PasswordEntryId::parse("too-long-token-value").is_err());
    }

    #[test]
    fn invalid_key_and_ciphertext_strings_fail_validation() {
        assert!(SymmetricKey::parse("short").is_err());
        assert!(SymmetricKey::parse(&"zz".repeat(32)).is_err());
        assert!(AgeArmoredCiphertext::parse("plain text").is_err());
        assert!(DevicePublicKey::parse("not-an-age-recipient").is_err());
        assert!(DeviceIdentitySecret::parse("not-an-age-secret").is_err());
        assert!(SigningSeedHex::parse("short").is_err());
        assert!(SigningSeedHex::parse(&"zz".repeat(32)).is_err());
        assert!(IsoTimestamp::parse("").is_err());
        assert!(IsoTimestamp::parse("not-a-date").is_err());
    }

    #[test]
    fn string_newtypes_expose_display_as_ref_and_inner_values() {
        let seed_hex = "ab".repeat(32);
        let seed = SigningSeedHex::parse(&seed_hex).expect("wire test setup should succeed");
        assert_eq!(seed.as_str(), seed_hex);
        assert_eq!(seed.as_ref(), seed_hex);
        assert_eq!(seed.to_string(), seed_hex);
        assert_eq!(
            serde_json::to_string(&seed).expect("wire test setup should succeed"),
            format!("\"{seed_hex}\"")
        );
        assert_eq!(seed.clone().into_inner(), seed_hex);

        let trusted_seed = SigningSeedHex::from_trusted(seed_hex.clone());
        assert_eq!(trusted_seed, seed);

        let label = MemberLabel::from_trusted("Laptop".to_owned());
        assert_eq!(label.as_str(), "Laptop");
        assert_eq!(label.as_ref(), "Laptop");
        assert_eq!(label.to_string(), "Laptop");
        assert_eq!(label.clone().into_inner(), "Laptop");
        let decoded_label: MemberLabel =
            serde_json::from_str("\"Laptop\"").expect("wire test setup should succeed");
        assert_eq!(decoded_label, label);

        let opaque = OpaqueCiphertext::from_trusted("sealed".to_owned());
        assert_eq!(opaque.as_str(), "sealed");
        assert_eq!(opaque.as_ref(), "sealed");
        assert_eq!(opaque.to_string(), "sealed");
        assert_eq!(opaque.clone().into_inner(), "sealed");
        let decoded_opaque: OpaqueCiphertext =
            serde_json::from_str("\"sealed\"").expect("wire test setup should succeed");
        assert_eq!(decoded_opaque, opaque);

        let plaintext = DecryptedPlaintext::from_trusted("secret".to_owned());
        assert_eq!(plaintext.as_str(), "secret");
        assert_eq!(plaintext.as_ref(), "secret");
        assert_eq!(plaintext.to_string(), "secret");
        assert_eq!(plaintext.into_inner(), "secret");
    }

    #[test]
    fn timestamp_and_signing_key_roundtrip_through_serde() {
        let ts =
            IsoTimestamp::parse("2026-07-07T03:00:00Z").expect("wire test setup should succeed");
        assert_eq!(ts.as_str(), "2026-07-07T03:00:00Z");
        assert_eq!(ts.as_ref(), ts.as_str());
        assert_eq!(ts.to_string(), ts.as_str());
        assert_eq!(ts.clone().into_inner(), ts.as_str());
        assert_eq!(IsoTimestamp::from_trusted(ts.as_str().to_owned()), ts);
        let decoded_ts: IsoTimestamp = serde_json::from_str(
            &serde_json::to_string(&ts).expect("wire test setup should succeed"),
        )
        .expect("wire test setup should succeed");
        assert_eq!(decoded_ts, ts);

        let signing = DeviceSigningPublicKey::parse(&"cd".repeat(32))
            .expect("wire test setup should succeed");
        assert!(!signing.is_empty());
        assert_eq!(signing.as_ref(), signing.as_str());
        assert_eq!(signing.to_string(), signing.as_str());
        assert_eq!(signing.clone().into_inner(), signing.as_str());
        let decoded_signing: DeviceSigningPublicKey = serde_json::from_str(
            &serde_json::to_string(&signing).expect("wire test setup should succeed"),
        )
        .expect("wire test setup should succeed");
        assert_eq!(decoded_signing, signing);
    }

    #[test]
    fn device_identity_secret_can_be_unwrapped_without_debug_leak() {
        let identity = Identity::generate();
        let secret = identity.to_string().expose_secret().to_owned();
        let wrapped = DeviceIdentitySecret::parse(&secret).expect("wire test setup should succeed");
        assert_eq!(wrapped.as_ref(), secret);
        assert_eq!(wrapped.to_string(), secret);
        assert_eq!(format!("{wrapped:?}"), "DeviceIdentitySecret([REDACTED])");
        assert_eq!(
            serde_json::to_string(&wrapped).expect("wire test setup should succeed"),
            format!("\"{secret}\"")
        );
        assert_eq!(wrapped.into_inner(), secret);
    }
}
