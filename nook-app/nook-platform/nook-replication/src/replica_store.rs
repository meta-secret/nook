//! Append-only replica bytes and durable per-provider outbox bookkeeping.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::{BTreeMap, BTreeSet, btree_map::Entry};

/// Byte storage membership retains a stored empty event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplicaEventBytes<'a> {
    UnknownEvent,
    Stored(
        #[cfg_attr(
            dylint_lib = "nook_domain_api",
            expect(
                raw_numeric_public_api,
                reason = "serialization boundary: borrowed immutable event storage bytes"
            )
        )]
        &'a [u8],
    ),
}

/// Result of inserting immutable bytes for an event identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplicaInsertStatus {
    Inserted,
    Duplicate,
    Conflict,
}

pub struct ReplicaEventWrite<Id> {
    pub event_id: Id,
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: opaque immutable event storage bytes"
        )
    )]
    pub bytes: Vec<u8>,
}
pub struct ReplicaOutboxWrite<'a, Id> {
    pub provider_id: &'a str,
    pub event: ReplicaEventWrite<Id>,
}
#[derive(Clone, Copy)]
pub struct ReplicaOutboxRemoval<'a, Id> {
    pub provider_id: &'a str,
    pub event_id: &'a Id,
}
#[derive(Debug)]
pub struct ReplicaWrite<Id> {
    pub store: ReplicaStore<Id>,
    pub status: ReplicaInsertStatus,
}
#[derive(Debug)]
pub struct ReplicaDequeue<Id> {
    pub store: ReplicaStore<Id>,
    pub removal: ReplicaOutboxRemovalResult,
}

