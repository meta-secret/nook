//! Portable identity collection and active-identity selection policy.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AppKey, IdentityId, IdentityRecord};

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
        for record in &self.identities {
            if !ids.insert(record.identity_id.clone()) {
                return Err(MultiDeviceError::DuplicateIdentity {
                    identity_id: record.identity_id.to_string(),
                });
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
}
