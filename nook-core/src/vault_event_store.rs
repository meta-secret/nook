//! In-memory event store and set-union synchronization helpers.

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::EventId;
use crate::vault_event::VaultEvent;
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

    pub fn put_event(&mut self, event_id: EventId, canonical_bytes: Vec<u8>) {
        self.events.insert(event_id, canonical_bytes);
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

    /// Build a causal graph from stored canonical bytes.
    pub fn load_graph(&self, store_id: &str) -> VaultResult<EventGraph> {
        let mut graph = EventGraph::new();
        for bytes in self.events.values() {
            let event: VaultEvent =
                serde_json::from_slice(bytes).map_err(EventError::ParseStoredEvent)?;
            let _ = graph.insert(event, store_id)?;
        }
        Ok(graph)
    }

    /// Insert a signed event into the local store.
    pub fn append_event(
        &mut self,
        event: &VaultEvent,
        store_id: &str,
    ) -> VaultResult<(EventId, EventInsertStatus)> {
        let event_id = event.validate_envelope(store_id)?;
        let bytes = serde_json::to_vec(event).map_err(EventError::EventSerialize)?;
        if self.events.contains_key(&event_id) {
            return Ok((event_id, EventInsertStatus::Duplicate));
        }
        self.put_event(event_id.clone(), bytes);
        let graph = self.load_graph(store_id)?;
        let status = if graph.pending_events().is_empty() {
            EventInsertStatus::Applied
        } else {
            EventInsertStatus::Pending(
                crate::vault_event_graph::EventPendingReason::MissingParents(vec![]),
            )
        };
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
        let event: VaultEvent =
            serde_json::from_slice(bytes).map_err(EventError::ParseRemoteEvent)?;
        if event.id()? != *event_id {
            return Err(EventError::RemoteEventIdMismatch {
                event_id: event_id.as_str().to_owned(),
            }
            .into());
        }
        local.put_event(event_id.clone(), bytes.clone());
        imported.push(event_id.clone());
    }
    let _ = local.load_graph(store_id)?;
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultResult;
    use crate::vault_event::build_genesis_import_event;
    use crate::vault_event_graph::EventInsertStatus;
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    #[test]
    fn union_imports_missing_events() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let store = "store_testtoken1";
        let actor = "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let epoch = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )?;
        let genesis = build_genesis_import_event(
            store,
            actor,
            &epoch,
            "hash",
            vec![],
            "2026-06-28T00:00:00Z",
            &signing_key,
        )?;
        let id = genesis.id()?;
        let bytes = serde_json::to_vec(&genesis).map_err(EventError::from)?;

        let mut local = LocalEventStore::new();
        union_remote_events(&mut local, &[(id.clone(), bytes)], store)?;
        assert!(local.get_bytes(&id).is_some());
        Ok(())
    }

    #[test]
    fn append_event_reports_applied_for_genesis() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let store = "store_testtoken1";
        let actor = "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let epoch = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )?;
        let genesis = build_genesis_import_event(
            store,
            actor,
            &epoch,
            "hash",
            vec![],
            "2026-06-28T00:00:00Z",
            &signing_key,
        )?;

        let mut local = LocalEventStore::new();
        let (id, status) = local.append_event(&genesis, store)?;
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
        let store = "store_testtoken1";
        let genesis = build_genesis_import_event(
            store,
            "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            &EventId::parse(
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )?,
            "hash",
            vec![],
            "2026-06-28T00:00:00Z",
            &signing_key,
        )?;
        let mut local = LocalEventStore::new();
        let (_, first) = local.append_event(&genesis, store)?;
        let (_, second) = local.append_event(&genesis, store)?;
        assert_eq!(first, EventInsertStatus::Applied);
        assert_eq!(second, EventInsertStatus::Duplicate);
        Ok(())
    }
}
