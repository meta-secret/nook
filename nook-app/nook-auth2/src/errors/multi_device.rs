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

    #[error("No sentinel share found for device {device_id}.")]
    SentinelShareNotFound { device_id: String },

    #[error("Invalid sentinel threshold policy.")]
    InvalidSentinelThreshold,

    #[error("Invalid sentinel genesis session binding.")]
    InvalidSentinelGenesisSession,

    #[error("Invalid sentinel genesis participant response signature.")]
    InvalidSentinelGenesisSignature,

    #[error("Sentinel genesis participant already exists: {device_id}.")]
    DuplicateSentinelGenesisParticipant { device_id: String },

    #[error("Sentinel genesis roster is full.")]
    SentinelGenesisRosterFull,

    #[error("Sentinel genesis needs {required} participants, but has {available}.")]
    SentinelGenesisIncomplete { required: u8, available: usize },

    #[error("Sentinel genesis share delivery is not addressed to this device.")]
    SentinelGenesisDeliveryRecipientMismatch,

    #[error("Invalid sentinel genesis payload.")]
    InvalidSentinelGenesisPayload,

    #[error(
        "Standalone Sentinel public-key announcements are rejected; participants must respond to an owner-issued invitation."
    )]
    StandaloneSentinelGenesisAnnouncementRejected,

    #[error("Invalid sentinel unlock session binding.")]
    InvalidSentinelUnlockSession,

    #[error("Invalid sentinel unlock signature.")]
    InvalidSentinelUnlockSignature,

    #[error("Invalid sentinel unlock payload.")]
    InvalidSentinelUnlockPayload,

    #[error("Sentinel unlock response already exists for device {device_id} or share index.")]
    DuplicateSentinelUnlockParticipant { device_id: String },

    #[error("Sentinel unlock session is not addressed to this requester identity.")]
    SentinelUnlockRecipientMismatch,

    #[error("Not enough sentinel shares: need {threshold}, got {available}.")]
    NotEnoughSentinelShares { threshold: u8, available: usize },

    #[error("Invalid sentinel share record JSON")]
    SentinelShareJson(#[source] serde_json::Error),

    #[error("Failed to serialize sentinel share record")]
    SentinelShareSerialize(#[source] serde_json::Error),

    #[error("Invalid sentinel share payload")]
    SentinelSharePayload(#[source] serde_json::Error),

    #[error("Invalid sentinel share encoding.")]
    InvalidSentinelShareEncoding,

    #[error(
        "Sentinel vault unlock requires an opened-share ceremony; per-device auth envelopes cannot unlock this vault."
    )]
    SentinelCeremonyRequired,

    #[error(
        "Password unlock is forbidden for sentinel vaults; use the opened-share ceremony instead."
    )]
    SentinelPasswordUnlockForbidden,

    #[error(
        "Sentinel participant revocation requires an atomic replacement and share-rotation ceremony."
    )]
    SentinelRevocationUnsupported,

    #[error("Failed to build member roster record.")]
    MemberRosterBuildFailed,

    #[error("Secret {key} is missing required type metadata.")]
    MissingSecretType { key: String },

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),

    #[error(transparent)]
    Age(#[from] AgeCryptoError),
}
