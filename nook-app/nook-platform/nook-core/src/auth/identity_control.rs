//! Portable policy between the replicated identity control log, the local
//! identity directory, and the vault event logs an identity owns.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::VaultResult;
use nook_auth2::{
    AppId, AppKey, AuthKeyId, IdentityMember, MemberLabelState, MultiDeviceResult,
    ReplicatedVaultGrant, StoreId,
};
use nook_event_log::{
    IdentityControlOperation, IdentityControlState, IdentityMemberKeys, IdentityNaming,
    IdentityVaultDekLookup, VaultAuthorizedRoster,
};

/// Replicated membership expressed in local directory terms.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicatedMembershipProjection {
    pub members: Vec<IdentityMember>,
    pub revoked: Vec<AppId>,
    pub own_grants: Vec<ReplicatedVaultGrant>,
    /// Vaults deleted from the identity everywhere.
    pub removed_vaults: Vec<StoreId>,
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
            removed_vaults: self.state.removed_vaults.clone(),
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

/// Whether every member can read the identity's name in its control log.
pub struct IdentityNameStatus<'a> {
    pub state: &'a IdentityControlState,
    pub app_key: &'a AppKey,
    /// The identity's name on this device, used only while the log has none.
    pub name: &'a str,
}

impl IdentityNameStatus<'_> {
    /// The naming to append, if any. The name already in the log wins: this
    /// device only re-seals it for members that cannot read it. A log no
    /// member has named takes this device's name. A device that cannot read
    /// the log's name leaves it to a member that can, so devices never
    /// overwrite each other's name.
    pub fn naming(&self) -> VaultResult<Option<IdentityControlOperation>> {
        if self.state.member(self.app_key.app_id()).is_none() {
            return Ok(None);
        }
        let everyone_holds_it = self
            .state
            .members
            .iter()
            .all(|member| self.state.sealed_name_for(&member.keys.app_id).is_some());
        let name = match self.state.sealed_name_for(self.app_key.app_id()) {
            Some(_) if everyone_holds_it => return Ok(None),
            Some(sealed) => self.app_key.open_utf8(sealed)?,
            None if self.state.sealed_name.is_empty() => self.name.trim().to_owned(),
            None => return Ok(None),
        };
        if name.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some(self.state.naming_operation(&IdentityNaming {
            name: &name,
            joining: None,
        })?))
    }
}

/// What deleting a vault everywhere does for one identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultDeletionPlan {
    /// Record the removal in the identity log; every device drops its copy.
    RecordRemoval,
    /// The identity never registered the vault (or already removed it): only
    /// this browser's copy goes.
    LocalOnly,
    /// The vault is open in this session; it must be closed first.
    RefuseOpen,
}

/// Decides how one vault is deleted everywhere.
pub struct VaultDeletionRequest<'a> {
    pub state: &'a IdentityControlState,
    pub store_id: &'a StoreId,
    /// The vault open in this session, if any.
    pub open_store_id: Option<&'a StoreId>,
}

