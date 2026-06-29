//! `sync_vault_from_storage` — periodic poll-and-merge of the remote vault.
//!
//! Returns a JS object shape (`{changed, access_status?, secrets?,
//! pending_joins?, vault_members?}`) consumed by the web layer's sync timer.
//! Mode-aware: in password mode it bypasses the per-device decryption path
//! and just reuses the session keys to refresh the armored cache.

use super::NookVaultManager;
use crate::NookError;
use crate::NookVaultSyncResult;
use crate::conversion::{
    LoadedVault, access_status_for_vault_content, load_stored_vault, sync_result_access_status,
    sync_result_session, sync_result_unchanged,
};
use crate::storage::event_db::is_event_log_mode;
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
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let mut vault_file_missing = false;
        let content = self.fetch_vault_content(&mut vault_file_missing).await?;

        if content.trim() == self.last_synced_content.trim() {
            if self.members_key.is_empty() {
                if self.event_log_mode || is_event_log_mode().await? {
                    self.ensure_vault_crypto_from_cache().await?;
                    if self.crypto.is_some() {
                        return sync_result_session(self, false);
                    }
                }
                return sync_result_unchanged();
            }
            return sync_result_session(self, false);
        }

        if content.trim().is_empty() {
            self.last_synced_content = content.clone();
            return sync_result_access_status("new_vault");
        }

        if self.members_key.is_empty() {
            // No active session yet — this is the first remote read we're
            // accepting, so adopt its unlock mode before deciding which
            // pre-flight status to report.
            self.capture_vault_unlock(&content);
            self.last_synced_content = content.clone();
            let identity = self.ensure_device_identity().await?;
            let status = access_status_for_vault_content(&content, &identity)?;
            return sync_result_access_status(&status);
        }

        let identity = self.device_identity()?;
        let format = nook_core::detect_stored_format(&content).map_err(NookError::Decryption)?;
        let fresh_records =
            nook_core::deserialize_stored(&content, format).map_err(NookError::Decryption)?;

        nook_core::merge_remote_join_records(&mut self.stored_armored, &fresh_records);
        let LoadedVault {
            jsonl,
            armored,
            secret_types,
            secrets_key,
            members_key,
        } = load_stored_vault(&content, &identity)?;
        self.apply_vault_keys(&secrets_key, &members_key)?;
        self.decrypted_jsonl = jsonl;
        self.stored_armored = armored;
        self.secret_types = secret_types;
        self.capture_vault_unlock(&content);
        self.last_synced_content = content.clone();
        sync_result_session(self, true)
    }
}
