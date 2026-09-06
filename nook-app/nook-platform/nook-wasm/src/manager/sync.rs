//! `sync_vault_from_storage` — periodic poll-and-merge of the remote vault.
//!
//! Returns a JS object shape (`{changed, access_status?, secrets?,
//! pending_joins?, vault_members?}`) consumed by the web layer's sync timer.
//! Event-log vaults union remote events. Projection YAML is never a sync source.

use super::NookVaultManager;
use crate::conversion::{
    access_status_for_vault_content, sync_result_access_status, sync_result_session,
    sync_result_unchanged,
};
use crate::storage::event_db::is_event_log_mode;
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
        let restore_local = self.storage.mode == StorageMode::Local;
        // `prepare_storage` clears `password_entries`/`unlock` on a mode/ref
        // switch (it assumes a *different* vault). A same-vault sync only
        // toggles the local-cache/remote tag, so preserve the backup-password
        // envelope; otherwise the subsequent `persist_projection_cache` rewrites
        // the local YAML without it and drops the password unlock envelope.
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;

        if self.event_log.enabled || is_event_log_mode().await? {
            self.event_log.enabled = true;
            let event_changed = self.sync_event_log_from_storage().await.unwrap_or(false);
            let changed = event_changed;
            if self.vault.crypto.is_unlocked() {
                if changed {
                    self.persist_projection_cache().await?;
                }
            } else {
                // Locked sentinel joiners still need share/join meta for ceremony.
                let _ = self.materialize_vault_meta_from_events().await;
            }
            let result = sync_result_session(self, changed)?;
            tracing::debug!(
                scope = "wasm-sync",
                changed,
                storage = %storage_mode,
                "sync_vault_from_storage (event log)"
            );
            if restore_local {
                // Same preservation as above: flipping the tag back to the local
                // cache must not wipe the in-memory password envelope.
                self.prepare_storage_preserving_vault_metadata("local", "", "")
                    .await?;
            }
            return Ok(result);
        }

        let mut remote_content_missing = false;
        let content = self
            .fetch_vault_content(&mut remote_content_missing)
            .await?;

        if content.trim() == self.vault.last_synced_content.trim() {
            if self.vault.members_key.is_empty() {
                return sync_result_unchanged();
            }
            return sync_result_session(self, false);
        }

        if content.trim().is_empty() {
            self.vault.last_synced_content = content.clone();
            return sync_result_access_status(VaultAccessStatus::NewVault);
        }

        if self.vault.members_key.is_empty() {
            self.capture_vault_unlock(&content)?;
            self.vault.last_synced_content = content.clone();
            let identity = self.ensure_device_identity()?;
            let status = access_status_for_vault_content(&content, &identity)?;
            return sync_result_access_status(status);
        }

        Err(NookError::Database("Vault event log is required.".to_owned()).into())
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
        crate::storage::event_db::clear_event_log_mode().await?;
        let identity = nook_core::DeviceIdentity::generate()?;
        manager.device.id = identity.device_id().to_string();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.vault.last_synced_content = "stale local projection".to_owned();

        let result = manager
            .sync_vault_from_storage("local".to_owned(), String::new(), String::new())
            .await?;
        assert!(result.changed());
        assert_eq!(result.access_status()?, VaultAccessStatus::NewVault);
        crate::storage::event_db::clear_event_log_mode().await?;
        manager.delete_local_browser_data().await?;
        Ok(())
    }
}
