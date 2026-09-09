#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]
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
mod event_bytes;
mod fingerprint;
mod graph;
mod projection;
mod remote_epoch_visibility;
mod signing;
mod store;

pub use builder::{AppendEventInput, ObservedHeads};
pub use canonical::{Ed25519Signature, EventId};
pub use epoch::{
    ConcurrentEpochRotations, EpochRecord, EpochRotationReason, EpochTransition, KeyEpoch,
};
pub use errors::{EventError, EventResult};
pub use event::{
    EncryptedSecretPayload, EpochCheckpointRequirement, EpochMetadataState, EpochPasswordState,
    GenesisImportContents, GenesisImportPayload, GenesisImportRequest, SecurityRotationTrigger,
    SentinelShareIssuedPayload, VaultEvent, VaultEventBody, VaultEventSchemaVersion,
    VaultOperation,
};
pub use event_bytes::{CanonicalEventBodyBytes, EventStorageBytes};
pub use fingerprint::SecretFingerprint;
pub use graph::{
    EventGraph, EventGraphInsert, EventGraphInsertion, EventGraphRejection,
    EventGraphReplacementEvidence, EventGraphVaultArchitecture, EventInsertStatus,
    EventPendingReason,
};
pub use nook_replication::CausalGraphEventCount as EventCount;
pub use projection::{
    ProjectedSecret, ProjectedSecretLifecycle, ProjectedSecretOrigin, ProjectionEpoch,
    ProjectionIntegrity, SecretReplacementConflict, SecurityConflict, VaultProjection,
};
pub use remote_epoch_visibility::RemoteEventWrites;
pub use signing::SigningIdentity;
pub use store::{
    CheckedRemoteEvent, LocalEventAppend, LocalEventAppendOutcome, LocalEventStore,
    LocalEventStoreRejection, LocalEventWrite, LocalOutboxRemoval, LocalOutboxRemoved,
    LocalOutboxWrite, LocalRemoteUnion, LocalRemoteUnionOutcome, RemoteEventBatch,
    RemoteEventLogClassification,
};

// Re-export typed wire values that appear in the event-log public API.
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "serialization boundary: re-exports the validated digest type owned by nook-auth2"
    )
)]
pub use nook_auth2::{
    AgeArmoredCiphertext, AuthKeyId, DeviceId, DevicePublicKey, DeviceSigningPublicKey,
    IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId, PasswordEnvelope,
    PasswordEnvelopeVersion, PasswordUnlockEntry, SecretId, SecretType, SentinelParticipantCount,
    SentinelShareIndex, SentinelShareVersion, SentinelThreshold, Sha256Hex, SigningSeedHex,
    StoreId, StoredRecordPayload, StoredSecretRecord,
};

#[cfg(test)]
mod test_support {
    use core::sync::atomic::{AtomicU64, Ordering};

    use crate::{EventId, EventResult, SigningIdentity};
    use ed25519_dalek::SigningKey;
    use nook_auth2::{AuthKeyId, DeviceSigningPublicKey, StoreId};

    pub(crate) fn signing_key() -> SigningKey {
        static NEXT_SIGNING_KEY: AtomicU64 = AtomicU64::new(1);

        let sequence = NEXT_SIGNING_KEY.fetch_add(1, Ordering::Relaxed);
        let mut bytes = [0_u8; 32];
        bytes[..size_of::<u64>()].copy_from_slice(&sequence.to_le_bytes());
        SigningKey::from_bytes(&bytes)
    }

    pub(crate) fn actor(signing_key: &SigningKey) -> EventResult<AuthKeyId> {
        SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())
    }

    pub(crate) fn public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
        DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().as_bytes()))
    }

    pub(crate) fn epoch() -> EventResult<EventId> {
        EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")
    }

    pub(crate) fn store() -> EventResult<StoreId> {
        StoreId::parse("store_testtoken11").map_err(Into::into)
    }
}
