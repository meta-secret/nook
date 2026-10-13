//! Portable policy between the replicated identity control log, the local
//! identity directory, and the vault event logs an identity owns.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{
    AppId, AppKey, AuthKeyId, IdentityId, IdentityMember, MemberLabelState, MultiDeviceResult,
    ReplicatedVaultGrant, StoreId,
};
use nook_event_log::{
    EventGraph, IdentityControlState, IdentityMemberKeys, IdentityVaultDekLookup, SigningIdentity,
    VaultAuthorizedRoster,
};

/// Replicated membership expressed in local directory terms.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicatedMembershipProjection {
    pub members: Vec<IdentityMember>,
    pub revoked: Vec<AppId>,
    pub own_grants: Vec<ReplicatedVaultGrant>,
}

/// Converts one identity projection for one local installation.
pub struct ReplicatedMembershipRequest<'a> {
    pub state: &'a IdentityControlState,
    pub app_key: &'a AppKey,
}

impl ReplicatedMembershipRequest<'_> {
    fn local_member(keys: &IdentityMemberKeys) -> MultiDeviceResult<IdentityMember> {
        Ok(IdentityMember {
            app_id: keys.app_id.clone(),
            auth_id: keys.encryption_public_key.auth_id()?,
            public_key: keys.encryption_public_key.clone(),
            signing_public_key: keys.signing_public_key.clone(),
            label: if keys.label.as_str().trim().is_empty() {
                MemberLabelState::Unnamed
            } else {
                MemberLabelState::Named(keys.label.as_str().to_owned())
            },
        })
    }

    /// Members, revocations, and this installation's envelope for each vault's
    /// current key epoch. A vault without a current envelope is omitted.
    pub fn project(&self) -> MultiDeviceResult<ReplicatedMembershipProjection> {
        let members = self
            .state
            .members
            .iter()
            .map(|member| Self::local_member(&member.keys))
            .collect::<MultiDeviceResult<Vec<_>>>()?;
        let own_grants = self
            .state
            .vaults
            .iter()
            .filter_map(|vault| match vault.current_dek_for(self.app_key.app_id()) {
                IdentityVaultDekLookup::Granted(dek) => Some(ReplicatedVaultGrant {
                    store_id: vault.store_id.clone(),
                    secrets_envelope: dek.secrets_key_ciphertext.clone(),
                    members_envelope: dek.members_key_ciphertext.clone(),
                }),
                IdentityVaultDekLookup::NotGranted => None,
            })
            .collect();
        Ok(ReplicatedMembershipProjection {
            members,
            revoked: self.state.revoked.clone(),
            own_grants,
        })
    }
}

/// Who created one vault the local identity owns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultFounder {
    /// This installation signed the vault's genesis; it migrates the vault.
    ThisInstallation,
    /// Another installation created it; that installation's identity owns it.
    AnotherInstallation,
    /// The local event graph has no applicable genesis yet.
    Unknown,
}

impl VaultFounder {
    /// Compare the vault's genesis actor with this installation's signer.
    pub fn classify(
        graph: &EventGraph,
        signer: &SigningIdentity,
    ) -> nook_event_log::EventResult<Self> {
        let actor = signer.actor_id()?;
        let genesis = graph
            .applicable_events()
            .into_iter()
            .find(|event| event.body.parents.is_empty());
        Ok(match genesis {
            Some(event) if event.body.actor_id == actor => Self::ThisInstallation,
            Some(_) => Self::AnotherInstallation,
            None => Self::Unknown,
        })
    }
}

/// How this installation relates to a replicated identity found on a mount.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplicatedIdentityStanding {
    ActiveMember,
    Revoked,
    PendingJoin,
    NotListed,
}

impl ReplicatedIdentityStanding {
    #[must_use]
    pub fn of(state: &IdentityControlState, app_id: &AppId) -> Self {
        if state.member(app_id).is_some() {
            Self::ActiveMember
        } else if state.revoked.contains(app_id) {
            Self::Revoked
        } else if state.pending_join(app_id).is_some() {
            Self::PendingJoin
        } else {
            Self::NotListed
        }
    }
}

