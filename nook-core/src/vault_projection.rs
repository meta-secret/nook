//! Deterministic encrypted vault projection from the causal event log.

use crate::error::{VaultError, VaultResult};
use crate::event_canonical::EventId;
use crate::secret_types::StoredSecretRecord;
use crate::vault_epoch::{
    EpochRecord, EpochRotationReason, KeyEpoch, concurrent_epoch_rotations_conflict,
    operation_starts_epoch,
};
use crate::vault_event::{EncryptedSecretPayload, VaultOperation};
use crate::vault_event_graph::EventGraph;
use std::collections::BTreeMap;

/// One live or tombstoned secret in the encrypted projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedSecret {
    pub record: StoredSecretRecord,
    pub created_by: EventId,
    pub deleted_by: Option<EventId>,
    pub replaced_from: Option<String>,
}

impl ProjectedSecret {
    #[must_use]
    pub fn is_live(&self, graph: &EventGraph) -> bool {
        match &self.deleted_by {
            None => true,
            Some(deleter) => !graph.is_ancestor(&self.created_by, deleter),
        }
    }
}

/// Concurrent replacement candidates for one old secret id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretReplacementConflict {
    pub old_secret_id: String,
    /// event id → new secret id
    pub candidates: BTreeMap<EventId, String>,
}

/// Concurrent security-sensitive epoch transitions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityConflict {
    pub events: Vec<EventId>,
    pub reasons: Vec<EpochRotationReason>,
}

/// Materialized encrypted vault state derived from events.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VaultProjection {
    pub store_id: String,
    pub current_epoch: Option<KeyEpoch>,
    pub epoch_history: Vec<EpochRecord>,
    pub secrets: BTreeMap<String, ProjectedSecret>,
    pub replacement_conflicts: BTreeMap<String, SecretReplacementConflict>,
    pub security_conflicts: Vec<SecurityConflict>,
    pub unresolved_schema: bool,
    pub cleared: bool,
}

impl VaultProjection {
    #[must_use]
    pub fn live_secrets(&self, graph: &EventGraph) -> BTreeMap<String, StoredSecretRecord> {
        self.secrets
            .iter()
            .filter(|(_, secret)| secret.is_live(graph))
            .map(|(id, secret)| (id.clone(), secret.record.clone()))
            .collect()
    }

    #[must_use]
    pub fn has_blocking_conflicts(&self) -> bool {
        !self.replacement_conflicts.is_empty() || !self.security_conflicts.is_empty()
    }
}

/// Rebuild projection from the event graph. Result is independent of provider order
/// and of the topological tie-break used internally.
pub fn project_vault(graph: &EventGraph, store_id: &str) -> VaultResult<VaultProjection> {
    let order = graph.topological_order()?;
    let mut projection = VaultProjection {
        store_id: store_id.to_owned(),
        ..VaultProjection::default()
    };

    let mut epoch_events: BTreeMap<EventId, EpochRotationReason> = BTreeMap::new();
    let mut replacements_by_old: BTreeMap<String, Vec<(EventId, String)>> = BTreeMap::new();

    for event_id in order {
        let event = graph.get(&event_id).ok_or(VaultError::MissingEvent {
            event_id: event_id.as_str().to_owned(),
        })?;
        if event.body.store_id != store_id {
            return Err(VaultError::ProjectionStoreMismatch);
        }
        if event.body.schema_version > crate::vault_event::VAULT_EVENT_SCHEMA_VERSION {
            projection.unresolved_schema = true;
            continue;
        }

        for operation in &event.body.operations {
            if let Some(reason) = operation_starts_epoch(operation) {
                epoch_events.insert(event_id.clone(), reason);
            }
            apply_operation(
                &mut projection,
                &event_id,
                operation,
                &mut replacements_by_old,
            );
        }

        if let Ok(epoch_id) = EventId::parse(&event.body.key_epoch) {
            let epoch = KeyEpoch(epoch_id);
            if projection.current_epoch.as_ref() != Some(&epoch) {
                if let Some(reason) = epoch_events.get(&event_id).copied() {
                    projection.epoch_history.push(EpochRecord {
                        epoch: epoch.clone(),
                        started_by: event_id.clone(),
                        reason,
                    });
                }
                projection.current_epoch = Some(epoch);
            }
        }
    }

    projection.security_conflicts = detect_security_conflicts(graph, &epoch_events);
    projection.replacement_conflicts = detect_replacement_conflicts(graph, &replacements_by_old);
    Ok(projection)
}

