//! In-memory event store and set-union synchronization helpers.

use crate::canonical::EventId;
use crate::event::{
    VaultEvent, VaultEventSchemaVersion, parse_event_storage_bytes,
    parse_remote_event_storage_bytes, serialize_event_storage_yaml,
};
use crate::graph::{EventGraph, EventInsertStatus};
use crate::{EventError, EventResult};
use nook_auth2::StoreId;
pub use nook_replication::RemoteEventLogClassification;
use nook_replication::ReplicaStore;
use std::collections::BTreeSet;

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

    pub fn put_event(&mut self, event_id: EventId, storage_bytes: Vec<u8>) {
        let _ = self.replica.put_event(event_id, storage_bytes);
    }

    #[must_use]
    pub fn get_bytes(&self, event_id: &EventId) -> Option<&[u8]> {
        self.replica.get_bytes(event_id)
    }

    #[must_use]
    pub fn event_ids(&self) -> Vec<EventId> {
        self.replica.event_ids()
    }

    pub fn queue_outbox(&mut self, provider_id: &str, event_id: EventId, bytes: Vec<u8>) {
        let _ = self.replica.queue_outbox(provider_id, event_id, bytes);
    }

    pub fn dequeue_outbox(&mut self, provider_id: &str, event_id: &EventId) -> Option<Vec<u8>> {
        self.replica.dequeue_outbox(provider_id, event_id)
    }

    #[must_use]
    pub fn pending_outbox(&self, provider_id: &str) -> Vec<(EventId, Vec<u8>)> {
        self.replica.pending_outbox(provider_id)
    }

    #[must_use]
    pub fn missing_event_ids(&self, remote_ids: &BTreeSet<EventId>) -> Vec<EventId> {
        self.replica.missing_event_ids(remote_ids)
    }

    /// Build a causal graph from stored YAML bytes.
    pub fn load_graph(&self, store_id: &str) -> EventResult<EventGraph> {
        let mut graph = EventGraph::new();
        for event_id in self.replica.event_ids() {
            let bytes = self
                .replica
                .get_bytes(&event_id)
                .expect("event id came from replica store");
            let event = parse_event_storage_bytes(bytes)?;
            let _ = graph.insert(event, store_id)?;
        }
        Ok(graph)
    }

    /// Insert a signed event into the local store.
    pub fn append_event(
        &mut self,
        event: &VaultEvent,
        store_id: &str,
    ) -> EventResult<(EventId, EventInsertStatus)> {
        let event_id = event.validate_envelope(&crate::StoreId::parse(store_id)?)?;
        let bytes = serialize_event_storage_yaml(event)?;
        if self.replica.contains_event(&event_id) {
            return Ok((event_id, EventInsertStatus::Duplicate));
        }
        let mut graph = self.load_graph(store_id)?;
        let status = graph.insert(event.clone(), store_id)?;
        if !matches!(status, EventInsertStatus::Quarantined(_)) {
            self.put_event(event_id.clone(), bytes);
        }
        Ok((event_id, status))
    }
}

/// Merge remote event ids into the local store (commutative set union).
pub fn union_remote_events(
    local: &mut LocalEventStore,
    remote_events: &[(EventId, Vec<u8>)],
    store_id: &str,
) -> EventResult<Vec<EventId>> {
    let mut candidate = local.clone();
    let mut candidates = Vec::new();
    for (event_id, bytes) in remote_events {
        if local.get_bytes(event_id).is_some() || candidate.get_bytes(event_id).is_some() {
            continue;
        }
        let event = parse_remote_event_storage_bytes(bytes)?;
        if event.id()? != *event_id {
            return Err(EventError::RemoteEventIdMismatch {
                event_id: event_id.as_str().to_owned(),
            });
        }
        event.validate_envelope(&crate::StoreId::parse(store_id)?)?;
        candidate.put_event(event_id.clone(), bytes.clone());
        candidates.push(event_id.clone());
    }
    if candidates.is_empty() {
        let _ = local.load_graph(store_id)?;
        return Ok(Vec::new());
    }

    let graph = candidate.load_graph(store_id)?;
    let quarantined: BTreeSet<EventId> = graph.quarantined().keys().cloned().collect();
    let mut accepted = LocalEventStore::new();
    for event_id in candidate.event_ids() {
        if quarantined.contains(&event_id) {
            continue;
        }
        let bytes = candidate
            .get_bytes(&event_id)
            .expect("candidate event was inserted before graph validation")
            .to_vec();
        accepted.put_event(event_id, bytes);
    }
    for (provider_id, event_id, bytes) in local.replica.outbox_entries() {
        if !quarantined.contains(&event_id) {
            accepted.queue_outbox(&provider_id, event_id, bytes);
        }
    }
    let imported = candidates
        .into_iter()
        .filter(|event_id| !quarantined.contains(event_id))
        .collect();
    let _ = accepted.load_graph(store_id)?;
    *local = accepted;
    Ok(imported)
}

