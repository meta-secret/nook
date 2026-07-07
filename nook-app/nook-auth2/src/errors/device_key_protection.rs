//! Passkey-PRF device-key wrapping errors.

use thiserror::Error;

pub type DeviceKeyProtectionResult<T> = Result<T, DeviceKeyProtectionError>;

#[derive(Debug, Error)]
pub enum DeviceKeyProtectionError {
    #[error("Passkey credential id is required.")]
    CredentialIdEmpty,

    #[error("Passkey credential id is too large.")]
    CredentialIdTooLarge,

    #[error("Passkey user handle must contain between 1 and 64 bytes.")]
    UserHandleInvalid,

    #[error("Passkey PRF input must contain exactly 32 bytes.")]
    PrfInputInvalid,

    #[error("Passkey PRF output must contain exactly 32 bytes.")]
    PrfOutputInvalid,

    #[error("Unsupported device-key protection version: {0}.")]
    UnsupportedVersion(u32),

    #[error("Unsupported device-key protection parameters.")]
    UnsupportedParameters,

    #[error("Invalid device-key protection field: {0}.")]
    InvalidField(&'static str),

    #[error("Failed to generate device-key protection random bytes: {0}")]
    RandomBytes(String),

    #[error("Failed to derive the device-key wrapping key.")]
    KeyDerivation,

    #[error("Failed to encrypt the device identity.")]
    Encrypt,

    #[error("Passkey authorization did not decrypt the device identity.")]
    Decrypt,

    #[error("Decrypted device identity is invalid.")]
    InvalidDeviceIdentity,

    #[error("Failed to serialize the protected device identity.")]
    Serialize(#[source] serde_json::Error),

    #[error("Failed to parse the protected device identity.")]
    Parse(#[source] serde_json::Error),
}
