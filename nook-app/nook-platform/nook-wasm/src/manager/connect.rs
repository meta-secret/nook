//! Vault connect / assess / genesis paths.
//!
//! - `assess_vault_connect` — pre-flight check the web layer runs before
//!   asking the user to confirm an unlock attempt.
//! - `connect` / `connect_fresh` / `connect_internal` — keys-mode unlock,
//!   with a clear short-circuit when the vault is in password mode.
//! - `initialize_empty` / `initialize_genesis_vault` — bootstrap a new
//!   vault file with this device as the genesis member.

use super::NookVaultManager;
use super::verified_access::VerifiedVaultAccessFlow;
use crate::NookError;
use crate::NookSecretRecord;
use crate::conversion::{LoadedVault, access_status_for_vault_content, content_requires_genesis};
use crate::storage::event_db::load_local_event_store;
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

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use crate::manager::VaultNameState;
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    async fn rejected_provider_assessment_restores_local_storage_and_clears_outbox()
    -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = nook_core::StorageMode::GoogleDrive;
        manager.storage.access_token = "rejected-token".to_owned();
        manager.sync_outbox.provider_id = "rejected-provider".to_owned();
        manager.sync_outbox.storage_mode = nook_core::StorageMode::GoogleDrive;
        manager.sync_outbox.access_token = "rejected-token".to_owned();
        manager.sync_outbox.repo_arg = "rejected-file".to_owned();
        manager.vault.vault_name = VaultNameState::Named("Local vault".to_owned());

        manager.restore_local_after_provider_assessment().await?;

        assert_eq!(manager.storage.mode, nook_core::StorageMode::Local);
        assert!(manager.storage.access_token.is_empty());
        assert!(manager.sync_outbox.provider_id.is_empty());
        assert_eq!(
            manager.sync_outbox.storage_mode,
            nook_core::StorageMode::Local
        );
        assert!(manager.sync_outbox.access_token.is_empty());
        assert!(manager.sync_outbox.repo_arg.is_empty());
        assert!(matches!(
            &manager.vault.vault_name,
            VaultNameState::Named(name) if name == "Local vault"
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn remote_store_discovery_drops_stale_vault_session_state() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_stale12345".to_owned();
        manager.vault.vault_name = VaultNameState::Named("Stale vault".to_owned());

        let discovered = manager
            .discover_remote_vault_store_id("local".to_owned(), String::new(), String::new())
            .await?;

        assert!(discovered.is_empty());
        assert!(manager.vault.store_id.is_empty());
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Discover the single vault identity exposed by a staged sync provider
    /// without requiring or decrypting a device identity. Hosts use this only
    /// to bind an existing-vault import to an already-paired companion.
    #[wasm_bindgen]
    pub async fn discover_remote_vault_store_id(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<String, JsError> {
        self.reset_vault_session();
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        if self.storage.mode != nook_core::StorageMode::Local {
            self.sync_events_from_current_provider().await?;
        }
        Ok(self.vault.store_id.clone())
    }

    /// Return the typed, core-owned connect status for the selected provider.
    pub async fn assess_vault_connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<nook_core::VaultAccessStatus, JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity()?;
        if self.storage.mode != nook_core::StorageMode::Local {
            self.sync_events_from_current_provider().await?;
            if !self.vault.store_id.is_empty() && self.event_log_has_events().await? {
                let status = nook_core::VaultAccessStatus::from(nook_core::assess_connect_access(
                    &self.stored_records_snapshot(),
                    &identity,
                ));
                let _ = self
                    .status
                    .tx
                    .send(format!("ASSESS_{}_{}", self.storage.mode, status));
                return Ok(status);
            }
            if let Some(cached) = load_vault_local_cache(&self.local_cache_ref()).await?
                && !cached.trim().is_empty()
            {
                return Ok(nook_core::VaultAccessStatus::RemoteMissingLocalCache);
            }
            return Ok(nook_core::VaultAccessStatus::RemoteMissing);
        }
        let mut remote_content_missing = false;
        let content = self
            .fetch_vault_content(&mut remote_content_missing)
            .await?;

        if content.trim().is_empty() {
            self.vault.password_entries.clear();
            self.vault.unlock = nook_core::VaultUnlock::Keys;
            self.vault.last_synced_content.clear();
            return Ok(nook_core::VaultAccessStatus::NewVault);
        }

        // First boot for this session — adopt the remote unlock mode.
        self.capture_vault_unlock(&content)?;
        self.vault.last_synced_content = content.clone();
        // Prefer event-log membership when the local vault has events. A locked
        // import can leave a thin projection cache that would otherwise look like
        // a brand-new vault and skip NeedsEnrollment.
        let status = if self.event_log_has_events().await? {
            self.hydrate_locked_projection_from_events().await?;
            nook_core::VaultAccessStatus::from(nook_core::assess_connect_access(
                &self.stored_records_snapshot(),
                &identity,
            ))
        } else {
            access_status_for_vault_content(&content, &identity)?
        };
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

    /// Return an authenticated local session to local storage after a staged
    /// provider assessment is rejected. The rejected provider must not remain
    /// the destination for later local event-log outbox entries.
    #[wasm_bindgen]
    pub async fn restore_local_after_provider_assessment(&mut self) -> Result<(), JsError> {
        self.prepare_storage_preserving_vault_metadata("local", "", "")
            .await?;
        self.sync_outbox.reset();
        Ok(())
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
    #[wasm_bindgen]
    pub fn prepare_connect_from_local_cache(&mut self) {
        self.storage.use_local_cache_for_connect = true;
    }

    #[wasm_bindgen]
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
            self.capture_vault_unlock(&content)?;
        }

        let event_log_only_remote = self
            .discover_event_log_only_remote(force_genesis, &content)
            .await?;

        let use_genesis = if event_log_only_remote {
            false
        } else {
            content_requires_genesis(&content, force_genesis)?
        };

        let completed_genesis = if use_genesis {
            Some(self.bootstrap_genesis_connect(&identity).await?)
        } else if event_log_only_remote {
            self.connect_event_log_only_remote(&identity).await?;
            None
        } else if !content.trim().is_empty() {
            self.connect_existing_content(&identity, &content).await?;
            None
        } else {
            None
        };

        if use_genesis || remote_content_missing {
            self.flush_event_outbox().await?;
            let _ = self.status.tx.send("GITHUB_INIT_SUCCESS".to_owned());
        }

        self.purge_legacy_plaintext_search_catalog().await?;
        if let Err(error) = self.ensure_identity_after_connect(&identity).await {
            self.reset_vault_session();
            return Err(error.into());
        }
        let records = VerifiedVaultAccessFlow::Connect
            .complete(
                self.get_records(),
                identity.device_id(),
                &self.vault.store_id,
            )
            .await?;
        let pending_cleanup = match match completed_genesis {
            Some(completed) => Ok(Some(completed)),
            None => {
                crate::storage::identity_record::pending_simple_genesis_for_store(
                    &self.vault.store_id,
                )
                .await
            }
        } {
            Ok(pending) => pending,
            Err(error) => {
                self.reset_vault_session();
                return Err(error.into());
            }
        };
        if let Some(completed) = pending_cleanup
            && let Err(error) =
                crate::storage::identity_record::clear_pending_simple_genesis(&completed).await
        {
            self.reset_vault_session();
            return Err(error.into());
        }
        let _ = self.status.tx.send("READY".to_owned());
        tracing::info!(
            scope = "wasm-connect",
            storage = %storage_mode,
            genesis = use_genesis,
            secrets = records.len(),
            "connect complete"
        );
        Ok(records)
    }

    /// Persist a first-class Identity after connect, synthesizing from vault auth when needed.
    pub(in crate::manager) async fn ensure_identity_after_connect(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        if self.device.pending_extension_handoff.is_some() {
            return Ok(());
        }
        let label = match &self.vault.vault_name {
            super::VaultNameState::Named(name) if !name.trim().is_empty() => name.clone(),
            _ => "Personal".to_owned(),
        };
        if self.vault.store_id.is_empty() {
            let _ = crate::storage::identity_record::ensure_local_identity_for_app_key(
                identity, &label,
            )
            .await?;
            return Ok(());
        }
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)
            .map_err(|error| NookError::Database(error.to_string()))?;
        if let Some(envelopes) = self.vault.meta.auth.get(&identity.auth_id()) {
            let authorized_auth_ids = if self.event_log.enabled {
                let store = load_local_event_store(store_id.as_str()).await?;
                let graph = store.load_graph(store_id.as_str())?;
                nook_core::event_graph_active_auth_ids(&graph)?
            } else {
                self.vault.meta.auth.keys().cloned().collect()
            };
            let _ = crate::storage::identity_record::ensure_identity_from_legacy_vault(
                crate::storage::identity_record::LegacyVaultIdentityInput {
                    app_key: identity,
                    store_id: &store_id,
                    secrets_envelope: envelopes.secrets_key.clone(),
                    members_envelope: envelopes.members_key.clone(),
                    authorized_auth_ids,
                    label: &label,
                },
            )
            .await?;
            return Ok(());
        }
        let _ =
            crate::storage::identity_record::ensure_local_identity_for_app_key(identity, &label)
                .await?;
        Ok(())
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
                    self.capture_vault_unlock(&cache)?;
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
    ) -> Result<crate::storage::identity_record::PendingSimpleGenesis, NookError> {
        let pending = self
            .initialize_genesis_vault_with_identity(identity)
            .await?;
        if let Err(error) = self.bootstrap_simple_event_log_genesis(&pending).await {
            self.reset_vault_session();
            return Err(error);
        }
        self.maybe_sync_self_into_roster(identity)?;
        self.event_log.enabled = true;
        self.persist_projection_cache().await?;
        Ok(pending)
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
        match nook_core::assess_connect_access(&records, identity) {
            nook_core::ConnectAccessStatus::Ready => {}
            nook_core::ConnectAccessStatus::JoinPending => {
                return Err(NookError::Database(
                    "Join request pending. An enrolled device must approve before you can connect. After approval, click Connect vault again.".to_owned(),
                ));
            }
            nook_core::ConnectAccessStatus::NeedsEnrollment => {
                return Err(NookError::Database(
                    "This device is not enrolled yet. Request access from an enrolled device, then connect again.".to_owned(),
                ));
            }
        }
        let projection = self.serialize_current_projection_yaml()?;
        match self.load_stored_vault_or_sentinel_ceremony(&projection, identity) {
            Ok(loaded) => {
                let LoadedVault {
                    meta,
                    secrets_key,
                    members_key,
                } = loaded;
                self.apply_vault_keys(secrets_key.as_str(), members_key.as_str())?;
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

    /// Create vault keys through a first-class Identity (fail closed without members).
    ///
    /// Identity owns the DEK envelopes. Vault genesis still writes `auth:` rows so
    /// legacy unlock paths keep working during the extract.
    pub(in crate::manager) async fn initialize_genesis_vault_with_identity(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<crate::storage::identity_record::PendingSimpleGenesis, NookError> {
        let label = match &self.vault.vault_name {
            super::VaultNameState::Named(name) if !name.trim().is_empty() => name.clone(),
            _ => "Personal".to_owned(),
        };
        let pending =
            crate::storage::identity_record::begin_or_resume_simple_genesis(identity, &label)
                .await?;
        self.vault.store_id = pending.store_id.to_string();
        let keys = crate::storage::identity_record::generate_vault_dek_for_identity(
            &pending.identity_id,
            identity,
            pending.store_id.clone(),
        )
        .await?;
        let identity_record = crate::storage::identity_record::load_identity(&pending.identity_id)
            .await?
            .ok_or_else(|| {
                NookError::Database("Pending genesis identity no longer exists.".to_owned())
            })?;
        self.apply_identity_genesis_vault_keys(&identity_record, &keys)?;
        Ok(pending)
    }

    fn apply_identity_genesis_vault_keys(
        &mut self,
        identity: &nook_core::IdentityRecord,
        keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        self.prepare_genesis_vault_keys(keys)?;
        if self.vault.architecture.vault_type == nook_core::VaultType::Simple {
            for record in nook_core::identity_vault_genesis_records(identity, keys, "genesis")? {
                self.vault.meta.apply_record(&record);
            }
        }
        Ok(())
    }

    /// Test/helper path that still creates vault keys without Identity persistence.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(in crate::manager) fn initialize_genesis_vault(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        let keys = nook_core::generate_vault_keys()?;
        self.apply_genesis_vault_keys(identity, &keys)
    }

    fn apply_genesis_vault_keys(
        &mut self,
        identity: &nook_core::DeviceIdentity,
        keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        self.prepare_genesis_vault_keys(keys)?;
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
        Ok(())
    }

    fn prepare_genesis_vault_keys(&mut self, keys: &nook_core::VaultKeys) -> Result<(), NookError> {
        self.vault.password_entries.clear();
        self.vault.unlock = nook_core::VaultUnlock::Keys;
        self.vault.meta = nook_core::VaultMetaState::default();
        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        self.vault.last_synced_content.clear();
        Ok(())
    }

    // Initialize an empty database
    pub async fn initialize_empty(&mut self) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("INITIALIZE_START".to_owned());
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
        self.purge_legacy_plaintext_search_catalog().await?;
        let _ = self.status.tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }
}
