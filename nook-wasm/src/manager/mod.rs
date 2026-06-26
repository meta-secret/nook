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
//! `save_current_db`, device-identity helpers, vault-key application) stays
//! in this file because every submodule depends on it.

mod connect;
mod multi_device;
mod password;
mod secrets;
mod sync;

use crate::NookError;
use crate::conversion::{apply_member_records, records_to_array};
use crate::storage::{
    drive::{
        ensure_drive_vault_file, fetch_drive_vault, verify_drive_access,
        write_drive_vault_with_retry,
    },
    github::{ensure_github_repo_exists, fetch_github_username, write_github_text_file_with_retry},
    indexed_db::{load_from_indexed_db, load_or_create_device_identity, save_to_indexed_db},
};
use std::collections::HashMap;
use wasm_bindgen::prelude::wasm_bindgen;

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
    pub(in crate::manager) device_identity_secret: String,
    pub(in crate::manager) crypto: Option<nook_core::VaultCrypto>,
    pub(in crate::manager) stored_armored: HashMap<String, String>,
    pub(in crate::manager) secret_types: HashMap<String, nook_core::SecretType>,
    pub(in crate::manager) decrypted_jsonl: String,
    pub(in crate::manager) file_sha: Option<String>,
    pub(in crate::manager) last_synced_content: String,
    /// Cached empty-repo listing from GitHub (`GET .../contents/` → 404).
    pub(in crate::manager) github_root_empty: bool,
    /// Active unlock mode for this vault.
    pub(in crate::manager) unlock: nook_core::VaultUnlock,
    /// Backup password entries — parallel to device-key auth rows.
    pub(in crate::manager) password_entries: Vec<nook_core::PasswordUnlockEntry>,
    pub(in crate::manager) status_tx: flume::Sender<String>,
    pub(in crate::manager) status_rx: flume::Receiver<String>,
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
            device_identity_secret: String::new(),
            crypto: None,
            stored_armored: HashMap::new(),
            secret_types: HashMap::new(),
            unlock: nook_core::VaultUnlock::Keys,
            password_entries: Vec::new(),
            decrypted_jsonl: String::new(),
            file_sha: None,
            last_synced_content: String::new(),
            github_root_empty: false,
            status_tx,
            status_rx,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn storage_mode(&self) -> String {
        self.storage_mode.to_string()
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
        if self.device_identity_secret.is_empty() {
            return String::new();
        }
        nook_core::DeviceIdentity::from_secret_str(&self.device_identity_secret)
            .map(|identity| identity.public_key())
            .unwrap_or_default()
    }

    /// GitHub repo (`owner/name`) or Google Drive file id, depending on mode.
    #[wasm_bindgen(getter)]
    pub fn storage_remote_ref(&self) -> String {
        self.github_repo.clone()
    }
}

// ---- Cross-cutting private helpers ----------------------------------------
//
// These are called from multiple submodules of `manager` and therefore live
// here at the parent. Visibility is `pub(in crate::manager)` so the
// submodules can call them without leaking into the rest of the crate.

impl NookVaultManager {
    /// `pub(crate)` because `conversion::sync_result_session` reads it when
    /// building the sync-result JS object.
    pub(crate) fn get_records_as_array(&self) -> Result<js_sys::Array, NookError> {
        let db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        records_to_array(db.list())
    }

