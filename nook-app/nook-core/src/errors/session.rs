//! Incremental secret mutation errors.

use nook_auth::{SecretPayloadError, ValidationError, VaultCryptoError};
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

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    SecretPayload(#[from] SecretPayloadError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),
}
