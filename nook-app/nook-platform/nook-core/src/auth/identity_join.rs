//! Joining an identity by request: a member's answer, and how the asking
//! installation completes once it is answered. A member can also add an app
//! it was shown directly, as the web app adds the browser extension that
//! connects to it; that app completes the same way.
//!
//! A member approves a pending request with every vault of the identity at
//! its current key epoch, each DEK opened through the member's own envelope
//! and wrapped to the joiner, or denies it. The asking installation reads the
//! log again: once its app key is a member, its fresh local identity takes
//! the identity's original id, the same adoption an invite join uses.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{
    AppId, AppKey, IdentityConnectionKey, IdentityDirectory, IdentityId, IdentityInvitationBinding,
    IdentityInvitationBindingRequest, LocalIdentityLog, MultiDeviceError, StoreId, VaultKeys,
};
use nook_event_log::{
    EventError, EventId, IdentityApprovalRequest, IdentityControlOperation, IdentityControlState,
    IdentityMemberAddition, IdentityMemberKeys, IdentityNaming, IdentityVaultDekLookup,
    MemberDevice, OpenedVaultDek,
};

use super::identity_control::ReplicatedIdentityStanding;
use crate::errors::VaultResult;

/// A member's answer to one installation asking to join its identity.
pub struct IdentityJoinAnswer<'a> {
    pub state: &'a IdentityControlState,
    /// The answering member's own app key.
    pub approver: &'a AppKey,
    /// The app key that asked to join.
    pub app_id: &'a AppId,
}

impl IdentityJoinAnswer<'_> {
    fn require_member(&self) -> VaultResult<()> {
        if self.state.member(self.approver.app_id()).is_none() {
            return Err(EventError::IdentityControlInvalid(
                "only a member of the identity answers its join requests".to_owned(),
            )
            .into());
        }
        Ok(())
    }

    /// Every vault's current DEK, opened through the approver's envelope.
    /// A vault the approver cannot open refuses the approval.
    fn opened_vaults(&self) -> VaultResult<Vec<(StoreId, EventId, VaultKeys)>> {
        self.state
            .vaults
            .iter()
            .map(|vault| -> VaultResult<(StoreId, EventId, VaultKeys)> {
                match vault.current_dek_for(self.approver.app_id()) {
                    IdentityVaultDekLookup::Granted(dek) => Ok((
                        vault.store_id.clone(),
                        vault.current_key_epoch.clone(),
                        VaultKeys {
                            secrets_key: self
                                .approver
                                .decrypt_envelope(&dek.secrets_key_ciphertext)?,
                            members_key: self
                                .approver
                                .decrypt_envelope(&dek.members_key_ciphertext)?,
                        },
                    )),
                    IdentityVaultDekLookup::NotGranted => {
                        Err(EventError::IdentityApprovalIncomplete {
                            store_id: vault.store_id.as_str().to_owned(),
                        }
                        .into())
                    }
                }
            })
            .collect()
    }

    /// Approve the request: admit the app key with every vault DEK wrapped
    /// to it, and re-seal the identity's name so the joiner reads it too.
    pub fn approval(&self) -> VaultResult<Vec<IdentityControlOperation>> {
        self.require_member()?;
        let opened = self.opened_vaults()?;
        let vaults = opened
            .iter()
            .map(|(store_id, key_epoch, keys)| OpenedVaultDek {
                store_id,
                key_epoch,
                keys,
            })
            .collect::<Vec<_>>();
        let mut operations = vec![self.state.approval_operation(&IdentityApprovalRequest {
            app_id: self.app_id,
            vaults: &vaults,
        })?];
        if let Some(sealed) = self.state.sealed_name_for(self.approver.app_id()) {
            let name = self.approver.open_utf8(sealed)?;
            let joining = self
                .state
                .pending_join(self.app_id)
                .map(|request| &request.member);
            operations.push(self.state.naming_operation(&IdentityNaming {
                name: &name,
                joining,
            })?);
        }
        Ok(operations)
    }

    /// Deny the request. The app key stays outside the identity.
    pub fn denial(&self) -> VaultResult<IdentityControlOperation> {
        self.require_member()?;
        Ok(self.state.denial_operation(self.app_id)?)
    }
}

