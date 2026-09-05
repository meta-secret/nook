//! Password generation and envelope unlock errors.

use std::{fmt, string};

use super::age_crypto::AgeCryptoError;
use super::validation::ValidationError;
use crate::PasswordCharacterCount;
use thiserror::Error;

pub type PasswordResult<T> = Result<T, PasswordError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RejectedPasswordEnvelopeVersion(u32);

impl RejectedPasswordEnvelopeVersion {
    pub(crate) const fn from_raw(value: u32) -> Self {
        Self(value)
    }
}

impl fmt::Display for RejectedPasswordEnvelopeVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Error)]
pub enum PasswordError {
    #[error("Password length must be between {min} and {max}.")]
    LengthOutOfRange {
        min: PasswordCharacterCount,
        max: PasswordCharacterCount,
    },

    #[error("Select at least one character set.")]
    NoCharacterSet,

    #[error("Failed to generate random bytes: {0}")]
    RandomBytes(String),

    #[error("Password label cannot be empty.")]
    LabelEmpty,

    #[error("Password must be at least {min} characters.")]
    TooShort { min: PasswordCharacterCount },

    #[error("Failed to serialize envelope plaintext")]
    EnvelopePlaintextSerialize(#[source] serde_json::Error),

    #[error("Unsupported password envelope version: {version}")]
    UnsupportedEnvelopeVersion {
        version: RejectedPasswordEnvelopeVersion,
    },

    #[error("Unsupported password envelope KDF: {kdf}")]
    UnsupportedEnvelopeKdf { kdf: String },

    #[error("Password envelope work factor must be between 1 and 63.")]
    InvalidWorkFactor,

    #[error("Password unlock entry not found: {entry_id}")]
    EntryNotFound { entry_id: String },

    #[error("Vault has no password unlock entries.")]
    EnvelopeNotFound,

    #[error("Envelope plaintext is not valid UTF-8")]
    EnvelopePlaintextUtf8(#[source] string::FromUtf8Error),

    #[error("Invalid envelope plaintext JSON")]
    EnvelopePlaintextJson(#[source] serde_json::Error),

    #[error(transparent)]
    Age(#[from] AgeCryptoError),

    #[error(transparent)]
    Validation(#[from] ValidationError),
}
