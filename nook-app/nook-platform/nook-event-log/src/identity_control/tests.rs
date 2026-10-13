//! Behavior tests for the replicated identity control log.
#![allow(clippy::too_many_lines)]

use ed25519_dalek::SigningKey;
use nook_auth2::{AppKey, IdentityId, IsoTimestamp, MemberLabel, StoreId, VaultKeys};

use super::*;
use crate::test_support::{public_key, signing_key};
use crate::{EventError, EventId, EventStorageBytes};

struct Installation {
    app: AppKey,
    signer: SigningKey,
}

impl Installation {
    fn new() -> anyhow::Result<Self> {
        Ok(Self {
            app: AppKey::generate()?,
            signer: signing_key(),
        })
    }

    fn keys(&self, label: &str) -> IdentityMemberKeys {
        IdentityMemberKeys {
            app_id: self.app.app_id().clone(),
            encryption_public_key: self.app.public_key(),
            signing_public_key: public_key(&self.signer),
            label: MemberLabel::from_trusted(label.to_owned()),
        }
    }

    fn signing<'a>(&'a self, at: &'a IsoTimestamp) -> IdentityEventSigning<'a> {
        IdentityEventSigning {
            signing_key: &self.signer,
            created_at: at,
        }
    }
}

struct Fixture {
    identity_id: IdentityId,
    at: IsoTimestamp,
    founder: Installation,
    log: IdentityControlLog,
}

impl Fixture {
    fn new() -> anyhow::Result<Self> {
        let identity_id = IdentityId::generate()?;
        let at = IsoTimestamp::from_trusted("2026-10-12T00:00:00Z".to_owned());
        let founder = Installation::new()?;
        let genesis = IdentityEvent::genesis(IdentityGenesisRequest {
            identity_id: &identity_id,
            founder: founder.keys("Laptop"),
            signing: founder.signing(&at),
        })?;
        let log = IdentityControlLog::new(identity_id.clone())
            .insert(genesis)?
            .log;
        Ok(Self {
            identity_id,
            at,
            founder,
            log,
        })
    }

    fn append(
        &mut self,
        actor: &Installation,
        operations: Vec<IdentityControlOperation>,
    ) -> anyhow::Result<(IdentityEvent, IdentityEventInsertStatus)> {
        let event = self
            .log
            .build_append(operations, &actor.signing(&self.at))?;
        let inserted = self.log.clone().insert(event.clone())?;
        self.log = inserted.log;
        Ok((event, inserted.status))
    }

    fn state(&self) -> anyhow::Result<IdentityControlState> {
        Ok(IdentityControlState::project(&self.log)?)
    }

    fn request_join(&mut self, joiner: &Installation) -> anyhow::Result<IdentityEvent> {
        let (event, status) = self.append(
            joiner,
            vec![IdentityControlOperation::MemberJoinRequested {
                member: joiner.keys("Phone"),
            }],
        )?;
        assert_eq!(status, IdentityEventInsertStatus::Applied);
        Ok(event)
    }

    fn register_vault(&mut self, keys: &VaultKeys, store_id: &StoreId) -> anyhow::Result<EventId> {
        let key_epoch = epoch_id(store_id.as_str())?;
        let operation = self
            .state()?
            .vault_registration_operation(IdentityVaultRegistration {
                dek: OpenedVaultDek {
                    store_id,
                    key_epoch: &key_epoch,
                    keys,
                },
            })?;
        let founder = Installation {
            app: self.founder.app.clone(),
            signer: self.founder.signer.clone(),
        };
        self.append(&founder, vec![operation])?;
        Ok(key_epoch)
    }

    fn founder(&self) -> Installation {
        Installation {
            app: self.founder.app.clone(),
            signer: self.founder.signer.clone(),
        }
    }
}

fn rename(app_id: &nook_auth2::AppId, label: &str) -> IdentityControlOperation {
    IdentityControlOperation::MemberRenamed {
        app_id: app_id.clone(),
        label: MemberLabel::from_trusted(label.to_owned()),
    }
}

fn member_label(state: &IdentityControlState, app_id: &nook_auth2::AppId) -> String {
    state
        .member(app_id)
        .map(|member| member.keys.label.as_str().to_owned())
        .unwrap_or_default()
}

