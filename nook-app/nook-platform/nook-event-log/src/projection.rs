//! Deterministic encrypted vault projection from the causal event log.

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

mod operation_application;
mod security_conflicts;

use crate::EventLookup;
use crate::canonical::EventId;
use crate::epoch::{EpochRecord, EpochRotationReason, EpochTransition, KeyEpoch};
use crate::graph::EventGraph;
use crate::{ConcurrentEpochRotations, VaultOperation};
use crate::{EventError, EventResult};
use crate::{PasswordUnlockEntry, SecretFingerprint};
use nook_auth2::StoredSecretRecord;
use nook_auth2::{SecretId, StoreId};
use std::collections::BTreeMap;

/// One live or tombstoned secret in the encrypted projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedSecret {
    pub record: StoredSecretRecord,
    pub identity_fingerprint: SecretFingerprint,
    pub fingerprint: SecretFingerprint,
    pub created_by: EventId,
    pub lifecycle: ProjectedSecretLifecycle,
    pub origin: ProjectedSecretOrigin,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectedSecretLifecycle {
    Live,
    Deleted { by: EventId },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectedSecretOrigin {
    Created,
    Replacement { from: SecretId },
}

impl ProjectedSecret {
    #[must_use]
    pub fn is_live(&self, graph: &EventGraph) -> bool {
        match &self.lifecycle {
            ProjectedSecretLifecycle::Live => true,
            ProjectedSecretLifecycle::Deleted { by } => !graph.is_ancestor(&self.created_by, by),
        }
    }
}

/// Concurrent replacement candidates for one old secret id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretReplacementConflict {
    pub old_secret_id: SecretId,
    /// event id → new secret id
    pub candidates: BTreeMap<EventId, SecretId>,
}

/// Concurrent security-sensitive epoch transitions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityConflict {
    pub events: Vec<EventId>,
    pub reasons: Vec<EpochRotationReason>,
}

/// Materialized encrypted vault state derived from events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultProjection {
    pub store_id: StoreId,
    pub epoch: ProjectionEpoch,
    pub epoch_history: Vec<EpochRecord>,
    pub secrets: BTreeMap<SecretId, ProjectedSecret>,
    pub password_entries: Vec<PasswordUnlockEntry>,
    pub replacement_conflicts: BTreeMap<SecretId, SecretReplacementConflict>,
    pub security_conflicts: Vec<SecurityConflict>,
    pub unresolved_schema: bool,
    pub cleared: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectionEpoch {
    BeforeGenesis,
    Current(KeyEpoch),
}

