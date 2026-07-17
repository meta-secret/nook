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
        let restore_local = self.storage.mode == nook_core::StorageMode::Local;
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
            if self.vault.crypto.is_some() {
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
            return sync_result_access_status(nook_core::VaultAccessStatus::NewVault);
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
