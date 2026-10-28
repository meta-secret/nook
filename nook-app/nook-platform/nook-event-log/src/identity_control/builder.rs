//! Signed identity control appends and DEK-wrapping operation builders.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use ed25519_dalek::SigningKey;
use nook_auth2::{
    AppId, DeviceSigningPublicKey, IdentityId, IdentityInviteId, IsoTimestamp, StoreId, VaultKeys,
};

use super::graph::IdentityControlLog;
use super::projection::IdentityControlState;
use super::wire::{
    IdentityControlOperation, IdentityEvent, IdentityEventBody, IdentityEventSchemaVersion,
    IdentityInvite, IdentityInviteProof, IdentityMemberKeys, IdentityVaultDekGrant,
    MemberSealedName, MemberVaultDek,
};
use crate::signing::SigningIdentity;
use crate::{EventError, EventId, EventResult};

/// Named values required to sign one identity control event.
pub struct IdentityEventSigning<'a> {
    pub signing_key: &'a SigningKey,
    pub created_at: &'a IsoTimestamp,
}

/// Named values required to create an identity's genesis event.
pub struct IdentityGenesisRequest<'a> {
    pub identity_id: &'a IdentityId,
    pub founder: IdentityMemberKeys,
    pub signing: IdentityEventSigning<'a>,
}

/// One vault's DEK at a key epoch, opened by the acting member.
#[derive(Clone, Copy)]
pub struct OpenedVaultDek<'a> {
    pub store_id: &'a StoreId,
    pub key_epoch: &'a EventId,
    pub keys: &'a VaultKeys,
}

/// Named values required to approve a pending join.
pub struct IdentityApprovalRequest<'a> {
    pub app_id: &'a AppId,
    /// Every vault the identity owns, opened by the approver at its current epoch.
    pub vaults: &'a [OpenedVaultDek<'a>],
}

/// Named values required to name an identity.
pub struct IdentityNaming<'a> {
    pub name: &'a str,
    /// A member joining in the same event, who must be able to read it too.
    pub joining: Option<&'a IdentityMemberKeys>,
}

/// Named values required to register a vault with its owning identity.
#[derive(Clone, Copy)]
pub struct IdentityVaultRegistration<'a> {
    pub dek: OpenedVaultDek<'a>,
}

impl IdentityEvent {
    fn signed(
        identity_id: &IdentityId,
        parents: Vec<EventId>,
        operations: Vec<IdentityControlOperation>,
        signing: &IdentityEventSigning<'_>,
    ) -> EventResult<Self> {
        let verifying_key = signing.signing_key.verifying_key();
        let body = IdentityEventBody {
            schema_version: IdentityEventSchemaVersion::CURRENT,
            identity_id: identity_id.clone(),
            actor_id: SigningIdentity::actor_id_for_verifying_key(&verifying_key)?,
            actor_signing_public_key: DeviceSigningPublicKey::from_trusted(hex::encode(
                verifying_key.as_bytes(),
            )),
            parents,
            created_at: signing.created_at.clone(),
            operations,
        };
        Self::sign(body, signing.signing_key)
    }

    /// Create the founder-signed genesis event.
    pub fn genesis(request: IdentityGenesisRequest<'_>) -> EventResult<Self> {
        let IdentityGenesisRequest {
            identity_id,
            founder,
            signing,
        } = request;
        Self::signed(
            identity_id,
            Vec::new(),
            vec![IdentityControlOperation::IdentityCreated { founder }],
            &signing,
        )
    }
}

impl IdentityControlLog {
    /// Sign operations on top of every applicable head.
    pub fn build_append(
        &self,
        operations: Vec<IdentityControlOperation>,
        signing: &IdentityEventSigning<'_>,
    ) -> EventResult<IdentityEvent> {
        let heads = self.applicable_heads();
        if heads.is_empty() {
            return Err(EventError::IdentityControlInvalid(
                "identity log has no applicable genesis to extend".to_owned(),
            ));
        }
        IdentityEvent::signed(self.identity_id(), heads, operations, signing)
    }
}

impl IdentityMemberKeys {
    pub(super) fn wrap_vault_keys(&self, keys: &VaultKeys) -> EventResult<MemberVaultDek> {
        let seal = |plaintext: &str| {
            self.encryption_public_key
                .seal_bytes(plaintext.as_bytes())
                .map_err(|error| EventError::IdentityControlInvalid(error.to_string()))
        };
        Ok(MemberVaultDek {
            app_id: self.app_id.clone(),
            secrets_key_ciphertext: seal(keys.secrets_key.as_str())?,
            members_key_ciphertext: seal(keys.members_key.as_str())?,
        })
    }

