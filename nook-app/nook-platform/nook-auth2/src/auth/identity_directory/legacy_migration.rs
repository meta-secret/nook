//! Normalization for identity directories written before app-key uniqueness.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::HashMap;

use super::IdentityDirectory;
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AppId, IdentityId, IdentityMember, IdentityRecord, IdentitySelection};

impl IdentityDirectory {
    /// Whether this directory predates unique app-key ownership enforcement.
    #[must_use]
    pub fn has_legacy_duplicate_app_key_ownership(&self) -> bool {
        self.duplicate_app_key_owners().is_some()
    }

    /// Merge legacy identities connected by a shared app key.
    ///
    /// Older directories allowed one installation key to appear in several
    /// identities. Those records were not cryptographically independent. The
    /// lossless migration keeps every member and vault grant in one identity,
    /// preferring the selected identity as the surviving local identity.
    pub fn migrate_legacy_duplicate_app_key_ownership(self) -> MultiDeviceResult<(Self, bool)> {
        self.migrate_legacy_duplicate_app_key_ownership_inner(None)
    }

    /// Merge legacy duplicate owners without absorbing a durable identity reference.
    pub fn migrate_legacy_duplicate_app_key_ownership_preserving(
        self,
        identity_id: &IdentityId,
    ) -> MultiDeviceResult<(Self, bool)> {
        self.migrate_legacy_duplicate_app_key_ownership_inner(Some(identity_id))
    }

    /// Merge only duplicate ownership relationships inherited from `base`.
    ///
    /// Staged candidates can add members. A duplicate introduced only by the
    /// candidate is a conflict, not legacy state, and must remain fail-closed.
    pub fn migrate_legacy_duplicate_app_key_ownership_from_base(
        mut self,
        base: &Self,
        preserved_identity_id: &IdentityId,
    ) -> MultiDeviceResult<(Self, bool)> {
        let components = base.legacy_identity_components();
        let mut changed = false;
        while let Some((left, right, app_id)) = self.duplicate_app_key_owners() {
            let left_component = components.get(&self.identities[left].identity_id);
            let right_component = components.get(&self.identities[right].identity_id);
            if left_component.is_none() || left_component != right_component {
                return Err(MultiDeviceError::DuplicateAppKeyOwnership {
                    app_id: app_id.to_string(),
                });
            }
            let (survivor, absorbed) =
                self.preferred_merge_order(left, right, Some(preserved_identity_id));
            self.merge_identity_records(survivor, absorbed)?;
            changed = true;
        }
        self.validate()?;
        Ok((self, changed))
    }

    fn migrate_legacy_duplicate_app_key_ownership_inner(
        mut self,
        preserved_identity_id: Option<&IdentityId>,
    ) -> MultiDeviceResult<(Self, bool)> {
        let mut changed = false;
        while let Some((left, right, _)) = self.duplicate_app_key_owners() {
            let (survivor, absorbed) =
                self.preferred_merge_order(left, right, preserved_identity_id);
            self.merge_identity_records(survivor, absorbed)?;
            changed = true;
        }
        self.validate()?;
        Ok((self, changed))
    }

    fn duplicate_app_key_owners(&self) -> Option<(usize, usize, AppId)> {
        let mut owners = HashMap::<&AppId, usize>::new();
        for (index, identity) in self.identities.iter().enumerate() {
            for member in &identity.members {
                if let Some(owner) = owners.insert(&member.app_id, index)
                    && owner != index
                {
                    return Some((owner, index, member.app_id.clone()));
                }
            }
        }
        None
    }

    fn legacy_identity_components(&self) -> HashMap<IdentityId, usize> {
        let mut components = (0..self.identities.len()).collect::<Vec<_>>();
        let mut owners = HashMap::<&AppId, usize>::new();
        for (index, identity) in self.identities.iter().enumerate() {
            for member in &identity.members {
                if let Some(owner) = owners.insert(&member.app_id, index) {
                    let from = components[index];
                    let into = components[owner];
                    for component in &mut components {
                        if *component == from {
                            *component = into;
                        }
                    }
                }
            }
        }
        self.identities
            .iter()
            .zip(components)
            .map(|(identity, component)| (identity.identity_id.clone(), component))
            .collect()
    }

    fn preferred_merge_order(
        &self,
        left: usize,
        right: usize,
        preserved_identity_id: Option<&IdentityId>,
    ) -> (usize, usize) {
        if preserved_identity_id
            .is_some_and(|identity_id| self.identities[right].identity_id == *identity_id)
        {
            return (right, left);
        }
        if preserved_identity_id
            .is_some_and(|identity_id| self.identities[left].identity_id == *identity_id)
        {
            return (left, right);
        }
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
        let survivor_identity_id = self.identities[survivor_index].identity_id.clone();
        if self.selection == IdentitySelection::Selected(absorbed.identity_id.clone()) {
            self.selection = IdentitySelection::Selected(survivor_identity_id);
        }
        let survivor = &mut self.identities[survivor_index];
        survivor.control_epoch = survivor.control_epoch.max(absorbed.control_epoch);
        for member in absorbed.members {
            survivor.merge_legacy_member(member)?;
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

impl IdentityRecord {
    fn merge_legacy_member(&mut self, incoming: IdentityMember) -> MultiDeviceResult<()> {
        let Some(index) = self
            .members
            .iter()
            .position(|member| member.app_id == incoming.app_id)
        else {
            self.members.push(incoming);
            return Ok(());
        };
        let existing = &self.members[index];
        if existing.auth_id != incoming.auth_id || existing.public_key != incoming.public_key {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "Legacy identity directory has conflicting material for one app key.".to_owned(),
            ));
        }
        if !existing.signing_public_key.is_empty()
            && !incoming.signing_public_key.is_empty()
            && existing.signing_public_key != incoming.signing_public_key
        {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "Legacy identity directory has conflicting signing keys for one app key."
                    .to_owned(),
            ));
        }
        let existing = &mut self.members[index];
        if existing.signing_public_key.is_empty() {
            existing.signing_public_key = incoming.signing_public_key;
        }
        if existing.label.is_none() {
            existing.label = incoming.label;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AppKey, DeviceSigningPublicKey};

