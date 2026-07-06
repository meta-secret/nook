//! Typed wire and crypto strings — serde-transparent newtypes validated at parse/deserialize.

use crate::errors::{ValidationError, ValidationResult};
use age::x25519::{Identity, Recipient};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use zeroize::Zeroize;

const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";
const SYMMETRIC_KEY_HEX_LEN: usize = 64;

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
            pub fn into_inner(self) -> String {
                self.0
            }

            pub fn from_trusted(value: String) -> Self {
                Self(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.0)
            }
        }
    };
}

transparent_str_newtype!(SymmetricKey);
transparent_str_newtype!(AgeArmoredCiphertext);
transparent_str_newtype!(DevicePublicKey);
transparent_str_newtype!(StoredVaultYaml);
transparent_str_newtype!(MemberLabel);
transparent_str_newtype!(PasswordEntryId);
transparent_str_newtype!(OpaqueCiphertext);
transparent_str_newtype!(DecryptedPlaintext);
transparent_str_newtype!(SigningSeedHex);

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

/// On-disk vault blob. Projection caches are YAML only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredVaultBlob {
    Yaml(StoredVaultYaml),
}

impl StoredVaultBlob {
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Yaml(blob) => blob.as_str(),
        }
    }

    #[must_use]
    pub fn format(&self) -> crate::VaultFormat {
        match self {
            Self::Yaml(_) => crate::VaultFormat::Yaml,
        }
    }

    pub fn parse_auto(raw: &str) -> crate::errors::DatabaseResult<Self> {
        crate::detect_stored_format(raw)?;
        Ok(Self::Yaml(StoredVaultYaml::parse(raw)?))
    }
}
transparent_str_newtype!(SecretPayloadYaml);

impl SymmetricKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let key = raw.trim();
        if key.len() != SYMMETRIC_KEY_HEX_LEN || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
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

impl StoredVaultYaml {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        Ok(Self(raw.to_owned()))
    }
}

impl SecretPayloadYaml {
    pub fn parse(
        secret_type: crate::SecretType,
        raw: &str,
    ) -> crate::errors::SecretPayloadResult<Self> {
        crate::SecretValue::from_yaml_str(secret_type, raw)?;
        Ok(Self::from_trusted(raw.to_owned()))
    }
}

const SIGNING_SEED_HEX_LEN: usize = 64;

impl SigningSeedHex {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let seed = raw.trim();
        if seed.len() != SIGNING_SEED_HEX_LEN || !seed.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(ValidationError::SigningSeedInvalid);
        }
        Ok(Self(seed.to_owned()))
    }
}

/// Bare SHA-256 hex digest (64 chars) — content hashes, checkpoints, legacy import source hash.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Sha256Hex(String);

impl Sha256Hex {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let hex = raw.trim();
        if hex.len() != SYMMETRIC_KEY_HEX_LEN || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
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

/// Ed25519 verifying key as 64-hex raw bytes (event join operations).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DeviceSigningPublicKey(String);

impl DeviceSigningPublicKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let hex = raw.trim();
        if hex.is_empty() {
            return Ok(Self(String::new()));
        }
        if hex.len() != SYMMETRIC_KEY_HEX_LEN || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::DeviceSigningPublicKeyInvalid);
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

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Display for DeviceSigningPublicKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for DeviceSigningPublicKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for DeviceSigningPublicKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for DeviceSigningPublicKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// RFC 3339 timestamp string (`created_at`, `enrolled_at`, `requested_at`, …).
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
        crate::CompactToken::parse(id)?;
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

impl<'de> Deserialize<'de> for StoredVaultYaml {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for SecretPayloadYaml {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(Self(raw))
    }
}