/// The identity a local identity should adopt: the one replicated identity
/// listing this app key as an active member. Two such identities are
/// ambiguous and must not be guessed between.
pub struct IdentityAdoptionChoice<'a> {
    pub local_identity_id: &'a IdentityId,
    pub app_id: &'a AppId,
    pub candidates: &'a [IdentityControlState],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityAdoption {
    /// The local identity already is the replicated identity.
    AlreadyReplicated,
    Adopt(IdentityId),
    NoneListed,
    Ambiguous(Vec<IdentityId>),
}

impl IdentityAdoptionChoice<'_> {
    #[must_use]
    pub fn choose(&self) -> IdentityAdoption {
        let listed = self
            .candidates
            .iter()
            .filter(|state| {
                ReplicatedIdentityStanding::of(state, self.app_id)
                    == ReplicatedIdentityStanding::ActiveMember
            })
            .map(|state| state.identity_id.clone())
            .collect::<Vec<_>>();
        match listed.as_slice() {
            [] => IdentityAdoption::NoneListed,
            [only] if only == self.local_identity_id => IdentityAdoption::AlreadyReplicated,
            [only] => IdentityAdoption::Adopt(only.clone()),
            _ => IdentityAdoption::Ambiguous(listed),
        }
    }
}

/// Vault actors the identity revoked that a vault still authorizes. Each must
/// be revoked from that vault before its next write.
pub struct VaultRevocationDue<'a> {
    pub state: &'a IdentityControlState,
    pub vault_roster: &'a VaultAuthorizedRoster,
}

impl VaultRevocationDue<'_> {
    pub fn auth_ids(&self) -> MultiDeviceResult<Vec<AuthKeyId>> {
        let mut due = self
            .vault_roster
            .members
            .iter()
            .filter(|member| self.state.revoked.contains(&member.device_id))
            .map(|member| member.encryption_public_key.auth_id())
            .collect::<MultiDeviceResult<Vec<_>>>()?;
        due.sort();
        due.dedup();
        Ok(due)
    }
}

/// Whether the identity log already carries a vault at the vault's epoch.
pub struct IdentityVaultEpochStatus<'a> {
    pub state: &'a IdentityControlState,
    pub store_id: &'a StoreId,
    pub key_epoch: &'a nook_event_log::EventId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityVaultEpochAction {
    Register,
    Rewrap,
    Current,
}