fn epoch_id(seed: &str) -> anyhow::Result<EventId> {
    Ok(EventId::from_sha256_hex(&hex::encode(
        <sha2::Sha256 as sha2::Digest>::digest(seed.as_bytes()),
    ))?)
}

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
fn approval_wraps_every_owned_vault_dek_to_the_joiner() -> anyhow::Result<()> {
    let mut fixture = Fixture::new()?;
    let first_keys = VaultKeys::generate()?;
    let second_keys = VaultKeys::generate()?;
    let first = StoreId::generate()?;
    let second = StoreId::generate()?;
    let first_epoch = fixture.register_vault(&first_keys, &first)?;
    let second_epoch = fixture.register_vault(&second_keys, &second)?;

    let joiner = Installation::new()?;
    fixture.request_join(&joiner)?;
    let state = fixture.state()?;
    assert_eq!(state.pending_joins.len(), 1);

    let incomplete = state.approval_operation(&IdentityApprovalRequest {
        app_id: joiner.app.app_id(),
        vaults: &[OpenedVaultDek {
            store_id: &first,
            key_epoch: &first_epoch,
            keys: &first_keys,
        }],
    });
    assert!(matches!(
        incomplete,
        Err(EventError::IdentityApprovalIncomplete { store_id }) if store_id == second.as_str()
    ));

    let approval = state.approval_operation(&IdentityApprovalRequest {
        app_id: joiner.app.app_id(),
        vaults: &[
            OpenedVaultDek {
                store_id: &first,
                key_epoch: &first_epoch,
                keys: &first_keys,
            },
            OpenedVaultDek {
                store_id: &second,
                key_epoch: &second_epoch,
                keys: &second_keys,
            },
        ],
    })?;
    let founder = fixture.founder();
    fixture.append(&founder, vec![approval])?;

    let state = fixture.state()?;
    assert!(state.pending_joins.is_empty());
    assert_eq!(state.members.len(), 2);
    for (store_id, keys) in [(&first, &first_keys), (&second, &second_keys)] {
        let vault = state
            .vault(store_id)
            .ok_or_else(|| anyhow::anyhow!("vault must stay registered"))?;
        let IdentityVaultDekLookup::Granted(dek) = vault.current_dek_for(joiner.app.app_id())
        else {
            anyhow::bail!("joiner must hold the current DEK of {store_id}");
        };
        assert_eq!(
            joiner.app.decrypt_envelope(&dek.secrets_key_ciphertext)?,
            keys.secrets_key
        );
        assert_eq!(
            joiner.app.decrypt_envelope(&dek.members_key_ciphertext)?,
            keys.members_key
        );
    }

    // The approved joiner may now act for the identity.
    let (_, status) = fixture.append(&joiner, vec![rename(joiner.app.app_id(), "Pixel")])?;
    assert_eq!(status, IdentityEventInsertStatus::Applied);
    assert_eq!(
        member_label(&fixture.state()?, joiner.app.app_id()),
        "Pixel"
    );
    Ok(())
}

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
fn revocation_drops_envelopes_and_blocks_later_actions() -> anyhow::Result<()> {
    let mut fixture = Fixture::new()?;
    let keys = VaultKeys::generate()?;
    let store_id = StoreId::generate()?;
    let key_epoch = fixture.register_vault(&keys, &store_id)?;
    let joiner = Installation::new()?;
    fixture.request_join(&joiner)?;
    let approval = fixture
        .state()?
        .approval_operation(&IdentityApprovalRequest {
            app_id: joiner.app.app_id(),
            vaults: &[OpenedVaultDek {
                store_id: &store_id,
                key_epoch: &key_epoch,
                keys: &keys,
            }],
        })?;
    let founder = fixture.founder();
    fixture.append(&founder, vec![approval])?;

    let revoke = fixture.state()?.revocation_operation(joiner.app.app_id())?;
    fixture.append(&founder, vec![revoke])?;
    let state = fixture.state()?;
    assert_eq!(state.members.len(), 1);
    assert_eq!(state.revoked, vec![joiner.app.app_id().clone()]);
    let vault = state
        .vault(&store_id)
        .ok_or_else(|| anyhow::anyhow!("vault must stay registered"))?;
    assert!(matches!(
        vault.current_dek_for(joiner.app.app_id()),
        IdentityVaultDekLookup::NotGranted
    ));

    let (_, status) =
        fixture.append(&joiner, vec![rename(joiner.app.app_id(), "Revoked rename")])?;
    assert!(matches!(
        status,
        IdentityEventInsertStatus::Quarantined { .. }
    ));
    assert!(matches!(
        fixture.state()?.revocation_operation(founder.app.app_id()),
        Err(EventError::IdentityControlInvalid(_))
    ));

    // A rotated vault epoch is rewrapped to remaining members only.
    let rotated = VaultKeys::generate()?;
    let rotated_epoch = epoch_id("rotation")?;
    let rewrap = fixture.state()?.vault_rewrap_operation(&OpenedVaultDek {
        store_id: &store_id,
        key_epoch: &rotated_epoch,
        keys: &rotated,
    })?;
    fixture.append(&founder, vec![rewrap])?;
    let state = fixture.state()?;
    let vault = state
        .vault(&store_id)
        .ok_or_else(|| anyhow::anyhow!("vault must stay registered"))?;
    assert_eq!(vault.current_key_epoch, rotated_epoch);
    let IdentityVaultDekLookup::Granted(dek) = vault.current_dek_for(founder.app.app_id()) else {
        anyhow::bail!("founder must hold the rotated DEK");
    };
    assert_eq!(
        founder.app.decrypt_envelope(&dek.secrets_key_ciphertext)?,
        rotated.secrets_key
    );
    assert!(state.members_missing_current_dek(&store_id).is_empty());
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

#[test]
fn projection_is_independent_of_delivery_order_and_resolves_pending_parents() -> anyhow::Result<()>
{
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
        layout: ProviderMountLayout::Namespaced,
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
fn envelopes_bind_to_one_identity_and_one_founder_genesis() -> anyhow::Result<()> {
    let fixture = Fixture::new()?;
    let other = IdentityControlLog::new(IdentityId::generate()?);
    let foreign = fixture.log.build_append(
        vec![rename(fixture.founder.app.app_id(), "Elsewhere")],
        &fixture.founder.signing(&fixture.at),
    )?;
    assert!(other.insert(foreign).is_err());

    let impostor = Installation::new()?;
    let forged_genesis = IdentityEvent::genesis(IdentityGenesisRequest {
        identity_id: &fixture.identity_id,
        founder: fixture.founder.keys("Laptop"),
        signing: impostor.signing(&fixture.at),
    })?;
    assert!(
        IdentityControlLog::new(fixture.identity_id.clone())
            .insert(forged_genesis)
            .is_err()
    );

    let second_genesis = IdentityEvent::genesis(IdentityGenesisRequest {
        identity_id: &fixture.identity_id,
        founder: impostor.keys("Other"),
        signing: impostor.signing(&fixture.at),
    })?;
    assert!(matches!(
        fixture.log.clone().insert(second_genesis),
        Err(rejection) if matches!(rejection.cause, EventError::MultipleGenesisRoots)
    ));

    let mut bytes = fixture
        .log
        .storage_bytes()?
        .into_iter()
        .map(|(_, bytes)| bytes)
        .collect::<Vec<_>>();
    let tampered = String::from_utf8(Vec::from(bytes.remove(0)))?.replace("Laptop", "Stolen");
    assert!(
        IdentityControlLog::new(fixture.identity_id.clone())
            .union_storage_bytes(&[tampered.into_bytes().into()])
            .is_err()
    );
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

#[test]
fn migration_carries_authorized_vault_devices_into_the_identity() -> anyhow::Result<()> {
    use crate::{VaultAuthorizedRoster, VaultRosterMember};

    let identity_id = IdentityId::generate()?;
    let at = IsoTimestamp::from_trusted("2026-10-12T00:00:00Z".to_owned());
    let founder = Installation::new()?;
    let phone = Installation::new()?;
    let tablet = Installation::new()?;
    let roster_member = |installation: &Installation, label: &str| VaultRosterMember {
        device_id: installation.app.app_id().clone(),
        encryption_public_key: installation.app.public_key(),
        signing_public_key: public_key(&installation.signer),
        label: MemberLabel::from_trusted(label.to_owned()),
    };
    let malformed = VaultRosterMember {
        device_id: nook_auth2::AppId::parse("0123456789abcdef")?,
        encryption_public_key: phone.app.public_key(),
        signing_public_key: public_key(&phone.signer),
        label: MemberLabel::from_trusted("Mismatched".to_owned()),
    };
    let personal_roster = VaultAuthorizedRoster {
        members: vec![
            roster_member(&founder, "Laptop"),
            roster_member(&phone, "Phone"),
            roster_member(&tablet, "Tablet"),
            malformed,
        ],
        revoked: Vec::new(),
    };
    let work_roster = VaultAuthorizedRoster {
        members: vec![roster_member(&founder, "Laptop")],
        revoked: vec![tablet.app.app_id().clone()],
    };
    let personal_keys = VaultKeys::generate()?;
    let work_keys = VaultKeys::generate()?;
    let personal = StoreId::generate()?;
    let work = StoreId::generate()?;
    let personal_epoch = epoch_id("personal")?;
    let work_epoch = epoch_id("work")?;
    let mount = IdentityProviderMount {
        mount_id: ProviderMountId::generate()?,
        label: "GitHub".to_owned(),
        target: IdentityMountTarget::Github {
            repository: "owner/personal".to_owned(),
        },
        layout: ProviderMountLayout::LegacySingleVault {
            store_id: personal.clone(),
        },
    };
    let vaults = [
        LegacyVaultMembership {
            dek: OpenedVaultDek {
                store_id: &personal,
                key_epoch: &personal_epoch,
                keys: &personal_keys,
            },
            roster: &personal_roster,
        },
        LegacyVaultMembership {
            dek: OpenedVaultDek {
                store_id: &work,
                key_epoch: &work_epoch,
                keys: &work_keys,
            },
            roster: &work_roster,
        },
    ];
    let outcome = IdentityControlMigration {
        identity_id: &identity_id,
        founder: founder.keys("Laptop"),
        vaults: &vaults,
        mounts: vec![mount.clone()],
        signing: founder.signing(&at),
    }
    .events()?;
    assert_eq!(outcome.events.len(), 2);
    assert_eq!(
        outcome.skipped,
        vec![nook_auth2::AppId::parse("0123456789abcdef")?]
    );

    let bytes = outcome
        .events
        .iter()
        .map(IdentityEvent::serialize_storage_yaml)
        .collect::<Result<Vec<_>, _>>()?;
    let log = IdentityControlLog::new(identity_id).union_storage_bytes(&bytes)?;
    let state = IdentityControlState::project(&log)?;
    // The tablet is still listed by the personal vault, but its revocation
    // from the work vault keeps it out of the identity.
    assert_eq!(state.members.len(), 2);
    assert!(state.member(phone.app.app_id()).is_some());
    assert!(state.member(tablet.app.app_id()).is_none());
    assert_eq!(state.mounts, vec![mount]);

    let personal_vault = state
        .vault(&personal)
        .ok_or_else(|| anyhow::anyhow!("personal vault must be registered"))?;
    let IdentityVaultDekLookup::Granted(dek) = personal_vault.current_dek_for(phone.app.app_id())
    else {
        anyhow::bail!("phone keeps access to the vault that authorized it");
    };
    assert_eq!(
        phone.app.decrypt_envelope(&dek.secrets_key_ciphertext)?,
        personal_keys.secrets_key
    );
    let work_vault = state
        .vault(&work)
        .ok_or_else(|| anyhow::anyhow!("work vault must be registered"))?;
    assert!(matches!(
        work_vault.current_dek_for(phone.app.app_id()),
        IdentityVaultDekLookup::NotGranted
    ));
    assert_eq!(
        state
            .members_missing_current_dek(&work)
            .iter()
            .map(|member| member.keys.app_id.clone())
            .collect::<Vec<_>>(),
        vec![phone.app.app_id().clone()]
    );
    Ok(())
}
