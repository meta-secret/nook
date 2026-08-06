//! In-memory vault database errors.

use super::vault_format::VaultFormatError;
use nook_auth2::{SecretPayloadError, ValidationError, VaultCryptoError};
use thiserror::Error;

pub type DatabaseResult<T> = Result<T, DatabaseError>;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("Secret {key} is missing required type metadata.")]
    MissingSecretType { key: crate::SecretId },

    #[error(transparent)]
    VaultFormat(#[from] VaultFormatError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),

    #[error(transparent)]
    SecretPayload(#[from] SecretPayloadError),

    #[error(transparent)]
    Validation(#[from] ValidationError),
}
