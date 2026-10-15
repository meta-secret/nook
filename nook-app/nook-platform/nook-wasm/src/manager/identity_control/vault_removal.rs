//! Deleting a vault everywhere: the identity log records its removal, and
//! every device (this one first) drops its local copy.

use nook_core::{IdentityControlOperation, StoreId, VaultDeletionPlan, VaultDeletionRequest};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::manager::NookVaultManager;
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
}
