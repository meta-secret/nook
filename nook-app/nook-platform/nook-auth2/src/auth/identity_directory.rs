//! Portable identity collection and active-identity selection policy.
mod enrollment;
mod recovery;

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{
    AppKey, IdentityId, IdentityLegacyVaultImport, IdentityLegacyVaultReconciliation,
    IdentityMember, IdentityMemberVaultGrant, IdentityRecord, IdentityVaultKeyOpening, StoreId,
};

mod legacy_migration;
pub use legacy_migration::{
    DirectoryLegacyMigration, LegacyDirectoryBase, MigratedIdentityDirectory,
    PreparedLegacyDirectoryMigration,
};
mod staged_rebase;
pub use staged_rebase::StagedIdentityRebase;
mod transition;
pub use transition::{
    DirectoryCreationEnrollment, DirectoryLegacyVaultImport, DirectoryMemberSigningUpdate,
    DirectoryOwnedVaultOpening, DirectoryVaultEnrollment, IdentityCreation,
    IdentityDirectoryRejection, IdentityDirectoryResolution, IdentityDirectoryVaultKeys,
    LocalIdentityKeyRetirement,
};
use transition::{IdentityEnrollmentPreparation, PreparedIdentityMembership};

/// Explicit local identity-selection state. A directory may retain peer-only
/// identities without selecting one as this installation's active identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "identityId", rename_all = "kebab-case")]
pub enum IdentitySelection {
    Empty,
    Selected(IdentityId),
}

/// Browser-independent collection of identities available to one installation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IdentityDirectory {
    identities: Vec<IdentityRecord>,
    selection: IdentitySelection,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    retired_app_ids: Vec<crate::AppId>,
}

impl IdentityDirectory {
    #[must_use]
    pub fn empty() -> Self {
        Self {
            identities: Vec::new(),
            selection: IdentitySelection::Empty,
            retired_app_ids: Vec::new(),
        }
    }

    pub fn from_records(
        identities: Vec<IdentityRecord>,
        selection: IdentitySelection,
    ) -> MultiDeviceResult<Self> {
        let directory = Self {
            identities,
            selection,
            retired_app_ids: Vec::new(),
        };
        directory.validate()?;
        Ok(directory)
    }

    pub fn from_legacy_record(record: IdentityRecord) -> MultiDeviceResult<Self> {
        let selected = record.identity_id.clone();
        Self::from_records(vec![record], IdentitySelection::Selected(selected))
    }

