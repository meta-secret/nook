//! Causal identity control graph with actor authorization.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::{BTreeMap, BTreeSet};

use nook_auth2::{AppId, AuthKeyId, IdentityId};
use nook_replication::{CausalEventInsertion, CausalGraph, CausalInsertStatus, CausalQuarantine};

use super::wire::{IdentityControlOperation, IdentityEvent};
use crate::{EventError, EventId, EventResult, EventStorageBytes};

/// Outcome of inserting one identity control event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityEventInsertStatus {
    Applied,
    Pending { missing_parents: Vec<EventId> },
    Quarantined { reason: String },
    Duplicate,
}

/// Validated, causally indexed identity control events for one identity.
#[derive(Debug, Clone)]
pub struct IdentityControlLog {
    identity_id: IdentityId,
    events: BTreeMap<EventId, IdentityEvent>,
    causal: CausalGraph<EventId>,
}

/// A rejected insertion returns the unchanged log with its cause.
#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub struct IdentityControlRejection {
    pub log: Box<IdentityControlLog>,
    #[source]
    pub cause: EventError,
}

/// Result of inserting one event: the updated log and its status.
#[derive(Debug)]
pub struct IdentityControlInsertion {
    pub log: IdentityControlLog,
    pub status: IdentityEventInsertStatus,
}

/// Membership-changing operations observed in one causal past.
struct MembershipHistory {
    approvals: Vec<(EventId, AppId, AuthKeyId)>,
    revocations: Vec<(EventId, AppId)>,
}

impl IdentityControlLog {
    #[must_use]
    pub fn new(identity_id: IdentityId) -> Self {
        Self {
            identity_id,
            events: BTreeMap::new(),
            causal: CausalGraph::new(),
        }
    }