    /// Each opened vault's DEK pair wrapped to this member.
    fn vault_dek_grants(
        &self,
        vaults: &[OpenedVaultDek<'_>],
    ) -> EventResult<Vec<IdentityVaultDekGrant>> {
        vaults
            .iter()
            .map(|opened| {
                let wrapped = self.wrap_vault_keys(opened.keys)?;
                Ok(IdentityVaultDekGrant {
                    store_id: opened.store_id.clone(),
                    key_epoch: opened.key_epoch.clone(),
                    secrets_key_ciphertext: wrapped.secrets_key_ciphertext,
                    members_key_ciphertext: wrapped.members_key_ciphertext,
                })
            })
            .collect()
    }
}

/// Named values a member needs to issue a one-time invite.
pub struct IdentityInviteIssue<'a> {
    pub invite_id: &'a IdentityInviteId,
    pub invite_key: &'a SigningKey,
    pub expires_at: &'a IsoTimestamp,
}

impl IdentityInviteIssue<'_> {
    #[must_use]
    pub fn operation(&self) -> IdentityControlOperation {
        IdentityControlOperation::MemberInvited {
            invite: IdentityInvite {
                invite_id: self.invite_id.clone(),
                signing_public_key: DeviceSigningPublicKey::from_trusted(hex::encode(
                    self.invite_key.verifying_key().as_bytes(),
                )),
                expires_at: self.expires_at.clone(),
            },
        }
    }
}

/// Named values a joiner needs to sign itself into an identity with an
/// invite: the invite key from the code, its own keys, and the vault DEKs
/// the code carried.
pub struct IdentityInviteJoin<'a> {
    pub identity_id: &'a IdentityId,
    pub invite_id: &'a IdentityInviteId,
    pub invite_key: &'a SigningKey,
    pub member: &'a IdentityMemberKeys,
    pub vaults: &'a [OpenedVaultDek<'a>],
}

impl IdentityInviteJoin<'_> {
    pub fn operation(&self) -> EventResult<IdentityControlOperation> {
        let invite_signature = IdentityInviteProof {
            identity_id: self.identity_id,
            invite_id: self.invite_id,
            member: self.member,
        }
        .sign(self.invite_key)?;
        Ok(IdentityControlOperation::MemberJoinedByInvite {
            invite_id: self.invite_id.clone(),
            member: self.member.clone(),
            invite_signature,
            vault_deks: self.member.vault_dek_grants(self.vaults)?,
        })
    }
}

impl IdentityControlState {
    /// Approve a pending join and wrap every owned vault's DEK to the joiner.
    pub fn approval_operation(
        &self,
        request: &IdentityApprovalRequest<'_>,
    ) -> EventResult<IdentityControlOperation> {
        let join = self.pending_join(request.app_id).ok_or_else(|| {
            EventError::IdentityControlInvalid(format!(
                "no pending identity join for app {}",
                request.app_id
            ))
        })?;
        for vault in &self.vaults {
            if !request.vaults.iter().any(|opened| {
                opened.store_id == &vault.store_id && opened.key_epoch == &vault.current_key_epoch
            }) {
                return Err(EventError::IdentityApprovalIncomplete {
                    store_id: vault.store_id.as_str().to_owned(),
                });
            }
        }
        Ok(IdentityControlOperation::MemberApproved {
            member: join.member.clone(),
            vault_deks: join.member.vault_dek_grants(request.vaults)?,
        })
    }

    /// Deny a pending join.
    pub fn denial_operation(&self, app_id: &AppId) -> EventResult<IdentityControlOperation> {
        self.pending_join(app_id).ok_or_else(|| {
            EventError::IdentityControlInvalid(format!("no pending identity join for app {app_id}"))
        })?;
        Ok(IdentityControlOperation::MemberJoinDenied {
            app_id: app_id.clone(),
        })
    }

    /// Revoke an active member. The identity always keeps one member.
    pub fn revocation_operation(&self, app_id: &AppId) -> EventResult<IdentityControlOperation> {
        if self.member(app_id).is_none() {
            return Err(EventError::IdentityControlInvalid(format!(
                "app {app_id} is not an active identity member"
            )));
        }
        if self.members.len() == 1 {
            return Err(EventError::IdentityControlInvalid(
                "an identity must keep at least one app key".to_owned(),
            ));
        }
        Ok(IdentityControlOperation::MemberRevoked {
            app_id: app_id.clone(),
        })
    }

    /// Name the identity: seal the name to every active member, and to a
    /// member joining in the same event. A blank name is refused.
    pub fn naming_operation(
        &self,
        naming: &IdentityNaming<'_>,
    ) -> EventResult<IdentityControlOperation> {
        let name = naming.name.trim();
        if name.is_empty() {
            return Err(EventError::IdentityControlInvalid(
                "an identity name must not be blank".to_owned(),
            ));
        }
        let mut recipients = Vec::with_capacity(self.members.len() + 1);
        for keys in self
            .members
            .iter()
            .map(|member| &member.keys)
            .chain(naming.joining)
        {
            if recipients
                .iter()
                .any(|sealed: &MemberSealedName| sealed.app_id == keys.app_id)
            {
                continue;
            }
            recipients.push(MemberSealedName {
                app_id: keys.app_id.clone(),
                name_ciphertext: keys
                    .encryption_public_key
                    .seal_bytes(name.as_bytes())
                    .map_err(|error| EventError::IdentityControlInvalid(error.to_string()))?,
            });
        }
        Ok(IdentityControlOperation::IdentityNamed { recipients })
    }

