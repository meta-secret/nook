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

    pub fn queue_outbox(
        &mut self,
        provider_id: &str,
        event_id: Id,
        bytes: Vec<u8>,
    ) -> ReplicaInsertStatus {
        let entries = self.outbox.entry(provider_id.to_owned()).or_default();
        match entries.get(&event_id) {
            Some(existing) if existing == &bytes => ReplicaInsertStatus::Duplicate,
            Some(_) => ReplicaInsertStatus::Conflict,
            None => {
                entries.insert(event_id, bytes);
                ReplicaInsertStatus::Inserted
            }
        }
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

    /// Snapshot durable outbox entries so an application can carry them across
    /// a validated rebuild of its accepted event set.
    #[must_use]
    pub fn outbox_entries(&self) -> Vec<(String, Id, Vec<u8>)> {
        self.outbox
            .iter()
            .flat_map(|(provider_id, entries)| {
                entries
                    .iter()
                    .map(|(event_id, bytes)| (provider_id.clone(), event_id.clone(), bytes.clone()))
            })
            .collect()
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
    use proptest::prelude::*;

    #[test]
    fn outbox_is_idempotent_per_provider_and_event() {
        let mut store = ReplicaStore::new();
        assert_eq!(
            store.queue_outbox("drive", 1_u8, vec![1]),
            ReplicaInsertStatus::Inserted
        );
        assert_eq!(
            store.queue_outbox("drive", 1_u8, vec![1]),
            ReplicaInsertStatus::Duplicate
        );
        assert_eq!(
            store.queue_outbox("drive", 1_u8, vec![2]),
            ReplicaInsertStatus::Conflict
        );
        assert_eq!(
            store.queue_outbox("github", 1_u8, vec![3]),
            ReplicaInsertStatus::Inserted
        );

        assert_eq!(store.pending_outbox("drive"), vec![(1, vec![1])]);
        assert_eq!(store.dequeue_outbox("drive", &1), Some(vec![1]));
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

    proptest! {
        #[test]
        fn missing_event_ids_are_sorted_set_difference(
            local in proptest::collection::btree_set(any::<u8>(), 0..64),
            remote in proptest::collection::btree_set(any::<u8>(), 0..64),
        ) {
            let mut store = ReplicaStore::new();
            for event_id in &local {
                let _ = store.put_event(*event_id, vec![*event_id]);
            }

            let expected = local.difference(&remote).copied().collect::<Vec<_>>();
            prop_assert_eq!(store.missing_event_ids(&remote), expected);
        }
    }

    #[test]
    fn remote_classification_shape_is_stable() {
        insta::assert_debug_snapshot!(
            RemoteEventLogClassification::MultipleStores {
                store_ids: vec!["store-a".to_owned(), "store-b".to_owned()],
            },
            @r#"
        MultipleStores {
            store_ids: [
                "store-a",
                "store-b",
            ],
        }
        "#
        );
    }
}

#[cfg(all(test, loom))]
mod loom_tests {
    use loom::sync::{Arc, Mutex};
    use loom::thread;

    #[test]
    fn serialized_replica_inserts_preserve_immutable_first_writer() {
        loom::model(|| {
            let store = Arc::new(Mutex::new(super::ReplicaStore::new()));
            let first = Arc::clone(&store);
            let second = Arc::clone(&store);

            let first_writer = thread::spawn(move || {
                let mut guard = first.lock().expect("loom mutex must remain available");
                guard.put_event(1_u8, vec![1])
            });
            let second_writer = thread::spawn(move || {
                let mut guard = second.lock().expect("loom mutex must remain available");
                guard.put_event(1_u8, vec![2])
            });

            let first_status = first_writer.join().expect("loom writer must finish");
            let second_status = second_writer.join().expect("loom writer must finish");
            let guard = store.lock().expect("loom mutex must remain available");

            assert_ne!(first_status, second_status);
            assert!(
                matches!(
                    (first_status, second_status),
                    (
                        super::ReplicaInsertStatus::Inserted,
                        super::ReplicaInsertStatus::Conflict
                    ) | (
                        super::ReplicaInsertStatus::Conflict,
                        super::ReplicaInsertStatus::Inserted
                    )
                ),
                "one serialized writer inserts and the other observes a conflict"
            );
            assert!(matches!(guard.get_bytes(&1), Some([1]) | Some([2])));
        });
    }
}

#[cfg(kani)]
mod kani_proofs {
    #[kani::proof]
    fn duplicate_insert_never_replaces_immutable_bytes() {
        let same_payload = kani::any::<bool>();
        let mut store = super::ReplicaStore::new();

        assert_eq!(
            store.put_event(1_u8, vec![7]),
            super::ReplicaInsertStatus::Inserted
        );
        let second_payload = if same_payload { 7 } else { 9 };
        let expected_status = if same_payload {
            super::ReplicaInsertStatus::Duplicate
        } else {
            super::ReplicaInsertStatus::Conflict
        };
        assert_eq!(store.put_event(1_u8, vec![second_payload]), expected_status);
        assert_eq!(store.get_bytes(&1_u8), Some([7].as_slice()));
    }
}
