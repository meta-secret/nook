//! Shared age crate encryption/decryption errors (X25519 and scrypt).

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgeCryptoError {
    #[error("Age encryption setup error: {0}")]
    EncryptSetup(String),

    #[error("Age armor wrap error: {0}")]
    ArmorWrap(String),

    #[error("Age encryption error: {0}")]
    Encrypt(String),

    #[error("Age write error: {0}")]
    Write(String),

    #[error("Age finish error: {0}")]
    Finish(String),

    #[error("Age armor finish error: {0}")]
    ArmorFinish(String),

    #[error("Invalid UTF-8 age armor: {0}")]
    InvalidUtf8Armor(String),

    #[error("Age decryption setup error: {0}")]
    DecryptSetup(String),

    #[error("Age decryption error: {0}")]
    Decrypt(String),

    #[error("Age read error: {0}")]
    Read(String),

    #[error("Envelope encryption setup error: {0}")]
    EnvelopeEncryptSetup(String),

    #[error("Envelope armor wrap error: {0}")]
    EnvelopeArmorWrap(String),

    #[error("Envelope encryption error: {0}")]
    EnvelopeEncrypt(String),

    #[error("Envelope write error: {0}")]
    EnvelopeWrite(String),

    #[error("Envelope finish error: {0}")]
    EnvelopeFinish(String),

    #[error("Envelope armor finish error: {0}")]
    EnvelopeArmorFinish(String),

    #[error("Envelope armor is not UTF-8: {0}")]
    EnvelopeInvalidUtf8(String),

    #[error("Envelope decryption setup error: {0}")]
    EnvelopeDecryptSetup(String),

    #[error("Envelope decryption error (wrong password?): {0}")]
    EnvelopeDecrypt(String),

    #[error("Envelope read error: {0}")]
    EnvelopeRead(String),
}
