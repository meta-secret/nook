//! Typed secret payloads and on-disk record shapes.
//!
//! - `SecretType` — the tag stored alongside each record so the UI knows which
//!   schema the (encrypted) payload follows after decryption.
//! - `LoginSecret`, `ApiKeySecret`, `SeedPhraseSecret`, `SecureNoteSecret` —
//!   the concrete payload shapes Nook currently supports. Adding a new shape
//!   means a new variant + struct here, plus a `from_yaml` arm.
//! - `SecretValue` — typed enum over the shapes; the in-memory
//!   representation that flows through the wasm bridge.
//! - `SecretRecord` — `(id, type, data)` plaintext triple for the session.
//! - `StoredSecretRecord` — the on-disk shape: same triple but `value` is an
//!   age-encrypted ciphertext string. Sorted, written to vault YAML.

use crate::SecretId;
use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::vault_wire::SecretPayloadYaml;
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretType {
    Login,
    ApiKey,
    SeedPhrase,
    SecureNote,
}

impl SecretType {
    pub fn parse(value: &str) -> SecretPayloadResult<Self> {
        match value {
            "login" => Ok(Self::Login),
            "api-key" => Ok(Self::ApiKey),
            "seed-phrase" => Ok(Self::SeedPhrase),
            "secure-note" => Ok(Self::SecureNote),
            _ => Err(SecretPayloadError::UnknownSecretType {
                value: value.to_owned(),
            }),
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::ApiKey => "api-key",
            Self::SeedPhrase => "seed-phrase",
            Self::SecureNote => "secure-note",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoginSecret {
    pub website_url: String,
    pub username: String,
    pub password: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeySecret {
    pub website_url: String,
    pub key: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SeedPhraseSecret {
    pub name: String,
    pub seed: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecureNoteSecret {
    pub title: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretValue {
    Login(LoginSecret),
    ApiKey(ApiKeySecret),
    SeedPhrase(SeedPhraseSecret),
    SecureNote(SecureNoteSecret),
}

impl SecretValue {
    pub fn from_yaml(
        secret_type: SecretType,
        yaml: &SecretPayloadYaml,
    ) -> SecretPayloadResult<Self> {
        Self::from_yaml_str(secret_type, yaml.as_str())
    }

    pub fn from_yaml_str(secret_type: SecretType, yaml: &str) -> SecretPayloadResult<Self> {
        match secret_type {
            SecretType::Login => serde_yaml::from_str(yaml)
                .map(Self::Login)
                .map_err(SecretPayloadError::InvalidLogin),
            SecretType::ApiKey => serde_yaml::from_str(yaml)
                .map(Self::ApiKey)
                .map_err(SecretPayloadError::InvalidApiKey),
            SecretType::SeedPhrase => {
                let secret: SeedPhraseSecret =
                    serde_yaml::from_str(yaml).map_err(SecretPayloadError::InvalidSeedPhrase)?;
                crate::bip39::validate_bip39_mnemonic(&secret.seed)?;
                Ok(Self::SeedPhrase(secret))
            }
            SecretType::SecureNote => serde_yaml::from_str(yaml)
                .map(Self::SecureNote)
                .map_err(SecretPayloadError::InvalidSecureNote),
        }
    }

    pub fn to_yaml(&self) -> SecretPayloadResult<SecretPayloadYaml> {
        let yaml = match self {
            Self::Login(value) => serde_yaml::to_string(value),
            Self::ApiKey(value) => serde_yaml::to_string(value),
            Self::SeedPhrase(value) => serde_yaml::to_string(value),
            Self::SecureNote(value) => serde_yaml::to_string(value),
        }
        .map_err(SecretPayloadError::Serialize)?;
        Ok(SecretPayloadYaml::from_trusted(yaml))
    }

    #[must_use]
    pub const fn secret_type(&self) -> SecretType {
        match self {
            Self::Login(_) => SecretType::Login,
            Self::ApiKey(_) => SecretType::ApiKey,
            Self::SeedPhrase(_) => SecretType::SeedPhrase,
            Self::SecureNote(_) => SecretType::SecureNote,
        }
    }

    pub(crate) fn zeroize_plaintext(&mut self) {
        match self {
            Self::Login(value) => {
                value.website_url.zeroize();
                value.username.zeroize();
                value.password.zeroize();
                value.notes.zeroize();
            }
            Self::ApiKey(value) => {
                value.website_url.zeroize();
                value.key.zeroize();
                value.expires_at.zeroize();
            }
            Self::SeedPhrase(value) => {
                value.name.zeroize();
                value.seed.zeroize();
            }
            Self::SecureNote(value) => {
                value.title.zeroize();
                value.note.zeroize();
            }
        }
    }
}

/// Typed plaintext secret (in memory only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecretRecord {
    pub id: SecretId,
    #[serde(rename = "type")]
    pub secret_type: SecretType,
    pub data: SecretValue,
}

impl SecretRecord {
    pub(crate) fn zeroize_plaintext(&mut self) {
        self.data.zeroize_plaintext();
    }
}

/// Opaque on-disk payload — user secrets are age-armored YAML; auth/join/member rows use JSON or nested armor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StoredRecordPayload(String);

impl StoredRecordPayload {
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
    pub fn from_age_armored(value: crate::AgeArmoredCiphertext) -> Self {
        Self(value.into_inner())
    }
}

impl fmt::Display for StoredRecordPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for StoredRecordPayload {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// One record on disk — label is plaintext, `value` is an opaque encrypted or JSON payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredSecretRecord {
    #[serde(rename = "id")]
    pub key: SecretId,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub secret_type: Option<SecretType>,
    #[serde(rename = "data")]
    pub value: StoredRecordPayload,
}
