//! Typed secret payloads and on-disk record shapes.
//!
//! - `SecretType` — the tag stored alongside each record so the UI knows which
//!   schema the (encrypted) payload follows after decryption.
//! - `LoginSecret`, `ApiKeySecret`, `SeedPhraseSecret` — the three concrete
//!   payload shapes Nook currently supports. Adding a new shape means a new
//!   variant + struct here, plus a `from_yaml` arm.
//! - `SecretValue` — typed enum over the three shapes; the in-memory
//!   representation that flows through the wasm bridge.
//! - `SecretRecord` — `(id, type, data)` plaintext triple for the session.
//! - `StoredSecretRecord` — the on-disk shape: same triple but `value` is an
//!   age-encrypted ciphertext string. Sorted, written to YAML/JSONL.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretType {
    Login,
    ApiKey,
    SeedPhrase,
}

impl SecretType {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "login" => Ok(Self::Login),
            "api-key" => Ok(Self::ApiKey),
            "seed-phrase" => Ok(Self::SeedPhrase),
            _ => Err(format!("Unknown secret type: {value}")),
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::ApiKey => "api-key",
            Self::SeedPhrase => "seed-phrase",
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
#[serde(rename_all = "kebab-case")]
pub enum SecretValue {
    Login(LoginSecret),
    ApiKey(ApiKeySecret),
    SeedPhrase(SeedPhraseSecret),
}

impl SecretValue {
    pub fn from_yaml(secret_type: SecretType, yaml: &str) -> Result<Self, String> {
        match secret_type {
            SecretType::Login => serde_yaml::from_str(yaml)
                .map(Self::Login)
                .map_err(|error| format!("Invalid login payload: {error}")),
            SecretType::ApiKey => serde_yaml::from_str(yaml)
                .map(Self::ApiKey)
                .map_err(|error| format!("Invalid API key payload: {error}")),
            SecretType::SeedPhrase => serde_yaml::from_str(yaml)
                .map(Self::SeedPhrase)
                .map_err(|error| format!("Invalid seed phrase payload: {error}")),
        }
    }

    pub fn to_yaml(&self) -> Result<String, String> {
        match self {
            Self::Login(value) => serde_yaml::to_string(value),
            Self::ApiKey(value) => serde_yaml::to_string(value),
            Self::SeedPhrase(value) => serde_yaml::to_string(value),
        }
        .map_err(|error| format!("Failed to serialize secret payload: {error}"))
    }

    #[must_use]
    pub const fn secret_type(&self) -> SecretType {
        match self {
            Self::Login(_) => SecretType::Login,
            Self::ApiKey(_) => SecretType::ApiKey,
            Self::SeedPhrase(_) => SecretType::SeedPhrase,
        }
    }
}

/// Typed plaintext secret (in memory only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecretRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub secret_type: SecretType,
    pub data: SecretValue,
}

/// One record on disk — label is plaintext, `value` is armored age ciphertext.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredSecretRecord {
    #[serde(rename = "id")]
    pub key: String,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub secret_type: Option<SecretType>,
    #[serde(rename = "data")]
    pub value: String,
}
