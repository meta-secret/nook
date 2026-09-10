//! Concurrent security rotation projection policy.
use super::{
    BTreeMap, ConcurrentEpochRotations, EpochRotationReason, EventGraph, EventId, SecurityConflict,
    VaultProjection,
};
impl VaultProjection {
    pub(super) fn detect_security_conflicts(
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
                if EpochRotationReason::concurrent_epoch_rotations_conflict(
                    ConcurrentEpochRotations {
                        left: left_reason,
                        right: right_reason,
                    },
                ) {
                    conflicts.push(SecurityConflict {
                        events: vec![left_id.clone(), right_id.clone()],
                        reasons: vec![left_reason, right_reason],
                    });
                }
            }
        }
        conflicts
    }
}
#[cfg(test)]
mod tests {
    use super::super::tests::{ProjectionFixtures, STORE};
    use super::*;
    use crate::event::{VaultEvent, VaultEventBody, VaultEventSchemaVersion};
    use crate::test_support::{actor, public_key, signing_key as key, store};
    use crate::{
        AgeArmoredCiphertext, DevicePublicKey, EpochCheckpoint, EpochMetadataState,
        EpochPasswordState, EventError, EventGraphRejection, EventResult, MemberLabel,
        ProjectionIntegrity, VaultOperation,
    };
    use nook_auth2::{DeviceId, PasswordEntryId, Sha256Hex};
    #[test]
    fn concurrent_security_rotations_surface_conflict() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };

        let revoke = ProjectionFixtures::signed_operation(
            &signing_key,
            vec![genesis_id.clone()],
            VaultOperation::DeviceRevoked {
                device_id: DeviceId::parse("abcd1234ef567890")?,
            },
        )?;
        let rotate = ProjectionFixtures::signed_operation(
            &signing_key,
            vec![genesis_id],
            VaultOperation::PasswordRotated {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
                envelope: ProjectionFixtures::password_envelope_fixture("x"),
            },
        )?;
        match graph.insert(crate::EventGraphInsert {
            event: revoke,
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
            event: rotate,
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
        assert!(!projection.security_conflicts.is_empty());
        assert!(projection.has_blocking_conflicts());
        Ok(())
    }
    #[test]
    fn concurrent_access_grant_and_rotation_surface_conflict() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        let grant = ProjectionFixtures::signed_operation(
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
        let revoke = ProjectionFixtures::signed_operation(
            &signing_key,
            vec![genesis_id],
            VaultOperation::DeviceRevoked {
                device_id: DeviceId::parse("fedcba9876543210")?,
            },
        )?;
        match graph.insert(crate::EventGraphInsert {
            event: grant,
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
            event: revoke,
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
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &owner_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        let request = ProjectionFixtures::signed_operation(
            &joiner_key,
            vec![genesis_id.clone()],
            VaultOperation::JoinRequested {
                device_id: DeviceId::parse("abcd1234ef567890")?,
                encryption_public_key: DevicePublicKey::from_trusted("age1joiner".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("Joiner".to_owned()),
            },
        )?;
        let request_id = request.id()?;
        let rotation = ProjectionFixtures::signed_operation(
            &owner_key,
            vec![genesis_id],
            VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
            },
        )?;
        let rotation_id = rotation.id()?;
        let checkpoint = VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store()?,
                actor_id: actor(&owner_key)?,
                actor_signing_public_key: public_key(&owner_key),
                parents: vec![rotation_id.clone()],
                created_at: ProjectionFixtures::ts("2026-06-28T00:00:01Z"),
                key_epoch: rotation_id,
                operations: vec![VaultOperation::EpochCheckpoint {
                    secrets: Vec::new(),
                    members_checkpoint_hash: Sha256Hex::from_trusted("0".repeat(64)),
                    rotated_meta_records: crate::EpochMetadataState::Replace(Vec::new()),
                    password_entries: crate::EpochPasswordState::Replace(Vec::new()),
                }],
            },
            &owner_key,
        )?;
        let checkpoint_id = checkpoint.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: request,
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
        match graph.insert(crate::EventGraphInsert {
            event: checkpoint,
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
        assert!(projection.security_conflicts.is_empty());
        assert_eq!(
            graph.current_epoch_checkpoint()?,
            EpochCheckpoint::Committed(checkpoint_id)
        );
        assert!(graph.heads().contains(&request_id));
        Ok(())
    }

    #[test]
    fn ordered_security_changes_remain_resolved_without_a_checkpoint() -> EventResult<()> {
        let owner_key = key();
        let member_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &owner_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        assert_eq!(
            graph.current_epoch_checkpoint()?,
            EpochCheckpoint::Unrotated
        );

        let device_id = DeviceId::parse("abcd1234ef567890")?;
        let grant = ProjectionFixtures::signed_operation(
            &owner_key,
            vec![genesis_id],
            VaultOperation::JoinApproved {
                device_id: device_id.clone(),
                encryption_public_key: DevicePublicKey::from_trusted("age1member".to_owned()),
                signing_public_key: public_key(&member_key),
                label: MemberLabel::from_trusted("Member".to_owned()),
                secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted("secret".to_owned()),
                members_key_ciphertext: AgeArmoredCiphertext::from_trusted("members".to_owned()),
            },
        )?;
        let grant_id = grant.id()?;
        graph = graph
            .insert(crate::EventGraphInsert {
                event: grant,
                expected_store_id: STORE,
            })
            .map_err(EventGraphRejection::into_cause)?
            .graph;

        let revoke = ProjectionFixtures::signed_operation(
            &owner_key,
            vec![grant_id],
            VaultOperation::DeviceRevoked { device_id },
        )?;
        graph = graph
            .insert(crate::EventGraphInsert {
                event: revoke,
                expected_store_id: STORE,
            })
            .map_err(EventGraphRejection::into_cause)?
            .graph;

        let projection = VaultProjection::from_graph(&graph, STORE)?;
        assert!(projection.security_conflicts.is_empty());
        assert!(!projection.has_blocking_conflicts());
        assert_eq!(projection.integrity(), ProjectionIntegrity::Resolved);
        assert_eq!(
            graph.current_epoch_checkpoint()?,
            EpochCheckpoint::Unrotated
        );
        Ok(())
    }

    #[test]
    fn projection_integrity_prioritizes_schema_and_conflict_states() {
        let mut projection = VaultProjection::default();
        assert_eq!(projection.integrity(), ProjectionIntegrity::Resolved);

        let secret_id = ProjectionFixtures::sid("secret_conflicted");
        projection.replacement_conflicts.insert(
            secret_id.clone(),
            crate::SecretReplacementConflict {
                old_secret_id: secret_id,
                candidates: BTreeMap::new(),
            },
        );
        assert_eq!(
            projection.integrity(),
            ProjectionIntegrity::BlockingConflicts
        );

        projection.unresolved_schema = true;
        assert_eq!(
            projection.integrity(),
            ProjectionIntegrity::UnresolvedSchema
        );
    }

    #[test]
    fn concurrent_epoch_checkpoints_are_not_a_current_checkpoint() -> EventResult<()> {
        let signing_key = key();
        let mut graph = EventGraph::new();
        let genesis_id = {
            let prepared = ProjectionFixtures::genesis(graph, &signing_key)?;
            graph = prepared.graph;
            prepared.event_id
        };
        let rotation = ProjectionFixtures::signed_operation(
            &signing_key,
            vec![genesis_id],
            VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
            },
        )?;
        let rotation_id = rotation.id()?;
        graph = graph
            .insert(crate::EventGraphInsert {
                event: rotation,
                expected_store_id: STORE,
            })
            .map_err(EventGraphRejection::into_cause)?
            .graph;

        let first = VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store()?,
                actor_id: actor(&signing_key)?,
                actor_signing_public_key: public_key(&signing_key),
                parents: vec![rotation_id.clone()],
                created_at: ProjectionFixtures::ts("2026-06-28T00:00:01Z"),
                key_epoch: rotation_id.clone(),
                operations: vec![VaultOperation::EpochCheckpoint {
                    secrets: Vec::new(),
                    members_checkpoint_hash: Sha256Hex::from_trusted("1".repeat(64)),
                    rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
                    password_entries: EpochPasswordState::Replace(Vec::new()),
                }],
            },
            &signing_key,
        )?;
        let second = VaultEvent::sign(
            VaultEventBody {
                created_at: ProjectionFixtures::ts("2026-06-28T00:00:02Z"),
                operations: vec![VaultOperation::EpochCheckpoint {
                    secrets: Vec::new(),
                    members_checkpoint_hash: Sha256Hex::from_trusted("2".repeat(64)),
                    rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
                    password_entries: EpochPasswordState::Replace(Vec::new()),
                }],
                ..first.body.clone()
            },
            &signing_key,
        )?;
        graph = graph
            .insert(crate::EventGraphInsert {
                event: first,
                expected_store_id: STORE,
            })
            .map_err(EventGraphRejection::into_cause)?
            .graph;
        graph = graph
            .insert(crate::EventGraphInsert {
                event: second,
                expected_store_id: STORE,
            })
            .map_err(EventGraphRejection::into_cause)?
            .graph;

        assert!(matches!(
            graph.current_epoch_checkpoint(),
            Err(EventError::InvalidEpochCheckpointStructure {
                reason: "multiple concurrent epoch checkpoints remain"
            })
        ));
        Ok(())
    }
}