    fn recipients(&self, keys: &VaultKeys) -> EventResult<Vec<MemberVaultDek>> {
        self.members
            .iter()
            .map(|member| member.keys.wrap_vault_keys(keys))
            .collect()
    }

    /// Register a new vault and wrap its DEK to every active member.
    pub fn vault_registration_operation(
        &self,
        request: IdentityVaultRegistration<'_>,
    ) -> EventResult<IdentityControlOperation> {
        if self.vault(request.dek.store_id).is_some() {
            return Err(EventError::IdentityControlInvalid(format!(
                "vault {} is already registered with this identity",
                request.dek.store_id
            )));
        }
        Ok(IdentityControlOperation::VaultRegistered {
            store_id: request.dek.store_id.clone(),
            key_epoch: request.dek.key_epoch.clone(),
            recipients: self.recipients(request.dek.keys)?,
        })
    }

    /// Wrap a vault DEK epoch to every active member, after a key rotation or
    /// for members that joined concurrently with the vault's registration.
    pub fn vault_rewrap_operation(
        &self,
        dek: &OpenedVaultDek<'_>,
    ) -> EventResult<IdentityControlOperation> {
        if self.vault(dek.store_id).is_none() {
            return Err(EventError::IdentityControlInvalid(format!(
                "vault {} is not registered with this identity",
                dek.store_id
            )));
        }
        Ok(IdentityControlOperation::VaultDekGranted {
            store_id: dek.store_id.clone(),
            key_epoch: dek.key_epoch.clone(),
            recipients: self.recipients(dek.keys)?,
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use crate::identity_control::test_fixtures::*;

    #[test]
    fn the_identity_name_is_sealed_to_every_member_including_one_joining() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let founder = fixture.founder();
        assert!(fixture.state()?.sealed_name.is_empty());
        let blank = IdentityNaming {
            name: "  ",
            joining: None,
        };
        assert!(fixture.state()?.naming_operation(&blank).is_err());

        let naming = fixture.state()?.naming_operation(&IdentityNaming {
            name: " Personal ",
            joining: None,
        })?;
        fixture.append(&founder, vec![naming])?;
        let state = fixture.state()?;
        let sealed = state
            .sealed_name_for(founder.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the founder must hold the name"))?;
        assert_eq!(founder.app.open_utf8(sealed)?, "Personal");
        assert!(!sealed.as_str().contains("Personal"));

        // Approval re-seals the name so the joining member can read it too.
        let joiner = Installation::new()?;
        fixture.request_join(&joiner)?;
        let state = fixture.state()?;
        let joining = state
            .pending_join(joiner.app.app_id())
            .map(|request| request.member.clone())
            .ok_or_else(|| anyhow::anyhow!("the join must be pending"))?;
        let approval = state.approval_operation(&IdentityApprovalRequest {
            app_id: joiner.app.app_id(),
            vaults: &[],
        })?;
        let renaming = state.naming_operation(&IdentityNaming {
            name: "Family",
            joining: Some(&joining),
        })?;
        fixture.append(&founder, vec![approval, renaming])?;
        let state = fixture.state()?;
        for member in [&founder, &joiner] {
            let sealed = state
                .sealed_name_for(member.app.app_id())
                .ok_or_else(|| anyhow::anyhow!("every member must hold the name"))?;
            assert_eq!(member.app.open_utf8(sealed)?, "Family");
        }

        // A stranger cannot rename the identity.
        let stranger = Installation::new()?;
        let forged = state.naming_operation(&IdentityNaming {
            name: "Stolen",
            joining: Some(&stranger.keys("")),
        })?;
        let (_, status) = fixture.append(&stranger, vec![forged])?;
        assert!(matches!(
            status,
            IdentityEventInsertStatus::Quarantined { .. }
        ));
        let state = fixture.state()?;
        let sealed = state
            .sealed_name_for(founder.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the founder must still hold the name"))?;
        assert_eq!(founder.app.open_utf8(sealed)?, "Family");
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
        let IdentityVaultDekLookup::Granted(dek) = vault.current_dek_for(founder.app.app_id())
        else {
            anyhow::bail!("founder must hold the rotated DEK");
        };
        assert_eq!(
            founder.app.decrypt_envelope(&dek.secrets_key_ciphertext)?,
            rotated.secrets_key
        );
        assert!(state.members_missing_current_dek(&store_id).is_empty());
        Ok(())
    }
}
