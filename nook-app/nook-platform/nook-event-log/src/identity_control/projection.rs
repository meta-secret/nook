//! Deterministic projection of an identity control log.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::{BTreeMap, BTreeSet};

use nook_auth2::{AppId, IdentityId, IsoTimestamp, StoreId};

use super::graph::IdentityControlLog;
use super::wire::{
    IdentityControlOperation, IdentityMemberKeys, IdentityProviderMount, MemberVaultDek,
    ProviderMountId,
};
use crate::{EventError, EventId, EventResult};

/// An active app-key member of the identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityControlMember {
    pub keys: IdentityMemberKeys,
    pub approved_in: EventId,
}

/// A join request no approval, denial, or revocation has resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityJoinRequest {
    pub member: IdentityMemberKeys,
    pub request_event: EventId,
    pub requested_at: IsoTimestamp,
}

/// DEK envelopes for one vault key epoch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityVaultEpochDeks {
    pub key_epoch: EventId,
    pub recipients: Vec<MemberVaultDek>,
}

/// A vault owned by the identity with its DEK envelopes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityControlVault {
    pub store_id: StoreId,
    pub registered_in: EventId,
    /// Key epoch of the latest registration or rewrap in causal order.
    pub current_key_epoch: EventId,
    pub epochs: Vec<IdentityVaultEpochDeks>,
}

/// Envelope lookup result for one member, vault, and key epoch.
pub enum IdentityVaultDekLookup<'a> {
    Granted(&'a MemberVaultDek),
    NotGranted,
}

impl IdentityControlVault {
    #[must_use]
    pub fn dek_for(&self, app_id: &AppId, key_epoch: &EventId) -> IdentityVaultDekLookup<'_> {
        self.epochs
            .iter()
            .find(|epoch| &epoch.key_epoch == key_epoch)
            .and_then(|epoch| epoch.recipients.iter().find(|dek| &dek.app_id == app_id))
            .map_or(
                IdentityVaultDekLookup::NotGranted,
                IdentityVaultDekLookup::Granted,
            )
    }

    #[must_use]
    pub fn current_dek_for(&self, app_id: &AppId) -> IdentityVaultDekLookup<'_> {
        self.dek_for(app_id, &self.current_key_epoch)
    }
}

/// Replicated identity state derived from the applicable control log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityControlState {
    pub identity_id: IdentityId,
    pub members: Vec<IdentityControlMember>,
    pub revoked: Vec<AppId>,
    pub pending_joins: Vec<IdentityJoinRequest>,
    pub vaults: Vec<IdentityControlVault>,
    /// Vaults deleted from the identity. Each device drops its local copy.
    pub removed_vaults: Vec<StoreId>,
    pub mounts: Vec<IdentityProviderMount>,
    pub heads: Vec<EventId>,
}

#[derive(Default)]
struct VaultAccumulator {
    registered_in: Option<EventId>,
    current_key_epoch: Option<EventId>,
    epochs: BTreeMap<EventId, BTreeMap<AppId, MemberVaultDek>>,
}

#[derive(Default)]
struct ProjectionAccumulator {
    created: bool,
    member_keys: BTreeMap<AppId, (IdentityMemberKeys, EventId)>,
    requests: Vec<IdentityJoinRequest>,
    resolutions: Vec<(EventId, AppId)>,
    vaults: BTreeMap<StoreId, VaultAccumulator>,
    /// Tombstones: removal wins over any grant, in whatever order replicas
    /// apply the same events.
    removed_vaults: BTreeSet<StoreId>,
    mounts: BTreeMap<ProviderMountId, IdentityProviderMount>,
}

#[derive(Clone, Copy)]
struct VaultRecipients<'a> {
    store_id: &'a StoreId,
    key_epoch: &'a EventId,
    recipients: &'a [MemberVaultDek],
}

impl ProjectionAccumulator {
    fn grant(&mut self, request: VaultRecipients<'_>) {
        let vault = self.vaults.entry(request.store_id.clone()).or_default();
        vault.current_key_epoch = Some(request.key_epoch.clone());
        let epoch = vault.epochs.entry(request.key_epoch.clone()).or_default();
        for recipient in request.recipients {
            epoch.insert(recipient.app_id.clone(), recipient.clone());
        }
    }

