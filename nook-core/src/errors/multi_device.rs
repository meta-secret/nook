//! Multi-device vault membership and auth envelope errors.

use super::age_crypto::AgeCryptoError;
use super::validation::ValidationError;
use super::vault_crypto::VaultCryptoError;
use thiserror::Error;

pub type MultiDeviceResult<T> = Result<T, MultiDeviceError>;

#[derive(Debug, Error)]
pub enum MultiDeviceError {
    #[error("Failed to generate key: {0}")]
    GenerateKey(String),

    #[error("Failed to generate id: {0}")]
    GenerateId(String),

    #[error("Invalid recipient public key: {0}")]
    InvalidRecipientPublicKey(String),

    #[error("Invalid auth envelope JSON")]
    AuthEnvelopeJson(#[source] serde_json::Error),

    #[error("Auth envelope missing age-armored secrets_key or members_key.")]
    AuthEnvelopeMissingKeys,

    #[error("Invalid device identity: {0}")]
    InvalidDeviceIdentity(String),

    #[error("Invalid join request JSON")]
    JoinRequestJson(#[source] serde_json::Error),

    #[error("Failed to serialize member entry")]
    MemberEntrySerialize(#[source] serde_json::Error),

    #[error("Invalid member entry JSON")]
    MemberEntryJson(#[source] serde_json::Error),

    #[error("Member record key mismatch: expected {expected_key}, got {actual_key}")]
    MemberRecordKeyMismatch {
        expected_key: String,
        actual_key: String,
    },

    #[error("Invalid member id.")]
    InvalidMemberId,

    #[error("Device name must be 80 characters or fewer.")]
    DeviceNameTooLong,

    #[error("Add another device or a vault password before removing this one.")]
    CannotRemoveLastAccess,

    #[error("Device not found.")]
    DeviceNotFound,

    #[error("Failed to serialize auth envelopes")]
    AuthEnvelopesSerialize(#[source] serde_json::Error),

    #[error("Failed to serialize join request")]
    JoinRequestSerialize(#[source] serde_json::Error),

    #[error("No auth envelope found for device {device_id} (pk_id {pk_id})")]
    AuthEnvelopeNotFound { device_id: String, pk_id: String },

    #[error("Failed to build member roster record.")]
    MemberRosterBuildFailed,

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),

    #[error(transparent)]
    Age(#[from] AgeCryptoError),
}