/// Alias for compact URL-safe base64 ids (`generate_id` — 11 chars).
pub type Url64EncodedString = crate::CompactToken;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SecretType;
    use age::secrecy::ExposeSecret;
    use age::x25519::Identity;

    #[test]
    fn symmetric_key_roundtrip_and_generate() {
        let key = SymmetricKey::generate().unwrap();
        assert_eq!(key.as_str().len(), 64);
        assert_eq!(SymmetricKey::parse(key.as_str()).unwrap(), key);
        assert_eq!(key.to_string(), key.as_str());
        assert_eq!(key.into_inner().len(), 64);
    }

    #[test]
    fn symmetric_key_rejects_invalid_hex() {
        assert!(SymmetricKey::parse("deadbeef").is_err());
        assert!(SymmetricKey::parse(&"g".repeat(64)).is_err());
    }

    #[test]
    fn age_armored_accepts_valid_armor() {
        let armor = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n-----END AGE ENCRYPTED FILE-----";
        let parsed = AgeArmoredCiphertext::parse(armor).unwrap();
        assert_eq!(parsed.as_str(), armor);
        let trusted = AgeArmoredCiphertext::from_trusted_armored(armor.to_owned());
        assert_eq!(parsed, trusted);
    }

    #[test]
    fn age_armored_rejects_plaintext() {
        assert!(AgeArmoredCiphertext::parse("not-armored").is_err());
    }

    #[test]
    fn device_keys_parse_from_generated_identity() {
        let identity = Identity::generate();
        let public = identity.to_public().to_string();
        let secret = identity.to_string().expose_secret().to_owned();
        let pk = DevicePublicKey::parse(&public).unwrap();
        assert_eq!(pk.as_str(), public);
        let sk = DeviceIdentitySecret::parse(&secret).unwrap();
        assert_eq!(sk.as_str(), secret);
        assert_eq!(sk.to_string(), secret);
        assert_eq!(format!("{sk:?}"), "DeviceIdentitySecret([REDACTED])");
        assert_eq!(serde_json::to_string(&sk).unwrap(), format!("\"{secret}\""));
        let trusted = DeviceIdentitySecret::from_trusted(sk.clone().into_inner());
        assert_eq!(trusted, sk);
    }

    #[test]
    fn device_public_key_rejects_garbage() {
        assert!(DevicePublicKey::parse("not-a-key").is_err());
    }

    #[test]
    fn device_identity_secret_rejects_garbage() {
        assert!(DeviceIdentitySecret::parse("not-a-secret").is_err());
    }

    #[test]
    fn stored_vault_yaml_parse() {
        let yaml = StoredVaultYaml::parse("secrets:\n").unwrap();
        assert!(yaml.as_str().starts_with("secrets:"));
    }

    #[test]
    fn stored_vault_blob_accepts_yaml_only() {
        assert!(StoredVaultBlob::parse_auto("{}\n").is_err());
        let yaml = StoredVaultBlob::parse_auto("secrets:\n").unwrap();
        assert!(matches!(yaml, StoredVaultBlob::Yaml(_)));
        assert_eq!(yaml.format(), crate::VaultFormat::Yaml);
    }

    #[test]
    fn secret_payload_yaml_validates_type() {
        let yaml = "websiteUrl: https://example.com\nkey: tok\nexpiresAt: ''\n";
        let parsed = SecretPayloadYaml::parse(SecretType::ApiKey, yaml).unwrap();
        assert_eq!(parsed.as_str(), yaml);
        assert!(SecretPayloadYaml::parse(SecretType::Login, yaml).is_err());
    }

    #[test]
    fn serde_deserializes_typed_wire_strings() {
        let key = SymmetricKey::generate().unwrap();
        let roundtripped: SymmetricKey =
            serde_json::from_str(&serde_json::to_string(&key).unwrap()).unwrap();
        assert_eq!(roundtripped, key);
    }

    #[test]
    fn sha256_hex_parse_and_serde() {
        let hex = Sha256Hex::from_trusted("deadbeef".repeat(8));
        assert_eq!(Sha256Hex::parse(hex.as_str()).unwrap(), hex);
        assert!(Sha256Hex::parse("short").is_err());
        let roundtripped: Sha256Hex =
            serde_json::from_str(&serde_json::to_string(&hex).unwrap()).unwrap();
        assert_eq!(roundtripped, hex);
    }

    #[test]
    fn device_signing_public_key_allows_empty_or_hex() {
        assert!(DeviceSigningPublicKey::parse("").unwrap().is_empty());
        let pk = DeviceSigningPublicKey::from_trusted("ab".repeat(32));
        assert_eq!(DeviceSigningPublicKey::parse(pk.as_str()).unwrap(), pk);
        assert!(DeviceSigningPublicKey::parse("not-hex").is_err());
        let roundtripped: DeviceSigningPublicKey =
            serde_json::from_str(&serde_json::to_string(&pk).unwrap()).unwrap();
        assert_eq!(roundtripped, pk);
    }

    #[test]
    fn iso_timestamp_parse_and_serde() {
        let ts = IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned());
        assert_eq!(IsoTimestamp::parse(ts.as_str()).unwrap(), ts);
        assert!(IsoTimestamp::parse("").is_err());
        assert!(IsoTimestamp::parse("not-a-timestamp").is_err());
        let roundtripped: IsoTimestamp =
            serde_json::from_str(&serde_json::to_string(&ts).unwrap()).unwrap();
        assert_eq!(roundtripped, ts);
    }

    #[test]
    fn password_entry_id_requires_compact_token() {
        let id = PasswordEntryId::parse("pwdentry001").unwrap();
        assert_eq!(PasswordEntryId::parse(id.as_str()).unwrap(), id);
        assert!(PasswordEntryId::parse("").is_err());
        assert!(PasswordEntryId::parse("too-long-token-value").is_err());
        let roundtripped: PasswordEntryId =
            serde_json::from_str(&serde_json::to_string(&id).unwrap()).unwrap();
        assert_eq!(roundtripped, id);
    }

    #[test]
    fn member_label_and_opaque_ciphertext_serde() {
        let label = MemberLabel::from_trusted("phone".to_owned());
        let opaque = OpaqueCiphertext::from_trusted("cipher".to_owned());
        let label_back: MemberLabel =
            serde_json::from_str(&serde_json::to_string(&label).unwrap()).unwrap();
        let opaque_back: OpaqueCiphertext =
            serde_json::from_str(&serde_json::to_string(&opaque).unwrap()).unwrap();
        assert_eq!(label_back.as_str(), "phone");
        assert_eq!(opaque_back.as_str(), "cipher");
    }
}
