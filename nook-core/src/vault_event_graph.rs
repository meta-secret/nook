//! Causal event DAG: parent validation, ancestry, heads, and pending events.

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::EventId;
use crate::vault_event::VaultEvent;
use std::collections::{BTreeMap, BTreeSet};

/// Why an event is not yet applicable to projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventPendingReason {
    MissingParents(Vec<EventId>),
}

/// Validation outcome when inserting into the graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventInsertStatus {
    Applied,
    Pending(EventPendingReason),
    Quarantined(String),
    Duplicate,
}

/// Immutable event set with causal metadata.
#[derive(Debug, Clone, Default)]
pub struct EventGraph {
    events: BTreeMap<EventId, VaultEvent>,
    quarantined: BTreeMap<EventId, String>,
}

impl EventGraph {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    #[must_use]
    pub fn contains(&self, id: &EventId) -> bool {
        self.events.contains_key(id)
    }

    #[must_use]
    pub fn get(&self, id: &EventId) -> Option<&VaultEvent> {
        self.events.get(id)
    }

    pub fn events(&self) -> impl Iterator<Item = (&EventId, &VaultEvent)> {
        self.events.iter()
    }

    #[must_use]
    pub fn quarantined(&self) -> &BTreeMap<EventId, String> {
        &self.quarantined
    }

    /// Insert an event after envelope validation. Signature verification is the caller's duty.
    pub fn insert(
        &mut self,
        event: VaultEvent,
        expected_store_id: &str,
    ) -> VaultResult<EventInsertStatus> {
        let event_id = event.validate_envelope(expected_store_id)?;
        if self.events.contains_key(&event_id) {
            let existing = self.events.get(&event_id).expect("present");
            if existing.body.to_canonical_bytes()? == event.body.to_canonical_bytes()? {
                return Ok(EventInsertStatus::Duplicate);
            }
            self.quarantined.insert(
                event_id.clone(),
                "Same event id with different canonical bytes".to_owned(),
            );
            return Ok(EventInsertStatus::Quarantined(
                "hash mismatch at event path".to_owned(),
            ));
        }

        let missing_parents = event
            .body
            .parents
            .iter()
            .map(|raw| EventId::parse(raw))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|parent| !self.events.contains_key(parent))
            .collect::<Vec<_>>();

        if !missing_parents.is_empty() {
            self.events.insert(event_id, event);
            return Ok(EventInsertStatus::Pending(
                EventPendingReason::MissingParents(missing_parents),
            ));
        }

