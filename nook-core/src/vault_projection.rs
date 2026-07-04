//! Deterministic encrypted vault projection from the causal event log.

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::EventId;
use crate::secret_types::StoredSecretRecord;
use crate::vault_epoch::{
    EpochRecord, EpochRotationReason, KeyEpoch, concurrent_epoch_rotations_conflict,
    operation_starts_epoch,
};
use crate::vault_event::{EncryptedSecretPayload, VaultEventSchemaVersion, VaultOperation};
use crate::vault_event_graph::EventGraph;
use crate::vault_ids::{SecretId, StoreId};
use std::collections::BTreeMap;

/// One live or tombstoned secret in the encrypted projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedSecret {
    pub record: StoredSecretRecord,
    pub created_by: EventId,
    pub deleted_by: Option<EventId>,
    pub replaced_from: Option<SecretId>,
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
    pub current_epoch: Option<KeyEpoch>,
    pub epoch_history: Vec<EpochRecord>,
    pub secrets: BTreeMap<SecretId, ProjectedSecret>,
    pub replacement_conflicts: BTreeMap<SecretId, SecretReplacementConflict>,
    pub security_conflicts: Vec<SecurityConflict>,
    pub unresolved_schema: bool,
    pub cleared: bool,
}

impl Default for VaultProjection {
    fn default() -> Self {
        Self {
            store_id: StoreId::parse("store_abcdefghijk").expect("valid default store id"),
            current_epoch: None,
            epoch_history: Vec::new(),
            secrets: BTreeMap::new(),
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
pub fn project_vault(graph: &EventGraph, store_id: &str) -> VaultResult<VaultProjection> {
    let expected_store = StoreId::parse(store_id)?;
    let order = graph.topological_order()?;
    let mut projection = VaultProjection {
        store_id: expected_store.clone(),
        ..VaultProjection::default()
    };

    let mut epoch_events: BTreeMap<EventId, EpochRotationReason> = BTreeMap::new();
    let mut replacements_by_old: BTreeMap<SecretId, Vec<(EventId, SecretId)>> = BTreeMap::new();

    for event_id in order {
        let event = graph.get(&event_id).ok_or(EventError::MissingEvent {
            event_id: event_id.as_str().to_owned(),
        })?;
        if event.body.store_id != expected_store {
            return Err(EventError::ProjectionStoreMismatch.into());
        }
        if event.body.schema_version != VaultEventSchemaVersion::CURRENT {
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

        if let Ok(epoch_id) = EventId::parse(event.body.key_epoch.as_str()) {
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
    replacements_by_old: &mut BTreeMap<SecretId, Vec<(EventId, SecretId)>>,
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
    replaced_from: Option<SecretId>,
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
) -> VaultResult<()> {
    let baseline = project_vault(graph, store_id)?;
    for _ in 0..3 {
        let again = project_vault(graph, store_id)?;
        if again != baseline {
            return Err(EventError::ProjectionReplayMismatch.into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultResult;
    use crate::secret_types::SecretType;
    use crate::vault_event::{
        VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation,
        build_genesis_import_event,
    };
    use crate::vault_ids::{AuthKeyId, DeviceId, SecretId, StoreId};
    use crate::vault_signing::SigningIdentity;
    use crate::vault_wire::{
        DeviceSigningPublicKey, IsoTimestamp, OpaqueCiphertext, PasswordEntryId, Sha256Hex,
    };
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    fn key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

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
        EventId::parse("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .unwrap()
    }

    fn ts(value: &str) -> IsoTimestamp {
        IsoTimestamp::from_trusted(value.to_owned())
    }

    fn sid(value: &str) -> SecretId {
        SecretId::from_vault_record(value)
    }

    fn genesis_source_hash() -> Sha256Hex {
        Sha256Hex::from_trusted("deadbeef".repeat(8))
    }

    const STORE: &str = "store_testtoken11";

    fn genesis(graph: &mut EventGraph, signing_key: &SigningKey) -> EventId {
        let event = build_genesis_import_event(
            &store(),
            &actor(signing_key),
            &epoch(),
            &genesis_source_hash(),
            vec![],
            &ts("2026-06-28T00:00:00Z"),
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
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store(),
            actor_id: actor(signing_key),
            actor_signing_public_key: Some(public_key(signing_key)),
            parents,
            created_at: ts("2026-06-28T00:00:00Z"),
            key_epoch: epoch(),
            operations: vec![VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload {
                    id: sid(secret_id),
                    secret_type: SecretType::ApiKey,
                    ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{secret_id}")),
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
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store(),
            actor_id: actor(&signing_key),
            actor_signing_public_key: Some(public_key(&signing_key)),
            parents: vec![created_id],
            created_at: ts("2026-06-28T00:00:00Z"),
            key_epoch: epoch(),
            operations: vec![VaultOperation::SecretDeleted {
                secret_id: sid("secret_aaaaaaaaaaa"),
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
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store(),
                actor_id: actor(&signing_key),
                actor_signing_public_key: Some(public_key(&signing_key)),
                parents: vec![base_id.clone()],
                created_at: ts("2026-06-28T00:00:00Z"),
                key_epoch: epoch(),
                operations: vec![VaultOperation::SecretReplaced {
                    old_id: sid("secret_original1"),
                    new_secret: EncryptedSecretPayload {
                        id: sid(new_id),
                        secret_type: SecretType::ApiKey,
                        ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{new_id}")),
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
                .contains_key(&sid("secret_original1"))
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
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store(),
                actor_id: actor(&signing_key),
                actor_signing_public_key: Some(public_key(&signing_key)),
                parents: vec![base_id.clone()],
                created_at: ts("2026-06-28T00:00:00Z"),
                key_epoch: epoch(),
                operations: vec![VaultOperation::SecretReplaced {
                    old_id: sid("secret_original1"),
                    new_secret: EncryptedSecretPayload {
                        id: sid(new_id),
                        secret_type: SecretType::ApiKey,
                        ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{new_id}")),
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
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store(),
            actor_id: actor(&signing_key),
            actor_signing_public_key: Some(public_key(&signing_key)),
            parents: graph.heads(),
            created_at: ts("2026-06-28T00:00:01Z"),
            key_epoch: epoch(),
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
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store(),
            actor_id: actor(&signing_key),
            actor_signing_public_key: Some(public_key(&signing_key)),
            parents: graph.heads(),
            created_at: ts("2026-06-28T00:00:01Z"),
            key_epoch: epoch(),
            operations: vec![VaultOperation::VaultCleared],
        };
        let cleared = VaultEvent::sign(clear_body, &signing_key)?;
        graph.insert(cleared, STORE)?;

        assert!(
            project_vault(&graph, STORE)?
                .live_secrets(&graph)
                .is_empty()
        );
        Ok(())
    }

    #[test]
    fn concurrent_deletes_tombstone_secret() -> VaultResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);
        let created = secret_created(vec![genesis_id.clone()], "secret_aaaaaaaaaaa", &signing_key);
        let created_id = created.id()?;
        graph.insert(created, STORE)?;

        let delete_body = |parents: Vec<EventId>| VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store(),
            actor_id: actor(&signing_key),
            actor_signing_public_key: Some(public_key(&signing_key)),
            parents,
            created_at: ts("2026-06-28T00:00:00Z"),
            key_epoch: epoch(),
            operations: vec![VaultOperation::SecretDeleted {
                secret_id: sid("secret_aaaaaaaaaaa"),
            }],
        };

        let d1 = VaultEvent::sign(delete_body(vec![created_id.clone()]), &signing_key)?;
        let d2 = VaultEvent::sign(delete_body(vec![created_id]), &signing_key)?;
        graph.insert(d1, STORE)?;
        graph.insert(d2, STORE)?;

        let projection = project_vault(&graph, STORE)?;
        assert!(projection.live_secrets(&graph).is_empty());
        Ok(())
    }

    #[test]
    fn concurrent_security_rotations_surface_conflict() -> VaultResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);

        let signed_op = |parents: Vec<EventId>, op: VaultOperation| -> VaultResult<VaultEvent> {
            let body = VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store(),
                actor_id: actor(&signing_key),
                actor_signing_public_key: Some(public_key(&signing_key)),
                parents,
                created_at: ts("2026-06-28T00:00:00Z"),
                key_epoch: epoch(),
                operations: vec![op],
            };
            VaultEvent::sign(body, &signing_key)
        };

        let revoke = signed_op(
            vec![genesis_id.clone()],
            VaultOperation::DeviceRevoked {
                device_id: DeviceId::parse("abcd1234ef567890").unwrap(),
            },
        )?;
        let rotate = signed_op(
            vec![genesis_id],
            VaultOperation::PasswordRotated {
                entry_id: PasswordEntryId::parse("pwdentry001").unwrap(),
                envelope_ciphertext: OpaqueCiphertext::from_trusted(
                    r#"{"version":1,"kdf":"scrypt","work_factor":18,"ciphertext":"x"}"#.to_owned(),
                ),
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
    fn three_way_fork_projection_is_replay_invariant() -> VaultResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = genesis(&mut graph, &signing_key);

        let a = secret_created(vec![genesis_id.clone()], "secret_forkaaaaaa", &signing_key);
        let b = secret_created(vec![genesis_id.clone()], "secret_forkbbbbbb", &signing_key);
        let c = secret_created(vec![genesis_id], "secret_forkcccccc", &signing_key);
        graph.insert(a, STORE)?;
        graph.insert(b, STORE)?;
        graph.insert(c, STORE)?;

        assert_projection_permutation_invariant(&graph, STORE)?;
        let projection = project_vault(&graph, STORE)?;
        assert_eq!(projection.live_secrets(&graph).len(), 3);
        Ok(())
    }
}
