//! `NookVaultManager` — the session state object that crosses the
//! wasm-bindgen boundary.
//!
//! The struct lives here; its public methods are spread across topic-based
//! submodules so each file holds one coherent concern:
//!
//! - [`connect`] — `connect` / `connect_fresh` / `assess_vault_connect` /
//!   genesis initialisation.
//! - [`sync`] — `sync_vault_from_storage` (periodic poll, mode-aware).
//! - [`password`] — set / remove / verify / `connectWithPassword`,
//!   `vaultUnlockMode`.
//! - [`multi_device`] — `init_device`, `list_pending_joins`,
//!   `list_vault_members`, request/approve/enroll flows.
//! - [`secrets`] — `add_secret` / `delete_secret`, search, password & id
//!   generation, `next_status`.
//!
//! Cross-cutting plumbing (`prepare_storage`, `fetch_vault_content`,
//! `ensure_event_log_ready`, device-identity helpers, vault-key application) stays
//! in this file because every submodule depends on it.

mod connect;
mod device_protection;
mod event_log;
mod multi_device;
mod password;
mod secrets;
mod sync;

use crate::NookError;
use crate::conversion::{pending_joins_to_vec, vault_members_to_vec};
use crate::storage::{
    drive::{ensure_drive_vault_file, fetch_drive_vault, verify_drive_access},
    github::{ensure_github_repo_exists, fetch_github_username},
    icloud::{ensure_icloud_vault_record, fetch_icloud_vault, verify_icloud_access},
    indexed_db::{load_from_indexed_db, save_vault_local_cache},
};
use crate::types::records_to_vec;
use crate::{NookJoinRequest, NookSecretRecord, NookVaultMember};
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

// Session state of our secret vault
#[wasm_bindgen]
pub struct NookVaultManager {
    pub(in crate::manager) storage_mode: nook_core::StorageMode,
    pub(in crate::manager) github_pat: String,
    pub(in crate::manager) github_repo: String,
    pub(in crate::manager) github_path: String,
    pub(in crate::manager) secrets_key: String,
    pub(in crate::manager) members_key: String,
    pub(in crate::manager) device_id: String,
    pub(in crate::manager) device_identity_private_key: String,
    pub(in crate::manager) crypto: Option<nook_core::VaultCrypto>,
    pub(in crate::manager) meta: nook_core::VaultMetaState,
    pub(in crate::manager) decrypted_jsonl: String,
    pub(in crate::manager) file_sha: Option<String>,
    pub(in crate::manager) last_synced_content: String,
    /// Cached empty-repo listing from GitHub (`GET .../contents/` → 404).
    pub(in crate::manager) github_root_empty: bool,
    /// Active unlock mode for this vault.
    pub(in crate::manager) unlock: nook_core::VaultUnlock,
    /// Backup password entries — parallel to device-key auth rows.
    pub(in crate::manager) password_entries: Vec<nook_core::PasswordUnlockEntry>,
    /// Logical secret-store id — persisted in vault YAML and mirrored on saved providers.
    pub(in crate::manager) store_id: String,
    /// Human-readable vault label persisted in vault YAML.
    pub(in crate::manager) vault_name: Option<String>,
    /// Monotonic vault revision — incremented on every save.
    pub(in crate::manager) vault_version: u64,
    pub(in crate::manager) status_tx: flume::Sender<String>,
    pub(in crate::manager) status_rx: flume::Receiver<String>,
    /// When true, the next `connect` loads vault YAML from the browser cache
    /// instead of remote storage (used to recreate a deleted remote file).
    pub(in crate::manager) use_local_cache_for_connect: bool,
    pub(in crate::manager) event_log_mode: bool,
    pub(in crate::manager) signing_seed: String,
    pub(in crate::manager) key_epoch: String,
    pub(in crate::manager) event_heads: Vec<String>,
    /// Last non-local sync provider used for event outbox fan-out.
    pub(in crate::manager) sync_outbox_provider_id: String,
    pub(in crate::manager) sync_outbox_storage_mode: nook_core::StorageMode,
    pub(in crate::manager) sync_outbox_pat: String,
    pub(in crate::manager) sync_outbox_repo_arg: String,
}

