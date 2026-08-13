//! Portable identity collection and active-identity selection policy.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AgeArmoredCiphertext, AppKey, IdentityId, IdentityMember, IdentityRecord, StoreId};

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
}

impl IdentityDirectory {
    #[must_use]
    pub fn empty() -> Self {
        Self {
            identities: Vec::new(),
            selection: IdentitySelection::Empty,
        }
    }

    pub fn from_records(
        identities: Vec<IdentityRecord>,
        selection: IdentitySelection,
    ) -> MultiDeviceResult<Self> {
        let directory = Self {
            identities,
            selection,
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
        for record in &self.identities {
            if !ids.insert(record.identity_id.clone()) {
                return Err(MultiDeviceError::DuplicateIdentity {
                    identity_id: record.identity_id.to_string(),
                });
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
        secrets_envelope: AgeArmoredCiphertext,
        members_envelope: AgeArmoredCiphertext,
    ) -> MultiDeviceResult<IdentityId> {
        if let Some(index) = self
            .identities
            .iter()
            .position(|record| record.vault_dek(&store_id).is_some())
        {
            self.identities[index].reconcile_legacy_vault_member(
                app_key,
                &store_id,
                secrets_envelope,
                members_envelope,
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
            secrets_envelope,
            members_envelope,
        )?;
        let identity_id = record.identity_id.clone();
        self.identities.push(record);
        self.selection = IdentitySelection::Selected(identity_id.clone());
        Ok(identity_id)
    }

    pub fn associate_sentinel_vault(
        &mut self,
        identity_id: &IdentityId,
        app_key: &AppKey,
        store_id: StoreId,
    ) -> MultiDeviceResult<IdentityId> {
        if let Some(owner) = self
            .identities
            .iter()
            .find(|record| record.owns_vault(&store_id))
            && owner.identity_id != *identity_id
        {
            return Err(MultiDeviceError::DuplicateVaultOwnership {
                store_id: store_id.to_string(),
            });
        }
        let identity = self
            .identities
            .iter_mut()
            .find(|record| record.identity_id == *identity_id)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: identity_id.to_string(),
            })?;
        let member = identity
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        if member.auth_id != app_key.auth_id() || member.public_key != app_key.public_key() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "existing app id has different key material".to_owned(),
            ));
        }
        identity.associate_sentinel_vault(store_id);
        Ok(identity.identity_id.clone())
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
        )?;
        let secrets_envelope = imported.vault_deks[0].secrets_envelopes[0].envelope.clone();
        let members_envelope = imported.vault_deks[0].members_envelopes[0].envelope.clone();

        let imported_id = directory.import_legacy_vault(
            "Imported",
            &app_key,
            store_id.clone(),
            secrets_envelope.clone(),
            members_envelope.clone(),
        )?;
        assert_ne!(imported_id, personal);
        assert_eq!(directory.identities().len(), 2);
        assert_eq!(directory.selected()?.identity_id, imported_id);

        let same_id = directory.import_legacy_vault(
            "Ignored",
            &app_key,
            store_id,
            secrets_envelope,
            members_envelope,
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
            recovered_secrets_envelope,
            recovered_members_envelope,
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

    #[test]
    fn sentinel_association_never_creates_app_key_dek_envelopes() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let store_id = crate::generate_store_id()?;
        let mut directory = IdentityDirectory::empty();
        let identity_id = directory.create_identity("Sentinel", &app_key, None)?;
        directory.associate_sentinel_vault(&identity_id, &app_key, store_id.clone())?;
        let selected = directory.selected()?;
        assert!(selected.owns_vault(&store_id));
        assert!(selected.vault_deks.is_empty());
        assert_eq!(selected.sentinel_vaults, vec![store_id]);
        let owned_store_id = selected.sentinel_vaults[0].clone();

        let other_id = directory.create_identity("Other", &app_key, None)?;
        assert!(matches!(
            directory.associate_sentinel_vault(&other_id, &app_key, owned_store_id,),
            Err(MultiDeviceError::DuplicateVaultOwnership { .. })
        ));
        Ok(())
    }
}
