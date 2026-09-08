//! Verified-connect finalization for extension identity handoffs.

use super::{NookVaultManager, PendingExtensionIdentityEnrollment, VaultNameState};
use crate::NookError;
use crate::storage::identity_record;

pub(in crate::manager) struct PendingVaultCreationHandoff {
    pub(in crate::manager) authorizer: Option<nook_core::AppKey>,
    pub(in crate::manager) authorizer_signing:
        Option<(nook_core::AppId, nook_core::DeviceSigningPublicKey)>,
    pub(in crate::manager) signing_public_key: nook_core::DeviceSigningPublicKey,
    pub(in crate::manager) signing_seed: String,
}

impl NookVaultManager {
    fn adopt_existing_vault_handoff_keys(
        &mut self,
        vault_keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        self.apply_vault_keys(
            vault_keys.secrets_key.as_str(),
            vault_keys.members_key.as_str(),
        )
    }

    pub(in crate::manager) fn defers_identity_reconciliation_until_handoff(&self) -> bool {
        self.device
            .pending_extension_handoff
            .as_ref()
            .is_some_and(|pending| {
                matches!(
                    &pending.enrollment,
                    PendingExtensionIdentityEnrollment::VaultCreation { .. }
                        | PendingExtensionIdentityEnrollment::PairedVault { .. }
                        | PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. }
                        | PendingExtensionIdentityEnrollment::ExistingVaultImport { .. }
                )
            })
    }

    pub(in crate::manager) fn pending_vault_creation_handoff(
        &self,
    ) -> Option<PendingVaultCreationHandoff> {
        let pending = self.device.pending_extension_handoff.as_ref()?;
        let PendingExtensionIdentityEnrollment::VaultCreation { authorizer } = &pending.enrollment
        else {
            return None;
        };
        Some(PendingVaultCreationHandoff {
            authorizer: authorizer.clone(),
            authorizer_signing: pending.authorizer_signing.clone(),
            signing_public_key: pending.signing_public_key.clone(),
            signing_seed: pending.handoff_signing_seed.clone(),
        })
    }

    pub(in crate::manager) fn pending_existing_vault_import(&self) -> Option<nook_core::StoreId> {
        let pending = self.device.pending_extension_handoff.as_ref()?;
        let PendingExtensionIdentityEnrollment::ExistingVaultImport { store_id } =
            &pending.enrollment
        else {
            return None;
        };
        Some(store_id.clone())
    }

    pub(in crate::manager) async fn finalize_existing_vault_import_handoff(
        &mut self,
    ) -> Result<(), NookError> {
        if self.pending_existing_vault_import().is_none() {
            return Ok(());
        }
        let identity = self.device_identity()?;
        let store_id = self
            .pending_existing_vault_import()
            .ok_or_else(|| NookError::Database("Existing-vault handoff disappeared.".to_owned()))?;
        if self.vault.store_id != store_id.as_str() {
            return Err(NookError::Database(
                "Existing-vault handoff connected a different vault.".to_owned(),
            ));
        }
        let label = match &self.vault.vault_name {
            VaultNameState::Named(name) if !name.trim().is_empty() => name.clone(),
            _ => "Personal".to_owned(),
        };
        let pending = self
            .device
            .pending_extension_handoff
            .as_ref()
            .ok_or_else(|| NookError::Database("Identity handoff disappeared.".to_owned()))?;
        let committed = identity_record::IdentityHandoffCommit {
            app_key: &identity,
            signing_public_key: &pending.signing_public_key,
            authorizer_signing: None,
            enrollment: &pending.enrollment,
            signing_seed: pending
                .persist_signing_seed
                .then_some(self.event_log.signing_seed.as_str()),
            existing_vault: Some(identity_record::ExistingVaultImportCommit {
                device_id: identity.device_id().clone(),
                label,
            }),
        }
        .commit()
        .await?;
        let vault_keys = committed.existing_vault_keys.ok_or_else(|| {
            NookError::Database("Existing-vault handoff did not return committed keys.".to_owned())
        })?;
        self.adopt_existing_vault_handoff_keys(&vault_keys)?;
        self.device.pending_extension_handoff = None;
        Ok(())
    }

    pub(in crate::manager) async fn finalize_paired_vault_handoff(
        &mut self,
    ) -> Result<(), NookError> {
        let Some(pending) = self.device.pending_extension_handoff.as_ref() else {
            return Ok(());
        };
        let session_unlock = matches!(
            pending.enrollment,
            PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. }
        );
        let store_id = match &pending.enrollment {
            PendingExtensionIdentityEnrollment::PairedVault { store_id, .. }
            | PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { store_id } => {
                store_id.clone()
            }
            _ => return Ok(()),
        };
        if self.vault.store_id != store_id.as_str() {
            return Err(NookError::Database(
                "Paired-vault handoff connected a different vault.".to_owned(),
            ));
        }
        if session_unlock {
            self.device.pending_extension_handoff = None;
            return Ok(());
        }
        let identity = self.device_identity()?;
        let signing_seed = pending
            .persist_signing_seed
            .then_some(self.event_log.signing_seed.as_str());
        identity_record::IdentityHandoffCommit {
            app_key: &identity,
            signing_public_key: &pending.signing_public_key,
            authorizer_signing: pending.authorizer_signing.as_ref(),
            enrollment: &pending.enrollment,
            signing_seed,
            existing_vault: None,
        }
        .commit()
        .await?;
        self.device.pending_extension_handoff = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manager::device_protection::PendingExtensionIdentityHandoff;
    use nook_core::{AppKey, SigningIdentity};
    use wasm_bindgen_test::wasm_bindgen_test;

    fn staged_handoff(
        enrollment: PendingExtensionIdentityEnrollment,
    ) -> Result<PendingExtensionIdentityHandoff, NookError> {
        let (signing, signing_seed) = SigningIdentity::generate()?;
        Ok(PendingExtensionIdentityHandoff {
            enrollment,
            authorizer_signing: None,
            signing_public_key: signing.public_key(),
            handoff_signing_seed: signing_seed.as_str().to_owned(),
            persist_signing_seed: false,
            previous_session_signing_seed: String::new(),
        })
    }

    #[wasm_bindgen_test]
    fn handoff_state_helpers_cover_each_enrollment_shape() -> Result<(), NookError> {
        let mut manager = NookVaultManager::new();
        assert!(!manager.defers_identity_reconciliation_until_handoff());
        assert!(manager.pending_vault_creation_handoff().is_none());
        assert!(manager.pending_existing_vault_import().is_none());

        manager.device.pending_extension_handoff = Some(staged_handoff(
            PendingExtensionIdentityEnrollment::VaultCreation { authorizer: None },
        )?);
        assert!(manager.defers_identity_reconciliation_until_handoff());
        assert!(manager.pending_vault_creation_handoff().is_some());
        assert!(manager.pending_existing_vault_import().is_none());

        let paired_store = nook_core::StoreId::generate()?;
        manager.device.pending_extension_handoff = Some(staged_handoff(
            PendingExtensionIdentityEnrollment::PairedVault {
                authorizer: AppKey::generate()?,
                store_id: paired_store,
            },
        )?);
        assert!(manager.defers_identity_reconciliation_until_handoff());
        assert!(manager.pending_vault_creation_handoff().is_none());

        let unlock_store = nook_core::StoreId::generate()?;
        manager.device.pending_extension_handoff = Some(staged_handoff(
            PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock {
                store_id: unlock_store,
            },
        )?);
        assert!(manager.defers_identity_reconciliation_until_handoff());

        let import_store = nook_core::StoreId::generate()?;
        manager.device.pending_extension_handoff = Some(staged_handoff(
            PendingExtensionIdentityEnrollment::ExistingVaultImport {
                store_id: import_store.clone(),
            },
        )?);
        assert!(manager.defers_identity_reconciliation_until_handoff());
        assert_eq!(manager.pending_existing_vault_import(), Some(import_store));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn adopts_transactional_handoff_keys_into_live_session() -> Result<(), NookError> {
        let mut manager = NookVaultManager::new();
        manager.vault.secrets_key = "stale-secrets".to_owned();
        manager.vault.members_key = "stale-members".to_owned();
        let keys = nook_core::VaultKeys::generate()?;

        manager.adopt_existing_vault_handoff_keys(&keys)?;

        assert_eq!(manager.vault.secrets_key, keys.secrets_key.as_str());
        assert_eq!(manager.vault.members_key, keys.members_key.as_str());
        assert!(manager.vault.crypto.is_unlocked());
        Ok(())
    }
}