impl IdentityVaultEpochStatus<'_> {
    /// Register an unknown vault; rewrap when the epoch moved or an active
    /// member holds no envelope for it.
    #[must_use]
    pub fn action(&self) -> IdentityVaultEpochAction {
        let Some(vault) = self.state.vault(self.store_id) else {
            return IdentityVaultEpochAction::Register;
        };
        if &vault.current_key_epoch != self.key_epoch
            || !self
                .state
                .members_missing_current_dek(self.store_id)
                .is_empty()
        {
            IdentityVaultEpochAction::Rewrap
        } else {
            IdentityVaultEpochAction::Current
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        IdentityApprovalRequest, IdentityControlLog, IdentityControlOperation,
        IdentityControlSnapshot, IdentityControlSnapshotRequest, IdentityControlStanding,
        IdentityEvent, IdentityEventSigning, IdentityGenesisRequest, IdentityVaultRegistration,
        OpenedVaultDek, VaultRosterMember,
    };
    use nook_auth2::{IsoTimestamp, MemberLabel, VaultKeys};
    use nook_event_log::EventId;
    use std::slice;

    struct Member {
        app: AppKey,
        signer: SigningIdentity,
    }

    impl Member {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                app: AppKey::generate()?,
                signer: SigningIdentity::generate()?.0,
            })
        }

        fn keys(&self, label: &str) -> IdentityMemberKeys {
            IdentityMemberKeys {
                app_id: self.app.app_id().clone(),
                encryption_public_key: self.app.public_key(),
                signing_public_key: self.signer.public_key(),
                label: MemberLabel::from_trusted(label.to_owned()),
            }
        }
    }

    struct Scenario {
        founder: Member,
        joiner: Member,
        store_id: StoreId,
        keys: VaultKeys,
        epoch: EventId,
        log: IdentityControlLog,
    }

    impl Scenario {
        fn approved() -> anyhow::Result<Self> {
            let founder = Member::new()?;
            let joiner = Member::new()?;
            let at = IsoTimestamp::from_trusted("2026-10-12T00:00:00Z".to_owned());
            let identity_id = IdentityId::generate()?;
            let store_id = StoreId::generate()?;
            let keys = VaultKeys::generate()?;
            let epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
            let founder_signing = IdentityEventSigning {
                signing_key: founder.signer.signing_key(),
                created_at: &at,
            };
            let mut log = IdentityControlLog::new(identity_id.clone())
                .insert(IdentityEvent::genesis(IdentityGenesisRequest {
                    identity_id: &identity_id,
                    founder: founder.keys("Laptop"),
                    signing: IdentityEventSigning {
                        signing_key: founder.signer.signing_key(),
                        created_at: &at,
                    },
                })?)?
                .log;
            let register = IdentityControlState::project(&log)?.vault_registration_operation(
                IdentityVaultRegistration {
                    dek: OpenedVaultDek {
                        store_id: &store_id,
                        key_epoch: &epoch,
                        keys: &keys,
                    },
                },
            )?;
            log = log
                .clone()
                .insert(log.build_append(vec![register], &founder_signing)?)?
                .log;
            let request = log.build_append(
                vec![IdentityControlOperation::MemberJoinRequested {
                    member: joiner.keys("Phone"),
                }],
                &IdentityEventSigning {
                    signing_key: joiner.signer.signing_key(),
                    created_at: &at,
                },
            )?;
            log = log.insert(request)?.log;
            let approve = IdentityControlState::project(&log)?.approval_operation(
                &IdentityApprovalRequest {
                    app_id: joiner.app.app_id(),
                    vaults: &[OpenedVaultDek {
                        store_id: &store_id,
                        key_epoch: &epoch,
                        keys: &keys,
                    }],
                },
            )?;
            log = log
                .clone()
                .insert(log.build_append(vec![approve], &founder_signing)?)?
                .log;
            Ok(Self {
                founder,
                joiner,
                store_id,
                keys,
                epoch,
                log,
            })
        }
    }

    #[test]
    fn approved_joiner_receives_members_and_its_own_vault_grant() -> anyhow::Result<()> {
        let scenario = Scenario::approved()?;
        let state = IdentityControlState::project(&scenario.log)?;
        let projection = ReplicatedMembershipRequest {
            state: &state,
            app_key: &scenario.joiner.app,
        }
        .project()?;
        assert_eq!(projection.members.len(), 2);
        let [grant] = projection.own_grants.as_slice() else {
            anyhow::bail!("the joiner holds exactly one vault grant");
        };
        assert_eq!(grant.store_id, scenario.store_id);
        assert_eq!(
            scenario
                .joiner
                .app
                .decrypt_envelope(&grant.secrets_envelope)?,
            scenario.keys.secrets_key
        );
        assert_eq!(
            IdentityVaultEpochStatus {
                state: &state,
                store_id: &scenario.store_id,
                key_epoch: &scenario.epoch,
            }
            .action(),
            IdentityVaultEpochAction::Current
        );
        let rotated = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        assert_eq!(
            IdentityVaultEpochStatus {
                state: &state,
                store_id: &scenario.store_id,
                key_epoch: &rotated,
            }
            .action(),
            IdentityVaultEpochAction::Rewrap
        );
        assert_eq!(
            IdentityVaultEpochStatus {
                state: &state,
                store_id: &StoreId::generate()?,
                key_epoch: &rotated,
            }
            .action(),
            IdentityVaultEpochAction::Register
        );
        Ok(())
    }

    #[test]
    fn adoption_chooses_only_an_unambiguous_identity_listing_the_app() -> anyhow::Result<()> {
        let scenario = Scenario::approved()?;
        let state = IdentityControlState::project(&scenario.log)?;
        let local = IdentityId::generate()?;
        let choose = |candidates: &[IdentityControlState], app_id: &AppId| {
            IdentityAdoptionChoice {
                local_identity_id: &local,
                app_id,
                candidates,
            }
            .choose()
        };
        assert_eq!(
            choose(slice::from_ref(&state), scenario.joiner.app.app_id()),
            IdentityAdoption::Adopt(state.identity_id.clone())
        );
        assert_eq!(
            choose(slice::from_ref(&state), AppKey::generate()?.app_id()),
            IdentityAdoption::NoneListed
        );
        let mut other = state.clone();
        other.identity_id = IdentityId::generate()?;
        assert!(matches!(
            choose(&[state.clone(), other], scenario.joiner.app.app_id()),
            IdentityAdoption::Ambiguous(_)
        ));
        assert_eq!(
            IdentityAdoptionChoice {
                local_identity_id: &state.identity_id,
                app_id: scenario.founder.app.app_id(),
                candidates: slice::from_ref(&state),
            }
            .choose(),
            IdentityAdoption::AlreadyReplicated
        );
        Ok(())
    }

    #[test]
    fn identity_revocation_is_due_only_where_the_vault_still_authorizes_the_app()
    -> anyhow::Result<()> {
        let scenario = Scenario::approved()?;
        let at = IsoTimestamp::from_trusted("2026-10-13T00:00:00Z".to_owned());
        let revoke = IdentityControlState::project(&scenario.log)?
            .revocation_operation(scenario.joiner.app.app_id())?;
        let log = scenario
            .log
            .clone()
            .insert(scenario.log.build_append(
                vec![revoke],
                &IdentityEventSigning {
                    signing_key: scenario.founder.signer.signing_key(),
                    created_at: &at,
                },
            )?)?
            .log;
        let state = IdentityControlState::project(&log)?;
        let roster_member = |member: &Member| VaultRosterMember {
            device_id: member.app.app_id().clone(),
            encryption_public_key: member.app.public_key(),
            signing_public_key: member.signer.public_key(),
            label: MemberLabel::from_trusted(String::new()),
        };
        let roster = VaultAuthorizedRoster {
            members: vec![
                roster_member(&scenario.founder),
                roster_member(&scenario.joiner),
            ],
            revoked: Vec::new(),
        };
        assert_eq!(
            VaultRevocationDue {
                state: &state,
                vault_roster: &roster,
            }
            .auth_ids()?,
            vec![scenario.joiner.app.auth_id()]
        );
        let cleared = VaultAuthorizedRoster {
            members: vec![roster_member(&scenario.founder)],
            revoked: vec![scenario.joiner.app.app_id().clone()],
        };
        assert!(
            VaultRevocationDue {
                state: &state,
                vault_roster: &cleared,
            }
            .auth_ids()?
            .is_empty()
        );
        assert_eq!(
            ReplicatedIdentityStanding::of(&state, scenario.joiner.app.app_id()),
            ReplicatedIdentityStanding::Revoked
        );
        Ok(())
    }

    #[test]
    fn snapshot_shows_each_installation_its_own_standing_and_grants() -> anyhow::Result<()> {
        let scenario = Scenario::approved()?;
        let state = IdentityControlState::project(&scenario.log)?;
        let joiner = IdentityControlSnapshot::project(&IdentityControlSnapshotRequest {
            state: &state,
            identity_label: "Personal",
            current_app_id: scenario.joiner.app.app_id(),
            providers: &[],
        });
        assert_eq!(joiner.standing, IdentityControlStanding::Member);
        assert_eq!(joiner.identity_label, "Personal");
        assert!(joiner.pending_joins.is_empty());
        let current = joiner
            .members
            .iter()
            .filter(|member| member.is_current_installation)
            .map(|member| member.label.as_str())
            .collect::<Vec<_>>();
        assert_eq!(current, vec!["Phone"]);
        let [vault] = joiner.vaults.as_slice() else {
            anyhow::bail!("the identity owns exactly one vault");
        };
        assert_eq!(vault.store_id, scenario.store_id.as_str());
        assert!(vault.granted_to_current_installation);
        assert!(vault.members_missing_dek.is_empty());

        let outsider = AppKey::generate()?;
        let outsider_view = IdentityControlSnapshot::project(&IdentityControlSnapshotRequest {
            state: &state,
            identity_label: "Personal",
            current_app_id: outsider.app_id(),
            providers: &[],
        });
        assert_eq!(outsider_view.standing, IdentityControlStanding::NotListed);
        assert!(
            outsider_view
                .vaults
                .iter()
                .all(|vault| !vault.granted_to_current_installation)
        );
        assert!(
            outsider_view
                .members
                .iter()
                .all(|member| !member.is_current_installation)
        );
        Ok(())
    }
}
