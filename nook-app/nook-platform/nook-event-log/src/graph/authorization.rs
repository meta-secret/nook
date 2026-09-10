use std::collections::{BTreeMap, BTreeSet};

mod membership;
use nook_auth2::{AuthKeyId, DeviceSigningPublicKey};

use super::{EventGraph, EventGraphRejection, VaultEvent};
use crate::event::VaultOperation;
use crate::signing::SigningIdentity;
use crate::{
    EpochCheckpointRequirement, EventError, EventId, EventResult, SecurityRotationTrigger,
};
use nook_replication::CausalQuarantine;

enum EventQuarantineDecision {
    Retain,
    Quarantine(String),
}

impl EventGraph {
    pub(super) fn validate_event_actor_authorized(&self, event: &VaultEvent) -> EventResult<()> {
        if event.body.parents.is_empty() {
            return Ok(());
        }
        if self.is_self_signed_membership_event(event)? {
            return Ok(());
        }
        let authorized = self.authorized_actors_before(event)?;
        if authorized.contains(&event.body.actor_id) {
            Ok(())
        } else {
            Err(EventError::UnauthorizedActor {
                actor_id: event.body.actor_id.as_str().to_owned(),
            })
        }
    }

    pub(super) fn quarantine_rejected_applicable_events(
        mut self,
    ) -> Result<Self, EventGraphRejection> {
        loop {
            let mut changed = false;
            let ids = self.events.keys().cloned().collect::<Vec<_>>();
            for id in ids {
                match self.classify_event_quarantine(&id) {
                    Ok(EventQuarantineDecision::Retain) => {}
                    Ok(EventQuarantineDecision::Quarantine(reason)) => {
                        self.causal = self.causal.quarantine(CausalQuarantine { id, reason });
                        changed = true;
                    }
                    Err(cause) => return Err(EventGraphRejection { graph: self, cause }),
                }
            }
            if !changed {
                return Ok(self);
            }
        }
    }

    fn classify_event_quarantine(&self, id: &EventId) -> EventResult<EventQuarantineDecision> {
        if self.causal.quarantined().contains_key(id) {
            return Ok(EventQuarantineDecision::Retain);
        }
        let event = self
            .events
            .get(id)
            .ok_or_else(|| EventError::MissingEvent {
                event_id: id.as_str().to_owned(),
            })?;
        if !self.event_ancestors_present(event) {
            return Ok(EventQuarantineDecision::Retain);
        }
        if event
            .body
            .parents
            .iter()
            .any(|parent| self.causal.quarantined().contains_key(parent))
        {
            Ok(EventQuarantineDecision::Quarantine(
                "Ancestor event was rejected".to_owned(),
            ))
        } else {
            match self.validate_epoch_checkpoint_structure(event) {
                Err(EventError::InvalidEpochCheckpointStructure { reason }) => {
                    Ok(EventQuarantineDecision::Quarantine(format!(
                        "Invalid security epoch checkpoint: {reason}"
                    )))
                }
                // Only checkpoint structure errors classify an event for quarantine here.
                Ok(()) | Err(_) => self.classify_event_actor_quarantine(event),
            }
        }
    }

    fn classify_event_actor_quarantine(
        &self,
        event: &VaultEvent,
    ) -> EventResult<EventQuarantineDecision> {
        match self.validate_event_actor_authorized(event) {
            Ok(()) => Ok(EventQuarantineDecision::Retain),
            Err(EventError::UnauthorizedActor { actor_id }) => {
                Ok(EventQuarantineDecision::Quarantine(format!(
                    "Event actor {actor_id} was not authorized in causal history"
                )))
            }
            Err(cause) => Err(cause),
        }
    }

    fn event_ancestors_present(&self, event: &VaultEvent) -> bool {
        self.causal.ancestor_ids_present(&event.body.parents)
    }

    pub(super) fn validate_epoch_checkpoint_structure(
        &self,
        event: &VaultEvent,
    ) -> EventResult<()> {
        match event.body.epoch_checkpoint_requirement()? {
            EpochCheckpointRequirement::NotRequired => Ok(()),
            EpochCheckpointRequirement::SecurityRotationParent(parent_id) => {
                let parent =
                    self.events
                        .get(parent_id)
                        .ok_or_else(|| EventError::MissingEvent {
                            event_id: parent_id.as_str().to_owned(),
                        })?;
                match parent.body.security_rotation_trigger() {
                    SecurityRotationTrigger::Other => {
                        Err(EventError::InvalidEpochCheckpointStructure {
                            reason: "checkpoint parent must be one security rotation trigger",
                        })
                    }
                    SecurityRotationTrigger::PasswordRotated
                    | SecurityRotationTrigger::PasswordRemoved
                    | SecurityRotationTrigger::DeviceRevoked => Ok(()),
                }
            }
        }
    }