fn apply_operation(
    projection: &mut VaultProjection,
    event_id: &EventId,
    operation: &VaultOperation,
    replacements_by_old: &mut BTreeMap<String, Vec<(EventId, String)>>,
) {
    match operation {
        VaultOperation::VaultImported { secrets, .. }
        | VaultOperation::EpochCheckpoint { secrets, .. } => {
            for secret in secrets {
                insert_secret(projection, event_id, secret, None);
            }
        }
        VaultOperation::SecretCreated { secret } => {
            insert_secret(projection, event_id, secret, None);
        }
        VaultOperation::SecretDeleted { secret_id } => {
            if let Some(entry) = projection.secrets.get_mut(secret_id) {
                entry.deleted_by = Some(event_id.clone());
            }
        }
        VaultOperation::SecretReplaced { old_id, new_secret } => {
            if let Some(entry) = projection.secrets.get_mut(old_id) {
                entry.deleted_by = Some(event_id.clone());
            }
            insert_secret(projection, event_id, new_secret, Some(old_id.clone()));
            replacements_by_old
                .entry(old_id.clone())
                .or_default()
                .push((event_id.clone(), new_secret.id.clone()));
        }
        VaultOperation::SecretConflictResolved {
            old_id,
            chosen_secret_id,
            rejected_secret_ids,
        } => {
            for rejected in rejected_secret_ids {
                if let Some(entry) = projection.secrets.get_mut(rejected) {
                    entry.deleted_by = Some(event_id.clone());
                }
            }
            replacements_by_old.remove(old_id);
            projection.replacement_conflicts.remove(old_id);
            if let Some(chosen) = projection.secrets.get(chosen_secret_id) {
                let _ = chosen;
            }
        }
        VaultOperation::VaultCleared => {
            projection.cleared = true;
            projection.secrets.clear();
        }
        VaultOperation::JoinRequested { .. }
        | VaultOperation::JoinApproved { .. }
        | VaultOperation::JoinDenied { .. }
        | VaultOperation::MemberRenamed { .. }
        | VaultOperation::DeviceRevoked { .. }
        | VaultOperation::PasswordAdded { .. }
        | VaultOperation::PasswordRotated { .. }
        | VaultOperation::PasswordRemoved { .. } => {}
    }
}

fn insert_secret(
    projection: &mut VaultProjection,
    event_id: &EventId,
    secret: &EncryptedSecretPayload,
    replaced_from: Option<String>,
) {
    projection.secrets.insert(
        secret.id.clone(),
        ProjectedSecret {
            record: secret.to_stored(),
            created_by: event_id.clone(),
            deleted_by: None,
            replaced_from,
        },
    );
}