impl VaultDeletionRequest<'_> {
    #[must_use]
    pub fn plan(&self) -> VaultDeletionPlan {
        if self.open_store_id == Some(self.store_id) {
            return VaultDeletionPlan::RefuseOpen;
        }
        if self.state.vault(self.store_id).is_some() {
            VaultDeletionPlan::RecordRemoval
        } else {
            VaultDeletionPlan::LocalOnly
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
        OpenedVaultDek, SigningIdentity, VaultRosterMember,
    };
    use nook_auth2::IdentityId;
    use nook_auth2::{IsoTimestamp, MemberLabel, VaultKeys};
    use nook_event_log::EventId;

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
    fn the_log_name_wins_and_reaches_every_member() -> anyhow::Result<()> {
        let scenario = Scenario::approved()?;
        let at = IsoTimestamp::from_trusted("2026-10-14T00:00:00Z".to_owned());
        let status = |log: &IdentityControlLog, member: &Member, name: &str| {
            IdentityNameStatus {
                state: &IdentityControlState::project(log)?,
                app_key: &member.app,
                name,
            }
            .naming()
        };

        // An unnamed log takes the founder's name, sealed to both members.
        let Some(naming) = status(&scenario.log, &scenario.founder, "Personal")? else {
            anyhow::bail!("an unnamed log must take this device's name");
        };
        let named = scenario
            .log
            .clone()
            .insert(scenario.log.build_append(
                vec![naming],
                &IdentityEventSigning {
                    signing_key: scenario.founder.signer.signing_key(),
                    created_at: &at,
                },
            )?)?
            .log;
        let state = IdentityControlState::project(&named)?;
        for member in [&scenario.founder, &scenario.joiner] {
            let sealed = state
                .sealed_name_for(member.app.app_id())
                .ok_or_else(|| anyhow::anyhow!("every member must hold the name"))?;
            assert_eq!(member.app.open_utf8(sealed)?, "Personal");
        }
        assert!(status(&named, &scenario.founder, "Personal")?.is_none());
        // Another device's own name never overwrites the log's.
        assert!(status(&named, &scenario.joiner, "Phone name")?.is_none());

        // A member that cannot read the name gets the log's name re-sealed,
        // not the local one of the device that re-seals it.
        let founder_only = IdentityControlOperation::IdentityNamed {
            recipients: vec![nook_event_log::MemberSealedName {
                app_id: scenario.founder.app.app_id().clone(),
                name_ciphertext: scenario.founder.app.public_key().seal_bytes(b"Personal")?,
            }],
        };
        let partial = named
            .clone()
            .insert(named.build_append(
                vec![founder_only],
                &IdentityEventSigning {
                    signing_key: scenario.founder.signer.signing_key(),
                    created_at: &at,
                },
            )?)?
            .log;
        assert!(status(&partial, &scenario.joiner, "Phone name")?.is_none());
        let Some(IdentityControlOperation::IdentityNamed { recipients }) =
            status(&partial, &scenario.founder, "Work")?
        else {
            anyhow::bail!("the founder must re-seal the name for the joiner");
        };
        let resealed = recipients
            .iter()
            .find(|sealed| &sealed.app_id == scenario.joiner.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the joiner must be a recipient"))?;
        assert_eq!(
            scenario.joiner.app.open_utf8(&resealed.name_ciphertext)?,
            "Personal"
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

    #[test]
    fn deleting_a_registered_vault_records_its_removal() -> anyhow::Result<()> {
        let scenario = Scenario::approved()?;
        let state = IdentityControlState::project(&scenario.log)?;
        let other = StoreId::generate()?;
        let plan = VaultDeletionRequest {
            state: &state,
            store_id: &scenario.store_id,
            open_store_id: Some(&other),
        }
        .plan();
        assert_eq!(plan, VaultDeletionPlan::RecordRemoval);
        Ok(())
    }

    #[test]
    fn deleting_the_open_vault_is_refused() -> anyhow::Result<()> {
        let scenario = Scenario::approved()?;
        let state = IdentityControlState::project(&scenario.log)?;
        let plan = VaultDeletionRequest {
            state: &state,
            store_id: &scenario.store_id,
            open_store_id: Some(&scenario.store_id),
        }
        .plan();
        assert_eq!(plan, VaultDeletionPlan::RefuseOpen);
        Ok(())
    }

    #[test]
    fn deleting_an_unregistered_vault_stays_local() -> anyhow::Result<()> {
        let scenario = Scenario::approved()?;
        let state = IdentityControlState::project(&scenario.log)?;
        let unregistered = StoreId::generate()?;
        let plan = VaultDeletionRequest {
            state: &state,
            store_id: &unregistered,
            open_store_id: None,
        }
        .plan();
        assert_eq!(plan, VaultDeletionPlan::LocalOnly);
        Ok(())
    }
}
