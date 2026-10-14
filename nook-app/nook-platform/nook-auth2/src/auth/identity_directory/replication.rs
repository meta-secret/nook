//! Apply the replicated identity control log to the local directory cache.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{IdentityDirectory, IdentityDirectoryRejection, IdentitySelection};
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{
    AgeArmoredCiphertext, AppId, AppKey, IdentityId, IdentityMember, IdentityMemberKeyBinding,
    IdentityRecord, IdentityVaultDek, IdentityVaultDekEpoch, MemberDekEnvelope, StoreId,
};

/// This installation's envelopes for one vault at the vault's current epoch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicatedVaultGrant {
    pub store_id: StoreId,
    pub secrets_envelope: AgeArmoredCiphertext,
    pub members_envelope: AgeArmoredCiphertext,
}

/// Replicated membership and this installation's DEK grants for one identity.
pub struct ReplicatedIdentityMembership<'a> {
    pub identity_id: &'a IdentityId,
    pub app_key: &'a AppKey,
    pub members: Vec<IdentityMember>,
    pub revoked: Vec<AppId>,
    pub own_grants: Vec<ReplicatedVaultGrant>,
}

/// Rename a local identity to the replicated identity that lists its app key.
pub struct ReplicatedIdentityAdoption<'a> {
    pub local_identity_id: &'a IdentityId,
    pub replicated_identity_id: &'a IdentityId,
}

impl IdentityRecord {
    fn apply_replicated_membership(
        &mut self,
        request: &ReplicatedIdentityMembership<'_>,
    ) -> MultiDeviceResult<bool> {
        let own_app_id = request.app_key.app_id();
        if request.revoked.contains(own_app_id) {
            return Err(MultiDeviceError::AppKeyRevokedFromIdentity {
                identity_id: self.identity_id.to_string(),
            });
        }
        let own = self
            .members
            .iter()
            .find(|member| &member.app_id == own_app_id)
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        if matches!(
            own.binding_to_app_key(request.app_key),
            IdentityMemberKeyBinding::DifferentKeyMaterial
        ) {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "existing app id has different key material".to_owned(),
            ));
        }
        let mut changed = false;
        for replicated in &request.members {
            match self
                .members
                .iter_mut()
                .find(|member| member.app_id == replicated.app_id)
            {
                Some(local) => {
                    if matches!(
                        local.binding_to_member(replicated),
                        IdentityMemberKeyBinding::DifferentKeyMaterial
                    ) {
                        return Err(MultiDeviceError::InvalidDeviceIdentity(
                            "replicated member has different key material".to_owned(),
                        ));
                    }
                    if local.signing_public_key != replicated.signing_public_key
                        || local.label != replicated.label
                    {
                        local.signing_public_key = replicated.signing_public_key.clone();
                        local.label = replicated.label.clone();
                        changed = true;
                    }
                }
                None => {
                    self.members.push(replicated.clone());
                    changed = true;
                }
            }
        }
        let before = self.members.len();
        self.members
            .retain(|member| !request.revoked.contains(&member.app_id));
        changed |= self.members.len() != before;
        for vault in &mut self.vault_deks {
            let secrets = vault.secrets_envelopes.len();
            let members = vault.members_envelopes.len();
            vault
                .secrets_envelopes
                .retain(|envelope| !request.revoked.contains(&envelope.app_id));
            vault
                .members_envelopes
                .retain(|envelope| !request.revoked.contains(&envelope.app_id));
            changed |= vault.secrets_envelopes.len() != secrets
                || vault.members_envelopes.len() != members;
        }
        for grant in &request.own_grants {
            // A grant must open with this installation's key before it is cached.
            request.app_key.decrypt_envelope(&grant.secrets_envelope)?;
            request.app_key.decrypt_envelope(&grant.members_envelope)?;
            let secrets = MemberDekEnvelope {
                app_id: own_app_id.clone(),
                envelope: grant.secrets_envelope.clone(),
            };
            let members = MemberDekEnvelope {
                app_id: own_app_id.clone(),
                envelope: grant.members_envelope.clone(),
            };
            match self
                .vault_deks
                .iter_mut()
                .find(|vault| vault.store_id == grant.store_id)
            {
                Some(vault) => {
                    // Local reconciliation owns envelopes this installation already
                    // holds; replication only fills a missing grant.
                    let holds = vault
                        .secrets_envelopes
                        .iter()
                        .any(|entry| &entry.app_id == own_app_id)
                        && vault
                            .members_envelopes
                            .iter()
                            .any(|entry| &entry.app_id == own_app_id);
                    if !holds {
                        vault
                            .secrets_envelopes
                            .retain(|entry| &entry.app_id != own_app_id);
                        vault
                            .members_envelopes
                            .retain(|entry| &entry.app_id != own_app_id);
                        vault.secrets_envelopes.push(secrets);
                        vault.members_envelopes.push(members);
                        changed = true;
                    }
                }
                None => {
                    self.vault_deks.push(IdentityVaultDek {
                        store_id: grant.store_id.clone(),
                        key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
                        secrets_envelopes: vec![secrets],
                        members_envelopes: vec![members],
                    });
                    changed = true;
                }
            }
        }
        if changed {
            self.control_epoch = self.control_epoch.next();
        }
        Ok(changed)
    }
}

