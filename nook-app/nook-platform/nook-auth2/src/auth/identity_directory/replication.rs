//! Apply the replicated identity control log to the local directory cache.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::HashSet;

use super::{
    AppKeyIdentityMembership, IdentityDirectory, IdentityDirectoryRejection, IdentitySelection,
};
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{
    AgeArmoredCiphertext, AppId, AppKey, IdentityId, IdentityMember, IdentityMemberKeyBinding,
    IdentityRecord, IdentityVaultDek, IdentityVaultDekEpoch, MemberDekEnvelope, MemberLabelState,
    StoreId,
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
    /// Vaults deleted from the identity: their cached grants are dropped.
    pub removed_vaults: Vec<StoreId>,
}

/// Rename a local identity to the replicated identity that lists its app key.
pub struct ReplicatedIdentityAdoption<'a> {
    pub local_identity_id: &'a IdentityId,
    pub replicated_identity_id: &'a IdentityId,
}

/// A replicated identity whose log lists this installation's app key, added
/// under the identity's own id.
pub struct ReplicatedIdentityAddition<'a> {
    /// The identity's name on this installation.
    pub label: &'a str,
    pub membership: ReplicatedIdentityMembership<'a>,
}

/// One identity's replicated membership, and the app keys other local
/// identities here already list.
struct MembershipMirror<'a, 'b> {
    request: &'a ReplicatedIdentityMembership<'b>,
    listed_elsewhere: &'a HashSet<AppId>,
}

