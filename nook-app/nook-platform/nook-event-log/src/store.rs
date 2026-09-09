//! In-memory event store and set-union synchronization helpers.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::GenesisImportRequest;
use crate::canonical::EventId;
use crate::event::VaultEvent;
use crate::graph::{EventGraph, EventInsertStatus};
mod outbox;
mod remote;
use crate::{EventError, EventResult, EventStorageBytes};
pub use nook_replication::RemoteEventLogClassification;
use nook_replication::ReplicaStore;
pub use remote::{CheckedRemoteEvent, LocalRemoteUnion, LocalRemoteUnionOutcome, RemoteEventBatch};
use std::collections::BTreeSet;

pub struct LocalEventWrite {
    pub event_id: EventId,
    pub bytes: EventStorageBytes,
}
pub struct LocalOutboxWrite<'a> {
    pub provider_id: &'a str,
    pub event: LocalEventWrite,
}
pub struct LocalOutboxRemoval<'a> {
    pub provider_id: &'a str,
    pub event_id: &'a EventId,
}
pub struct LocalEventAppend<'a> {
    pub event: &'a VaultEvent,
    pub store_id: &'a str,
}
#[derive(Debug)]
pub struct LocalEventAppendOutcome {
    pub store: LocalEventStore,
    pub event_id: EventId,
    pub status: EventInsertStatus,
}
#[derive(Debug)]
pub struct LocalOutboxRemoved {
    pub store: LocalEventStore,
    pub bytes: Option<EventStorageBytes>,
}
#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub struct LocalEventStoreRejection {
    pub store: LocalEventStore,
    #[source]
    pub cause: EventError,
}
impl LocalEventStoreRejection {
    pub fn into_cause(self) -> EventError {
        self.cause
    }
}

/// Local event persistence surface (`IndexedDB` / provider adapters implement I/O).
#[derive(Debug, Clone, Default)]
pub struct LocalEventStore {
    replica: ReplicaStore<EventId>,
}

