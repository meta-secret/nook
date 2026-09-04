//! Three-way rebase policy for staged vault-creation identity ownership.

use std::iter;

use super::IdentityDirectory;
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{IdentityId, IdentityRecord};

impl IdentityDirectory {
    /// Apply one staged target identity over unrelated concurrent directory changes.
    ///
    /// The candidate may only differ from its base at `identity_id`. The current
    /// directory keeps its selection and unrelated identities. A concurrent
    /// change to the same target fails closed.
    pub fn rebase_staged_vault_creation(
        &self,
        base: &Self,
        candidate: &Self,
        identity_id: &IdentityId,
    ) -> MultiDeviceResult<Self> {
        let target =
            candidate
                .identity(identity_id)
                .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                    identity_id: identity_id.to_string(),
                })?;
        let base_target = base.identity(identity_id);
        let base_others = base.identities_without(identity_id);
        let candidate_others = candidate.identities_without(identity_id);
        if base_others != candidate_others || base.retired_app_ids != candidate.retired_app_ids {
            return Err(Self::staged_identity_conflict(identity_id));
        }

        let identities = match (
            base_target,
            self.identities
                .iter()
                .position(|record| &record.identity_id == identity_id),
        ) {
            (Some(_), Some(index)) if self.identities[index] == *target => self.identities.clone(),
            (Some(base_record), Some(index)) if self.identities[index] == *base_record => self
                .identities
                .iter()
                .enumerate()
                .map(|(current_index, record)| {
                    if current_index == index {
                        target.clone()
                    } else {
                        record.clone()
                    }
                })
                .collect(),
            (None, None) => self
                .identities
                .iter()
                .cloned()
                .chain(iter::once(target.clone()))
                .collect(),
            _ => return Err(Self::staged_identity_conflict(identity_id)),
        };
        let rebased = Self {
            identities,
            selection: self.selection.clone(),
            retired_app_ids: self.retired_app_ids.clone(),
        };
        rebased.validate()?;
        Ok(rebased)
    }

    fn identity(&self, identity_id: &IdentityId) -> Option<&IdentityRecord> {
        self.identities
            .iter()
            .find(|record| &record.identity_id == identity_id)
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
    use super::*;
    use crate::AppKey;

    #[test]
    fn rebase_preserves_unrelated_identity_and_selection() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let concurrent = AppKey::generate()?;
        let store_id = crate::generate_store_id()?;
        let mut base = IdentityDirectory::empty();
        let identity_id = base.create_identity("Personal", &owner, None)?;
        let mut candidate = base.clone();
        let _ = candidate.open_or_generate_vault_dek_for_identity(
            &identity_id,
            &owner,
            store_id.clone(),
        )?;
        let mut current = base.clone();
        let concurrent_id = current.create_identity("Work", &concurrent, None)?;

        let rebased = current.rebase_staged_vault_creation(&base, &candidate, &identity_id)?;

        assert_eq!(rebased.selection(), current.selection());
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
        let identity_id = base.create_identity("Personal", &owner, None)?;
        let mut candidate = base.clone();
        candidate.enroll_selected_app_key_for_vault_creation(&staged_member, "Personal")?;
        let mut current = base.clone();
        current.enroll_selected_app_key_for_vault_creation(&concurrent_member, "Personal")?;

        assert!(matches!(
            current.rebase_staged_vault_creation(&base, &candidate, &identity_id),
            Err(MultiDeviceError::StagedIdentityConflict { .. })
        ));
        Ok(())
    }

    #[test]
    fn rebase_rejects_app_key_added_to_another_identity() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let overlapping = AppKey::generate()?;
        let mut base = IdentityDirectory::empty();
        let identity_id = base.create_identity("Personal", &owner, None)?;
        let mut candidate = base.clone();
        candidate.enroll_selected_app_key_for_vault_creation(&overlapping, "Personal")?;
        let mut current = base.clone();
        current.create_identity("Work", &overlapping, None)?;

        assert!(matches!(
            current.rebase_staged_vault_creation(&base, &candidate, &identity_id),
            Err(MultiDeviceError::DuplicateAppKeyOwnership { .. })
        ));
        Ok(())
    }
}
