use std::collections::{BTreeMap, BTreeSet};

use nook_auth2::{AuthKeyId, DeviceSigningPublicKey};

use super::{EventGraph, VaultEvent};
use crate::event::{VaultEventSchemaVersion, VaultOperation};
use crate::signing::SigningIdentity;
use crate::{EventError, EventResult};

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
            return Ok(());
        }
        Err(EventError::UnauthorizedActor {
            actor_id: event.body.actor_id.as_str().to_owned(),
        })
    }

    pub(super) fn quarantine_rejected_applicable_events(&mut self) -> EventResult<()> {
        loop {
            let mut changed = false;
            let ids = self.events.keys().cloned().collect::<Vec<_>>();
            for id in ids {
                if self.causal.quarantined().contains_key(&id) {
                    continue;
                }
                let event = self
                    .events
                    .get(&id)
                    .ok_or_else(|| EventError::MissingEvent {
                        event_id: id.as_str().to_owned(),
                    })?;
                if !self.event_ancestors_present(event) {
                    continue;
                }
                let reason = if event
                    .body
                    .parents
                    .iter()
                    .any(|parent| self.causal.quarantined().contains_key(parent))
                {
                    Some("Ancestor event was rejected".to_owned())
                } else if let Err(EventError::InvalidEpochCheckpointStructure { reason }) =
                    self.validate_epoch_checkpoint_structure(event)
                {
                    Some(format!("Invalid security epoch checkpoint: {reason}"))
                } else {
                    match self.validate_event_actor_authorized(event) {
                        Ok(()) => None,
                        Err(EventError::UnauthorizedActor { actor_id }) => Some(format!(
                            "Event actor {actor_id} was not authorized in causal history"
                        )),
                        Err(err) => return Err(err),
                    }
                };
                if let Some(reason) = reason {
                    self.causal.quarantine(id, reason);
                    changed = true;
                }
            }
            if !changed {
                return Ok(());
            }
        }
    }

    fn event_ancestors_present(&self, event: &VaultEvent) -> bool {
        self.causal.ancestor_ids_present(&event.body.parents)
    }

    pub(super) fn validate_epoch_checkpoint_structure(
        &self,
        event: &VaultEvent,
    ) -> EventResult<()> {
        let checkpoints = event
            .body
            .operations
            .iter()
            .filter(|operation| matches!(operation, VaultOperation::EpochCheckpoint { .. }))
            .count();
        if checkpoints == 0 || event.body.schema_version < VaultEventSchemaVersion::V3 {
            return Ok(());
        }
        if checkpoints != 1 || event.body.operations.len() != 1 {
            return Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint must be the event's sole operation",
            });
        }
        let [parent_id] = event.body.parents.as_slice() else {
            return Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint must have exactly one direct parent",
            });
        };
        if event.body.key_epoch != *parent_id {
            return Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint key epoch must equal its direct parent id",
            });
        }
        let parent = self
            .events
            .get(parent_id)
            .ok_or_else(|| EventError::MissingEvent {
                event_id: parent_id.as_str().to_owned(),
            })?;
        let is_security_trigger = matches!(
            parent.body.operations.as_slice(),
            [VaultOperation::PasswordRotated { .. }
                | VaultOperation::PasswordRemoved { .. }
                | VaultOperation::DeviceRevoked { .. }]
        );
        if !is_security_trigger {
            return Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint parent must be one security rotation trigger",
            });
        }
        Ok(())
    }

    /// Allow an unauthorized actor to publish its own membership event when the
    /// operation's signing key matches the event actor.
    ///
    /// Policy:
    /// - `JoinRequested` — always allowed when self-signed (pending join).
    /// - `JoinApproved` — allowed only for simple password self-enrol, i.e. when
    ///   causal ancestry has no sentinel membership/share ops.
    /// - `SentinelParticipantEnrolled` — never self-signed; must be authorized.
    fn is_self_signed_membership_event(&self, event: &VaultEvent) -> EventResult<bool> {
        if event.body.operations.is_empty() {
            return Ok(false);
        }
        let mut allows_join_requested = false;
        let mut allows_join_approved = false;
        for operation in &event.body.operations {
            match operation {
                VaultOperation::JoinRequested {
                    signing_public_key, ..
                } => {
                    if !Self::operation_is_self_signed(event, signing_public_key)? {
                        return Ok(false);
                    }
                    allows_join_requested = true;
                }
                VaultOperation::JoinApproved {
                    signing_public_key, ..
                } => {
                    if !Self::operation_is_self_signed(event, signing_public_key)? {
                        return Ok(false);
                    }
                    allows_join_approved = true;
                }
                VaultOperation::SentinelParticipantEnrolled { .. } => {
                    // Sentinel enrolment must be signed by an already-authorized actor.
                    return Ok(false);
                }
                _ => return Ok(false),
            }
        }
        if allows_join_approved && self.ancestry_has_sentinel_membership_ops(event) {
            return Ok(false);
        }
        Ok(allows_join_requested || allows_join_approved)
    }

    fn operation_is_self_signed(
        event: &VaultEvent,
        signing_public_key: &DeviceSigningPublicKey,
    ) -> EventResult<bool> {
        if signing_public_key.is_empty() {
            return Ok(false);
        }
        if &event.body.actor_signing_public_key != signing_public_key {
            return Ok(false);
        }
        let request_actor =
            SigningIdentity::actor_id_for_public_key_hex(signing_public_key.as_str())?;
        Ok(request_actor == event.body.actor_id)
    }

    /// True when causal ancestry contains sentinel roster/share operations that
    /// disqualify simple password self-enrol via `JoinApproved`.
    fn ancestry_has_sentinel_membership_ops(&self, event: &VaultEvent) -> bool {
        let mut visited = BTreeSet::new();
        let mut stack = event.body.parents.clone();
        while let Some(id) = stack.pop() {
            if !visited.insert(id.clone()) {
                continue;
            }
            let Some(parent) = self.events.get(&id) else {
                continue;
            };
            if parent.body.operations.iter().any(|operation| {
                matches!(
                    operation,
                    VaultOperation::SentinelParticipantEnrolled { .. }
                        | VaultOperation::SentinelSharesIssued { .. }
                )
            }) {
                return true;
            }
            stack.extend(parent.body.parents.iter().cloned());
        }
        false
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
        VaultEventBody, VaultEventSchemaVersion, VaultOperation, build_genesis_import_event,
    };
    use crate::test_support::{actor, epoch, public_key, signing_key, store};
    use crate::{EventId, EventInsertStatus, EventResult};
    use ed25519_dalek::SigningKey;
    use nook_auth2::{
        AgeArmoredCiphertext, DeviceId, DevicePublicKey, IsoTimestamp, MemberLabel,
        OpaqueCiphertext, SecretId, Sha256Hex,
    };

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

    fn signed_operation(
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

    fn graph_with_genesis(signing_key: &SigningKey) -> EventResult<(EventGraph, EventId)> {
        let mut graph = EventGraph::new();
        let genesis = genesis_event(signing_key)?;
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;
        Ok((graph, genesis_id))
    }

    fn join_approval(
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

    fn assert_self_approval_quarantined(
        graph: &mut EventGraph,
        parent: EventId,
        stranger_key: &SigningKey,
        encryption_public_key: &str,
    ) -> EventResult<()> {
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
            graph.insert(event, STORE_STR)?,
            EventInsertStatus::Quarantined(_)
        ));
        assert!(graph.quarantined().contains_key(&event_id));
        Ok(())
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
    fn unapproved_actor_child_is_rejected() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

        let stranger_event = signed_child(vec![genesis_id], "secret_unauth0001", &stranger_key)?;
        let stranger_id = stranger_event.id()?;
        assert!(matches!(
            graph.insert(stranger_event, STORE_STR)?,
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
        graph.insert(genesis, STORE_STR)?;

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
        assert_eq!(graph.insert(join, STORE_STR)?, EventInsertStatus::Applied);
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
        assert_eq!(graph.insert(enrol, STORE_STR)?, EventInsertStatus::Applied);

        let child = signed_child(vec![enrol_id], "secret_joiner0001", &joiner_key)?;
        assert_eq!(graph.insert(child, STORE_STR)?, EventInsertStatus::Applied);
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
        graph.insert(approval, STORE_STR)?;

        let child = signed_child(vec![approval_id], "secret_joiner0001", &joiner_key)?;
        assert_eq!(graph.insert(child, STORE_STR)?, EventInsertStatus::Applied);
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
        graph.insert(genesis, STORE_STR)?;

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
        graph.insert(approval, STORE_STR)?;

        let revoke = signed_operation(
            vec![approval_id],
            VaultOperation::DeviceRevoked { device_id },
            &root_key,
        )?;
        let revoke_id = revoke.id()?;
        graph.insert(revoke, STORE_STR)?;

        let child = signed_child(vec![revoke_id], "secret_revoked0001", &joiner_key)?;
        assert!(matches!(
            graph.insert(child, STORE_STR)?,
            EventInsertStatus::Quarantined(_)
        ));
        Ok(())
    }

    #[test]
    fn self_signed_sentinel_participant_enrolled_is_quarantined() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

        let enrol = signed_operation(
            vec![genesis_id],
            VaultOperation::SentinelParticipantEnrolled {
                device_id: DeviceId::parse("0123456789abcdef")?,
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&stranger_key),
                label: MemberLabel::from_trusted("phone".to_owned()),
            },
            &stranger_key,
        )?;
        let enrol_id = enrol.id()?;
        assert!(matches!(
            graph.insert(enrol, STORE_STR)?,
            EventInsertStatus::Quarantined(_)
        ));
        assert!(graph.quarantined().contains_key(&enrol_id));
        Ok(())
    }

    #[test]
    fn owner_signed_sentinel_participant_enrolled_is_allowed() -> EventResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

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
        assert_eq!(graph.insert(enrol, STORE_STR)?, EventInsertStatus::Applied);

        let child = signed_child(vec![enrol_id], "secret_joiner0001", &joiner_key)?;
        assert_eq!(graph.insert(child, STORE_STR)?, EventInsertStatus::Applied);
        Ok(())
    }

    #[test]
    fn self_signed_join_approved_after_sentinel_enrol_is_quarantined() -> EventResult<()> {
        let root_key = signing_key();
        let joiner_key = signing_key();
        let stranger_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

        let sentinel_enrol = signed_operation(
            vec![genesis_id],
            VaultOperation::SentinelParticipantEnrolled {
                device_id: DeviceId::parse("0123456789abcdef")?,
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&joiner_key),
                label: MemberLabel::from_trusted("phone".to_owned()),
            },
            &root_key,
        )?;
        let sentinel_enrol_id = sentinel_enrol.id()?;
        graph.insert(sentinel_enrol, STORE_STR)?;

        assert_self_approval_quarantined(
            &mut graph,
            sentinel_enrol_id,
            &stranger_key,
            "age-pub-2",
        )?;
        Ok(())
    }

    #[test]
    fn self_signed_join_approved_after_sentinel_shares_is_quarantined() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let mut graph = EventGraph::new();
        let genesis = genesis_event(&root_key)?;
        let genesis_id = genesis.id()?;
        graph.insert(genesis, STORE_STR)?;

        let shares = signed_operation(
            vec![genesis_id],
            VaultOperation::SentinelSharesIssued {
                shares: vec![SentinelShareIssuedPayload {
                    device_id: DeviceId::parse("0123456789abcdef")?,
                    version: crate::SentinelShareVersion::LEGACY,
                    threshold: 2,
                    required_participants: 2,
                    share_index: 1,
                    ciphertext: AgeArmoredCiphertext::from_trusted("share-ct".to_owned()),
                }],
            },
            &root_key,
        )?;
        let shares_id = shares.id()?;
        graph.insert(shares, STORE_STR)?;

        assert_self_approval_quarantined(&mut graph, shares_id, &stranger_key, "age-pub")?;
        Ok(())
    }

    #[test]
    fn self_signed_join_approved_after_sentinel_genesis_root_is_quarantined() -> EventResult<()> {
        let root_key = signing_key();
        let stranger_key = signing_key();
        let mut graph = EventGraph::new();

        // Sentinel-style root: genesis import that also records the owner's
        // SentinelParticipantEnrolled in the same empty-parent event (allowed via
        // parents.is_empty() short-circuit on actor auth).
        let mut sentinel_genesis = genesis_event(&root_key)?;
        sentinel_genesis
            .body
            .operations
            .push(VaultOperation::SentinelParticipantEnrolled {
                device_id: DeviceId::parse("0123456789abcdef")?,
                encryption_public_key: DevicePublicKey::from_trusted("age-pub".to_owned()),
                signing_public_key: public_key(&root_key),
                label: MemberLabel::from_trusted("owner".to_owned()),
            });
        sentinel_genesis = VaultEvent::sign(sentinel_genesis.body, &root_key)?;
        let sentinel_genesis_id = sentinel_genesis.id()?;
        assert_eq!(
            graph.insert(sentinel_genesis, STORE_STR)?,
            EventInsertStatus::Applied
        );

        assert_self_approval_quarantined(
            &mut graph,
            sentinel_genesis_id,
            &stranger_key,
            "age-pub-2",
        )?;
        Ok(())
    }
}
