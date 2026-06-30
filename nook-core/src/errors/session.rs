//! Incremental secret mutation errors.

use super::secret_payload::SecretPayloadError;
use super::validation::ValidationError;
use super::vault_crypto::VaultCryptoError;
use thiserror::Error;

pub type SessionResult<T> = Result<T, SessionError>;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("Replacement id must differ from the item being replaced.")]
    ReplacementIdUnchanged,

    #[error("Secret {id} not found.")]
    SecretNotFound { id: String },

    #[error("Secret {id} already exists.")]
    SecretAlreadyExists { id: String },

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    SecretPayload(#[from] SecretPayloadError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),
}