impl Drop for NookVaultManager {
    fn drop(&mut self) {
        self.github_pat.zeroize();
        self.secrets_key.zeroize();
        self.members_key.zeroize();
        self.device_identity_private_key.zeroize();
        self.decrypted_jsonl.zeroize();
        self.signing_seed.zeroize();
        self.key_epoch.zeroize();
        self.sync_outbox_pat.zeroize();
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let (status_tx, status_rx) = flume::unbounded();
        Self {
            // Default to local until `prepare_storage` parses the incoming tag.
            storage_mode: nook_core::StorageMode::Local,
            github_pat: String::new(),
            github_repo: String::new(),
            github_path: String::new(),
            secrets_key: String::new(),
            members_key: String::new(),
            device_id: String::new(),
            device_identity_private_key: String::new(),
            crypto: None,
            meta: nook_core::VaultMetaState::default(),
            unlock: nook_core::VaultUnlock::Keys,
            password_entries: Vec::new(),
            store_id: String::new(),
            vault_name: None,
            vault_version: 0,
            decrypted_jsonl: String::new(),
            file_sha: None,
            last_synced_content: String::new(),
            github_root_empty: false,
            use_local_cache_for_connect: false,
            event_log_mode: false,
            signing_seed: String::new(),
            key_epoch: String::new(),
            event_heads: Vec::new(),
            sync_outbox_provider_id: String::new(),
            sync_outbox_storage_mode: nook_core::StorageMode::Local,
            sync_outbox_pat: String::new(),
            sync_outbox_repo_arg: String::new(),
            status_tx,
            status_rx,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn storage_mode(&self) -> String {
        self.storage_mode.to_string()
    }

    #[wasm_bindgen(getter, js_name = vaultStoreId)]
    pub fn vault_store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultVersion)]
    pub fn vault_version(&self) -> u64 {
        self.vault_version
    }

    #[wasm_bindgen(getter, js_name = vaultName)]
    pub fn vault_name(&self) -> Option<String> {
        self.vault_name.clone()
    }

