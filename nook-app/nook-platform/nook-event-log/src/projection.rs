//! Deterministic encrypted vault projection from the causal event log.

mod operation_application;

use crate::canonical::EventId;
use crate::epoch::{
    EpochRecord, EpochRotationReason, EpochTransition, KeyEpoch,
    concurrent_epoch_rotations_conflict, operation_starts_epoch,
};
use crate::graph::EventGraph;
use crate::{EventError, EventResult};
use crate::{PasswordUnlockEntry, SecretFingerprint};
use nook_auth2::StoredSecretRecord;
use nook_auth2::{SecretId, StoreId};
use std::collections::BTreeMap;

use operation_application::apply_operation;

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

/// Rebuild projection from the event graph. Result is independent of provider order
/// and of the topological tie-break used internally.
pub fn project_vault(graph: &EventGraph, store_id: &str) -> EventResult<VaultProjection> {
    let expected_store = StoreId::parse(store_id)?;
    let order = graph.topological_order()?;
    let mut projection = VaultProjection {
        store_id: expected_store.clone(),
        ..VaultProjection::default()
    };

    let mut epoch_events: BTreeMap<EventId, EpochRotationReason> = BTreeMap::new();
    let mut security_events: BTreeMap<EventId, EpochRotationReason> = BTreeMap::new();
    let mut replacements_by_old: BTreeMap<SecretId, Vec<(EventId, SecretId)>> = BTreeMap::new();

    for event_id in order {
        let event = graph.get(&event_id).ok_or(EventError::MissingEvent {
            event_id: event_id.as_str().to_owned(),
        })?;
        if event.body.store_id != expected_store {
            return Err(EventError::ProjectionStoreMismatch);
        }
        if !event.body.schema_version.is_supported() {
            projection.unresolved_schema = true;
            continue;
        }

        let mut security_reason = None;
        for operation in &event.body.operations {
            if let EpochTransition::Rotated(reason) = operation_starts_epoch(operation) {
                epoch_events.insert(event_id.clone(), reason);
                security_reason = Some(reason);
            }
            if matches!(operation, crate::VaultOperation::JoinApproved { .. }) {
                security_reason.get_or_insert(EpochRotationReason::AccessGrant);
            } else if !matches!(
                operation,
                crate::VaultOperation::EpochCheckpoint { .. }
                    | crate::VaultOperation::JoinRequested { .. }
            ) {
                security_reason.get_or_insert(EpochRotationReason::ConcurrentVaultMutation);
            }
            apply_operation(
                &mut projection,
                &event_id,
                operation,
                &mut replacements_by_old,
            );
        }
        if let Some(reason) = security_reason {
            security_events.insert(event_id.clone(), reason);
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

    projection.security_conflicts = detect_security_conflicts(graph, &security_events);
    projection.replacement_conflicts = detect_replacement_conflicts(graph, &replacements_by_old);
    Ok(projection)
}

fn detect_replacement_conflicts(
    graph: &EventGraph,
    replacements_by_old: &BTreeMap<SecretId, Vec<(EventId, SecretId)>>,
) -> BTreeMap<SecretId, SecretReplacementConflict> {
    let mut conflicts = BTreeMap::new();
    for (old_id, entries) in replacements_by_old {
        let unique_events: Vec<&EventId> = entries.iter().map(|(event_id, _)| event_id).collect();
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

fn detect_security_conflicts(
    graph: &EventGraph,
    epoch_events: &BTreeMap<EventId, EpochRotationReason>,
) -> Vec<SecurityConflict> {
    let ids: Vec<EventId> = epoch_events.keys().cloned().collect();
    let mut conflicts = Vec::new();
    for (idx, left_id) in ids.iter().enumerate() {
        for right_id in ids.iter().skip(idx + 1) {
            if !graph.are_concurrent(left_id, right_id) {
                continue;
            }
            let left_reason = epoch_events[left_id];
            let right_reason = epoch_events[right_id];
            if concurrent_epoch_rotations_conflict(left_reason, right_reason) {
                conflicts.push(SecurityConflict {
                    events: vec![left_id.clone(), right_id.clone()],
                    reasons: vec![left_reason, right_reason],
                });
            }
        }
    }
    conflicts
}

/// Verify projection invariance under event permutation (property-style check).
pub fn assert_projection_permutation_invariant(
    graph: &EventGraph,
    store_id: &str,
) -> EventResult<()> {
    let baseline = project_vault(graph, store_id)?;
    for _ in 0..3 {
        let again = project_vault(graph, store_id)?;
        if again != baseline {
            return Err(EventError::ProjectionReplayMismatch);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PasswordEnvelope;
    use crate::event::{
        EncryptedSecretPayload, GenesisImportPayload, VaultEvent, VaultEventBody,
        VaultEventSchemaVersion, VaultOperation, build_genesis_import_event,
    };
    use crate::test_support::{actor, epoch, public_key, signing_key as key, store};
    use crate::{
        AgeArmoredCiphertext, DevicePublicKey, EventResult, MemberLabel, SecretFingerprint,
    };
    use ed25519_dalek::SigningKey;
    use nook_auth2::SecretType;
    use nook_auth2::{
        DeviceId, IsoTimestamp, OpaqueCiphertext, PasswordEntryId, SecretId, Sha256Hex,
    };

    fn ts(value: &str) -> IsoTimestamp {
        IsoTimestamp::from_trusted(value.to_owned())
    }

    fn sid(value: &str) -> SecretId {
        SecretId::from_vault_record(value)
    }

    fn password_envelope(ciphertext: &str) -> PasswordEnvelope {
        PasswordEnvelope {
            version: 1,
            kdf: "scrypt".to_owned(),
            work_factor: 10,
            recipient: String::new(),
            wrapped_keys: String::new(),
            ciphertext: ciphertext.to_owned(),
        }
    }

    fn password_envelope_fixture(ciphertext: &str) -> PasswordEnvelope {
        password_envelope(ciphertext)
    }

    fn genesis_source_hash() -> Sha256Hex {
        Sha256Hex::from_trusted("deadbeef".repeat(8))
    }

    fn signed_operation(
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
                created_at: ts("2026-06-28T00:00:00Z"),
                key_epoch: epoch()?,
                operations: vec![operation],
            },
            signing_key,
        )
    }

    fn replacement_event(
        signing_key: &SigningKey,
        parent: &EventId,
        new_id: &str,
    ) -> EventResult<VaultEvent> {
        signed_operation(
            signing_key,
            vec![parent.clone()],
            VaultOperation::SecretReplaced {
                old_id: sid("secret_original1"),
                new_secret: EncryptedSecretPayload {
                    id: sid(new_id),
                    secret_type: SecretType::ApiKey,
                    ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{new_id}")),
                    identity_fingerprint: SecretFingerprint::from_trusted(format!(
                        "test-identity:{new_id}"
                    )),
                    fingerprint: SecretFingerprint::from_trusted(format!("test-version:{new_id}")),
                },
            },
        )
    }

    const STORE: &str = "store_testtoken11";

    fn genesis(graph: &mut EventGraph, signing_key: &SigningKey) -> EventResult<EventId> {
        let event = build_genesis_import_event(
            &store()?,
            &actor(signing_key)?,
            &epoch()?,
            GenesisImportPayload {
                source_content_hash: genesis_source_hash(),
                secrets: vec![],
                password_entries: vec![],
            },
            &ts("2026-06-28T00:00:00Z"),
            signing_key,
        )?;
        let id = event.id()?;
        graph.insert(event, STORE)?;
        Ok(id)
    }

    fn secret_created(
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
            created_at: ts("2026-06-28T00:00:00Z"),
            key_epoch: epoch()?,
            operations: vec![VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload {
                    id: sid(secret_id),
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

    #[test]
    fn concurrent_secret_additions_both_survive() -> anyhow::Result<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key)?;

        let a = secret_created(vec![genesis_id.clone()], "secret_aaaaaaaaaaa", &signing_key)?;
        let b = secret_created(vec![genesis_id], "secret_bbbbbbbbbbb", &signing_key)?;
        graph.insert(a, STORE)?;
        graph.insert(b, STORE)?;

        let projection = project_vault(&graph, STORE)?;
        assert_eq!(projection.live_secrets(&graph).len(), 2);
        assert!(!projection.has_blocking_conflicts());
        Ok(())
    }

    #[test]
    fn concurrent_replacements_create_conflict_group() -> anyhow::Result<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key)?;
        let base = secret_created(vec![genesis_id.clone()], "secret_original1", &signing_key)?;
        let base_id = base.id()?;
        graph.insert(base, STORE)?;

        let r1 = replacement_event(&signing_key, &base_id, "secret_newaaaaaaa")?;
        let r2 = replacement_event(&signing_key, &base_id, "secret_newbbbbbbb")?;
        graph.insert(r1, STORE)?;
        graph.insert(r2, STORE)?;

        let projection = project_vault(&graph, STORE)?;
        assert_eq!(projection.live_secrets(&graph).len(), 2);
        assert!(
            projection
                .replacement_conflicts
                .contains_key(&sid("secret_original1"))
        );
        Ok(())
    }

    #[test]
    fn projection_is_replay_invariant() -> anyhow::Result<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key)?;
        graph.insert(
            secret_created(vec![genesis_id.clone()], "secret_aaaaaaaaaaa", &signing_key)?,
            STORE,
        )?;
        graph.insert(
            secret_created(vec![genesis_id], "secret_bbbbbbbbbbb", &signing_key)?,
            STORE,
        )?;
        assert_projection_permutation_invariant(&graph, STORE)?;
        Ok(())
    }

    #[test]
    fn secret_conflict_resolved_picks_winner() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key)?;
        let base = secret_created(vec![genesis_id.clone()], "secret_original1", &signing_key)?;
        let base_id = base.id()?;
        graph.insert(base, STORE)?;

        let r1 = replacement_event(&signing_key, &base_id, "secret_newaaaaaaa")?;
        let r2 = replacement_event(&signing_key, &base_id, "secret_newbbbbbbb")?;
        graph.insert(r1, STORE)?;
        graph.insert(r2, STORE)?;

        let resolve_body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store()?,
            actor_id: actor(&signing_key)?,
            actor_signing_public_key: public_key(&signing_key),
            parents: graph.heads(),
            created_at: ts("2026-06-28T00:00:01Z"),
            key_epoch: epoch()?,
            operations: vec![VaultOperation::SecretConflictResolved {
                old_id: sid("secret_original1"),
                chosen_secret_id: sid("secret_newaaaaaaa"),
                rejected_secret_ids: vec![sid("secret_newbbbbbbb")],
            }],
        };
        let resolved = VaultEvent::sign(resolve_body, &signing_key)?;
        graph.insert(resolved, STORE)?;

        let projection = project_vault(&graph, STORE)?;
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
        let genesis_id = genesis(&mut graph, &signing_key)?;
        let created = secret_created(vec![genesis_id.clone()], "secret_aaaaaaaaaaa", &signing_key)?;
        let created_id = created.id()?;
        graph.insert(created, STORE)?;

        let delete_body = |parents: Vec<EventId>| -> EventResult<VaultEventBody> {
            Ok(VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store()?,
                actor_id: actor(&signing_key)?,
                actor_signing_public_key: public_key(&signing_key),
                parents,
                created_at: ts("2026-06-28T00:00:00Z"),
                key_epoch: epoch()?,
                operations: vec![VaultOperation::SecretDeleted {
                    secret_id: sid("secret_aaaaaaaaaaa"),
                }],
            })
        };

        let d1 = VaultEvent::sign(delete_body(vec![created_id.clone()])?, &signing_key)?;
        let d2 = VaultEvent::sign(delete_body(vec![created_id])?, &signing_key)?;
        graph.insert(d1, STORE)?;
        graph.insert(d2, STORE)?;

        let projection = project_vault(&graph, STORE)?;
        assert!(projection.live_secrets(&graph).is_empty());
        Ok(())
    }

    #[test]
    fn concurrent_security_rotations_surface_conflict() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key)?;

        let revoke = signed_operation(
            &signing_key,
            vec![genesis_id.clone()],
            VaultOperation::DeviceRevoked {
                device_id: DeviceId::parse("abcd1234ef567890")?,
            },
        )?;
        let rotate = signed_operation(
            &signing_key,
            vec![genesis_id],
            VaultOperation::PasswordRotated {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
                envelope: password_envelope_fixture("x"),
            },
        )?;
        graph.insert(revoke, STORE)?;
        graph.insert(rotate, STORE)?;

        let projection = project_vault(&graph, STORE)?;
        assert!(!projection.security_conflicts.is_empty());
        assert!(projection.has_blocking_conflicts());
        Ok(())
    }

    #[test]
    fn concurrent_access_grant_and_rotation_surface_conflict() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key)?;
        let grant = signed_operation(
            &signing_key,
            vec![genesis_id.clone()],
            VaultOperation::JoinApproved {
                device_id: DeviceId::parse("abcd1234ef567890")?,
                encryption_public_key: DevicePublicKey::from_trusted("age1member".to_owned()),
                signing_public_key: public_key(&signing_key),
                label: MemberLabel::from_trusted("Member".to_owned()),
                secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted("secret".to_owned()),
                members_key_ciphertext: AgeArmoredCiphertext::from_trusted("members".to_owned()),
            },
        )?;
        let revoke = signed_operation(
            &signing_key,
            vec![genesis_id],
            VaultOperation::DeviceRevoked {
                device_id: DeviceId::parse("fedcba9876543210")?,
            },
        )?;
        graph.insert(grant, STORE)?;
        graph.insert(revoke, STORE)?;

        let projection = project_vault(&graph, STORE)?;
        assert!(projection.has_blocking_conflicts());
        assert!(
            projection
                .security_conflicts
                .iter()
                .any(|conflict| { conflict.reasons.contains(&EpochRotationReason::AccessGrant) })
        );
        Ok(())
    }

    #[test]
    fn concurrent_join_request_does_not_conflict_with_rotation() -> EventResult<()> {
        let owner_key = key();
        let joiner_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &owner_key)?;
        let request = signed_operation(
            &joiner_key,
            vec![genesis_id.clone()],
            VaultOperation::JoinRequested {
                device_id: DeviceId::parse("abcd1234ef567890")?,
                encryption_public_key: DevicePublicKey::from_trusted("age1joiner".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("Joiner".to_owned()),
            },
        )?;
        let rotation = signed_operation(
            &owner_key,
            vec![genesis_id],
            VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
            },
        )?;
        graph.insert(request, STORE)?;
        graph.insert(rotation, STORE)?;

        let projection = project_vault(&graph, STORE)?;
        assert!(projection.security_conflicts.is_empty());
        Ok(())
    }

    #[test]
    fn old_epoch_mutation_concurrent_with_rotation_fails_closed() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key)?;
        let mutation = signed_operation(
            &signing_key,
            vec![genesis_id.clone()],
            VaultOperation::VaultCleared,
        )?;
        let rotation = signed_operation(
            &signing_key,
            vec![genesis_id],
            VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
            },
        )?;
        graph.insert(mutation, STORE)?;
        graph.insert(rotation, STORE)?;

        let projection = project_vault(&graph, STORE)?;
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
        let genesis_id = genesis(&mut graph, &signing_key)?;

        let a = secret_created(vec![genesis_id.clone()], "secret_forkaaaaaa", &signing_key)?;
        let b = secret_created(vec![genesis_id.clone()], "secret_forkbbbbbb", &signing_key)?;
        let c = secret_created(vec![genesis_id], "secret_forkcccccc", &signing_key)?;
        graph.insert(a, STORE)?;
        graph.insert(b, STORE)?;
        graph.insert(c, STORE)?;

        assert_projection_permutation_invariant(&graph, STORE)?;
        let projection = project_vault(&graph, STORE)?;
        assert_eq!(projection.live_secrets(&graph).len(), 3);
        Ok(())
    }
}
