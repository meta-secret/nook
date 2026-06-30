//! In-memory vault database errors.

use super::secret_payload::SecretPayloadError;
use super::vault_crypto::VaultCryptoError;
use super::vault_format::VaultFormatError;
use thiserror::Error;

pub type DatabaseResult<T> = Result<T, DatabaseError>;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("Failed to parse JSONL line")]
    JsonlParse(#[source] serde_json::Error),

    #[error("Failed to serialize record")]
    JsonlSerialize(#[source] serde_json::Error),

    #[error("Secret {key} is missing required type metadata.")]
    MissingSecretType { key: crate::SecretId },

    #[error(transparent)]
    VaultFormat(#[from] VaultFormatError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),

    #[error(transparent)]
    SecretPayload(#[from] SecretPayloadError),
}