    fn apply(
        &mut self,
        id: &EventId,
        created_at: &IsoTimestamp,
        operation: &IdentityControlOperation,
    ) {
        match operation {
            IdentityControlOperation::IdentityCreated { founder } => {
                self.created = true;
                self.member_keys
                    .insert(founder.app_id.clone(), (founder.clone(), id.clone()));
            }
            IdentityControlOperation::MemberJoinRequested { member } => {
                self.requests.push(IdentityJoinRequest {
                    member: member.clone(),
                    request_event: id.clone(),
                    requested_at: created_at.clone(),
                });
            }
            IdentityControlOperation::MemberApproved { member, vault_deks } => {
                self.member_keys
                    .insert(member.app_id.clone(), (member.clone(), id.clone()));
                self.resolutions.push((id.clone(), member.app_id.clone()));
                for grant in vault_deks {
                    let vault = self.vaults.entry(grant.store_id.clone()).or_default();
                    vault
                        .epochs
                        .entry(grant.key_epoch.clone())
                        .or_default()
                        .insert(
                            member.app_id.clone(),
                            MemberVaultDek {
                                app_id: member.app_id.clone(),
                                secrets_key_ciphertext: grant.secrets_key_ciphertext.clone(),
                                members_key_ciphertext: grant.members_key_ciphertext.clone(),
                            },
                        );
                }
            }
            IdentityControlOperation::MemberJoinDenied { app_id }
            | IdentityControlOperation::MemberRevoked { app_id } => {
                self.resolutions.push((id.clone(), app_id.clone()));
            }
            IdentityControlOperation::MemberRenamed { app_id, label } => {
                if let Some((keys, _)) = self.member_keys.get_mut(app_id) {
                    keys.label = label.clone();
                }
            }
            IdentityControlOperation::VaultRegistered {
                store_id,
                key_epoch,
                recipients,
            } => {
                self.grant(VaultRecipients {
                    store_id,
                    key_epoch,
                    recipients,
                });
                if let Some(vault) = self.vaults.get_mut(store_id) {
                    vault.registered_in = Some(id.clone());
                }
            }
            IdentityControlOperation::VaultDekGranted {
                store_id,
                key_epoch,
                recipients,
            } => self.grant(VaultRecipients {
                store_id,
                key_epoch,
                recipients,
            }),
            IdentityControlOperation::VaultRemoved { store_id } => {
                self.removed_vaults.insert(store_id.clone());
            }
            IdentityControlOperation::ProviderMounted { mount } => {
                self.mounts.insert(mount.mount_id.clone(), mount.clone());
            }
            IdentityControlOperation::ProviderUnmounted { mount_id } => {
                self.mounts.remove(mount_id);
            }
        }
    }
}

impl IdentityControlState {
    /// Project the applicable events. The result is independent of the order
    /// in which replicas received the same event set.
    pub fn project(log: &IdentityControlLog) -> EventResult<Self> {
        let ordered = log.ordered_applicable_events()?;
        let applicable = ordered
            .iter()
            .map(|(id, _)| (*id).clone())
            .collect::<BTreeSet<_>>();
        let mut accumulator = ProjectionAccumulator::default();
        for (id, event) in &ordered {
            for operation in &event.body.operations {
                accumulator.apply(id, &event.body.created_at, operation);
            }
        }
        if !accumulator.created {
            return Err(EventError::IdentityControlInvalid(
                "identity log has no applicable genesis".to_owned(),
            ));
        }
        let active = log.effective_members(&applicable)?;
        let members = accumulator
            .member_keys
            .iter()
            .filter(|(app_id, _)| active.contains_key(*app_id))
            .map(|(_, (keys, approved_in))| IdentityControlMember {
                keys: keys.clone(),
                approved_in: approved_in.clone(),
            })
            .collect::<Vec<_>>();
        let revoked = accumulator
            .member_keys
            .keys()
            .filter(|app_id| !active.contains_key(*app_id))
            .cloned()
            .collect::<Vec<_>>();
        let pending_joins = accumulator
            .requests
            .iter()
            .filter(|request| {
                !active.contains_key(&request.member.app_id)
                    && !accumulator.resolutions.iter().any(|(resolution, app_id)| {
                        *app_id == request.member.app_id
                            && log.is_ancestor(&request.request_event, resolution)
                    })
            })
            .cloned()
            .collect::<Vec<_>>();
        let removed_vaults = accumulator.removed_vaults;
        let vaults = accumulator
            .vaults
            .into_iter()
            .filter(|(store_id, _)| !removed_vaults.contains(store_id))
            .filter_map(|(store_id, vault)| {
                let registered_in = vault.registered_in?;
                let current_key_epoch = vault.current_key_epoch?;
                let epochs = vault
                    .epochs
                    .into_iter()
                    .map(|(key_epoch, recipients)| IdentityVaultEpochDeks {
                        key_epoch,
                        recipients: recipients
                            .into_values()
                            .filter(|dek| active.contains_key(&dek.app_id))
                            .collect(),
                    })
                    .collect();
                Some(IdentityControlVault {
                    store_id,
                    registered_in,
                    current_key_epoch,
                    epochs,
                })
            })
            .collect();
        Ok(Self {
            identity_id: log.identity_id().clone(),
            members,
            revoked,
            pending_joins,
            vaults,
            removed_vaults: removed_vaults.into_iter().collect(),
            mounts: accumulator.mounts.into_values().collect(),
            heads: log.applicable_heads(),
        })
    }

