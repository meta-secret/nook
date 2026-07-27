#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

//! Portable signed vault event-log domain.
//!
//! This crate owns Nook's canonical event envelope, actor-authorized causal
//! graph, deterministic vault projection, key-epoch metadata, and append-only
//! local event-store orchestration. Generic causal/replica mechanics remain in
//! `nook-replication`; authentication and key-access wire types remain in
//! `nook-auth2`. Provider transports and browser persistence stay in hosts.

mod builder;
mod canonical;
mod epoch;
mod errors;
mod event;
mod fingerprint;
mod graph;
mod projection;
mod signing;
mod store;

#[cfg(test)]
mod test_support;

pub use builder::{
    AppendEventInput, ObservedHeads, build_signed_event, encrypted_secret_from_armored,
    parents_from_heads,
};
pub use canonical::{
    Ed25519Signature, EventId, canonical_json_bytes, canonicalize_json, event_id_from_body_bytes,
    format_ed25519_signature, parse_ed25519_signature, sha256_hex, sign_body,
    verify_body_signature,
};
pub use epoch::{
    EpochRecord, EpochRotationReason, EpochTransition, KeyEpoch,
    concurrent_epoch_rotations_conflict, operation_starts_epoch,
};
pub use errors::{EventError, EventResult};
pub use event::{
    EncryptedSecretPayload, GenesisImportPayload, SentinelShareIssuedPayload, VaultEvent,
    VaultEventBody, VaultEventSchemaVersion, VaultOperation, build_genesis_import_event,
    parse_event_storage_bytes, parse_remote_event_storage_bytes, serialize_event_storage_yaml,
};
pub use fingerprint::SecretFingerprint;
pub use graph::{EventGraph, EventInsertStatus, EventPendingReason};
pub use projection::{
    ProjectedSecret, ProjectedSecretLifecycle, ProjectedSecretOrigin, ProjectionEpoch,
    SecretReplacementConflict, SecurityConflict, VaultProjection,
    assert_projection_permutation_invariant, project_vault,
};
pub use signing::SigningIdentity;
pub use store::{
    LocalEventStore, RemoteEventLogClassification, classify_remote_event_log,
    remote_event_belongs_to_store, remote_event_store_id, union_remote_events,
    union_remote_events_and_heads,
};

// Re-export typed wire values that appear in the event-log public API.
pub use nook_auth2::{
    AgeArmoredCiphertext, AuthKeyId, DeviceId, DevicePublicKey, DeviceSigningPublicKey,
    IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId, PasswordEnvelope,
    PasswordUnlockEntry, SecretId, SecretType, Sha256Hex, SigningSeedHex, StoreId,
    StoredRecordPayload, StoredSecretRecord,
};