    pub fn validate(&self) -> MultiDeviceResult<()> {
        let mut ids = HashSet::with_capacity(self.identities.len());
        let mut vaults = HashSet::new();
        let retired: HashSet<_> = self.retired_app_ids.iter().collect();
        if retired.len() != self.retired_app_ids.len() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "identity directory contains duplicate retired app ids".to_owned(),
            ));
        }
        let mut app_ids = HashSet::new();
        for record in &self.identities {
            if !ids.insert(record.identity_id.clone()) {
                return Err(MultiDeviceError::DuplicateIdentity {
                    identity_id: record.identity_id.to_string(),
                });
            }
            if record
                .members
                .iter()
                .any(|member| retired.contains(&member.app_id))
            {
                return Err(MultiDeviceError::RetiredAppKey);
            }
            for member in &record.members {
                if !app_ids.insert(&member.app_id) {
                    return Err(MultiDeviceError::DuplicateAppKeyOwnership {
                        app_id: member.app_id.to_string(),
                    });
                }
            }
            for store_id in record.vault_deks.iter().map(|vault| &vault.store_id) {
                if !vaults.insert(store_id) {
                    return Err(MultiDeviceError::DuplicateVaultOwnership {
                        store_id: store_id.to_string(),
                    });
                }
            }
        }
        match (&self.selection, self.identities.is_empty()) {
            (IdentitySelection::Empty, _) => Ok(()),
            (IdentitySelection::Selected(identity_id), false) if ids.contains(identity_id) => {
                Ok(())
            }
            _ => Err(MultiDeviceError::InvalidIdentitySelection),
        }
    }

    #[must_use]
    pub fn identities(&self) -> &[IdentityRecord] {
        &self.identities
    }

    #[must_use]
    pub fn selection(&self) -> &IdentitySelection {
        &self.selection
    }

    #[must_use]
    pub fn retired_app_ids(&self) -> &[crate::AppId] {
        &self.retired_app_ids
    }

    pub fn create_identity(
        mut self,
        request: IdentityCreation<'_>,
    ) -> Result<IdentityDirectoryResolution, IdentityDirectoryRejection> {
        let IdentityCreation {
            label,
            app_key,
            member_label,
        } = request;
        let created: MultiDeviceResult<IdentityId> = (|| {
            self.ensure_app_key_active(app_key)?;
            let label = label.trim();
            if label.is_empty() {
                return Err(MultiDeviceError::IdentityLabelEmpty);
            }
            let record = IdentityRecord::create_with_app_key(label, app_key, member_label)?;
            let identity_id = record.identity_id.clone();
            self.identities.push(record);
            self.selection = IdentitySelection::Selected(identity_id.clone());
            Ok(identity_id)
        })();
        match created {
            Ok(identity_id) => Ok(IdentityDirectoryResolution {
                directory: self,
                identity_id,
            }),
            Err(cause) => Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            }),
        }
    }

    pub fn select(mut self, identity_id: &IdentityId) -> Result<Self, IdentityDirectoryRejection> {
        let selected: MultiDeviceResult<()> = (|| {
            if !self
                .identities
                .iter()
                .any(|record| &record.identity_id == identity_id)
            {
                return Err(MultiDeviceError::IdentityNotFound {
                    identity_id: identity_id.to_string(),
                });
            }
            self.selection = IdentitySelection::Selected(identity_id.clone());
            Ok(())
        })();
        match selected {
            Ok(()) => Ok(self),
            Err(cause) => Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            }),
        }
    }

    /// Associate an imported legacy vault without guessing that the active
    /// identity owns it. Existing ownership wins; otherwise the vault receives
    /// a synthesized identity because the legacy record has no identity id.
    pub fn import_legacy_vault(
        mut self,
        request: DirectoryLegacyVaultImport<'_>,
    ) -> Result<IdentityDirectoryResolution, IdentityDirectoryRejection> {
        let DirectoryLegacyVaultImport {
            label,
            app_key,
            store_id,
            reconciliation,
        } = request;
        if let Err(cause) = self.ensure_app_key_active(app_key) {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            });
        }
        if let Some(identity_id) = self
            .identities
            .iter()
            .find(|record| record.owns_vault(&store_id))
            .map(|record| record.identity_id.clone())
        {
            let directory = self.take_identity(&identity_id)?.update(|identity| {
                identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
                    app_key,
                    store_id: &store_id,
                    reconciliation: &reconciliation,
                })
            })?;
            return Ok(IdentityDirectoryResolution {
                directory,
                identity_id,
            }
            .select());
        }
        let identity_id = match self.identity_for_app_key(app_key) {
            Ok(identity_id) => identity_id,
            Err(cause) => {
                return Err(IdentityDirectoryRejection {
                    directory: self,
                    cause,
                });
            }
        };
        if let Some(identity_id) = identity_id {
            let directory = self.take_identity(&identity_id)?.update(|identity| {
                identity.import_legacy_vault(IdentityLegacyVaultImport {
                    app_key,
                    store_id,
                    reconciliation: &reconciliation,
                })
            })?;
            return Ok(IdentityDirectoryResolution {
                directory,
                identity_id,
            }
            .select());
        }
        let member = IdentityMember {
            app_id: app_key.app_id().clone(),
            auth_id: app_key.auth_id(),
            public_key: app_key.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: None,
        };
        let record = match IdentityRecord::synthesize_from_legacy_vault(
            label,
            member,
            store_id,
            reconciliation.secrets_envelope,
            reconciliation.members_envelope,
            reconciliation.epoch_update.committed_epoch(),
        ) {
            Ok(record) => record,
            Err(cause) => {
                return Err(IdentityDirectoryRejection {
                    directory: self,
                    cause,
                });
            }
        };
        let identity_id = record.identity_id.clone();
        self.identities.push(record);
        Ok(IdentityDirectoryResolution {
            directory: self,
            identity_id,
        }
        .select())
    }

    pub fn reconcile_vault_dek(
        self,
        request: IdentityLegacyVaultReconciliation<'_>,
    ) -> Result<IdentityDirectoryResolution, IdentityDirectoryRejection> {
        if let Err(cause) = self.ensure_app_key_active(request.app_key) {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            });
        }
        let Some(identity_id) = self
            .identities
            .iter()
            .find(|record| record.owns_vault(request.store_id))
            .map(|record| record.identity_id.clone())
        else {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: MultiDeviceError::IdentityNotFound {
                    identity_id: format!("vault:{}", request.store_id),
                },
            });
        };
        let directory = self
            .take_identity(&identity_id)?
            .update(|identity| identity.reconcile_legacy_vault_member(request))?;
        Ok(IdentityDirectoryResolution {
            directory,
            identity_id,
        })
    }

    pub fn open_vault_dek(
        &self,
        request: IdentityVaultKeyOpening<'_>,
    ) -> MultiDeviceResult<crate::VaultKeys> {
        self.ensure_app_key_active(request.app_key)?;
        let owner = match self
            .identities
            .iter()
            .find(|identity| identity.owns_vault(&request.store_id))
        {
            Some(owner) => owner,
            None => self.selected()?,
        };
        owner.open_vault_dek(request)
    }

    pub fn open_or_generate_vault_dek(
        self,
        request: IdentityVaultKeyOpening<'_>,
    ) -> Result<IdentityDirectoryVaultKeys, IdentityDirectoryRejection> {
        if let Err(cause) = self.ensure_app_key_active(request.app_key) {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            });
        }
        let owner = self
            .identities
            .iter()
            .find(|identity| identity.owns_vault(&request.store_id))
            .map(|identity| identity.identity_id.clone());
        let identity_id = match owner {
            Some(identity_id) => identity_id,
            None => match self.selected() {
                Ok(identity) => identity.identity_id.clone(),
                Err(cause) => {
                    return Err(IdentityDirectoryRejection {
                        directory: self,
                        cause,
                    });
                }
            },
        };
        self.take_identity(&identity_id)?
            .open_keys(|identity| identity.open_or_generate_vault_dek(request))
    }

    pub fn open_vault_dek_for_identity(
        &self,
        request: DirectoryOwnedVaultOpening<'_>,
    ) -> MultiDeviceResult<crate::VaultKeys> {
        self.ensure_app_key_active(request.vault.app_key)?;
        if self.identities.iter().any(|identity| {
            identity.owns_vault(&request.vault.store_id)
                && identity.identity_id != *request.identity_id
        }) {
            return Err(MultiDeviceError::DuplicateVaultOwnership {
                store_id: request.vault.store_id.to_string(),
            });
        }
        let owner = self
            .identities
            .iter()
            .find(|identity| identity.identity_id == *request.identity_id)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: request.identity_id.to_string(),
            })?;
        owner.open_vault_dek(request.vault)
    }

    pub fn open_or_generate_vault_dek_for_identity(
        self,
        request: DirectoryOwnedVaultOpening<'_>,
    ) -> Result<IdentityDirectoryVaultKeys, IdentityDirectoryRejection> {
        if let Err(cause) = self.ensure_app_key_active(request.vault.app_key) {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause,
            });
        }
        if self.identities.iter().any(|identity| {
            identity.owns_vault(&request.vault.store_id)
                && identity.identity_id != *request.identity_id
        }) {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: MultiDeviceError::DuplicateVaultOwnership {
                    store_id: request.vault.store_id.to_string(),
                },
            });
        }
        self.take_identity(request.identity_id)?
            .open_keys(|identity| identity.open_or_generate_vault_dek(request.vault))
    }

    pub fn validate_vault_enrollment(
        &self,
        app_key: &AppKey,
        store_id: &StoreId,
    ) -> MultiDeviceResult<()> {
        self.ensure_app_key_active(app_key)?;
        let Some(owner) = self
            .identities
            .iter()
            .find(|record| record.owns_vault(store_id))
        else {
            return Ok(());
        };
        let member = owner
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        if member.auth_id != app_key.auth_id() || member.public_key != app_key.public_key() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "existing app id has different key material".to_owned(),
            ));
        }
        Ok(())
    }

    pub fn identity_for_app_key(&self, app_key: &AppKey) -> MultiDeviceResult<Option<IdentityId>> {
        self.ensure_app_key_active(app_key)?;
        let mut matches = Vec::new();
        for identity in &self.identities {
            let Some(member) = identity
                .members
                .iter()
                .find(|member| member.app_id == *app_key.app_id())
            else {
                continue;
            };
            if member.auth_id != app_key.auth_id() || member.public_key != app_key.public_key() {
                return Err(MultiDeviceError::InvalidDeviceIdentity(
                    "existing app id has different key material".to_owned(),
                ));
            }
            matches.push(identity.identity_id.clone());
        }
        if matches.len() > 1 {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "app key belongs to multiple local identities".to_owned(),
            ));
        }
        Ok(matches.pop())
    }

    pub fn set_member_signing_public_key(
        self,
        request: DirectoryMemberSigningUpdate<'_>,
    ) -> Result<Self, IdentityDirectoryRejection> {
        self.take_identity(request.identity_id)?
            .update(|identity| identity.set_member_signing_public_key(request.member))
    }

    fn ensure_app_key_active(&self, app_key: &AppKey) -> MultiDeviceResult<()> {
        if self.retired_app_ids.contains(app_key.app_id()) {
            return Err(MultiDeviceError::RetiredAppKey);
        }
        Ok(())
    }

    pub fn selected(&self) -> MultiDeviceResult<&IdentityRecord> {
        let IdentitySelection::Selected(identity_id) = &self.selection else {
            return Err(MultiDeviceError::InvalidIdentitySelection);
        };
        self.identities
            .iter()
            .find(|record| &record.identity_id == identity_id)
            .ok_or(MultiDeviceError::InvalidIdentitySelection)
    }

    pub fn add_selected_member(
        self,
        member: IdentityMember,
    ) -> Result<Self, IdentityDirectoryRejection> {
        let identity_id = match self.selected() {
            Ok(identity) => identity.identity_id.clone(),
            Err(cause) => {
                return Err(IdentityDirectoryRejection {
                    directory: self,
                    cause,
                });
            }
        };
        self.take_identity(&identity_id)?
            .update(|identity| identity.add_member(member))
    }

    pub fn replace_selected(
        mut self,
        record: IdentityRecord,
    ) -> Result<Self, IdentityDirectoryRejection> {
        let valid_selection = matches!(&self.selection, IdentitySelection::Selected(identity_id) if identity_id == &record.identity_id);
        if !valid_selection {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: MultiDeviceError::InvalidIdentitySelection,
            });
        }
        if record
            .members
            .iter()
            .any(|member| self.retired_app_ids.contains(&member.app_id))
        {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: MultiDeviceError::RetiredAppKey,
            });
        }
        let Some(index) = self
            .identities
            .iter()
            .position(|identity| identity.identity_id == record.identity_id)
        else {
            return Err(IdentityDirectoryRejection {
                directory: self,
                cause: MultiDeviceError::InvalidIdentitySelection,
            });
        };
        self.identities[index] = record;
        Ok(self)
    }
}

