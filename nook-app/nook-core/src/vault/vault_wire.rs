//! Typed wire strings for vault storage plus compatibility exports for auth/key-access strings.

use serde::{Deserialize, Deserializer};

pub use nook_auth2::{
    AgeArmoredCiphertext, DecryptedPlaintext, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId,
    Sha256Hex, SigningSeedHex, SymmetricKey, Url64EncodedString,
};

nook_auth2::transparent_str_newtype!(StoredVaultYaml);
nook_auth2::transparent_str_newtype!(SecretPayloadYaml);

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

    pub fn parse_auto(raw: &str) -> crate::errors::DatabaseResult<Self> {
        crate::detect_stored_format(raw)?;
        Ok(Self::Yaml(StoredVaultYaml::parse(raw)?))
    }
}

impl StoredVaultYaml {
    pub fn parse(raw: &str) -> crate::errors::ValidationResult<Self> {
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
