//! The browser extension is an app of its keyrings with a key of its own:
//! the web app adds that key to the keyring with every vault's DEK
//! encrypted to it, and the extension completes its join from the keyring's
//! log the approval hands it. It pairs vaults members create later and
//! joins a second keyring with a second app key.
//!
//! This composes the same domain steps `add_identity_member` (web app) and
//! `join_identity_from_log` (the extension's offscreen WASM session) run,
//! without a sync provider.

use nook_core::{
    AppKey, EventId, IdentityConnectionKey, IdentityConnectionKeyRequest, IdentityControlLog,
    IdentityControlOperation, IdentityControlSnapshot, IdentityControlSnapshotRequest,
    IdentityControlStanding, IdentityControlState, IdentityCreation, IdentityDirectory,
    IdentityEvent, IdentityEventInsertStatus, IdentityEventSigning, IdentityGenesisRequest,
    IdentityId, IdentityInvitationBinding, IdentityJoinCompletion, IdentityJoinCompletionPlan,
    IdentityMemberAdd, IdentityMemberKeys, IdentityVaultKeyOpening, IdentityVaultPairingRequest,
    IdentityVaultRegistration, IsoTimestamp, LocalIdentityLog, MemberLabel, MemberLabelState,
    MultiDeviceError, OpenedVaultDek, ReplicatedIdentityAdoption, ReplicatedIdentityMembership,
    ReplicatedIdentityStanding, ReplicatedMembershipRequest, SigningIdentity, StoreId, VaultError,
    VaultKeys,
};

fn at() -> IsoTimestamp {
    IsoTimestamp::from_trusted("2026-10-16T12:00:00Z".to_owned())
}

fn epoch(seed: char) -> anyhow::Result<EventId> {
    // 32 digest bytes: the 43rd base64url character carries no stray bits.
    Ok(EventId::parse(&format!(
        "sha256u:{}A",
        seed.to_string().repeat(42)
    ))?)
}

