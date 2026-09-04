//! Typed wire strings for vault storage plus compatibility exports for auth/key-access strings.

use std::{fmt, mem};

use crate::errors;
use serde::{Deserialize, Deserializer, de::Error as _};

pub use nook_auth2::{
    AgeArmoredCiphertext, DecryptedPlaintext, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId,
    Sha256Hex, SigningSeedHex, SymmetricKey, Url64EncodedString,
};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct StoredVaultYaml(String);

impl StoredVaultYaml {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for StoredVaultYaml {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for StoredVaultYaml {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for StoredVaultYaml {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SecretPayloadYaml(String);

impl SecretPayloadYaml {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for SecretPayloadYaml {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for SecretPayloadYaml {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for SecretPayloadYaml {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl SecretPayloadYaml {
    pub fn zeroize_plaintext(&mut self) {
        use zeroize::Zeroize;
        self.0.zeroize();
    }
}

impl Drop for SecretPayloadYaml {
    fn drop(&mut self) {
        use zeroize::Zeroize;
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

    pub fn parse_auto(raw: &str) -> errors::DatabaseResult<Self> {
        crate::detect_stored_format(raw)?;
        Ok(Self::Yaml(StoredVaultYaml::parse(raw)?))
    }
}

impl StoredVaultYaml {
    pub fn parse(raw: &str) -> errors::ValidationResult<Self> {
        Ok(Self(raw.to_owned()))
    }
}

impl SecretPayloadYaml {
    pub fn parse(secret_type: crate::SecretType, raw: &str) -> errors::SecretPayloadResult<Self> {
        crate::SecretValue::from_yaml_str(secret_type, raw)?;
        Ok(Self::from_trusted(raw.to_owned()))
    }
}

impl<'de> Deserialize<'de> for StoredVaultYaml {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(D::Error::custom)
    }
}

impl<'de> Deserialize<'de> for SecretPayloadYaml {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(Self(raw))
    }
}