impl LocalEventStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put_event(mut self, request: LocalEventWrite) -> Self {
        self.replica = self
            .replica
            .put_event(nook_replication::ReplicaEventWrite {
                event_id: request.event_id,
                bytes: request.bytes.into(),
            })
            .store;
        self
    }

    #[must_use]
    pub fn get_bytes(&self, event_id: &EventId) -> Option<EventStorageBytes> {
        self.replica
            .get_bytes(event_id)
            .map(|bytes| bytes.to_vec().into())
    }

    #[must_use]
    pub fn event_ids(&self) -> Vec<EventId> {
        self.replica.event_ids()
    }

    #[must_use]
    pub fn missing_event_ids(&self, remote_ids: &BTreeSet<EventId>) -> Vec<EventId> {
        self.replica.missing_event_ids(remote_ids)
    }

    /// Build a causal graph from stored YAML bytes.
    pub fn load_graph(&self, store_id: &str) -> EventResult<EventGraph> {
        let mut graph = EventGraph::new();
        for event_id in self.replica.event_ids() {
            let bytes =
                self.replica
                    .get_bytes(&event_id)
                    .ok_or_else(|| EventError::MissingEvent {
                        event_id: event_id.as_str().to_owned(),
                    })?;
            let event = VaultEvent::parse_event_storage_bytes(&bytes.to_vec().into())?;
            graph = graph
                .insert(crate::EventGraphInsert {
                    event,
                    expected_store_id: store_id,
                })
                .map_err(|rejected| rejected.into_cause())?
                .graph;
        }
        Ok(graph)
    }

    /// Insert a signed event into the local store.
    pub fn append_event(
        self,
        request: LocalEventAppend<'_>,
    ) -> Result<LocalEventAppendOutcome, LocalEventStoreRejection> {
        let LocalEventAppend { event, store_id } = request;
        let prepared: EventResult<_> = (|| {
            let event_id = event.validate_envelope(&crate::StoreId::parse(store_id)?)?;
            let bytes = VaultEvent::serialize_event_storage_yaml(event)?;
            if self.replica.contains_event(&event_id) {
                return Ok((event_id, bytes, EventInsertStatus::Duplicate));
            }
            let graph = self.load_graph(store_id)?;
            let inserted = graph
                .insert(crate::EventGraphInsert {
                    event: event.clone(),
                    expected_store_id: store_id,
                })
                .map_err(|rejected| rejected.into_cause())?;
            Ok((event_id, bytes, inserted.status))
        })();
        let (event_id, bytes, status) = match prepared {
            Ok(prepared) => prepared,
            Err(cause) => return Err(LocalEventStoreRejection { store: self, cause }),
        };
        let store = match status {
            EventInsertStatus::Quarantined(_) | EventInsertStatus::Duplicate => self,
            _ => self.put_event(LocalEventWrite {
                event_id: event_id.clone(),
                bytes,
            }),
        };
        Ok(LocalEventAppendOutcome {
            store,
            event_id,
            status,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical::Ed25519Signature;
    use crate::event::{
        EncryptedSecretPayload, GenesisImportPayload, VaultEvent, VaultEventBody,
        VaultEventSchemaVersion, VaultOperation,
    };
    use crate::graph::EventInsertStatus;
    use crate::signing::SigningIdentity;
    use crate::test_support::signing_key;
    use crate::{EventResult, SecretFingerprint};
    use ed25519_dalek::SigningKey;
    use nook_auth2::SecretType;
    use nook_auth2::{DeviceSigningPublicKey, IsoTimestamp, OpaqueCiphertext, Sha256Hex};
    use nook_auth2::{SecretId, StoreId};

    impl SignedEventFixture<'_> {
        fn genesis(&self) -> EventResult<VaultEvent> {
            self.genesis_for_store("store_testtoken11")
        }
    }

    impl SignedEventFixture<'_> {
        fn genesis_for_store(&self, store_id: &str) -> EventResult<VaultEvent> {
            let signing_key = self.signing_key;
            VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &StoreId::parse(store_id)?,
                actor_id: &SigningIdentity::actor_id_for_verifying_key(
                    &signing_key.verifying_key(),
                )?,
                key_epoch: &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                payload: GenesisImportPayload {
                    source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                    secrets: vec![],
                    password_entries: vec![],
                },
                created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                signing_key: signing_key,
            })
        }
    }

    struct SignedEventFixture<'a> {
        signing_key: &'a SigningKey,
    }

    const STORE: &str = "store_testtoken11";

    impl SignedEventFixture<'_> {
        fn public_key(&self) -> DeviceSigningPublicKey {
            let signing_key = self.signing_key;
            DeviceSigningPublicKey::from_trusted(hex::encode(
                signing_key.verifying_key().as_bytes(),
            ))
        }
    }

    impl SignedEventFixture<'_> {
        fn signed_child(&self, parent: EventId, secret_id: &str) -> EventResult<VaultEvent> {
            let signing_key = self.signing_key;
            let body = VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: StoreId::parse(STORE)?,
                actor_id: SigningIdentity::actor_id_for_verifying_key(
                    &signing_key.verifying_key(),
                )?,
                actor_signing_public_key: self.public_key(),
                parents: vec![parent],
                created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                key_epoch: EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                operations: vec![VaultOperation::SecretCreated {
                    secret: EncryptedSecretPayload {
                        id: SecretId::from_vault_record(secret_id),
                        secret_type: SecretType::ApiKey,
                        ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
                        identity_fingerprint: SecretFingerprint::from_trusted(format!(
                            "test-identity:{secret_id}"
                        )),
                        fingerprint: SecretFingerprint::from_trusted(format!(
                            "test-version:{secret_id}"
                        )),
                    },
                }],
            };
            VaultEvent::sign(body, signing_key)
        }
    }

    impl VaultEvent {
        fn remote_record(&self) -> EventResult<(EventId, EventStorageBytes)> {
            Ok((self.id()?, VaultEvent::serialize_event_storage_yaml(self)?))
        }
    }

    #[test]
    fn union_imports_missing_events() -> EventResult<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let id = genesis.id()?;
        let bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;

        let mut local = LocalEventStore::new();
        match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(id.clone(), bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        assert!(local.get_bytes(&id).is_some());
        Ok(())
    }

    #[test]
    fn append_event_reports_applied_for_genesis() -> EventResult<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;

        let mut local = LocalEventStore::new();
        let (id, status) = match local.append_event(crate::LocalEventAppend {
            event: &genesis,
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok((outcome.event_id, outcome.status))
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        assert!(local.get_bytes(&id).is_some());
        assert_eq!(status, EventInsertStatus::Applied);
        Ok(())
    }

    #[test]
    fn append_event_duplicate_is_idempotent() -> EventResult<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let mut local = LocalEventStore::new();
        let (_, first) = match local.append_event(crate::LocalEventAppend {
            event: &genesis,
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok((outcome.event_id, outcome.status))
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        let (_, second) = match local.append_event(crate::LocalEventAppend {
            event: &genesis,
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok((outcome.event_id, outcome.status))
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        assert_eq!(first, EventInsertStatus::Applied);
        assert_eq!(second, EventInsertStatus::Duplicate);
        Ok(())
    }

    #[test]
    fn union_remote_events_and_heads_returns_causal_heads() -> EventResult<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let id = genesis.id()?;
        let bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;

        let mut local = LocalEventStore::new();
        let heads = match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(id.clone(), bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.heads)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        assert_eq!(heads.len(), 1);
        assert_eq!(heads[0], id.as_str());
        Ok(())
    }

    #[test]
    fn union_commutative_on_event_sets() -> EventResult<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;

        let mut local_a = LocalEventStore::new();
        local_a = local_a.put_event(crate::LocalEventWrite {
            event_id: genesis_id.clone(),
            bytes: genesis_bytes.clone(),
        });
        let mut local_b = LocalEventStore::new();

        match local_a.union_remote(crate::LocalRemoteUnion {
            remote_events: &[],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local_a = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local_a = rejected.store;
                Err(rejected.cause)
            }
        }?;
        match local_b.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(genesis_id.clone(), genesis_bytes.clone())],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local_b = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local_b = rejected.store;
                Err(rejected.cause)
            }
        }?;
        match local_a.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(genesis_id, genesis_bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local_a = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local_a = rejected.store;
                Err(rejected.cause)
            }
        }?;

        assert_eq!(local_a.event_ids().len(), local_b.event_ids().len());
        Ok(())
    }

    #[test]
    fn union_rejects_event_id_mismatch() -> anyhow::Result<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let real_id = genesis.id()?;
        let bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;
        let wrong_id = EventId::parse("sha256u:3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d0")?;

        let mut local = LocalEventStore::new();
        let err = match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(wrong_id, bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }
        .err()
        .ok_or_else(|| anyhow::anyhow!("store test should reject invalid input"))?;
        assert!(matches!(err, EventError::RemoteEventIdMismatch { .. }));
        assert!(local.get_bytes(&real_id).is_none());
        Ok(())
    }

    #[test]
    fn remote_event_store_filter_skips_other_vaults() -> EventResult<()> {
        let signing_key = signing_key();
        let other = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis_for_store("store_otherstore1")?;
        let other_id = other.id()?;
        let bytes = VaultEvent::serialize_event_storage_yaml(&other)?;

        assert_eq!(
            CheckedRemoteEvent::parse(&other_id, &bytes)
                .map(CheckedRemoteEvent::into_store_id)?
                .as_str(),
            "store_otherstore1"
        );
        assert!(
            !CheckedRemoteEvent::parse(&other_id, &bytes)
                .map(|event| event.belongs_to_store(STORE))?
        );
        assert!(
            CheckedRemoteEvent::parse(&other_id, &bytes)
                .map(|event| event.belongs_to_store("store_otherstore1"))?
        );
        Ok(())
    }

    #[test]
    fn remote_event_store_filter_rejects_id_mismatch() -> anyhow::Result<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;
        let wrong_id = EventId::parse("sha256u:3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d0")?;

        let err = CheckedRemoteEvent::parse(&wrong_id, &bytes)
            .map(|event| event.belongs_to_store(STORE))
            .err()
            .ok_or_else(|| anyhow::anyhow!("store test should reject invalid input"))?;
        assert!(matches!(err, EventError::RemoteEventIdMismatch { .. }));
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_allows_empty_provider() -> EventResult<()> {
        assert_eq!(
            RemoteEventBatch::new(&[]).classify(Some(STORE))?,
            RemoteEventLogClassification::Empty
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_allows_same_store() -> EventResult<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let remote = vec![genesis.remote_record()?];

        assert_eq!(
            RemoteEventBatch::new(&remote).classify(Some(STORE))?,
            RemoteEventLogClassification::SameStore {
                store_id: STORE.to_owned()
            }
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_adopts_single_store_when_local_empty() -> EventResult<()> {
        let signing_key = signing_key();
        let remote = vec![
            (SignedEventFixture {
                signing_key: &signing_key,
            }
            .genesis_for_store("store_otherstore1")?)
            .remote_record()?,
        ];

        assert_eq!(
            RemoteEventBatch::new(&remote).classify(None)?,
            RemoteEventLogClassification::SameStore {
                store_id: "store_otherstore1".to_owned()
            }
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_blocks_different_store() -> EventResult<()> {
        let signing_key = signing_key();
        let remote = vec![
            (SignedEventFixture {
                signing_key: &signing_key,
            }
            .genesis_for_store("store_otherstore1")?)
            .remote_record()?,
        ];

        assert_eq!(
            RemoteEventBatch::new(&remote).classify(Some(STORE))?,
            RemoteEventLogClassification::DifferentStore {
                local_store_id: STORE.to_owned(),
                remote_store_id: "store_otherstore1".to_owned()
            }
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_blocks_multiple_stores() -> EventResult<()> {
        let signing_key = signing_key();
        let local = (SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?)
        .remote_record()?;
        let remote = (SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis_for_store("store_otherstore1")?)
        .remote_record()?;

        assert_eq!(
            RemoteEventBatch::new(&[local, remote]).classify(Some(STORE))?,
            RemoteEventLogClassification::MultipleStores {
                store_ids: vec!["store_otherstore1".to_owned(), STORE.to_owned()]
            }
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_fails_closed_on_unreadable_event() -> anyhow::Result<()> {
        let event_id = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let err = RemoteEventBatch::new(&[(event_id, b"not event yaml".to_vec().into())])
            .classify(Some(STORE))
            .err()
            .ok_or_else(|| anyhow::anyhow!("store test should reject invalid input"))?;
        assert!(matches!(err, EventError::ParseRemoteEvent(_)));
        assert!(
            err.to_string()
                .contains("failed to parse remote event: YAML parse failed:")
        );
        Ok(())
    }

    #[test]
    fn union_rejects_current_schema_event_with_bad_signature() -> anyhow::Result<()> {
        let signing_key = signing_key();
        let mut genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let event_id = genesis.id()?;
        genesis.signature = Ed25519Signature::from_trusted(format!("ed25519:{}", "00".repeat(64)));
        let bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;

        let mut local = LocalEventStore::new();
        let err = match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(event_id.clone(), bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }
        .err()
        .ok_or_else(|| anyhow::anyhow!("store test should reject invalid input"))?;
        assert!(matches!(err, EventError::SignatureVerificationFailed));
        assert!(local.get_bytes(&event_id).is_none());
        Ok(())
    }

    #[test]
    fn union_skips_unapproved_actor_event() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &root_key,
        }
        .genesis()?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;
        let child = SignedEventFixture {
            signing_key: &stranger_key,
        }
        .signed_child(genesis_id.clone(), "secret_remoteuna1")?;
        let child_id = child.id()?;
        let child_bytes = VaultEvent::serialize_event_storage_yaml(&child)?;

        let mut local = LocalEventStore::new();
        match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(genesis_id, genesis_bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        let imported = match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(child_id.clone(), child_bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        assert!(imported.is_empty());
        assert!(local.load_graph(STORE)?.quarantined().is_empty());
        assert!(local.get_bytes(&child_id).is_none());
        Ok(())
    }

    #[test]
    fn union_stages_batch_and_quarantines_unauthorized_child() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &root_key,
        }
        .genesis()?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;
        let child = SignedEventFixture {
            signing_key: &stranger_key,
        }
        .signed_child(genesis_id.clone(), "secret_batchbad1")?;
        let child_id = child.id()?;
        let child_bytes = VaultEvent::serialize_event_storage_yaml(&child)?;

        let mut local = LocalEventStore::new();
        let imported = match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[
                (genesis_id.clone(), genesis_bytes),
                (child_id.clone(), child_bytes),
            ],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;

        assert_eq!(imported, vec![genesis_id.clone()]);
        assert!(local.get_bytes(&genesis_id).is_some());
        assert!(local.get_bytes(&child_id).is_none());
        assert!(local.load_graph(STORE)?.quarantined().is_empty());
        Ok(())
    }

    #[test]
    fn union_removes_pending_event_that_becomes_unauthorized() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &root_key,
        }
        .genesis()?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;
        let child = SignedEventFixture {
            signing_key: &stranger_key,
        }
        .signed_child(genesis_id.clone(), "secret_pendingbad1")?;
        let child_id = child.id()?;
        let child_bytes = VaultEvent::serialize_event_storage_yaml(&child)?;

        let mut local = LocalEventStore::new();
        let imported = match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(child_id.clone(), child_bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        assert_eq!(imported, vec![child_id.clone()]);
        assert!(local.get_bytes(&child_id).is_some());

        match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(genesis_id.clone(), genesis_bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        assert!(local.get_bytes(&genesis_id).is_some());
        assert!(local.get_bytes(&child_id).is_none());
        assert!(local.load_graph(STORE)?.quarantined().is_empty());
        Ok(())
    }

    #[test]
    fn union_graph_failure_preserves_existing_events_and_outbox() -> EventResult<()> {
        let signing_key = signing_key();
        let remote = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let remote_id = remote.id()?;
        let remote_bytes = VaultEvent::serialize_event_storage_yaml(&remote)?;
        let existing_id = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        let existing_bytes = EventStorageBytes::from(b"not event yaml".to_vec());

        let mut local = LocalEventStore::new();
        local = local.put_event(crate::LocalEventWrite {
            event_id: existing_id.clone(),
            bytes: existing_bytes.clone(),
        });
        local = local.queue_outbox(crate::LocalOutboxWrite {
            provider_id: "drive",
            event: crate::LocalEventWrite {
                event_id: existing_id.clone(),
                bytes: existing_bytes.clone(),
            },
        });
        let before_event_ids = local.event_ids();
        let before_outbox = local.pending_outbox("drive");

        let result = match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(remote_id.clone(), remote_bytes)],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        };

        assert!(matches!(result, Err(EventError::ParseStoredEvent(_))));
        assert_eq!(local.event_ids(), before_event_ids);
        assert_eq!(local.get_bytes(&existing_id), Some(existing_bytes.clone()));
        assert_eq!(local.pending_outbox("drive"), before_outbox);
        assert!(local.get_bytes(&remote_id).is_none());
        Ok(())
    }

    #[test]
    fn union_preserves_existing_outbox_entries() -> EventResult<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;
        let child = SignedEventFixture {
            signing_key: &signing_key,
        }
        .signed_child(genesis_id.clone(), "secret_remoteout1")?;
        let child_id = child.id()?;
        let child_bytes = VaultEvent::serialize_event_storage_yaml(&child)?;

        let mut local = LocalEventStore::new();
        local = local.put_event(crate::LocalEventWrite {
            event_id: genesis_id.clone(),
            bytes: genesis_bytes.clone(),
        });
        local = local.queue_outbox(crate::LocalOutboxWrite {
            provider_id: "drive",
            event: crate::LocalEventWrite {
                event_id: genesis_id.clone(),
                bytes: genesis_bytes.clone(),
            },
        });

        assert_eq!(
            match local.union_remote(crate::LocalRemoteUnion {
                remote_events: &[(child_id.clone(), child_bytes)],
                store_id: STORE
            }) {
                Ok(outcome) => {
                    local = outcome.store;
                    Ok(outcome.imported)
                }
                Err(rejected) => {
                    local = rejected.store;
                    Err(rejected.cause)
                }
            }?,
            vec![child_id]
        );
        assert_eq!(
            local.pending_outbox("drive"),
            vec![(genesis_id, genesis_bytes)]
        );
        Ok(())
    }

    #[test]
    fn bidirectional_union_converges() -> EventResult<()> {
        let signing_key = signing_key();
        let genesis = SignedEventFixture {
            signing_key: &signing_key,
        }
        .genesis()?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = VaultEvent::serialize_event_storage_yaml(&genesis)?;

        let mut device_a = LocalEventStore::new();
        device_a = device_a.put_event(crate::LocalEventWrite {
            event_id: genesis_id.clone(),
            bytes: genesis_bytes.clone(),
        });

        let mut device_b = LocalEventStore::new();
        device_b = device_b.put_event(crate::LocalEventWrite {
            event_id: genesis_id.clone(),
            bytes: genesis_bytes.clone(),
        });

        match device_a.union_remote(crate::LocalRemoteUnion {
            remote_events: &device_b
                .event_ids()
                .iter()
                .filter_map(|id| device_b.get_bytes(id).map(|bytes| (id.clone(), bytes)))
                .collect::<Vec<_>>(),
            store_id: STORE,
        }) {
            Ok(outcome) => {
                device_a = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                device_a = rejected.store;
                Err(rejected.cause)
            }
        }?;
        match device_b.union_remote(crate::LocalRemoteUnion {
            remote_events: &device_a
                .event_ids()
                .iter()
                .filter_map(|id| device_a.get_bytes(id).map(|bytes| (id.clone(), bytes)))
                .collect::<Vec<_>>(),
            store_id: STORE,
        }) {
            Ok(outcome) => {
                device_b = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                device_b = rejected.store;
                Err(rejected.cause)
            }
        }?;

        assert_eq!(device_a.event_ids(), device_b.event_ids());
        Ok(())
    }
}
