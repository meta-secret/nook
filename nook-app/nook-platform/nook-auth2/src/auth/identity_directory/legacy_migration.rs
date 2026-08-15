//! Normalization for identity directories written before app-key uniqueness.

use std::collections::HashMap;

use super::IdentityDirectory;
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AppId, IdentityMember, IdentitySelection};

impl IdentityDirectory {
    /// Merge legacy identities connected by a shared app key.
    ///
    /// Older directories allowed one installation key to appear in several
    /// identities. Those records were not cryptographically independent. The
    /// lossless migration keeps every member and vault grant in one identity,
    /// preferring the selected identity as the surviving local identity.
    pub fn migrate_legacy_duplicate_app_key_ownership(mut self) -> MultiDeviceResult<(Self, bool)> {
        let mut changed = false;
        while let Some((left, right)) = self.duplicate_app_key_owners() {
            let (survivor, absorbed) = self.preferred_merge_order(left, right);
            self.merge_identity_records(survivor, absorbed)?;
            changed = true;
        }
        self.validate()?;
        Ok((self, changed))
    }

    fn duplicate_app_key_owners(&self) -> Option<(usize, usize)> {
        let mut owners = HashMap::<&AppId, usize>::new();
        for (index, identity) in self.identities.iter().enumerate() {
            for member in &identity.members {
                if let Some(owner) = owners.insert(&member.app_id, index)
                    && owner != index
                {
                    return Some((owner, index));
                }
            }
        }
        None
    }

    fn preferred_merge_order(&self, left: usize, right: usize) -> (usize, usize) {
        match &self.selection {
            IdentitySelection::Selected(selected)
                if self.identities[right].identity_id == *selected =>
            {
                (right, left)
            }
            _ => (left, right),
        }
    }

    fn merge_identity_records(
        &mut self,
        mut survivor_index: usize,
        absorbed_index: usize,
    ) -> MultiDeviceResult<()> {
        let absorbed = self.identities.remove(absorbed_index);
        if absorbed_index < survivor_index {
            survivor_index -= 1;
        }
        let survivor = &mut self.identities[survivor_index];
        survivor.control_epoch = survivor.control_epoch.max(absorbed.control_epoch);
        for member in absorbed.members {
            merge_member(&mut survivor.members, member)?;
        }
        for vault in absorbed.vault_deks {
            if survivor
                .vault_deks
                .iter()
                .any(|existing| existing.store_id == vault.store_id)
            {
                return Err(MultiDeviceError::DuplicateVaultOwnership {
                    store_id: vault.store_id.to_string(),
                });
            }
            survivor.vault_deks.push(vault);
        }
        Ok(())
    }
}

fn merge_member(
    members: &mut Vec<IdentityMember>,
    incoming: IdentityMember,
) -> MultiDeviceResult<()> {
    let Some(existing) = members
        .iter_mut()
        .find(|member| member.app_id == incoming.app_id)
    else {
        members.push(incoming);
        return Ok(());
    };
    if existing.auth_id != incoming.auth_id || existing.public_key != incoming.public_key {
        return Err(MultiDeviceError::InvalidDeviceIdentity(
            "Legacy identity directory has conflicting material for one app key.".to_owned(),
        ));
    }
    if existing.signing_public_key.is_empty() {
        existing.signing_public_key = incoming.signing_public_key;
    } else if !incoming.signing_public_key.is_empty()
        && existing.signing_public_key != incoming.signing_public_key
    {
        return Err(MultiDeviceError::InvalidDeviceIdentity(
            "Legacy identity directory has conflicting signing keys for one app key.".to_owned(),
        ));
    }
    if existing.label.is_none() {
        existing.label = incoming.label;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AppKey, IdentityRecord};

    #[test]
    fn merges_legacy_duplicate_owners_into_selected_identity() -> anyhow::Result<()> {
        let shared = AppKey::generate()?;
        let other = AppKey::generate()?;
        let mut personal = IdentityRecord::create_with_app_key("Personal", &shared, None)?;
        let store_id = crate::generate_store_id()?;
        let expected = personal.generate_vault_dek(store_id.clone())?;
        let mut work = IdentityRecord::create_with_app_key("Work", &shared, None)?;
        work.add_member(IdentityMember {
            app_id: other.app_id().clone(),
            auth_id: other.auth_id(),
            public_key: other.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: None,
        })?;
        let selected_id = work.identity_id.clone();
        let legacy = IdentityDirectory {
            identities: vec![personal, work],
            selection: IdentitySelection::Selected(selected_id.clone()),
        };

        let (mut migrated, changed) = legacy.migrate_legacy_duplicate_app_key_ownership()?;

        assert!(changed);
        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(migrated.selected()?.identity_id, selected_id);
        assert_eq!(migrated.selected()?.members.len(), 2);
        assert_eq!(
            migrated.open_or_generate_vault_dek(&shared, store_id)?,
            expected
        );
        Ok(())
    }

    #[test]
    fn valid_directory_does_not_change() -> anyhow::Result<()> {
        let mut directory = IdentityDirectory::empty();
        directory.create_identity("Personal", &AppKey::generate()?, None)?;
        let expected = directory.clone();

        let (migrated, changed) = directory.migrate_legacy_duplicate_app_key_ownership()?;

        assert!(!changed);
        assert_eq!(migrated, expected);
        Ok(())
    }
}
