//! Retirement and selection transitions for local identity recovery.
use super::*;
use crate::MemberLabelState;

pub enum RecoveryRetirement {
    RetireInstallation(crate::AppId),
    PreserveRetiredKeys,
}

impl IdentityDirectory {
    /// Drop directory ownership sealed to an inaccessible installation key.
    /// Encrypted vault storage remains outside this portable record and may be
    /// rebound only after a recovery credential proves access.
    #[must_use]
    pub fn reset_for_device_recovery(mut self, retirement: RecoveryRetirement) -> Self {
        self.identities.clear();
        self.selection = IdentitySelection::Empty;
        match retirement {
            RecoveryRetirement::RetireInstallation(app_id) => self.retire_app_id(app_id),
            RecoveryRetirement::PreserveRetiredKeys => self,
        }
    }

    /// Leave known identities visible without treating a peer-only identity as
    /// the local browser's active protection target.
    #[must_use]
    pub fn clear_selection(mut self) -> Self {
        self.selection = IdentitySelection::Empty;
        self
    }

    /// Retire one inaccessible installation key without discarding unrelated
    /// identities. A one-member identity is removed; a multi-member identity
    /// remains available to its other installations.
    pub fn retire_local_identity_key(
        self,
        request: LocalIdentityKeyRetirement<'_>,
    ) -> Result<Self, IdentityDirectoryRejection> {
        match self.admit_local_key_retirement(&request) {
            Err(cause) => Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            }),
            Ok(index) => {
                self.retire_identity_member(LocalKeyRetirementApplication { index, request })
            }
        }
    }

    fn admit_local_key_retirement(
        &self,
        request: &LocalIdentityKeyRetirement<'_>,
    ) -> MultiDeviceResult<usize> {
        self.validate()?;
        let index = self
            .identities
            .iter()
            .position(|identity| &identity.identity_id == request.identity_id)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: request.identity_id.to_string(),
            })?;
        self.identities[index].require_retiring_member(request.app_id)?;
        Ok(index)
    }

    fn retire_identity_member(
        mut self,
        retirement: LocalKeyRetirementApplication<'_>,
    ) -> Result<Self, IdentityDirectoryRejection> {
        let LocalKeyRetirementApplication { index, request } = retirement;
        let directory = if self.identities[index].members.len() == 1 {
            self.identities.remove(index);
            self.selection = self
                .identities
                .first()
                .map_or(IdentitySelection::Empty, |identity| {
                    IdentitySelection::Selected(identity.identity_id.clone())
                });
            self
        } else {
            self.take_identity(request.identity_id)?
                .update(|identity| identity.remove_member(request.app_id))?
        };
        Ok(directory.retire_app_id(request.app_id.clone()))
    }

    /// Permanently reject one installation key discovered outside a readable directory.
    #[must_use]
    pub fn retire_app_id(mut self, app_id: crate::AppId) -> Self {
        if !self.retired_app_ids.contains(&app_id) {
            self.retired_app_ids.push(app_id);
        }
        self
    }
}

struct LocalKeyRetirementApplication<'a> {
    index: usize,
    request: LocalIdentityKeyRetirement<'a>,
}

impl IdentityRecord {
    fn require_retiring_member(&self, app_id: &crate::AppId) -> MultiDeviceResult<()> {
        if !self.members.iter().any(|member| &member.app_id == app_id) {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "retired app key does not belong to the selected identity".to_owned(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn device_recovery_removes_stale_local_ownership() -> anyhow::Result<()> {
        let inaccessible_key = AppKey::generate()?;
        let store_id = crate::StoreId::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &inaccessible_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let identity_id = resolved_identity.identity_id;
        let peer_key = AppKey::generate()?;
        directory = directory.add_selected_member(IdentityMember {
            app_id: peer_key.app_id().clone(),
            auth_id: peer_key.auth_id(),
            public_key: peer_key.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Unnamed,
        })?;
        let opened_identity =
            directory.open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                identity_id: &identity_id,
                vault: IdentityVaultKeyOpening {
                    app_key: &inaccessible_key,
                    store_id: store_id.clone(),
                },
            })?;
        directory = opened_identity.directory;

        directory = directory.reset_for_device_recovery(RecoveryRetirement::RetireInstallation(
            inaccessible_key.app_id().clone(),
        ));

        assert!(directory.identities().is_empty());
        assert_eq!(directory.selection(), &IdentitySelection::Empty);
        let rejected = match directory.create_identity(IdentityCreation {
            label: "Stale",
            app_key: &inaccessible_key,
            member_label: MemberLabelState::Unnamed,
        }) {
            Err(rejected) => rejected,
            Ok(_) => anyhow::bail!("Rejected identity transition unexpectedly succeeded"),
        };
        directory = rejected.directory;
        assert!(matches!(rejected.cause, MultiDeviceError::RetiredAppKey));
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Peer",
            app_key: &peer_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let replacement_key = AppKey::generate()?;
        directory.validate_vault_enrollment(&replacement_key, &store_id)?;
        Ok(())
    }

    #[test]
    fn scoped_recovery_preserves_other_local_identities() -> anyhow::Result<()> {
        let first_key = AppKey::generate()?;
        let second_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "First",
            app_key: &first_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let first_id = resolved_identity.identity_id;
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Second",
            app_key: &second_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let second_id = resolved_identity.identity_id;

        directory = directory.retire_local_identity_key(LocalIdentityKeyRetirement {
            identity_id: &second_id,
            app_id: second_key.app_id(),
        })?;

        assert_eq!(directory.identities().len(), 1);
        assert_eq!(directory.identities()[0].identity_id, first_id);
        assert_eq!(
            directory.selection(),
            &IdentitySelection::Selected(first_id.clone())
        );
        assert!(directory.retired_app_ids().contains(second_key.app_id()));
        let rejected = match directory.create_identity(IdentityCreation {
            label: "Retired",
            app_key: &second_key,
            member_label: MemberLabelState::Unnamed,
        }) {
            Err(rejected) => rejected,
            Ok(_) => anyhow::bail!("Rejected identity transition unexpectedly succeeded"),
        };
        directory = rejected.directory;
        assert!(matches!(rejected.cause, MultiDeviceError::RetiredAppKey));
        Ok(())
    }

    #[test]
    fn selection_can_be_cleared_without_discarding_peer_only_identity() -> anyhow::Result<()> {
        let local_key = AppKey::generate()?;
        let peer_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &local_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let identity_id = resolved_identity.identity_id;
        directory = directory.add_selected_member(IdentityMember {
            app_id: peer_key.app_id().clone(),
            auth_id: peer_key.auth_id(),
            public_key: peer_key.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Unnamed,
        })?;
        directory = directory.retire_local_identity_key(LocalIdentityKeyRetirement {
            identity_id: &identity_id,
            app_id: local_key.app_id(),
        })?;

        directory = directory.clear_selection();

        assert_eq!(directory.identities().len(), 1);
        assert_eq!(directory.selection(), &IdentitySelection::Empty);
        directory.validate()?;
        Ok(())
    }
}
