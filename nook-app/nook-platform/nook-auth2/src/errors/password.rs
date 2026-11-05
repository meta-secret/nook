//! Password generation errors.

use crate::PasswordCharacterCount;
use thiserror::Error;

pub type PasswordResult<T> = Result<T, PasswordError>;

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
}
