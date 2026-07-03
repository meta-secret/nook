//! Vault connect / assess / genesis paths.
//!
//! - `assess_vault_connect` — pre-flight check the web layer runs before
//!   asking the user to confirm an unlock attempt.
//! - `connect` / `connect_fresh` / `connect_internal` — keys-mode unlock,
//!   with a clear short-circuit when the vault is in password mode.
//! - `initialize_empty` / `initialize_genesis_vault` — bootstrap a new
//!   vault file with this device as the genesis member.

use super::NookVaultManager;
use crate::NookError;
use crate::NookSecretRecord;
use crate::conversion::{
    LoadedVault, access_status_for_vault_content, content_requires_genesis, load_stored_vault,
};
use crate::storage::indexed_db::{load_vault_local_cache, save_device_identity_to_indexed_db};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Returns `ready`, `new_vault`, `needs_enrollment`, `join_pending`,
    /// `remote_missing`, or `remote_missing_local_cache`.
    pub async fn assess_vault_connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<String, JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity().await?;
        let mut vault_file_missing = false;
        let content = self.fetch_vault_content(&mut vault_file_missing).await?;

        if content.trim().is_empty() {
            self.password_entries.clear();
            self.unlock = nook_core::VaultUnlock::Keys;
            self.last_synced_content.clear();
            if vault_file_missing && self.storage_mode != nook_core::StorageMode::Local {
                if let Some(cached) = load_vault_local_cache(&self.local_cache_ref()).await?
                    && !cached.trim().is_empty()
                {
                    return Ok("remote_missing_local_cache".to_owned());
                }
                return Ok("remote_missing".to_owned());
            }
            return Ok("new_vault".to_owned());
        }

        // First boot for this session — adopt the remote unlock mode.
        self.capture_vault_unlock(&content);
        self.last_synced_content = content.clone();
        let status = access_status_for_vault_content(&content, &identity)?;
        let _ = self
            .status_tx
            .send(format!("ASSESS_{}_{}", self.storage_mode, status));
        tracing::info!(
            scope = "wasm-connect",
            status = %status,
            storage = %storage_mode,
            "assess_vault_connect"
        );
        Ok(status)
    }

    // Connects to storage (loads, decrypts, and updates session state)
    // Returns js_sys::Array of NookSecretRecord on success
    pub async fn connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.connect_internal(storage_mode, github_pat, github_repo, false)
            .await
    }

    /// Replace storage with a fresh genesis vault for this device.
    pub async fn connect_fresh(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.connect_internal(storage_mode, github_pat, github_repo, true)
            .await
    }

    /// Next `connect` loads the browser-local vault cache and recreates the
    /// remote file after a successful unlock.
    #[wasm_bindgen(js_name = prepareConnectFromLocalCache)]
    pub fn prepare_connect_from_local_cache(&mut self) {
        self.use_local_cache_for_connect = true;
    }

    #[wasm_bindgen(js_name = clearConnectRecovery)]
    pub fn clear_connect_recovery(&mut self) {
        self.use_local_cache_for_connect = false;
    }

    async fn connect_internal(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        force_genesis: bool,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status_tx.send("CONNECT_START".to_owned());
        tracing::info!(
            scope = "wasm-connect",
            storage = %storage_mode,
            force_genesis = force_genesis,
            "connect started"
        );
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity().await?;

        let mut vault_file_missing = false;
        let content = if self.use_local_cache_for_connect {
            self.use_local_cache_for_connect = false;
            let cached = load_vault_local_cache(&self.local_cache_ref())
                .await?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    NookError::Database("No local vault copy is available to recover.".to_owned())
                })?;
            vault_file_missing = true;
            cached
        } else {
            self.fetch_vault_content(&mut vault_file_missing).await?
        };

        // First boot for this session — adopt the remote unlock mode so
        // the mode-aware branches below see the right variant.
        if !content.trim().is_empty() {
            self.capture_vault_unlock(&content);
        }

        let use_genesis = content_requires_genesis(&content, force_genesis)?;

        if use_genesis {
            self.initialize_genesis_vault(&identity)?;
            if self.store_id.is_empty() {
                self.store_id = nook_core::generate_store_id()?.to_string();
            }
            self.bootstrap_event_log_genesis().await?;
            self.maybe_sync_self_into_roster(&identity)?;
            self.event_log_mode = true;
            self.persist_projection_cache().await?;
        } else if !content.trim().is_empty() {
            if self.event_log_has_events().await? || self.ensure_event_log_mode().await? {
                self.event_log_mode = true;
                let cache = crate::storage::indexed_db::load_from_indexed_db()
                    .await?
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| content.clone());
                let LoadedVault {
                    meta,
                    secrets_key,
                    members_key,
                    ..
                } = load_stored_vault(&cache, &identity)?;
                self.apply_vault_keys(&secrets_key, &members_key)?;
                self.meta = meta;
                self.capture_vault_unlock(&cache);
                self.sync_events_from_current_provider().await?;
                self.apply_event_projection_to_session().await?;
            } else {
                let format = nook_core::detect_stored_format(&content)?;
                let records = nook_core::deserialize_stored(&content, format)?;
                if let Some(message) = nook_core::explain_connect_blocked(&records, &identity) {
                    return Err(NookError::Database(message).into());
                }
                let _ = self.status_tx.send("DECRYPT_START".to_owned());
                let LoadedVault {
                    jsonl,
                    meta,
                    secrets_key,
                    members_key,
                } = load_stored_vault(&content, &identity)?;
                self.apply_vault_keys(&secrets_key, &members_key)?;
                self.decrypted_jsonl = jsonl;
                self.meta = meta;
                self.maybe_sync_self_into_roster(&identity)?;
                let _ = self.status_tx.send("DECRYPT_SUCCESS".to_owned());
                self.last_synced_content = content.clone();
                let import_yaml = self.serialize_current_projection_yaml()?;
                self.import_stored_vault_to_event_log(&import_yaml).await?;
                self.event_log_mode = true;
                self.flush_event_outbox().await?;
            }
        }

        save_device_identity_to_indexed_db(&self.device_id, &self.device_identity_secret).await?;

        if use_genesis || vault_file_missing {
            self.flush_event_outbox().await?;
            // Event-log mode still needs an initial YAML snapshot on the remote
            // provider for assess/connect and legacy sync readers.
            self.push_remote_vault_yaml_snapshot().await?;
            let _ = self.status_tx.send("GITHUB_INIT_SUCCESS".to_owned());
        }

        let _ = self.status_tx.send("READY".to_owned());
        let records = self.get_records()?;
        tracing::info!(
            scope = "wasm-connect",
            storage = %storage_mode,
            genesis = use_genesis,
            secrets = records.len(),
            "connect complete"
        );
        Ok(records)
    }

    fn initialize_genesis_vault(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        self.password_entries.clear();
        self.unlock = nook_core::VaultUnlock::Keys;
        self.meta = nook_core::VaultMetaState::default();
        let keys = nook_core::generate_vault_keys()?;
        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        let genesis =
            nook_core::genesis_auth_record(identity, &keys.secrets_key, &keys.members_key)?;
        self.meta.apply_record(&genesis);
        for member in nook_core::genesis_members_records(identity, &keys.members_key, "genesis")? {
            self.meta.apply_record(&member);
        }
        self.decrypted_jsonl = String::new();
        self.last_synced_content.clear();
        Ok(())
    }

    // Initialize an empty database
    pub async fn initialize_empty(&mut self) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status_tx.send("INITIALIZE_START".to_owned());
        self.decrypted_jsonl = String::new();
        self.meta.secrets.clear();
        if self.needs_genesis_persist() {
            let identity = self.device_identity()?;
            let secrets_key = nook_core::SymmetricKey::parse(&self.secrets_key)?;
            let members_key = nook_core::SymmetricKey::parse(&self.members_key)?;
            let genesis = nook_core::genesis_auth_record(&identity, &secrets_key, &members_key)?;
            self.meta.apply_record(&genesis);
            for member in nook_core::genesis_members_records(&identity, &members_key, "genesis")? {
                self.meta.apply_record(&member);
            }
        }
        if self.store_id.is_empty() {
            self.store_id = nook_core::generate_store_id()?.to_string();
        }
        self.ensure_event_log_ready().await?;
        self.persist_projection_cache().await?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }
}
