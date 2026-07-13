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
use crate::conversion::{LoadedVault, access_status_for_vault_content, content_requires_genesis};
use crate::storage::indexed_db::load_vault_local_cache;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

fn is_sentinel_ceremony_required(err: &NookError) -> bool {
    match err {
        NookError::Encryption(message) | NookError::Database(message) => {
            message.contains("opened-share ceremony")
                || message.contains("SentinelCeremonyRequired")
        }
        _ => false,
    }
}

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
        let identity = self.ensure_device_identity()?;
        if self.storage.mode != nook_core::StorageMode::Local {
            self.sync_events_from_current_provider().await?;
            if !self.vault.store_id.is_empty() && self.event_log_has_events().await? {
                let status = nook_core::VaultAccessStatus::from(nook_core::assess_connect_access(
                    &self.stored_records_snapshot(),
                    &identity,
                ))
                .as_str()
                .to_owned();
                let _ = self
                    .status
                    .tx
                    .send(format!("ASSESS_{}_{}", self.storage.mode, status));
                return Ok(status);
            }
            if let Some(cached) = load_vault_local_cache(&self.local_cache_ref()).await?
                && !cached.trim().is_empty()
            {
                return Ok("remote_missing_local_cache".to_owned());
            }
            return Ok("remote_missing".to_owned());
        }
        let mut remote_content_missing = false;
        let content = self
            .fetch_vault_content(&mut remote_content_missing)
            .await?;

        if content.trim().is_empty() {
            if self.storage.mode != nook_core::StorageMode::Local {
                self.sync_events_from_current_provider().await?;
                if !self.vault.store_id.is_empty() && self.event_log_has_events().await? {
                    let status =
                        nook_core::VaultAccessStatus::from(nook_core::assess_connect_access(
                            &self.stored_records_snapshot(),
                            &identity,
                        ))
                        .as_str()
                        .to_owned();
                    let _ = self
                        .status
                        .tx
                        .send(format!("ASSESS_{}_{}", self.storage.mode, status));
                    return Ok(status);
                }
            }
            self.vault.password_entries.clear();
            self.vault.unlock = nook_core::VaultUnlock::Keys;
            self.vault.last_synced_content.clear();
            if remote_content_missing && self.storage.mode != nook_core::StorageMode::Local {
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
        self.vault.last_synced_content = content.clone();
        let status = access_status_for_vault_content(&content, &identity)?;
        let _ = self
            .status
            .tx
            .send(format!("ASSESS_{}_{}", self.storage.mode, status));
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
        self.storage.use_local_cache_for_connect = true;
    }

    #[wasm_bindgen(js_name = clearConnectRecovery)]
    pub fn clear_connect_recovery(&mut self) {
        self.storage.use_local_cache_for_connect = false;
    }

    async fn connect_internal(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        force_genesis: bool,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("CONNECT_START".to_owned());
        tracing::info!(
            scope = "wasm-connect",
            storage = %storage_mode,
            force_genesis = force_genesis,
            "connect started"
        );
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity()?;

        let (content, remote_content_missing) = self.load_connect_content().await?;

        // First boot for this session — adopt the remote unlock mode so
        // the mode-aware branches below see the right variant.
        if !content.trim().is_empty() {
            self.capture_vault_unlock(&content);
        }

        let event_log_only_remote = self
            .discover_event_log_only_remote(force_genesis, &content)
            .await?;

        let use_genesis = if event_log_only_remote {
            false
        } else {
            content_requires_genesis(&content, force_genesis)?
        };

        if use_genesis {
            self.bootstrap_genesis_connect(&identity).await?;
        } else if event_log_only_remote {
            self.connect_event_log_only_remote(&identity).await?;
        } else if !content.trim().is_empty() {
            self.connect_existing_content(&identity, &content).await?;
        }

        if use_genesis || remote_content_missing {
            self.flush_event_outbox().await?;
            let _ = self.status.tx.send("GITHUB_INIT_SUCCESS".to_owned());
        }

        let _ = self.status.tx.send("READY".to_owned());
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

    async fn connect_existing_content(
        &mut self,
        identity: &nook_core::DeviceIdentity,
        content: &str,
    ) -> Result<(), JsError> {
        if self.event_log_has_events().await? || self.ensure_event_log_mode().await? {
            self.event_log.enabled = true;
            let cache = crate::storage::indexed_db::load_from_indexed_db()
                .await?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| content.to_owned());
            match self.load_stored_vault_or_sentinel_ceremony(&cache, identity) {
                Ok(LoadedVault {
                    meta,
                    secrets_key,
                    members_key,
                    ..
                }) => {
                    self.apply_vault_keys(secrets_key.as_str(), members_key.as_str())?;
                    self.vault.meta = meta;
                    self.capture_vault_unlock(&cache);
                    self.sync_events_from_current_provider().await?;
                    self.apply_event_projection_to_session().await?;
                    Ok(())
                }
                Err(err) if is_sentinel_ceremony_required(&err) => {
                    self.prepare_sentinel_ceremony_session(&cache)?;
                    Err(err.into())
                }
                Err(err) => Err(err.into()),
            }
        } else {
            Err(NookError::Database("Vault event log is required.".to_owned()).into())
        }
    }

    async fn load_connect_content(&mut self) -> Result<(String, bool), NookError> {
        if self.storage.use_local_cache_for_connect {
            self.storage.use_local_cache_for_connect = false;
            let cached = load_vault_local_cache(&self.local_cache_ref())
                .await?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    NookError::Database("No local vault copy is available to recover.".to_owned())
                })?;
            return Ok((cached, true));
        }

        if self.storage.mode != nook_core::StorageMode::Local {
            self.sync_events_from_current_provider().await?;
            return Ok((String::new(), false));
        }

        let mut remote_content_missing = false;
        let content = self
            .fetch_vault_content(&mut remote_content_missing)
            .await?;
        Ok((content, remote_content_missing))
    }

    async fn bootstrap_genesis_connect(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        self.initialize_genesis_vault(identity)?;
        if self.vault.store_id.is_empty() {
            self.vault.store_id = nook_core::generate_store_id()?.to_string();
        }
        self.bootstrap_event_log_genesis().await?;
        self.maybe_sync_self_into_roster(identity)?;
        self.event_log.enabled = true;
        self.persist_projection_cache().await?;
        Ok(())
    }

    async fn discover_event_log_only_remote(
        &mut self,
        force_genesis: bool,
        content: &str,
    ) -> Result<bool, NookError> {
        if force_genesis
            || !content.trim().is_empty()
            || self.storage.mode == nook_core::StorageMode::Local
        {
            return Ok(false);
        }
        self.sync_events_from_current_provider().await?;
        Ok(!self.vault.store_id.is_empty() && self.event_log_has_events().await?)
    }

    async fn connect_event_log_only_remote(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        let records = self.stored_records_snapshot();
        if let Some(message) = nook_core::explain_connect_blocked(&records, identity) {
            return Err(NookError::Database(message));
        }
        let projection = self.serialize_current_projection_yaml()?;
        match self.load_stored_vault_or_sentinel_ceremony(&projection, identity) {
            Ok(loaded) => {
                let LoadedVault {
                    database,
                    meta,
                    secrets_key,
                    members_key,
                } = loaded;
                self.apply_vault_keys(secrets_key.as_str(), members_key.as_str())?;
                self.vault.database = database;
                self.vault.meta = meta;
                self.event_log.enabled = true;
                self.apply_event_projection_to_session().await?;
                self.persist_projection_cache().await?;
                let _ = self.status.tx.send("DECRYPT_SUCCESS".to_owned());
                Ok(())
            }
            Err(err) if is_sentinel_ceremony_required(&err) => {
                self.prepare_sentinel_ceremony_session(&projection)?;
                Err(err)
            }
            Err(err) => Err(err),
        }
    }

    fn initialize_genesis_vault(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        self.vault.password_entries.clear();
        self.vault.unlock = nook_core::VaultUnlock::Keys;
        self.vault.meta = nook_core::VaultMetaState::default();
        let keys = nook_core::generate_vault_keys()?;
        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        match self.vault.architecture.vault_type {
            nook_core::VaultType::Simple => {
                let genesis =
                    nook_core::genesis_auth_record(identity, &keys.secrets_key, &keys.members_key)?;
                self.vault.meta.apply_record(&genesis);
            }
            nook_core::VaultType::Sentinel => {
                // Sentinel genesis keeps vault keys in session memory only. Shares
                // are issued after the required participants are enrolled.
            }
        }
        for member in nook_core::genesis_members_records(identity, &keys.members_key, "genesis")? {
            self.vault.meta.apply_record(&member);
        }
        self.vault.database.clear();
        self.vault.last_synced_content.clear();
        Ok(())
    }

    // Initialize an empty database
    pub async fn initialize_empty(&mut self) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("INITIALIZE_START".to_owned());
        self.vault.database.clear();
        self.vault.meta.secrets.clear();
        if self.needs_genesis_persist() {
            let identity = self.device_identity()?;
            let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
            let members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
            match self.vault.architecture.vault_type {
                nook_core::VaultType::Simple => {
                    let genesis =
                        nook_core::genesis_auth_record(&identity, &secrets_key, &members_key)?;
                    self.vault.meta.apply_record(&genesis);
                }
                nook_core::VaultType::Sentinel => {
                    // Sentinel never writes per-device auth envelopes.
                }
            }
            for member in nook_core::genesis_members_records(&identity, &members_key, "genesis")? {
                self.vault.meta.apply_record(&member);
            }
        }
        if self.vault.store_id.is_empty() {
            self.vault.store_id = nook_core::generate_store_id()?.to_string();
        }
        if !self.event_log_has_events().await? {
            self.bootstrap_event_log_genesis().await?;
        }
        self.persist_projection_cache().await?;
        let _ = self.status.tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }
}
