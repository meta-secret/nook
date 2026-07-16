//! Secret payload parse/serialize errors.

use super::validation::ValidationError;
use thiserror::Error;

pub type SecretPayloadResult<T> = Result<T, SecretPayloadError>;

#[derive(Debug, Error)]
pub enum SecretPayloadError {
    #[error("Unknown secret type: {value}")]
    UnknownSecretType { value: String },

    #[error("Invalid login payload")]
    InvalidLogin(#[source] serde_yaml::Error),

    #[error("Invalid API key payload")]
    InvalidApiKey(#[source] serde_yaml::Error),

    #[error("Invalid seed phrase payload")]
    InvalidSeedPhrase(#[source] serde_yaml::Error),

    #[error("Invalid secure note payload")]
    InvalidSecureNote(#[source] serde_yaml::Error),

    #[error("Invalid authenticator payload")]
    InvalidAuthenticator(#[source] serde_yaml::Error),

    #[error("Failed to serialize secret payload")]
    Serialize(#[source] serde_yaml::Error),

    #[error(transparent)]
    Validation(#[from] ValidationError),
}
