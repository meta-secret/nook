//! Event-sourcing, signing, and session orchestration errors.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum EventError {
    #[error("event id must start with sha256: (got {raw:?})")]
    EventIdMissingPrefix { raw: String },

    #[error("event id digest must be 64 hex chars (got {hex:?})")]
    EventIdInvalidDigest { hex: String },

    #[error("failed to serialize JSON")]
    JsonSerialize(#[from] serde_json::Error),

    #[error("failed to serialize event body")]
    EventBodySerialize(#[source] serde_json::Error),

    #[error("failed to serialize event")]
    EventSerialize(String),

    #[error("failed to parse stored event")]
    ParseStoredEvent(String),

    #[error("failed to parse remote event")]
    ParseRemoteEvent(String),

    #[error("signature must start with ed25519: (got {raw:?})")]
    SignatureMissingPrefix { raw: String },

    #[error("invalid signature hex")]
    SignatureInvalidHex(#[from] hex::FromHexError),

    #[error("ed25519 signature must be 64 bytes")]
    SignatureWrongLength,

    #[error("event signature verification failed")]
    SignatureVerificationFailed,

    #[error("current event schema requires actor_signing_public_key")]
    MissingActorSigningPublicKey,

    #[error("actor signing public key must be 32 bytes")]
    ActorSigningPublicKeyWrongLength,

    #[error("invalid actor signing public key")]
    ActorSigningPublicKeyInvalid,

    #[error(
        "event actor_id {actor_id} does not match signing public key digest {signing_key_actor_id}"
    )]
    ActorSigningKeyMismatch {
        actor_id: String,
        signing_key_actor_id: String,
    },

    #[error("event actor {actor_id} was not authorized in causal history")]
    UnauthorizedActor { actor_id: String },

    #[error("unsupported event schema version {version}")]
    UnsupportedSchemaVersion { version: u32 },

    #[error("event store_id does not match vault (expected {expected}, got {actual})")]
    EventStoreIdMismatch { expected: String, actual: String },

    #[error("non-genesis events must declare parents")]
    MissingEventParents,

    #[error("remote event id mismatch at {event_id}")]
    RemoteEventIdMismatch { event_id: String },

    #[error("failed to generate signing seed: {0}")]
    SigningSeedGeneration(String),

    #[error("signing seed must be 32 bytes")]
    SigningSeedWrongLength,

    #[error("invalid auth key id: {0}")]
    AuthKeyId(String),

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

    #[error("failed to parse password envelope from event")]
    PasswordEnvelopeParse(#[source] serde_json::Error),

    #[error("expected import operation")]
    ExpectedImportOperation,

    #[error("import event content hash does not match source vault")]
    ImportContentHashMismatch,

    #[error("import event secret ids do not match source vault")]
    ImportSecretSetMismatch,

    #[error("import event password entries do not match source vault")]
    ImportPasswordEntriesMismatch,
}