    #[must_use]
    pub fn member(&self, app_id: &AppId) -> Option<&IdentityControlMember> {
        self.members
            .iter()
            .find(|member| &member.keys.app_id == app_id)
    }

    #[must_use]
    pub fn vault(&self, store_id: &StoreId) -> Option<&IdentityControlVault> {
        self.vaults.iter().find(|vault| &vault.store_id == store_id)
    }

    #[must_use]
    pub fn pending_join(&self, app_id: &AppId) -> Option<&IdentityJoinRequest> {
        self.pending_joins
            .iter()
            .find(|request| &request.member.app_id == app_id)
    }

    /// Active members that hold no envelope for a vault's current key epoch.
    /// Any member holding that DEK can close the gap with a rewrap.
    #[must_use]
    pub fn members_missing_current_dek(&self, store_id: &StoreId) -> Vec<&IdentityControlMember> {
        let Some(vault) = self.vault(store_id) else {
            return Vec::new();
        };
        self.members
            .iter()
            .filter(|member| {
                matches!(
                    vault.current_dek_for(&member.keys.app_id),
                    IdentityVaultDekLookup::NotGranted
                )
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use crate::identity_control::test_fixtures::*;

    #[test]
    fn founder_creates_identity_and_owns_it_alone() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let state = fixture.state()?;
        assert_eq!(member_label(&state, fixture.founder.app.app_id()), "Laptop");
        assert_eq!(state.members.len(), 1);
        assert!(state.member(fixture.founder.app.app_id()).is_some());
        assert!(state.pending_joins.is_empty());
        assert_eq!(state.heads.len(), 1);
        Ok(())
    }

    #[test]
    fn projection_is_independent_of_delivery_order_and_resolves_pending_parents()
    -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let store_id = StoreId::generate()?;
        fixture.register_vault(&VaultKeys::generate()?, &store_id)?;
        let joiner = Installation::new()?;
        fixture.request_join(&joiner)?;
        let founder = fixture.founder();
        let mount = IdentityProviderMount {
            mount_id: ProviderMountId::generate()?,
            label: "Backup repo".to_owned(),
            target: IdentityMountTarget::Github {
                repository: "owner/nook-backup".to_owned(),
            },
        };
        fixture.append(
            &founder,
            vec![IdentityControlOperation::ProviderMounted {
                mount: mount.clone(),
            }],
        )?;
        let expected = fixture.state()?;
        assert_eq!(expected.mounts, vec![mount.clone()]);

        let mut stored = fixture
            .log
            .storage_bytes()?
            .into_iter()
            .map(|(_, bytes)| bytes)
            .collect::<Vec<EventStorageBytes>>();
        stored.reverse();
        let reversed =
            IdentityControlLog::new(fixture.identity_id.clone()).union_storage_bytes(&stored)?;
        assert_eq!(IdentityControlState::project(&reversed)?, expected);

        // A child that arrives before its parent stays pending, then applies.
        let child = fixture.log.build_append(
            vec![IdentityControlOperation::ProviderUnmounted {
                mount_id: mount.mount_id.clone(),
            }],
            &founder.signing(&fixture.at),
        )?;
        let grandchild_parent = child.id()?;
        let without_parent =
            IdentityControlLog::new(fixture.identity_id.clone()).union_storage_bytes(&stored)?;
        let mut detached = without_parent.clone();
        let orphan = {
            let mut log_with_child = fixture.log.clone().insert(child.clone())?.log;
            let orphan = log_with_child.build_append(
                vec![rename(founder.app.app_id(), "Renamed")],
                &founder.signing(&fixture.at),
            )?;
            log_with_child = log_with_child.insert(orphan.clone())?.log;
            assert_eq!(
                member_label(
                    &IdentityControlState::project(&log_with_child)?,
                    founder.app.app_id()
                ),
                "Renamed"
            );
            orphan
        };
        assert!(orphan.body.parents.contains(&grandchild_parent));
        let pending = detached.insert(orphan)?;
        assert!(matches!(
            pending.status,
            IdentityEventInsertStatus::Pending { .. }
        ));
        detached = pending.log;
        assert_eq!(IdentityControlState::project(&detached)?, expected);
        detached = detached.insert(child)?.log;
        let resolved = IdentityControlState::project(&detached)?;
        assert!(resolved.mounts.is_empty());
        assert_eq!(member_label(&resolved, founder.app.app_id()), "Renamed");
        Ok(())
    }

    #[test]
    fn removing_a_vault_drops_it_and_records_the_tombstone() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let kept = StoreId::generate()?;
        let removed = StoreId::generate()?;
        fixture.register_vault(&VaultKeys::generate()?, &kept)?;
        fixture.register_vault(&VaultKeys::generate()?, &removed)?;
        let founder = fixture.founder();
        fixture.append(
            &founder,
            vec![IdentityControlOperation::VaultRemoved {
                store_id: removed.clone(),
            }],
        )?;
        let state = fixture.state()?;
        assert!(state.vault(&removed).is_none());
        assert!(state.vault(&kept).is_some());
        assert_eq!(state.removed_vaults, vec![removed]);
        Ok(())
    }