/// A member adding an app it was shown directly, with no request from it.
pub struct IdentityMemberAdd<'a> {
    pub state: &'a IdentityControlState,
    /// The adding member's own app key.
    pub approver: &'a AppKey,
    /// The app's keys, as its connect request carried them.
    pub member: &'a IdentityMemberKeys,
}

impl IdentityMemberAdd<'_> {
    /// Add the app with every vault DEK encrypted to its key, and re-seal
    /// the identity's name so it reads it too. An app shown directly runs on
    /// the adding member's device, as the browser extension runs in the
    /// browser of the web app it connects to, so it adds no device.
    pub fn addition(&self) -> VaultResult<Vec<IdentityControlOperation>> {
        let answer = IdentityJoinAnswer {
            state: self.state,
            approver: self.approver,
            app_id: &self.member.app_id,
        };
        answer.require_member()?;
        let opened = answer.opened_vaults()?;
        let vaults = opened
            .iter()
            .map(|(store_id, key_epoch, keys)| OpenedVaultDek {
                store_id,
                key_epoch,
                keys,
            })
            .collect::<Vec<_>>();
        let mut operations = vec![self.state.addition_operation(&IdentityMemberAddition {
            member: self.member,
            vaults: &vaults,
            device: &MemberDevice::SameAs {
                app_id: self.approver.app_id().clone(),
            },
        })?];
        if let Some(sealed) = self.state.sealed_name_for(self.approver.app_id()) {
            let name = self.approver.open_utf8(sealed)?;
            operations.push(self.state.naming_operation(&IdentityNaming {
                name: &name,
                joining: Some(self.member),
            })?);
        }
        Ok(operations)
    }
}

/// Which app key asks to join an identity.
pub struct IdentityJoinKey<'a> {
    pub directory: &'a IdentityDirectory,
    /// The unlocked app key.
    pub app_key: &'a AppKey,
    /// The identity to ask.
    pub invited: &'a IdentityId,
    /// The control log of the app key's current local identity.
    pub local_log: LocalIdentityLog,
}

impl IdentityJoinKey<'_> {
    /// A fresh key asks itself, as an invite join needs. A key that already
    /// belongs to an identity needs a new one, protected for this identity.
    /// A key already bound to the identity, or an identity another key here
    /// holds, is refused.
    pub fn choose(&self) -> VaultResult<IdentityConnectionKey> {
        match self
            .directory
            .invitation_binding(&IdentityInvitationBindingRequest {
                app_key: self.app_key,
                invited: self.invited,
                local_log: self.local_log,
            }) {
            Ok(IdentityInvitationBinding::Adopt { .. }) => Ok(IdentityConnectionKey::CurrentAppKey),
            Ok(IdentityInvitationBinding::AlreadyBound) => Err(EventError::IdentityControlInvalid(
                "this browser already belongs to the identity".to_owned(),
            )
            .into()),
            Err(MultiDeviceError::AppKeyBelongsToAnotherIdentity { .. }) => {
                Ok(IdentityConnectionKey::NewAppKey)
            }
            Err(refused) => Err(refused.into()),
        }
    }
}

/// Where one app key's request to join an identity stands in its log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityJoinProgress {
    /// No member answered the request yet.
    Pending,
    /// A member approved it: the app key is a member.
    Approved,
    /// A member denied it.
    Denied,
    /// The app key was a member and was removed.
    Revoked,
    /// The log holds no request from the app key.
    NotRequested,
}

impl IdentityJoinProgress {
    #[must_use]
    pub fn of(state: &IdentityControlState, app_id: &AppId) -> Self {
        match ReplicatedIdentityStanding::of(state, app_id) {
            ReplicatedIdentityStanding::ActiveMember => Self::Approved,
            ReplicatedIdentityStanding::Revoked => Self::Revoked,
            ReplicatedIdentityStanding::PendingJoin => Self::Pending,
            ReplicatedIdentityStanding::NotListed if state.denied_joins.contains(app_id) => {
                Self::Denied
            }
            ReplicatedIdentityStanding::NotListed => Self::NotRequested,
        }
    }
}

