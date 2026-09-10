//! Verified-connect finalization for extension identity handoffs.

use super::{NookVaultManager, PendingExtensionIdentityEnrollment, VaultNameState};
use crate::NookError;
use crate::manager::device_protection::ExtensionIdentityPublication;
use crate::storage::identity_record;
use crate::storage::identity_record::{
    AuthorizerSigningUpdate, ExistingVaultEnrollment, HandoffSignerPublication,
    IdentityHandoffCommitResult, IdentityHandoffOperation, PairedVaultEnrollment,
    VaultCreationAuthority, VaultCreationAuthorityRef,
};

pub(in crate::manager) struct PendingVaultCreationHandoff<'a> {
    pub(in crate::manager) authorizer: VaultCreationAuthorityRef<'a>,
    pub(in crate::manager) authorizer_signing: &'a AuthorizerSigningUpdate,
    pub(in crate::manager) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
}
pub(in crate::manager) enum VaultCreationHandoff<'a> {
    Ordinary,
    Extension(PendingVaultCreationHandoff<'a>),
}
#[derive(Debug, PartialEq, Eq)]
pub(in crate::manager) enum ExistingVaultImportState {
    NotImporting,
    Importing(nook_core::StoreId),
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
        matches!(
            &self.device.pending_extension_handoff,
            ExtensionIdentityPublication::Staged(_)
        )
    }

    pub(in crate::manager) fn pending_vault_creation_handoff(&self) -> VaultCreationHandoff<'_> {
        let ExtensionIdentityPublication::Staged(pending) = &self.device.pending_extension_handoff
        else {
            return VaultCreationHandoff::Ordinary;
        };
        match &pending.enrollment {
            PendingExtensionIdentityEnrollment::VaultCreation { authorizer } => {
                VaultCreationHandoff::Extension(PendingVaultCreationHandoff {
                    authorizer: authorizer.authorization(),
                    authorizer_signing: &pending.authorizer_signing,
                    signing_public_key: &pending.signing_public_key,
                })
            }
            PendingExtensionIdentityEnrollment::PairedVault { .. }
            | PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. }
            | PendingExtensionIdentityEnrollment::ExistingVaultImport { .. } => {
                VaultCreationHandoff::Ordinary
            }
        }
    }
    pub(in crate::manager) fn pending_existing_vault_import(&self) -> ExistingVaultImportState {
        let ExtensionIdentityPublication::Staged(pending) = &self.device.pending_extension_handoff
        else {
            return ExistingVaultImportState::NotImporting;
        };
        match &pending.enrollment {
            PendingExtensionIdentityEnrollment::ExistingVaultImport { store_id } => {
                ExistingVaultImportState::Importing(store_id.clone())
            }
            PendingExtensionIdentityEnrollment::VaultCreation { .. }
            | PendingExtensionIdentityEnrollment::PairedVault { .. }
            | PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. } => {
                ExistingVaultImportState::NotImporting
            }
        }
    }

    pub(in crate::manager) async fn finalize_existing_vault_import_handoff(
        &mut self,
    ) -> Result<(), NookError> {
        let ExistingVaultImportState::Importing(store_id) = self.pending_existing_vault_import()
        else {
            return Ok(());
        };
        let identity = self.device_identity()?;
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
            .pending()
            .map_err(|_| NookError::Database("Identity handoff disappeared.".to_owned()))?;
        let committed = identity_record::IdentityHandoffCommit {
            app_key: &identity,
            signing_public_key: &pending.signing_public_key,
            authorizer_signing: &AuthorizerSigningUpdate::RetainMembership,
            operation: IdentityHandoffOperation::ExistingVaultImport(ExistingVaultEnrollment {
                store_id: &store_id,
                existing: identity_record::ExistingVaultImportCommit {
                    device_id: identity.device_id().clone(),
                    label,
                },
            }),
            signing_seed: if pending.persist_signing_seed {
                HandoffSignerPublication::ReplaceWith(self.event_log.signing_seed.as_str())
            } else {
                HandoffSignerPublication::RetainStored
            },
        }
        .commit()
        .await?;
        let vault_keys = match committed {
            IdentityHandoffCommitResult::ExistingVaultImported(keys) => keys,
            IdentityHandoffCommitResult::PairedVaultCommitted => {
                return Err(NookError::Database(
                    "Existing-vault handoff did not return committed keys.".to_owned(),
                ));
            }
        };
        self.adopt_existing_vault_handoff_keys(&vault_keys)?;
        self.device.pending_extension_handoff = ExtensionIdentityPublication::Idle;
        Ok(())
    }

    pub(in crate::manager) async fn finalize_paired_vault_handoff(
        &mut self,
    ) -> Result<(), NookError> {
        let Ok(pending) = self.device.pending_extension_handoff.pending() else {
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
            self.device.pending_extension_handoff = ExtensionIdentityPublication::Idle;
            return Ok(());
        }
        let identity = self.device_identity()?;
        let signing_seed = if pending.persist_signing_seed {
            HandoffSignerPublication::ReplaceWith(self.event_log.signing_seed.as_str())
        } else {
            HandoffSignerPublication::RetainStored
        };
        let PendingExtensionIdentityEnrollment::PairedVault {
            authorizer,
            store_id,
        } = &pending.enrollment
        else {
            return Ok(());
        };
        identity_record::IdentityHandoffCommit {
            app_key: &identity,
            signing_public_key: &pending.signing_public_key,
            authorizer_signing: &pending.authorizer_signing,
            operation: IdentityHandoffOperation::PairedVault(PairedVaultEnrollment {
                authorizer,
                store_id,
            }),
            signing_seed,
        }
        .commit()
        .await?;
        self.device.pending_extension_handoff = ExtensionIdentityPublication::Idle;
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
            authorizer_signing: AuthorizerSigningUpdate::RetainMembership,
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
        assert!(matches!(
            manager.pending_vault_creation_handoff(),
            VaultCreationHandoff::Ordinary
        ));
        assert!(matches!(
            manager.pending_existing_vault_import(),
            ExistingVaultImportState::NotImporting
        ));

        manager.device.pending_extension_handoff = ExtensionIdentityPublication::Staged(
            staged_handoff(PendingExtensionIdentityEnrollment::VaultCreation {
                authorizer: VaultCreationAuthority::NewIdentity,
            })?,
        );
        assert!(manager.defers_identity_reconciliation_until_handoff());
        assert!(matches!(
            manager.pending_vault_creation_handoff(),
            VaultCreationHandoff::Extension(_)
        ));
        assert!(matches!(
            manager.pending_existing_vault_import(),
            ExistingVaultImportState::NotImporting
        ));

        let paired_store = nook_core::StoreId::generate()?;
        manager.device.pending_extension_handoff = ExtensionIdentityPublication::Staged(
            staged_handoff(PendingExtensionIdentityEnrollment::PairedVault {
                authorizer: AppKey::generate()?,
                store_id: paired_store,
            })?,
        );
        assert!(manager.defers_identity_reconciliation_until_handoff());
        assert!(matches!(
            manager.pending_vault_creation_handoff(),
            VaultCreationHandoff::Ordinary
        ));

        let unlock_store = nook_core::StoreId::generate()?;
        manager.device.pending_extension_handoff =
            ExtensionIdentityPublication::Staged(staged_handoff(
                PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock {
                    store_id: unlock_store,
                },
            )?);
        assert!(manager.defers_identity_reconciliation_until_handoff());

        let import_store = nook_core::StoreId::generate()?;
        manager.device.pending_extension_handoff = ExtensionIdentityPublication::Staged(
            staged_handoff(PendingExtensionIdentityEnrollment::ExistingVaultImport {
                store_id: import_store.clone(),
            })?,
        );
        assert!(manager.defers_identity_reconciliation_until_handoff());
        assert_eq!(
            manager.pending_existing_vault_import(),
            ExistingVaultImportState::Importing(import_store)
        );
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
