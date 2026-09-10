//! Authenticated installation enrollment into directory-owned identities.
use super::*;
#[cfg(test)]
use crate::IdentityVaultBinding;
use crate::MemberLabelState;
impl IdentityDirectory {
    /// Enroll an authenticated installation into the identity that owns the
    /// paired vault, independent of the currently selected identity.
    pub fn enroll_app_key_for_owned_vault(
        self,
        request: DirectoryVaultEnrollment<'_>,
    ) -> Result<IdentityDirectoryResolution, IdentityDirectoryRejection> {
        let DirectoryVaultEnrollment {
            current_app_key,
            new_app_key,
            store_id,
        } = request;
        let prepared: MultiDeviceResult<IdentityEnrollmentPreparation> = (|| {
            let owner = self
                .identities
                .iter()
                .find(|identity| identity.owns_vault(store_id))
                .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                    identity_id: format!("vault:{store_id}"),
                })?;
            if let Some(member) = owner
                .members
                .iter()
                .find(|member| member.app_id == *new_app_key.app_id())
            {
                if member.auth_id != new_app_key.auth_id()
                    || member.public_key != new_app_key.public_key()
                {
                    return Err(MultiDeviceError::InvalidDeviceIdentity(
                        "existing app id has different key material".to_owned(),
                    ));
                }
                return Ok(IdentityEnrollmentPreparation::Existing(
                    owner.identity_id.clone(),
                ));
            }
            let keys_by_store = owner
                .vault_deks
                .iter()
                .filter(|grant| {
                    grant
                        .secrets_envelopes
                        .iter()
                        .any(|entry| entry.app_id == *current_app_key.app_id())
                        && grant
                            .members_envelopes
                            .iter()
                            .any(|entry| entry.app_id == *current_app_key.app_id())
                })
                .map(|grant| {
                    owner
                        .open_vault_dek(IdentityVaultKeyOpening {
                            app_key: current_app_key,
                            store_id: grant.store_id.clone(),
                        })
                        .map(|keys| (grant.store_id.clone(), keys))
                })
                .collect::<MultiDeviceResult<Vec<_>>>()?;
            if !keys_by_store
                .iter()
                .any(|(grant_store_id, _)| grant_store_id == store_id)
            {
                return Err(MultiDeviceError::IdentityEnrollmentRequired);
            }
            let member = IdentityMember {
                app_id: new_app_key.app_id().clone(),
                auth_id: new_app_key.auth_id(),
                public_key: new_app_key.public_key(),
                signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
                label: MemberLabelState::Unnamed,
            };
            Ok(IdentityEnrollmentPreparation::Grant(
                PreparedIdentityMembership {
                    identity_id: owner.identity_id.clone(),
                    member,
                    keys_by_store,
                },
            ))
        })();
        match prepared {
            Err(cause) => Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            }),
            Ok(IdentityEnrollmentPreparation::Existing(identity_id)) => {
                Ok(IdentityDirectoryResolution {
                    directory: self,
                    identity_id,
                })
            }
            Ok(IdentityEnrollmentPreparation::Grant(prepared)) => {
                let PreparedIdentityMembership {
                    identity_id,
                    member,
                    keys_by_store,
                } = prepared;
                let directory = self.take_identity(&identity_id)?.update(|identity| {
                    identity
                        .grant_member_to_vaults(IdentityMemberVaultGrant {
                            member: &member,
                            keys_by_store: &keys_by_store,
                        })
                        .map(|identity| identity.add_prevalidated_member(member))
                })?;
                Ok(IdentityDirectoryResolution {
                    directory,
                    identity_id,
                })
            }
        }
    }

    /// Enroll an authenticated installation key into the selected identity
    /// before that identity owns a vault. Existing vaults require an explicit
    /// enrollment flow that also re-wraps every DEK.
    pub fn enroll_selected_app_key_for_vault_creation(
        self,
        request: DirectoryCreationEnrollment<'_>,
    ) -> Result<IdentityDirectoryResolution, IdentityDirectoryRejection> {
        let DirectoryCreationEnrollment { app_key, label } = request;
        if let Err(cause) = self.ensure_app_key_active(app_key) {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            });
        }
        if matches!(&self.selection, IdentitySelection::Empty) {
            return self.create_identity(IdentityCreation {
                label,
                app_key,
                member_label: MemberLabelState::Unnamed,
            });
        }
        let selected = match self.selected() {
            Ok(selected) => selected,
            Err(cause) => {
                return Err(IdentityDirectoryRejection {
                    directory: self,
                    cause,
                });
            }
        };
        let identity_id = selected.identity_id.clone();
        if let Some(member) = selected
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
        {
            if member.auth_id != app_key.auth_id() || member.public_key != app_key.public_key() {
                return Err(IdentityDirectoryRejection {
                    directory: self,
                    cause: MultiDeviceError::InvalidDeviceIdentity(
                        "existing app id has different key material".to_owned(),
                    ),
                });
            }
            return Ok(IdentityDirectoryResolution {
                directory: self,
                identity_id,
            });
        }
        if !selected.vault_deks.is_empty() {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: MultiDeviceError::IdentityEnrollmentRequired,
            });
        }
        let member = IdentityMember {
            app_id: app_key.app_id().clone(),
            auth_id: app_key.auth_id(),
            public_key: app_key.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Unnamed,
        };
        let directory = self
            .take_identity(&identity_id)?
            .update(|identity| identity.add_member(member))?;
        Ok(IdentityDirectoryResolution {
            directory,
            identity_id,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::IdentityVaultDekReconciliation;
    #[test]
    fn authenticated_handoff_enrolls_only_before_vault_creation() -> anyhow::Result<()> {
        let website_key = AppKey::generate()?;
        let extension_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &website_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let identity_id = resolved_identity.identity_id;
        let enrolled =
            directory.enroll_selected_app_key_for_vault_creation(DirectoryCreationEnrollment {
                app_key: &extension_key,
                label: "Personal",
            })?;
        directory = enrolled.directory;
        assert_eq!(enrolled.identity_id, identity_id);
        assert_eq!(directory.selected()?.members.len(), 2);

        let later_key = AppKey::generate()?;
        let opened_identity = directory.open_or_generate_vault_dek(IdentityVaultKeyOpening {
            app_key: &extension_key,
            store_id: crate::StoreId::generate()?,
        })?;
        directory = opened_identity.directory;
        let rejected = match directory.enroll_selected_app_key_for_vault_creation(
            DirectoryCreationEnrollment {
                app_key: &later_key,
                label: "Personal",
            },
        ) {
            Err(rejected) => rejected,
            Ok(_) => anyhow::bail!("Rejected identity transition unexpectedly succeeded"),
        };
        directory = rejected.directory;
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::IdentityEnrollmentRequired
        ));
        Ok(())
    }

    #[test]
    fn paired_handoff_enrolls_the_vault_owner_not_the_selection() -> anyhow::Result<()> {
        let website_key = AppKey::generate()?;
        let extension_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &website_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let owner_id = resolved_identity.identity_id;
        let store_id = crate::StoreId::generate()?;
        let opened_identity = directory.open_or_generate_vault_dek(IdentityVaultKeyOpening {
            app_key: &website_key,
            store_id: store_id.clone(),
        })?;
        directory = opened_identity.directory;
        let expected_keys = opened_identity.keys;
        let epoch = known_epoch('a', 'b')?;
        directory.identities[0].vault_deks[0].key_epoch = epoch.clone();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Work",
            app_key: &website_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let selected_id = resolved_identity.identity_id;

        let resolved_identity =
            directory.enroll_app_key_for_owned_vault(DirectoryVaultEnrollment {
                current_app_key: &website_key,
                new_app_key: &extension_key,
                store_id: &store_id,
            })?;
        directory = resolved_identity.directory;
        let enrolled_id = resolved_identity.identity_id;

        assert_eq!(enrolled_id, owner_id);
        assert_ne!(enrolled_id, selected_id);
        assert_eq!(
            directory.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &extension_key,
                store_id: store_id
            })?,
            expected_keys
        );
        assert_eq!(directory.selected()?.members.len(), 1);
        assert_eq!(directory.identities()[0].vault_deks[0].key_epoch, epoch);
        Ok(())
    }

    #[test]
    fn paired_handoff_preserves_vault_level_revocations() -> anyhow::Result<()> {
        let authorizer = AppKey::generate()?;
        let revoked = AppKey::generate()?;
        let handoff = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &authorizer,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        directory = directory.add_selected_member(IdentityMember {
            app_id: revoked.app_id().clone(),
            auth_id: revoked.auth_id(),
            public_key: revoked.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Unnamed,
        })?;
        let store_id = crate::StoreId::generate()?;
        let opened_identity = directory.open_or_generate_vault_dek(IdentityVaultKeyOpening {
            app_key: &authorizer,
            store_id: store_id.clone(),
        })?;
        directory = opened_identity.directory;
        let keys = opened_identity.keys;
        let resolved_identity =
            directory.reconcile_vault_dek(IdentityLegacyVaultReconciliation {
                app_key: &authorizer,
                store_id: &store_id,
                reconciliation: &IdentityVaultDekReconciliation {
                    secrets_envelope: authorizer
                        .public_key()
                        .seal_bytes(keys.secrets_key.as_str().as_bytes())?,
                    members_envelope: authorizer
                        .public_key()
                        .seal_bytes(keys.members_key.as_str().as_bytes())?,
                    epoch_update: crate::IdentityVaultDekEpochUpdate::Observe {
                        key_epoch: crate::IdentityVaultDekEpoch::LegacyUnknown,
                        checkpoint_ancestors: Vec::new(),
                    },
                    authorized_auth_ids: vec![authorizer.auth_id()],
                },
            })?;
        directory = resolved_identity.directory;

        let resolved_identity =
            directory.enroll_app_key_for_owned_vault(DirectoryVaultEnrollment {
                current_app_key: &authorizer,
                new_app_key: &handoff,
                store_id: &store_id,
            })?;
        directory = resolved_identity.directory;

        let IdentityVaultBinding::Bound(grant) = directory.selected()?.vault_dek(&store_id) else {
            anyhow::bail!("vault grant missing")
        };
        for envelopes in [&grant.secrets_envelopes, &grant.members_envelopes] {
            assert!(
                envelopes
                    .iter()
                    .any(|entry| entry.app_id == *authorizer.app_id())
            );
            assert!(
                envelopes
                    .iter()
                    .any(|entry| entry.app_id == *handoff.app_id())
            );
            assert!(
                envelopes
                    .iter()
                    .all(|entry| entry.app_id != *revoked.app_id())
            );
        }
        Ok(())
    }
}