    fn authorized_actors_before(&self, event: &VaultEvent) -> EventResult<BTreeSet<AuthKeyId>> {
        let mut authorized = BTreeSet::new();
        let mut actor_by_device = BTreeMap::new();
        let mut revoked_devices = BTreeSet::new();
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
                        device_id,
                        signing_public_key,
                        ..
                    }
                    | VaultOperation::SentinelParticipantEnrolled {
                        device_id,
                        signing_public_key,
                        ..
                    } if !signing_public_key.is_empty() => {
                        let actor = SigningIdentity::actor_id_for_public_key_hex(
                            signing_public_key.as_str(),
                        )?;
                        actor_by_device.insert(device_id.clone(), actor.clone());
                        authorized.insert(actor);
                    }
                    VaultOperation::DeviceRevoked { device_id } => {
                        revoked_devices.insert(device_id.clone());
                    }
                    _ => {}
                }
            }
            stack.extend(parent_event.body.parents.iter().cloned());
        }

        for device_id in revoked_devices {
            if let Some(actor) = actor_by_device.get(&device_id) {
                authorized.remove(actor);
            }
        }
        Ok(authorized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{
        EncryptedSecretPayload, GenesisImportPayload, SentinelShareIssuedPayload, VaultEvent,
        VaultEventBody, VaultEventSchemaVersion, VaultOperation,
    };
    use crate::test_support::{actor, epoch, public_key, signing_key, store};
    use crate::{EventId, EventInsertStatus, EventResult, GenesisImportRequest};
    use ed25519_dalek::SigningKey;
    use nook_auth2::{
        AgeArmoredCiphertext, DeviceId, DevicePublicKey, IsoTimestamp, MemberLabel,
        OpaqueCiphertext, SecretId, Sha256Hex,
    };

    pub(super) const STORE_STR: &str = "store_testtoken11";

    pub(super) fn genesis_source_hash() -> Sha256Hex {
        Sha256Hex::from_trusted("deadbeef".repeat(8))
    }

    pub(super) fn signed_child(
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
                secret: EncryptedSecretPayload {
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

    pub(super) fn genesis_event(signing_key: &SigningKey) -> EventResult<VaultEvent> {
        VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &store()?,
            actor_id: &actor(signing_key)?,
            key_epoch: &epoch()?,
            payload: GenesisImportPayload {
                source_content_hash: genesis_source_hash(),
                secrets: vec![],
                password_entries: vec![],
            },
            created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            signing_key: signing_key,
        })
    }

    pub(super) fn signed_operation(
        parents: Vec<EventId>,
        operation: VaultOperation,
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
            operations: vec![operation],
        };
        VaultEvent::sign(body, signing_key)
    }

    pub(super) fn graph_with_genesis(
        signing_key: &SigningKey,
    ) -> EventResult<(EventGraph, EventId)> {
        let mut graph = EventGraph::new();
        let genesis = genesis_event(signing_key)?;
        let genesis_id = genesis.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: genesis,
            expected_store_id: STORE_STR,
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
        Ok((graph, genesis_id))
    }

    pub(super) fn join_approval(
        signing_key: &SigningKey,
        device_id: &str,
        encryption_public_key: &str,
        label: &str,
    ) -> EventResult<VaultOperation> {
        Ok(VaultOperation::JoinApproved {
            device_id: DeviceId::parse(device_id)?,
            encryption_public_key: DevicePublicKey::from_trusted(encryption_public_key.to_owned()),
            signing_public_key: public_key(signing_key),
            label: MemberLabel::from_trusted(label.to_owned()),
            secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted("secret-key".to_owned()),
            members_key_ciphertext: AgeArmoredCiphertext::from_trusted("members-key".to_owned()),
        })
    }

    pub(super) fn assert_self_approval_quarantined(
        mut graph: EventGraph,
        parent: EventId,
        stranger_key: &SigningKey,
        encryption_public_key: &str,
    ) -> EventResult<EventGraph> {
        let event = signed_operation(
            vec![parent],
            join_approval(
                stranger_key,
                "fedcba9876543210",
                encryption_public_key,
                "laptop",
            )?,
            stranger_key,
        )?;
        let event_id = event.id()?;
        assert!(matches!(
            match graph.insert(crate::EventGraphInsert {
                event: event,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Quarantined(_)
        ));
        assert!(graph.quarantined().contains_key(&event_id));
        Ok(graph)
    }

    #[test]
    fn unauthorized_pending_event_is_quarantined_when_parent_arrives() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;

        let child = signed_child(
            vec![genesis_id.clone()],
            "secret_badpending1",
            &stranger_key,
        )?;
        let child_id = child.id()?;

        let mut graph = EventGraph::new();
        assert!(matches!(
            match graph.insert(crate::EventGraphInsert {
                event: child,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Pending(_)
        ));
        assert_eq!(graph.pending_events().len(), 1);

        assert_eq!(
            match graph.insert(crate::EventGraphInsert {
                event: genesis,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Applied
        );
        assert!(graph.pending_events().is_empty());
        assert!(graph.quarantined().contains_key(&child_id));
        assert_eq!(graph.topological_order()?, vec![genesis_id]);
        Ok(())
    }

    #[test]
    fn unapproved_actor_child_is_rejected() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: genesis,
            expected_store_id: STORE_STR,
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

        let stranger_event = signed_child(vec![genesis_id], "secret_unauth0001", &stranger_key)?;
        let stranger_id = stranger_event.id()?;
        assert!(matches!(
            match graph.insert(crate::EventGraphInsert {
                event: stranger_event,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Quarantined(_)
        ));
        assert!(graph.quarantined().contains_key(&stranger_id));
        Ok(())
    }

    #[test]
    fn self_signed_join_request_is_allowed_before_approval() -> EventResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: genesis,
            expected_store_id: STORE_STR,
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

        let join = signed_operation(
            vec![genesis_id],
            VaultOperation::JoinRequested {
                device_id: DeviceId::parse("0123456789abcdef")?,
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("phone".to_owned()),
            },
            &joiner_key,
        )?;
        assert_eq!(
            match graph.insert(crate::EventGraphInsert {
                event: join,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Applied
        );
        Ok(())
    }

    #[test]
    fn self_signed_password_join_approval_is_allowed() -> EventResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let (mut graph, genesis_id) = graph_with_genesis(&root_key)?;

        let enrol = signed_operation(
            vec![genesis_id],
            join_approval(&joiner_key, "0123456789abcdef", "age-pub", "phone")?,
            &joiner_key,
        )?;
        let enrol_id = enrol.id()?;
        assert_eq!(
            match graph.insert(crate::EventGraphInsert {
                event: enrol,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Applied
        );

        let child = signed_child(vec![enrol_id], "secret_joiner0001", &joiner_key)?;
        assert_eq!(
            match graph.insert(crate::EventGraphInsert {
                event: child,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Applied
        );
        Ok(())
    }

    #[test]
    fn join_approval_authorizes_future_joiner_events() -> EventResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let (mut graph, genesis_id) = graph_with_genesis(&root_key)?;

        let approval = signed_operation(
            vec![genesis_id],
            join_approval(&joiner_key, "0123456789abcdef", "age-pub", "phone")?,
            &root_key,
        )?;
        let approval_id = approval.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: approval,
            expected_store_id: STORE_STR,
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

        let child = signed_child(vec![approval_id], "secret_joiner0001", &joiner_key)?;
        assert_eq!(
            match graph.insert(crate::EventGraphInsert {
                event: child,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Applied
        );
        Ok(())
    }

    #[test]
    fn revoked_actor_cannot_append_after_observing_revocation() -> EventResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let device_id = DeviceId::parse("0123456789abcdef")?;
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: genesis,
            expected_store_id: STORE_STR,
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

        let approval = signed_operation(
            vec![genesis_id],
            VaultOperation::JoinApproved {
                device_id: device_id.clone(),
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("phone".to_owned()),
                secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted("secret-key".to_owned()),
                members_key_ciphertext: AgeArmoredCiphertext::from_trusted(
                    "members-key".to_owned(),
                ),
            },
            &root_key,
        )?;
        let approval_id = approval.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: approval,
            expected_store_id: STORE_STR,
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

        let revoke = signed_operation(
            vec![approval_id],
            VaultOperation::DeviceRevoked { device_id },
            &root_key,
        )?;
        let revoke_id = revoke.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: revoke,
            expected_store_id: STORE_STR,
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

        let child = signed_child(vec![revoke_id], "secret_revoked0001", &joiner_key)?;
        assert!(matches!(
            match graph.insert(crate::EventGraphInsert {
                event: child,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Quarantined(_)
        ));
        Ok(())
    }

    #[test]
    fn owner_signed_sentinel_participant_enrolled_is_allowed() -> EventResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: genesis,
            expected_store_id: STORE_STR,
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

        let enrol = signed_operation(
            vec![genesis_id],
            VaultOperation::SentinelParticipantEnrolled {
                device_id: DeviceId::parse("0123456789abcdef")?,
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("phone".to_owned()),
            },
            &root_key,
        )?;
        let enrol_id = enrol.id()?;
        assert_eq!(
            match graph.insert(crate::EventGraphInsert {
                event: enrol,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Applied
        );

        let child = signed_child(vec![enrol_id], "secret_joiner0001", &joiner_key)?;
        assert_eq!(
            match graph.insert(crate::EventGraphInsert {
                event: child,
                expected_store_id: STORE_STR
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?,
            EventInsertStatus::Applied
        );
        Ok(())
    }
}