/// Set-union remote events and return updated causal head ids.
pub fn union_remote_events_and_heads(
    local: &mut LocalEventStore,
    remote_events: &[(EventId, Vec<u8>)],
    store_id: &str,
) -> EventResult<Vec<String>> {
    union_remote_events(local, remote_events, store_id)?;
    let graph = local.load_graph(store_id)?;
    Ok(graph
        .heads()
        .into_iter()
        .map(|id| id.as_str().to_owned())
        .collect())
}

/// Validate a remote event's content-addressed id and test whether it belongs to
/// the active vault. Providers may physically contain events for multiple
/// vaults; those unrelated events must not poison this vault's projection.
pub fn remote_event_belongs_to_store(
    event_id: &EventId,
    bytes: &[u8],
    store_id: &str,
) -> EventResult<bool> {
    Ok(remote_event_store_id(event_id, bytes)?.as_str() == store_id)
}

/// Validate a remote event's content-addressed id and actor signature, then
/// return the store id declared by the signed body.
pub fn remote_event_store_id(event_id: &EventId, bytes: &[u8]) -> EventResult<StoreId> {
    let event = parse_remote_event_storage_bytes(bytes)?;
    if event.id()? != *event_id {
        return Err(EventError::RemoteEventIdMismatch {
            event_id: event_id.as_str().to_owned(),
        });
    }
    if event.body.schema_version != VaultEventSchemaVersion::CURRENT {
        return Err(EventError::UnsupportedSchemaVersion {
            version: event.body.schema_version.get(),
        });
    }
    event.validate_actor_signature()?;
    Ok(event.body.store_id)
}