    pub(in crate::manager) async fn save_current_db(&mut self) -> Result<(), NookError> {
        let _ = self.status_tx.send("SAVE_START".to_owned());
        let records = nook_core::Database::stored_records_from_armored(
            &self.stored_armored,
            &self.secret_types,
        );
        let stored = nook_core::serialize_stored_yaml_with_unlock(
            &records,
            &self.unlock,
            &self.password_entries,
        )
        .map_err(NookError::Encryption)?;

        match self.storage_mode {
            nook_core::StorageMode::Local => {
                let _ = self.status_tx.send("IDB_SAVE_START".to_owned());
                save_to_indexed_db(&stored).await?;
                let _ = self.status_tx.send("IDB_SAVE_SUCCESS".to_owned());
            }
            nook_core::StorageMode::Github => {
                let _ = self.status_tx.send("GITHUB_SAVE_START".to_owned());
                let new_sha = write_github_text_file_with_retry(
                    &self.github_pat,
                    &self.github_repo,
                    &self.github_path,
                    &stored,
                    self.file_sha.clone(),
                )
                .await?;
                self.file_sha = Some(new_sha);
                self.github_root_empty = false;
                let _ = self.status_tx.send("GITHUB_SAVE_SUCCESS".to_owned());
            }
            nook_core::StorageMode::GoogleDrive => {
                let _ = self.status_tx.send("DRIVE_SAVE_START".to_owned());
                let (file_id, new_revision) = write_drive_vault_with_retry(
                    &self.github_pat,
                    &self.github_repo,
                    &self.github_path,
                    &stored,
                    self.file_sha.clone(),
                )
                .await?;
                self.github_repo = file_id;
                self.file_sha = Some(new_revision);
                let _ = self.status_tx.send("DRIVE_SAVE_SUCCESS".to_owned());
            }
        }
        self.last_synced_content = stored;
        Ok(())
    }

    pub(in crate::manager) fn device_identity(
        &self,
    ) -> Result<nook_core::DeviceIdentity, NookError> {
        nook_core::DeviceIdentity::from_secret_str(&self.device_identity_secret)
            .map_err(NookError::Encryption)
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
        if let Ok(unlock) = nook_core::read_vault_unlock(content) {
            self.unlock = unlock;
        }
        if let Ok(entries) = nook_core::read_vault_password_entries(content) {
            self.password_entries = entries;
        }
    }

    pub(in crate::manager) fn apply_vault_keys(
        &mut self,
        secrets_key: &str,
        members_key: &str,
    ) -> Result<(), NookError> {
        self.secrets_key = secrets_key.to_owned();
        self.members_key = members_key.to_owned();
        self.crypto =
            Some(nook_core::VaultCrypto::new(secrets_key).map_err(NookError::Encryption)?);
        Ok(())
    }

    pub(in crate::manager) async fn maybe_sync_self_into_roster(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        let records = self.stored_records_snapshot();
        let members_key = self.members_key.clone();
        if let Some(member_records) =
            nook_core::ensure_self_in_roster(&records, identity, &members_key)
                .map_err(NookError::Encryption)?
        {
            apply_member_records(&mut self.stored_armored, &member_records);
            self.save_current_db().await?;
        }
        Ok(())
    }

    pub(in crate::manager) fn stored_records_snapshot(&self) -> Vec<nook_core::StoredSecretRecord> {
        nook_core::Database::stored_records_from_armored(&self.stored_armored, &self.secret_types)
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
        let mode = nook_core::StorageMode::parse(storage_mode).map_err(NookError::Database)?;
        self.storage_mode = mode;
        self.file_sha = None;

        match mode {
            nook_core::StorageMode::Local => {
                self.github_pat = String::new();
            }
            nook_core::StorageMode::Github => {
                self.github_pat =
                    nook_core::validate_github_pat(github_pat).map_err(NookError::GitHub)?;
                let repo_name = nook_core::validate_github_repo_name(github_repo_name)
                    .map_err(NookError::Database)?;
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
                self.github_pat =
                    nook_core::validate_oauth_access_token(github_pat).map_err(NookError::Drive)?;
                let (known_file_id, raw_file_name) =
                    nook_core::parse_drive_storage_ref(github_repo_name);
                let file_name = nook_core::validate_drive_vault_file_name(&raw_file_name)
                    .map_err(NookError::Database)?;
                self.github_path = file_name.clone();
                let _ = self.status_tx.send("DRIVE_VERIFY".to_owned());
                verify_drive_access(&self.github_pat).await?;
                let file_id =
                    ensure_drive_vault_file(&self.github_pat, &known_file_id, &file_name).await?;
                self.github_repo = file_id;
            }
        }
        Ok(())
    }

    pub(in crate::manager) async fn ensure_device_identity(
        &mut self,
    ) -> Result<nook_core::DeviceIdentity, NookError> {
        if self.device_identity_secret.is_empty() {
            let identity = load_or_create_device_identity().await?;
            self.device_id = identity.device_id;
            self.device_identity_secret = identity.secret;
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
                let res =
                    fetch_drive_vault(&self.github_pat, &self.github_repo, &self.github_path)
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
        };
        Ok(content)
    }
}
