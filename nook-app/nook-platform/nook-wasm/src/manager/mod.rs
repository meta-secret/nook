//! `NookVaultManager` — the session state object that crosses the
//! wasm-bindgen boundary.
//!
//! The struct lives here; its public methods are spread across topic-based
//! submodules so each file holds one coherent concern:
//!
//! - [`connect`] — `connect` / `connect_fresh` / `assess_vault_connect` /
//!   genesis initialisation.
//! - [`sync`] — `sync_vault_from_storage` (periodic poll, mode-aware).
//! - [`password`] — set / remove / verify / `connect_with_password`.
//! - [`multi_device`] — `init_device`, `list_pending_joins`,
//!   `list_vault_members`, request/approve/enroll flows.
//! - [`secrets`] — `add_secret` / `delete_secret`, search, password & id
//!   generation, `next_status`.
//!
//! Cross-cutting plumbing (`prepare_storage`, `fetch_vault_content`,
//! `ensure_event_log_ready`, device-identity helpers, vault-key application) stays
//! in this file because every submodule depends on it.

mod authenticator_enrollment;
mod authenticator_fill;
mod connect;
mod device_protection;
mod diagnostics;
mod event_log;
mod identity;
mod login_fill;
mod login_save;
mod multi_device;
mod passkeys;
mod password;
mod search_catalog;
mod secrets;
mod sentinel;
mod session;
mod sync;
mod verified_access;

pub use device_protection::NookExtensionIdentityHandoffContext;
pub(crate) use device_protection::PendingExtensionIdentityEnrollment;
pub use secrets::{
    NookEventLogRecords, NookEventLogStorageRecord, NookExtensionEventLogImportStatus,
    NookExternalEventLogRecords,
};
pub use session::{NookEventLogSyncIssueResult, NookVaultManager, NookVaultNameState};

pub(in crate::manager) use session::{
    CeremonyState, EventLogSessionState, EventLogSyncIssueState, SearchCatalogRestore,
    SearchCatalogState, StorageSession, SyncOutboxState, VaultCryptoState, VaultNameState,
    VaultSessionState,
};

