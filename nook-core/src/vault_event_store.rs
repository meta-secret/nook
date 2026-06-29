//! In-memory event store and set-union synchronization helpers.

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
    pub fn load_graph(&self, store_id: &str) -> Result<EventGraph, String> {
        let mut graph = EventGraph::new();
        for bytes in self.events.values() {
            let event: VaultEvent = serde_json::from_slice(bytes)
                .map_err(|error| format!("Failed to parse stored event: {error}"))?;
            let _ = graph.insert(event, store_id)?;
        }
        Ok(graph)
    }

    /// Insert a signed event into the local store.
    pub fn append_event(
        &mut self,
        event: &VaultEvent,
        store_id: &str,
    ) -> Result<(EventId, EventInsertStatus), String> {
        let event_id = event.validate_envelope(store_id)?;
        let bytes = serde_json::to_vec(&event)
            .map_err(|error| format!("Failed to serialize event: {error}"))?;
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
) -> Result<Vec<EventId>, String> {
    let mut imported = Vec::new();
    for (event_id, bytes) in remote_events {
        if local.get_bytes(event_id).is_some() {
            continue;
        }
        let event: VaultEvent = serde_json::from_slice(bytes)
            .map_err(|error| format!("Failed to parse remote event: {error}"))?;
        if event.id()? != *event_id {
            return Err(format!("Remote event id mismatch at {}", event_id.as_str()));
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
    use crate::vault_event::build_genesis_import_event;
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    #[test]
    fn union_imports_missing_events() {
        let signing_key = SigningKey::generate(&mut OsRng);
        let store = "store_testtoken1";
        let actor = "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let epoch = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )
        .unwrap();
        let genesis = build_genesis_import_event(
            store,
            actor,
            &epoch,
            "hash",
            vec![],
            "2026-06-28T00:00:00Z",
            &signing_key,
        )
        .unwrap();
        let id = genesis.id().unwrap();
        let bytes = serde_json::to_vec(&genesis).unwrap();

        let mut local = LocalEventStore::new();
        union_remote_events(&mut local, &[(id.clone(), bytes)], store).unwrap();
        assert!(local.get_bytes(&id).is_some());
    }
}
