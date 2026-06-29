//! Typed errors for vault event-sourcing and session orchestration.

use thiserror::Error;

pub type VaultResult<T> = Result<T, VaultError>;

#[derive(Debug, Error)]
pub enum VaultError {
    // --- Event IDs & canonical JSON ---
    #[error("event id must start with sha256: (got {raw:?})")]
    EventIdMissingPrefix { raw: String },

    #[error("event id digest must be 64 hex chars (got {hex:?})")]
    EventIdInvalidDigest { hex: String },

    #[error("failed to serialize JSON")]
    JsonSerialize(#[from] serde_json::Error),

    #[error("failed to serialize event body")]
    EventBodySerialize(#[source] serde_json::Error),

    #[error("failed to serialize event")]
    EventSerialize(#[source] serde_json::Error),

    #[error("failed to parse stored event")]
    ParseStoredEvent(#[source] serde_json::Error),

    #[error("failed to parse remote event")]
    ParseRemoteEvent(#[source] serde_json::Error),

    // --- Signatures ---
    #[error("signature must start with ed25519: (got {raw:?})")]
    SignatureMissingPrefix { raw: String },

    #[error("invalid signature hex")]
    SignatureInvalidHex(#[from] hex::FromHexError),

    #[error("ed25519 signature must be 64 bytes")]
    SignatureWrongLength,

    #[error("event signature verification failed")]
    SignatureVerificationFailed,

    // --- Event envelope ---
    #[error("unsupported event schema version {version}")]
    UnsupportedSchemaVersion { version: u32 },

    #[error("event store_id does not match vault (expected {expected}, got {actual})")]
    EventStoreIdMismatch { expected: String, actual: String },

    #[error("non-genesis events must declare parents")]
    MissingEventParents,

    #[error("remote event id mismatch at {event_id}")]
    RemoteEventIdMismatch { event_id: String },

    // --- Signing identity ---
    #[error("failed to generate signing seed: {0}")]
    SigningSeedGeneration(String),

    #[error("signing seed must be 32 bytes")]
    SigningSeedWrongLength,

    #[error("invalid auth key id: {0}")]
    AuthKeyId(String),

    // --- Event graph & projection ---
    #[error("event graph contains a cycle")]
    GraphCycle,

    #[error("failed to advance topological sort")]
    TopologicalSortStalled,

    #[error("missing event {event_id} during projection")]
    MissingEvent { event_id: String },

    #[error("event store_id mismatch during projection")]
    ProjectionStoreMismatch,

    #[error("projection changed across replays")]
    ProjectionReplayMismatch,

    // --- Session / sync ---
    #[error("projection cache is empty")]
    EmptyProjectionCache,

    #[error("outbox entry missing")]
    MissingOutboxEntry,

    #[error("genesis event bytes missing")]
    MissingGenesisBytes,

    #[error("github provider bucket missing")]
    MissingProviderBucket,

    #[error("expected yaml sync outcome Reloaded, got {outcome}")]
    UnexpectedYamlSyncOutcome { outcome: String },

    #[error("failed to serialize member records")]
    MemberRecordsSerialize(#[source] serde_json::Error),

    // --- Legacy module bridges (until those modules adopt VaultError) ---
    #[error("vault format: {0}")]
    VaultFormat(String),

    #[error("multi-device: {0}")]
    MultiDevice(String),

    #[error("crypto: {0}")]
    Crypto(String),

    #[error("database: {0}")]
    Database(String),

    #[error("epoch: {0}")]
    Epoch(String),

    #[error("vault ids: {0}")]
    VaultIds(String),
}

impl VaultError {
    pub fn vault_format(message: impl Into<String>) -> Self {
        Self::VaultFormat(message.into())
    }

    pub fn multi_device(message: impl Into<String>) -> Self {
        Self::MultiDevice(message.into())
    }

    pub fn crypto(message: impl Into<String>) -> Self {
        Self::Crypto(message.into())
    }

    pub fn database(message: impl Into<String>) -> Self {
        Self::Database(message.into())
    }

    pub fn epoch(message: impl Into<String>) -> Self {
        Self::Epoch(message.into())
    }

    pub fn vault_ids(message: impl Into<String>) -> Self {
        Self::VaultIds(message.into())
    }

    pub fn from_multi_device<T>(result: Result<T, String>) -> VaultResult<T> {
        result.map_err(Self::multi_device)
    }

    pub fn from_vault_format<T>(result: Result<T, String>) -> VaultResult<T> {
        result.map_err(Self::vault_format)
    }

    pub fn from_crypto<T>(result: Result<T, String>) -> VaultResult<T> {
        result.map_err(Self::crypto)
    }

    pub fn from_database<T>(result: Result<T, String>) -> VaultResult<T> {
        result.map_err(Self::database)
    }

    pub fn from_epoch<T>(result: Result<T, String>) -> VaultResult<T> {
        result.map_err(Self::epoch)
    }
}