impl IdentityRecord {
    /// Mirror the replicated members. A member another local identity here
    /// already lists is left out: one key holds one identity on a browser,
    /// and a key in use here may still be a member of this identity from a
    /// browser where it holds this one, as when one passkey made both.
    fn apply_replicated_membership(
        &mut self,
        mirror: &MembershipMirror<'_, '_>,
    ) -> MultiDeviceResult<bool> {
        let MembershipMirror {
            request,
            listed_elsewhere,
        } = *mirror;
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
        for replicated in request
            .members
            .iter()
            .filter(|member| !listed_elsewhere.contains(&member.app_id))
        {
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
        let vaults_before = self.vault_deks.len();
        self.vault_deks
            .retain(|vault| !request.removed_vaults.contains(&vault.store_id));
        changed |= self.vault_deks.len() != vaults_before;
        for grant in &request.own_grants {
            if request.removed_vaults.contains(&grant.store_id) {
                continue;
            }
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
    /// The app keys local identities other than `identity_id` list.
    fn listed_elsewhere(&self, identity_id: &IdentityId) -> HashSet<AppId> {
        self.identities
            .iter()
            .filter(|record| &record.identity_id != identity_id)
            .flat_map(|record| record.members.iter().map(|member| member.app_id.clone()))
            .collect()
    }

    /// Cache replicated membership and this installation's own DEK grants.
    pub fn apply_replicated_membership(
        self,
        request: &ReplicatedIdentityMembership<'_>,
    ) -> Result<Self, IdentityDirectoryRejection> {
        let mut candidate = self.clone();
        let listed_elsewhere = self.listed_elsewhere(request.identity_id);
        let applied: MultiDeviceResult<()> = (|| {
            let record = candidate
                .identities
                .iter_mut()
                .find(|record| &record.identity_id == request.identity_id)
                .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                    identity_id: request.identity_id.to_string(),
                })?;
            record.apply_replicated_membership(&MembershipMirror {
                request,
                listed_elsewhere: &listed_elsewhere,
            })?;
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

    /// Add a replicated identity beside the identities already here, under
    /// its own id, with its members and this installation's DEK grants. The
    /// identity in use stays selected; when none is, the added one is. An
    /// identity already here, or an app key another local identity holds,
    /// adds nothing.
    pub fn add_replicated_identity(
        self,
        request: &ReplicatedIdentityAddition<'_>,
    ) -> Result<Self, IdentityDirectoryRejection> {
        let mut candidate = self.clone();
        let added: MultiDeviceResult<()> = (|| {
            let membership = &request.membership;
            if candidate
                .identities
                .iter()
                .any(|record| &record.identity_id == membership.identity_id)
            {
                return Err(MultiDeviceError::ReplicatedIdentityAlreadyLocal {
                    identity_id: membership.identity_id.to_string(),
                });
            }
            if let AppKeyIdentityMembership::Enrolled(identity_id) =
                candidate.identity_for_app_key(membership.app_key)?
            {
                return Err(MultiDeviceError::AppKeyBelongsToAnotherIdentity {
                    identity_id: identity_id.to_string(),
                });
            }
            let label = request.label.trim();
            if label.is_empty() {
                return Err(MultiDeviceError::IdentityLabelEmpty);
            }
            // The record starts as this app key's own and takes the
            // replicated identity's id, as adoption renames one.
            let mut record = IdentityRecord::create_with_app_key(
                label,
                membership.app_key,
                MemberLabelState::Unnamed,
            )?;
            record.identity_id = membership.identity_id.clone();
            record.apply_replicated_membership(&MembershipMirror {
                request: membership,
                listed_elsewhere: &candidate.listed_elsewhere(membership.identity_id),
            })?;
            candidate.identities.push(record);
            if candidate.selection == IdentitySelection::Empty {
                candidate.selection = IdentitySelection::Selected(membership.identity_id.clone());
            }
            candidate.validate()
        })();
        match added {
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
            removed_vaults: Vec::new(),
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
            removed_vaults: Vec::new(),
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
                    removed_vaults: Vec::new(),
                });
        assert!(rejected.is_err());

        let revoked = directory.apply_replicated_membership(&ReplicatedIdentityMembership {
            identity_id: &identity_id,
            app_key: &phone,
            members: Vec::new(),
            revoked: vec![phone.app_id().clone()],
            own_grants: Vec::new(),
            removed_vaults: Vec::new(),
        });
        assert!(matches!(
            revoked.map_err(IdentityDirectoryRejection::into_cause),
            Err(MultiDeviceError::AppKeyRevokedFromIdentity { .. })
        ));
        Ok(())
    }

    #[test]
    fn a_vault_removed_from_the_identity_leaves_the_cached_grants() -> anyhow::Result<()> {
        let phone = AppKey::generate()?;
        let created = IdentityDirectory::empty().create_identity(IdentityCreation {
            label: "Personal",
            app_key: &phone,
            member_label: MemberLabelState::Unnamed,
        })?;
        let identity_id = created.identity_id;
        let kept = StoreId::generate()?;
        let removed = StoreId::generate()?;
        let keys = VaultKeys::generate()?;
        let directory =
            created
                .directory
                .apply_replicated_membership(&ReplicatedIdentityMembership {
                    identity_id: &identity_id,
                    app_key: &phone,
                    members: Vec::new(),
                    revoked: Vec::new(),
                    own_grants: vec![
                        grant(&phone, &kept, &keys)?,
                        grant(&phone, &removed, &keys)?,
                    ],
                    removed_vaults: Vec::new(),
                })?;
        assert_eq!(directory.selected()?.vault_deks.len(), 2);

        // The removal drops the cached grant, and a stale grant for the same
        // vault in the same projection does not restore it.
        let directory = directory.apply_replicated_membership(&ReplicatedIdentityMembership {
            identity_id: &identity_id,
            app_key: &phone,
            members: Vec::new(),
            revoked: Vec::new(),
            own_grants: vec![grant(&phone, &removed, &keys)?],
            removed_vaults: vec![removed.clone()],
        })?;
        let stores = directory
            .selected()?
            .vault_deks
            .iter()
            .map(|vault| vault.store_id.clone())
            .collect::<Vec<_>>();
        assert_eq!(stores, vec![kept]);
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

    /// A replicated identity listing `app` beside a phone, with one vault.
    fn addition<'a>(
        identity_id: &'a IdentityId,
        app: &'a AppKey,
        phone: &AppKey,
        vault: (&StoreId, &VaultKeys),
    ) -> anyhow::Result<ReplicatedIdentityAddition<'a>> {
        let (store_id, keys) = vault;
        Ok(ReplicatedIdentityAddition {
            label: "Family",
            membership: ReplicatedIdentityMembership {
                identity_id,
                app_key: app,
                members: vec![member(app, "Laptop"), member(phone, "Phone")],
                revoked: Vec::new(),
                own_grants: vec![grant(app, store_id, keys)?],
                removed_vaults: Vec::new(),
            },
        })
    }

    #[test]
    fn a_replicated_identity_is_added_beside_the_one_in_use_under_its_own_id() -> anyhow::Result<()>
    {
        let personal_key = AppKey::generate()?;
        let created = IdentityDirectory::empty().create_identity(IdentityCreation {
            label: "Personal",
            app_key: &personal_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        let personal = created.identity_id;
        let family = IdentityId::generate()?;
        let laptop = AppKey::generate()?;
        let phone = AppKey::generate()?;
        let store_id = StoreId::generate()?;
        let keys = VaultKeys::generate()?;

        let directory = created.directory.add_replicated_identity(&addition(
            &family,
            &laptop,
            &phone,
            (&store_id, &keys),
        )?)?;

        assert_eq!(directory.selected()?.identity_id, personal);
        let added = directory
            .identities()
            .iter()
            .find(|record| record.identity_id == family)
            .ok_or_else(|| anyhow::anyhow!("the identity is added under its own id"))?;
        assert_eq!(added.label, "Family");
        assert!(added.has_app_id(laptop.app_id()) && added.has_app_id(phone.app_id()));
        assert_eq!(
            directory.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &laptop,
                store_id,
            })?,
            keys
        );
        Ok(())
    }

    #[test]
    fn a_key_in_use_that_is_a_member_of_the_added_identity_stays_with_its_own() -> anyhow::Result<()>
    {
        // One passkey's key holds Personal here and is a member of Family,
        // which another browser holds with it. Family comes here under a
        // new key of its own.
        let passkey_key = AppKey::generate()?;
        let created = IdentityDirectory::empty().create_identity(IdentityCreation {
            label: "Personal",
            app_key: &passkey_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        let personal = created.identity_id;
        let family = IdentityId::generate()?;
        let family_key = AppKey::generate()?;
        let store_id = StoreId::generate()?;
        let keys = VaultKeys::generate()?;

        let directory = created.directory.add_replicated_identity(&addition(
            &family,
            &family_key,
            &passkey_key,
            (&store_id, &keys),
        )?)?;
        let directory = directory.apply_replicated_membership(&ReplicatedIdentityMembership {
            identity_id: &family,
            app_key: &family_key,
            members: vec![
                member(&family_key, "This browser"),
                member(&passkey_key, "Other browser"),
            ],
            revoked: Vec::new(),
            own_grants: Vec::new(),
            removed_vaults: Vec::new(),
        })?;

        let added = directory
            .identities()
            .iter()
            .find(|record| record.identity_id == family)
            .ok_or_else(|| anyhow::anyhow!("the identity is added under its own id"))?;
        assert!(added.has_app_id(family_key.app_id()));
        assert!(!added.has_app_id(passkey_key.app_id()));
        assert_eq!(
            directory.identity_for_app_key(&passkey_key)?,
            AppKeyIdentityMembership::Enrolled(personal)
        );
        assert_eq!(
            directory.identity_for_app_key(&family_key)?,
            AppKeyIdentityMembership::Enrolled(family)
        );
        Ok(())
    }

    #[test]
    fn the_identity_added_to_an_empty_directory_is_the_one_in_use() -> anyhow::Result<()> {
        let family = IdentityId::generate()?;
        let laptop = AppKey::generate()?;
        let keys = VaultKeys::generate()?;

        let directory = IdentityDirectory::empty().add_replicated_identity(&addition(
            &family,
            &laptop,
            &AppKey::generate()?,
            (&StoreId::generate()?, &keys),
        )?)?;

        assert_eq!(directory.selected()?.identity_id, family);
        Ok(())
    }

    #[test]
    fn an_identity_already_here_or_a_key_another_identity_holds_adds_nothing() -> anyhow::Result<()>
    {
        let personal_key = AppKey::generate()?;
        let created = IdentityDirectory::empty().create_identity(IdentityCreation {
            label: "Personal",
            app_key: &personal_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        let family = IdentityId::generate()?;
        let laptop = AppKey::generate()?;
        let phone = AppKey::generate()?;
        let keys = VaultKeys::generate()?;
        let directory = created.directory.add_replicated_identity(&addition(
            &family,
            &laptop,
            &phone,
            (&StoreId::generate()?, &keys),
        )?)?;

        let again = directory.clone().add_replicated_identity(&addition(
            &family,
            &laptop,
            &phone,
            (&StoreId::generate()?, &keys),
        )?);
        let Err(again) = again else {
            anyhow::bail!("the same identity was added twice");
        };
        assert_eq!(again.directory, directory);
        assert!(matches!(
            again.cause,
            MultiDeviceError::ReplicatedIdentityAlreadyLocal { .. }
        ));

        let other = IdentityId::generate()?;
        let held = directory.clone().add_replicated_identity(&addition(
            &other,
            &personal_key,
            &phone,
            (&StoreId::generate()?, &keys),
        )?);
        assert!(matches!(
            held.map_err(IdentityDirectoryRejection::into_cause),
            Err(MultiDeviceError::AppKeyBelongsToAnotherIdentity { .. })
        ));
        Ok(())
    }
}
