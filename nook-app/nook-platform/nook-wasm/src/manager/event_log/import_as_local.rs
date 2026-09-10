//! Import a provider/local-folder event log as an additional local vault.

use super::NookVaultManager;
#[cfg(test)]
use crate::SaveVaultBlobRequest;
use crate::VaultSnapshotLookup;
#[cfg(test)]
use crate::storage::indexed_db;
use crate::{NookDatabase, NookError};
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
        let VaultSnapshotLookup::Stored(_) = NookDatabase::load_vault_blob(trimmed).await? else {
            return Err(NookError::Database(format!(
                "Import as new vault removed the previous local vault {trimmed}."
            )));
        };
        let registry = NookDatabase::list_vault_registry_entries().await?;
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
        let existed = matches!(
            NookDatabase::load_vault_blob(&trimmed).await?,
            VaultSnapshotLookup::Stored(_)
        );
        Ok((trimmed, existed))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn empty_prior_vault_is_a_safe_import_snapshot() -> anyhow::Result<()> {
        assert_eq!(
            NookVaultManager::snapshot_prior_local_vault("  ").await?,
            (String::new(), false)
        );
        NookVaultManager::ensure_prior_local_vault_still_registered("", false).await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn prior_vault_snapshot_trims_and_preserves_a_registered_blob() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        let store_id = nook_core::StoreId::generate()?.to_string();
        NookDatabase::save_vault_blob(SaveVaultBlobRequest {
            store_id: &store_id,
            content: "prior vault",
        })
        .await?;

        assert_eq!(
            NookVaultManager::snapshot_prior_local_vault(&format!("  {store_id}  ")).await?,
            (store_id.clone(), true)
        );
        NookVaultManager::ensure_prior_local_vault_still_registered(&store_id, true).await?;

        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn prior_vault_snapshot_fails_closed_when_the_blob_disappears() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        let store_id = nook_core::StoreId::generate()?.to_string();
        let error = NookVaultManager::ensure_prior_local_vault_still_registered(&store_id, true)
            .await
            .expect_err("a missing prior blob must be reported");
        assert!(matches!(
            error,
            NookError::Database(message) if message.contains("removed the previous local vault")
        ));

        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        Ok(())
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
    #[wasm_bindgen]
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
    #[wasm_bindgen]
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
