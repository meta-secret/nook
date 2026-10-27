//! Deleting a vault everywhere: the identity log records its removal, and
//! every device (this one first) drops its local copy.

use nook_core::{
    EventLogLocation, IdentityControlOperation, StorageMode, StoreId, VaultDeletionPlan,
    VaultDeletionRequest,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::manager::NookVaultManager;
use crate::storage::local_folder::LocalFolderHandles;
use crate::{NookDatabase, NookError};

#[wasm_bindgen]
impl NookVaultManager {
    /// Delete a vault from the identity on every device. The removal is
    /// recorded in the identity log, which replicates it; this browser drops
    /// its copy at once. The vault open in this session is refused.
    #[wasm_bindgen]
    pub async fn delete_vault_everywhere(&mut self, store_id: String) -> Result<(), JsError> {
        let store_id = StoreId::parse(&store_id)?;
        let state = self.current_identity_state().await?;
        let open_store_id = StoreId::parse(self.vault.store_id.trim()).ok();
        match (VaultDeletionRequest {
            state: &state,
            store_id: &store_id,
            open_store_id: open_store_id.as_ref(),
        })
        .plan()
        {
            VaultDeletionPlan::RefuseOpen => {
                Err(NookError::Database("Close this vault before deleting it.".to_owned()).into())
            }
            VaultDeletionPlan::RecordRemoval => {
                // Applying the new state locally drops this browser's copy.
                self.append_identity_operations(vec![IdentityControlOperation::VaultRemoved {
                    store_id,
                }])
                .await?;
                Ok(())
            }
            VaultDeletionPlan::LocalOnly => {
                NookDatabase::forget_vault_removed_from_identity(store_id.as_str()).await?;
                Ok(())
            }
        }
    }

    /// Delete a removed vault's files at one identity mount. Only a vault the
    /// identity log records as removed qualifies; its encrypted events would
    /// otherwise stay readable to anyone holding the identity.
    #[wasm_bindgen]
    pub async fn delete_removed_vault_at_provider(
        &mut self,
        store_id: String,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<bool, JsError> {
        let store_id = StoreId::parse(&store_id)?;
        let state = self.current_identity_state().await?;
        if !state.removed_vaults.contains(&store_id) {
            return Err(NookError::Database(
                "Only a vault deleted from the identity is deleted at its providers.".to_owned(),
            )
            .into());
        }
        let restore_local = self.storage.mode == StorageMode::Local;
        let result = async {
            self.prepare_storage_preserving_vault_metadata(
                &storage_mode,
                &github_pat,
                &github_repo,
            )
            .await?;
            self.delete_provider_namespace_at(&EventLogLocation::Vault(store_id))
                .await
        }
        .await;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Ok(result?)
    }

    /// Delete a removed vault's files in one local-folder mount.
    #[wasm_bindgen]
    pub async fn delete_removed_vault_at_local_folder(
        &mut self,
        store_id: String,
        handle_id: String,
    ) -> Result<bool, JsError> {
        let store_id = StoreId::parse(&store_id)?;
        let state = self.current_identity_state().await?;
        if !state.removed_vaults.contains(&store_id) {
            return Err(NookError::Database(
                "Only a vault deleted from the identity is deleted at its providers.".to_owned(),
            )
            .into());
        }
        let folder = LocalFolderHandles::current()
            .open_folder(&handle_id)
            .await?;
        let nook_core::VaultPlacement::Filed(placed) =
            folder.placement(&EventLogLocation::Vault(store_id)).await?
        else {
            return Ok(false);
        };
        Ok(folder.delete_namespace(&placed).await?)
    }
}
