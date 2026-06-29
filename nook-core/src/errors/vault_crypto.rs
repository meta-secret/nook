//! Symmetric vault encryption (age scrypt) errors.

use super::age_crypto::AgeCryptoError;
use thiserror::Error;

pub type VaultCryptoResult<T> = Result<T, VaultCryptoError>;

#[derive(Debug, Error)]
pub enum VaultCryptoError {
    #[error("Encryption setup error: {0}")]
    EncryptSetup(String),

    #[error("Armor wrap error: {0}")]
    ArmorWrap(String),

    #[error("Encryption error: {0}")]
    Encrypt(String),

    #[error("Write error: {0}")]
    Write(String),

    #[error("Finish error: {0}")]
    Finish(String),

    #[error("Armor finish error: {0}")]
    ArmorFinish(String),

    #[error("Invalid UTF-8 armor: {0}")]
    InvalidUtf8Armor(String),

    #[error("Decryption setup error: {0}")]
    DecryptSetup(String),

    #[error("Decryption error: {0}")]
    Decrypt(String),

    #[error("Read error: {0}")]
    Read(String),

    #[error(transparent)]
    Age(#[from] AgeCryptoError),
}