/// One installation's keys: an app key and its identity event signer.
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

    /// Whether an identity log this installation holds lists this key.
    fn local_log(&self, identities: &[&WebIdentity]) -> LocalIdentityLog {
        let replicated = identities.iter().any(|identity| {
            identity
                .state()
                .is_ok_and(|state| state.member(self.app.app_id()).is_some())
        });
        if replicated {
            LocalIdentityLog::Replicated
        } else {
            LocalIdentityLog::Empty
        }
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

/// A web-app member that founded an identity and owns its vaults.
struct WebIdentity {
    identity_id: IdentityId,
    founder: Member,
    log: IdentityControlLog,
    vaults: Vec<(StoreId, EventId, VaultKeys)>,
}

impl WebIdentity {
    fn found() -> anyhow::Result<Self> {
        let identity_id = IdentityId::generate()?;
        let founder = Member::new()?;
        let created_at = at();
        let genesis = IdentityEvent::genesis(IdentityGenesisRequest {
            identity_id: &identity_id,
            founder: founder.keys("Laptop"),
            signing: IdentityEventSigning {
                signing_key: founder.signer.signing_key(),
                created_at: &created_at,
            },
        })?;
        let log = IdentityControlLog::new(identity_id.clone())
            .insert(genesis)?
            .log;
        Ok(Self {
            identity_id,
            founder,
            log,
            vaults: Vec::new(),
        })
    }

    fn append(
        &mut self,
        signer: &Member,
        operation: IdentityControlOperation,
    ) -> anyhow::Result<()> {
        let created_at = at();
        let event = self.log.build_append(
            vec![operation],
            &IdentityEventSigning {
                signing_key: signer.signer.signing_key(),
                created_at: &created_at,
            },
        )?;
        let inserted = self.log.clone().insert(event)?;
        anyhow::ensure!(
            inserted.status == IdentityEventInsertStatus::Applied,
            "identity event did not apply: {:?}",
            inserted.status
        );
        self.log = inserted.log;
        Ok(())
    }

    fn state(&self) -> anyhow::Result<IdentityControlState> {
        Ok(IdentityControlState::project(&self.log)?)
    }

    /// The identity as one member installation sees it.
    fn snapshot_for(&self, member: &Member) -> anyhow::Result<IdentityControlSnapshot> {
        Ok(IdentityControlSnapshot::project(
            &IdentityControlSnapshotRequest {
                state: &self.state()?,
                identity_label: "Family",
                current_app_id: member.app.app_id(),
                providers: &[],
            },
        ))
    }

    /// The founder creates a vault; the identity wraps its key to every
    /// active member.
    fn create_vault(&mut self, seed: char) -> anyhow::Result<StoreId> {
        let store_id = StoreId::generate()?;
        let key_epoch = epoch(seed)?;
        let keys = VaultKeys::generate()?;
        let operation = self
            .state()?
            .vault_registration_operation(IdentityVaultRegistration {
                dek: OpenedVaultDek {
                    store_id: &store_id,
                    key_epoch: &key_epoch,
                    keys: &keys,
                },
            })?;
        let founder = Member {
            app: self.founder.app.clone(),
            signer: self.founder.signer.clone(),
        };
        self.append(&founder, operation)?;
        self.vaults.push((store_id.clone(), key_epoch, keys));
        Ok(store_id)
    }

    /// Approving the extension: the web app adds its key, as the connect
    /// request carried it, with every vault's DEK encrypted to it.
    fn add(&mut self, extension: &Member) -> anyhow::Result<()> {
        let founder = Member {
            app: self.founder.app.clone(),
            signer: self.founder.signer.clone(),
        };
        let state = self.state()?;
        let operations = IdentityMemberAdd {
            state: &state,
            approver: &founder.app,
            member: &extension.keys("Browser extension"),
        }
        .addition()?;
        for operation in operations {
            self.append(&founder, operation)?;
        }
        Ok(())
    }
}

/// The browser extension: one local identity per app key it protects.
struct Extension {
    directory: IdentityDirectory,
}

impl Extension {
    fn new() -> Self {
        Self {
            directory: IdentityDirectory::empty(),
        }
    }

    /// Protect a new app key, as the extension's passkey or PIN setup does.
    fn protect(&mut self) -> anyhow::Result<Member> {
        let member = Member::new()?;
        let created = self.directory.clone().create_identity(IdentityCreation {
            label: "Extension",
            app_key: &member.app,
            member_label: MemberLabelState::Unnamed,
        })?;
        self.directory = created.directory;
        Ok(member)
    }

    fn connection_key(
        &self,
        member: &Member,
        local_log: LocalIdentityLog,
    ) -> anyhow::Result<IdentityConnectionKey> {
        Ok(self
            .directory
            .connection_key(&IdentityConnectionKeyRequest {
                app_key: &member.app,
                local_log,
            })?)
    }

    /// `join_identity_from_log`: with the keyring's log the approval handed
    /// over, the local identity takes the keyring's id once this app key is
    /// a member there, and the replicated membership is cached.
    fn join(
        &mut self,
        member: &Member,
        identity: &WebIdentity,
        local_log: LocalIdentityLog,
    ) -> anyhow::Result<()> {
        let state = identity.state()?;
        let plan = IdentityJoinCompletion {
            directory: &self.directory,
            app_key: &member.app,
            state: &state,
            local_log,
        }
        .plan()?;
        let IdentityJoinCompletionPlan::Join(binding) = plan else {
            anyhow::bail!("the web app has not added this app to the keyring");
        };
        if let IdentityInvitationBinding::Adopt { local_identity_id } = binding {
            self.directory =
                self.directory
                    .clone()
                    .adopt_replicated_identity(&ReplicatedIdentityAdoption {
                        local_identity_id: &local_identity_id,
                        replicated_identity_id: &identity.identity_id,
                    })?;
        }
        self.sync(member, identity)
    }

    /// `sync_identity_log_with_provider`: cache the identity log's view of
    /// this app key in the local directory.
    fn sync(&mut self, member: &Member, identity: &WebIdentity) -> anyhow::Result<()> {
        let state = identity.state()?;
        let projection = ReplicatedMembershipRequest {
            state: &state,
            app_key: &member.app,
        }
        .project()?;
        self.directory =
            self.directory
                .clone()
                .apply_replicated_membership(&ReplicatedIdentityMembership {
                    identity_id: &identity.identity_id,
                    app_key: &member.app,
                    members: projection.members,
                    revoked: projection.revoked,
                    own_grants: projection.own_grants,
                    removed_vaults: projection.removed_vaults,
                })?;
        Ok(())
    }

    fn opens(&self, member: &Member, store_id: &StoreId) -> bool {
        self.directory
            .open_vault_dek(IdentityVaultKeyOpening {
                app_key: &member.app,
                store_id: store_id.clone(),
            })
            .is_ok()
    }
}

#[test]
fn the_web_app_adds_the_extension_and_it_joins_from_the_keyring_log() -> anyhow::Result<()> {
    let mut family = WebIdentity::found()?;
    let approved = family.create_vault('A')?;
    let other = family.create_vault('B')?;
    let mut extension = Extension::new();
    let key = extension.protect()?;
    let local_log = key.local_log(&[&family]);
    assert_eq!(
        extension.connection_key(&key, local_log)?,
        IdentityConnectionKey::CurrentAppKey
    );

    family.add(&key)?;
    extension.join(&key, &family, local_log)?;

    let state = family.state()?;
    assert_eq!(
        ReplicatedIdentityStanding::of(&state, key.app.app_id()),
        ReplicatedIdentityStanding::ActiveMember
    );
    assert!(extension.opens(&key, &approved));
    assert!(extension.opens(&key, &other));
    // The approval imported one vault; the keyring's other vault is paired
    // from the records the approval carried, right after the join.
    let plan = IdentityVaultPairingRequest {
        snapshot: &family.snapshot_for(&key)?,
        paired_store_ids: &[approved.to_string()],
    }
    .plan();
    assert_eq!(plan.standing, IdentityControlStanding::Member);
    assert_eq!(plan.to_pair, vec![other.to_string()]);
    Ok(())
}

#[test]
fn only_the_app_the_web_app_added_completes_a_join() -> anyhow::Result<()> {
    let mut family = WebIdentity::found()?;
    family.create_vault('A')?;
    let mut extension = Extension::new();
    let key = extension.protect()?;
    let mut other_browser = Extension::new();
    let stranger = other_browser.protect()?;

    family.add(&key)?;
    let joined = other_browser.join(&stranger, &family, LocalIdentityLog::Empty);

    // The log lists no such app: nothing joins.
    assert!(matches!(
        joined.map_err(anyhow::Error::downcast::<VaultError>),
        Err(Ok(_))
    ));
    assert_eq!(
        ReplicatedIdentityStanding::of(&family.state()?, stranger.app.app_id()),
        ReplicatedIdentityStanding::NotListed
    );
    // The refused join leaves the other browser's own identity as it was.
    assert!(
        other_browser
            .directory
            .identities()
            .iter()
            .all(|record| record.identity_id != family.identity_id)
    );
    Ok(())
}

#[test]
fn a_vault_created_after_the_join_is_paired_on_the_next_sync() -> anyhow::Result<()> {
    let mut family = WebIdentity::found()?;
    let approved = family.create_vault('A')?;
    let mut extension = Extension::new();
    let key = extension.protect()?;
    family.add(&key)?;
    extension.join(&key, &family, LocalIdentityLog::Empty)?;

    let later = family.create_vault('C')?;
    extension.sync(&key, &family)?;

    assert!(extension.opens(&key, &later));
    let plan = IdentityVaultPairingRequest {
        snapshot: &family.snapshot_for(&key)?,
        paired_store_ids: &[approved.to_string()],
    }
    .plan();
    assert_eq!(plan.to_pair, vec![later.to_string()]);
    assert!(plan.awaiting_grant.is_empty());
    Ok(())
}

#[test]
fn a_second_identity_joins_with_a_second_app_key() -> anyhow::Result<()> {
    let mut family = WebIdentity::found()?;
    let family_vault = family.create_vault('A')?;
    let mut work = WebIdentity::found()?;
    let work_vault = work.create_vault('W')?;
    let mut extension = Extension::new();
    let family_key = extension.protect()?;
    family.add(&family_key)?;
    extension.join(&family_key, &family, LocalIdentityLog::Empty)?;

    // The key that joined the family cannot join work as well.
    let family_log = family_key.local_log(&[&family, &work]);
    assert_eq!(
        extension.connection_key(&family_key, family_log)?,
        IdentityConnectionKey::NewAppKey
    );
    // Its connect request therefore carries a new key. Were a keyring to add
    // the family key anyway, the extension refuses to join it with that key.
    let mut school = WebIdentity::found()?;
    school.create_vault('S')?;
    school.add(&family_key)?;
    let refused = extension.join(&family_key, &school, family_log);
    assert!(matches!(
        refused.map_err(anyhow::Error::downcast::<VaultError>),
        Err(Ok(VaultError::MultiDevice(
            MultiDeviceError::AppKeyBelongsToAnotherIdentity { .. }
        )))
    ));

    // "Connect another identity" protects a second key, which joins work.
    let work_key = extension.protect()?;
    let work_log = work_key.local_log(&[&family, &work]);
    assert_eq!(
        extension.connection_key(&work_key, work_log)?,
        IdentityConnectionKey::CurrentAppKey
    );
    work.add(&work_key)?;
    extension.join(&work_key, &work, work_log)?;

    assert_eq!(extension.directory.identities().len(), 2);
    assert!(extension.opens(&family_key, &family_vault));
    assert!(extension.opens(&work_key, &work_vault));
    assert!(!extension.opens(&family_key, &work_vault));
    Ok(())
}