    #[must_use]
    pub fn identity_id(&self) -> &IdentityId {
        &self.identity_id
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
    pub fn event(&self, id: &EventId) -> Option<&IdentityEvent> {
        self.events.get(id)
    }

    #[must_use]
    pub fn quarantined(&self) -> &BTreeMap<EventId, String> {
        self.causal.quarantined()
    }

    /// Every stored event id, including pending and quarantined events, so a
    /// provider union never loses bytes another replica may still resolve.
    #[must_use]
    pub fn event_ids(&self) -> Vec<EventId> {
        self.events.keys().cloned().collect()
    }

    /// Insert one event after envelope validation; unauthorized actors are
    /// quarantined together with their causal descendants.
    pub fn insert(
        self,
        event: IdentityEvent,
    ) -> Result<IdentityControlInsertion, IdentityControlRejection> {
        let id = match event.validate_envelope(&self.identity_id) {
            Ok(id) => id,
            Err(cause) => {
                return Err(IdentityControlRejection {
                    log: Box::new(self),
                    cause,
                });
            }
        };
        if self.events.contains_key(&id) {
            return Ok(IdentityControlInsertion {
                log: self,
                status: IdentityEventInsertStatus::Duplicate,
            });
        }
        if event.body.is_genesis() && self.genesis_id().is_some() {
            return Err(IdentityControlRejection {
                log: Box::new(self),
                cause: EventError::MultipleGenesisRoots,
            });
        }
        let Self {
            identity_id,
            mut events,
            causal,
        } = self;
        let insertion = causal.insert(CausalEventInsertion {
            id: id.clone(),
            parents: event.body.parents.clone(),
        });
        events.insert(id.clone(), event);
        let log = Self {
            identity_id,
            events,
            causal: insertion.graph,
        }
        .quarantine_unauthorized();
        let status = match (log.causal.quarantined().get(&id), insertion.status) {
            (Some(reason), _) => IdentityEventInsertStatus::Quarantined {
                reason: reason.clone(),
            },
            (None, CausalInsertStatus::Pending { missing_parents }) => {
                IdentityEventInsertStatus::Pending { missing_parents }
            }
            (None, CausalInsertStatus::Quarantined { reason }) => {
                IdentityEventInsertStatus::Quarantined { reason }
            }
            (None, CausalInsertStatus::Duplicate | CausalInsertStatus::Conflict) => {
                IdentityEventInsertStatus::Duplicate
            }
            (None, CausalInsertStatus::Applied) => IdentityEventInsertStatus::Applied,
        };
        Ok(IdentityControlInsertion { log, status })
    }

    /// Union stored or remote event bytes into the log.
    pub fn union_storage_bytes(
        self,
        batch: &[EventStorageBytes],
    ) -> Result<Self, IdentityControlRejection> {
        let mut log = self;
        for bytes in batch {
            let event = match IdentityEvent::parse_storage_bytes(bytes) {
                Ok(event) => event,
                Err(cause) => {
                    return Err(IdentityControlRejection {
                        log: Box::new(log),
                        cause,
                    });
                }
            };
            log = log.insert(event)?.log;
        }
        Ok(log)
    }

    #[must_use]
    pub fn genesis_id(&self) -> Option<&EventId> {
        self.events
            .iter()
            .find(|(_, event)| event.body.is_genesis())
            .map(|(id, _)| id)
    }

    /// Heads of the applicable (authorized, fully resolved) graph.
    #[must_use]
    pub fn applicable_heads(&self) -> Vec<EventId> {
        let applicable = self
            .causal
            .applicable_ids()
            .into_iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let referenced = applicable
            .iter()
            .filter_map(|id| self.events.get(id))
            .flat_map(|event| event.body.parents.iter().cloned())
            .collect::<BTreeSet<_>>();
        applicable
            .into_iter()
            .filter(|id| !referenced.contains(id))
            .collect()
    }

    /// Applicable events in deterministic causal order.
    pub fn ordered_applicable_events(&self) -> EventResult<Vec<(&EventId, &IdentityEvent)>> {
        let order = self
            .causal
            .topological_order()
            .map_err(|_| EventError::GraphCycle)?;
        order
            .iter()
            .map(|id| {
                self.events
                    .get_key_value(id)
                    .ok_or_else(|| EventError::MissingEvent {
                        event_id: id.as_str().to_owned(),
                    })
            })
            .collect()
    }

    #[must_use]
    pub fn is_ancestor(&self, ancestor: &EventId, descendant: &EventId) -> bool {
        self.causal.is_ancestor(ancestor, descendant)
    }

    fn ancestry(&self, parents: &[EventId]) -> BTreeSet<EventId> {
        let mut visited = BTreeSet::new();
        let mut stack = parents.to_vec();
        while let Some(id) = stack.pop() {
            if !visited.insert(id.clone()) {
                continue;
            }
            if let Some(event) = self.events.get(&id) {
                stack.extend(event.body.parents.iter().cloned());
            }
        }
        visited
    }

    fn membership_history(&self, events: &BTreeSet<EventId>) -> EventResult<MembershipHistory> {
        let mut approvals = Vec::new();
        let mut revocations = Vec::new();
        for id in events {
            let Some(event) = self.events.get(id) else {
                continue;
            };
            for operation in &event.body.operations {
                match operation {
                    IdentityControlOperation::IdentityCreated { founder, .. } => {
                        approvals.push((
                            id.clone(),
                            founder.app_id.clone(),
                            founder.signing_actor()?,
                        ));
                    }
                    IdentityControlOperation::MemberApproved { member, .. } => {
                        approvals.push((
                            id.clone(),
                            member.app_id.clone(),
                            member.signing_actor()?,
                        ));
                    }
                    IdentityControlOperation::MemberRevoked { app_id } => {
                        revocations.push((id.clone(), app_id.clone()));
                    }
                    _ => {}
                }
            }
        }
        Ok(MembershipHistory {
            approvals,
            revocations,
        })
    }

    /// Members whose latest approval in `events` causally follows every
    /// revocation of the same app. A concurrent revocation wins.
    pub(super) fn effective_members(
        &self,
        events: &BTreeSet<EventId>,
    ) -> EventResult<BTreeMap<AppId, BTreeSet<AuthKeyId>>> {
        let history = self.membership_history(events)?;
        let mut members: BTreeMap<AppId, BTreeSet<AuthKeyId>> = BTreeMap::new();
        for (approval, app_id, actor) in history.approvals {
            let survives = history
                .revocations
                .iter()
                .filter(|(_, revoked)| *revoked == app_id)
                .all(|(revocation, _)| self.causal.is_ancestor(revocation, &approval));
            if survives {
                members.entry(app_id).or_default().insert(actor);
            }
        }
        Ok(members)
    }

    fn authorized_actors_before(&self, event: &IdentityEvent) -> EventResult<BTreeSet<AuthKeyId>> {
        let ancestry = self.ancestry(&event.body.parents);
        Ok(self
            .effective_members(&ancestry)?
            .into_values()
            .flatten()
            .collect())
    }

    fn unauthorized_reason(&self, id: &EventId) -> EventResult<Option<String>> {
        let Some(event) = self.events.get(id) else {
            return Ok(None);
        };
        if event.body.is_genesis() || event.is_self_signed_join_request() {
            return Ok(None);
        }
        if self
            .authorized_actors_before(event)?
            .contains(&event.body.actor_id)
        {
            Ok(None)
        } else {
            Ok(Some(format!(
                "Identity actor {} was not an identity member in causal history",
                event.body.actor_id
            )))
        }
    }

    fn quarantine_unauthorized(mut self) -> Self {
        loop {
            let candidates = self
                .causal
                .applicable_ids()
                .into_iter()
                .cloned()
                .collect::<Vec<_>>();
            let mut changed = false;
            for id in candidates {
                let reason = match self.unauthorized_reason(&id) {
                    Ok(Some(reason)) => reason,
                    Ok(None) => continue,
                    Err(error) => error.to_string(),
                };
                self.causal = self.causal.quarantine(CausalQuarantine { id, reason });
                changed = true;
            }
            if !changed {
                return self;
            }
        }
    }

    /// Stored bytes for every event, for provider unions.
    pub fn storage_bytes(&self) -> EventResult<Vec<(EventId, EventStorageBytes)>> {
        self.events
            .iter()
            .map(|(id, event)| Ok((id.clone(), event.serialize_storage_yaml()?)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use crate::identity_control::test_fixtures::*;

    #[test]
    fn outsiders_can_only_request_to_join() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let outsider = Installation::new()?;
        let (_, status) = fixture.append(
            &outsider,
            vec![rename(fixture.founder.app.app_id(), "Taken over")],
        )?;
        assert!(matches!(
            status,
            IdentityEventInsertStatus::Quarantined { .. }
        ));
        assert_eq!(
            member_label(&fixture.state()?, fixture.founder.app.app_id()),
            "Laptop"
        );

        // A join request must be signed by the member it names.
        let impersonated = fixture.log.build_append(
            vec![IdentityControlOperation::MemberJoinRequested {
                member: Installation::new()?.keys("Someone else"),
            }],
            &outsider.signing(&fixture.at),
        )?;
        assert!(fixture.log.clone().insert(impersonated).is_err());

        // An outsider cannot approve itself.
        let self_approval = fixture.log.build_append(
            vec![IdentityControlOperation::MemberApproved {
                member: outsider.keys("Intruder"),
                vault_deks: Vec::new(),
            }],
            &outsider.signing(&fixture.at),
        )?;
        let inserted = fixture.log.clone().insert(self_approval)?;
        assert!(matches!(
            inserted.status,
            IdentityEventInsertStatus::Quarantined { .. }
        ));
        assert_eq!(
            IdentityControlState::project(&inserted.log)?.members.len(),
            1
        );
        Ok(())
    }

    #[test]
    fn concurrent_revocation_wins_over_concurrent_reapproval() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let second = Installation::new()?;
        fixture.request_join(&second)?;
        let approval = fixture
            .state()?
            .approval_operation(&IdentityApprovalRequest {
                app_id: second.app.app_id(),
                vaults: &[],
            })?;
        let founder = fixture.founder();
        fixture.append(&founder, vec![approval])?;

        // Two members act concurrently from the same heads.
        let base = fixture.log.clone();
        let revoke = base.build_append(
            vec![IdentityControlOperation::MemberRevoked {
                app_id: second.app.app_id().clone(),
            }],
            &founder.signing(&fixture.at),
        )?;
        let reapprove = base.build_append(
            vec![IdentityControlOperation::MemberApproved {
                member: second.keys("Phone"),
                vault_deks: Vec::new(),
            }],
            &second.signing(&fixture.at),
        )?;
        let one_order = base
            .clone()
            .insert(revoke.clone())?
            .log
            .insert(reapprove.clone())?
            .log;
        let other_order = base.insert(reapprove)?.log.insert(revoke)?.log;
        let first = IdentityControlState::project(&one_order)?;
        let second_state = IdentityControlState::project(&other_order)?;
        assert_eq!(first, second_state);
        assert!(first.member(second.app.app_id()).is_none());
        Ok(())
    }
}
