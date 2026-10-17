//! The browser extension joins identities as a member device: an approval
//! hands it an invite whose passphrase is sealed to its app key, it signs
//! itself into the identity, pairs vaults members create later, and joins a
//! second identity with a second app key.
//!
//! This composes the same domain steps `join_identity_with_sealed_invite`
//! runs in the extension's offscreen WASM session, without a sync provider.

use nook_core::{
    AppKey, CheckedEnrollmentEnvelope, EnrollmentIdentityTarget, EnrollmentInvite,
    EnrollmentInviteVault, EnrollmentIssuance, EnrollmentIssueInput, EnrollmentLinkInput,
    EnrollmentProvider, EventId, IdentityConnectionKey, IdentityConnectionKeyRequest,
    IdentityControlLog, IdentityControlOperation, IdentityControlSnapshot,
    IdentityControlSnapshotRequest, IdentityControlStanding, IdentityControlState,
    IdentityCreation, IdentityDirectory, IdentityEvent, IdentityEventInsertStatus,
    IdentityEventSigning, IdentityGenesisRequest, IdentityId, IdentityInvitationBinding,
    IdentityInvitationBindingRequest, IdentityInviteId, IdentityInviteIssue, IdentityInviteJoin,
    IdentityMemberKeys, IdentityVaultEventId, IdentityVaultKeyOpening, IdentityVaultPairingRequest,
    IdentityVaultRegistration, InvitePassphraseOpen, InvitePassphraseSeal, InviteSigningSeed,
    IsoTimestamp, LocalIdentityLog, MemberLabel, MemberLabelState, MultiDeviceError,
    OpenedVaultDek, PersonalEnrollmentProvider, ReplicatedIdentityAdoption,
    ReplicatedIdentityMembership, ReplicatedIdentityStanding, ReplicatedMembershipRequest,
    SigningIdentity, StoreId, VaultError, VaultKeys,
};

const PASSPHRASE: &str = "orbit-lantern-kitten-meadow";

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

    /// Approving the extension: record an invite and issue its code, with
    /// the code's passphrase sealed to the extension's app key.
    fn invite(&mut self, extension: &AppKey) -> anyhow::Result<SealedInvite> {
        let invite_id = IdentityInviteId::generate()?;
        let signing_seed = InviteSigningSeed::generate()?;
        let expires_at = IsoTimestamp::from_trusted("2026-10-17T12:00:00Z".to_owned());
        let founder = Member {
            app: self.founder.app.clone(),
            signer: self.founder.signer.clone(),
        };
        self.append(
            &founder,
            IdentityInviteIssue {
                invite_id: &invite_id,
                invite_key: &signing_seed.signing_key()?,
                expires_at: &expires_at,
            }
            .operation(),
        )?;
        let vaults = self
            .vaults
            .iter()
            .map(|(store_id, key_epoch, keys)| {
                Ok(EnrollmentInviteVault {
                    store_id: store_id.clone(),
                    key_epoch: IdentityVaultEventId::parse(key_epoch.as_str())?,
                    secrets_key: keys.secrets_key.clone(),
                    members_key: keys.members_key.clone(),
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
                "github_pat_11AAAAbbbbCCCC".to_owned(),
                "family-vault".to_owned(),
            )),
            identity: EnrollmentIdentityTarget {
                identity_id: self.identity_id.clone(),
                label: "Family".to_owned(),
            },
            invite: EnrollmentInvite {
                invite_id,
                signing_seed,
                vaults,
            },
            entry_id: "extension".to_owned(),
            issued_at: "2026-10-16T12:00:00Z".to_owned(),
        };
        let code = EnrollmentIssuance {
            input: &input,
            password: PASSPHRASE,
            entry_label: "",
        }
        .check()?
        .issue()?;
        let sealed_passphrase = InvitePassphraseSeal {
            recipient: &extension.public_key(),
            passphrase: PASSPHRASE,
        }
        .seal()?;
        Ok(SealedInvite {
            identity_id: self.identity_id.clone(),
            code,
            sealed_passphrase,
        })
    }
}

/// What an approval hands the extension.
struct SealedInvite {
    identity_id: IdentityId,
    code: String,
    sealed_passphrase: nook_core::AgeArmoredCiphertext,
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

