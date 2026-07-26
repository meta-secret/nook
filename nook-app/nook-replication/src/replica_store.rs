//! Append-only replica bytes and durable per-provider outbox bookkeeping.

use std::collections::{BTreeMap, BTreeSet};

/// Result of inserting immutable bytes for an event identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplicaInsertStatus {
    Inserted,
    Duplicate,
    Conflict,
}

/// Provider event-set classification before a connect or sync path mutates
/// remote state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteEventLogClassification {
    Empty,
    SameStore {
        store_id: String,
    },
    DifferentStore {
        local_store_id: String,
        remote_store_id: String,
    },
    MultipleStores {
        store_ids: Vec<String>,
    },
}

/// Provider-neutral in-memory representation of immutable event bytes and
/// durable outbox entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicaStore<Id> {
    events: BTreeMap<Id, Vec<u8>>,
    outbox: BTreeMap<String, BTreeMap<Id, Vec<u8>>>,
}

impl<Id> Default for ReplicaStore<Id> {
    fn default() -> Self {
        Self {
            events: BTreeMap::new(),
            outbox: BTreeMap::new(),
        }
    }
}

impl<Id> ReplicaStore<Id>
where
    Id: Clone + Ord,
{
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put_event(&mut self, event_id: Id, storage_bytes: Vec<u8>) -> ReplicaInsertStatus {
        match self.events.get(&event_id) {
            Some(existing) if existing == &storage_bytes => ReplicaInsertStatus::Duplicate,
            Some(_) => ReplicaInsertStatus::Conflict,
            None => {
                self.events.insert(event_id, storage_bytes);
                ReplicaInsertStatus::Inserted
            }
        }
    }

    pub fn remove_event(&mut self, event_id: &Id) {
        self.events.remove(event_id);
    }

    #[must_use]
    pub fn contains_event(&self, event_id: &Id) -> bool {
        self.events.contains_key(event_id)
    }

    #[must_use]
    pub fn get_bytes(&self, event_id: &Id) -> Option<&[u8]> {
        self.events.get(event_id).map(Vec::as_slice)
    }

    #[must_use]
    pub fn event_ids(&self) -> Vec<Id> {
        self.events.keys().cloned().collect()
    }

    pub fn queue_outbox(&mut self, provider_id: &str, event_id: Id, bytes: Vec<u8>) {
        self.outbox
            .entry(provider_id.to_owned())
            .or_default()
            .insert(event_id, bytes);
    }

    pub fn dequeue_outbox(&mut self, provider_id: &str, event_id: &Id) -> Option<Vec<u8>> {
        self.outbox
            .get_mut(provider_id)
            .and_then(|entries| entries.remove(event_id))
    }

    #[must_use]
    pub fn pending_outbox(&self, provider_id: &str) -> Vec<(Id, Vec<u8>)> {
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

    /// Event identifiers available locally but absent from the observed remote
    /// event set.
    #[must_use]
    pub fn missing_event_ids(&self, remote_ids: &BTreeSet<Id>) -> Vec<Id> {
        self.events
            .keys()
            .filter(|event_id| !remote_ids.contains(*event_id))
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbox_is_idempotent_per_provider_and_event() {
        let mut store = ReplicaStore::new();
        store.queue_outbox("drive", 1_u8, vec![1]);
        store.queue_outbox("drive", 1_u8, vec![2]);
        store.queue_outbox("github", 1_u8, vec![3]);

        assert_eq!(store.pending_outbox("drive"), vec![(1, vec![2])]);
        assert_eq!(store.dequeue_outbox("drive", &1), Some(vec![2]));
        assert!(store.pending_outbox("drive").is_empty());
        assert_eq!(store.pending_outbox("github"), vec![(1, vec![3])]);
    }

    #[test]
    fn repair_plan_contains_only_events_missing_remotely() {
        let mut store = ReplicaStore::new();
        store.put_event(1_u8, vec![1]);
        store.put_event(2_u8, vec![2]);
        store.put_event(3_u8, vec![3]);

        assert_eq!(store.missing_event_ids(&BTreeSet::from([2_u8])), vec![1, 3]);
    }

    #[test]
    fn immutable_event_id_keeps_first_payload_and_reports_conflicts() {
        let mut store = ReplicaStore::new();
        assert_eq!(
            store.put_event(1_u8, vec![1]),
            ReplicaInsertStatus::Inserted
        );
        assert_eq!(
            store.put_event(1_u8, vec![1]),
            ReplicaInsertStatus::Duplicate
        );
        assert_eq!(
            store.put_event(1_u8, vec![2]),
            ReplicaInsertStatus::Conflict
        );
        assert_eq!(store.get_bytes(&1), Some([1_u8].as_slice()));
    }
}
