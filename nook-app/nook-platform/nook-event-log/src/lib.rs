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
mod epoch_checkpoint_state;
mod epoch_vault_name;
mod errors;
mod event;
mod event_bytes;
mod fingerprint;
mod graph;
mod identity_control;
mod location;
mod projection;
mod remote_epoch_visibility;
mod signing;
mod store;

pub use builder::{AppendEventInput, ObservedHeads};
pub use canonical::{Ed25519Signature, EventId};
pub use epoch::{
    ConcurrentEpochRotations, EpochRecord, EpochRotationReason, EpochTransition, KeyEpoch,
};
pub use epoch_checkpoint_state::EpochMetadataState;
pub use epoch_vault_name::EpochVaultName;
pub use errors::{EventError, EventResult};
pub use event::{
    EncryptedSecretPayload, EpochCheckpointRequirement, GenesisImportContents,
    GenesisImportPayload, GenesisImportRequest, SecurityRotationTrigger,
    SentinelShareIssuedPayload, VaultEvent, VaultEventBody, VaultEventSchemaVersion,
    VaultOperation,
};
pub use event_bytes::{CanonicalEventBodyBytes, EventStorageBytes};
pub use fingerprint::SecretFingerprint;
pub use graph::{
    EventGraph, EventGraphInsert, EventGraphInsertion, EventGraphRejection,
    EventGraphReplacementEvidence, EventGraphVaultArchitecture, EventInsertStatus, EventLookup,
    EventPendingReason, VaultAuthorizedRoster, VaultRosterMember,
};
pub use identity_control::{
    IdentityApprovalRequest, IdentityControlInsertion, IdentityControlLog, IdentityControlMember,
    IdentityControlOperation, IdentityControlRejection, IdentityControlState, IdentityControlVault,
    IdentityEvent, IdentityEventBody, IdentityEventInsertStatus, IdentityEventSchemaVersion,
    IdentityEventSigning, IdentityGenesisRequest, IdentityInvite, IdentityInviteIssue,
    IdentityInviteJoin, IdentityInviteProof, IdentityJoinRequest, IdentityMemberAddition,
    IdentityMemberApprover, IdentityMemberKeys, IdentityMemberKind, IdentityMountTarget,
    IdentityNaming, IdentityProviderMount, IdentityRecoveryAddition, IdentityRecoveryApproval,
    IdentityRecoveryMember, IdentityVaultDekGrant, IdentityVaultDekLookup, IdentityVaultEpochDeks,
    IdentityVaultRegistration, MemberDevice, MemberSealedName, MemberVaultDek, OpenedVaultDek,
    ProviderMountId, S3MountTarget,
};
pub use location::{
    EventLogLocation, EventLogNamespaceKind, IDENTITY_LOG_DIR, PROVIDER_ROOT_DIR, PlacedNamespace,
    VaultPlacement,
};
pub use nook_replication::CausalGraphEventCount as EventCount;
pub use projection::{
    EpochCheckpoint, ProjectedSecret, ProjectedSecretLifecycle, ProjectedSecretOrigin,
    ProjectedVaultName, ProjectionEpoch, ProjectionIntegrity, SecretReplacementConflict,
    SecurityConflict, VaultProjection,
};
pub use remote_epoch_visibility::RemoteEventWrites;
pub use signing::SigningIdentity;
pub use store::{
    CheckedRemoteEvent, LocalEventAppend, LocalEventAppendOutcome, LocalEventBytes,
    LocalEventStore, LocalEventStoreRejection, LocalEventWrite, LocalOutboxRemoval,
    LocalOutboxRemovalResult, LocalOutboxRemoved, LocalOutboxWrite, LocalRemoteUnion,
    LocalRemoteUnionOutcome, RemoteEventBatch, RemoteEventLogClassification, RemoteStoreIdentity,
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
    IsoTimestamp, MemberLabel, OpaqueCiphertext, SecretId, SecretType, SentinelParticipantCount,
    SentinelShareIndex, SentinelShareVersion, SentinelThreshold, Sha256Hex, SigningSeedHex,
    StoreId, StoredRecordPayload, StoredSecretRecord,
};

#[cfg(test)]
mod test_support {
    use core::sync::atomic::{AtomicU64, Ordering};

    use crate::event::{
        EncryptedSecretPayload, GenesisImportPayload, VaultEvent, VaultEventBody,
        VaultEventSchemaVersion, VaultOperation,
    };
    use crate::{
        EventGraph, EventGraphInsert, EventGraphInsertion, EventGraphRejection, EventId,
        EventResult, GenesisImportRequest, SigningIdentity,
    };
    use ed25519_dalek::SigningKey;
    use nook_auth2::{AuthKeyId, DeviceSigningPublicKey, StoreId};
    use nook_auth2::{IsoTimestamp, OpaqueCiphertext, SecretId, Sha256Hex};

    pub(crate) fn signing_key() -> SigningKey {
        static NEXT_SIGNING_KEY: AtomicU64 = AtomicU64::new(1);

        let sequence = NEXT_SIGNING_KEY.fetch_add(1, Ordering::Relaxed);
        let mut bytes = [0_u8; 32];
        for (slot, byte) in bytes.iter_mut().zip(sequence.to_le_bytes()) {
            *slot = byte;
        }
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
        StoreId::parse(EventGraph::FIXTURE_STORE_ID).map_err(Into::into)
    }

    pub(crate) struct ChildSecret<'a> {
        pub(crate) parents: Vec<EventId>,
        pub(crate) secret_id: &'a str,
    }

    impl ChildSecret<'_> {
        pub(crate) fn sign(self, signing_key: &SigningKey) -> EventResult<VaultEvent> {
            let Self { parents, secret_id } = self;
            let body = VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store()?,
                actor_id: actor(signing_key)?,
                actor_signing_public_key: public_key(signing_key),
                parents,
                created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                key_epoch: epoch()?,
                operations: vec![VaultOperation::SecretCreated {
                    secret: EncryptedSecretPayload {
                        id: SecretId::from_vault_record(secret_id),
                        secret_type: crate::SecretType::ApiKey,
                        ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{secret_id}")),
                        identity_fingerprint: crate::SecretFingerprint::from_trusted(format!(
                            "test-identity:{secret_id}"
                        )),
                        fingerprint: crate::SecretFingerprint::from_trusted(format!(
                            "test-version:{secret_id}"
                        )),
                    },
                }],
            };
            VaultEvent::sign(body, signing_key)
        }
    }

    impl VaultEvent {
        pub(crate) fn fixture_genesis(signing_key: &SigningKey) -> EventResult<Self> {
            VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &store()?,
                actor_id: &actor(signing_key)?,
                key_epoch: &epoch()?,
                payload: GenesisImportPayload {
                    source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                    secrets: vec![],
                },
                created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                signing_key,
            })
        }
    }

    impl EventGraph {
        pub(crate) const FIXTURE_STORE_ID: &str = "store_testtoken11";
        pub(crate) fn insert_fixture_event(
            self,
            event: VaultEvent,
        ) -> EventResult<EventGraphInsertion> {
            self.insert(EventGraphInsert {
                event,
                expected_store_id: Self::FIXTURE_STORE_ID,
            })
            .map_err(EventGraphRejection::into_cause)
        }
    }
}
