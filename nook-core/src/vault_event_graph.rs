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
        let event_id = event.validate_envelope(&crate::StoreId::parse(expected_store_id)?)?;
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
            .filter(|parent| !self.events.contains_key(parent))
            .cloned()
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
                event
                    .body
                    .parents
                    .iter()
                    .all(|parent| self.events.contains_key(parent))
            })
            .collect()
    }

    #[must_use]
    pub fn pending_events(&self) -> Vec<(&EventId, &VaultEvent)> {
        self.events
            .iter()
            .filter(|(id, event)| {
                !event.body.parents.is_empty()
                    && event
                        .body
                        .parents
                        .iter()
                        .any(|parent| !self.events.contains_key(parent))
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
                referenced.insert(parent.clone());
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
        event
            .body
            .parents
            .iter()
            .any(|parent| self.is_ancestor(ancestor, parent))
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
                    event
                        .body
                        .parents
                        .iter()
                        .all(|parent| ordered.contains(parent) || !remaining.contains(parent))
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
        VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation,
        build_genesis_import_event,
    };
    use crate::vault_ids::{AuthKeyId, SecretId, StoreId};
    use crate::vault_wire::{IsoTimestamp, OpaqueCiphertext, Sha256Hex};
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    fn signing_key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    const STORE_STR: &str = "store_testtoken11";

    fn store() -> StoreId {
        StoreId::parse("store_testtoken11").unwrap()
    }

    fn actor() -> AuthKeyId {
        AuthKeyId::parse("key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
            .unwrap()
    }

    fn epoch() -> EventId {
        EventId::parse("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .unwrap()
    }

    fn legacy_hash() -> Sha256Hex {
        Sha256Hex::from_trusted("deadbeef".repeat(8))
    }

    fn signed_child(
        parents: Vec<EventId>,
        secret_id: &str,
        signing_key: &SigningKey,
    ) -> VaultEvent {
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store(),
            actor_id: actor(),
            parents,
            created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            key_epoch: epoch(),
            operations: vec![VaultOperation::SecretCreated {
                secret: crate::vault_event::EncryptedSecretPayload {
                    id: SecretId::from_vault_record(secret_id),
                    secret_type: crate::SecretType::ApiKey,
                    ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{secret_id}")),
                },
            }],
        };
        VaultEvent::sign(body, signing_key).unwrap()
    }

    fn genesis_event(signing_key: &SigningKey) -> VaultEvent {
        build_genesis_import_event(
            &store(),
            &actor(),
            &epoch(),
            &legacy_hash(),
            vec![],
            &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            signing_key,
        )
        .unwrap()
    }

    #[test]
    fn union_is_commutative_on_ids() {
        let key = signing_key();
        let genesis = genesis_event(&key);
        let child = signed_child(vec![genesis.id().unwrap()], "secret_child00001", &key);

        let mut left = EventGraph::new();
        left.insert(genesis.clone(), STORE_STR).unwrap();
        let mut right = EventGraph::new();
        right.insert(child.clone(), STORE_STR).unwrap();
        right.insert(genesis.clone(), STORE_STR).unwrap();

        let mut only_left = EventGraph::new();
        only_left.insert(genesis, STORE_STR).unwrap();
        only_left.insert(child, STORE_STR).unwrap();

        assert_eq!(left.union(&right).len(), only_left.len());
        assert_eq!(right.union(&only_left).len(), only_left.len());
    }

    #[test]
    fn concurrent_events_are_detected() {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key), store_str).unwrap();
        let head = graph.heads()[0].clone();
        let a = signed_child(vec![head.clone()], "secret_concurrenta", &key);
        let b = signed_child(vec![head], "secret_concurrentb", &key);
        let a_id = a.id().unwrap();
        let b_id = b.id().unwrap();
        graph.insert(a, store_str).unwrap();
        graph.insert(b, store_str).unwrap();
        assert!(graph.are_concurrent(&a_id, &b_id));
        assert_eq!(graph.heads().len(), 2);
    }

    #[test]
    fn pending_events_until_parent_arrives() -> VaultResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let genesis = genesis_event(&key);
        let genesis_id = genesis.id()?;

        let child = signed_child(vec![genesis_id.clone()], "secret_pending001", &key);

        let mut graph = EventGraph::new();
        let status = graph.insert(child, store_str)?;
        assert!(matches!(status, EventInsertStatus::Pending(_)));
        assert_eq!(graph.pending_events().len(), 1);

        graph.insert(genesis, store_str)?;
        assert!(graph.pending_events().is_empty());
        Ok(())
    }

    #[test]
    fn duplicate_insert_returns_duplicate_status() -> VaultResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key), store_str)?;
        let head = graph.heads()[0].clone();
        let child = signed_child(vec![head], "secret_duplicate01", &key);
        assert_eq!(
            graph.insert(child.clone(), store_str)?,
            EventInsertStatus::Applied
        );
        assert_eq!(
            graph.insert(child, store_str)?,
            EventInsertStatus::Duplicate
        );
        Ok(())
    }

    #[test]
    fn is_ancestor_is_transitive() -> VaultResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key), store_str)?;
        let head = graph.heads()[0].clone();
        let child = signed_child(vec![head.clone()], "secret_child00001", &key);
        let child_id = child.id()?;
        graph.insert(child, store_str)?;

        let grandchild = signed_child(vec![child_id.clone()], "secret_grandchild1", &key);
        let grandchild_id = grandchild.id()?;
        graph.insert(grandchild, store_str)?;

        assert!(graph.is_ancestor(&head, &grandchild_id));
        assert!(!graph.is_ancestor(&grandchild_id, &head));
        Ok(())
    }

    #[test]
    fn join_event_collapses_multiple_heads() -> VaultResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key), store_str)?;
        let head = graph.heads()[0].clone();
        let a = signed_child(vec![head.clone()], "secret_concurrenta", &key);
        let b = signed_child(vec![head], "secret_concurrentb", &key);
        let a_id = a.id()?;
        let b_id = b.id()?;
        graph.insert(a, store_str)?;
        graph.insert(b, store_str)?;
        assert_eq!(graph.heads().len(), 2);

        let join = signed_child(vec![a_id, b_id], "secret_joinmerge1", &key);
        graph.insert(join, store_str)?;
        assert_eq!(graph.heads().len(), 1);
        Ok(())
    }

    #[test]
    fn topological_order_is_deterministic_under_concurrency() -> VaultResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key), store_str)?;
        let head = graph.heads()[0].clone();
        graph.insert(
            signed_child(vec![head.clone()], "secret_concurrenta", &key),
            store_str,
        )?;
        graph.insert(
            signed_child(vec![head], "secret_concurrentb", &key),
            store_str,
        )?;

        let first = graph.topological_order()?;
        let second = graph.topological_order()?;
        assert_eq!(first, second);
        Ok(())
    }
}