    #[test]
    fn a_later_grant_does_not_bring_a_removed_vault_back() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let store_id = StoreId::generate()?;
        fixture.register_vault(&VaultKeys::generate()?, &store_id)?;
        let founder = fixture.founder();
        let rotated = VaultKeys::generate()?;
        let rotated_epoch = epoch_id("after-removal")?;
        let regrant = fixture.state()?.vault_rewrap_operation(&OpenedVaultDek {
            store_id: &store_id,
            key_epoch: &rotated_epoch,
            keys: &rotated,
        })?;
        fixture.append(
            &founder,
            vec![IdentityControlOperation::VaultRemoved {
                store_id: store_id.clone(),
            }],
        )?;
        fixture.append(&founder, vec![regrant])?;
        let state = fixture.state()?;
        assert!(state.vault(&store_id).is_none());
        assert_eq!(state.removed_vaults, vec![store_id]);
        Ok(())
    }

    #[test]
    fn removal_wins_over_a_concurrent_grant_in_any_delivery_order() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let store_id = StoreId::generate()?;
        let keys = VaultKeys::generate()?;
        let epoch = fixture.register_vault(&keys, &store_id)?;
        let founder = fixture.founder();
        // A rewrap built on the same parents as the removal: concurrent.
        let rewrap = fixture.state()?.vault_rewrap_operation(&OpenedVaultDek {
            store_id: &store_id,
            key_epoch: &epoch,
            keys: &keys,
        })?;
        let concurrent = fixture
            .log
            .build_append(vec![rewrap], &founder.signing(&fixture.at))?;
        fixture.append(
            &founder,
            vec![IdentityControlOperation::VaultRemoved {
                store_id: store_id.clone(),
            }],
        )?;
        let merged = fixture.log.clone().insert(concurrent)?.log;
        let state = IdentityControlState::project(&merged)?;
        assert!(state.vault(&store_id).is_none());

        let mut stored = merged
            .storage_bytes()?
            .into_iter()
            .map(|(_, bytes)| bytes)
            .collect::<Vec<EventStorageBytes>>();
        stored.reverse();
        let reversed =
            IdentityControlLog::new(fixture.identity_id.clone()).union_storage_bytes(&stored)?;
        assert_eq!(IdentityControlState::project(&reversed)?, state);
        Ok(())
    }

    #[test]
    fn denied_and_rerequested_joins_follow_causal_resolution() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let joiner = Installation::new()?;
        fixture.request_join(&joiner)?;
        let deny = fixture.state()?.denial_operation(joiner.app.app_id())?;
        let founder = fixture.founder();
        fixture.append(&founder, vec![deny])?;
        assert!(fixture.state()?.pending_joins.is_empty());
        assert!(
            fixture
                .state()?
                .denial_operation(joiner.app.app_id())
                .is_err()
        );

        fixture.request_join(&joiner)?;
        let state = fixture.state()?;
        assert_eq!(state.pending_joins.len(), 1);
        assert!(
            state
                .members_missing_current_dek(&StoreId::generate()?)
                .is_empty()
        );
        Ok(())
    }
}