        self.events.insert(event_id, event);
        Ok(EventInsertStatus::Applied)
    }

    /// Events whose parents are all present (ready for projection).
    #[must_use]
    pub fn applicable_events(&self) -> Vec<&VaultEvent> {
        self.events
            .values()
            .filter(|event| {
                event.body.parents.iter().all(|raw| {
                    EventId::parse(raw)
                        .ok()
                        .is_some_and(|parent| self.events.contains_key(&parent))
                })
            })
            .collect()
    }

    #[must_use]
    pub fn pending_events(&self) -> Vec<(&EventId, &VaultEvent)> {
        self.events
            .iter()
            .filter(|(id, event)| {
                !event.body.parents.is_empty()
                    && event.body.parents.iter().any(|raw| {
                        EventId::parse(raw)
                            .ok()
                            .is_some_and(|parent| !self.events.contains_key(&parent))
                    })
                    && !self.quarantined.contains_key(*id)
            })
            .collect()
    }

    /// Maximal events — no other event lists them as a parent.
    #[must_use]
    pub fn heads(&self) -> Vec<EventId> {
        let mut referenced = BTreeSet::new();
        for event in self.events.values() {
            for parent in &event.body.parents {
                if let Ok(id) = EventId::parse(parent) {
                    referenced.insert(id);
                }
            }
        }
        self.events
            .keys()
            .filter(|id| !referenced.contains(*id))
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn is_ancestor(&self, ancestor: &EventId, descendant: &EventId) -> bool {
        if ancestor == descendant {
            return true;
        }
        let Some(event) = self.events.get(descendant) else {
            return false;
        };
        event.body.parents.iter().any(|raw| {
            EventId::parse(raw)
                .ok()
                .is_some_and(|parent| self.is_ancestor(ancestor, &parent))
        })
    }

    #[must_use]
    pub fn are_concurrent(&self, left: &EventId, right: &EventId) -> bool {
        left != right
            && !self.is_ancestor(left, right)
            && !self.is_ancestor(right, left)
            && self.events.contains_key(left)
            && self.events.contains_key(right)
    }

    /// Deterministic topological order — ties broken by event id lexicographic order.
    pub fn topological_order(&self) -> VaultResult<Vec<EventId>> {
        let applicable: Vec<EventId> = self
            .applicable_events()
            .into_iter()
            .map(VaultEvent::id)
            .collect::<Result<Vec<_>, _>>()?;

        let mut ordered = Vec::with_capacity(applicable.len());
        let mut remaining: BTreeSet<EventId> = applicable.into_iter().collect();

        while !remaining.is_empty() {
            let mut progress = false;
            let ready: Vec<EventId> = remaining
                .iter()
                .filter(|id| {
                    let event = self.events.get(*id).expect("in remaining");
                    event.body.parents.iter().all(|raw| {
                        let parent = EventId::parse(raw).expect("validated on insert");
                        ordered.contains(&parent) || !remaining.contains(&parent)
                    })
                })
                .cloned()
                .collect();
            if ready.is_empty() {
                return Err(EventError::GraphCycle.into());
            }
            for id in ready {
                remaining.remove(&id);
                ordered.push(id);
                progress = true;
            }
            if !progress {
                return Err(EventError::TopologicalSortStalled.into());
            }
        }
        Ok(ordered)
    }

    /// Union of events from two graphs (commutative, associative, idempotent).
    #[must_use]
    pub fn union(&self, other: &Self) -> Self {
        let mut merged = self.clone();
        for (id, event) in &other.events {
            if merged.events.contains_key(id) {
                continue;
            }
            merged.events.insert(id.clone(), event.clone());
        }
        for (id, reason) in &other.quarantined {
            merged
                .quarantined
                .entry(id.clone())
                .or_insert_with(|| reason.clone());
        }
        merged
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultResult;
    use crate::vault_event::{
        VAULT_EVENT_SCHEMA_VERSION, VaultEvent, VaultEventBody, VaultOperation,
        build_genesis_import_event,
    };
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    fn signing_key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    fn signed_child(
        parents: Vec<&str>,
        secret_id: &str,
        signing_key: &SigningKey,
        store_id: &str,
        actor_id: &str,
        epoch: &str,
    ) -> VaultEvent {
        let body = VaultEventBody {
            schema_version: VAULT_EVENT_SCHEMA_VERSION,
            store_id: store_id.to_owned(),
            actor_id: actor_id.to_owned(),
            parents: parents.into_iter().map(str::to_owned).collect(),
            created_at: "2026-06-28T00:00:00Z".to_owned(),
            key_epoch: epoch.to_owned(),
            operations: vec![VaultOperation::SecretCreated {
                secret: crate::vault_event::EncryptedSecretPayload {
                    id: secret_id.to_owned(),
                    secret_type: crate::SecretType::ApiKey,
                    ciphertext: format!("cipher-{secret_id}"),
                },
            }],
        };
        VaultEvent::sign(body, signing_key).unwrap()
    }

    #[test]
    fn union_is_commutative_on_ids() {
        let key = signing_key();
        let epoch = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let genesis = build_genesis_import_event(
            "store_testtoken1",
            "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            &EventId::parse(epoch).unwrap(),
            "hash",
            vec![],
            "2026-06-28T00:00:00Z",
            &key,
        )
        .unwrap();
        let child = signed_child(
            vec![genesis.id().unwrap().as_str()],
            "secret_child00001",
            &key,
            "store_testtoken1",
            "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            epoch,
        );

        let mut left = EventGraph::new();
        left.insert(genesis.clone(), "store_testtoken1").unwrap();
        let mut right = EventGraph::new();
        right.insert(child.clone(), "store_testtoken1").unwrap();
        right.insert(genesis.clone(), "store_testtoken1").unwrap();

        let mut only_left = EventGraph::new();
        only_left.insert(genesis, "store_testtoken1").unwrap();
        only_left.insert(child, "store_testtoken1").unwrap();

        assert_eq!(left.union(&right).len(), only_left.len());
        assert_eq!(right.union(&only_left).len(), only_left.len());
    }

    #[test]
    fn concurrent_events_are_detected() {
        let key = signing_key();
        let store = "store_testtoken1";
        let actor = "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let epoch = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        let mut graph = EventGraph::new();
        graph
            .insert(
                build_genesis_import_event(
                    store,
                    actor,
                    &EventId::parse(epoch).unwrap(),
                    "hash",
                    vec![],
                    "2026-06-28T00:00:00Z",
                    &key,
                )
                .unwrap(),
                store,
            )
            .unwrap();
        let head = graph.heads()[0].as_str().to_owned();
        let a = signed_child(vec![&head], "secret_concurrenta", &key, store, actor, epoch);
        let b = signed_child(vec![&head], "secret_concurrentb", &key, store, actor, epoch);
        let a_id = a.id().unwrap();
        let b_id = b.id().unwrap();
        graph.insert(a, store).unwrap();
        graph.insert(b, store).unwrap();
        assert!(graph.are_concurrent(&a_id, &b_id));
        assert_eq!(graph.heads().len(), 2);
    }

    #[test]
    fn pending_events_until_parent_arrives() -> VaultResult<()> {
        let key = signing_key();
        let store = "store_testtoken1";
        let actor = "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let epoch = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        let genesis = build_genesis_import_event(
            store,
            actor,
            &EventId::parse(epoch)?,
            "hash",
            vec![],
            "2026-06-28T00:00:00Z",
            &key,
        )?;
        let genesis_id = genesis.id()?;

        let child = signed_child(
            vec![genesis_id.as_str()],
            "secret_pending001",
            &key,
            store,
            actor,
            epoch,
        );

        let mut graph = EventGraph::new();
        let status = graph.insert(child, store)?;
        assert!(matches!(status, EventInsertStatus::Pending(_)));
        assert_eq!(graph.pending_events().len(), 1);

        graph.insert(genesis, store)?;
        assert!(graph.pending_events().is_empty());
        Ok(())
    }

    #[test]
    fn duplicate_insert_returns_duplicate_status() -> VaultResult<()> {
        let key = signing_key();
        let store = "store_testtoken1";
        let actor = "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let epoch = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        let mut graph = EventGraph::new();
        graph.insert(
            build_genesis_import_event(
                store,
                actor,
                &EventId::parse(epoch)?,
                "hash",
                vec![],
                "2026-06-28T00:00:00Z",
                &key,
            )?,
            store,
        )?;
        let head = graph.heads()[0].as_str().to_owned();
        let child = signed_child(vec![&head], "secret_duplicate01", &key, store, actor, epoch);
        assert_eq!(
            graph.insert(child.clone(), store)?,
            EventInsertStatus::Applied
        );
        assert_eq!(graph.insert(child, store)?, EventInsertStatus::Duplicate);
        Ok(())
    }
}