impl Default for IdentityDirectory {
    fn default() -> Self {
        Self::empty()
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::IdentityVaultDekReconciliation;
    use crate::{
        DirectoryCreationEnrollment, DirectoryLegacyVaultImport, DirectoryOwnedVaultOpening,
        DirectoryVaultEnrollment, IdentityCreation, IdentityLegacyVaultReconciliation,
        IdentityVaultKeyOpening, LocalIdentityKeyRetirement,
    };

    fn known_epoch(epoch: char, checkpoint: char) -> anyhow::Result<crate::IdentityVaultDekEpoch> {
        let id = |fill: char| {
            crate::IdentityVaultEventId::parse(&format!("sha256u:{}", fill.to_string().repeat(43)))
        };
        Ok(crate::IdentityVaultDekEpoch::Known {
            key_epoch: id(epoch)?,
            checkpoint: id(checkpoint)?,
        })
    }

    #[test]
    fn creates_and_selects_independent_identities() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: " Personal ",
            app_key: &app_key,
            member_label: None,
        })?;
        directory = resolved_identity.directory;
        let personal = resolved_identity.identity_id;
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Work",
            app_key: &app_key,
            member_label: None,
        })?;
        directory = resolved_identity.directory;
        let work = resolved_identity.identity_id;

        assert_eq!(directory.identities().len(), 2);
        assert_eq!(directory.selected()?.identity_id, work);
        assert_eq!(directory.identities()[0].label, "Personal");

        directory = directory.select(&personal)?;
        assert_eq!(directory.selected()?.identity_id, personal);
        Ok(())
    }

    #[test]
    fn rejects_empty_labels_and_unknown_selection() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let rejected = match directory.create_identity(IdentityCreation {
            label: "   ",
            app_key: &app_key,
            member_label: None,
        }) {
            Err(rejected) => rejected,
            Ok(_) => anyhow::bail!("Empty label was accepted"),
        };
        directory = rejected.directory;
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::IdentityLabelEmpty
        ));
        assert!(directory.select(&IdentityId::generate()?).is_err());
        Ok(())
    }

    #[test]
    fn rejects_invalid_persisted_state() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let record = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        let duplicate = record.clone();
        assert!(
            IdentityDirectory::from_records(vec![record, duplicate], IdentitySelection::Empty,)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn replacement_cannot_change_selected_identity() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &app_key,
            member_label: None,
        })?;
        directory = resolved_identity.directory;
        let other = IdentityRecord::create_with_app_key("Other", &app_key, None)?;
        assert!(directory.replace_selected(other).is_err());
        Ok(())
    }

    #[test]
    fn genesis_retry_reopens_original_owner_after_selection_changes() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &app_key,
            member_label: None,
        })?;
        directory = resolved_identity.directory;
        let owner_id = resolved_identity.identity_id;
        let store_id = crate::StoreId::generate()?;
        let opened_identity = directory.open_or_generate_vault_dek(IdentityVaultKeyOpening {
            app_key: &app_key,
            store_id: store_id.clone(),
        })?;
        directory = opened_identity.directory;
        let original = opened_identity.keys;
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Work",
            app_key: &app_key,
            member_label: None,
        })?;
        directory = resolved_identity.directory;

        let opened_identity = directory.open_or_generate_vault_dek(IdentityVaultKeyOpening {
            app_key: &app_key,
            store_id: store_id.clone(),
        })?;
        directory = opened_identity.directory;
        let reopened = opened_identity.keys;
        assert_eq!(reopened, original);
        let owner = directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == owner_id)
            .ok_or_else(|| anyhow::anyhow!("original owner missing"))?;
        assert!(owner.vault_dek(&store_id).is_some());
        assert_eq!(directory.selected()?.label, "Work");

        let unenrolled = AppKey::generate()?;
        assert!(matches!(
            directory.validate_vault_enrollment(&unenrolled, &store_id),
            Err(MultiDeviceError::IdentityEnrollmentRequired)
        ));
        Ok(())
    }

    #[test]
    #[allow(
        unknown_lints,
        non_local_effect_before_unhandled_error,
        reason = "the contract intentionally exercises rejected legacy reconciliation and verifies that state stays unchanged"
    )]
    fn imported_legacy_vault_reuses_matching_identity_without_enrolling_unrelated_key()
    -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory.create_identity(IdentityCreation {
            label: "Personal",
            app_key: &app_key,
            member_label: None,
        })?;
        directory = resolved_identity.directory;
        let personal = resolved_identity.identity_id;
        let store_id = crate::StoreId::generate()?;
        let keys = crate::VaultKeys::generate()?;
        let imported = IdentityRecord::synthesize_from_legacy_vault(
            "Imported",
            IdentityMember {
                app_id: app_key.app_id().clone(),
                auth_id: app_key.auth_id(),
                public_key: app_key.public_key(),
                signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
                label: None,
            },
            store_id.clone(),
            app_key
                .public_key()
                .seal_bytes(keys.secrets_key.as_str().as_bytes())?,
            app_key
                .public_key()
                .seal_bytes(keys.members_key.as_str().as_bytes())?,
            crate::IdentityVaultDekEpoch::LegacyUnknown,
        )?;
        let secrets_envelope = imported.vault_deks[0].secrets_envelopes[0].envelope.clone();
        let members_envelope = imported.vault_deks[0].members_envelopes[0].envelope.clone();

        let resolved_identity = directory.import_legacy_vault(DirectoryLegacyVaultImport {
            label: "Imported",
            app_key: &app_key,
            store_id: store_id.clone(),
            reconciliation: observed_reconciliation(
                &app_key,
                secrets_envelope.clone(),
                members_envelope.clone(),
            )?,
        })?;
        directory = resolved_identity.directory;
        let imported_id = resolved_identity.identity_id;
        assert_eq!(imported_id, personal);
        assert_eq!(directory.identities().len(), 1);
        assert_eq!(directory.selected()?.identity_id, imported_id);
        assert_eq!(
            directory.selected()?.vault_deks[0].key_epoch,
            known_epoch('e', 'f')?
        );

        let resolved_identity = directory.import_legacy_vault(DirectoryLegacyVaultImport {
            label: "Ignored",
            app_key: &app_key,
            store_id: store_id,
            reconciliation: observed_reconciliation(&app_key, secrets_envelope, members_envelope)?,
        })?;
        directory = resolved_identity.directory;
        let same_id = resolved_identity.identity_id;
        assert_eq!(same_id, imported_id);
        assert_eq!(directory.identities().len(), 1);

        directory = directory
            .open_or_generate_vault_dek(IdentityVaultKeyOpening {
                app_key: &app_key,
                store_id: crate::StoreId::generate()?,
            })?
            .directory;
        let recovered_app_key = AppKey::generate()?;
        let imported_vault = directory.selected()?.vault_deks[0].clone();
        let recovered_secrets_envelope = recovered_app_key
            .public_key()
            .seal_bytes(keys.secrets_key.as_str().as_bytes())?;
        let recovered_members_envelope = recovered_app_key
            .public_key()
            .seal_bytes(keys.members_key.as_str().as_bytes())?;
        let result = directory.import_legacy_vault(DirectoryLegacyVaultImport {
            label: "Ignored",
            app_key: &recovered_app_key,
            store_id: imported_vault.store_id,
            reconciliation: observed_reconciliation(
                &recovered_app_key,
                recovered_secrets_envelope,
                recovered_members_envelope,
            )?,
        });
        let rejected = match result {
            Err(rejected) => rejected,
            Ok(_) => anyhow::bail!("Unenrolled import was accepted"),
        };
        directory = rejected.directory;
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::IdentityEnrollmentRequired
        ));
        let selected = directory.selected()?;
        assert_eq!(selected.vault_deks.len(), 2);
        assert!(
            !selected
                .members
                .iter()
                .any(|member| member.app_id == *recovered_app_key.app_id())
        );
        assert!(
            !selected.vault_deks[0]
                .secrets_envelopes
                .iter()
                .any(|entry| entry.app_id == *recovered_app_key.app_id())
        );
        Ok(())
    }

    fn observed_reconciliation(
        app_key: &AppKey,
        secrets_envelope: crate::AgeArmoredCiphertext,
        members_envelope: crate::AgeArmoredCiphertext,
    ) -> anyhow::Result<crate::IdentityVaultDekReconciliation> {
        Ok(crate::IdentityVaultDekReconciliation {
            secrets_envelope,
            members_envelope,
            epoch_update: crate::IdentityVaultDekEpochUpdate::Observe {
                key_epoch: known_epoch('e', 'f')?,
                checkpoint_ancestors: Vec::new(),
            },
            authorized_auth_ids: vec![app_key.auth_id()],
        })
    }
}
