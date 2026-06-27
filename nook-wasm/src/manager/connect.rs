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
                if let Some(cached) = load_vault_local_cache(&self.local_cache_ref()).await? {
                    if !cached.trim().is_empty() {
                        return Ok("remote_missing_local_cache".to_owned());
                    }
                }
                return Ok("remote_missing".to_owned());
            }
            return Ok("new_vault".to_owned());
        }

        // First boot for this session — adopt the remote unlock mode.
        self.capture_vault_unlock(&content);
        self.last_synced_content = content.clone();
        Ok(access_status_for_vault_content(&content, &identity)?)
    }

    // Connects to storage (loads, decrypts, and updates session state)
    // Returns js_sys::Array of NookSecretRecord on success
    pub async fn connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<js_sys::Array, JsError> {
        self.connect_internal(storage_mode, github_pat, github_repo, false)
            .await
    }

    /// Replace storage with a fresh genesis vault for this device.
    pub async fn connect_fresh(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<js_sys::Array, JsError> {
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
    ) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("CONNECT_START".to_owned());
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
                    NookError::Database(
                        "No local vault copy is available to recover.".to_owned(),
                    )
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
        } else {
            let format =
                nook_core::detect_stored_format(&content).map_err(NookError::Decryption)?;
            let records =
                nook_core::deserialize_stored(&content, format).map_err(NookError::Decryption)?;
            if let Some(message) = nook_core::explain_connect_blocked(&records, &identity) {
                return Err(NookError::Database(message).into());
            }
            let _ = self.status_tx.send("DECRYPT_START".to_owned());
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
            self.maybe_sync_self_into_roster(&identity).await?;
            let _ = self.status_tx.send("DECRYPT_SUCCESS".to_owned());
            self.last_synced_content = content.clone();
        }

        save_device_identity_to_indexed_db(&self.device_id, &self.device_identity_secret).await?;

        if use_genesis || vault_file_missing {
            let _ = self.status_tx.send("GITHUB_INIT_START".to_owned());
            self.save_current_db().await?;
            let _ = self.status_tx.send("GITHUB_INIT_SUCCESS".to_owned());
        }

        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }

    fn initialize_genesis_vault(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        self.password_entries.clear();
        self.unlock = nook_core::VaultUnlock::Keys;
        self.stored_armored.clear();
        let keys = nook_core::generate_vault_keys().map_err(NookError::Encryption)?;
        self.apply_vault_keys(&keys.secrets_key, &keys.members_key)?;
        let genesis =
            nook_core::genesis_auth_record(identity, &keys.secrets_key, &keys.members_key)
                .map_err(NookError::Encryption)?;
        self.stored_armored
            .insert(genesis.key.clone(), genesis.value);
        for member in nook_core::genesis_members_records(identity, &keys.members_key, "genesis")
            .map_err(NookError::Encryption)?
        {
            self.stored_armored.insert(member.key.clone(), member.value);
        }
        self.decrypted_jsonl = String::new();
        self.secret_types.clear();
        self.last_synced_content.clear();
        Ok(())
    }

    // Initialize an empty database
    pub async fn initialize_empty(&mut self) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("INITIALIZE_START".to_owned());
        self.decrypted_jsonl = String::new();
        self.stored_armored.retain(|key, value| {
            nook_core::is_vault_meta_record(&nook_core::StoredSecretRecord {
                key: key.clone(),
                secret_type: None,
                value: value.clone(),
            })
        });
        self.secret_types.clear();
        if self.needs_genesis_persist() {
            let identity = self.device_identity()?;
            let secrets_key = self.secrets_key.clone();
            let members_key = self.members_key.clone();
            let genesis = nook_core::genesis_auth_record(&identity, &secrets_key, &members_key)
                .map_err(NookError::Encryption)?;
            self.stored_armored
                .insert(genesis.key.clone(), genesis.value);
            for member in nook_core::genesis_members_records(&identity, &members_key, "genesis")
                .map_err(NookError::Encryption)?
            {
                self.stored_armored.insert(member.key.clone(), member.value);
            }
        }
        self.save_current_db().await?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }
}
