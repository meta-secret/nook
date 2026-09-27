//! `sync_vault_from_storage` — periodic poll-and-merge of the remote vault.
//!
//! Returns a JS object shape (`{changed, access_status?, secrets?,
//! pending_joins?, vault_members?}`) consumed by the web layer's sync timer.
//! Event-log vaults union remote events. Projection YAML is never a sync source.

use super::NookVaultManager;
use crate::NookDatabase;
use crate::SyncResultSessionRequest;

use crate::{NookError, NookVaultSyncResult};
use nook_core::{StorageMode, VaultAccessStatus};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    pub async fn sync_vault_from_storage(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<NookVaultSyncResult, JsError> {
        tracing::debug!(
            scope = "wasm-sync",
            storage = %storage_mode,
            "sync_vault_from_storage started"
        );
        let initial_storage_mode = self.storage.mode;
        // `prepare_storage` clears `password_entries`/`unlock` on a mode/ref
        // switch (it assumes a *different* vault). A same-vault sync only
        // toggles the local-cache/remote tag, so preserve the backup-password
        // envelope; otherwise the subsequent `persist_projection_cache` rewrites
        // the local YAML without it and drops the password unlock envelope.
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;

        if self.event_log.enabled || NookDatabase::is_event_log_mode().await? {
            self.event_log.enabled = true;
            let sync_result = self.sync_event_log_from_storage().await;
            return self
                .finish_event_log_sync(sync_result, initial_storage_mode, &storage_mode)
                .await;
        }

        let mut remote_content_missing = false;
        let content = self
            .fetch_vault_content(&mut remote_content_missing)
            .await?;

        if content.trim() == self.vault.last_synced_content.trim() {
            if self.vault.members_key.is_empty() {
                return NookVaultSyncResult::sync_result_unchanged();
            }
            return NookVaultSyncResult::sync_result_session(SyncResultSessionRequest {
                manager: self,
                changed: false,
            });
        }

        if content.trim().is_empty() {
            self.vault.last_synced_content = content.clone();
            return NookVaultSyncResult::sync_result_access_status(VaultAccessStatus::NewVault);
        }

        if self.vault.members_key.is_empty() {
            self.capture_vault_unlock(&content)?;
            self.vault.last_synced_content = content.clone();
            let identity = self.ensure_device_identity()?;
            let status = nook_core::VaultContent::new(&content).access_status(&identity)?;
            return NookVaultSyncResult::sync_result_access_status(status);
        }

        Err(NookError::Database("Vault event log is required.".to_owned()).into())
    }
}

impl NookVaultManager {
    async fn finish_event_log_sync(
        &mut self,
        sync_result: Result<bool, NookError>,
        initial_storage_mode: StorageMode,
        storage_mode: &str,
    ) -> Result<NookVaultSyncResult, JsError> {
        let sync_result = match sync_result {
            Ok(changed) => {
                self.build_event_log_sync_result(changed, storage_mode)
                    .await
            }
            Err(error) => Err(JsError::new(&error.to_string())),
        };
        let restore_result = match initial_storage_mode {
            StorageMode::Local => self
                .prepare_storage_preserving_vault_metadata("local", "", "")
                .await
                .map_err(|error| JsError::new(&error.to_string())),
            StorageMode::Github | StorageMode::GoogleDrive | StorageMode::ICloud => Ok(()),
        };
        match (sync_result, restore_result) {
            (Err(sync_error), _) => Err(sync_error),
            (Ok(_), Err(restore_error)) => Err(restore_error),
            (Ok(result), Ok(())) => Ok(result),
        }
    }

    async fn build_event_log_sync_result(
        &mut self,
        changed: bool,
        storage_mode: &str,
    ) -> Result<NookVaultSyncResult, JsError> {
        if self.vault.crypto.is_unlocked() {
            if changed {
                self.persist_projection_cache()
                    .await
                    .map_err(|error| JsError::new(&error.to_string()))?;
            }
        } else {
            // Locked sentinel joiners still need share/join meta for ceremony.
            drop(self.materialize_vault_meta_from_events().await);
        }
        let result = NookVaultSyncResult::sync_result_session(SyncResultSessionRequest {
            manager: self,
            changed,
        })?;
        tracing::debug!(
            scope = "wasm-sync",
            changed,
            storage = %storage_mode,
            "sync_vault_from_storage (event log)"
        );
        Ok(result)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn sync_rejects_an_unknown_storage_mode_before_touching_session() {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_sync_fixture".to_owned();
        assert!(
            manager
                .sync_vault_from_storage("unknown".to_owned(), String::new(), String::new())
                .await
                .is_err()
        );
        assert_eq!(manager.vault.store_id, "store_sync_fixture");
    }

    #[wasm_bindgen_test]
    async fn local_sync_without_content_reports_a_new_vault() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        NookDatabase::clear_event_log_mode().await?;
        let identity = nook_core::DeviceIdentity::generate()?;
        manager.device.id = identity.device_id().to_string();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.vault.last_synced_content = "stale local projection".to_owned();

        let result = manager
            .sync_vault_from_storage("local".to_owned(), String::new(), String::new())
            .await?;
        assert!(result.changed());
        assert_eq!(result.access_status()?, VaultAccessStatus::NewVault);
        NookDatabase::clear_event_log_mode().await?;
        manager.delete_local_browser_data().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn local_sync_with_matching_empty_content_reports_unchanged() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        NookDatabase::clear_event_log_mode().await?;

        let result = manager
            .sync_vault_from_storage("local".to_owned(), String::new(), String::new())
            .await?;
        assert!(!result.changed());
        assert!(result.access_status().is_err());

        manager.delete_local_browser_data().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn local_sync_with_matching_content_returns_session_projection() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        NookDatabase::clear_event_log_mode().await?;
        manager.vault.last_synced_content.clear();
        manager.vault.members_key = "ab".repeat(32);

        let result = manager
            .sync_vault_from_storage("local".to_owned(), String::new(), String::new())
            .await?;
        assert!(!result.changed());
        assert!(result.access_status().is_err());
        assert!(result.vault_members().is_empty());

        manager.delete_local_browser_data().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn event_log_sync_restores_local_storage_after_projection() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        NookDatabase::set_event_log_mode().await?;
        manager.event_log.enabled = true;

        let result = manager
            .sync_vault_from_storage("local".to_owned(), String::new(), String::new())
            .await?;
        assert!(!result.changed());
        assert!(result.access_status().is_err());
        assert_eq!(manager.storage.mode, StorageMode::Local);

        NookDatabase::clear_event_log_mode().await?;
        manager.delete_local_browser_data().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn event_log_sync_propagates_github_403_and_restores_local_storage() {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::Github;
        let forbidden = crate::GitHubStorageClient::github_api_failure(
            reqwest::StatusCode::FORBIDDEN,
            "GitHub event tree listing failed with status 403 Forbidden".to_owned(),
        );
        assert!(matches!(
            &forbidden,
            NookError::GitHub(message) if message.contains("403 Forbidden")
        ));

        let result = manager
            .finish_event_log_sync(Err(forbidden), StorageMode::Local, "github")
            .await;

        assert!(result.is_err());
        assert_eq!(manager.storage.mode, StorageMode::Local);
    }
}
