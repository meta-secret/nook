//! Portable identity collection and active-identity selection policy.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AppKey, IdentityId, IdentityMember, IdentityRecord, StoreId};

mod staged_rebase;

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
            for store_id in record.vault_deks.iter().map(|vault| &vault.store_id) {
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
        reconciliation: crate::IdentityVaultDekReconciliation,
    ) -> MultiDeviceResult<IdentityId> {
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
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: None,
        };
        let record = IdentityRecord::synthesize_from_legacy_vault(
            label,
            member,
            store_id,
            reconciliation.secrets_envelope,
            reconciliation.members_envelope,
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

    /// Enroll an authenticated installation into the identity that owns the
    /// paired vault, independent of the currently selected identity.
    pub fn enroll_app_key_for_owned_vault(
        &mut self,
        current_app_key: &AppKey,
        new_app_key: &AppKey,
        store_id: &StoreId,
    ) -> MultiDeviceResult<IdentityId> {
        let owner = self
            .identities
            .iter_mut()
            .find(|identity| identity.owns_vault(store_id))
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: format!("vault:{store_id}"),
            })?;
        if let Some(member) = owner
            .members
            .iter()
            .find(|member| member.app_id == *new_app_key.app_id())
        {
            if member.auth_id != new_app_key.auth_id()
                || member.public_key != new_app_key.public_key()
            {
                return Err(MultiDeviceError::InvalidDeviceIdentity(
                    "existing app id has different key material".to_owned(),
                ));
            }
            return Ok(owner.identity_id.clone());
        }
        let grant_store_ids = owner
            .vault_deks
            .iter()
            .filter(|grant| {
                grant
                    .secrets_envelopes
                    .iter()
                    .any(|entry| entry.app_id == *current_app_key.app_id())
                    && grant
                        .members_envelopes
                        .iter()
                        .any(|entry| entry.app_id == *current_app_key.app_id())
            })
            .map(|grant| grant.store_id.clone())
            .collect::<Vec<_>>();
        let keys_by_store = grant_store_ids
            .into_iter()
            .map(|grant_store_id| {
                owner
                    .open_or_generate_vault_dek(current_app_key, grant_store_id.clone())
                    .map(|keys| (grant_store_id, keys))
            })
            .collect::<MultiDeviceResult<Vec<_>>>()?;
        if !keys_by_store
            .iter()
            .any(|(grant_store_id, _)| grant_store_id == store_id)
        {
            return Err(MultiDeviceError::IdentityEnrollmentRequired);
        }
        let member = IdentityMember {
            app_id: new_app_key.app_id().clone(),
            auth_id: new_app_key.auth_id(),
            public_key: new_app_key.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: None,
        };
        owner.add_member(member.clone())?;
        owner.grant_member_to_vaults(&member, &keys_by_store)?;
        Ok(owner.identity_id.clone())
    }

    pub fn identity_for_app_key(&self, app_key: &AppKey) -> MultiDeviceResult<Option<IdentityId>> {
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
        &mut self,
        identity_id: &IdentityId,
        app_id: &crate::AppId,
        signing_public_key: &crate::DeviceSigningPublicKey,
    ) -> MultiDeviceResult<()> {
        self.identities
            .iter_mut()
            .find(|identity| &identity.identity_id == identity_id)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: identity_id.to_string(),
            })?
            .set_member_signing_public_key(app_id, signing_public_key)
    }

    /// Enroll an authenticated installation key into the selected identity
    /// before that identity owns a vault. Existing vaults require an explicit
    /// enrollment flow that also re-wraps every DEK.
    pub fn enroll_selected_app_key_for_vault_creation(
        &mut self,
        app_key: &AppKey,
        label: &str,
    ) -> MultiDeviceResult<IdentityId> {
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
            if !selected.vault_deks.is_empty() {
                return Err(MultiDeviceError::IdentityEnrollmentRequired);
            }
        }
        let selected = self.selected_mut()?;
        selected.add_prevalidated_member(IdentityMember {
            app_id: app_key.app_id().clone(),
            auth_id: app_key.auth_id(),
            public_key: app_key.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: None,
        });
        Ok(selected.identity_id.clone())
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
    use crate::IdentityVaultDekReconciliation;

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
    fn paired_handoff_enrolls_the_vault_owner_not_the_selection() -> anyhow::Result<()> {
        let website_key = AppKey::generate()?;
        let extension_key = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let owner_id = directory.create_identity("Personal", &website_key, None)?;
        let store_id = crate::generate_store_id()?;
        let expected_keys = directory.open_or_generate_vault_dek(&website_key, store_id.clone())?;
        let selected_id = directory.create_identity("Work", &website_key, None)?;

        let enrolled_id =
            directory.enroll_app_key_for_owned_vault(&website_key, &extension_key, &store_id)?;

        assert_eq!(enrolled_id, owner_id);
        assert_ne!(enrolled_id, selected_id);
        assert_eq!(
            directory.open_or_generate_vault_dek(&extension_key, store_id)?,
            expected_keys
        );
        assert_eq!(directory.selected()?.members.len(), 1);
        Ok(())
    }

    #[test]
    fn paired_handoff_preserves_vault_level_revocations() -> anyhow::Result<()> {
        let authorizer = AppKey::generate()?;
        let revoked = AppKey::generate()?;
        let handoff = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        directory.create_identity("Personal", &authorizer, None)?;
        directory.selected_mut()?.add_member(IdentityMember {
            app_id: revoked.app_id().clone(),
            auth_id: revoked.auth_id(),
            public_key: revoked.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: None,
        })?;
        let store_id = crate::generate_store_id()?;
        let keys = directory.open_or_generate_vault_dek(&authorizer, store_id.clone())?;
        directory.reconcile_vault_dek(
            &authorizer,
            &store_id,
            &IdentityVaultDekReconciliation {
                secrets_envelope: crate::encrypt_for_recipient(
                    keys.secrets_key.as_str().as_bytes(),
                    &authorizer.public_key(),
                )?,
                members_envelope: crate::encrypt_for_recipient(
                    keys.members_key.as_str().as_bytes(),
                    &authorizer.public_key(),
                )?,
                authorized_auth_ids: vec![authorizer.auth_id()],
            },
        )?;

        directory.enroll_app_key_for_owned_vault(&authorizer, &handoff, &store_id)?;

        let grant = directory
            .selected()?
            .vault_dek(&store_id)
            .ok_or_else(|| anyhow::anyhow!("vault grant missing"))?;
        for envelopes in [&grant.secrets_envelopes, &grant.members_envelopes] {
            assert!(
                envelopes
                    .iter()
                    .any(|entry| entry.app_id == *authorizer.app_id())
            );
            assert!(
                envelopes
                    .iter()
                    .any(|entry| entry.app_id == *handoff.app_id())
            );
            assert!(
                envelopes
                    .iter()
                    .all(|entry| entry.app_id != *revoked.app_id())
            );
        }
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
                signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
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
            authorized_auth_ids: vec![app_key.auth_id()],
        }
    }
}