    impl IdentityMember {
        fn fixture(app: &AppKey) -> Self {
            Self {
                app_id: app.app_id().clone(),
                auth_id: app.auth_id(),
                public_key: app.public_key(),
                signing_public_key: DeviceSigningPublicKey::Unavailable,
                label: None,
            }
        }
    }

    #[test]
    fn member_merge_inserts_new_app_without_changing_existing_member() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let peer = AppKey::generate()?;
        let mut record = IdentityRecord::create_with_app_key("Personal", &owner, None)?;
        let existing = record.members[0].clone();
        let incoming = IdentityMember::fixture(&peer);
        record.merge_legacy_member(incoming.clone())?;
        assert_eq!(record.members, vec![existing, incoming]);
        Ok(())
    }

    #[test]
    fn member_merge_completes_missing_metadata_and_preserves_existing_values() -> anyhow::Result<()>
    {
        let owner = AppKey::generate()?;
        let mut record = IdentityRecord::create_with_app_key("Personal", &owner, None)?;
        let mut incoming = IdentityMember::fixture(&owner);
        incoming.signing_public_key = DeviceSigningPublicKey::parse(&"11".repeat(32))?;
        incoming.label = Some("First label".to_owned());
        record.merge_legacy_member(incoming.clone())?;
        assert_eq!(record.members, vec![incoming.clone()]);
        let mut later = incoming.clone();
        later.label = Some("Later label".to_owned());
        record.merge_legacy_member(later)?;
        record.merge_legacy_member(IdentityMember::fixture(&owner))?;
        assert_eq!(record.members, vec![incoming]);
        Ok(())
    }

    #[test]
    fn member_merge_rejects_conflicting_material_before_mutation() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let other = AppKey::generate()?;
        let mut record = IdentityRecord::create_with_app_key("Personal", &owner, None)?;
        record.members[0].signing_public_key = DeviceSigningPublicKey::parse(&"11".repeat(32))?;
        let before = record.clone();
        let mut wrong_auth = IdentityMember::fixture(&owner);
        wrong_auth.auth_id = other.auth_id();
        let mut wrong_public_key = IdentityMember::fixture(&owner);
        wrong_public_key.public_key = other.public_key();
        let mut wrong_signing_key = IdentityMember::fixture(&owner);
        wrong_signing_key.signing_public_key = DeviceSigningPublicKey::parse(&"22".repeat(32))?;
        for (incoming, expected) in [
            (
                wrong_auth,
                "Legacy identity directory has conflicting material for one app key.",
            ),
            (
                wrong_public_key,
                "Legacy identity directory has conflicting material for one app key.",
            ),
            (
                wrong_signing_key,
                "Legacy identity directory has conflicting signing keys for one app key.",
            ),
        ] {
            match record.merge_legacy_member(incoming) {
                Err(MultiDeviceError::InvalidDeviceIdentity(message)) => {
                    assert_eq!(message, expected);
                }
                _ => anyhow::bail!("expected conflicting legacy member rejection"),
            }
            assert_eq!(record, before);
        }
        Ok(())
    }

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
            retired_app_ids: Vec::new(),
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

    #[test]
    fn preserves_durably_referenced_identity_over_selected_identity() -> anyhow::Result<()> {
        let shared = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let pending_identity_id = directory.create_identity("Pending genesis", &shared, None)?;
        let selected_identity_id = directory.create_identity("Selected", &shared, None)?;
        assert_ne!(pending_identity_id, selected_identity_id);

        let (migrated, changed) = directory
            .migrate_legacy_duplicate_app_key_ownership_preserving(&pending_identity_id)?;

        assert!(changed);
        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(migrated.selected()?.identity_id, pending_identity_id);
        Ok(())
    }

    #[test]
    fn staged_migration_rejects_candidate_only_duplicate_ownership() -> anyhow::Result<()> {
        let legacy_key = AppKey::generate()?;
        let candidate_key = AppKey::generate()?;
        let mut base = IdentityDirectory::empty();
        let preserved_id = base.create_identity("Pending", &legacy_key, None)?;
        base.create_identity("Legacy duplicate", &legacy_key, None)?;
        base.select(&preserved_id)?;
        let mut candidate = base.clone();
        candidate.enroll_selected_app_key_for_vault_creation(&candidate_key, "Pending")?;
        candidate.create_identity("Candidate overlap", &candidate_key, None)?;

        assert!(matches!(
            candidate.migrate_legacy_duplicate_app_key_ownership_from_base(&base, &preserved_id),
            Err(MultiDeviceError::DuplicateAppKeyOwnership { .. })
        ));
        Ok(())
    }
}
