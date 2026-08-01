//! Import a provider/local-folder event log as an additional local vault.

use super::NookVaultManager;
use crate::NookError;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

impl NookVaultManager {
    async fn ensure_prior_local_vault_still_registered(
        prior_store_id: &str,
        prior_blob_existed: bool,
    ) -> Result<(), NookError> {
        if !prior_blob_existed {
            return Ok(());
        }
        let trimmed = prior_store_id.trim();
        if trimmed.is_empty() {
            return Ok(());
        }
        let Some(_) = crate::storage::indexed_db::load_vault_blob(trimmed).await? else {
            return Err(NookError::Database(format!(
                "Import as new vault removed the previous local vault {trimmed}."
            )));
        };
        let registry = crate::storage::indexed_db::list_vault_registry_entries().await?;
        if registry.iter().any(|entry| entry.store_id == trimmed) {
            return Ok(());
        }
        Err(NookError::Database(format!(
            "Import as new vault removed the previous local vault {trimmed} from the registry."
        )))
    }

    async fn snapshot_prior_local_vault(prior_store_id: &str) -> Result<(String, bool), NookError> {
        let trimmed = prior_store_id.trim().to_owned();
        if trimmed.is_empty() {
            return Ok((trimmed, false));
        }
        let existed = crate::storage::indexed_db::load_vault_blob(&trimmed)
            .await?
            .is_some();
        Ok((trimmed, existed))
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Copy a single-vault provider event log into local storage as its own vault.
    ///
    /// This is the safe recovery path when the active local vault and the provider
    /// have different `store_id`s: preserve the provider's append-only events
    /// locally, then let normal unlock/access checks decide whether this device
    /// can open that vault.
    #[wasm_bindgen(js_name = importProviderEventLogAsLocalVault)]
    pub async fn import_provider_event_log_as_local_vault(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<String, JsError> {
        let (prior_store_id, prior_blob_existed) =
            Self::snapshot_prior_local_vault(&self.vault.store_id).await?;
        self.reset_vault_session();
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        if self.vault.store_id.trim().is_empty() {
            return Err(NookError::Database(
                "No vault event log was found at this provider.".to_owned(),
            )
            .into());
        }
        self.hydrate_locked_projection_from_events().await?;
        self.persist_projection_cache().await?;
        Self::ensure_prior_local_vault_still_registered(&prior_store_id, prior_blob_existed)
            .await?;
        Ok(self.vault.store_id.clone())
    }

    /// Copy a single-vault local-folder event log into local storage as its own vault.
    #[wasm_bindgen(js_name = importLocalFolderEventLogAsLocalVault)]
    pub async fn import_local_folder_event_log_as_local_vault(
        &mut self,
        handle_id: &str,
    ) -> Result<String, JsError> {
        let (prior_store_id, prior_blob_existed) =
            Self::snapshot_prior_local_vault(&self.vault.store_id).await?;
        self.reset_vault_session();
        let remote_records = Self::read_external_local_folder_records(handle_id).await?;
        let _ = self.sync_external_event_log_records(remote_records).await?;
        if self.vault.store_id.trim().is_empty() {
            return Err(NookError::Database(
                "No vault event log was found in this backup folder.".to_owned(),
            )
            .into());
        }
        self.hydrate_locked_projection_from_events().await?;
        self.persist_projection_cache().await?;
        Self::ensure_prior_local_vault_still_registered(&prior_store_id, prior_blob_existed)
            .await?;
        Ok(self.vault.store_id.clone())
    }
}
