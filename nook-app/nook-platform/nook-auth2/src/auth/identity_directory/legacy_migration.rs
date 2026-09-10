//! Normalization for identity directories written before app-key uniqueness.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

mod admission;
use super::IdentityDirectory;
#[cfg(test)]
use crate::IdentityRecordRejection;
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{
    AppId, IdentityDirectoryRejection, IdentityId, IdentityMember, IdentityMemberKeyBinding,
    IdentityRecord, IdentitySelection,
};
use admission::LegacyDirectoryAdmission;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirectoryLegacyMigration {
    Unchanged,
    Merged,
}
impl DirectoryLegacyMigration {
    pub fn combine(self, other: Self) -> Self {
        match (self, other) {
            (Self::Unchanged, Self::Unchanged) => Self::Unchanged,
            (Self::Merged, _) | (_, Self::Merged) => Self::Merged,
        }
    }
}
#[derive(Debug)]
pub struct MigratedIdentityDirectory {
    pub directory: IdentityDirectory,
    pub migration: DirectoryLegacyMigration,
}
pub struct LegacyDirectoryBase<'a> {
    pub base: &'a IdentityDirectory,
    pub preserved_identity_id: &'a IdentityId,
}
enum LegacyMigrationScope<'a> {
    WholeDirectory,
    Preserve(&'a IdentityId),
    FromBase {
        preserved: &'a IdentityId,
        components: HashMap<IdentityId, usize>,
    },
}

impl LegacyMigrationScope<'_> {
    fn preserves(&self, identity: &IdentityId) -> bool {
        match self {
            Self::WholeDirectory => false,
            Self::Preserve(preserved) | Self::FromBase { preserved, .. } => *preserved == identity,
        }
    }
}

struct LegacyIdentityMerge {
    survivor: usize,
    absorbed: usize,
}
pub struct PreparedLegacyDirectoryMigration {
    directory: IdentityDirectory,
    merges: Vec<LegacyIdentityMerge>,
}
impl PreparedLegacyDirectoryMigration {
    pub fn cancel(self) -> IdentityDirectory {
        self.directory
    }
    pub fn commit(self) -> MigratedIdentityDirectory {
        let migration = if self.merges.is_empty() {
            DirectoryLegacyMigration::Unchanged
        } else {
            DirectoryLegacyMigration::Merged
        };
        let mut directory = self.directory;
        for merge in self.merges {
            directory = directory.merge_identity_records(merge);
        }
        MigratedIdentityDirectory {
            directory,
            migration,
        }
    }
}
impl IdentityDirectory {
    #[must_use]
    pub fn has_legacy_duplicate_app_key_ownership(&self) -> bool {
        !self.app_key_owners_are_unique()
    }

