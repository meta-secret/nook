//! In-memory event store and set-union synchronization helpers.

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::EventId;
use crate::vault_event::{
    VaultEvent, parse_event_storage_bytes, parse_remote_event_storage_bytes,
    serialize_event_storage_yaml,
};
use crate::vault_event_graph::{EventGraph, EventInsertStatus};
use std::collections::BTreeMap;

/// Local event persistence surface (`IndexedDB` / provider adapters implement I/O).
#[derive(Debug, Clone, Default)]
pub struct LocalEventStore {
    events: BTreeMap<EventId, Vec<u8>>,
    outbox: BTreeMap<String, BTreeMap<EventId, Vec<u8>>>,
}

impl LocalEventStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put_event(&mut self, event_id: EventId, storage_bytes: Vec<u8>) {
        self.events.insert(event_id, storage_bytes);
    }

    #[must_use]
    pub fn get_bytes(&self, event_id: &EventId) -> Option<&[u8]> {
        self.events.get(event_id).map(Vec::as_slice)
    }

    #[must_use]
    pub fn event_ids(&self) -> Vec<EventId> {
        self.events.keys().cloned().collect()
    }

    pub fn queue_outbox(&mut self, provider_id: &str, event_id: EventId, bytes: Vec<u8>) {
        self.outbox
            .entry(provider_id.to_owned())
            .or_default()
            .insert(event_id, bytes);
    }

    pub fn dequeue_outbox(&mut self, provider_id: &str, event_id: &EventId) -> Option<Vec<u8>> {
        self.outbox
            .get_mut(provider_id)
            .and_then(|entries| entries.remove(event_id))
    }

    #[must_use]
    pub fn pending_outbox(&self, provider_id: &str) -> Vec<(EventId, Vec<u8>)> {
        self.outbox
            .get(provider_id)
            .map(|entries| {
                entries
                    .iter()
                    .map(|(id, bytes)| (id.clone(), bytes.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Build a causal graph from stored YAML or legacy JSON bytes.
    pub fn load_graph(&self, store_id: &str) -> VaultResult<EventGraph> {
        let mut graph = EventGraph::new();
        for bytes in self.events.values() {
            let event = parse_event_storage_bytes(bytes)?;
            let _ = graph.insert(event, store_id)?;
        }
        graph.validate_authorizations()?;
        Ok(graph)
    }

    /// Insert a signed event into the local store.
    pub fn append_event(
        &mut self,
        event: &VaultEvent,
        store_id: &str,
    ) -> VaultResult<(EventId, EventInsertStatus)> {
        let event_id = event.validate_envelope(&crate::StoreId::parse(store_id)?)?;
        let bytes = serialize_event_storage_yaml(event)?;
        if self.events.contains_key(&event_id) {
            return Ok((event_id, EventInsertStatus::Duplicate));
        }
        let mut graph = self.load_graph(store_id)?;
        let status = graph.insert(event.clone(), store_id)?;
        self.put_event(event_id.clone(), bytes);
        Ok((event_id, status))
    }
}

/// Merge remote event ids into the local store (commutative set union).
pub fn union_remote_events(
    local: &mut LocalEventStore,
    remote_events: &[(EventId, Vec<u8>)],
    store_id: &str,
) -> VaultResult<Vec<EventId>> {
    let mut imported = Vec::new();
    for (event_id, bytes) in remote_events {
        if local.get_bytes(event_id).is_some() {
            continue;
        }
        let event = parse_remote_event_storage_bytes(bytes)?;
        if event.id()? != *event_id {
            return Err(EventError::RemoteEventIdMismatch {
                event_id: event_id.as_str().to_owned(),
            }
            .into());
        }
        event.validate_envelope(&crate::StoreId::parse(store_id)?)?;
        let mut candidate = local.clone();
        candidate.put_event(event_id.clone(), bytes.clone());
        let _ = candidate.load_graph(store_id)?;
        local.put_event(event_id.clone(), bytes.clone());
        imported.push(event_id.clone());
    }
    let _ = local.load_graph(store_id)?;
    Ok(imported)
}

/// Set-union remote events and return updated causal head ids.
pub fn union_remote_events_and_heads(
    local: &mut LocalEventStore,
    remote_events: &[(EventId, Vec<u8>)],
    store_id: &str,
) -> VaultResult<Vec<String>> {
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
) -> VaultResult<bool> {
    let event = parse_remote_event_storage_bytes(bytes)?;
    if event.id()? != *event_id {
        return Err(EventError::RemoteEventIdMismatch {
            event_id: event_id.as_str().to_owned(),
        }
        .into());
    }
    event.validate_actor_signature()?;
    Ok(event.body.store_id.as_str() == store_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultResult;
    use crate::event_canonical::Ed25519Signature;
    use crate::secret_types::SecretType;
    use crate::vault_event::{
        EncryptedSecretPayload, VaultEvent, VaultEventBody, VaultEventSchemaVersion,
        VaultOperation, build_genesis_import_event,
    };
    use crate::vault_event_graph::EventInsertStatus;
    use crate::vault_ids::{SecretId, StoreId};
    use crate::vault_signing::SigningIdentity;
    use crate::vault_wire::{DeviceSigningPublicKey, IsoTimestamp, OpaqueCiphertext, Sha256Hex};
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    fn genesis(signing_key: &SigningKey) -> VaultResult<crate::vault_event::VaultEvent> {
        genesis_for_store(signing_key, "store_testtoken11")
    }

    fn genesis_for_store(
        signing_key: &SigningKey,
        store_id: &str,
    ) -> VaultResult<crate::vault_event::VaultEvent> {
        build_genesis_import_event(
            &StoreId::parse(store_id)?,
            &SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?,
            &EventId::parse(
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )?,
            &Sha256Hex::from_trusted("deadbeef".repeat(8)),
            vec![],
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
    ) -> VaultResult<VaultEvent> {
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse(STORE)?,
            actor_id: SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?,
            actor_signing_public_key: Some(public_key(signing_key)),
            parents: vec![parent],
            created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            key_epoch: EventId::parse(
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )?,
            operations: vec![VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload {
                    id: SecretId::from_vault_record(secret_id),
                    secret_type: SecretType::ApiKey,
                    ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
                },
            }],
        };
        VaultEvent::sign(body, signing_key)
    }

    #[test]
    fn union_imports_missing_events() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let id = genesis.id()?;
        let bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;

        let mut local = LocalEventStore::new();
        union_remote_events(&mut local, &[(id.clone(), bytes)], STORE)?;
        assert!(local.get_bytes(&id).is_some());
        Ok(())
    }

    #[test]
    fn append_event_reports_applied_for_genesis() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;

        let mut local = LocalEventStore::new();
        let (id, status) = local.append_event(&genesis, STORE)?;
        assert!(local.get_bytes(&id).is_some());
        assert_eq!(status, EventInsertStatus::Applied);
        Ok(())
    }

    #[test]
    fn outbox_queue_and_dequeue() -> VaultResult<()> {
        let mut local = LocalEventStore::new();
        let id = EventId::parse(
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        )?;
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
    fn append_event_duplicate_is_idempotent() -> VaultResult<()> {
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
    fn union_remote_events_and_heads_returns_causal_heads() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let id = genesis.id()?;
        let bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;

        let mut local = LocalEventStore::new();
        let heads = union_remote_events_and_heads(&mut local, &[(id.clone(), bytes)], STORE)?;
        assert_eq!(heads.len(), 1);
        assert_eq!(heads[0], id.as_str());
        Ok(())
    }

    #[test]
    fn union_commutative_on_event_sets() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;

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
    fn union_rejects_event_id_mismatch() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let real_id = genesis.id()?;
        let bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;
        let wrong_id = EventId::parse(
            "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        )?;

        let mut local = LocalEventStore::new();
        let err = union_remote_events(&mut local, &[(wrong_id, bytes)], STORE).unwrap_err();
        assert!(matches!(
            err,
            crate::VaultError::Event(crate::EventError::RemoteEventIdMismatch { .. })
        ));
        assert!(local.get_bytes(&real_id).is_none());
        Ok(())
    }

    #[test]
    fn remote_event_store_filter_skips_other_vaults() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let other = genesis_for_store(&signing_key, "store_otherstore1")?;
        let other_id = other.id()?;
        let bytes = serde_json::to_vec(&other).map_err(EventError::from)?;

        assert!(!remote_event_belongs_to_store(&other_id, &bytes, STORE)?);
        assert!(remote_event_belongs_to_store(
            &other_id,
            &bytes,
            "store_otherstore1"
        )?);
        Ok(())
    }

    #[test]
    fn remote_event_store_filter_rejects_id_mismatch() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;
        let wrong_id = EventId::parse(
            "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        )?;

        let err = remote_event_belongs_to_store(&wrong_id, &bytes, STORE).unwrap_err();
        assert!(matches!(
            err,
            crate::VaultError::Event(crate::EventError::RemoteEventIdMismatch { .. })
        ));
        Ok(())
    }

    #[test]
    fn union_rejects_current_schema_event_with_bad_signature() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let mut genesis = genesis(&signing_key)?;
        let event_id = genesis.id()?;
        genesis.signature = Ed25519Signature::from_trusted(format!("ed25519:{}", "00".repeat(64)));
        let bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;

        let mut local = LocalEventStore::new();
        let err = union_remote_events(&mut local, &[(event_id.clone(), bytes)], STORE).unwrap_err();
        assert!(matches!(
            err,
            crate::VaultError::Event(crate::EventError::SignatureVerificationFailed)
        ));
        assert!(local.get_bytes(&event_id).is_none());
        Ok(())
    }

    #[test]
    fn union_rejects_unapproved_actor_event() -> VaultResult<()> {
        let root_key = SigningKey::generate(&mut OsRng);
        let stranger_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&root_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;
        let child = signed_child(&stranger_key, genesis_id.clone(), "secret_remoteuna1")?;
        let child_id = child.id()?;
        let child_bytes = serde_json::to_vec(&child).map_err(EventError::from)?;

        let mut local = LocalEventStore::new();
        union_remote_events(&mut local, &[(genesis_id, genesis_bytes)], STORE)?;
        let err =
            union_remote_events(&mut local, &[(child_id.clone(), child_bytes)], STORE).unwrap_err();
        assert!(matches!(
            err,
            crate::VaultError::Event(crate::EventError::UnauthorizedActor { .. })
        ));
        assert!(local.get_bytes(&child_id).is_none());
        Ok(())
    }

    #[test]
    fn bidirectional_union_converges() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let genesis = genesis(&signing_key)?;
        let genesis_id = genesis.id()?;
        let genesis_bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;

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
