//! Causal event DAG: parent validation, ancestry, heads, and pending events.

use crate::errors::{EventError, VaultError, VaultResult};
use crate::event_canonical::EventId;
use crate::vault_event::{VaultEvent, VaultOperation};
use crate::vault_ids::AuthKeyId;
use crate::vault_signing::SigningIdentity;
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

    /// Insert an event after envelope and current-schema signature validation.
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

        if !missing_parents.is_empty() || !self.event_ancestors_present(&event) {
            self.events.insert(event_id, event);
            self.quarantine_rejected_applicable_events()?;
            return Ok(EventInsertStatus::Pending(
                EventPendingReason::MissingParents(missing_parents),
            ));
        }

        self.events.insert(event_id.clone(), event);
        self.quarantine_rejected_applicable_events()?;
        if let Some(reason) = self.quarantined.get(&event_id) {
            return Ok(EventInsertStatus::Quarantined(reason.clone()));
        }
        Ok(EventInsertStatus::Applied)
    }

    /// Events whose parents are all present (ready for projection).
    #[must_use]
    pub fn applicable_events(&self) -> Vec<&VaultEvent> {
        self.events
            .iter()
            .filter(|(id, event)| {
                !self.quarantined.contains_key(*id) && self.event_ancestors_present(event)
            })
            .map(|(_, event)| event)
            .collect()
    }

    #[must_use]
    pub fn pending_events(&self) -> Vec<(&EventId, &VaultEvent)> {
        self.events
            .iter()
            .filter(|(id, event)| {
                !event.body.parents.is_empty()
                    && !self.event_ancestors_present(event)
                    && !self.quarantined.contains_key(*id)
            })
            .collect()
    }

    /// Maximal events — no other event lists them as a parent.
    #[must_use]
    pub fn heads(&self) -> Vec<EventId> {
        let mut referenced = BTreeSet::new();
        for (id, event) in &self.events {
            if self.quarantined.contains_key(id) {
                continue;
            }
            for parent in &event.body.parents {
                referenced.insert(parent.clone());
            }
        }
        self.events
            .keys()
            .filter(|id| !self.quarantined.contains_key(*id) && !referenced.contains(*id))
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
        self.validate_authorizations()?;
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

    /// Validate all applicable events against actors authorized in their causal
    /// past. Pending events wait until all parents are present.
    pub fn validate_authorizations(&self) -> VaultResult<()> {
        for event in self.applicable_events() {
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
        for (id, reason) in &other.quarantined {
            merged
                .quarantined
                .entry(id.clone())
                .or_insert_with(|| reason.clone());
        }
        merged
    }

    fn validate_event_actor_authorized(&self, event: &VaultEvent) -> VaultResult<()> {
        if event.body.parents.is_empty() {
            return Ok(());
        }
        if Self::is_self_signed_membership_event(event)? {
            return Ok(());
        }
        let authorized = self.authorized_actors_before(event)?;
        if authorized.contains(&event.body.actor_id) {
            return Ok(());
        }
        Err(EventError::UnauthorizedActor {
            actor_id: event.body.actor_id.as_str().to_owned(),
        }
        .into())
    }

    fn quarantine_rejected_applicable_events(&mut self) -> VaultResult<()> {
        loop {
            let mut changed = false;
            let ids = self.events.keys().cloned().collect::<Vec<_>>();
            for id in ids {
                if self.quarantined.contains_key(&id) {
                    continue;
                }
                let event = self.events.get(&id).expect("event id from map");
                if !self.event_ancestors_present(event) {
                    continue;
                }
                let reason = if event
                    .body
                    .parents
                    .iter()
                    .any(|parent| self.quarantined.contains_key(parent))
                {
                    Some("Ancestor event was rejected".to_owned())
                } else {
                    match self.validate_event_actor_authorized(event) {
                        Ok(()) => None,
                        Err(VaultError::Event(EventError::UnauthorizedActor { actor_id })) => Some(
                            format!("Event actor {actor_id} was not authorized in causal history"),
                        ),
                        Err(err) => return Err(err),
                    }
                };
                if let Some(reason) = reason {
                    self.quarantined.insert(id, reason);
                    changed = true;
                }
            }
            if !changed {
                return Ok(());
            }
        }
    }

    fn event_ancestors_present(&self, event: &VaultEvent) -> bool {
        let mut visited = BTreeSet::new();
        let mut stack = event.body.parents.clone();
        while let Some(id) = stack.pop() {
            if !visited.insert(id.clone()) {
                continue;
            }
            let Some(parent) = self.events.get(&id) else {
                return false;
            };
            stack.extend(parent.body.parents.iter().cloned());
        }
        true
    }

    /// Allow an unauthorized actor to publish its own membership event when the
    /// operation's signing key matches the event actor.
    ///
    /// Covers pending `JoinRequested` (approval flow) and password QR
    /// self-enrol (`JoinApproved` / `NexusParticipantEnrolled`). Password
    /// self-enrol is capability-gated by vault-key knowledge out of band; the
    /// graph only checks the self-signature binding.
    fn is_self_signed_membership_event(event: &VaultEvent) -> VaultResult<bool> {
        if event.body.operations.is_empty() {
            return Ok(false);
        }
        for operation in &event.body.operations {
            let (VaultOperation::JoinRequested {
                signing_public_key, ..
            }
            | VaultOperation::JoinApproved {
                signing_public_key, ..
            }
            | VaultOperation::NexusParticipantEnrolled {
                signing_public_key, ..
            }) = operation
            else {
                return Ok(false);
            };
            if signing_public_key.is_empty() {
                return Ok(false);
            }
            if let Some(body_public_key) = &event.body.actor_signing_public_key
                && body_public_key != signing_public_key
            {
                return Ok(false);
            }
            let request_actor =
                SigningIdentity::actor_id_for_public_key_hex(signing_public_key.as_str())?;
            if request_actor != event.body.actor_id {
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn authorized_actors_before(&self, event: &VaultEvent) -> VaultResult<BTreeSet<AuthKeyId>> {
        let mut authorized = BTreeSet::new();
        let mut visited = BTreeSet::new();
        let mut stack = event.body.parents.clone();

        while let Some(id) = stack.pop() {
            if !visited.insert(id.clone()) {
                continue;
            }
            let Some(parent_event) = self.events.get(&id) else {
                continue;
            };
            if parent_event.body.parents.is_empty()
                && parent_event
                    .body
                    .operations
                    .iter()
                    .any(|operation| matches!(operation, VaultOperation::VaultImported { .. }))
            {
                authorized.insert(parent_event.body.actor_id.clone());
            }
            for operation in &parent_event.body.operations {
                match operation {
                    VaultOperation::JoinApproved {
                        signing_public_key, ..
                    }
                    | VaultOperation::NexusParticipantEnrolled {
                        signing_public_key, ..
                    } if !signing_public_key.is_empty() => {
                        authorized.insert(SigningIdentity::actor_id_for_public_key_hex(
                            signing_public_key.as_str(),
                        )?);
                    }
                    _ => {}
                }
            }
            stack.extend(parent_event.body.parents.iter().cloned());
        }

        Ok(authorized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultResult;
    use crate::vault_event::{
        GenesisImportPayload, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation,
        build_genesis_import_event,
    };
    use crate::vault_ids::{AuthKeyId, DeviceId, SecretId, StoreId};
    use crate::vault_signing::SigningIdentity;
    use crate::vault_wire::{
        AgeArmoredCiphertext, DevicePublicKey, DeviceSigningPublicKey, IsoTimestamp, MemberLabel,
        OpaqueCiphertext, Sha256Hex,
    };
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    fn signing_key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    const STORE_STR: &str = "store_testtoken11";

    fn store() -> StoreId {
        StoreId::parse("store_testtoken11").unwrap()
    }

    fn actor(signing_key: &SigningKey) -> AuthKeyId {
        SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key()).unwrap()
    }

    fn public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
        DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().as_bytes()))
    }

    fn epoch() -> EventId {
        EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo").unwrap()
    }

    fn genesis_source_hash() -> Sha256Hex {
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
            actor_id: actor(signing_key),
            actor_signing_public_key: Some(public_key(signing_key)),
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
            &actor(signing_key),
            &epoch(),
            GenesisImportPayload {
                source_content_hash: genesis_source_hash(),
                secrets: vec![],
                password_entries: vec![],
            },
            &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            signing_key,
        )
        .unwrap()
    }

    fn signed_operation(
        parents: Vec<EventId>,
        operation: VaultOperation,
        signing_key: &SigningKey,
    ) -> VaultEvent {
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store(),
            actor_id: actor(signing_key),
            actor_signing_public_key: Some(public_key(signing_key)),
            parents,
            created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            key_epoch: epoch(),
            operations: vec![operation],
        };
        VaultEvent::sign(body, signing_key).unwrap()
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
    fn unauthorized_pending_event_is_quarantined_when_parent_arrives() -> VaultResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let genesis = genesis_event(&root_key);
        let genesis_id = genesis.id()?;

        let child = signed_child(
            vec![genesis_id.clone()],
            "secret_badpending1",
            &stranger_key,
        );
        let child_id = child.id()?;

        let mut graph = EventGraph::new();
        assert!(matches!(
            graph.insert(child, STORE_STR)?,
            EventInsertStatus::Pending(_)
        ));
        assert_eq!(graph.pending_events().len(), 1);

        assert_eq!(
            graph.insert(genesis, STORE_STR)?,
            EventInsertStatus::Applied
        );
        assert!(graph.pending_events().is_empty());
        assert!(graph.quarantined().contains_key(&child_id));
        assert_eq!(graph.topological_order()?, vec![genesis_id]);
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

    #[test]
    fn unapproved_actor_child_is_rejected() -> VaultResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key);
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

        let stranger_event = signed_child(vec![genesis_id], "secret_unauth0001", &stranger_key);
        let stranger_id = stranger_event.id()?;
        assert!(matches!(
            graph.insert(stranger_event, STORE_STR)?,
            EventInsertStatus::Quarantined(_)
        ));
        assert!(graph.quarantined().contains_key(&stranger_id));
        Ok(())
    }

    #[test]
    fn self_signed_join_request_is_allowed_before_approval() -> VaultResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key);
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

        let join = signed_operation(
            vec![genesis_id],
            VaultOperation::JoinRequested {
                device_id: DeviceId::parse("0123456789abcdef").unwrap(),
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("phone".to_owned()),
            },
            &joiner_key,
        );
        assert_eq!(graph.insert(join, STORE_STR)?, EventInsertStatus::Applied);
        Ok(())
    }

    #[test]
    fn self_signed_password_join_approval_is_allowed() -> VaultResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key);
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

        let enrol = signed_operation(
            vec![genesis_id],
            VaultOperation::JoinApproved {
                device_id: DeviceId::parse("0123456789abcdef").unwrap(),
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("phone".to_owned()),
                secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted("secret-key".to_owned()),
                members_key_ciphertext: AgeArmoredCiphertext::from_trusted(
                    "members-key".to_owned(),
                ),
            },
            &joiner_key,
        );
        let enrol_id = enrol.id()?;
        assert_eq!(graph.insert(enrol, STORE_STR)?, EventInsertStatus::Applied);

        let child = signed_child(vec![enrol_id], "secret_joiner0001", &joiner_key);
        assert_eq!(graph.insert(child, STORE_STR)?, EventInsertStatus::Applied);
        Ok(())
    }

    #[test]
    fn join_approval_authorizes_future_joiner_events() -> VaultResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key);
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

        let approval = signed_operation(
            vec![genesis_id],
            VaultOperation::JoinApproved {
                device_id: DeviceId::parse("0123456789abcdef").unwrap(),
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("phone".to_owned()),
                secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted("secret-key".to_owned()),
                members_key_ciphertext: AgeArmoredCiphertext::from_trusted(
                    "members-key".to_owned(),
                ),
            },
            &root_key,
        );
        let approval_id = approval.id()?;
        graph.insert(approval, STORE_STR)?;

        let child = signed_child(vec![approval_id], "secret_joiner0001", &joiner_key);
        assert_eq!(graph.insert(child, STORE_STR)?, EventInsertStatus::Applied);
        Ok(())
    }
}