impl Default for VaultProjection {
    fn default() -> Self {
        Self {
            store_id: StoreId::before_genesis_placeholder(),
            epoch: ProjectionEpoch::BeforeGenesis,
            epoch_history: Vec::new(),
            secrets: BTreeMap::new(),
            password_entries: Vec::new(),
            replacement_conflicts: BTreeMap::new(),
            security_conflicts: Vec::new(),
            unresolved_schema: false,
            cleared: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionIntegrity {
    UnresolvedSchema,
    BlockingConflicts,
    Resolved,
}
impl VaultProjection {
    #[must_use]
    pub fn integrity(&self) -> ProjectionIntegrity {
        if self.unresolved_schema {
            ProjectionIntegrity::UnresolvedSchema
        } else if self.has_blocking_conflicts() {
            ProjectionIntegrity::BlockingConflicts
        } else {
            ProjectionIntegrity::Resolved
        }
    }
}

impl VaultProjection {
    #[must_use]
    pub fn live_secrets(&self, graph: &EventGraph) -> BTreeMap<String, StoredSecretRecord> {
        self.secrets
            .iter()
            .filter(|(_, secret)| secret.is_live(graph))
            .map(|(id, secret)| (id.as_str().to_owned(), secret.record.clone()))
            .collect()
    }

    #[must_use]
    pub fn has_blocking_conflicts(&self) -> bool {
        !self.replacement_conflicts.is_empty() || !self.security_conflicts.is_empty()
    }
}

impl VaultProjection {
    /// Rebuild projection from the event graph. Result is independent of provider order
    /// and of the topological tie-break used internally.
    pub fn from_graph(graph: &EventGraph, store_id: &str) -> EventResult<Self> {
        let expected_store = StoreId::parse(store_id)?;
        let order = graph.topological_order()?;
        let mut projection = Self {
            store_id: expected_store.clone(),
            ..Self::default()
        };

        let mut epoch_events: BTreeMap<EventId, EpochRotationReason> = BTreeMap::new();
        let mut security_events: BTreeMap<EventId, EpochRotationReason> = BTreeMap::new();
        let mut replacements_by_old: BTreeMap<SecretId, Vec<(EventId, SecretId)>> = BTreeMap::new();

        for event_id in order {
            let event = match graph.get(&event_id) {
                EventLookup::Recorded(event) => event,
                EventLookup::UnknownEvent => {
                    return Err(EventError::MissingEvent {
                        event_id: event_id.as_str().to_owned(),
                    });
                }
            };
            if event.body.store_id != expected_store {
                return Err(EventError::ProjectionStoreMismatch);
            }
            if !event.body.schema_version.is_supported() {
                projection.unresolved_schema = true;
                continue;
            }

            for operation in &event.body.operations {
                if let EpochTransition::Rotated(reason) =
                    VaultOperation::operation_starts_epoch(operation)
                {
                    epoch_events.insert(event_id.clone(), reason);
                    security_events.insert(event_id.clone(), reason);
                }
                if matches!(operation, crate::VaultOperation::JoinApproved { .. }) {
                    security_events
                        .entry(event_id.clone())
                        .or_insert(EpochRotationReason::AccessGrant);
                } else if !matches!(
                    operation,
                    crate::VaultOperation::EpochCheckpoint { .. }
                        | crate::VaultOperation::JoinRequested { .. }
                ) {
                    security_events
                        .entry(event_id.clone())
                        .or_insert(EpochRotationReason::ConcurrentVaultMutation);
                }
                projection.apply_operation(&event_id, operation, &mut replacements_by_old);
            }

            if let Ok(epoch_id) = EventId::parse(event.body.key_epoch.as_str()) {
                let epoch = KeyEpoch(epoch_id);
                if projection.epoch != ProjectionEpoch::Current(epoch.clone()) {
                    if let Some(reason) = epoch_events.get(&event_id).copied() {
                        projection.epoch_history.push(EpochRecord {
                            epoch: epoch.clone(),
                            started_by: event_id.clone(),
                            reason,
                        });
                    }
                    projection.epoch = ProjectionEpoch::Current(epoch);
                }
            }
        }

        projection.security_conflicts = Self::detect_security_conflicts(graph, &security_events);
        projection.replacement_conflicts =
            Self::detect_replacement_conflicts(graph, &replacements_by_old);
        Ok(projection)
    }

    fn detect_replacement_conflicts(
        graph: &EventGraph,
        replacements_by_old: &BTreeMap<SecretId, Vec<(EventId, SecretId)>>,
    ) -> BTreeMap<SecretId, SecretReplacementConflict> {
        let mut conflicts = BTreeMap::new();
        for (old_id, entries) in replacements_by_old {
            let unique_events: Vec<&EventId> =
                entries.iter().map(|(event_id, _)| event_id).collect();
            let has_concurrent = unique_events.iter().any(|left| {
                unique_events
                    .iter()
                    .any(|right| left != right && graph.are_concurrent(left, right))
            });
            if has_concurrent && entries.len() > 1 {
                conflicts.insert(
                    old_id.clone(),
                    SecretReplacementConflict {
                        old_secret_id: old_id.clone(),
                        candidates: entries
                            .iter()
                            .map(|(event_id, new_id)| (event_id.clone(), new_id.clone()))
                            .collect(),
                    },
                );
            }
        }
        conflicts
    }

    /// Verify projection invariance under event permutation (property-style check).
    pub fn assert_replay_invariant(graph: &EventGraph, store_id: &str) -> EventResult<()> {
        let baseline = Self::from_graph(graph, store_id)?;
        for _ in 0..3 {
            let again = Self::from_graph(graph, store_id)?;
            if again != baseline {
                return Err(EventError::ProjectionReplayMismatch);
            }
        }
        Ok(())
    }
}

/// The initial epoch has no rotation checkpoint; rotated epochs name their commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EpochCheckpoint {
    Unrotated,
    Committed(EventId),
}

impl EventGraph {
    /// Select the checkpoint that commits the projection's current rotated epoch.
    /// Concurrent access-neutral heads must not replace this causal checkpoint.
    pub fn current_epoch_checkpoint(&self) -> EventResult<EpochCheckpoint> {
        let mut checkpoints = Vec::new();
        for event_id in self.topological_order()? {
            let event = match self.get(&event_id) {
                EventLookup::Recorded(event) => event,
                EventLookup::UnknownEvent => {
                    return Err(EventError::MissingEvent {
                        event_id: event_id.as_str().to_owned(),
                    });
                }
            };
            if !event
                .body
                .operations
                .iter()
                .any(|operation| matches!(operation, crate::VaultOperation::EpochCheckpoint { .. }))
            {
                continue;
            }
            if event.body.parents.as_slice() != [event.body.key_epoch.clone()] {
                return Err(EventError::InvalidEpochCheckpointStructure {
                    reason: "checkpoint does not directly commit its key epoch",
                });
            }
            checkpoints.push(event_id);
        }
        let current = checkpoints
            .iter()
            .filter(|candidate| {
                !checkpoints
                    .iter()
                    .any(|other| *candidate != other && self.is_ancestor(candidate, other))
            })
            .cloned()
            .collect::<Vec<_>>();
        if current.len() > 1 {
            return Err(EventError::InvalidEpochCheckpointStructure {
                reason: "multiple concurrent epoch checkpoints remain",
            });
        }
        Ok(match current.into_iter().next() {
            Some(checkpoint) => EpochCheckpoint::Committed(checkpoint),
            None => EpochCheckpoint::Unrotated,
        })
    }
}

#[cfg(test)]
mod tests {
    pub(super) struct FixtureGraphEvent {
        pub(super) graph: EventGraph,
        pub(super) event_id: EventId,
    }

    use super::*;
    use crate::PasswordEnvelope;
    use crate::event::{
        EncryptedSecretPayload, GenesisImportPayload, VaultEvent, VaultEventBody,
        VaultEventSchemaVersion, VaultOperation,
    };
    use crate::test_support::{actor, epoch, public_key, signing_key as key, store};
    use crate::{EventResult, GenesisImportRequest, SecretFingerprint};
    use ed25519_dalek::SigningKey;
    use nook_auth2::SecretType;
    use nook_auth2::{
        IsoTimestamp, OpaqueCiphertext, PasswordEntryId, SecretId, Sha256Hex,
    };

    pub(super) const STORE: &str = "store_testtoken11";

    pub(super) struct ProjectionFixtures;

    impl ProjectionFixtures {
        pub(super) fn ts(value: &str) -> IsoTimestamp {
            IsoTimestamp::from_trusted(value.to_owned())
        }

        pub(super) fn sid(value: &str) -> SecretId {
            SecretId::from_vault_record(value)
        }

        pub(super) fn password_envelope(ciphertext: &str) -> PasswordEnvelope {
            PasswordEnvelope {
                version: crate::PasswordEnvelopeVersion::LEGACY,
                kdf: "scrypt".to_owned(),
                work_factor: 10.into(),
                recipient: String::new(),
                wrapped_keys: String::new(),
                ciphertext: ciphertext.to_owned(),
            }
        }

        pub(super) fn password_envelope_fixture(ciphertext: &str) -> PasswordEnvelope {
            Self::password_envelope(ciphertext)
        }

        pub(super) fn genesis_source_hash() -> Sha256Hex {
            Sha256Hex::from_trusted("deadbeef".repeat(8))
        }

        pub(super) fn signed_operation(
            signing_key: &SigningKey,
            parents: Vec<EventId>,
            operation: VaultOperation,
        ) -> EventResult<VaultEvent> {
            VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: store()?,
                    actor_id: actor(signing_key)?,
                    actor_signing_public_key: public_key(signing_key),
                    parents,
                    created_at: Self::ts("2026-06-28T00:00:00Z"),
                    key_epoch: epoch()?,
                    operations: vec![operation],
                },
                signing_key,
            )
        }

        pub(super) fn replacement_event(
            signing_key: &SigningKey,
            parent: &EventId,
            new_id: &str,
        ) -> EventResult<VaultEvent> {
            Self::signed_operation(
                signing_key,
                vec![parent.clone()],
                VaultOperation::SecretReplaced {
                    old_id: Self::sid("secret_original1"),
                    new_secret: EncryptedSecretPayload {
                        id: Self::sid(new_id),
                        secret_type: SecretType::ApiKey,
                        ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{new_id}")),
                        identity_fingerprint: SecretFingerprint::from_trusted(format!(
                            "test-identity:{new_id}"
                        )),
                        fingerprint: SecretFingerprint::from_trusted(format!(
                            "test-version:{new_id}"
                        )),
                    },
                },
            )
        }

        pub(super) fn genesis(
            mut graph: EventGraph,
            signing_key: &SigningKey,
        ) -> EventResult<FixtureGraphEvent> {
            let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &store()?,
                actor_id: &actor(signing_key)?,
                key_epoch: &epoch()?,
                payload: GenesisImportPayload {
                    source_content_hash: Self::genesis_source_hash(),
                    secrets: vec![],
                    password_entries: vec![],
                },
                created_at: &Self::ts("2026-06-28T00:00:00Z"),
                signing_key: signing_key,
            })?;
            let id = event.id()?;
            match graph.insert(crate::EventGraphInsert {
                event: event,
                expected_store_id: STORE,
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?;
            Ok(FixtureGraphEvent {
                graph,
                event_id: id,
            })
        }

        pub(super) fn secret_created(
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
                created_at: Self::ts("2026-06-28T00:00:00Z"),
                key_epoch: epoch()?,
                operations: vec![VaultOperation::SecretCreated {
                    secret: EncryptedSecretPayload {
                        id: Self::sid(secret_id),
                        secret_type: SecretType::ApiKey,
                        ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{secret_id}")),
                        identity_fingerprint: SecretFingerprint::from_trusted(format!(
                            "test-identity:{secret_id}"
                        )),
                        fingerprint: SecretFingerprint::from_trusted(format!(
                            "test-version:{secret_id}"
                        )),
                    },
                }],
            };
            VaultEvent::sign(body, signing_key)
        }
    }

    #[test]
    fn concurrent_secret_additions_both_survive() -> anyhow::Result<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };

        let a = ProjectionFixtures::secret_created(
            vec![genesis_id.clone()],
            "secret_aaaaaaaaaaa",
            &signing_key,
        )?;
        let b = ProjectionFixtures::secret_created(
            vec![genesis_id],
            "secret_bbbbbbbbbbb",
            &signing_key,
        )?;
        match graph.insert(crate::EventGraphInsert {
            event: a,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        match graph.insert(crate::EventGraphInsert {
            event: b,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let projection = VaultProjection::from_graph(&graph, STORE)?;
        assert_eq!(projection.live_secrets(&graph).len(), 2);
        assert!(!projection.has_blocking_conflicts());
        Ok(())
    }

    #[test]
    fn concurrent_replacements_create_conflict_group() -> anyhow::Result<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        let base = ProjectionFixtures::secret_created(
            vec![genesis_id.clone()],
            "secret_original1",
            &signing_key,
        )?;
        let base_id = base.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: base,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let r1 =
            ProjectionFixtures::replacement_event(&signing_key, &base_id, "secret_newaaaaaaa")?;
        let r2 =
            ProjectionFixtures::replacement_event(&signing_key, &base_id, "secret_newbbbbbbb")?;
        match graph.insert(crate::EventGraphInsert {
            event: r1,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        match graph.insert(crate::EventGraphInsert {
            event: r2,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let projection = VaultProjection::from_graph(&graph, STORE)?;
        assert_eq!(projection.live_secrets(&graph).len(), 2);
        assert!(
            projection
                .replacement_conflicts
                .contains_key(&ProjectionFixtures::sid("secret_original1"))
        );
        Ok(())
    }

    #[test]
    fn projection_is_replay_invariant() -> anyhow::Result<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        match graph.insert(crate::EventGraphInsert {
            event: ProjectionFixtures::secret_created(
                vec![genesis_id.clone()],
                "secret_aaaaaaaaaaa",
                &signing_key,
            )?,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        match graph.insert(crate::EventGraphInsert {
            event: ProjectionFixtures::secret_created(
                vec![genesis_id],
                "secret_bbbbbbbbbbb",
                &signing_key,
            )?,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        VaultProjection::assert_replay_invariant(&graph, STORE)?;
        Ok(())
    }

    #[test]
    fn secret_conflict_resolved_picks_winner() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        let base = ProjectionFixtures::secret_created(
            vec![genesis_id.clone()],
            "secret_original1",
            &signing_key,
        )?;
        let base_id = base.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: base,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let r1 =
            ProjectionFixtures::replacement_event(&signing_key, &base_id, "secret_newaaaaaaa")?;
        let r2 =
            ProjectionFixtures::replacement_event(&signing_key, &base_id, "secret_newbbbbbbb")?;
        match graph.insert(crate::EventGraphInsert {
            event: r1,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        match graph.insert(crate::EventGraphInsert {
            event: r2,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let resolve_body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store()?,
            actor_id: actor(&signing_key)?,
            actor_signing_public_key: public_key(&signing_key),
            parents: graph.heads(),
            created_at: ProjectionFixtures::ts("2026-06-28T00:00:01Z"),
            key_epoch: epoch()?,
            operations: vec![VaultOperation::SecretConflictResolved {
                old_id: ProjectionFixtures::sid("secret_original1"),
                chosen_secret_id: ProjectionFixtures::sid("secret_newaaaaaaa"),
                rejected_secret_ids: vec![ProjectionFixtures::sid("secret_newbbbbbbb")],
            }],
        };
        let resolved = VaultEvent::sign(resolve_body, &signing_key)?;
        match graph.insert(crate::EventGraphInsert {
            event: resolved,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let projection = VaultProjection::from_graph(&graph, STORE)?;
        assert!(!projection.has_blocking_conflicts());
        let live = projection.live_secrets(&graph);
        assert!(live.contains_key("secret_newaaaaaaa"));
        assert!(!live.contains_key("secret_newbbbbbbb"));
        Ok(())
    }

    #[test]
    fn concurrent_deletes_tombstone_secret() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        let created = ProjectionFixtures::secret_created(
            vec![genesis_id.clone()],
            "secret_aaaaaaaaaaa",
            &signing_key,
        )?;
        let created_id = created.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: created,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let delete_body = |parents: Vec<EventId>| -> EventResult<VaultEventBody> {
            Ok(VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store()?,
                actor_id: actor(&signing_key)?,
                actor_signing_public_key: public_key(&signing_key),
                parents,
                created_at: ProjectionFixtures::ts("2026-06-28T00:00:00Z"),
                key_epoch: epoch()?,
                operations: vec![VaultOperation::SecretDeleted {
                    secret_id: ProjectionFixtures::sid("secret_aaaaaaaaaaa"),
                }],
            })
        };

        let d1 = VaultEvent::sign(delete_body(vec![created_id.clone()])?, &signing_key)?;
        let d2 = VaultEvent::sign(delete_body(vec![created_id])?, &signing_key)?;
        match graph.insert(crate::EventGraphInsert {
            event: d1,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        match graph.insert(crate::EventGraphInsert {
            event: d2,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let projection = VaultProjection::from_graph(&graph, STORE)?;
        assert!(projection.live_secrets(&graph).is_empty());
        Ok(())
    }

    #[test]
    fn old_epoch_mutation_concurrent_with_rotation_fails_closed() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        let mutation = ProjectionFixtures::signed_operation(
            &signing_key,
            vec![genesis_id.clone()],
            VaultOperation::VaultCleared,
        )?;
        let rotation = ProjectionFixtures::signed_operation(
            &signing_key,
            vec![genesis_id],
            VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
            },
        )?;
        match graph.insert(crate::EventGraphInsert {
            event: mutation,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        match graph.insert(crate::EventGraphInsert {
            event: rotation,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let projection = VaultProjection::from_graph(&graph, STORE)?;
        assert!(projection.has_blocking_conflicts());
        assert!(projection.security_conflicts.iter().any(|conflict| {
            conflict
                .reasons
                .contains(&EpochRotationReason::ConcurrentVaultMutation)
        }));
        Ok(())
    }

    #[test]
    fn three_way_fork_projection_is_replay_invariant() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };

        let a = ProjectionFixtures::secret_created(
            vec![genesis_id.clone()],
            "secret_forkaaaaaa",
            &signing_key,
        )?;
        let b = ProjectionFixtures::secret_created(
            vec![genesis_id.clone()],
            "secret_forkbbbbbb",
            &signing_key,
        )?;
        let c = ProjectionFixtures::secret_created(
            vec![genesis_id],
            "secret_forkcccccc",
            &signing_key,
        )?;
        match graph.insert(crate::EventGraphInsert {
            event: a,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        match graph.insert(crate::EventGraphInsert {
            event: b,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        match graph.insert(crate::EventGraphInsert {
            event: c,
            expected_store_id: STORE,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        VaultProjection::assert_replay_invariant(&graph, STORE)?;
        let projection = VaultProjection::from_graph(&graph, STORE)?;
        assert_eq!(projection.live_secrets(&graph).len(), 3);
        Ok(())
    }
}