    pub fn migrate_legacy_duplicate_app_key_ownership(
        self,
    ) -> Result<MigratedIdentityDirectory, IdentityDirectoryRejection> {
        self.prepare_legacy_migration(LegacyMigrationScope::WholeDirectory)
            .map(PreparedLegacyDirectoryMigration::commit)
    }
    pub fn migrate_legacy_duplicate_app_key_ownership_preserving(
        self,
        identity_id: &IdentityId,
    ) -> Result<MigratedIdentityDirectory, IdentityDirectoryRejection> {
        self.prepare_legacy_duplicate_app_key_ownership_preserving(identity_id)
            .map(PreparedLegacyDirectoryMigration::commit)
    }
    pub fn prepare_legacy_duplicate_app_key_ownership_preserving(
        self,
        identity_id: &IdentityId,
    ) -> Result<PreparedLegacyDirectoryMigration, IdentityDirectoryRejection> {
        self.prepare_legacy_migration(LegacyMigrationScope::Preserve(identity_id))
    }
    pub fn migrate_legacy_duplicate_app_key_ownership_from_base(
        self,
        request: LegacyDirectoryBase<'_>,
    ) -> Result<MigratedIdentityDirectory, IdentityDirectoryRejection> {
        self.prepare_legacy_duplicate_app_key_ownership_from_base(request)
            .map(PreparedLegacyDirectoryMigration::commit)
    }
    pub fn prepare_legacy_duplicate_app_key_ownership_from_base(
        self,
        request: LegacyDirectoryBase<'_>,
    ) -> Result<PreparedLegacyDirectoryMigration, IdentityDirectoryRejection> {
        self.prepare_legacy_migration(LegacyMigrationScope::FromBase {
            preserved: request.preserved_identity_id,
            components: request.base.legacy_identity_components(),
        })
    }
    fn prepare_legacy_migration(
        self,
        scope: LegacyMigrationScope<'_>,
    ) -> Result<PreparedLegacyDirectoryMigration, IdentityDirectoryRejection> {
        match (LegacyDirectoryAdmission {
            directory: &self,
            scope,
        })
        .prepare()
        {
            Ok(merges) => Ok(PreparedLegacyDirectoryMigration {
                directory: self,
                merges,
            }),
            Err(cause) => Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            }),
        }
    }

    fn app_key_owners_are_unique(&self) -> bool {
        let mut owners = HashMap::<&AppId, usize>::new();
        for (index, identity) in self.identities.iter().enumerate() {
            for member in &identity.members {
                if let Some(owner) = owners.insert(&member.app_id, index)
                    && owner != index
                {
                    return false;
                }
            }
        }
        true
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

    fn merge_identity_records(mut self, merge: LegacyIdentityMerge) -> Self {
        let absorbed = self.identities.remove(merge.absorbed);
        let index = if merge.absorbed < merge.survivor {
            merge.survivor - 1
        } else {
            merge.survivor
        };
        let mut survivor = self.identities.remove(index);
        if self.selection == IdentitySelection::Selected(absorbed.identity_id) {
            self.selection = IdentitySelection::Selected(survivor.identity_id.clone());
        }
        survivor.control_epoch = survivor.control_epoch.max(absorbed.control_epoch);
        for member in absorbed.members {
            survivor = survivor.merge_admitted_legacy_member(member);
        }
        survivor.vault_deks.extend(absorbed.vault_deks);
        self.identities.insert(index, survivor);
        self
    }
}
impl IdentityMember {
    fn admit_legacy_peer(&self, incoming: &Self) -> MultiDeviceResult<()> {
        if matches!(
            self.binding_to_member(incoming),
            IdentityMemberKeyBinding::DifferentKeyMaterial
        ) {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "Legacy identity directory has conflicting material for one app key.".to_owned(),
            ));
        }
        if !self.signing_public_key.is_empty()
            && !incoming.signing_public_key.is_empty()
            && self.signing_public_key != incoming.signing_public_key
        {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "Legacy identity directory has conflicting signing keys for one app key."
                    .to_owned(),
            ));
        }
        Ok(())
    }
}
impl IdentityRecord {
    #[cfg(test)]
    fn merge_legacy_member(
        self,
        incoming: IdentityMember,
    ) -> Result<Self, IdentityRecordRejection> {
        if let Some(existing) = self
            .members
            .iter()
            .find(|member| member.app_id == incoming.app_id)
            && let Err(cause) = existing.admit_legacy_peer(&incoming)
        {
            return Err(IdentityRecordRejection {
                identity: self,
                cause,
            });
        }
        Ok(self.merge_admitted_legacy_member(incoming))
    }
    fn merge_admitted_legacy_member(mut self, incoming: IdentityMember) -> Self {
        if let Some(existing) = self
            .members
            .iter_mut()
            .find(|member| member.app_id == incoming.app_id)
        {
            if existing.signing_public_key.is_empty() {
                existing.signing_public_key = incoming.signing_public_key;
            }
            if existing.label.is_unnamed() {
                existing.label = incoming.label;
            }
        } else {
            self.members.push(incoming);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use crate::{DirectoryCreationEnrollment, IdentityCreation, IdentityVaultKeyOpening};

    use super::*;
    use crate::{AppKey, DeviceSigningPublicKey, MemberLabelState};

    impl IdentityMember {
        fn fixture(app: &AppKey) -> Self {
            Self {
                app_id: app.app_id().clone(),
                auth_id: app.auth_id(),
                public_key: app.public_key(),
                signing_public_key: DeviceSigningPublicKey::Unavailable,
                label: MemberLabelState::Unnamed,
            }
        }
    }

    #[test]
    fn member_merge_inserts_new_app_without_changing_existing_member() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let peer = AppKey::generate()?;
        let mut record =
            IdentityRecord::create_with_app_key("Personal", &owner, MemberLabelState::Unnamed)?;
        let existing = record.members[0].clone();
        let incoming = IdentityMember::fixture(&peer);
        record = record.merge_legacy_member(incoming.clone())?;
        assert_eq!(record.members, vec![existing, incoming]);
        Ok(())
    }

    #[test]
    fn member_merge_completes_missing_metadata_and_preserves_existing_values() -> anyhow::Result<()>
    {
        let owner = AppKey::generate()?;
        let mut record =
            IdentityRecord::create_with_app_key("Personal", &owner, MemberLabelState::Unnamed)?;
        let mut incoming = IdentityMember::fixture(&owner);
        incoming.signing_public_key = DeviceSigningPublicKey::parse(&"11".repeat(32))?;
        incoming.label = MemberLabelState::Named("First label".to_owned());
        record = record.merge_legacy_member(incoming.clone())?;
        assert_eq!(record.members, vec![incoming.clone()]);
        let mut later = incoming.clone();
        later.label = MemberLabelState::Named("Later label".to_owned());
        record = record.merge_legacy_member(later)?;
        record = record.merge_legacy_member(IdentityMember::fixture(&owner))?;
        assert_eq!(record.members, vec![incoming]);
        Ok(())
    }

    #[test]
    fn member_merge_rejects_conflicting_material_before_mutation() -> anyhow::Result<()> {
        let owner = AppKey::generate()?;
        let other = AppKey::generate()?;
        let mut record =
            IdentityRecord::create_with_app_key("Personal", &owner, MemberLabelState::Unnamed)?;
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
                Err(rejected) => {
                    let MultiDeviceError::InvalidDeviceIdentity(message) = rejected.cause else {
                        anyhow::bail!("expected identity rejection");
                    };
                    assert_eq!(message, expected);
                    record = rejected.identity;
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
        let mut personal =
            IdentityRecord::create_with_app_key("Personal", &shared, MemberLabelState::Unnamed)?;
        let store_id = crate::StoreId::generate()?;
        let opened_identity = personal.generate_vault_dek(store_id.clone())?;
        personal = opened_identity.identity;
        let expected = opened_identity.keys;
        let mut work =
            IdentityRecord::create_with_app_key("Work", &shared, MemberLabelState::Unnamed)?;
        work = work.add_member(IdentityMember {
            app_id: other.app_id().clone(),
            auth_id: other.auth_id(),
            public_key: other.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Unnamed,
        })?;
        let selected_id = work.identity_id.clone();
        let legacy = IdentityDirectory {
            identities: vec![personal, work],
            selection: IdentitySelection::Selected(selected_id.clone()),
            retired_app_ids: Vec::new(),
        };

        let MigratedIdentityDirectory {
            directory: migrated,
            migration,
        } = legacy.migrate_legacy_duplicate_app_key_ownership()?;

        assert_eq!(migration, DirectoryLegacyMigration::Merged);
        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(migrated.selected()?.identity_id, selected_id);
        assert_eq!(migrated.selected()?.members.len(), 2);
        assert_eq!(
            migrated.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &shared,
                store_id: store_id
            })?,
            expected
        );
        Ok(())
    }