/// The asking installation reads the identity's log again.
pub struct IdentityJoinCompletion<'a> {
    pub directory: &'a IdentityDirectory,
    /// The app key that asked; its fresh local identity holds it.
    pub app_key: &'a AppKey,
    /// The identity's log, as the provider holds it now.
    pub state: &'a IdentityControlState,
    /// The control log of the app key's current local identity.
    pub local_log: LocalIdentityLog,
}

/// What completing a join changes on this browser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityJoinCompletionPlan {
    /// No member answered yet; nothing changes.
    Pending,
    /// A member denied the request; nothing changes.
    Denied,
    /// The app key is a member: bind its local identity to the identity's
    /// original id, then cache the replicated membership and DEK grants.
    Join(IdentityInvitationBinding),
}

impl IdentityJoinCompletion<'_> {
    /// Decide the completion. A removed key, a log without its request, or a
    /// local identity that already belongs elsewhere is refused.
    pub fn plan(&self) -> VaultResult<IdentityJoinCompletionPlan> {
        match IdentityJoinProgress::of(self.state, self.app_key.app_id()) {
            IdentityJoinProgress::Pending => Ok(IdentityJoinCompletionPlan::Pending),
            IdentityJoinProgress::Denied => Ok(IdentityJoinCompletionPlan::Denied),
            IdentityJoinProgress::Approved => Ok(IdentityJoinCompletionPlan::Join(
                self.directory
                    .invitation_binding(&IdentityInvitationBindingRequest {
                        app_key: self.app_key,
                        invited: &self.state.identity_id,
                        local_log: self.local_log,
                    })?,
            )),
            IdentityJoinProgress::Revoked => Err(EventError::IdentityControlInvalid(
                "this app key was removed from the identity".to_owned(),
            )
            .into()),
            IdentityJoinProgress::NotRequested => Err(EventError::IdentityControlInvalid(
                "the identity log holds no join request from this app key".to_owned(),
            )
            .into()),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use super::*;
    use crate::errors::VaultError;
    use crate::{
        EventStorageBytes, IdentityControlLog, IdentityControlSnapshot,
        IdentityControlSnapshotRequest, IdentityControlStanding, IdentityEvent,
        IdentityEventSigning, IdentityGenesisRequest, IdentityJoinRequestPlan, IdentityMemberKeys,
        IdentityVaultRegistration, ProviderIdentityJoinRequest, ReplicatedMembershipRequest,
        SigningIdentity,
    };
    use nook_auth2::{
        IdentityCreation, IdentityVaultKeyOpening, IsoTimestamp, MemberLabel, MemberLabelState,
        ReplicatedIdentityAdoption, ReplicatedIdentityMembership,
    };
    use nook_event_log::MemberVaultDek;

    struct Device {
        app: AppKey,
        signer: SigningIdentity,
    }

    impl Device {
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

    /// An identity at a provider: its founder, two vaults, and its log.
    struct Identity {
        founder: Device,
        log: IdentityControlLog,
        vaults: Vec<(StoreId, VaultKeys)>,
        at: IsoTimestamp,
    }

    impl Identity {
        fn with_two_vaults() -> anyhow::Result<Self> {
            let founder = Device::new()?;
            let at = IsoTimestamp::from_trusted("2026-10-27T09:00:00Z".to_owned());
            let identity_id = IdentityId::generate()?;
            let log = IdentityControlLog::new(identity_id.clone())
                .insert(IdentityEvent::genesis(IdentityGenesisRequest {
                    identity_id: &identity_id,
                    founder: founder.keys("Laptop"),
                    signing: IdentityEventSigning {
                        signing_key: founder.signer.signing_key(),
                        created_at: &at,
                    },
                })?)?
                .log;
            let mut identity = Self {
                founder,
                log,
                vaults: Vec::new(),
                at,
            };
            let epochs = [
                "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo",
                "sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw",
            ];
            for epoch in epochs {
                let store_id = StoreId::generate()?;
                let keys = VaultKeys::generate()?;
                let key_epoch = EventId::parse(epoch)?;
                let register =
                    identity
                        .state()?
                        .vault_registration_operation(IdentityVaultRegistration {
                            dek: OpenedVaultDek {
                                store_id: &store_id,
                                key_epoch: &key_epoch,
                                keys: &keys,
                            },
                        })?;
                identity.append_by_founder(vec![register])?;
                identity.vaults.push((store_id, keys));
            }
            Ok(identity)
        }

        fn state(&self) -> anyhow::Result<IdentityControlState> {
            Ok(IdentityControlState::project(&self.log)?)
        }

        fn append_by_founder(
            &mut self,
            operations: Vec<IdentityControlOperation>,
        ) -> anyhow::Result<()> {
            let event = self.log.build_append(
                operations,
                &IdentityEventSigning {
                    signing_key: self.founder.signer.signing_key(),
                    created_at: &self.at,
                },
            )?;
            self.log = self.log.clone().insert(event)?.log;
            Ok(())
        }

        fn name(&mut self, name: &str) -> anyhow::Result<()> {
            let naming = self.state()?.naming_operation(&IdentityNaming {
                name,
                joining: None,
            })?;
            self.append_by_founder(vec![naming])
        }

        /// The asking device writes its self-signed request at the provider.
        fn receive_request(&mut self, asking: &Device) -> anyhow::Result<()> {
            let events = self
                .log
                .storage_bytes()?
                .into_iter()
                .map(|(_, bytes)| bytes)
                .collect::<Vec<EventStorageBytes>>();
            let IdentityJoinRequestPlan::Write(write) = (ProviderIdentityJoinRequest {
                identity_id: self.log.identity_id(),
                events: &events,
                member: &asking.keys("Phone"),
                signing: &asking.signer,
                created_at: &self.at,
            })
            .plan()?
            else {
                anyhow::bail!("a device outside the identity must write its request");
            };
            let event = IdentityEvent::parse_storage_bytes(&write.bytes)?;
            self.log = self.log.clone().insert(event)?.log;
            Ok(())
        }

        fn answer<'a>(
            &'a self,
            state: &'a IdentityControlState,
            asking: &'a Device,
        ) -> IdentityJoinAnswer<'a> {
            IdentityJoinAnswer {
                state,
                approver: &self.founder.app,
                app_id: asking.app.app_id(),
            }
        }
    }

    /// A browser whose identity in use already has a vault, and a fresh local
    /// identity protecting the app key that asks to join another identity.
    struct Browser {
        directory: IdentityDirectory,
        in_use: IdentityId,
        in_use_vault: StoreId,
        in_use_key: AppKey,
        asking_local: IdentityId,
    }

    impl Browser {
        fn with_identity_in_use_and(asking: &Device) -> anyhow::Result<Self> {
            let in_use_key = AppKey::generate()?;
            let created = IdentityDirectory::empty().create_identity(IdentityCreation {
                label: "Personal",
                app_key: &in_use_key,
                member_label: MemberLabelState::Unnamed,
            })?;
            let in_use = created.identity_id;
            let keys = VaultKeys::generate()?;
            let in_use_vault = StoreId::generate()?;
            let directory =
                created
                    .directory
                    .apply_replicated_membership(&ReplicatedIdentityMembership {
                        identity_id: &in_use,
                        app_key: &in_use_key,
                        members: vec![nook_auth2::IdentityMember {
                            app_id: in_use_key.app_id().clone(),
                            auth_id: in_use_key.auth_id(),
                            public_key: in_use_key.public_key(),
                            signing_public_key: nook_auth2::DeviceSigningPublicKey::Unavailable,
                            label: MemberLabelState::Unnamed,
                        }],
                        revoked: Vec::new(),
                        own_grants: vec![nook_auth2::ReplicatedVaultGrant {
                            store_id: in_use_vault.clone(),
                            secrets_envelope: in_use_key
                                .public_key()
                                .seal_bytes(keys.secrets_key.as_str().as_bytes())?,
                            members_envelope: in_use_key
                                .public_key()
                                .seal_bytes(keys.members_key.as_str().as_bytes())?,
                        }],
                        removed_vaults: Vec::new(),
                    })?;
            let fresh = directory.create_identity(IdentityCreation {
                label: "Work",
                app_key: &asking.app,
                member_label: MemberLabelState::Unnamed,
            })?;
            Ok(Self {
                directory: fresh.directory,
                in_use,
                in_use_vault,
                in_use_key,
                asking_local: fresh.identity_id,
            })
        }

        fn completion(
            &self,
            asking: &Device,
            state: &IdentityControlState,
        ) -> anyhow::Result<IdentityJoinCompletionPlan> {
            Ok(IdentityJoinCompletion {
                directory: &self.directory,
                app_key: &asking.app,
                state,
                local_log: LocalIdentityLog::Empty,
            }
            .plan()?)
        }

        /// What the browser does with a `Join` plan: the same adoption an
        /// invite join uses, then the replicated membership.
        fn join(
            mut self,
            asking: &Device,
            state: &IdentityControlState,
            binding: &IdentityInvitationBinding,
        ) -> anyhow::Result<Self> {
            if let IdentityInvitationBinding::Adopt { local_identity_id } = binding {
                self.directory =
                    self.directory
                        .adopt_replicated_identity(&ReplicatedIdentityAdoption {
                            local_identity_id,
                            replicated_identity_id: &state.identity_id,
                        })?;
            }
            let projection = ReplicatedMembershipRequest {
                state,
                app_key: &asking.app,
            }
            .project()?;
            self.directory =
                self.directory
                    .apply_replicated_membership(&ReplicatedIdentityMembership {
                        identity_id: &state.identity_id,
                        app_key: &asking.app,
                        members: projection.members,
                        revoked: projection.revoked,
                        own_grants: projection.own_grants,
                        removed_vaults: projection.removed_vaults,
                    })?;
            Ok(self)
        }
    }

    #[test]
    fn a_join_request_is_approved_with_every_vault_dek_of_the_identity() -> anyhow::Result<()> {
        let mut identity = Identity::with_two_vaults()?;
        identity.name("Family")?;
        let asking = Device::new()?;
        identity.receive_request(&asking)?;

        let state = identity.state()?;
        let approval = identity.answer(&state, &asking).approval()?;
        identity.append_by_founder(approval)?;

        let state = identity.state()?;
        assert!(state.member(asking.app.app_id()).is_some());
        assert!(state.pending_joins.is_empty());
        for (store_id, keys) in &identity.vaults {
            let vault = state
                .vault(store_id)
                .ok_or_else(|| anyhow::anyhow!("the vault stays registered"))?;
            let IdentityVaultDekLookup::Granted(dek) = vault.current_dek_for(asking.app.app_id())
            else {
                anyhow::bail!("the joiner must hold the DEK of {store_id}");
            };
            assert_eq!(
                asking.app.decrypt_envelope(&dek.secrets_key_ciphertext)?,
                keys.secrets_key
            );
            assert_eq!(
                asking.app.decrypt_envelope(&dek.members_key_ciphertext)?,
                keys.members_key
            );
        }
        // The identity's name is sealed to the joiner as well.
        let sealed = state
            .sealed_name_for(asking.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the joiner must hold the identity name"))?;
        assert_eq!(asking.app.open_utf8(sealed)?, "Family");
        Ok(())
    }

    #[test]
    fn a_member_adds_an_app_it_was_shown_and_the_app_completes_its_join() -> anyhow::Result<()> {
        let mut identity = Identity::with_two_vaults()?;
        identity.name("Family")?;
        // The browser extension's keys came with its connect request; it
        // asked nothing in the log.
        let extension = Device::new()?;
        let keys = extension.keys("Nook extension");

        let state = identity.state()?;
        let addition = IdentityMemberAdd {
            state: &state,
            approver: &identity.founder.app,
            member: &keys,
        }
        .addition()?;
        identity.append_by_founder(addition)?;

        let state = identity.state()?;
        assert!(state.member(extension.app.app_id()).is_some());
        for (store_id, vault_keys) in &identity.vaults {
            let vault = state
                .vault(store_id)
                .ok_or_else(|| anyhow::anyhow!("the vault stays registered"))?;
            let IdentityVaultDekLookup::Granted(dek) =
                vault.current_dek_for(extension.app.app_id())
            else {
                anyhow::bail!("the added app must hold the DEK of {store_id}");
            };
            assert_eq!(
                extension
                    .app
                    .decrypt_envelope(&dek.secrets_key_ciphertext)?,
                vault_keys.secrets_key
            );
        }
        let sealed = state
            .sealed_name_for(extension.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the added app must hold the identity name"))?;
        assert_eq!(extension.app.open_utf8(sealed)?, "Family");
        assert_eq!(
            IdentityJoinProgress::of(&state, extension.app.app_id()),
            IdentityJoinProgress::Approved
        );

        // Only a member adds apps.
        let stranger = Device::new()?;
        let refused = IdentityMemberAdd {
            state: &state,
            approver: &stranger.app,
            member: &Device::new()?.keys("Another"),
        }
        .addition();
        assert!(refused.is_err());
        Ok(())
    }

    #[test]
    fn a_member_sees_the_request_to_answer_and_the_asking_device_does_not() -> anyhow::Result<()> {
        let mut identity = Identity::with_two_vaults()?;
        let asking = Device::new()?;
        identity.receive_request(&asking)?;
        let state = identity.state()?;
        let view = |app_id: &AppId| {
            IdentityControlSnapshot::project(&IdentityControlSnapshotRequest {
                state: &state,
                identity_label: "Family",
                current_app_id: app_id,
                providers: &[],
            })
        };

        let member = view(identity.founder.app.app_id());
        let [request] = member.join_requests.as_slice() else {
            anyhow::bail!("the member must see exactly one request");
        };
        assert_eq!(request.app_id, asking.app.app_id().as_str());
        assert_eq!(request.label, "Phone");
        assert_eq!(request.requested_at, identity.at.as_str());

        let asking_view = view(asking.app.app_id());
        assert_eq!(asking_view.standing, IdentityControlStanding::PendingJoin);
        assert!(asking_view.join_requests.is_empty());
        Ok(())
    }

    #[test]
    fn only_a_member_holding_every_vault_dek_can_approve() -> anyhow::Result<()> {
        let mut identity = Identity::with_two_vaults()?;
        let asking = Device::new()?;
        identity.receive_request(&asking)?;
        let state = identity.state()?;

        // An outsider answers nothing.
        let stranger = Device::new()?;
        let by_stranger = IdentityJoinAnswer {
            state: &state,
            approver: &stranger.app,
            app_id: asking.app.app_id(),
        };
        assert!(by_stranger.approval().is_err());
        assert!(by_stranger.denial().is_err());

        // A vault whose current epoch the approver holds no envelope for
        // refuses the approval instead of admitting a member without it.
        let store_id = identity
            .vaults
            .first()
            .map(|(store_id, _)| store_id.clone())
            .ok_or_else(|| anyhow::anyhow!("the identity keeps two vaults"))?;
        let rotated = VaultKeys::generate()?;
        let other = AppKey::generate()?;
        identity.append_by_founder(vec![IdentityControlOperation::VaultDekGranted {
            store_id: store_id.clone(),
            key_epoch: EventId::parse("sha256u:7777777777777777777777777777777777777777770")?,
            recipients: vec![MemberVaultDek {
                app_id: other.app_id().clone(),
                secrets_key_ciphertext: other
                    .public_key()
                    .seal_bytes(rotated.secrets_key.as_str().as_bytes())?,
                members_key_ciphertext: other
                    .public_key()
                    .seal_bytes(rotated.members_key.as_str().as_bytes())?,
            }],
        }])?;
        let state = identity.state()?;
        let refused = identity.answer(&state, &asking).approval();
        assert!(matches!(
            refused,
            Err(VaultError::Event(
                EventError::IdentityApprovalIncomplete { store_id: refused }
            )) if refused == store_id.as_str()
        ));
        Ok(())
    }

    #[test]
    fn a_denied_request_adds_nothing() -> anyhow::Result<()> {
        let mut identity = Identity::with_two_vaults()?;
        let asking = Device::new()?;
        identity.receive_request(&asking)?;
        let browser = Browser::with_identity_in_use_and(&asking)?;
        assert_eq!(
            browser.completion(&asking, &identity.state()?)?,
            IdentityJoinCompletionPlan::Pending
        );

        let state = identity.state()?;
        let denial = identity.answer(&state, &asking).denial()?;
        identity.append_by_founder(vec![denial])?;

        let state = identity.state()?;
        assert_eq!(
            IdentityJoinProgress::of(&state, asking.app.app_id()),
            IdentityJoinProgress::Denied
        );
        assert_eq!(
            browser.completion(&asking, &state)?,
            IdentityJoinCompletionPlan::Denied
        );
        assert!(state.member(asking.app.app_id()).is_none());
        assert!(
            ReplicatedMembershipRequest {
                state: &state,
                app_key: &asking.app,
            }
            .project()?
            .own_grants
            .is_empty()
        );
        Ok(())
    }

    #[test]
    fn completion_adds_the_identity_under_its_original_id_beside_the_one_in_use()
    -> anyhow::Result<()> {
        let mut identity = Identity::with_two_vaults()?;
        let asking = Device::new()?;
        identity.receive_request(&asking)?;
        let state = identity.state()?;
        let approval = identity.answer(&state, &asking).approval()?;
        identity.append_by_founder(approval)?;
        let state = identity.state()?;

        let browser = Browser::with_identity_in_use_and(&asking)?;
        let IdentityJoinCompletionPlan::Join(binding) = browser.completion(&asking, &state)? else {
            anyhow::bail!("an approved request must join");
        };
        assert_eq!(
            binding,
            IdentityInvitationBinding::Adopt {
                local_identity_id: browser.asking_local.clone(),
            }
        );
        let in_use = browser.in_use.clone();
        let in_use_vault = browser.in_use_vault.clone();
        let in_use_key = browser.in_use_key.clone();
        let asking_local = browser.asking_local.clone();
        let joined = browser.join(&asking, &state, &binding)?;

        let ids = joined
            .directory
            .identities()
            .iter()
            .map(|record| record.identity_id.clone())
            .collect::<Vec<_>>();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&in_use));
        assert!(ids.contains(&state.identity_id));
        assert!(!ids.contains(&asking_local));
        // The identity in use keeps its own vault and key.
        assert!(
            joined
                .directory
                .open_vault_dek(IdentityVaultKeyOpening {
                    app_key: &in_use_key,
                    store_id: in_use_vault,
                })
                .is_ok()
        );
        // The joined identity opens every vault it keeps with the asking key.
        for (store_id, keys) in &identity.vaults {
            let opened = joined.directory.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &asking.app,
                store_id: store_id.clone(),
            })?;
            assert_eq!(opened.secrets_key, keys.secrets_key);
        }

        // Completing again changes nothing more: the key is already bound.
        assert_eq!(
            joined.completion(&asking, &state)?,
            IdentityJoinCompletionPlan::Join(IdentityInvitationBinding::AlreadyBound)
        );
        Ok(())
    }

    #[test]
    fn a_log_without_this_keys_request_completes_nothing() -> anyhow::Result<()> {
        let identity = Identity::with_two_vaults()?;
        let asking = Device::new()?;
        let browser = Browser::with_identity_in_use_and(&asking)?;
        assert!(browser.completion(&asking, &identity.state()?).is_err());
        Ok(())
    }

    #[test]
    fn a_fresh_key_asks_itself_and_a_key_in_use_needs_a_new_one() -> anyhow::Result<()> {
        let identity = Identity::with_two_vaults()?;
        let asking = Device::new()?;
        let browser = Browser::with_identity_in_use_and(&asking)?;
        let key = |app_key: &AppKey, invited: &IdentityId| {
            IdentityJoinKey {
                directory: &browser.directory,
                app_key,
                invited,
                local_log: LocalIdentityLog::Empty,
            }
            .choose()
        };
        let invited = identity.log.identity_id();

        assert_eq!(
            key(&asking.app, invited)?,
            IdentityConnectionKey::CurrentAppKey
        );
        // The identity in use keeps its vaults: it asks with a new key.
        assert_eq!(
            key(&browser.in_use_key, invited)?,
            IdentityConnectionKey::NewAppKey
        );
        // An identity this browser already holds is not asked for again.
        assert!(key(&asking.app, &browser.in_use).is_err());
        Ok(())
    }
}
