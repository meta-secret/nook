//! Three-way rebase policy for staged vault-creation identity ownership.

use crate::{
    DirectoryCreationEnrollment, DirectoryOwnedVaultOpening, IdentityCreation,
    IdentityVaultKeyOpening,
};

use super::{IdentityDirectory, IdentityDirectoryRejection};
use crate::errors::MultiDeviceError;
use crate::{IdentityId, IdentityRecord};

pub struct StagedIdentityRebase<'a> {
    pub base: &'a IdentityDirectory,
    pub candidate: &'a IdentityDirectory,
    pub identity_id: &'a IdentityId,
}

enum StagedIdentityPresence<'a> {
    Existing(&'a IdentityRecord),
    NewlyCreated,
}

enum StagedRebaseRollback {
    Unchanged,
    Replaced {
        index: usize,
        previous: IdentityRecord,
    },
    Inserted,
}

impl IdentityDirectory {
    /// Apply one staged target identity over unrelated concurrent directory changes.
    ///
    /// The candidate may only differ from its base at `identity_id`. The current
    /// directory keeps its selection and unrelated identities. A concurrent
    /// change to the same target fails closed.
    pub fn rebase_staged_vault_creation(
        mut self,
        request: StagedIdentityRebase<'_>,
    ) -> Result<Self, IdentityDirectoryRejection> {
        let StagedIdentityRebase {
            base,
            candidate,
            identity_id,
        } = request;
        let StagedIdentityPresence::Existing(target) = candidate.identity(identity_id) else {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: MultiDeviceError::IdentityNotFound {
                    identity_id: identity_id.to_string(),
                },
            });
        };
        if base.identities_without(identity_id) != candidate.identities_without(identity_id)
            || base.retired_app_ids != candidate.retired_app_ids
        {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: Self::staged_identity_conflict(identity_id),
            });
        }
        // The staged snapshot remains retained as publication evidence. Only its
        // target is copied; unrelated current records keep their existing owner.
        let rollback = match (
            base.identity(identity_id),
            self.identities
                .iter()
                .position(|record| &record.identity_id == identity_id),
        ) {
            (StagedIdentityPresence::Existing(_), Some(index))
                if self.identities[index] == *target =>
            {
                StagedRebaseRollback::Unchanged
            }
            (StagedIdentityPresence::Existing(original), Some(index))
                if self.identities[index] == *original =>
            {
                let previous = std::mem::replace(&mut self.identities[index], target.clone());
                StagedRebaseRollback::Replaced { index, previous }
            }
            (StagedIdentityPresence::NewlyCreated, None) => {
                self.identities.push(target.clone());
                StagedRebaseRollback::Inserted
            }
            _ => {
                return Err(IdentityDirectoryRejection {
                    directory: self,
                    cause: Self::staged_identity_conflict(identity_id),
                });
            }
        };
        if let Err(cause) = self.validate() {
            match rollback {
                StagedRebaseRollback::Unchanged => {}
                StagedRebaseRollback::Replaced { index, previous } => {
                    self.identities[index] = previous
                }
                StagedRebaseRollback::Inserted => {
                    self.identities.pop();
                }
            }
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            });
        }
        Ok(self)
    }

    fn identity(&self, identity_id: &IdentityId) -> StagedIdentityPresence<'_> {
        match self
            .identities
            .iter()
            .find(|record| &record.identity_id == identity_id)
        {
            Some(record) => StagedIdentityPresence::Existing(record),
            None => StagedIdentityPresence::NewlyCreated,
        }
    }

    fn identities_without(&self, identity_id: &IdentityId) -> Vec<&IdentityRecord> {
        self.identities
            .iter()
            .filter(|record| &record.identity_id != identity_id)
            .collect()
    }

    fn staged_identity_conflict(identity_id: &IdentityId) -> MultiDeviceError {
        MultiDeviceError::StagedIdentityConflict {
            identity_id: identity_id.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        DirectoryCreationEnrollment, DirectoryOwnedVaultOpening, IdentityCreation,
        IdentityVaultKeyOpening,
    };

    use super::*;
    use crate::AppKey;

    #[test]
    fn rebase_preserves_unrelated_identity_and_selection() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let concurrent = AppKey::generate()?;
        let store_id = crate::StoreId::generate()?;
        let mut base = IdentityDirectory::empty();
        let resolved_identity = base.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &owner,
            member_label: None,
        })?;
        base = resolved_identity.directory;
        let identity_id = resolved_identity.identity_id;
        let mut candidate = base.clone();
        let opened_identity =
            candidate.open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                identity_id: &identity_id,
                vault: IdentityVaultKeyOpening {
                    app_key: &owner,
                    store_id: store_id.clone(),
                },
            })?;
        candidate = opened_identity.directory;
        let mut current = base.clone();
        let resolved_identity = current.create_identity(IdentityCreation {
            label: "Work",
            app_key: &concurrent,
            member_label: None,
        })?;
        current = resolved_identity.directory;
        let concurrent_id = resolved_identity.identity_id;

        let previous_selection = current.selection().clone();
        let rebased = current.rebase_staged_vault_creation(StagedIdentityRebase {
            base: &base,
            candidate: &candidate,
            identity_id: &identity_id,
        })?;

        assert_eq!(rebased.selection(), &previous_selection);
        assert_eq!(rebased.selected()?.identity_id, concurrent_id);
        assert!(
            rebased
                .identity(&identity_id)
                .is_some_and(|record| record.owns_vault(&store_id))
        );
        Ok(())
    }

    #[test]
    fn rebase_rejects_concurrent_target_change() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let staged_member = AppKey::generate()?;
        let concurrent_member = AppKey::generate()?;
        let mut base = IdentityDirectory::empty();
        let resolved_identity = base.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &owner,
            member_label: None,
        })?;
        base = resolved_identity.directory;
        let identity_id = resolved_identity.identity_id;
        let mut candidate = base.clone();
        let resolved_identity =
            candidate.enroll_selected_app_key_for_vault_creation(DirectoryCreationEnrollment {
                app_key: &staged_member,
                label: "Personal",
            })?;
        candidate = resolved_identity.directory;
        let mut current = base.clone();
        let resolved_identity =
            current.enroll_selected_app_key_for_vault_creation(DirectoryCreationEnrollment {
                app_key: &concurrent_member,
                label: "Personal",
            })?;
        current = resolved_identity.directory;

        let original = current.clone();
        let rejected = match current.rebase_staged_vault_creation(StagedIdentityRebase {
            base: &base,
            candidate: &candidate,
            identity_id: &identity_id,
        }) {
            Err(rejected) => rejected,
            Ok(_) => anyhow::bail!("Conflicting staged rebase unexpectedly succeeded"),
        };
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::StagedIdentityConflict { .. }
        ));
        assert_eq!(rejected.directory, original);
        Ok(())
    }

    #[test]
    fn rebase_rejects_app_key_added_to_another_identity() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let overlapping = AppKey::generate()?;
        let mut base = IdentityDirectory::empty();
        let resolved_identity = base.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &owner,
            member_label: None,
        })?;
        base = resolved_identity.directory;
        let identity_id = resolved_identity.identity_id;
        let mut candidate = base.clone();
        let resolved_identity =
            candidate.enroll_selected_app_key_for_vault_creation(DirectoryCreationEnrollment {
                app_key: &overlapping,
                label: "Personal",
            })?;
        candidate = resolved_identity.directory;
        let mut current = base.clone();
        let resolved_identity = current.create_identity(IdentityCreation {
            label: "Work",
            app_key: &overlapping,
            member_label: None,
        })?;
        current = resolved_identity.directory;

        let original = current.clone();
        let rejected = match current.rebase_staged_vault_creation(StagedIdentityRebase {
            base: &base,
            candidate: &candidate,
            identity_id: &identity_id,
        }) {
            Err(rejected) => rejected,
            Ok(_) => anyhow::bail!("Conflicting staged rebase unexpectedly succeeded"),
        };
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::DuplicateAppKeyOwnership { .. }
        ));
        assert_eq!(rejected.directory, original);
        Ok(())
    }
}
