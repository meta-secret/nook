//! Portable identity collection and active-identity selection policy.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AppKey, IdentityId, IdentityMember, IdentityRecord, StoreId};

/// Explicit identity-selection state. Empty directories cannot have a selection.
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
            for store_id in record
                .vault_deks
                .iter()
                .map(|vault| &vault.store_id)
                .chain(record.sentinel_vaults.iter())
            {
                if !vaults.insert(store_id) {
                    return Err(MultiDeviceError::DuplicateVaultOwnership {
                        store_id: store_id.to_string(),
                    });
                }
            }
        }
        match (&self.selection, self.identities.is_empty()) {
            (IdentitySelection::Empty, true) => Ok(()),
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

    pub fn create_identity(
        &mut self,
        label: &str,
        app_key: &AppKey,
        member_label: Option<String>,
    ) -> MultiDeviceResult<IdentityId> {
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
    }

    pub fn select(&mut self, identity_id: &IdentityId) -> MultiDeviceResult<()> {
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
    }

    /// Associate an imported legacy vault without guessing that the active
    /// identity owns it. Existing ownership wins; otherwise the vault receives
    /// a synthesized identity because the legacy record has no identity id.
    pub fn import_legacy_vault(
        &mut self,
        label: &str,
        app_key: &AppKey,
        store_id: StoreId,
        reconciliation: crate::IdentityVaultDekReconciliation,
    ) -> MultiDeviceResult<IdentityId> {
        self.ensure_app_key_active(app_key)?;
        if let Some(index) = self
            .identities
            .iter()
            .position(|record| record.vault_dek(&store_id).is_some())
        {
            self.identities[index].reconcile_legacy_vault_member(
                app_key,
                &store_id,
                &reconciliation,
            )?;
            let identity_id = self.identities[index].identity_id.clone();
            self.selection = IdentitySelection::Selected(identity_id.clone());
            return Ok(identity_id);
        }
        let member = IdentityMember {
            app_id: app_key.app_id().clone(),
            auth_id: app_key.auth_id(),
            public_key: app_key.public_key(),
            label: None,
        };
        let record = IdentityRecord::synthesize_from_legacy_vault(
            label,
            member,
            store_id,
            reconciliation.secrets_envelope,
            reconciliation.members_envelope,
            reconciliation.epoch_update.committed_epoch(),
        )?;
        let identity_id = record.identity_id.clone();
        self.identities.push(record);
        self.selection = IdentitySelection::Selected(identity_id.clone());
        Ok(identity_id)
    }

    pub fn reconcile_vault_dek(
        &mut self,
        app_key: &AppKey,
        store_id: &StoreId,
        reconciliation: &crate::IdentityVaultDekReconciliation,
    ) -> MultiDeviceResult<IdentityId> {
        self.ensure_app_key_active(app_key)?;
        let identity = self
            .identities
            .iter_mut()
            .find(|record| record.vault_dek(store_id).is_some())
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: format!("vault:{store_id}"),
            })?;
        identity.reconcile_legacy_vault_member(app_key, store_id, reconciliation)?;
        Ok(identity.identity_id.clone())
    }

    pub fn open_or_generate_vault_dek(
        &mut self,
        app_key: &AppKey,
        store_id: StoreId,
    ) -> MultiDeviceResult<crate::VaultKeys> {
        self.ensure_app_key_active(app_key)?;
        if let Some(index) = self
            .identities
            .iter()
            .position(|identity| identity.vault_dek(&store_id).is_some())
        {
            return self.identities[index].open_or_generate_vault_dek(app_key, store_id);
        }
        self.selected_mut()?
            .open_or_generate_vault_dek(app_key, store_id)
    }

    pub fn open_or_generate_vault_dek_for_identity(
        &mut self,
        identity_id: &IdentityId,
        app_key: &AppKey,
        store_id: StoreId,
    ) -> MultiDeviceResult<crate::VaultKeys> {
        self.ensure_app_key_active(app_key)?;
        if let Some(owner) = self
            .identities
            .iter()
            .find(|identity| identity.vault_dek(&store_id).is_some())
            && owner.identity_id != *identity_id
        {
            return Err(MultiDeviceError::DuplicateVaultOwnership {
                store_id: store_id.to_string(),
            });
        }
        self.identities
            .iter_mut()
            .find(|identity| identity.identity_id == *identity_id)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: identity_id.to_string(),
            })?
            .open_or_generate_vault_dek(app_key, store_id)
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

    /// Enroll an authenticated installation key into the selected identity
    /// before that identity owns a vault. Existing vaults require an explicit
    /// enrollment flow that also re-wraps every DEK.
    pub fn enroll_selected_app_key_for_vault_creation(
        &mut self,
        app_key: &AppKey,
        label: &str,
    ) -> MultiDeviceResult<IdentityId> {
        self.ensure_app_key_active(app_key)?;
        if matches!(&self.selection, IdentitySelection::Empty) {
            return self.create_identity(label, app_key, None);
        }
        {
            let selected = self.selected()?;
            if let Some(member) = selected
                .members
                .iter()
                .find(|member| member.app_id == *app_key.app_id())
            {
                if member.auth_id != app_key.auth_id() || member.public_key != app_key.public_key()
                {
                    return Err(MultiDeviceError::InvalidDeviceIdentity(
                        "existing app id has different key material".to_owned(),
                    ));
                }
                return Ok(selected.identity_id.clone());
            }
            if !selected.vault_deks.is_empty() || !selected.sentinel_vaults.is_empty() {
                return Err(MultiDeviceError::IdentityEnrollmentRequired);
            }
        }
        let selected = self.selected_mut()?;
        selected.add_prevalidated_member(IdentityMember {
            app_id: app_key.app_id().clone(),
            auth_id: app_key.auth_id(),
            public_key: app_key.public_key(),
            label: None,
        });
        Ok(selected.identity_id.clone())
    }

    /// Drop directory ownership sealed to an inaccessible installation key.
    /// Encrypted vault storage remains outside this portable record and may be
    /// rebound only after a recovery credential proves access.
    pub fn reset_for_device_recovery(&mut self) {
        for app_id in self
            .identities
            .iter()
            .flat_map(|identity| identity.members.iter().map(|member| member.app_id.clone()))
        {
            if !self.retired_app_ids.contains(&app_id) {
                self.retired_app_ids.push(app_id);
            }
        }
        self.identities.clear();
        self.selection = IdentitySelection::Empty;
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

    pub fn selected_mut(&mut self) -> MultiDeviceResult<&mut IdentityRecord> {
        let IdentitySelection::Selected(identity_id) = &self.selection else {
            return Err(MultiDeviceError::InvalidIdentitySelection);
        };
        self.identities
            .iter_mut()
            .find(|record| &record.identity_id == identity_id)
            .ok_or(MultiDeviceError::InvalidIdentitySelection)
    }

    pub fn replace_selected(&mut self, record: IdentityRecord) -> MultiDeviceResult<()> {
        let IdentitySelection::Selected(identity_id) = &self.selection else {
            return Err(MultiDeviceError::InvalidIdentitySelection);
        };
        if identity_id != &record.identity_id {
            return Err(MultiDeviceError::InvalidIdentitySelection);
        }
        if record
            .members
            .iter()
            .any(|member| self.retired_app_ids.contains(&member.app_id))
        {
            return Err(MultiDeviceError::RetiredAppKey);
        }
        let selected = self.selected_mut()?;
        *selected = record;
        Ok(())
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

    #[test]
    fn creates_and_selects_independent_identities() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let personal = directory.create_identity(" Personal ", &app_key, None)?;
        let work = directory.create_identity("Work", &app_key, None)?;

        assert_eq!(directory.identities().len(), 2);
        assert_eq!(directory.selected()?.identity_id, work);
        assert_eq!(directory.identities()[0].label, "Personal");

        directory.select(&personal)?;
        assert_eq!(directory.selected()?.identity_id, personal);
        Ok(())
    }

    #[test]
    fn rejects_empty_labels_and_unknown_selection() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        assert!(directory.create_identity("   ", &app_key, None).is_err());
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
        directory.create_identity("Personal", &app_key, None)?;
        let other = IdentityRecord::create_with_app_key("Other", &app_key, None)?;
        assert!(directory.replace_selected(other).is_err());
        Ok(())
    }

    #[test]
    fn authenticated_handoff_enrolls_only_before_vault_creation() -> anyhow::Result<()> {
        let website_key = AppKey::generate()?;
        let extension_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let identity_id = directory.create_identity("Personal", &website_key, None)?;
        assert_eq!(
            directory.enroll_selected_app_key_for_vault_creation(&extension_key, "Personal")?,
            identity_id
        );
        assert_eq!(directory.selected()?.members.len(), 2);

        let later_key = AppKey::generate()?;
        let _ =
            directory.open_or_generate_vault_dek(&extension_key, crate::generate_store_id()?)?;
        assert!(matches!(
            directory.enroll_selected_app_key_for_vault_creation(&later_key, "Personal"),
            Err(MultiDeviceError::IdentityEnrollmentRequired)
        ));
        Ok(())
    }

    #[test]
    fn genesis_retry_reopens_original_owner_after_selection_changes() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let owner_id = directory.create_identity("Personal", &app_key, None)?;
        let store_id = crate::generate_store_id()?;
        let original = directory.open_or_generate_vault_dek(&app_key, store_id.clone())?;
        directory.create_identity("Work", &app_key, None)?;

        let reopened = directory.open_or_generate_vault_dek(&app_key, store_id.clone())?;
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
    fn imported_legacy_vault_does_not_inherit_active_identity() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let personal = directory.create_identity("Personal", &app_key, None)?;
        let store_id = crate::generate_store_id()?;
        let keys = crate::generate_vault_keys()?;
        let imported = IdentityRecord::synthesize_from_legacy_vault(
            "Imported",
            IdentityMember {
                app_id: app_key.app_id().clone(),
                auth_id: app_key.auth_id(),
                public_key: app_key.public_key(),
                label: None,
            },
            store_id.clone(),
            crate::encrypt_for_recipient(
                keys.secrets_key.as_str().as_bytes(),
                &app_key.public_key(),
            )?,
            crate::encrypt_for_recipient(
                keys.members_key.as_str().as_bytes(),
                &app_key.public_key(),
            )?,
            crate::IdentityVaultDekEpoch::LegacyUnknown,
        )?;
        let secrets_envelope = imported.vault_deks[0].secrets_envelopes[0].envelope.clone();
        let members_envelope = imported.vault_deks[0].members_envelopes[0].envelope.clone();

        let imported_id = directory.import_legacy_vault(
            "Imported",
            &app_key,
            store_id.clone(),
            legacy_reconciliation(&app_key, secrets_envelope.clone(), members_envelope.clone()),
        )?;
        assert_ne!(imported_id, personal);
        assert_eq!(directory.identities().len(), 2);
        assert_eq!(directory.selected()?.identity_id, imported_id);

        let same_id = directory.import_legacy_vault(
            "Ignored",
            &app_key,
            store_id,
            legacy_reconciliation(&app_key, secrets_envelope, members_envelope),
        )?;
        assert_eq!(same_id, imported_id);
        assert_eq!(directory.identities().len(), 2);

        directory
            .selected_mut()?
            .generate_vault_dek(crate::generate_store_id()?)?;
        let recovered_app_key = AppKey::generate()?;
        let imported_vault = directory.selected()?.vault_deks[0].clone();
        let recovered_secrets_envelope = crate::encrypt_for_recipient(
            keys.secrets_key.as_str().as_bytes(),
            &recovered_app_key.public_key(),
        )?;
        let recovered_members_envelope = crate::encrypt_for_recipient(
            keys.members_key.as_str().as_bytes(),
            &recovered_app_key.public_key(),
        )?;
        let result = directory.import_legacy_vault(
            "Ignored",
            &recovered_app_key,
            imported_vault.store_id,
            legacy_reconciliation(
                &recovered_app_key,
                recovered_secrets_envelope,
                recovered_members_envelope,
            ),
        );
        assert!(matches!(
            result,
            Err(MultiDeviceError::IdentityEnrollmentRequired)
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

    fn legacy_reconciliation(
        app_key: &AppKey,
        secrets_envelope: crate::AgeArmoredCiphertext,
        members_envelope: crate::AgeArmoredCiphertext,
    ) -> crate::IdentityVaultDekReconciliation {
        crate::IdentityVaultDekReconciliation {
            secrets_envelope,
            members_envelope,
            epoch_update: crate::IdentityVaultDekEpochUpdate::Observe {
                key_epoch: crate::IdentityVaultDekEpoch::LegacyUnknown,
                checkpoint_ancestors: Vec::new(),
            },
            authorized_auth_ids: vec![app_key.auth_id()],
        }
    }

    #[test]
    fn device_recovery_removes_stale_local_ownership() -> anyhow::Result<()> {
        let inaccessible_key = AppKey::generate()?;
        let store_id = crate::generate_store_id()?;
        let mut directory = IdentityDirectory::empty();
        let identity_id = directory.create_identity("Personal", &inaccessible_key, None)?;
        let _ = directory.open_or_generate_vault_dek_for_identity(
            &identity_id,
            &inaccessible_key,
            store_id.clone(),
        )?;

        directory.reset_for_device_recovery();

        assert!(directory.identities().is_empty());
        assert_eq!(directory.selection(), &IdentitySelection::Empty);
        assert!(matches!(
            directory.create_identity("Stale", &inaccessible_key, None),
            Err(MultiDeviceError::RetiredAppKey)
        ));
        let replacement_key = AppKey::generate()?;
        directory.validate_vault_enrollment(&replacement_key, &store_id)?;
        Ok(())
    }
}