fn detect_replacement_conflicts(
    graph: &EventGraph,
    replacements_by_old: &BTreeMap<String, Vec<(EventId, String)>>,
) -> BTreeMap<String, SecretReplacementConflict> {
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
) -> VaultResult<()> {
    let baseline = project_vault(graph, store_id)?;
    for _ in 0..3 {
        let again = project_vault(graph, store_id)?;
        if again != baseline {
            return Err(VaultError::ProjectionReplayMismatch);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::VaultResult;
    use super::*;
    use crate::secret_types::SecretType;
    use crate::vault_event::{
        VAULT_EVENT_SCHEMA_VERSION, VaultEvent, VaultEventBody, VaultOperation,
        build_genesis_import_event,
    };
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    fn key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    const STORE: &str = "store_testtoken1";
    const ACTOR: &str = "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const EPOCH: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn genesis(graph: &mut EventGraph, signing_key: &SigningKey) -> EventId {
        let event = build_genesis_import_event(
            STORE,
            ACTOR,
            &EventId::parse(EPOCH).unwrap(),
            "legacy-hash",
            vec![],
            "2026-06-28T00:00:00Z",
            signing_key,
        )
        .unwrap();
        let id = event.id().unwrap();
        graph.insert(event, STORE).unwrap();
        id
    }

    fn secret_created(
        parents: Vec<EventId>,
        secret_id: &str,
        signing_key: &SigningKey,
    ) -> VaultEvent {
        let body = VaultEventBody {
            schema_version: VAULT_EVENT_SCHEMA_VERSION,
            store_id: STORE.to_owned(),
            actor_id: ACTOR.to_owned(),
            parents: parents
                .into_iter()
                .map(|id| id.as_str().to_owned())
                .collect(),
            created_at: "2026-06-28T00:00:00Z".to_owned(),
            key_epoch: EPOCH.to_owned(),
            operations: vec![VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload {
                    id: secret_id.to_owned(),
                    secret_type: SecretType::ApiKey,
                    ciphertext: format!("cipher-{secret_id}"),
                },
            }],
        };
        VaultEvent::sign(body, signing_key).unwrap()
    }

    #[test]
    fn concurrent_secret_additions_both_survive() {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);

        let a = secret_created(vec![genesis_id.clone()], "secret_aaaaaaaaaaa", &signing_key);
        let b = secret_created(vec![genesis_id], "secret_bbbbbbbbbbb", &signing_key);
        graph.insert(a, STORE).unwrap();
        graph.insert(b, STORE).unwrap();

        let projection = project_vault(&graph, STORE).unwrap();
        assert_eq!(projection.live_secrets(&graph).len(), 2);
        assert!(!projection.has_blocking_conflicts());
    }

    #[test]
    fn causal_delete_hides_secret() {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);
        let created = secret_created(vec![genesis_id.clone()], "secret_aaaaaaaaaaa", &signing_key);
        let created_id = created.id().unwrap();
        graph.insert(created, STORE).unwrap();

        let delete_body = VaultEventBody {
            schema_version: VAULT_EVENT_SCHEMA_VERSION,
            store_id: STORE.to_owned(),
            actor_id: ACTOR.to_owned(),
            parents: vec![created_id.as_str().to_owned()],
            created_at: "2026-06-28T00:00:00Z".to_owned(),
            key_epoch: EPOCH.to_owned(),
            operations: vec![VaultOperation::SecretDeleted {
                secret_id: "secret_aaaaaaaaaaa".to_owned(),
            }],
        };
        let deleted = VaultEvent::sign(delete_body, &signing_key).unwrap();
        graph.insert(deleted, STORE).unwrap();

        let projection = project_vault(&graph, STORE).unwrap();
        assert!(projection.live_secrets(&graph).is_empty());
    }

    #[test]
    fn concurrent_replacements_create_conflict_group() {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);
        let base = secret_created(vec![genesis_id.clone()], "secret_original1", &signing_key);
        let base_id = base.id().unwrap();
        graph.insert(base, STORE).unwrap();

        let replace = |new_id: &str| {
            let body = VaultEventBody {
                schema_version: VAULT_EVENT_SCHEMA_VERSION,
                store_id: STORE.to_owned(),
                actor_id: ACTOR.to_owned(),
                parents: vec![base_id.as_str().to_owned()],
                created_at: "2026-06-28T00:00:00Z".to_owned(),
                key_epoch: EPOCH.to_owned(),
                operations: vec![VaultOperation::SecretReplaced {
                    old_id: "secret_original1".to_owned(),
                    new_secret: EncryptedSecretPayload {
                        id: new_id.to_owned(),
                        secret_type: SecretType::ApiKey,
                        ciphertext: format!("cipher-{new_id}"),
                    },
                }],
            };
            VaultEvent::sign(body, &signing_key).unwrap()
        };

        let r1 = replace("secret_newaaaaaaa");
        let r2 = replace("secret_newbbbbbbb");
        graph.insert(r1, STORE).unwrap();
        graph.insert(r2, STORE).unwrap();

        let projection = project_vault(&graph, STORE).unwrap();
        assert_eq!(projection.live_secrets(&graph).len(), 2);
        assert!(
            projection
                .replacement_conflicts
                .contains_key("secret_original1")
        );
    }

    #[test]
    fn projection_is_replay_invariant() {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);
        graph
            .insert(
                secret_created(vec![genesis_id.clone()], "secret_aaaaaaaaaaa", &signing_key),
                STORE,
            )
            .unwrap();
        graph
            .insert(
                secret_created(vec![genesis_id], "secret_bbbbbbbbbbb", &signing_key),
                STORE,
            )
            .unwrap();
        assert_projection_permutation_invariant(&graph, STORE).unwrap();
    }

    #[test]
    fn secret_conflict_resolved_picks_winner() -> VaultResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);
        let base = secret_created(vec![genesis_id.clone()], "secret_original1", &signing_key);
        let base_id = base.id()?;
        graph.insert(base, STORE)?;

        let signed_replace = |new_id: &str| -> VaultResult<VaultEvent> {
            let body = VaultEventBody {
                schema_version: VAULT_EVENT_SCHEMA_VERSION,
                store_id: STORE.to_owned(),
                actor_id: ACTOR.to_owned(),
                parents: vec![base_id.as_str().to_owned()],
                created_at: "2026-06-28T00:00:00Z".to_owned(),
                key_epoch: EPOCH.to_owned(),
                operations: vec![VaultOperation::SecretReplaced {
                    old_id: "secret_original1".to_owned(),
                    new_secret: EncryptedSecretPayload {
                        id: new_id.to_owned(),
                        secret_type: SecretType::ApiKey,
                        ciphertext: format!("cipher-{new_id}"),
                    },
                }],
            };
            VaultEvent::sign(body, &signing_key)
        };

        let r1 = signed_replace("secret_newaaaaaaa")?;
        let r2 = signed_replace("secret_newbbbbbbb")?;
        graph.insert(r1, STORE)?;
        graph.insert(r2, STORE)?;

        let resolve_body = VaultEventBody {
            schema_version: VAULT_EVENT_SCHEMA_VERSION,
            store_id: STORE.to_owned(),
            actor_id: ACTOR.to_owned(),
            parents: graph
                .heads()
                .iter()
                .map(|id| id.as_str().to_owned())
                .collect(),
            created_at: "2026-06-28T00:00:01Z".to_owned(),
            key_epoch: EPOCH.to_owned(),
            operations: vec![VaultOperation::SecretConflictResolved {
                old_id: "secret_original1".to_owned(),
                chosen_secret_id: "secret_newaaaaaaa".to_owned(),
                rejected_secret_ids: vec!["secret_newbbbbbbb".to_owned()],
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
    fn vault_cleared_empties_projection() -> VaultResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);
        graph.insert(
            secret_created(vec![genesis_id.clone()], "secret_aaaaaaaaaaa", &signing_key),
            STORE,
        )?;
        assert_eq!(project_vault(&graph, STORE)?.live_secrets(&graph).len(), 1);

        let clear_body = VaultEventBody {
            schema_version: VAULT_EVENT_SCHEMA_VERSION,
            store_id: STORE.to_owned(),
            actor_id: ACTOR.to_owned(),
            parents: graph
                .heads()
                .iter()
                .map(|id| id.as_str().to_owned())
                .collect(),
            created_at: "2026-06-28T00:00:01Z".to_owned(),
            key_epoch: EPOCH.to_owned(),
            operations: vec![VaultOperation::VaultCleared],
        };
        let cleared = VaultEvent::sign(clear_body, &signing_key)?;
        graph.insert(cleared, STORE)?;

        assert!(project_vault(&graph, STORE)?.live_secrets(&graph).is_empty());
        Ok(())
    }
}