/// Classify remote provider events before any local event is written back.
///
/// Providers should fail closed when they contain another logical vault. An
/// empty active `store_id` means the device may adopt a single provider vault,
/// but multiple provider vaults are ambiguous and must not be auto-merged.
pub fn classify_remote_event_log(
    remote_events: &[(EventId, Vec<u8>)],
    active_store_id: Option<&str>,
) -> EventResult<RemoteEventLogClassification> {
    let mut remote_store_ids = BTreeSet::new();
    for (event_id, bytes) in remote_events {
        remote_store_ids.insert(remote_event_store_id(event_id, bytes)?.as_str().to_owned());
    }

    if remote_store_ids.is_empty() {
        return Ok(RemoteEventLogClassification::Empty);
    }

    let active_store_id = active_store_id
        .map(str::trim)
        .filter(|store_id| !store_id.is_empty());

    if remote_store_ids.len() > 1 {
        return Ok(RemoteEventLogClassification::MultipleStores {
            store_ids: remote_store_ids.into_iter().collect(),
        });
    }

    let remote_store_id =
        remote_store_ids
            .into_iter()
            .next()
            .ok_or_else(|| EventError::MissingEvent {
                event_id: "provider-store-id".to_owned(),
            })?;

    match active_store_id {
        Some(local_store_id) if local_store_id != remote_store_id => {
            Ok(RemoteEventLogClassification::DifferentStore {
                local_store_id: local_store_id.to_owned(),
                remote_store_id,
            })
        }
        _ => Ok(RemoteEventLogClassification::SameStore {
            store_id: remote_store_id,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EventResult;
    use crate::canonical::Ed25519Signature;
    use crate::event::{
        EncryptedSecretPayload, GenesisImportPayload, VaultEvent, VaultEventBody,
        VaultEventSchemaVersion, VaultOperation, build_genesis_import_event,
    };
    use crate::graph::EventInsertStatus;
    use crate::signing::SigningIdentity;
    use ed25519_dalek::SigningKey;
    use nook_auth2::SecretType;
    use nook_auth2::{DeviceSigningPublicKey, IsoTimestamp, OpaqueCiphertext, Sha256Hex};
    use nook_auth2::{SecretId, StoreId};
    use rand_core::OsRng;

    fn genesis(signing_key: &SigningKey) -> EventResult<crate::event::VaultEvent> {
        genesis_for_store(signing_key, "store_testtoken11")
    }

    fn genesis_for_store(
        signing_key: &SigningKey,
        store_id: &str,
    ) -> EventResult<crate::event::VaultEvent> {
        build_genesis_import_event(
            &StoreId::parse(store_id)?,
            &SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?,
            &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![],
                password_entries: vec![],
            },
            &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            signing_key,
        )
    }

    const STORE: &str = "store_testtoken11";

    fn public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
        DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().as_bytes()))
    }

    fn signed_child(
        signing_key: &SigningKey,
        parent: EventId,
        secret_id: &str,
    ) -> EventResult<VaultEvent> {
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse(STORE)?,
            actor_id: SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?,
            actor_signing_public_key: public_key(signing_key),
            parents: vec![parent],
            created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            key_epoch: EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
            operations: vec![VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload {
                    id: SecretId::from_vault_record(secret_id),
                    secret_type: SecretType::ApiKey,
                    ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
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

    fn remote_record(event: &VaultEvent) -> EventResult<(EventId, Vec<u8>)> {
        Ok((event.id()?, serialize_event_storage_yaml(event)?))
    }

    #[test]
    fn union_imports_missing_events() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let id = genesis.id()?;
        let bytes = serialize_event_storage_yaml(&genesis)?;

        let mut local = LocalEventStore::new();
        union_remote_events(&mut local, &[(id.clone(), bytes)], STORE)?;
        assert!(local.get_bytes(&id).is_some());
        Ok(())
    }

    #[test]
    fn append_event_reports_applied_for_genesis() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;

        let mut local = LocalEventStore::new();
        let (id, status) = local.append_event(&genesis, STORE)?;
        assert!(local.get_bytes(&id).is_some());
        assert_eq!(status, EventInsertStatus::Applied);
        Ok(())
    }

    #[test]
    fn outbox_queue_and_dequeue() -> EventResult<()> {
        let mut local = LocalEventStore::new();
        let id = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        let bytes = b"event-bytes".to_vec();
        local.queue_outbox("github", id.clone(), bytes.clone());
        assert_eq!(local.pending_outbox("github").len(), 1);
        let dequeued = local
            .dequeue_outbox("github", &id)
            .ok_or(EventError::MissingOutboxEntry)?;
        assert_eq!(dequeued, bytes);
        assert!(local.pending_outbox("github").is_empty());
        Ok(())
    }

    #[test]
    fn append_event_duplicate_is_idempotent() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let mut local = LocalEventStore::new();
        let (_, first) = local.append_event(&genesis, STORE)?;
        let (_, second) = local.append_event(&genesis, STORE)?;
        assert_eq!(first, EventInsertStatus::Applied);
        assert_eq!(second, EventInsertStatus::Duplicate);
        Ok(())
    }

    #[test]
    fn union_remote_events_and_heads_returns_causal_heads() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let id = genesis.id()?;
        let bytes = serialize_event_storage_yaml(&genesis)?;

        let mut local = LocalEventStore::new();
        let heads = union_remote_events_and_heads(&mut local, &[(id.clone(), bytes)], STORE)?;
        assert_eq!(heads.len(), 1);
        assert_eq!(heads[0], id.as_str());
        Ok(())
    }

    #[test]
    fn union_commutative_on_event_sets() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serialize_event_storage_yaml(&genesis)?;

        let mut local_a = LocalEventStore::new();
        local_a.put_event(genesis_id.clone(), genesis_bytes.clone());
        let mut local_b = LocalEventStore::new();

        union_remote_events(&mut local_a, &[], STORE)?;
        union_remote_events(
            &mut local_b,
            &[(genesis_id.clone(), genesis_bytes.clone())],
            STORE,
        )?;
        union_remote_events(&mut local_a, &[(genesis_id, genesis_bytes)], STORE)?;

        assert_eq!(local_a.event_ids().len(), local_b.event_ids().len());
        Ok(())
    }

    #[test]
    fn union_rejects_event_id_mismatch() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let real_id = genesis.id()?;
        let bytes = serialize_event_storage_yaml(&genesis)?;
        let wrong_id = EventId::parse("sha256u:3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d0")?;

        let mut local = LocalEventStore::new();
        let err = union_remote_events(&mut local, &[(wrong_id, bytes)], STORE)
            .expect_err("store test should reject invalid input");
        assert!(matches!(
            err,
            crate::EventError::RemoteEventIdMismatch { .. }
        ));
        assert!(local.get_bytes(&real_id).is_none());
        Ok(())
    }

    #[test]
    fn remote_event_store_filter_skips_other_vaults() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let other = genesis_for_store(&signing_key, "store_otherstore1")?;
        let other_id = other.id()?;
        let bytes = serialize_event_storage_yaml(&other)?;

        assert_eq!(
            remote_event_store_id(&other_id, &bytes)?.as_str(),
            "store_otherstore1"
        );
        assert!(!remote_event_belongs_to_store(&other_id, &bytes, STORE)?);
        assert!(remote_event_belongs_to_store(
            &other_id,
            &bytes,
            "store_otherstore1"
        )?);
        Ok(())
    }

    #[test]
    fn remote_event_store_filter_rejects_id_mismatch() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let bytes = serialize_event_storage_yaml(&genesis)?;
        let wrong_id = EventId::parse("sha256u:3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d0")?;

        let err = remote_event_belongs_to_store(&wrong_id, &bytes, STORE)
            .expect_err("store test should reject invalid input");
        assert!(matches!(
            err,
            crate::EventError::RemoteEventIdMismatch { .. }
        ));
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_allows_empty_provider() -> EventResult<()> {
        assert_eq!(
            classify_remote_event_log(&[], Some(STORE))?,
            RemoteEventLogClassification::Empty
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_allows_same_store() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let remote = vec![remote_record(&genesis)?];

        assert_eq!(
            classify_remote_event_log(&remote, Some(STORE))?,
            RemoteEventLogClassification::SameStore {
                store_id: STORE.to_owned()
            }
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_adopts_single_store_when_local_empty() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let remote = vec![remote_record(&genesis_for_store(
            &signing_key,
            "store_otherstore1",
        )?)?];

        assert_eq!(
            classify_remote_event_log(&remote, None)?,
            RemoteEventLogClassification::SameStore {
                store_id: "store_otherstore1".to_owned()
            }
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_blocks_different_store() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let remote = vec![remote_record(&genesis_for_store(
            &signing_key,
            "store_otherstore1",
        )?)?];

        assert_eq!(
            classify_remote_event_log(&remote, Some(STORE))?,
            RemoteEventLogClassification::DifferentStore {
                local_store_id: STORE.to_owned(),
                remote_store_id: "store_otherstore1".to_owned()
            }
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_blocks_multiple_stores() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let local = remote_record(&genesis(&signing_key)?)?;
        let remote = remote_record(&genesis_for_store(&signing_key, "store_otherstore1")?)?;

        assert_eq!(
            classify_remote_event_log(&[local, remote], Some(STORE))?,
            RemoteEventLogClassification::MultipleStores {
                store_ids: vec!["store_otherstore1".to_owned(), STORE.to_owned()]
            }
        );
        Ok(())
    }

    #[test]
    fn classify_remote_event_log_fails_closed_on_unreadable_event() -> EventResult<()> {
        let event_id = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let err = classify_remote_event_log(&[(event_id, b"not event yaml".to_vec())], Some(STORE))
            .expect_err("store test should reject invalid input");
        assert!(matches!(err, crate::EventError::ParseRemoteEvent(_)));
        Ok(())
    }

    #[test]
    fn union_rejects_current_schema_event_with_bad_signature() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let mut genesis = genesis(&signing_key)?;
        let event_id = genesis.id()?;
        genesis.signature = Ed25519Signature::from_trusted(format!("ed25519:{}", "00".repeat(64)));
        let bytes = serialize_event_storage_yaml(&genesis)?;

        let mut local = LocalEventStore::new();
        let err = union_remote_events(&mut local, &[(event_id.clone(), bytes)], STORE)
            .expect_err("store test should reject invalid input");
        assert!(matches!(
            err,
            crate::EventError::SignatureVerificationFailed
        ));
        assert!(local.get_bytes(&event_id).is_none());
        Ok(())
    }

    #[test]
    fn union_skips_unapproved_actor_event() -> EventResult<()> {
        let root_key = SigningKey::generate(&mut OsRng);
        let stranger_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&root_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serialize_event_storage_yaml(&genesis)?;
        let child = signed_child(&stranger_key, genesis_id.clone(), "secret_remoteuna1")?;
        let child_id = child.id()?;
        let child_bytes = serialize_event_storage_yaml(&child)?;

        let mut local = LocalEventStore::new();
        union_remote_events(&mut local, &[(genesis_id, genesis_bytes)], STORE)?;
        let imported = union_remote_events(&mut local, &[(child_id.clone(), child_bytes)], STORE)?;
        assert!(imported.is_empty());
        assert!(local.load_graph(STORE)?.quarantined().is_empty());
        assert!(local.get_bytes(&child_id).is_none());
        Ok(())
    }

    #[test]
    fn union_stages_batch_and_quarantines_unauthorized_child() -> EventResult<()> {
        let root_key = SigningKey::generate(&mut OsRng);
        let stranger_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&root_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serialize_event_storage_yaml(&genesis)?;
        let child = signed_child(&stranger_key, genesis_id.clone(), "secret_batchbad1")?;
        let child_id = child.id()?;
        let child_bytes = serialize_event_storage_yaml(&child)?;

        let mut local = LocalEventStore::new();
        let imported = union_remote_events(
            &mut local,
            &[
                (genesis_id.clone(), genesis_bytes),
                (child_id.clone(), child_bytes),
            ],
            STORE,
        )?;

        assert_eq!(imported, vec![genesis_id.clone()]);
        assert!(local.get_bytes(&genesis_id).is_some());
        assert!(local.get_bytes(&child_id).is_none());
        assert!(local.load_graph(STORE)?.quarantined().is_empty());
        Ok(())
    }

    #[test]
    fn union_removes_pending_event_that_becomes_unauthorized() -> EventResult<()> {
        let root_key = SigningKey::generate(&mut OsRng);
        let stranger_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&root_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serialize_event_storage_yaml(&genesis)?;
        let child = signed_child(&stranger_key, genesis_id.clone(), "secret_pendingbad1")?;
        let child_id = child.id()?;
        let child_bytes = serialize_event_storage_yaml(&child)?;

        let mut local = LocalEventStore::new();
        let imported = union_remote_events(&mut local, &[(child_id.clone(), child_bytes)], STORE)?;
        assert_eq!(imported, vec![child_id.clone()]);
        assert!(local.get_bytes(&child_id).is_some());

        union_remote_events(&mut local, &[(genesis_id.clone(), genesis_bytes)], STORE)?;
        assert!(local.get_bytes(&genesis_id).is_some());
        assert!(local.get_bytes(&child_id).is_none());
        assert!(local.load_graph(STORE)?.quarantined().is_empty());
        Ok(())
    }

    #[test]
    fn union_graph_failure_preserves_existing_events_and_outbox() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let remote = genesis(&signing_key)?;
        let remote_id = remote.id()?;
        let remote_bytes = serialize_event_storage_yaml(&remote)?;
        let existing_id = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        let existing_bytes = b"not event yaml".to_vec();

        let mut local = LocalEventStore::new();
        local.put_event(existing_id.clone(), existing_bytes.clone());
        local.queue_outbox("drive", existing_id.clone(), existing_bytes.clone());
        let before_event_ids = local.event_ids();
        let before_outbox = local.pending_outbox("drive");

        let err = union_remote_events(&mut local, &[(remote_id.clone(), remote_bytes)], STORE)
            .expect_err("invalid existing graph should reject the staged union");

        assert!(matches!(err, EventError::ParseStoredEvent(_)));
        assert_eq!(local.event_ids(), before_event_ids);
        assert_eq!(
            local.get_bytes(&existing_id),
            Some(existing_bytes.as_slice())
        );
        assert_eq!(local.pending_outbox("drive"), before_outbox);
        assert!(local.get_bytes(&remote_id).is_none());
        Ok(())
    }

    #[test]
    fn union_preserves_existing_outbox_entries() -> EventResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serialize_event_storage_yaml(&genesis)?;
        let child = signed_child(&signing_key, genesis_id.clone(), "secret_remoteout1")?;
        let child_id = child.id()?;
        let child_bytes = serialize_event_storage_yaml(&child)?;

        let mut local = LocalEventStore::new();
        local.put_event(genesis_id.clone(), genesis_bytes.clone());
        local.queue_outbox("drive", genesis_id.clone(), genesis_bytes.clone());

        assert_eq!(
            union_remote_events(&mut local, &[(child_id.clone(), child_bytes)], STORE)?,
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
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serialize_event_storage_yaml(&genesis)?;

        let mut device_a = LocalEventStore::new();
        device_a.put_event(genesis_id.clone(), genesis_bytes.clone());

        let mut device_b = LocalEventStore::new();
        device_b.put_event(genesis_id.clone(), genesis_bytes.clone());

        union_remote_events(
            &mut device_a,
            &device_b
                .event_ids()
                .iter()
                .filter_map(|id| device_b.get_bytes(id).map(|b| (id.clone(), b.to_vec())))
                .collect::<Vec<_>>(),
            STORE,
        )?;
        union_remote_events(
            &mut device_b,
            &device_a
                .event_ids()
                .iter()
                .filter_map(|id| device_a.get_bytes(id).map(|b| (id.clone(), b.to_vec())))
                .collect::<Vec<_>>(),
            STORE,
        )?;

        assert_eq!(device_a.event_ids(), device_b.event_ids());
        Ok(())
    }
}
