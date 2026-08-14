//! Verified-connect finalization for extension identity handoffs.

use super::{NookVaultManager, PendingExtensionIdentityEnrollment};
use crate::NookError;

pub(in crate::manager) struct PendingVaultCreationHandoff {
    pub(in crate::manager) authorizer: Option<nook_core::AppKey>,
    pub(in crate::manager) authorizer_signing:
        Option<(nook_core::AppId, nook_core::DeviceSigningPublicKey)>,
    pub(in crate::manager) signing_public_key: nook_core::DeviceSigningPublicKey,
    pub(in crate::manager) signing_seed: String,
}

impl NookVaultManager {
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
        let Some(store_id) = self.pending_existing_vault_import() else {
            return Ok(());
        };
        if self.vault.store_id != store_id.as_str() {
            return Err(NookError::Database(
                "Existing-vault handoff connected a different vault.".to_owned(),
            ));
        }
        let identity = self.device_identity()?;
        let pending = self
            .device
            .pending_extension_handoff
            .as_ref()
            .ok_or_else(|| NookError::Database("Identity handoff disappeared.".to_owned()))?;
        let graph = crate::storage::event_db::load_local_event_store(store_id.as_str())
            .await?
            .load_graph(store_id.as_str())?;
        if !nook_core::event_graph_has_active_device_access(
            &graph,
            identity.device_id(),
            &identity.public_key(),
            &pending.signing_public_key,
        )? {
            return Err(NookError::Database(
                "Imported extension identity is not active in the signed vault roster.".to_owned(),
            ));
        }
        crate::storage::identity_record::commit_authenticated_identity_handoff(
            crate::storage::identity_record::IdentityHandoffCommit {
                app_key: &identity,
                signing_public_key: &pending.signing_public_key,
                authorizer_signing: None,
                enrollment: &pending.enrollment,
                signing_seed: pending
                    .persist_signing_seed
                    .then_some(self.event_log.signing_seed.as_str()),
            },
        )
        .await?;
        self.device.pending_extension_handoff = None;
        Ok(())
    }
}
