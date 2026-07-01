//! `sync_vault_from_storage` — periodic poll-and-merge of the remote vault.
//!
//! Returns a JS object shape (`{changed, access_status?, secrets?,
//! pending_joins?, vault_members?}`) consumed by the web layer's sync timer.
//! Event-log vaults union remote events; legacy YAML polling is no longer used
//! for persistence after cutover.

use super::NookVaultManager;
use crate::NookError;
use crate::NookVaultSyncResult;
use crate::conversion::{
    LoadedVault, access_status_for_vault_content, load_stored_vault, sync_result_access_status,
    sync_result_session, sync_result_unchanged,
};
use crate::storage::event_db::{is_event_log_mode, load_local_event_store};
use nook_core::project_vault;
use std::collections::HashSet;
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
        let restore_local = self.storage_mode == nook_core::StorageMode::Local;
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;

        if self.event_log_mode || is_event_log_mode().await? {
            self.event_log_mode = true;
            if self.members_key.is_empty() {
                let mut vault_file_missing = false;
                let content = self.fetch_vault_content(&mut vault_file_missing).await?;
                if content.trim().is_empty() {
                    return sync_result_access_status("new_vault");
                }
                if !self.store_id.is_empty() {
                    let format = nook_core::detect_stored_format(&content)?;
                    let fresh_records = nook_core::deserialize_stored(&content, format)?;
                    nook_core::merge_remote_join_records(&mut self.stored_armored, &fresh_records);
                    if !nook_core::list_join_requests(&self.stored_records_snapshot()).is_empty() {
                        self.last_synced_content = content.clone();
                        return sync_result_session(self, true);
                    }
                }
                self.capture_vault_unlock(&content);
                self.last_synced_content = content.clone();
                let identity = self.ensure_device_identity().await?;
                let status = access_status_for_vault_content(&content, &identity)?;
                return sync_result_access_status(&status);
            }
            let yaml_changed = self.merge_remote_yaml_joins_from_storage().await?;
            // YAML join rows may exist before the joiner appends JoinRequested events.
            let event_changed = self.sync_event_log_from_storage().await.unwrap_or(false);
            let yaml_secrets_changed = self.merge_remote_yaml_user_secrets_from_storage().await?;
            let changed = event_changed || yaml_changed || yaml_secrets_changed;
            if changed {
                self.persist_projection_cache().await?;
            }
            let result = sync_result_session(self, changed)?;
            if restore_local {
                self.prepare_storage("local", "", "").await?;
            }
            return Ok(result);
        }

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
            self.capture_vault_unlock(&content);
            self.last_synced_content = content.clone();
            let identity = self.ensure_device_identity().await?;
            let status = access_status_for_vault_content(&content, &identity)?;
            return sync_result_access_status(&status);
        }

        let identity = self.device_identity()?;
        let format = nook_core::detect_stored_format(&content)?;
        let fresh_records = nook_core::deserialize_stored(&content, format)?;

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
        let import_yaml = self.serialize_current_projection_yaml()?;
        self.import_stored_vault_to_event_log(&import_yaml).await?;
        self.flush_event_outbox().await?;
        sync_result_session(self, true)
    }

    /// Merge pending join rows from the remote YAML snapshot.
    ///
    /// Event-log sync reads `nook-log/` events; join requests still land in
    /// `nook-vault.yaml` until assess/connect and legacy readers catch up.
    pub(in crate::manager) async fn merge_remote_yaml_joins_from_storage(
        &mut self,
    ) -> Result<bool, NookError> {
        let mut vault_file_missing = false;
        let content = self.fetch_vault_content(&mut vault_file_missing).await?;
        if content.trim().is_empty() {
            return Ok(false);
        }
        let format = nook_core::detect_stored_format(&content)?;
        let fresh_records = nook_core::deserialize_stored(&content, format)?;
        let has_remote_joins = fresh_records.iter().any(nook_core::is_join_stored_record);
        let before_joins = nook_core::list_join_requests(&self.stored_records_snapshot());
        nook_core::merge_remote_join_records(&mut self.stored_armored, &fresh_records);
        let after_joins = nook_core::list_join_requests(&self.stored_records_snapshot());
        let joins_changed = before_joins != after_joins;
        let content_changed = content.trim() != self.last_synced_content.trim();
        if joins_changed || content_changed || has_remote_joins {
            self.last_synced_content = content.clone();
            if joins_changed || has_remote_joins {
                self.persist_projection_cache().await?;
            }
            return Ok(joins_changed || content_changed || has_remote_joins);
        }
        Ok(false)
    }

    /// Merge user secret ciphertext from the remote YAML projection cache.
    pub(in crate::manager) async fn merge_remote_yaml_user_secrets_from_storage(
        &mut self,
    ) -> Result<bool, NookError> {
        let mut vault_file_missing = false;
        let content = self.fetch_vault_content(&mut vault_file_missing).await?;
        if content.trim().is_empty() {
            return Ok(false);
        }
        let format = nook_core::detect_stored_format(&content)?;
        let fresh_records = nook_core::deserialize_stored(&content, format)?;
        let tombstoned_secret_ids = if self.ensure_event_log_mode().await? {
            let store = load_local_event_store(&self.store_id).await?;
            let graph = store.load_graph(&self.store_id)?;
            let projection = project_vault(&graph, &self.store_id)?;
            projection
                .secrets
                .iter()
                .filter(|(_, secret)| !secret.is_live(&graph))
                .map(|(id, _)| id.as_str().to_owned())
                .collect::<HashSet<_>>()
        } else {
            HashSet::new()
        };
        let changed = nook_core::merge_remote_yaml_user_secrets_filtered(
            &mut self.stored_armored,
            &mut self.secret_types,
            &fresh_records,
            |key| !tombstoned_secret_ids.contains(key),
        );
        if !changed {
            return Ok(false);
        }
        if self.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
            let user_records = nook_core::user_stored_records(&self.stored_records_snapshot());
            let crypto = self
                .crypto
                .as_ref()
                .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
            self.decrypted_jsonl = nook_core::apply_user_records_to_armored_session(
                user_records,
                crypto,
                &mut self.stored_armored,
                &mut self.secret_types,
            )?
            .into_inner();
        }
        self.last_synced_content = content.clone();
        Ok(true)
    }
}