/// Removing an outbox entry preserves empty stored payloads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplicaOutboxRemovalResult {
    NotQueued,
    Removed(
        #[cfg_attr(
            dylint_lib = "nook_domain_api",
            expect(
                raw_numeric_public_api,
                reason = "serialization boundary: removed opaque event storage bytes"
            )
        )]
        Vec<u8>,
    ),
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

    pub fn put_event(mut self, request: ReplicaEventWrite<Id>) -> ReplicaWrite<Id> {
        let ReplicaEventWrite {
            event_id,
            bytes: storage_bytes,
        } = request;
        let status = match self.events.entry(event_id) {
            Entry::Occupied(entry) if entry.get() == &storage_bytes => {
                ReplicaInsertStatus::Duplicate
            }
            Entry::Occupied(_) => ReplicaInsertStatus::Conflict,
            Entry::Vacant(entry) => {
                entry.insert(storage_bytes);
                ReplicaInsertStatus::Inserted
            }
        };
        ReplicaWrite {
            store: self,
            status,
        }
    }

    #[must_use]
    pub fn contains_event(&self, event_id: &Id) -> bool {
        self.events.contains_key(event_id)
    }

    #[must_use]
    pub fn get_bytes(&self, event_id: &Id) -> ReplicaEventBytes<'_> {
        match self.events.get(event_id) {
            Some(bytes) => ReplicaEventBytes::Stored(bytes),
            None => ReplicaEventBytes::UnknownEvent,
        }
    }

    #[must_use]
    pub fn event_ids(&self) -> Vec<Id> {
        self.events.keys().cloned().collect()
    }

    pub fn queue_outbox(mut self, request: ReplicaOutboxWrite<'_, Id>) -> ReplicaWrite<Id> {
        let ReplicaOutboxWrite {
            provider_id,
            event: ReplicaEventWrite { event_id, bytes },
        } = request;
        let entries = self.outbox.entry(provider_id.to_owned()).or_default();
        let status = match entries.entry(event_id) {
            Entry::Occupied(entry) if entry.get() == &bytes => ReplicaInsertStatus::Duplicate,
            Entry::Occupied(_) => ReplicaInsertStatus::Conflict,
            Entry::Vacant(entry) => {
                entry.insert(bytes);
                ReplicaInsertStatus::Inserted
            }
        };
        ReplicaWrite {
            store: self,
            status,
        }
    }

    #[must_use]
    pub fn dequeue_outbox(mut self, request: ReplicaOutboxRemoval<'_, Id>) -> ReplicaDequeue<Id> {
        let ReplicaOutboxRemoval {
            provider_id,
            event_id,
        } = request;
        let bytes = self
            .outbox
            .get_mut(provider_id)
            .and_then(|entries| entries.remove(event_id));
        let removal = match bytes {
            Some(bytes) => ReplicaOutboxRemovalResult::Removed(bytes),
            None => ReplicaOutboxRemovalResult::NotQueued,
        };
        ReplicaDequeue {
            store: self,
            removal,
        }
    }

    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: snapshots opaque immutable event storage bytes for one provider outbox"
        )
    )]
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: snapshots opaque immutable event storage bytes across provider outboxes"
        )
    )]
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

    /// Commit a validated exclusion set across events and their pending writes.
    #[must_use]
    pub fn excluding_events(mut self, excluded: &BTreeSet<Id>) -> Self {
        self.events.retain(|id, _| !excluded.contains(id));
        for entries in self.outbox.values_mut() {
            entries.retain(|id, _| !excluded.contains(id));
        }
        self
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
    use proptest::collection;
    use proptest::prelude::*;

    #[test]
    fn empty_payload_is_present_and_immutable_after_insertion() {
        let mut store = ReplicaStore::new();
        assert_eq!(
            {
                let outcome = store.put_event(ReplicaEventWrite {
                    event_id: 1_u8,
                    bytes: Vec::new(),
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Inserted
        );
        assert_eq!(
            {
                let outcome = store.put_event(ReplicaEventWrite {
                    event_id: 1_u8,
                    bytes: Vec::new(),
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Duplicate
        );
        assert_eq!(
            {
                let outcome = store.put_event(ReplicaEventWrite {
                    event_id: 1_u8,
                    bytes: vec![1],
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Conflict
        );
        assert_eq!(
            store.get_bytes(&1),
            ReplicaEventBytes::Stored([].as_slice())
        );
        assert_eq!(
            {
                let outcome = store.queue_outbox(ReplicaOutboxWrite {
                    provider_id: "drive",
                    event: ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: Vec::new(),
                    },
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Inserted
        );
        assert_eq!(
            {
                let outcome = store.queue_outbox(ReplicaOutboxWrite {
                    provider_id: "drive",
                    event: ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: Vec::new(),
                    },
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Duplicate
        );
        assert_eq!(
            {
                let outcome = store.queue_outbox(ReplicaOutboxWrite {
                    provider_id: "drive",
                    event: ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: vec![1],
                    },
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Conflict
        );
        assert_eq!(store.pending_outbox("drive"), vec![(1, Vec::new())]);
    }

    #[test]
    fn outbox_is_idempotent_per_provider_and_event() {
        let mut store = ReplicaStore::new();
        assert_eq!(
            {
                let outcome = store.queue_outbox(ReplicaOutboxWrite {
                    provider_id: "drive",
                    event: ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: vec![1],
                    },
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Inserted
        );
        assert_eq!(
            {
                let outcome = store.queue_outbox(ReplicaOutboxWrite {
                    provider_id: "drive",
                    event: ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: vec![1],
                    },
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Duplicate
        );
        assert_eq!(
            {
                let outcome = store.queue_outbox(ReplicaOutboxWrite {
                    provider_id: "drive",
                    event: ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: vec![2],
                    },
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Conflict
        );
        assert_eq!(
            {
                let outcome = store.queue_outbox(ReplicaOutboxWrite {
                    provider_id: "github",
                    event: ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: vec![3],
                    },
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Inserted
        );

        assert_eq!(store.pending_outbox("drive"), vec![(1, vec![1])]);
        assert_eq!(
            {
                let outcome = store.dequeue_outbox(ReplicaOutboxRemoval {
                    provider_id: "drive",
                    event_id: &1,
                });
                store = outcome.store;
                outcome.removal
            },
            ReplicaOutboxRemovalResult::Removed(vec![1])
        );
        assert!(store.pending_outbox("drive").is_empty());
        assert_eq!(store.pending_outbox("github"), vec![(1, vec![3])]);
    }

    #[test]
    fn repair_plan_contains_only_events_missing_remotely() {
        let mut store = ReplicaStore::new();
        {
            let outcome = store.put_event(ReplicaEventWrite {
                event_id: 1_u8,
                bytes: vec![1],
            });
            store = outcome.store;
            outcome.status
        };
        {
            let outcome = store.put_event(ReplicaEventWrite {
                event_id: 2_u8,
                bytes: vec![2],
            });
            store = outcome.store;
            outcome.status
        };
        {
            let outcome = store.put_event(ReplicaEventWrite {
                event_id: 3_u8,
                bytes: vec![3],
            });
            store = outcome.store;
            outcome.status
        };

        assert_eq!(store.missing_event_ids(&BTreeSet::from([2_u8])), vec![1, 3]);
    }

    #[test]
    fn immutable_event_id_keeps_first_payload_and_reports_conflicts() {
        let mut store = ReplicaStore::new();
        assert_eq!(
            {
                let outcome = store.put_event(ReplicaEventWrite {
                    event_id: 1_u8,
                    bytes: vec![1],
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Inserted
        );
        assert_eq!(
            {
                let outcome = store.put_event(ReplicaEventWrite {
                    event_id: 1_u8,
                    bytes: vec![1],
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Duplicate
        );
        assert_eq!(
            {
                let outcome = store.put_event(ReplicaEventWrite {
                    event_id: 1_u8,
                    bytes: vec![2],
                });
                store = outcome.store;
                outcome.status
            },
            ReplicaInsertStatus::Conflict
        );
        assert_eq!(
            store.get_bytes(&1),
            ReplicaEventBytes::Stored([1_u8].as_slice())
        );
    }

    proptest! {
        #[test]
        fn missing_event_ids_are_sorted_set_difference(
            local in collection::btree_set(any::<u8>(), 0..64),
            remote in collection::btree_set(any::<u8>(), 0..64),
        ) {
            let mut store = ReplicaStore::new();
            for event_id in &local {
                let _ = { let outcome = store.put_event(ReplicaEventWrite { event_id: *event_id, bytes: vec![*event_id] }); store = outcome.store; outcome.status };
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
    use std::panic;

    use super::{ReplicaEventBytes, ReplicaEventWrite, ReplicaInsertStatus, ReplicaStore};
    use loom::sync::{Arc, Mutex};
    use loom::thread;

    #[test]
    fn serialized_replica_inserts_preserve_immutable_first_writer() {
        loom::model(|| {
            let store = Arc::new(Mutex::new(ReplicaStore::new()));
            let first = Arc::clone(&store);
            let second = Arc::clone(&store);

            let first_writer = thread::spawn(move || {
                let mut guard = match first.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                {
                    let outcome = std::mem::take(&mut *guard).put_event(ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: vec![1],
                    });
                    *guard = outcome.store;
                    outcome.status
                }
            });
            let second_writer = thread::spawn(move || {
                let mut guard = match second.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                {
                    let outcome = std::mem::take(&mut *guard).put_event(ReplicaEventWrite {
                        event_id: 1_u8,
                        bytes: vec![2],
                    });
                    *guard = outcome.store;
                    outcome.status
                }
            });

            let first_status = match first_writer.join() {
                Ok(status) => status,
                Err(payload) => panic::resume_unwind(payload),
            };
            let second_status = match second_writer.join() {
                Ok(status) => status,
                Err(payload) => panic::resume_unwind(payload),
            };
            let guard = match store.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            assert_ne!(first_status, second_status);
            assert!(
                matches!(
                    (first_status, second_status),
                    (ReplicaInsertStatus::Inserted, ReplicaInsertStatus::Conflict)
                        | (ReplicaInsertStatus::Conflict, ReplicaInsertStatus::Inserted)
                ),
                "one serialized writer inserts and the other observes a conflict"
            );
            assert!(matches!(
                guard.get_bytes(&1),
                ReplicaEventBytes::Stored([1]) | ReplicaEventBytes::Stored([2])
            ));
        });
    }
}

#[cfg(kani)]
mod kani_proofs {
    use super::{ReplicaEventWrite, ReplicaInsertStatus, ReplicaStore};

    #[kani::proof]
    fn immutable_insert_status_covers_every_existing_state() {
        let has_existing = kani::any::<bool>();
        let same_payload = kani::any::<bool>();
        let existing = [7_u8];
        let incoming = [if same_payload { 7 } else { 9 }];
        let store = if has_existing {
            ReplicaStore::new()
                .put_event(ReplicaEventWrite {
                    event_id: 1_u8,
                    bytes: existing.to_vec(),
                })
                .store
        } else {
            ReplicaStore::new()
        };
        let expected_status = if !has_existing {
            ReplicaInsertStatus::Inserted
        } else if same_payload {
            ReplicaInsertStatus::Duplicate
        } else {
            ReplicaInsertStatus::Conflict
        };

        assert_eq!(
            store
                .put_event(ReplicaEventWrite {
                    event_id: 1_u8,
                    bytes: incoming.to_vec()
                })
                .status,
            expected_status
        );
    }
}
