//! Enrollment-code envelope and crypto errors.

use thiserror::Error;

pub type EnrollmentResult<T> = Result<T, EnrollmentError>;

#[derive(Debug, Error)]
pub enum EnrollmentError {
    #[error("A passphrase is required to encrypt the enrollment code.")]
    EncryptPasswordRequired,

    #[error("Enrollment payload requires an entry id.")]
    EntryIdRequired,

    #[error("Enter the one-time passphrase for this enrollment code.")]
    DecryptPasswordRequired,

    #[error("Invalid enrollment code.")]
    InvalidCode,

    #[error("Unsupported enrollment encryption parameters.")]
    UnsupportedEncryptionParameters,

    #[error("Enrollment code is missing KDF parameters.")]
    MissingKdfParameters,

    #[error("Enrollment code is missing entry_id.")]
    MissingEntryId,

    #[error("Enrollment code has an invalid entry_label.")]
    InvalidEntryLabel,

    #[error("Enrollment code is missing {field}.")]
    MissingField { field: &'static str },

    #[error("Enrollment code is missing provider details.")]
    MissingProviderDetails,

    #[error("GitHub provider in enrollment code is malformed.")]
    MalformedGithubProvider,

    #[error("OAuth file provider in enrollment code is malformed.")]
    MalformedOauthFileProvider,

    #[error("S3 provider in enrollment code is malformed.")]
    MalformedS3Provider,

    #[error("Shared provider grant in enrollment code is malformed.")]
    MalformedSharedProviderGrant,

    #[error("Unsupported provider type: {provider_type}")]
    UnsupportedProviderType { provider_type: String },

    #[error("This passphrase does not decrypt this enrollment code.")]
    WrongPassword,

    #[error("Failed to generate enrollment random bytes: {0}")]
    RandomBytes(String),

    #[error("Failed to serialize enrollment code")]
    Serialize(#[source] serde_json::Error),

    #[error("Failed to parse enrollment code JSON")]
    Json(#[source] serde_json::Error),
}