impl IdentityDirectory {
    /// Cache replicated membership and this installation's own DEK grants.
    pub fn apply_replicated_membership(
        self,
        request: &ReplicatedIdentityMembership<'_>,
    ) -> Result<Self, IdentityDirectoryRejection> {
        let mut candidate = self.clone();
        let applied: MultiDeviceResult<()> = (|| {
            let record = candidate
                .identities
                .iter_mut()
                .find(|record| &record.identity_id == request.identity_id)
                .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                    identity_id: request.identity_id.to_string(),
                })?;
            record.apply_replicated_membership(request)?;
            candidate.validate()
        })();
        match applied {
            Ok(()) => Ok(candidate),
            Err(cause) => Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            }),
        }
    }

    /// Rename a local identity to the replicated identity it belongs to.
    pub fn adopt_replicated_identity(
        self,
        request: &ReplicatedIdentityAdoption<'_>,
    ) -> Result<Self, IdentityDirectoryRejection> {
        let mut candidate = self.clone();
        let adopted: MultiDeviceResult<()> = (|| {
            if candidate
                .identities
                .iter()
                .any(|record| &record.identity_id == request.replicated_identity_id)
            {
                return Err(MultiDeviceError::ReplicatedIdentityAlreadyLocal {
                    identity_id: request.replicated_identity_id.to_string(),
                });
            }
            let record = candidate
                .identities
                .iter_mut()
                .find(|record| &record.identity_id == request.local_identity_id)
                .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                    identity_id: request.local_identity_id.to_string(),
                })?;
            record.identity_id = request.replicated_identity_id.clone();
            record.control_epoch = record.control_epoch.next();
            if candidate.selection == IdentitySelection::Selected(request.local_identity_id.clone())
            {
                candidate.selection =
                    IdentitySelection::Selected(request.replicated_identity_id.clone());
            }
            candidate.validate()
        })();
        match adopted {
            Ok(()) => Ok(candidate),
            Err(cause) => Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeviceSigningPublicKey, IdentityCreation, IdentityVaultKeyOpening, MemberLabelState,
        VaultKeys,
    };

    fn member(app: &AppKey, label: &str) -> IdentityMember {
        IdentityMember {
            app_id: app.app_id().clone(),
            auth_id: app.auth_id(),
            public_key: app.public_key(),
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Named(label.to_owned()),
        }
    }

    fn grant(
        app: &AppKey,
        store_id: &StoreId,
        keys: &VaultKeys,
    ) -> anyhow::Result<ReplicatedVaultGrant> {
        Ok(ReplicatedVaultGrant {
            store_id: store_id.clone(),
            secrets_envelope: app
                .public_key()
                .seal_bytes(keys.secrets_key.as_str().as_bytes())?,
            members_envelope: app
                .public_key()
                .seal_bytes(keys.members_key.as_str().as_bytes())?,
        })
    }

    #[test]
    fn replicated_membership_caches_own_grants_and_drops_revoked_members() -> anyhow::Result<()> {
        let phone = AppKey::generate()?;
        let laptop = AppKey::generate()?;
        let tablet = AppKey::generate()?;
        let created = IdentityDirectory::empty().create_identity(IdentityCreation {
            label: "Personal",
            app_key: &phone,
            member_label: MemberLabelState::Unnamed,
        })?;
        let identity_id = created.identity_id;
        let directory = created.directory;
        let store_id = StoreId::generate()?;
        let keys = VaultKeys::generate()?;

        let directory = directory.apply_replicated_membership(&ReplicatedIdentityMembership {
            identity_id: &identity_id,
            app_key: &phone,
            members: vec![member(&laptop, "Laptop"), member(&tablet, "Tablet")],
            revoked: Vec::new(),
            own_grants: vec![grant(&phone, &store_id, &keys)?],
        })?;
        assert_eq!(
            directory.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &phone,
                store_id: store_id.clone(),
            })?,
            keys
        );
        let record = directory.selected()?;
        assert_eq!(record.members.len(), 3);

        let directory = directory.apply_replicated_membership(&ReplicatedIdentityMembership {
            identity_id: &identity_id,
            app_key: &phone,
            members: vec![member(&laptop, "Work laptop")],
            revoked: vec![tablet.app_id().clone()],
            own_grants: Vec::new(),
        })?;
        let record = directory.selected()?;
        assert!(!record.has_app_id(tablet.app_id()));
        assert!(
            record
                .members
                .iter()
                .any(|entry| entry.label == MemberLabelState::Named("Work laptop".to_owned()))
        );

        // A grant this key cannot open is rejected, and the directory is unchanged.
        let foreign = grant(&laptop, &StoreId::generate()?, &keys)?;
        let rejected =
            directory
                .clone()
                .apply_replicated_membership(&ReplicatedIdentityMembership {
                    identity_id: &identity_id,
                    app_key: &phone,
                    members: Vec::new(),
                    revoked: Vec::new(),
                    own_grants: vec![foreign],
                });
        assert!(rejected.is_err());

        let revoked = directory.apply_replicated_membership(&ReplicatedIdentityMembership {
            identity_id: &identity_id,
            app_key: &phone,
            members: Vec::new(),
            revoked: vec![phone.app_id().clone()],
            own_grants: Vec::new(),
        });
        assert!(matches!(
            revoked.map_err(IdentityDirectoryRejection::into_cause),
            Err(MultiDeviceError::AppKeyRevokedFromIdentity { .. })
        ));
        Ok(())
    }

    #[test]
    fn adoption_renames_the_local_identity_and_keeps_its_selection() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let created = IdentityDirectory::empty().create_identity(IdentityCreation {
            label: "Phone",
            app_key: &app,
            member_label: MemberLabelState::Unnamed,
        })?;
        let local = created.identity_id;
        let replicated = IdentityId::generate()?;
        let adopted = created
            .directory
            .adopt_replicated_identity(&ReplicatedIdentityAdoption {
                local_identity_id: &local,
                replicated_identity_id: &replicated,
            })?;
        assert_eq!(adopted.selected()?.identity_id, replicated);
        assert!(adopted.selected()?.has_app_id(app.app_id()));

        let duplicate = adopted.adopt_replicated_identity(&ReplicatedIdentityAdoption {
            local_identity_id: &replicated,
            replicated_identity_id: &replicated,
        });
        assert!(matches!(
            duplicate.map_err(IdentityDirectoryRejection::into_cause),
            Err(MultiDeviceError::ReplicatedIdentityAlreadyLocal { .. })
        ));
        Ok(())
    }
}