use crate::NookError;
use crate::conversion::{pending_joins_to_vec, vault_members_to_vec};
use crate::storage::{
    drive::verify_drive_access,
    github::{ensure_github_repo_exists, fetch_github_username},
    indexed_db::{load_from_indexed_db, save_to_indexed_db},
};
use crate::types::records_to_vec;
use crate::{NookJoinRequest, NookSecretRecord, NookVaultArchitecture, NookVaultMember};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub fn take_event_log_sync_issue(&mut self) -> NookEventLogSyncIssueResult {
        NookEventLogSyncIssueResult(std::mem::replace(
            &mut self.event_log_sync_issue,
            EventLogSyncIssueState::Clear,
        ))
    }

    #[wasm_bindgen(getter)]
    pub fn storage_mode(&self) -> String {
        self.storage.mode.to_string()
    }

    #[wasm_bindgen(getter, js_name = vaultApplication)]
    pub fn vault_application(&self) -> nook_core::VaultApplication {
        self.application
    }

    #[wasm_bindgen(getter, js_name = vaultStoreId)]
    pub fn vault_store_id(&self) -> String {
        self.vault.store_id.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultVersion)]
    pub fn vault_version(&self) -> u64 {
        self.vault.vault_version
    }

    #[wasm_bindgen(getter, js_name = vaultArchitecture)]
    pub fn vault_architecture(&self) -> NookVaultArchitecture {
        NookVaultArchitecture::from_core(self.vault.architecture.clone())
    }

    #[wasm_bindgen]
    pub fn set_vault_architecture(
        &mut self,
        architecture: &NookVaultArchitecture,
    ) -> Result<(), JsError> {
        let architecture = architecture.to_core();
        architecture
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        self.application
            .validate_session_access(architecture.vault_type)
            .map_err(|error| JsError::new(&error.to_string()))?;
        if !self.vault.store_id.is_empty() && architecture != self.vault.architecture {
            return Err(JsError::new(
                "Vault architecture is immutable after vault creation.",
            ));
        }
        architecture
            .validate_records(&self.stored_records_snapshot())
            .map_err(|error| JsError::new(&error.to_string()))?;
        self.vault.architecture = architecture;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn can_create_secret_for_vault_architecture(&self) -> bool {
        self.vault
            .architecture
            .can_create_secret_with_records(&self.stored_records_snapshot())
    }

    #[wasm_bindgen(getter, js_name = vaultNameState)]
    pub fn vault_name_state(&self) -> NookVaultNameState {
        match &self.vault.vault_name {
            VaultNameState::Unnamed => NookVaultNameState::Unnamed,
            VaultNameState::Named(_) => NookVaultNameState::Named,
        }
    }

    #[wasm_bindgen(getter, js_name = vaultName)]
    pub fn vault_name(&self) -> Result<String, JsError> {
        match &self.vault.vault_name {
            VaultNameState::Unnamed => Err(JsError::new("vault is unnamed")),
            VaultNameState::Named(name) => Ok(name.clone()),
        }
    }

    #[wasm_bindgen]
    pub async fn set_vault_name(&mut self, name: &str) -> Result<(), JsError> {
        let previous_name = self.vault.vault_name.clone();
        let previous_projection = if self.vault.last_synced_content.trim().is_empty() {
            load_from_indexed_db()
                .await
                .map_err(|error| JsError::new(&error.to_string()))?
                .ok_or_else(|| JsError::new("Vault projection is not initialized."))?
        } else {
            self.vault.last_synced_content.clone()
        };
        self.assign_vault_name(name);
        if let Err(error) = self.persist_vault_change(Vec::new()).await {
            self.vault.vault_name = previous_name;
            self.vault.last_synced_content = previous_projection.clone();
            if let Err(rollback_error) = save_to_indexed_db(&previous_projection).await {
                return Err(JsError::new(&format!(
                    "{error}; vault-name rollback failed: {rollback_error}"
                )));
            }
            return Err(JsError::new(&error.to_string()));
        }
        Ok(())
    }

    fn assign_vault_name(&mut self, name: &str) {
        let trimmed = name.trim();
        self.vault.vault_name = if trimmed.is_empty() {
            VaultNameState::Unnamed
        } else {
            VaultNameState::Named(trimmed.to_owned())
        };
    }

    #[wasm_bindgen(getter)]
    pub fn device_id(&self) -> String {
        self.device.id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn device_public_key(&self) -> String {
        if self.device.identity_private_key.is_empty() {
            return String::new();
        }
        nook_core::DeviceIdentitySecret::parse(&self.device.identity_private_key)
            .ok()
            .and_then(|secret| nook_core::DeviceIdentity::from_secret_str(&secret).ok())
            .map(|identity| identity.public_key().as_str().to_owned())
            .unwrap_or_default()
    }

    /// GitHub repo (`owner/name`) or Google Drive file id, depending on mode.
    #[wasm_bindgen(getter)]
    pub fn storage_remote_ref(&self) -> String {
        self.storage.remote_ref.clone()
    }

    /// Drop in-memory vault session state when switching storage providers.
    /// Device identity and configured storage credentials are preserved.
    #[wasm_bindgen]
    pub fn reset_vault_session(&mut self) {
        self.vault.reset();
        self.storage.github_root_empty = false;
        self.storage.use_local_cache_for_connect = false;
        self.event_log.reset();
        self.sentinel_genesis = CeremonyState::Inactive;
        self.sentinel_genesis_phase = nook_core::SentinelGenesisPhase::Inactive;
        self.pending_sentinel_genesis_request = CeremonyState::Inactive;
        self.sentinel_unlock = CeremonyState::Inactive;
        self.sync_outbox.reset();
    }

    /// Zeroize the active session and clear every Nook-owned browser database.
    /// Remote sync replicas and platform authenticator credentials are not touched.
    #[wasm_bindgen]
    pub async fn delete_local_browser_data(&mut self) -> Result<(), JsError> {
        self.reset_vault_session();
        self.storage.access_token.zeroize();
        self.storage = StorageSession::default();
        self.device.id.clear();
        self.device.identity_private_key.zeroize();
        self.device.extension_handoff_private_key.zeroize();

        let mut errors = Vec::new();
        if let Err(error) = crate::logger::clear_logs_db().await {
            errors.push(error.to_string());
        }
        if let Err(error) = crate::storage::local_folder::clear_local_folder_db().await {
            errors.push(error.to_string());
        }
        if let Err(error) = crate::storage::auth_providers::clear_auth_providers_db().await {
            errors.push(error.to_string());
        }
        if let Err(error) = crate::storage::indexed_db::clear_vault_db().await {
            errors.push(error.to_string());
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(JsError::new(&format!(
                "Could not clear all local browser databases: {}",
                errors.join("; ")
            )))
        }
    }
}

// ---- Cross-cutting private helpers ----------------------------------------
//
// These are called from multiple submodules of `manager` and therefore live
// here at the parent. Visibility is `pub(in crate::manager)` so the
// submodules can call them without leaking into the rest of the crate.

impl NookVaultManager {
    pub(crate) fn query_secret_page(
        &self,
        query: &str,
        secret_type_filter: nook_core::SecretTypeFilter,
        offset: u32,
        limit: u32,
    ) -> Result<nook_core::SecretPage, NookError> {
        let crypto = self.vault.crypto.get()?;
        let offset = usize::try_from(offset).unwrap_or(usize::MAX);
        let limit = usize::try_from(limit).unwrap_or(nook_core::DEFAULT_SECRET_PAGE_SIZE);
        if !self.vault.search_catalog_dirty
            && self.vault.search_catalog_store_id == self.vault.store_id
            && let SearchCatalogState::Ready(catalog) = &self.vault.search_catalog
        {
            return Ok(catalog.query(query, secret_type_filter, offset, limit));
        }
        Ok(nook_core::query_encrypted_secrets(
            &self.vault.meta.secrets,
            crypto,
            query,
            secret_type_filter,
            offset,
            limit,
        )?)
    }

    /// Typed secret list for the active decrypted session.
    pub(crate) fn get_records(&self) -> Result<Vec<NookSecretRecord>, NookError> {
        let crypto = self.vault.crypto.get()?;
        records_to_vec(
            self.vault
                .meta
                .secrets
                .keys()
                .map(|id| {
                    nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, id)
                        .map_err(NookError::from)
                })
                .collect::<Result<Vec<_>, _>>()?,
        )
    }

    pub(crate) fn pending_joins(&self) -> Result<Vec<NookJoinRequest>, NookError> {
        Ok(pending_joins_to_vec(&self.stored_records_snapshot()))
    }

    pub(crate) fn vault_members(&self) -> Result<Vec<NookVaultMember>, NookError> {
        vault_members_to_vec(&self.stored_records_snapshot(), &self.vault.members_key)
    }

    pub(in crate::manager) fn serialize_current_projection_yaml(
        &self,
    ) -> Result<String, NookError> {
        if self.vault.store_id.is_empty() {
            return Err(NookError::Database(
                "Vault store id is not initialized.".to_owned(),
            ));
        }
        let records = self.vault.meta.to_stored_records();
        Ok(
            nook_core::serialize_stored_yaml_with_unlock_name_architecture(
                &records,
                &self.vault.unlock,
                &self.vault.password_entries,
                nook_core::VaultStoreIdentityRef::Assigned(self.vault.store_id.as_str()),
                match &self.vault.vault_name {
                    VaultNameState::Unnamed => nook_core::VaultNameRef::Unnamed,
                    VaultNameState::Named(name) => nook_core::VaultNameRef::Named(name),
                },
                nook_core::VaultVersionWrite::Initial,
                &self.vault.architecture,
            )?
            .into_inner(),
        )
    }

    pub(in crate::manager) fn local_cache_ref(&self) -> String {
        nook_core::format_sync_provider_cache_ref(
            self.storage.mode,
            &self.storage.remote_ref,
            &self.storage.remote_path,
        )
    }

    pub(crate) fn device_identity(&self) -> Result<nook_core::DeviceIdentity, NookError> {
        Ok(nook_core::DeviceIdentity::from_secret_str(
            &nook_core::DeviceIdentitySecret::parse(&self.device.identity_private_key)?,
        )?)
    }

    /// Pull the active unlock mode from a freshly-accepted vault YAML and
    /// stash it in session state.
    ///
    /// Callers should only invoke this with content they intend to adopt
    /// as the new authoritative state (e.g. after the first connect or
    /// after `sync_vault_from_storage` confirms the remote content
    /// differs from our last saved snapshot). Calling on every poll
    /// blindly is unsafe: GitHub is eventually-consistent, so a poll can
    /// race with our own write and return the pre-write YAML, which
    /// would clobber a freshly-set password envelope back to keys mode.
    pub(in crate::manager) fn capture_vault_unlock(
        &mut self,
        content: &str,
    ) -> Result<(), NookError> {
        let metadata = nook_core::capture_vault_unlock_from_content(content)?;
        self.application
            .validate_session_access(metadata.architecture.vault_type)?;
        self.vault.unlock = metadata.unlock;
        self.vault.password_entries = metadata.password_entries;
        self.vault.store_id = metadata.store_id;
        self.vault.vault_name = VaultNameState::Named(metadata.vault_name);
        self.vault.vault_version = metadata.version;
        self.vault.architecture = metadata.architecture;
        Ok(())
    }

    pub(in crate::manager) fn apply_vault_keys(
        &mut self,
        secrets_key: &str,
        members_key: &str,
    ) -> Result<(), NookError> {
        self.vault.secrets_key = secrets_key.to_owned();
        self.vault.members_key = members_key.to_owned();
        let parsed_secrets = nook_core::SymmetricKey::parse(secrets_key)?;
        self.vault.crypto =
            VaultCryptoState::Unlocked(nook_core::VaultCrypto::new(&parsed_secrets)?);
        Ok(())
    }

    /// Restore `VaultCrypto` from the local projection-cache YAML when the in-memory
    /// session lost it (for example after switching sync providers).
    pub(in crate::manager) async fn ensure_vault_crypto_from_cache(
        &mut self,
    ) -> Result<(), NookError> {
        if self.vault.crypto.is_unlocked() {
            return Ok(());
        }
        if self.vault.architecture.vault_type == nook_core::VaultType::Sentinel {
            return Err(nook_core::MultiDeviceError::SentinelCeremonyRequired.into());
        }
        let identity = self.ensure_device_identity()?;
        if !self.vault.last_synced_content.trim().is_empty() {
            let (secrets_key, members_key) = nook_core::hydrate_keys_from_projection_yaml(
                &self.vault.last_synced_content,
                &identity,
            )?;
            self.apply_vault_keys(&secrets_key, &members_key)?;
            return Ok(());
        }
        if let Some(cache) = load_from_indexed_db().await?
            && !cache.trim().is_empty()
        {
            let (secrets_key, members_key) =
                nook_core::hydrate_keys_from_projection_yaml(&cache, &identity)?;
            self.apply_vault_keys(&secrets_key, &members_key)?;
            self.vault.last_synced_content = cache;
            return Ok(());
        }
        Err(NookError::Encryption(
            "Vault crypto not initialized.".to_owned(),
        ))
    }

    pub(in crate::manager) fn maybe_sync_self_into_roster(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        let records = self.stored_records_snapshot();
        let members_key = self.vault.members_key.clone();
        if let nook_core::SelfRosterSync::Updated(member_records) =
            nook_core::ensure_self_in_roster(
                &records,
                identity,
                &nook_core::SymmetricKey::parse(&members_key)?,
            )?
        {
            nook_core::apply_member_records(&mut self.vault.meta, &member_records);
        }
        Ok(())
    }

    /// Repair an empty device roster when this browser holds vault keys but no
    /// `members:` rows (event-log projection does not replay roster entries).
    pub(in crate::manager) async fn ensure_vault_roster_hydrated(
        &mut self,
    ) -> Result<bool, NookError> {
        if self.vault.members_key.is_empty() {
            let _ = self.ensure_vault_crypto_from_cache().await;
        }
        if self.vault.members_key.is_empty() {
            return Ok(false);
        }
        let identity = self.device_identity()?;
        let before = self.vault_members().map_or(0, |members| members.len());
        self.maybe_sync_self_into_roster(&identity)?;
        let after = self.vault_members().map_or(0, |members| members.len());
        if after > before {
            self.persist_projection_cache().await?;
            return Ok(true);
        }
        Ok(false)
    }

    pub(in crate::manager) fn stored_records_snapshot(&self) -> Vec<nook_core::StoredSecretRecord> {
        self.vault.meta.to_stored_records()
    }

    pub(in crate::manager) fn needs_genesis_persist(&self) -> bool {
        !nook_core::vault_has_multi_device_records(&self.stored_records_snapshot())
    }

    pub(in crate::manager) async fn prepare_storage(
        &mut self,
        storage_mode: &str,
        github_pat: &str,
        github_repo_name: &str,
    ) -> Result<(), NookError> {
        // Parse the incoming tag once at the boundary so the rest of the
        // method pattern-matches on `StorageMode` instead of comparing
        // strings.
        let mode = nook_core::StorageMode::parse(storage_mode)?;
        let previous_mode = self.storage.mode;
        let previous_remote_ref = self.storage.remote_ref.clone();
        self.storage.mode = mode;

        match mode {
            nook_core::StorageMode::Local => {
                self.storage.access_token = String::new();
                self.storage.drive_event_parent = nook_core::DriveEventParent::AppDataFolder;
                self.storage.icloud_event_target = nook_core::ICloudEventTarget::Private;
            }
            nook_core::StorageMode::Github => {
                self.storage.access_token = nook_core::validate_github_pat(github_pat)?.to_string();
                let repo_name = nook_core::validate_github_repo_name(github_repo_name)?;
                let _ = self.status.tx.send("GITHUB_USER_FETCH".to_owned());
                let username = fetch_github_username(&self.storage.access_token).await?;
                let new_repo = format!("{}/{}", username, repo_name);
                if self.storage.remote_ref != new_repo {
                    self.storage.github_root_empty = false;
                }
                self.storage.remote_ref = new_repo;
                self.storage.remote_path.clear();
                self.storage.drive_event_parent = nook_core::DriveEventParent::AppDataFolder;
                self.storage.icloud_event_target = nook_core::ICloudEventTarget::Private;
                let _ = self.status.tx.send("GITHUB_REPO_ENSURE".to_owned());
                ensure_github_repo_exists(&self.storage.access_token, &self.storage.remote_ref)
                    .await?;
            }
            nook_core::StorageMode::GoogleDrive => {
                self.storage.access_token =
                    nook_core::validate_oauth_access_token(github_pat)?.to_string();
                let (known_file_id, file_name) =
                    nook_core::parse_drive_storage_ref(github_repo_name)?;
                self.storage.drive_event_parent =
                    nook_core::DriveEventParent::from_storage_id(&known_file_id);
                self.storage.remote_path = file_name.to_string();
                let _ = self.status.tx.send("DRIVE_VERIFY".to_owned());
                verify_drive_access(&self.storage.access_token).await?;
                // Personal: optional vault yaml file id. Shared: folder id for events.
                self.storage.remote_ref = match &self.storage.drive_event_parent {
                    nook_core::DriveEventParent::SharedFolder { folder_id } => folder_id.clone(),
                    nook_core::DriveEventParent::AppDataFolder => known_file_id,
                };
                self.storage.icloud_event_target = nook_core::ICloudEventTarget::Private;
            }
            nook_core::StorageMode::ICloud => {
                self.storage.access_token =
                    nook_core::validate_oauth_access_token(github_pat)?.to_string();
                let (known_target, file_name) =
                    nook_core::parse_drive_storage_ref(github_repo_name)?;
                self.storage.remote_path = file_name.to_string();
                self.storage.icloud_event_target =
                    nook_core::ICloudEventTarget::from_storage_id(&known_target)?;
                self.storage.remote_ref = if known_target.is_empty() {
                    file_name.to_string()
                } else {
                    known_target
                };
                self.storage.drive_event_parent = nook_core::DriveEventParent::AppDataFolder;
            }
        }

        if previous_mode != self.storage.mode || previous_remote_ref != self.storage.remote_ref {
            self.vault.password_entries.clear();
            self.vault.unlock = nook_core::VaultUnlock::Keys;
            self.vault.vault_name = VaultNameState::Unnamed;
        }

        if mode != nook_core::StorageMode::Local {
            self.sync_outbox.provider_id = self.local_cache_ref();
            self.sync_outbox.storage_mode = mode;
            self.sync_outbox.access_token = self.storage.access_token.clone();
            self.sync_outbox.repo_arg = github_repo_name.to_owned();
        }

        Ok(())
    }

    pub(in crate::manager) async fn prepare_storage_preserving_vault_metadata(
        &mut self,
        storage_mode: &str,
        github_pat: &str,
        github_repo_name: &str,
    ) -> Result<(), NookError> {
        let password_entries = self.vault.password_entries.clone();
        let unlock = self.vault.unlock.clone();
        let vault_name = self.vault.vault_name.clone();
        self.prepare_storage(storage_mode, github_pat, github_repo_name)
            .await?;
        self.vault.password_entries = password_entries;
        self.vault.unlock = unlock;
        self.vault.vault_name = vault_name;
        Ok(())
    }

    pub(in crate::manager) fn ensure_device_identity(
        &mut self,
    ) -> Result<nook_core::DeviceIdentity, NookError> {
        if self.device.identity_private_key.is_empty() {
            return Err(NookError::Decryption(
                nook_core::i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned(),
            ));
        }
        self.device_identity()
    }

    pub(in crate::manager) async fn fetch_vault_content(
        &mut self,
        remote_content_missing: &mut bool,
    ) -> Result<String, NookError> {
        let content = match self.storage.mode {
            nook_core::StorageMode::Local => {
                let _ = self.status.tx.send("IDB_LOAD_START".to_owned());
                let stored = load_from_indexed_db().await?;
                let _ = self.status.tx.send("IDB_LOAD_SUCCESS".to_owned());
                stored.unwrap_or_default()
            }
            nook_core::StorageMode::Github
            | nook_core::StorageMode::GoogleDrive
            | nook_core::StorageMode::ICloud => {
                *remote_content_missing = true;
                String::new()
            }
        };
        Ok(content)
    }
}
