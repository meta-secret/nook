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

    #[error("No nexus share found for device {device_id}.")]
    NexusShareNotFound { device_id: String },

    #[error("Invalid nexus threshold policy.")]
    InvalidNexusThreshold,

    #[error("Invalid nexus genesis session binding.")]
    InvalidNexusGenesisSession,

    #[error("Invalid nexus genesis participant response signature.")]
    InvalidNexusGenesisSignature,

    #[error("Nexus genesis participant already exists: {device_id}.")]
    DuplicateNexusGenesisParticipant { device_id: String },

    #[error("Nexus genesis roster is full.")]
    NexusGenesisRosterFull,

    #[error("Nexus genesis needs {required} participants, but has {available}.")]
    NexusGenesisIncomplete { required: u8, available: usize },

    #[error("Nexus genesis share delivery is not addressed to this device.")]
    NexusGenesisDeliveryRecipientMismatch,

    #[error("Invalid nexus genesis payload.")]
    InvalidNexusGenesisPayload,

    #[error("Invalid nexus unlock session binding.")]
    InvalidNexusUnlockSession,

    #[error("Invalid nexus unlock signature.")]
    InvalidNexusUnlockSignature,

    #[error("Invalid nexus unlock payload.")]
    InvalidNexusUnlockPayload,

    #[error("Nexus unlock response already exists for device {device_id} or share index.")]
    DuplicateNexusUnlockParticipant { device_id: String },

    #[error("Nexus unlock session is not addressed to this requester identity.")]
    NexusUnlockRecipientMismatch,

    #[error("Not enough nexus shares: need {threshold}, got {available}.")]
    NotEnoughNexusShares { threshold: u8, available: usize },

    #[error("Invalid nexus share record JSON")]
    NexusShareJson(#[source] serde_json::Error),

    #[error("Failed to serialize nexus share record")]
    NexusShareSerialize(#[source] serde_json::Error),

    #[error("Invalid nexus share payload")]
    NexusSharePayload(#[source] serde_json::Error),

    #[error("Invalid nexus share encoding.")]
    InvalidNexusShareEncoding,

    #[error(
        "Nexus vault unlock requires an opened-share ceremony; per-device auth envelopes cannot unlock this vault."
    )]
    NexusCeremonyRequired,

    #[error(
        "Password unlock is forbidden for nexus vaults; use the opened-share ceremony instead."
    )]
    NexusPasswordUnlockForbidden,

    #[error(
        "Nexus participant revocation requires an atomic replacement and share-rotation ceremony."
    )]
    NexusRevocationUnsupported,

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