    /// `join_identity_with_sealed_invite`: open the passphrase with the app
    /// key, bind the local identity, decrypt the code, sign the join, and
    /// cache the replicated membership.
    fn join(
        &mut self,
        member: &Member,
        invite: &SealedInvite,
        identity: &mut WebIdentity,
        local_log: LocalIdentityLog,
    ) -> anyhow::Result<()> {
        let passphrase = InvitePassphraseOpen {
            identity: &member.app,
            sealed: &invite.sealed_passphrase,
        }
        .open()?;
        let binding = self
            .directory
            .invitation_binding(&IdentityInvitationBindingRequest {
                app_key: &member.app,
                invited: &invite.identity_id,
                local_log,
            })?;
        if let IdentityInvitationBinding::Adopt { local_identity_id } = binding {
            self.directory =
                self.directory
                    .clone()
                    .adopt_replicated_identity(&ReplicatedIdentityAdoption {
                        local_identity_id: &local_identity_id,
                        replicated_identity_id: &invite.identity_id,
                    })?;
        }
        let normalized = EnrollmentLinkInput {
            input: &invite.code,
        }
        .normalize();
        let payload =
            CheckedEnrollmentEnvelope::parse(&normalized)?.decrypt(passphrase.as_str())?;
        anyhow::ensure!(
            identity
                .log
                .issued_invite_now(&payload.invite.invite_id)
                .is_some(),
            "the invite reached the identity log"
        );
        let epochs = payload
            .invite
            .vaults
            .iter()
            .map(|vault| EventId::parse(vault.key_epoch.as_str()))
            .collect::<Result<Vec<_>, _>>()?;
        let keys = payload
            .invite
            .vaults
            .iter()
            .map(EnrollmentInviteVault::keys)
            .collect::<Vec<_>>();
        let vaults = payload
            .invite
            .vaults
            .iter()
            .zip(epochs.iter().zip(keys.iter()))
            .map(|(vault, (key_epoch, keys))| OpenedVaultDek {
                store_id: &vault.store_id,
                key_epoch,
                keys,
            })
            .collect::<Vec<_>>();
        let operation = IdentityInviteJoin {
            identity_id: &invite.identity_id,
            invite_id: &payload.invite.invite_id,
            invite_key: &payload.invite.signing_seed.signing_key()?,
            member: &member.keys("Browser extension"),
            vaults: &vaults,
        }
        .operation()?;
        identity.append(member, operation)?;
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
fn the_extension_joins_an_identity_with_the_invite_sealed_to_it() -> anyhow::Result<()> {
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

    let invite = family.invite(&key.app)?;
    extension.join(&key, &invite, &mut family, local_log)?;

    let state = family.state()?;
    assert_eq!(
        ReplicatedIdentityStanding::of(&state, key.app.app_id()),
        ReplicatedIdentityStanding::ActiveMember
    );
    assert!(extension.opens(&key, &approved));
    assert!(extension.opens(&key, &other));
    // The approval imported one vault; the identity's other vault is paired
    // through the identity right after the join.
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
fn only_the_extension_the_invite_was_sealed_to_can_join() -> anyhow::Result<()> {
    let mut family = WebIdentity::found()?;
    family.create_vault('A')?;
    let mut extension = Extension::new();
    let key = extension.protect()?;
    let mut other_browser = Extension::new();
    let stranger = other_browser.protect()?;

    let invite = family.invite(&key.app)?;
    let joined = other_browser.join(&stranger, &invite, &mut family, LocalIdentityLog::Empty);

    // The passphrase does not open with the stranger's key.
    assert!(matches!(
        joined.map_err(anyhow::Error::downcast::<VaultError>),
        Err(Ok(_))
    ));
    assert_eq!(
        ReplicatedIdentityStanding::of(&family.state()?, stranger.app.app_id()),
        ReplicatedIdentityStanding::NotListed
    );
    // The refused invite leaves the other browser's own identity as it was.
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
    let invite = family.invite(&key.app)?;
    extension.join(&key, &invite, &mut family, LocalIdentityLog::Empty)?;

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
    let invite = family.invite(&family_key.app)?;
    extension.join(&family_key, &invite, &mut family, LocalIdentityLog::Empty)?;

    // The key that joined the family cannot join work as well.
    let family_log = family_key.local_log(&[&family, &work]);
    assert_eq!(
        extension.connection_key(&family_key, family_log)?,
        IdentityConnectionKey::NewAppKey
    );
    let refused_invite = work.invite(&family_key.app)?;
    let refused = extension.join(&family_key, &refused_invite, &mut work, family_log);
    assert!(matches!(
        refused.map_err(anyhow::Error::downcast::<MultiDeviceError>),
        Err(Ok(MultiDeviceError::AppKeyBelongsToAnotherIdentity { .. }))
    ));

    // "Connect another identity" protects a second key, which joins work.
    let work_key = extension.protect()?;
    let work_log = work_key.local_log(&[&family, &work]);
    assert_eq!(
        extension.connection_key(&work_key, work_log)?,
        IdentityConnectionKey::CurrentAppKey
    );
    let invite = work.invite(&work_key.app)?;
    extension.join(&work_key, &invite, &mut work, work_log)?;

    assert_eq!(extension.directory.identities().len(), 2);
    assert!(extension.opens(&family_key, &family_vault));
    assert!(extension.opens(&work_key, &work_vault));
    assert!(!extension.opens(&family_key, &work_vault));
    Ok(())
}
