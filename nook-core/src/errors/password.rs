//! Password generation and envelope unlock errors.

use super::age_crypto::AgeCryptoError;
use super::validation::ValidationError;
use thiserror::Error;

pub type PasswordResult<T> = Result<T, PasswordError>;

#[derive(Debug, Error)]
pub enum PasswordError {
    #[error("Password length must be between {min} and {max}.")]
    LengthOutOfRange { min: usize, max: usize },

    #[error("Select at least one character set.")]
    NoCharacterSet,

    #[error("Failed to generate random bytes: {0}")]
    RandomBytes(String),

    #[error("Password label cannot be empty.")]
    LabelEmpty,

    #[error("Password must be at least {min} characters.")]
    TooShort { min: usize },

    #[error("Failed to serialize envelope plaintext")]
    EnvelopePlaintextSerialize(#[source] serde_json::Error),

    #[error("Unsupported password envelope version: {version}")]
    UnsupportedEnvelopeVersion { version: u32 },

    #[error("Unsupported password envelope KDF: {kdf}")]
    UnsupportedEnvelopeKdf { kdf: String },

    #[error("Envelope plaintext is not valid UTF-8")]
    EnvelopePlaintextUtf8(#[source] std::string::FromUtf8Error),

    #[error("Invalid envelope plaintext JSON")]
    EnvelopePlaintextJson(#[source] serde_json::Error),

    #[error(transparent)]
    Age(#[from] AgeCryptoError),

    #[error(transparent)]
    Validation(#[from] ValidationError),
}
