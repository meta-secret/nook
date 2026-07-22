//! Incremental secret mutation errors.

use nook_auth2::{SecretPayloadError, ValidationError, VaultCryptoError};
use thiserror::Error;

pub type SessionResult<T> = Result<T, SessionError>;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("Replacement id must differ from the item being replaced.")]
    ReplacementIdUnchanged,

    #[error("Secret {id} not found.")]
    SecretNotFound { id: crate::SecretId },

    #[error("Secret {id} already exists.")]
    SecretAlreadyExists { id: crate::SecretId },

    #[error("Secret search catalog serialization failed: {0}")]
    SearchCatalogSerialize(String),

    #[error("Secret search catalog is invalid: {0}")]
    SearchCatalogInvalid(String),

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    SecretPayload(#[from] SecretPayloadError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),
}
