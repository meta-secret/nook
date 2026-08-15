//! Causal event DAG: parent validation, ancestry, heads, and pending events.

mod authorization;
use crate::canonical::EventId;
use crate::event::VaultEvent;
use crate::{EventError, EventResult};
use nook_replication::{CausalGraph, CausalGraphError, CausalInsertStatus};
use std::collections::BTreeMap;

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
    causal: CausalGraph<EventId>,
}

impl EventGraph {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.causal.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.causal.is_empty()
    }

    #[must_use]
    pub fn contains(&self, id: &EventId) -> bool {
        self.causal.contains(id)
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
        self.causal.quarantined()
    }

    /// Insert an event after envelope and current-schema signature validation.
    pub fn insert(
        &mut self,
        event: VaultEvent,
        expected_store_id: &str,
    ) -> EventResult<EventInsertStatus> {
        let event_id = event.validate_envelope(&crate::StoreId::parse(expected_store_id)?)?;
        if let Some(existing) = self.events.get(&event_id) {
            if existing.body.to_canonical_bytes()? == event.body.to_canonical_bytes()? {
                return Ok(EventInsertStatus::Duplicate);
            }
            self.causal.quarantine(
                event_id.clone(),
                "Same event id with different canonical bytes".to_owned(),
            );
            return Ok(EventInsertStatus::Quarantined(
                "hash mismatch at event path".to_owned(),
            ));
        }

        let parents = event.body.parents.clone();
        self.events.insert(event_id.clone(), event);
        let causal_status = self.causal.insert(event_id.clone(), parents);
        self.quarantine_rejected_applicable_events()?;
        if let Some(reason) = self.causal.quarantined().get(&event_id) {
            return Ok(EventInsertStatus::Quarantined(reason.clone()));
        }
        match causal_status {
            CausalInsertStatus::Applied => Ok(EventInsertStatus::Applied),
            CausalInsertStatus::Pending { missing_parents } => Ok(EventInsertStatus::Pending(
                EventPendingReason::MissingParents(missing_parents),
            )),
            CausalInsertStatus::Quarantined { reason } => {
                Ok(EventInsertStatus::Quarantined(reason))
            }
            CausalInsertStatus::Duplicate => Ok(EventInsertStatus::Duplicate),
            CausalInsertStatus::Conflict => Ok(EventInsertStatus::Quarantined(
                "Conflicting causal parent sets for the same event id".to_owned(),
            )),
        }
    }

    /// Events whose parents are all present (ready for projection).
    #[must_use]
    pub fn applicable_events(&self) -> Vec<&VaultEvent> {
        self.causal
            .applicable_ids()
            .into_iter()
            .filter_map(|id| self.events.get(id))
            .collect()
    }

    #[must_use]
    pub fn pending_events(&self) -> Vec<(&EventId, &VaultEvent)> {
        self.causal
            .pending_ids()
            .into_iter()
            .filter_map(|id| self.events.get_key_value(id))
            .collect()
    }

    /// Maximal events — no other event lists them as a parent.
    #[must_use]
    pub fn heads(&self) -> Vec<EventId> {
        self.causal.heads()
    }

    #[must_use]
    pub fn is_ancestor(&self, ancestor: &EventId, descendant: &EventId) -> bool {
        self.causal.is_ancestor(ancestor, descendant)
    }

    #[must_use]
    pub fn are_concurrent(&self, left: &EventId, right: &EventId) -> bool {
        self.causal.are_concurrent(left, right)
    }

    /// Deterministic topological order — ties broken by event id lexicographic order.
    pub fn topological_order(&self) -> EventResult<Vec<EventId>> {
        self.validate_authorizations()?;
        self.causal
            .topological_order()
            .map_err(|error| match error {
                CausalGraphError::Cycle => EventError::GraphCycle,
                CausalGraphError::TopologicalSortStalled => EventError::TopologicalSortStalled,
            })
    }

    /// Validate all applicable events against actors authorized in their causal
    /// past. Pending events wait until all parents are present.
    pub fn validate_authorizations(&self) -> EventResult<()> {
        let applicable = self.applicable_events();
        if applicable
            .iter()
            .filter(|event| event.body.parents.is_empty())
            .count()
            > 1
        {
            return Err(EventError::MultipleGenesisRoots);
        }
        for event in applicable {
            self.validate_epoch_checkpoint_structure(event)?;
            self.validate_event_actor_authorized(event)?;
        }
        Ok(())
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
        merged.causal = merged.causal.union(&other.causal);
        merged
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EventResult;
    use crate::event::{
        GenesisImportPayload, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation,
        build_genesis_import_event,
    };
    use crate::test_support::{actor, epoch, public_key, signing_key, store};
    use ed25519_dalek::SigningKey;
    use nook_auth2::{IsoTimestamp, OpaqueCiphertext, SecretId, Sha256Hex};

    const STORE_STR: &str = "store_testtoken11";

    fn genesis_source_hash() -> Sha256Hex {
        Sha256Hex::from_trusted("deadbeef".repeat(8))
    }

    fn signed_child(
        parents: Vec<EventId>,
        secret_id: &str,
        signing_key: &SigningKey,
    ) -> EventResult<VaultEvent> {
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store()?,
            actor_id: actor(signing_key)?,
            actor_signing_public_key: public_key(signing_key),
            parents,
            created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            key_epoch: epoch()?,
            operations: vec![VaultOperation::SecretCreated {
                secret: crate::event::EncryptedSecretPayload {
                    id: SecretId::from_vault_record(secret_id),
                    secret_type: crate::SecretType::ApiKey,
                    ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{secret_id}")),
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

    fn signed_operation(
        parents: Vec<EventId>,
        key_epoch: EventId,
        operation: VaultOperation,
        signing_key: &SigningKey,
    ) -> EventResult<VaultEvent> {
        VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store()?,
                actor_id: actor(signing_key)?,
                actor_signing_public_key: public_key(signing_key),
                parents,
                created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                key_epoch,
                operations: vec![operation],
            },
            signing_key,
        )
    }

    fn genesis_event(signing_key: &SigningKey) -> EventResult<VaultEvent> {
        build_genesis_import_event(
            &store()?,
            &actor(signing_key)?,
            &epoch()?,
            GenesisImportPayload {
                source_content_hash: genesis_source_hash(),
                secrets: vec![],
                password_entries: vec![],
            },
            &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            signing_key,
        )
    }

    #[test]
    fn union_is_commutative_on_ids() -> anyhow::Result<()> {
        let key = signing_key();
        let genesis = genesis_event(&key)?;
        let child = signed_child(vec![genesis.id()?], "secret_child00001", &key)?;

        let mut left = EventGraph::new();
        left.insert(genesis.clone(), STORE_STR)?;
        let mut right = EventGraph::new();
        right.insert(child.clone(), STORE_STR)?;
        right.insert(genesis.clone(), STORE_STR)?;

        let mut only_left = EventGraph::new();
        only_left.insert(genesis, STORE_STR)?;
        only_left.insert(child, STORE_STR)?;

        assert_eq!(left.union(&right).len(), only_left.len());
        assert_eq!(right.union(&only_left).len(), only_left.len());
        Ok(())
    }

    #[test]
    fn concurrent_events_are_detected() -> anyhow::Result<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key)?, store_str)?;
        let head = graph.heads()[0].clone();
        let a = signed_child(vec![head.clone()], "secret_concurrenta", &key)?;
        let b = signed_child(vec![head], "secret_concurrentb", &key)?;
        let a_id = a.id()?;
        let b_id = b.id()?;
        graph.insert(a, store_str)?;
        graph.insert(b, store_str)?;
        assert!(graph.are_concurrent(&a_id, &b_id));
        assert_eq!(graph.heads().len(), 2);
        Ok(())
    }

    #[test]
    fn pending_events_until_parent_arrives() -> EventResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let genesis = genesis_event(&key)?;
        let genesis_id = genesis.id()?;

        let child = signed_child(vec![genesis_id.clone()], "secret_pending001", &key)?;

        let mut graph = EventGraph::new();
        let status = graph.insert(child, store_str)?;
        assert!(matches!(status, EventInsertStatus::Pending(_)));
        assert_eq!(graph.pending_events().len(), 1);

        graph.insert(genesis, store_str)?;
        assert!(graph.pending_events().is_empty());
        Ok(())
    }

    #[test]
    fn duplicate_insert_returns_duplicate_status() -> EventResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key)?, store_str)?;
        let head = graph.heads()[0].clone();
        let child = signed_child(vec![head], "secret_duplicate01", &key)?;
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
    fn is_ancestor_is_transitive() -> EventResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key)?, store_str)?;
        let head = graph.heads()[0].clone();
        let child = signed_child(vec![head.clone()], "secret_child00001", &key)?;
        let child_id = child.id()?;
        graph.insert(child, store_str)?;

        let grandchild = signed_child(vec![child_id.clone()], "secret_grandchild1", &key)?;
        let grandchild_id = grandchild.id()?;
        graph.insert(grandchild, store_str)?;

        assert!(graph.is_ancestor(&head, &grandchild_id));
        assert!(!graph.is_ancestor(&grandchild_id, &head));
        Ok(())
    }

    #[test]
    fn join_event_collapses_multiple_heads() -> EventResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key)?, store_str)?;
        let head = graph.heads()[0].clone();
        let a = signed_child(vec![head.clone()], "secret_concurrenta", &key)?;
        let b = signed_child(vec![head], "secret_concurrentb", &key)?;
        let a_id = a.id()?;
        let b_id = b.id()?;
        graph.insert(a, store_str)?;
        graph.insert(b, store_str)?;
        assert_eq!(graph.heads().len(), 2);

        let join = signed_child(vec![a_id, b_id], "secret_joinmerge1", &key)?;
        graph.insert(join, store_str)?;
        assert_eq!(graph.heads().len(), 1);
        Ok(())
    }

    #[test]
    fn topological_order_is_deterministic_under_concurrency() -> EventResult<()> {
        let key = signing_key();
        let store_str = STORE_STR;

        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&key)?, store_str)?;
        let head = graph.heads()[0].clone();
        graph.insert(
            signed_child(vec![head.clone()], "secret_concurrenta", &key)?,
            store_str,
        )?;
        graph.insert(
            signed_child(vec![head], "secret_concurrentb", &key)?,
            store_str,
        )?;

        let first = graph.topological_order()?;
        let second = graph.topological_order()?;
        assert_eq!(first, second);
        Ok(())
    }

    #[test]
    fn multiple_independent_genesis_roots_fail_closed() -> EventResult<()> {
        let first_key = signing_key();
        let second_key = signing_key();
        let mut graph = EventGraph::new();
        graph.insert(genesis_event(&first_key)?, STORE_STR)?;
        graph.insert(genesis_event(&second_key)?, STORE_STR)?;

        assert!(matches!(
            graph.topological_order(),
            Err(EventError::MultipleGenesisRoots)
        ));
        Ok(())
    }

    #[test]
    fn standalone_current_checkpoint_is_quarantined() -> EventResult<()> {
        let key = signing_key();
        let genesis = genesis_event(&key)?;
        let genesis_id = genesis.id()?;
        let checkpoint = signed_operation(
            vec![genesis_id.clone()],
            genesis_id,
            VaultOperation::EpochCheckpoint {
                secrets: Vec::new(),
                members_checkpoint_hash: Sha256Hex::from_trusted("00".repeat(32)),
                rotated_meta_records: crate::EpochMetadataState::Replace(Vec::new()),
                password_entries: crate::EpochPasswordState::Replace(Vec::new()),
            },
            &key,
        )?;
        let mut graph = EventGraph::new();
        graph.insert(genesis, STORE_STR)?;

        assert!(matches!(
            graph.insert(checkpoint, STORE_STR)?,
            EventInsertStatus::Quarantined(reason)
                if reason.contains("parent must be one security rotation trigger")
        ));
        Ok(())
    }
}
