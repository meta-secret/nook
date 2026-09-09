//! Membership self-enrollment authorization policy.
use super::*;
impl EventGraph {
    /// Allow an unauthorized actor to publish its own membership event when the
    /// operation's signing key matches the event actor.
    ///
    /// Policy:
    /// - `JoinRequested` — always allowed when self-signed (pending join).
    /// - `JoinApproved` — allowed only for simple password self-enrol, i.e. when
    ///   causal ancestry has no sentinel membership/share ops.
    /// - `SentinelParticipantEnrolled` — never self-signed; must be authorized.
    pub(super) fn is_self_signed_membership_event(&self, event: &VaultEvent) -> EventResult<bool> {
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
        if allows_join_approved && self.ancestry_has_sentinel_architecture_evidence(event) {
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
    /// True when causal ancestry proves Sentinel architecture and therefore
    /// disqualifies simple password self-enrol via `JoinApproved`.
    fn ancestry_has_sentinel_architecture_evidence(&self, event: &VaultEvent) -> bool {
        let mut visited = BTreeSet::new();
        let mut stack = event.body.parents.clone();
        while let Some(id) = stack.pop() {
            if !visited.insert(id.clone()) {
                continue;
            }
            let Some(parent) = self.events.get(&id) else {
                continue;
            };
            if parent
                .body
                .operations
                .iter()
                .any(VaultOperation::is_sentinel_architecture_evidence)
            {
                return true;
            }
            stack.extend(parent.body.parents.iter().cloned());
        }
        false
    }
}
#[cfg(test)]
mod tests {
    use super::super::tests::{
        STORE_STR, assert_self_approval_quarantined, genesis_event, signed_operation,
    };
    use super::*;
    use crate::event::SentinelShareIssuedPayload;
    use crate::test_support::{public_key, signing_key};
    use crate::{EventInsertStatus, EventResult};
    use nook_auth2::{AgeArmoredCiphertext, DeviceId, DevicePublicKey, MemberLabel};
    #[test]
    fn self_signed_sentinel_participant_enrolled_is_quarantined() -> EventResult<()> {
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
            EventInsertStatus::Quarantined(_)
        ));
        assert!(graph.quarantined().contains_key(&enrol_id));
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
        match graph.insert(crate::EventGraphInsert {
            event: sentinel_enrol,
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

        {
            graph = assert_self_approval_quarantined(
                graph,
                sentinel_enrol_id,
                &stranger_key,
                "age-pub-2",
            )?;
        };
        Ok(())
    }
    #[test]
    fn self_signed_join_approved_after_sentinel_shares_is_quarantined() -> EventResult<()> {
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

        let shares = signed_operation(
            vec![genesis_id],
            VaultOperation::SentinelSharesIssued {
                shares: vec![SentinelShareIssuedPayload {
                    device_id: DeviceId::parse("0123456789abcdef")?,
                    version: crate::SentinelShareVersion::LEGACY,
                    threshold: 2.into(),
                    required_participants: 2.into(),
                    share_index: 1.into(),
                    ciphertext: AgeArmoredCiphertext::from_trusted("share-ct".to_owned()),
                }],
            },
            &root_key,
        )?;
        let shares_id = shares.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: shares,
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

        {
            graph = assert_self_approval_quarantined(graph, shares_id, &stranger_key, "age-pub")?;
        };
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
            match graph.insert(crate::EventGraphInsert {
                event: sentinel_genesis,
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

        {
            graph = assert_self_approval_quarantined(
                graph,
                sentinel_genesis_id,
                &stranger_key,
                "age-pub-2",
            )?;
        };
        Ok(())
    }
}
