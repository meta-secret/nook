//! Replicated, signed identity control log.
//!
//! The identity control log is the membership authority for an identity: its
//! app-key members, pending joins, revocations, per-vault DEK envelopes, and
//! credential-free sync-provider mounts. Events reuse the vault log's
//! canonical JSON, Ed25519 actor signatures, and causal DAG mechanics, but
//! live in their own namespace and never mix with vault events.

mod builder;
mod graph;
mod projection;
mod wire;

pub use builder::{
    IdentityApprovalRequest, IdentityEventSigning, IdentityGenesisRequest, IdentityInviteIssue,
    IdentityInviteJoin, IdentityNaming, IdentityVaultRegistration, OpenedVaultDek,
};
pub use graph::{
    IdentityControlInsertion, IdentityControlLog, IdentityControlRejection,
    IdentityEventInsertStatus,
};
pub use projection::{
    IdentityControlMember, IdentityControlState, IdentityControlVault, IdentityJoinRequest,
    IdentityVaultDekLookup, IdentityVaultEpochDeks,
};
pub use wire::{
    IdentityControlOperation, IdentityEvent, IdentityEventBody, IdentityEventSchemaVersion,
    IdentityInvite, IdentityInviteProof, IdentityMemberKeys, IdentityMountTarget,
    IdentityProviderMount, IdentityVaultDekGrant, MemberSealedName, MemberVaultDek,
    ProviderMountId,
};

#[cfg(test)]
pub(crate) mod test_fixtures {
    //! Shared fixtures for the identity control behavior tests.

    pub(crate) use ed25519_dalek::SigningKey;
    pub(crate) use nook_auth2::{
        AppKey, IdentityId, IdentityInviteId, IsoTimestamp, MemberLabel, StoreId, VaultKeys,
    };

    pub(crate) use super::*;
    pub(crate) use crate::test_support::{public_key, signing_key};
    pub(crate) use crate::{EventError, EventId, EventStorageBytes};

    pub(crate) struct Installation {
        pub(crate) app: AppKey,
        pub(crate) signer: SigningKey,
    }

    impl Installation {
        pub(crate) fn new() -> anyhow::Result<Self> {
            Ok(Self {
                app: AppKey::generate()?,
                signer: signing_key(),
            })
        }

        pub(crate) fn keys(&self, label: &str) -> IdentityMemberKeys {
            IdentityMemberKeys {
                app_id: self.app.app_id().clone(),
                encryption_public_key: self.app.public_key(),
                signing_public_key: public_key(&self.signer),
                label: MemberLabel::from_trusted(label.to_owned()),
            }
        }

        pub(crate) fn signing<'a>(&'a self, at: &'a IsoTimestamp) -> IdentityEventSigning<'a> {
            IdentityEventSigning {
                signing_key: &self.signer,
                created_at: at,
            }
        }
    }

    /// The invite a joiner holds: its id, key, and the vault DEKs it carries.
    pub(crate) struct InviteJoinFixture<'a> {
        pub(crate) invite_id: &'a IdentityInviteId,
        pub(crate) invite_key: &'a SigningKey,
        pub(crate) vaults: &'a [OpenedVaultDek<'a>],
    }

    pub(crate) struct Fixture {
        pub(crate) identity_id: IdentityId,
        pub(crate) at: IsoTimestamp,
        pub(crate) founder: Installation,
        pub(crate) log: IdentityControlLog,
    }

    impl Fixture {
        pub(crate) fn new() -> anyhow::Result<Self> {
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

        pub(crate) fn append(
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

        pub(crate) fn state(&self) -> anyhow::Result<IdentityControlState> {
            Ok(IdentityControlState::project(&self.log)?)
        }

        pub(crate) fn request_join(
            &mut self,
            joiner: &Installation,
        ) -> anyhow::Result<IdentityEvent> {
            let (event, status) = self.append(
                joiner,
                vec![IdentityControlOperation::MemberJoinRequested {
                    member: joiner.keys("Phone"),
                }],
            )?;
            assert_eq!(status, IdentityEventInsertStatus::Applied);
            Ok(event)
        }

        pub(crate) fn register_vault(
            &mut self,
            keys: &VaultKeys,
            store_id: &StoreId,
        ) -> anyhow::Result<EventId> {
            let key_epoch = epoch_id(store_id.as_str())?;
            let operation =
                self.state()?
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

        /// The founder issues a one-time invite; returns its id and key.
        pub(crate) fn issue_invite(&mut self) -> anyhow::Result<(IdentityInviteId, SigningKey)> {
            let invite_id = IdentityInviteId::generate()?;
            let invite_key = signing_key();
            let expires_at = IsoTimestamp::from_trusted("2026-10-13T00:00:00Z".to_owned());
            let operation = IdentityInviteIssue {
                invite_id: &invite_id,
                invite_key: &invite_key,
                expires_at: &expires_at,
            }
            .operation();
            let founder = self.founder();
            let (_, status) = self.append(&founder, vec![operation])?;
            assert_eq!(status, IdentityEventInsertStatus::Applied);
            Ok((invite_id, invite_key))
        }

        /// The joiner's self-signed invite join, built on the current heads.
        pub(crate) fn invite_join_event(
            &self,
            joiner: &Installation,
            join: &InviteJoinFixture<'_>,
        ) -> anyhow::Result<IdentityEvent> {
            let operation = IdentityInviteJoin {
                identity_id: &self.identity_id,
                invite_id: join.invite_id,
                invite_key: join.invite_key,
                member: &joiner.keys("Phone"),
                vaults: join.vaults,
            }
            .operation()?;
            Ok(self
                .log
                .build_append(vec![operation], &joiner.signing(&self.at))?)
        }

        pub(crate) fn founder(&self) -> Installation {
            Installation {
                app: self.founder.app.clone(),
                signer: self.founder.signer.clone(),
            }
        }
    }

    pub(crate) fn rename(app_id: &nook_auth2::AppId, label: &str) -> IdentityControlOperation {
        IdentityControlOperation::MemberRenamed {
            app_id: app_id.clone(),
            label: MemberLabel::from_trusted(label.to_owned()),
        }
    }

    pub(crate) fn member_label(state: &IdentityControlState, app_id: &nook_auth2::AppId) -> String {
        state
            .member(app_id)
            .map(|member| member.keys.label.as_str().to_owned())
            .unwrap_or_default()
    }

    pub(crate) fn epoch_id(seed: &str) -> anyhow::Result<EventId> {
        Ok(EventId::from_sha256_hex(&hex::encode(
            <sha2::Sha256 as sha2::Digest>::digest(seed.as_bytes()),
        ))?)
    }
}