    #[test]
    fn valid_directory_does_not_change() -> anyhow::Result<()> {
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &AppKey::generate()?,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let expected = directory.clone();

        let MigratedIdentityDirectory {
            directory: migrated,
            migration,
        } = directory.migrate_legacy_duplicate_app_key_ownership()?;

        assert_eq!(migration, DirectoryLegacyMigration::Unchanged);
        assert_eq!(migrated, expected);
        Ok(())
    }

    #[test]
    fn preserves_durably_referenced_identity_over_selected_identity() -> anyhow::Result<()> {
        let shared = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Pending genesis",
            app_key: &shared,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let pending_identity_id = resolved_identity.identity_id;
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Selected",
            app_key: &shared,
            member_label: MemberLabelState::Unnamed,
        })?;
        directory = resolved_identity.directory;
        let selected_identity_id = resolved_identity.identity_id;
        assert_ne!(pending_identity_id, selected_identity_id);

        let MigratedIdentityDirectory {
            directory: migrated,
            migration,
        } = directory
            .migrate_legacy_duplicate_app_key_ownership_preserving(&pending_identity_id)?;

        assert_eq!(migration, DirectoryLegacyMigration::Merged);
        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(migrated.selected()?.identity_id, pending_identity_id);
        Ok(())
    }

    #[test]
    fn staged_migration_rejects_candidate_only_duplicate_ownership() -> anyhow::Result<()> {
        let legacy_key = AppKey::generate()?;
        let candidate_key = AppKey::generate()?;
        let mut base = IdentityDirectory::empty();
        let resolved_identity = base.create_identity(IdentityCreation {
            label: "Pending",
            app_key: &legacy_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        base = resolved_identity.directory;
        let preserved_id = resolved_identity.identity_id;
        let resolved_identity = base.create_identity(IdentityCreation {
            label: "Legacy duplicate",
            app_key: &legacy_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        base = resolved_identity.directory;
        base = base.select(&preserved_id)?;
        let mut candidate = base.clone();
        let resolved_identity =
            candidate.enroll_selected_app_key_for_vault_creation(DirectoryCreationEnrollment {
                app_key: &candidate_key,
                label: "Pending",
            })?;
        candidate = resolved_identity.directory;
        let resolved_identity = candidate.create_identity(IdentityCreation {
            label: "Candidate overlap",
            app_key: &candidate_key,
            member_label: MemberLabelState::Unnamed,
        })?;
        candidate = resolved_identity.directory;

        assert!(matches!(
            candidate.migrate_legacy_duplicate_app_key_ownership_from_base(LegacyDirectoryBase {
                base: &base,
                preserved_identity_id: &preserved_id
            }),
            Err(IdentityDirectoryRejection {
                cause: MultiDeviceError::DuplicateAppKeyOwnership { .. },
                ..
            })
        ));
        Ok(())
    }

    #[test]
    fn transitive_signing_conflict_returns_every_original_record() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let first = IdentityRecord::create_with_app_key("First", &app, MemberLabelState::Unnamed)?;
        let mut second =
            IdentityRecord::create_with_app_key("Second", &app, MemberLabelState::Unnamed)?;
        let mut third =
            IdentityRecord::create_with_app_key("Third", &app, MemberLabelState::Unnamed)?;
        second.members[0].signing_public_key = DeviceSigningPublicKey::parse(&"11".repeat(32))?;
        third.members[0].signing_public_key = DeviceSigningPublicKey::parse(&"22".repeat(32))?;
        let original = IdentityDirectory {
            selection: IdentitySelection::Selected(first.identity_id.clone()),
            identities: vec![first, second, third],
            retired_app_ids: Vec::new(),
        };
        let before = serde_json::to_string(&original)?;
        let Err(rejected) = original.migrate_legacy_duplicate_app_key_ownership() else {
            anyhow::bail!("expected transitive conflict");
        };
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::InvalidDeviceIdentity(_)
        ));
        assert_eq!(serde_json::to_string(&rejected.directory)?, before);
        Ok(())
    }

    #[test]
    fn cancel_prepared_legacy_merge_returns_unmodified_directory() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let first = IdentityRecord::create_with_app_key("First", &app, MemberLabelState::Unnamed)?;
        let second =
            IdentityRecord::create_with_app_key("Second", &app, MemberLabelState::Unnamed)?;
        let selected = first.identity_id.clone();
        let original = IdentityDirectory {
            selection: IdentitySelection::Selected(selected.clone()),
            identities: vec![first, second],
            retired_app_ids: Vec::new(),
        };
        let before = serde_json::to_string(&original)?;
        let prepared = original.prepare_legacy_duplicate_app_key_ownership_preserving(&selected)?;
        assert_eq!(serde_json::to_string(&prepared.cancel())?, before);
        Ok(())
    }
}
