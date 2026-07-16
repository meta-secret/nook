//! Typed plaintext secret payloads.
//!
//! `nook-auth2` owns `SecretType` plus the opaque stored row shape because auth
//! metadata shares the same YAML row boundary. `nook-core` owns the plaintext
//! password-manager payloads and session records.

use crate::SecretId;
use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::vault_wire::SecretPayloadYaml;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub use nook_auth2::{SecretType, StoredRecordPayload, StoredSecretRecord};

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

    pub fn zeroize_plaintext(&mut self) {
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
    pub fn zeroize_plaintext(&mut self) {
        self.data.zeroize_plaintext();
    }
}
