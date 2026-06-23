//! `sync_vault_from_storage` — periodic poll-and-merge of the remote vault.
//!
//! Returns a JS object shape (`{changed, access_status?, secrets?,
//! pending_joins?, vault_members?}`) consumed by the web layer's sync timer.
//! Mode-aware: in password mode it bypasses the per-device decryption path
//! and just reuses the session keys to refresh the armored cache.

use super::NookVaultManager;
use crate::NookError;
use crate::conversion::{
    LoadedVault, access_status_for_vault_content, load_stored_vault, records_to_armored,
    records_to_secret_types, sync_result_access_status, sync_result_session, sync_result_unchanged,
};
use wasm_bindgen::JsError;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    pub async fn sync_vault_from_storage(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<JsValue, JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let mut vault_file_missing = false;
        let content = self.fetch_vault_content(&mut vault_file_missing).await?;

        if content.trim() == self.last_synced_content.trim() {
            if self.members_key.is_empty() {
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
            if self.unlock.is_password() {
                return sync_result_access_status("password_required");
            }
            let identity = self.ensure_device_identity().await?;
            let status = access_status_for_vault_content(&content, &identity)?;
            return sync_result_access_status(&status);
        }

        // We DO have an active session. Deliberately do NOT call
        // `capture_vault_unlock` here: GitHub is eventually consistent,
        // and a poll that races our own write returns the *pre-write*
        // YAML — which would downgrade a freshly-set password envelope
        // back to keys mode. The active session is authoritative; remote
        // mode changes are picked up via explicit reconnect.

        let identity = self.device_identity()?;
        let format = nook_core::detect_stored_format(&content).map_err(NookError::Decryption)?;
        let fresh_records =
            nook_core::deserialize_stored(&content, format).map_err(NookError::Decryption)?;

        if self.unlock.is_password() {
            // Password mode: no per-device auth row to unwrap. Reuse the
            // active session keys, refresh the armored cache from the fresh
            // records, and let the decryption layer reuse the cached crypto.
            self.stored_armored = records_to_armored(&fresh_records);
            self.secret_types = records_to_secret_types(&fresh_records);
            let crypto =
                nook_core::VaultCrypto::new(&self.secrets_key).map_err(NookError::Encryption)?;
            let user_records = nook_core::user_stored_records(&fresh_records);
            let database =
                nook_core::Database::from_stored_records_with_crypto(&user_records, &crypto)
                    .map_err(NookError::Decryption)?;
            self.decrypted_jsonl = database.to_jsonl().map_err(NookError::Database)?;
            self.last_synced_content = content.clone();
            return sync_result_session(self, true);
        }

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
        self.last_synced_content = content.clone();
        sync_result_session(self, true)
    }
}