    #[wasm_bindgen(js_name = setVaultName)]
    pub fn set_vault_name(&mut self, name: &str) {
        let trimmed = name.trim();
        self.vault_name = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        };
    }

    #[wasm_bindgen(getter)]
    pub fn decrypted_jsonl(&self) -> String {
        self.decrypted_jsonl.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn file_sha(&self) -> Option<String> {
        self.file_sha.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn device_public_key(&self) -> String {
        if self.device_identity_private_key.is_empty() {
            return String::new();
        }
        nook_core::DeviceIdentitySecret::parse(&self.device_identity_private_key)
            .ok()
            .and_then(|secret| nook_core::DeviceIdentity::from_secret_str(&secret).ok())
            .map(|identity| identity.public_key().as_str().to_owned())
            .unwrap_or_default()
    }

    /// GitHub repo (`owner/name`) or Google Drive file id, depending on mode.
    #[wasm_bindgen(getter)]
    pub fn storage_remote_ref(&self) -> String {
        self.github_repo.clone()
    }

    /// Drop in-memory vault session state when switching storage providers.
    /// Device identity and configured storage credentials are preserved.
    #[wasm_bindgen(js_name = "resetVaultSession")]
    pub fn reset_vault_session(&mut self) {
        self.secrets_key.zeroize();
        self.members_key.zeroize();
        self.crypto = None;
        self.meta = nook_core::VaultMetaState::default();
        self.decrypted_jsonl.zeroize();
        self.password_entries.clear();
        self.file_sha = None;
        self.last_synced_content.clear();
        self.github_root_empty = false;
        self.unlock = nook_core::VaultUnlock::Keys;
        self.use_local_cache_for_connect = false;
        self.store_id.clear();
        self.vault_name = None;
        self.vault_version = 0;
        self.event_log_mode = false;
        self.signing_seed.zeroize();
        self.key_epoch.zeroize();
        self.event_heads.clear();
        self.sync_outbox_provider_id.clear();
        self.sync_outbox_storage_mode = nook_core::StorageMode::Local;
        self.sync_outbox_pat.zeroize();
        self.sync_outbox_repo_arg.clear();
    }
}

// ---- Cross-cutting private helpers ----------------------------------------
//
// These are called from multiple submodules of `manager` and therefore live
// here at the parent. Visibility is `pub(in crate::manager)` so the
// submodules can call them without leaking into the rest of the crate.

impl NookVaultManager {
    /// Typed secret list for the active decrypted session.
    pub(crate) fn get_records(&self) -> Result<Vec<NookSecretRecord>, NookError> {
        let jsonl = nook_core::SessionJsonl::parse(&self.decrypted_jsonl)?;
        let db = nook_core::Database::from_jsonl(&jsonl)?;
        records_to_vec(db.list())
    }

    pub(crate) fn pending_joins(&self) -> Result<Vec<NookJoinRequest>, NookError> {
        Ok(pending_joins_to_vec(&self.stored_records_snapshot()))
    }

    pub(crate) fn vault_members(&self) -> Result<Vec<NookVaultMember>, NookError> {
        vault_members_to_vec(&self.stored_records_snapshot(), &self.members_key)
    }

    pub(in crate::manager) fn serialize_current_projection_yaml(
        &self,
    ) -> Result<String, NookError> {
        if self.store_id.is_empty() {
            return Err(NookError::Database(
                "Vault store id is not initialized.".to_owned(),
            ));
        }
        let records = self.meta.to_stored_records();
        Ok(nook_core::serialize_stored_yaml_with_unlock_and_name(
            &records,
            &self.unlock,
            &self.password_entries,
            Some(self.store_id.as_str()),
            self.vault_name.as_deref(),
            None,
        )?
        .into_inner())
    }

    pub(in crate::manager) fn local_cache_ref(&self) -> String {
        nook_core::format_sync_provider_cache_ref(
            self.storage_mode,
            &self.github_repo,
            &self.github_path,
        )
    }

    pub(crate) fn device_identity(&self) -> Result<nook_core::DeviceIdentity, NookError> {
        Ok(nook_core::DeviceIdentity::from_secret_str(
            &nook_core::DeviceIdentitySecret::parse(&self.device_identity_private_key)?,
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
    pub(in crate::manager) fn capture_vault_unlock(&mut self, content: &str) {
        if let Ok(metadata) = nook_core::capture_vault_unlock_from_content(content) {
            self.unlock = metadata.unlock;
            self.password_entries = metadata.password_entries;
            if let Some(id) = metadata.store_id {
                self.store_id = id;
            }
            if metadata.vault_name.is_some() {
                self.vault_name = metadata.vault_name;
            }
            self.vault_version = metadata.version;
        }
    }

    pub(in crate::manager) fn apply_vault_keys(
        &mut self,
        secrets_key: &str,
        members_key: &str,
    ) -> Result<(), NookError> {
        self.secrets_key = secrets_key.to_owned();
        self.members_key = members_key.to_owned();
        let parsed_secrets = nook_core::SymmetricKey::parse(secrets_key)?;
        self.crypto = Some(nook_core::VaultCrypto::new(&parsed_secrets)?);
        Ok(())
    }

    /// Restore `VaultCrypto` from the local projection-cache YAML when the in-memory
    /// session lost it (for example after switching sync providers).
    pub(in crate::manager) async fn ensure_vault_crypto_from_cache(
        &mut self,
    ) -> Result<(), NookError> {
        if self.crypto.is_some() {
            return Ok(());
        }
        let identity = self.ensure_device_identity()?;
        if !self.last_synced_content.trim().is_empty() {
            let (secrets_key, members_key) =
                nook_core::hydrate_keys_from_projection_yaml(&self.last_synced_content, &identity)?;
            self.apply_vault_keys(&secrets_key, &members_key)?;
            return Ok(());
        }
        if let Some(cache) = load_from_indexed_db().await?
            && !cache.trim().is_empty()
        {
            let (secrets_key, members_key) =
                nook_core::hydrate_keys_from_projection_yaml(&cache, &identity)?;
            self.apply_vault_keys(&secrets_key, &members_key)?;
            self.last_synced_content = cache;
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
        let members_key = self.members_key.clone();
        if let Some(member_records) = nook_core::ensure_self_in_roster(
            &records,
            identity,
            &nook_core::SymmetricKey::parse(&members_key)?,
        )? {
            nook_core::apply_member_records(&mut self.meta, &member_records);
        }
        Ok(())
    }

    /// Repair an empty device roster when this browser holds vault keys but no
    /// `members:` rows (event-log projection does not replay roster entries).
    pub(in crate::manager) async fn ensure_vault_roster_hydrated(
        &mut self,
    ) -> Result<bool, NookError> {
        if self.members_key.is_empty() {
            let _ = self.ensure_vault_crypto_from_cache().await;
        }
        if self.members_key.is_empty() {
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
        self.meta.to_stored_records()
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
        let previous_mode = self.storage_mode;
        let previous_remote_ref = self.github_repo.clone();
        self.storage_mode = mode;
        self.file_sha = None;

        match mode {
            nook_core::StorageMode::Local => {
                self.github_pat = String::new();
            }
            nook_core::StorageMode::Github => {
                self.github_pat = nook_core::validate_github_pat(github_pat)?.to_string();
                let repo_name = nook_core::validate_github_repo_name(github_repo_name)?;
                let _ = self.status_tx.send("GITHUB_USER_FETCH".to_owned());
                let username = fetch_github_username(&self.github_pat).await?;
                let new_repo = format!("{}/{}", username, repo_name);
                if self.github_repo != new_repo {
                    self.github_root_empty = false;
                }
                self.github_repo = new_repo;
                self.github_path = "nook-vault.yaml".to_owned();
                let _ = self.status_tx.send("GITHUB_REPO_ENSURE".to_owned());
                ensure_github_repo_exists(&self.github_pat, &self.github_repo).await?;
            }
            nook_core::StorageMode::GoogleDrive => {
                self.github_pat = nook_core::validate_oauth_access_token(github_pat)?.to_string();
                let (known_file_id, file_name) =
                    nook_core::parse_drive_storage_ref(github_repo_name)?;
                self.github_path = file_name.to_string();
                let _ = self.status_tx.send("DRIVE_VERIFY".to_owned());
                verify_drive_access(&self.github_pat).await?;
                let file_id =
                    ensure_drive_vault_file(&self.github_pat, &known_file_id, file_name.as_ref())
                        .await?;
                self.github_repo = file_id;
            }
            nook_core::StorageMode::ICloud => {
                self.github_pat = nook_core::validate_oauth_access_token(github_pat)?.to_string();
                let (_known_revision, file_name) =
                    nook_core::parse_drive_storage_ref(github_repo_name)?;
                self.github_path = file_name.to_string();
                let _ = self.status_tx.send("ICLOUD_VERIFY".to_owned());
                verify_icloud_access(&self.github_pat).await?;
                let record_name =
                    ensure_icloud_vault_record(&self.github_pat, file_name.as_ref()).await?;
                self.github_repo = record_name;
            }
        }

        if previous_mode != self.storage_mode || previous_remote_ref != self.github_repo {
            self.password_entries.clear();
            self.unlock = nook_core::VaultUnlock::Keys;
            self.vault_name = None;
        }

        if mode != nook_core::StorageMode::Local {
            self.sync_outbox_provider_id = self.local_cache_ref();
            self.sync_outbox_storage_mode = mode;
            self.sync_outbox_pat = self.github_pat.clone();
            self.sync_outbox_repo_arg = github_repo_name.to_owned();
        }

        Ok(())
    }

    pub(in crate::manager) fn ensure_device_identity(
        &mut self,
    ) -> Result<nook_core::DeviceIdentity, NookError> {
        if self.device_identity_private_key.is_empty() {
            return Err(NookError::Decryption(
                "errors.device_protection.authorization_required".to_owned(),
            ));
        }
        self.device_identity()
    }

    pub(in crate::manager) async fn fetch_vault_content(
        &mut self,
        vault_file_missing: &mut bool,
    ) -> Result<String, NookError> {
        let content = match self.storage_mode {
            nook_core::StorageMode::Local => {
                let _ = self.status_tx.send("IDB_LOAD_START".to_owned());
                let stored = load_from_indexed_db().await?;
                let _ = self.status_tx.send("IDB_LOAD_SUCCESS".to_owned());
                stored.unwrap_or_default()
            }
            nook_core::StorageMode::Github => {
                let _ = self.status_tx.send("GITHUB_FETCH_START".to_owned());
                let res = crate::storage::github::fetch_github_vault(
                    &self.github_pat,
                    &self.github_repo,
                    &self.github_path,
                    Some(&mut self.github_root_empty),
                )
                .await?;
                let _ = self.status_tx.send("GITHUB_FETCH_SUCCESS".to_owned());
                if let Some(file) = res {
                    self.file_sha = Some(file.sha);
                    file.content
                } else {
                    *vault_file_missing = true;
                    String::new()
                }
            }
            nook_core::StorageMode::GoogleDrive => {
                let _ = self.status_tx.send("DRIVE_FETCH_START".to_owned());
                let res = fetch_drive_vault(&self.github_pat, &self.github_repo, &self.github_path)
                    .await?;
                let _ = self.status_tx.send("DRIVE_FETCH_SUCCESS".to_owned());
                if let Some(file) = res {
                    self.github_repo = file.file_id;
                    self.file_sha = Some(file.revision);
                    file.content
                } else {
                    *vault_file_missing = true;
                    String::new()
                }
            }
            nook_core::StorageMode::ICloud => {
                let _ = self.status_tx.send("ICLOUD_FETCH_START".to_owned());
                let res = fetch_icloud_vault(&self.github_pat, &self.github_repo).await?;
                let _ = self.status_tx.send("ICLOUD_FETCH_SUCCESS".to_owned());
                if let Some(file) = res {
                    self.github_repo = file.record_name;
                    self.file_sha = Some(file.revision);
                    file.content
                } else {
                    *vault_file_missing = true;
                    String::new()
                }
            }
        };
        if !content.trim().is_empty() && self.storage_mode != nook_core::StorageMode::Local {
            save_vault_local_cache(&self.local_cache_ref(), &content).await?;
        }
        Ok(content)
    }
}
