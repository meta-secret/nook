//! Typed wire and crypto strings — serde-transparent newtypes validated at parse/deserialize.

use crate::errors::{ValidationError, ValidationResult};
use age::x25519::{Identity, Recipient};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

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

            #[allow(dead_code)]
            pub(crate) fn from_trusted(value: String) -> Self {
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
transparent_str_newtype!(DeviceIdentitySecret);
transparent_str_newtype!(SessionJsonl);
transparent_str_newtype!(StoredVaultJsonl);
transparent_str_newtype!(StoredVaultYaml);

/// On-disk vault blob — JSONL or YAML wire, selected explicitly or via auto-detect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredVaultBlob {
    Jsonl(StoredVaultJsonl),
    Yaml(StoredVaultYaml),
}

impl StoredVaultBlob {
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Jsonl(blob) => blob.as_str(),
            Self::Yaml(blob) => blob.as_str(),
        }
    }

    #[must_use]
    pub fn format(&self) -> crate::VaultFormat {
        match self {
            Self::Jsonl(_) => crate::VaultFormat::Jsonl,
            Self::Yaml(_) => crate::VaultFormat::Yaml,
        }
    }

    pub fn parse_auto(raw: &str) -> crate::errors::DatabaseResult<Self> {
        let format = crate::detect_stored_format(raw)?;
        Ok(match format {
            crate::VaultFormat::Jsonl => Self::Jsonl(StoredVaultJsonl::parse(raw)?),
            crate::VaultFormat::Yaml => Self::Yaml(StoredVaultYaml::parse(raw)?),
        })
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

impl SessionJsonl {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            serde_json::from_str::<serde_json::Value>(line)
                .map_err(|_| ValidationError::SessionJsonlInvalid)?;
        }
        Ok(Self(raw.to_owned()))
    }
}

impl StoredVaultJsonl {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Ok(Self(String::new()));
        }
        for line in trimmed.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if !line.starts_with('{') {
                return Err(ValidationError::StoredVaultJsonlInvalid);
            }
        }
        Ok(Self(raw.to_owned()))
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

impl<'de> Deserialize<'de> for SessionJsonl {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for StoredVaultJsonl {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
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
    fn session_jsonl_rejects_broken_lines() {
        assert!(SessionJsonl::parse("{}\n{broken").is_err());
        assert!(SessionJsonl::parse("{}\n{}").is_ok());
        assert!(SessionJsonl::parse("").is_ok());
    }

    #[test]
    fn stored_vault_jsonl_and_yaml_parse() {
        assert!(StoredVaultJsonl::parse("").unwrap().as_str().is_empty());
        assert!(StoredVaultJsonl::parse("{}\n").unwrap().as_str().contains('{'));
        assert!(StoredVaultJsonl::parse("not-json").is_err());
        let yaml = StoredVaultYaml::parse("secrets:\n").unwrap();
        assert!(yaml.as_str().starts_with("secrets:"));
    }

    #[test]
    fn stored_vault_blob_auto_detects_format() {
        let jsonl = StoredVaultBlob::parse_auto("{}\n").unwrap();
        assert!(matches!(jsonl, StoredVaultBlob::Jsonl(_)));
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
        let roundtripped: SymmetricKey = serde_json::from_str(&serde_json::to_string(&key).unwrap()).unwrap();
        assert_eq!(roundtripped, key);

        let session: SessionJsonl = serde_json::from_str("\"{}\"").unwrap();
        assert_eq!(session.as_str(), "{}");
    }
}
