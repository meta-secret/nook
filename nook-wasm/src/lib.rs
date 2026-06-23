#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args,
    clippy::must_use_candidate,
    clippy::new_without_default,
    clippy::collapsible_str_replace,
    clippy::assigning_clones,
    clippy::fn_params_excessive_bools,
    clippy::unnecessary_wraps,
    clippy::items_after_statements
)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

#[derive(thiserror::Error, Debug)]
pub enum NookError {
    #[error("IndexedDB error: {0}")]
    IndexedDb(String),

    #[error("GitHub error: {0}")]
    GitHub(String),

    #[error("Decryption failed: {0}")]
    Decryption(String),

    #[error("Encryption failed: {0}")]
    Encryption(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Channel error: {0}")]
    Channel(String),

    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),
}

#[wasm_bindgen]
pub struct NookSecretRecord {
    id: String,
    secret_type: String,
    data: String,
}

#[wasm_bindgen]
impl NookSecretRecord {
    #[wasm_bindgen(constructor)]
    pub fn new(id: String, secret_type: String, data: String) -> Self {
        Self {
            id,
            secret_type,
            data,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    pub fn secret_type(&self) -> String {
        self.secret_type.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn data(&self) -> String {
        self.data.clone()
    }
}

// Session state of our secret vault
#[wasm_bindgen]
pub struct NookVaultManager {
    storage_mode: String,
    github_pat: String,
    github_repo: String,
    github_path: String,
    secrets_key: String,
    members_key: String,
    device_id: String,
    device_identity_secret: String,
    crypto: Option<nook_core::VaultCrypto>,
    stored_armored: HashMap<String, String>,
    secret_types: HashMap<String, nook_core::SecretType>,
    decrypted_jsonl: String,
    file_sha: Option<String>,
    last_synced_content: String,
    /// Cached empty-repo listing from GitHub (`GET .../contents/` → 404).
    github_root_empty: bool,
    /// Optional password-based unwrap path for `secrets_key` + `members_key`.
    /// Captured on every vault read; re-emitted on every YAML save so writes
    /// from devices unaware of the envelope cannot drop it silently.
    password_envelope: Option<nook_core::PasswordEnvelope>,
    status_tx: flume::Sender<String>,
    status_rx: flume::Receiver<String>,
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let (status_tx, status_rx) = flume::unbounded();
        Self {
            storage_mode: String::new(),
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
            password_envelope: None,
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
        self.storage_mode.clone()
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

    /// Load or create this browser's device identity (`IndexedDB`).
    pub async fn init_device(&mut self) -> Result<(), JsError> {
        self.ensure_device_identity().await?;
        Ok(())
    }

    /// Pending join requests stored in the vault file.
    pub fn list_pending_joins(&self) -> Result<js_sys::Array, JsError> {
        let records = self.stored_records_snapshot();
        let pending = nook_core::list_join_requests(&records);
        let array = js_sys::Array::new();
        for join in pending {
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(
                &obj,
                &JsValue::from_str("device_id"),
                &JsValue::from_str(&join.device_id),
            )
            .map_err(|_| NookError::Serialization("Failed to build join object.".to_owned()))?;
            js_sys::Reflect::set(
                &obj,
                &JsValue::from_str("public_key"),
                &JsValue::from_str(&join.public_key),
            )
            .map_err(|_| NookError::Serialization("Failed to build join object.".to_owned()))?;
            js_sys::Reflect::set(
                &obj,
                &JsValue::from_str("requested_at"),
                &JsValue::from_str(&join.requested_at),
            )
            .map_err(|_| NookError::Serialization("Failed to build join object.".to_owned()))?;
            array.push(&obj);
        }
        Ok(array)
    }

    /// Pull the latest vault file from storage when it changed; update the active session.
    /// Returns `{ changed, access_status?, secrets?, pending_joins?, vault_members? }`.
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
        self.last_synced_content = content.clone();
        sync_result_session(self, true)
    }

    /// Enrolled vault members (decrypted with `members_key`).
    pub fn list_vault_members(&self) -> Result<js_sys::Array, JsError> {
        let records = self.stored_records_snapshot();
        let members_key = self.members_key.clone();
        let members = nook_core::resolve_member_roster(&records, &members_key)
            .map_err(NookError::Decryption)?;
        let array = js_sys::Array::new();
        for member in members {
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(
                &obj,
                &JsValue::from_str("auth_id"),
                &JsValue::from_str(&member.auth_id),
            )
            .map_err(|_| NookError::Serialization("Failed to build member object.".to_owned()))?;
            js_sys::Reflect::set(
                &obj,
                &JsValue::from_str("device_id"),
                &JsValue::from_str(&member.device_id),
            )
            .map_err(|_| NookError::Serialization("Failed to build member object.".to_owned()))?;
            js_sys::Reflect::set(
                &obj,
                &JsValue::from_str("public_key"),
                &JsValue::from_str(&member.public_key),
            )
            .map_err(|_| NookError::Serialization("Failed to build member object.".to_owned()))?;
            js_sys::Reflect::set(
                &obj,
                &JsValue::from_str("enrolled_at"),
                &JsValue::from_str(&member.enrolled_at),
            )
            .map_err(|_| NookError::Serialization("Failed to build member object.".to_owned()))?;
            array.push(&obj);
        }
        Ok(array)
    }

    /// Device B requests access without decrypting the vault (writes join record only).
    pub async fn request_vault_access(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        requested_at: String,
    ) -> Result<(), JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity().await?;
        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database("No vault found to join.".to_owned()).into());
        }

        let format = nook_core::detect_stored_format(&content).map_err(NookError::Decryption)?;
        let mut records =
            nook_core::deserialize_stored(&content, format).map_err(NookError::Decryption)?;

        let auth_id = nook_core::dec_auth_id(&identity);
        if records.iter().any(|record| record.key == auth_id) {
            return Err(NookError::Database(
                "This device is already enrolled. Use Connect vault.".to_owned(),
            )
            .into());
        }

        let join_key = nook_core::join_record_key(identity.device_id());
        records.retain(|record| record.key != join_key);
        records.push(
            nook_core::create_join_request_record(&identity, &requested_at)
                .map_err(NookError::Database)?,
        );

        self.stored_armored = records_to_armored(&records);
        self.secret_types = records_to_secret_types(&records);
        save_device_identity_to_indexed_db(&self.device_id, &self.device_identity_secret).await?;
        self.save_current_db().await?;
        Ok(())
    }

    /// Device B enrolls with out-of-band `secrets_key` and `members_key`, then unlocks the vault.
    pub async fn enroll_and_connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        secrets_key: String,
        members_key: String,
    ) -> Result<js_sys::Array, JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity().await?;
        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database("No vault found to join.".to_owned()).into());
        }

        let format = nook_core::detect_stored_format(&content).map_err(NookError::Decryption)?;
        let mut records =
            nook_core::deserialize_stored(&content, format).map_err(NookError::Decryption)?;

        let auth_id = nook_core::dec_auth_id(&identity);
        records.retain(|record| record.key != auth_id);
        records.retain(|record| !nook_core::is_members_stored_record(record));
        let (auth, members) = nook_core::enroll_device_with_keys(
            &secrets_key,
            &members_key,
            &identity,
            &wasm_iso_timestamp(),
        )
        .map_err(NookError::Encryption)?;
        records.push(auth);
        records.extend(members);

        self.stored_armored = records_to_armored(&records);
        self.secret_types = records_to_secret_types(&records);
        save_device_identity_to_indexed_db(&self.device_id, &self.device_identity_secret).await?;
        self.save_current_db().await?;

        let updated =
            nook_core::serialize_stored(&records, format).map_err(NookError::Encryption)?;
        let LoadedVault {
            jsonl,
            armored,
            secret_types,
            secrets_key: resolved_secrets_key,
            members_key: resolved_members_key,
        } = load_stored_vault(&updated, &identity)?;
        self.apply_vault_keys(&resolved_secrets_key, &resolved_members_key)?;
        self.decrypted_jsonl = jsonl;
        self.stored_armored = armored;
        self.secret_types = secret_types;
        Ok(self.get_records_as_array()?)
    }

    /// Device B publishes a join request record with its public key.
    pub async fn create_join_request(&mut self, requested_at: String) -> Result<(), JsError> {
        let identity = self.device_identity()?;
        let record = nook_core::create_join_request_record(&identity, &requested_at)
            .map_err(NookError::Database)?;
        self.stored_armored.insert(record.key.clone(), record.value);
        self.save_current_db().await?;
        Ok(())
    }

    /// Device A approves a pending join by encrypting DEC for the requester.
    pub async fn approve_join_request(
        &mut self,
        join_device_id: String,
    ) -> Result<js_sys::Array, JsError> {
        let identity = self.device_identity()?;
        let records = self.stored_records_snapshot();
        let pending = nook_core::list_join_requests(&records);
        let join = pending
            .into_iter()
            .find(|entry| entry.device_id == join_device_id)
            .ok_or_else(|| NookError::Database("Join request not found.".to_owned()))?;
        let (auth_record, join_key, member_records) = nook_core::approve_join_request(
            &self.secrets_key,
            &self.members_key,
            &join,
            &identity,
            &records,
        )
        .map_err(NookError::Encryption)?;
        self.stored_armored.remove(&join_key);
        self.stored_armored
            .insert(auth_record.key.clone(), auth_record.value);
        apply_member_records(&mut self.stored_armored, &member_records);
        self.save_current_db().await?;
        Ok(self.get_records_as_array()?)
    }

    /// Device B self-enrolls when it already holds `secrets_key` and `members_key` out-of-band.
    pub async fn enroll_with_keys(
        &mut self,
        secrets_key: String,
        members_key: String,
    ) -> Result<js_sys::Array, JsError> {
        let identity = self.device_identity()?;
        let (auth, members) = nook_core::enroll_device_with_keys(
            &secrets_key,
            &members_key,
            &identity,
            &wasm_iso_timestamp(),
        )
        .map_err(NookError::Encryption)?;
        self.apply_vault_keys(&secrets_key, &members_key)?;
        self.stored_armored.insert(auth.key.clone(), auth.value);
        for member in members {
            self.stored_armored.insert(member.key.clone(), member.value);
        }
        self.save_current_db().await?;
        Ok(self.get_records_as_array()?)
    }

    /// Back-compat alias — `members_key` must equal `secrets_key` (legacy test path only).
    pub async fn enroll_with_dec(&mut self, dec: String) -> Result<js_sys::Array, JsError> {
        self.enroll_with_keys(dec.clone(), dec).await
    }

    /// Whether the active vault carries a password envelope alongside auth rows.
    #[wasm_bindgen(js_name = "hasPasswordEnvelope")]
    pub fn has_password_envelope(&self) -> bool {
        self.password_envelope.is_some()
    }

    /// Verify a password decrypts the current envelope. Used to guard issuing
    /// an enrollment code so the user has just confirmed possession.
    #[wasm_bindgen(js_name = "verifyVaultPassword")]
    pub fn verify_vault_password(&self, password: &str) -> bool {
        match &self.password_envelope {
            Some(envelope) => nook_core::verify_password(envelope, password),
            None => false,
        }
    }

    /// Attach (or rotate) a password envelope to the active vault. Requires
    /// the device to already hold `secrets_key` + `members_key` in session.
    #[wasm_bindgen(js_name = "setVaultPassword")]
    pub async fn set_vault_password(&mut self, password: String) -> Result<(), JsError> {
        if self.secrets_key.is_empty() || self.members_key.is_empty() {
            return Err(NookError::Database(
                "Vault must be unlocked before setting a password.".to_owned(),
            )
            .into());
        }
        let keys = nook_core::VaultKeys {
            secrets_key: self.secrets_key.clone(),
            members_key: self.members_key.clone(),
        };
        let envelope =
            nook_core::attach_password_envelope(&keys, &password).map_err(NookError::Encryption)?;
        self.password_envelope = Some(envelope);
        self.save_current_db().await?;
        Ok(())
    }

    /// Drop the password envelope; vault returns to keys-only unwrap.
    #[wasm_bindgen(js_name = "removeVaultPassword")]
    pub async fn remove_vault_password(&mut self) -> Result<(), JsError> {
        if self.password_envelope.is_none() {
            return Ok(());
        }
        self.password_envelope = None;
        self.save_current_db().await?;
        Ok(())
    }

    /// Self-enrol a new device using only a password + storage credentials.
    /// Fetches the vault, unwraps the envelope, generates / loads this
    /// device's identity, writes its own auth row + members entry, persists
    /// the vault, and unlocks the session — no approval round-trip.
    #[wasm_bindgen(js_name = "connectWithPassword")]
    pub async fn connect_with_password(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        password: String,
    ) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("CONNECT_START".to_owned());
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity().await?;

        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database(
                "No vault found at this provider. Ask the inviter to confirm the repo/path."
                    .to_owned(),
            )
            .into());
        }

        let envelope = self.password_envelope.clone().ok_or_else(|| {
            NookError::Decryption(
                "This vault has no password set. Ask an enrolled device to attach a password."
                    .to_owned(),
            )
        })?;
        let keys = nook_core::resolve_keys_from_password(&envelope, &password)
            .map_err(NookError::Decryption)?;

        let format = nook_core::detect_stored_format(&content).map_err(NookError::Decryption)?;
        let mut records =
            nook_core::deserialize_stored(&content, format).map_err(NookError::Decryption)?;

        let auth_id = nook_core::dec_auth_id(&identity);
        records.retain(|record| record.key != auth_id);
        let self_member_key = nook_core::member_stored_key(&auth_id);
        records.retain(|record| {
            !nook_core::is_members_stored_record(record) || record.key != self_member_key
        });

        let auth = nook_core::genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key)
            .map_err(NookError::Encryption)?;
        records.push(auth);
        let existing_roster =
            nook_core::resolve_member_roster(&records, &keys.members_key).unwrap_or_default();
        let updated_roster = nook_core::roster_add_member(
            existing_roster,
            nook_core::member_from_identity(&identity, &wasm_iso_timestamp()),
        );
        records.retain(|record| !nook_core::is_members_stored_record(record));
        records.extend(
            nook_core::build_members_records(&updated_roster, &keys.members_key)
                .map_err(NookError::Encryption)?,
        );

        self.stored_armored = records_to_armored(&records);
        self.secret_types = records_to_secret_types(&records);
        self.apply_vault_keys(&keys.secrets_key, &keys.members_key)?;
        save_device_identity_to_indexed_db(&self.device_id, &self.device_identity_secret).await?;
        self.save_current_db().await?;

        let LoadedVault {
            jsonl,
            armored,
            secret_types,
            secrets_key,
            members_key,
        } = load_stored_vault(&self.last_synced_content, &identity)?;
        self.apply_vault_keys(&secrets_key, &members_key)?;
        self.decrypted_jsonl = jsonl;
        self.stored_armored = armored;
        self.secret_types = secret_types;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }

    /// Case-insensitive label search over the in-memory vault.
    pub fn filter_secrets(&self, query: &str) -> Result<js_sys::Array, JsError> {
        let db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        let filtered = nook_core::filter_secrets(&db.list(), query);
        records_to_array(filtered).map_err(Into::into)
    }

    /// Cryptographically secure password generation (same rules as the vault UI).
    pub fn generate_password(
        &self,
        length: u32,
        lowercase: bool,
        uppercase: bool,
        numbers: bool,
        symbols: bool,
    ) -> Result<String, JsError> {
        nook_core::generate_password(&nook_core::PasswordOptions {
            length: length as usize,
            lowercase,
            uppercase,
            numbers,
            symbols,
        })
        .map_err(NookError::Database)
        .map_err(Into::into)
    }

    /// Compact, URL-safe random ID (64-bit, base64url, no padding — 11 chars).
    pub fn generate_id(&self) -> Result<String, JsError> {
        nook_core::generate_id()
            .map_err(NookError::Database)
            .map_err(Into::into)
    }

    // Expose status channel stream to Svelte client
    pub async fn next_status(&self) -> Result<String, JsError> {
        let msg = self
            .status_rx
            .recv_async()
            .await
            .map_err(|e| NookError::Channel(format!("Receive error: {}", e)))?;
        Ok(msg)
    }

    /// Check whether this device can decrypt the vault before attempting connect.
    /// Returns `ready`, `new_vault`, `needs_enrollment`, or `join_pending`.
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
            return Ok("new_vault".to_owned());
        }

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
        let content = self.fetch_vault_content(&mut vault_file_missing).await?;

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

    // Add a secret
    pub async fn add_secret(
        &mut self,
        id: String,
        secret_type: String,
        data: String,
    ) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("ADD_SECRET_START".to_owned());
        let id = nook_core::validate_secret_id(&id).map_err(NookError::Database)?;
        nook_core::validate_secret_data(&data).map_err(NookError::Database)?;
        let secret_type =
            nook_core::SecretType::parse(&secret_type).map_err(NookError::Database)?;
        let typed_value =
            nook_core::SecretValue::from_yaml(secret_type, &data).map_err(NookError::Database)?;
        let mut db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        db.insert(id.clone(), typed_value);
        let new_jsonl = db.to_jsonl().map_err(NookError::Database)?;
        self.decrypted_jsonl = new_jsonl;

        let armored = self
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?
            .encrypt_value(&data)
            .map_err(NookError::Encryption)?;
        self.stored_armored.insert(id.clone(), armored);
        self.secret_types.insert(id, secret_type);

        self.save_current_db().await?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }

    // Delete a secret
    pub async fn delete_secret(&mut self, id: String) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("DELETE_SECRET_START".to_owned());
        let id = nook_core::validate_secret_id(&id).map_err(NookError::Database)?;
        let mut db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        db.remove(&id);
        let new_jsonl = db.to_jsonl().map_err(NookError::Database)?;
        self.decrypted_jsonl = new_jsonl;
        self.stored_armored.remove(&id);
        self.secret_types.remove(&id);
        self.save_current_db().await?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }

    // Helper: list secrets as array of NookSecretRecord
    fn get_records_as_array(&self) -> Result<js_sys::Array, NookError> {
        let db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        records_to_array(db.list())
    }

    async fn save_current_db(&mut self) -> Result<(), NookError> {
        let _ = self.status_tx.send("SAVE_START".to_owned());
        let records = nook_core::Database::stored_records_from_armored(
            &self.stored_armored,
            &self.secret_types,
        );
        let stored = nook_core::serialize_stored_yaml_with_envelope(
            &records,
            self.password_envelope.as_ref(),
        )
        .map_err(NookError::Encryption)?;

        if self.storage_mode == "local" {
            let _ = self.status_tx.send("IDB_SAVE_START".to_owned());
            save_to_indexed_db(&stored).await?;
            let _ = self.status_tx.send("IDB_SAVE_SUCCESS".to_owned());
        } else {
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
        self.last_synced_content = stored;
        Ok(())
    }

    fn device_identity(&self) -> Result<nook_core::DeviceIdentity, NookError> {
        nook_core::DeviceIdentity::from_secret_str(&self.device_identity_secret)
            .map_err(NookError::Encryption)
    }

    /// Pull the password envelope (if any) from the stored YAML and stash it in
    /// session state. Called after every successful fetch so writes always
    /// re-emit the envelope even from devices that never typed the password.
    fn capture_password_envelope(&mut self, content: &str) {
        // Parse failure on a malformed vault is surfaced through other load
        // paths; here we just leave the envelope unchanged.
        if let Ok(envelope) = nook_core::read_password_envelope(content) {
            self.password_envelope = envelope;
        }
    }

    fn apply_vault_keys(&mut self, secrets_key: &str, members_key: &str) -> Result<(), NookError> {
        self.secrets_key = secrets_key.to_owned();
        self.members_key = members_key.to_owned();
        self.crypto =
            Some(nook_core::VaultCrypto::new(secrets_key).map_err(NookError::Encryption)?);
        Ok(())
    }

    async fn maybe_sync_self_into_roster(
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

    fn stored_records_snapshot(&self) -> Vec<nook_core::StoredSecretRecord> {
        nook_core::Database::stored_records_from_armored(&self.stored_armored, &self.secret_types)
    }

    fn needs_genesis_persist(&self) -> bool {
        !nook_core::vault_has_multi_device_records(&self.stored_records_snapshot())
    }

    async fn prepare_storage(
        &mut self,
        storage_mode: &str,
        github_pat: &str,
        github_repo_name: &str,
    ) -> Result<(), NookError> {
        nook_core::validate_storage_mode(storage_mode).map_err(NookError::Database)?;
        self.storage_mode = storage_mode.to_owned();
        if self.storage_mode == nook_core::STORAGE_MODE_GITHUB {
            self.github_pat =
                nook_core::validate_github_pat(github_pat).map_err(NookError::GitHub)?;
        } else {
            self.github_pat = String::new();
        }
        self.file_sha = None;

        if self.storage_mode == "github" {
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
        Ok(())
    }

    async fn ensure_device_identity(&mut self) -> Result<nook_core::DeviceIdentity, NookError> {
        if self.device_identity_secret.is_empty() {
            let (device_id, device_identity_secret) = load_or_create_device_identity().await?;
            self.device_id = device_id;
            self.device_identity_secret = device_identity_secret;
        }
        self.device_identity()
    }

    async fn fetch_vault_content(
        &mut self,
        vault_file_missing: &mut bool,
    ) -> Result<String, NookError> {
        let content = if self.storage_mode == "local" {
            let _ = self.status_tx.send("IDB_LOAD_START".to_owned());
            let stored = load_from_indexed_db().await?;
            let _ = self.status_tx.send("IDB_LOAD_SUCCESS".to_owned());
            stored.unwrap_or_default()
        } else {
            let _ = self.status_tx.send("GITHUB_FETCH_START".to_owned());
            let res = fetch_github_vault(
                &self.github_pat,
                &self.github_repo,
                &self.github_path,
                Some(&mut self.github_root_empty),
            )
            .await?;
            let _ = self.status_tx.send("GITHUB_FETCH_SUCCESS".to_owned());
            if let Some((content, sha)) = res {
                self.file_sha = Some(sha);
                content
            } else {
                *vault_file_missing = true;
                String::new()
            }
        };
        self.capture_password_envelope(&content);
        Ok(content)
    }
}

fn records_to_array(records: Vec<nook_core::SecretRecord>) -> Result<js_sys::Array, NookError> {
    let array = js_sys::Array::new();
    for record in records {
        let data = record.data.to_yaml().map_err(NookError::Serialization)?;
        let wasm_record =
            NookSecretRecord::new(record.id, record.secret_type.as_str().to_owned(), data);
        array.push(&JsValue::from(wasm_record));
    }
    Ok(array)
}

fn records_to_armored(records: &[nook_core::StoredSecretRecord]) -> HashMap<String, String> {
    records
        .iter()
        .map(|record| (record.key.clone(), record.value.clone()))
        .collect()
}

fn records_to_secret_types(
    records: &[nook_core::StoredSecretRecord],
) -> HashMap<String, nook_core::SecretType> {
    records
        .iter()
        .filter_map(|record| {
            record
                .secret_type
                .map(|secret_type| (record.key.clone(), secret_type))
        })
        .collect()
}

fn content_requires_genesis(content: &str, force_genesis: bool) -> Result<bool, NookError> {
    if force_genesis {
        return Ok(true);
    }
    if content.trim().is_empty() {
        return Ok(true);
    }
    let format = nook_core::detect_stored_format(content).map_err(NookError::Decryption)?;
    let records = nook_core::deserialize_stored(content, format).map_err(NookError::Decryption)?;
    Ok(!nook_core::vault_has_multi_device_records(&records))
}

fn access_status_for_vault_content(
    content: &str,
    identity: &nook_core::DeviceIdentity,
) -> Result<String, NookError> {
    if content.trim().is_empty() {
        return Ok("new_vault".to_owned());
    }
    let format = nook_core::detect_stored_format(content).map_err(NookError::Decryption)?;
    let records = nook_core::deserialize_stored(content, format).map_err(NookError::Decryption)?;
    if !nook_core::vault_has_multi_device_records(&records) {
        return Ok("new_vault".to_owned());
    }
    Ok(match nook_core::assess_connect_access(&records, identity) {
        nook_core::ConnectAccessStatus::Ready => "ready",
        nook_core::ConnectAccessStatus::NeedsEnrollment => "needs_enrollment",
        nook_core::ConnectAccessStatus::JoinPending => "join_pending",
    }
    .to_owned())
}

fn sync_result_unchanged() -> Result<JsValue, JsError> {
    let obj = js_sys::Object::new();
    js_set(&obj, "changed", &JsValue::FALSE)?;
    Ok(obj.into())
}

fn sync_result_access_status(status: &str) -> Result<JsValue, JsError> {
    let obj = js_sys::Object::new();
    js_set(&obj, "changed", &JsValue::TRUE)?;
    js_set(&obj, "access_status", &JsValue::from_str(status))?;
    Ok(obj.into())
}

fn sync_result_session(manager: &NookVaultManager, changed: bool) -> Result<JsValue, JsError> {
    let obj = js_sys::Object::new();
    js_set(&obj, "changed", &JsValue::from_bool(changed))?;
    js_set(&obj, "secrets", &manager.get_records_as_array()?.into())?;
    js_set(&obj, "pending_joins", &manager.list_pending_joins()?.into())?;
    js_set(&obj, "vault_members", &manager.list_vault_members()?.into())?;
    Ok(obj.into())
}

fn js_set(obj: &js_sys::Object, key: &str, value: &JsValue) -> Result<(), NookError> {
    js_sys::Reflect::set(obj, &JsValue::from_str(key), value).map_err(|_| {
        NookError::Serialization(format!("Failed to set sync result field `{key}`."))
    })?;
    Ok(())
}

fn apply_member_records(
    armored: &mut HashMap<String, String>,
    member_records: &[nook_core::StoredSecretRecord],
) {
    armored.retain(|key, _| !key.starts_with(nook_core::MEMBER_RECORD_PREFIX));
    for record in member_records {
        armored.insert(record.key.clone(), record.value.clone());
    }
}

fn wasm_iso_timestamp() -> String {
    js_sys::Date::new_0().to_iso_string().into()
}

struct LoadedVault {
    jsonl: String,
    armored: HashMap<String, String>,
    secret_types: HashMap<String, nook_core::SecretType>,
    secrets_key: String,
    members_key: String,
}

fn load_stored_vault(
    content: &str,
    identity: &nook_core::DeviceIdentity,
) -> Result<LoadedVault, NookError> {
    let format = nook_core::detect_stored_format(content).map_err(NookError::Decryption)?;
    let stored_records =
        nook_core::deserialize_stored(content, format).map_err(NookError::Decryption)?;
    let secrets_key =
        nook_core::resolve_secrets_key(&stored_records, identity).map_err(NookError::Decryption)?;
    let members_key =
        nook_core::resolve_members_key(&stored_records, identity).map_err(NookError::Decryption)?;
    let crypto = nook_core::VaultCrypto::new(&secrets_key).map_err(NookError::Encryption)?;
    let mut armored = HashMap::with_capacity(stored_records.len());
    for record in &stored_records {
        armored.insert(record.key.clone(), record.value.clone());
    }
    let user_records = nook_core::user_stored_records(&stored_records);
    let db = nook_core::Database::from_stored_records_with_crypto(&user_records, &crypto)
        .map_err(NookError::Decryption)?;
    let jsonl = db.to_jsonl().map_err(NookError::Database)?;
    let secret_types = records_to_secret_types(&stored_records);
    Ok(LoadedVault {
        jsonl,
        armored,
        secret_types,
        secrets_key,
        members_key,
    })
}

// -------------------------------------------------------------
// IndexedDB Storage Functions (via rexie)
// -------------------------------------------------------------

async fn load_or_create_device_identity() -> Result<(String, String), NookError> {
    if let Some(existing) = load_device_identity_from_indexed_db().await? {
        return Ok(existing);
    }
    let identity = nook_core::DeviceIdentity::generate().map_err(NookError::Encryption)?;
    Ok((identity.device_id().to_owned(), identity.secret_string()))
}

async fn load_device_identity_from_indexed_db() -> Result<Option<(String, String)>, NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let id_key = serde_wasm_bindgen::to_value("device_id")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let secret_key = serde_wasm_bindgen::to_value("device_identity_secret")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let id_value = store
        .get(id_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {:?}", e)))?;
    let secret_value = store
        .get(secret_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;

    if id_value.is_none() || secret_value.is_none() {
        return Ok(None);
    }
    let id_value = id_value.unwrap();
    let secret_value = secret_value.unwrap();
    if id_value.is_undefined()
        || id_value.is_null()
        || secret_value.is_undefined()
        || secret_value.is_null()
    {
        return Ok(None);
    }

    let device_id: String = serde_wasm_bindgen::from_value(id_value)
        .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {:?}", e)))?;
    let secret: String = serde_wasm_bindgen::from_value(secret_value)
        .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {:?}", e)))?;
    Ok(Some((device_id, secret)))
}

async fn save_device_identity_to_indexed_db(
    device_id: &str,
    secret: &str,
) -> Result<(), NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let id_key = serde_wasm_bindgen::to_value("device_id")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let secret_key = serde_wasm_bindgen::to_value("device_identity_secret")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let id_value = serde_wasm_bindgen::to_value(device_id)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let secret_value = serde_wasm_bindgen::to_value(secret)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;

    store
        .put(&id_value, Some(&id_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {:?}", e)))?;
    store
        .put(&secret_value, Some(&secret_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;
    Ok(())
}

async fn load_from_indexed_db() -> Result<Option<String>, NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let key = serde_wasm_bindgen::to_value("encrypted_db")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let value = store
        .get(key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;

    match value {
        None => Ok(None),
        Some(val) => {
            if val.is_undefined() || val.is_null() {
                Ok(None)
            } else {
                let hex: String = serde_wasm_bindgen::from_value(val)
                    .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {:?}", e)))?;
                Ok(Some(hex))
            }
        }
    }
}

async fn save_to_indexed_db(hex: &str) -> Result<(), NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let key = serde_wasm_bindgen::to_value("encrypted_db")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let value = serde_wasm_bindgen::to_value(hex)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    store
        .put(&value, Some(&key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;
    Ok(())
}

// -------------------------------------------------------------
// GitHub API Storage Functions (via reqwest Client)
// -------------------------------------------------------------

#[derive(Deserialize)]
struct GitHubFileResponse {
    content: String,
    sha: String,
}

#[derive(Deserialize)]
struct GitHubDirEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Serialize)]
struct GitHubPutBody {
    message: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<String>,
}

#[derive(Deserialize)]
struct GitHubPutResponse {
    content: GitHubPutResponseContent,
}

#[derive(Deserialize)]
struct GitHubPutResponseContent {
    sha: String,
}

#[derive(Deserialize)]
struct GitHubUserResponse {
    login: String,
}

fn github_cache_bust_url(url: &str) -> String {
    let stamp = js_sys::Date::now();
    if url.contains('?') {
        format!("{url}&_={stamp}")
    } else {
        format!("{url}?_={stamp}")
    }
}

fn github_get_headers(pat: &str) -> [(&'static str, String); 4] {
    [
        ("Authorization", format!("Bearer {}", pat.trim())),
        ("Accept", "application/vnd.github+json".to_owned()),
        ("X-GitHub-Api-Version", "2022-11-28".to_owned()),
        ("User-Agent", "nook-wasm".to_owned()),
    ]
}

async fn fetch_github_username(pat: &str) -> Result<String, NookError> {
    let pat = pat.trim();
    if pat.is_empty() {
        return Err(NookError::GitHub(
            "GitHub personal access token is required.".to_owned(),
        ));
    }

    let url = "https://api.github.com/user";
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(NookError::GitHub(
            "GitHub rejected your token (401). Check that it is valid, not expired, and has repo access.".to_owned(),
        ));
    }

    if !response.status().is_success() {
        return Err(NookError::GitHub(format!(
            "Failed to fetch GitHub user details: status {}",
            response.status()
        )));
    }

    let text = response.text().await?;
    let parsed: GitHubUserResponse = serde_json::from_str(&text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse user JSON: {}", e)))?;

    Ok(parsed.login)
}

async fn ensure_github_repo_exists(pat: &str, repo: &str) -> Result<(), NookError> {
    let pat = pat.trim();
    let client = reqwest::Client::new();
    let check_url = format!("https://api.github.com/repos/{repo}");
    let check = client
        .get(&check_url)
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if check.status().is_success() {
        return Ok(());
    }

    if check.status() != reqwest::StatusCode::NOT_FOUND {
        return Err(NookError::GitHub(format!(
            "Failed to check GitHub repository {repo}: status {}",
            check.status()
        )));
    }

    let repo_name = repo
        .split('/')
        .nth(1)
        .ok_or_else(|| NookError::GitHub(format!("Invalid repository name: {repo}")))?;

    let body = serde_json::json!({
        "name": repo_name,
        "description": "Nook encrypted vault",
        "private": true,
        "auto_init": true
    });

    let create = client
        .post("https://api.github.com/user/repos")
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await?;

    if create.status().is_success() || create.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY
    {
        // 422 = repo already exists (race) or name taken under another account
        return Ok(());
    }

    Err(NookError::GitHub(format!(
        "Failed to create GitHub repository {repo}: status {}",
        create.status()
    )))
}

async fn fetch_github_vault(
    pat: &str,
    repo: &str,
    path: &str,
    root_empty: Option<&mut bool>,
) -> Result<Option<(String, String)>, NookError> {
    if root_empty.as_ref().is_some_and(|flag| **flag) {
        return Ok(None);
    }

    let pat = pat.trim();
    let client = reqwest::Client::new();
    let apply_headers = |request: reqwest::RequestBuilder| {
        let mut request = request;
        for (name, value) in github_get_headers(pat) {
            request = request.header(name, value);
        }
        request
    };

    // List repo root first so a missing vault file does not produce fetch 404
    // noise in the browser console (Chrome logs failed fetch responses).
    let list_url = github_cache_bust_url(&format!("https://api.github.com/repos/{repo}/contents/"));
    let list_response = apply_headers(client.get(&list_url)).send().await?;

    if list_response.status() == reqwest::StatusCode::NOT_FOUND {
        if let Some(flag) = root_empty {
            *flag = true;
        }
        return Ok(None);
    }

    if !list_response.status().is_success() {
        return Err(NookError::GitHub(format!(
            "GitHub API responded with status {}",
            list_response.status()
        )));
    }

    let list_text = list_response.text().await?;
    let entries: Vec<GitHubDirEntry> = serde_json::from_str(&list_text).map_err(|e| {
        NookError::Serialization(format!("Failed to parse GitHub directory listing: {e}"))
    })?;

    if !entries
        .iter()
        .any(|item| item.name == path && item.entry_type == "file")
    {
        return Ok(None);
    }

    let file_url = github_cache_bust_url(&format!(
        "https://api.github.com/repos/{repo}/contents/{path}"
    ));
    let file_response = apply_headers(client.get(&file_url)).send().await?;

    if file_response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !file_response.status().is_success() {
        return Err(NookError::GitHub(format!(
            "GitHub API responded with status {}",
            file_response.status()
        )));
    }

    let text = file_response.text().await?;

    let parsed: GitHubFileResponse = serde_json::from_str(&text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

    let cleaned_content = parsed
        .content
        .replace('\n', "")
        .replace('\r', "")
        .replace(' ', "");
    let decoded_bytes = base64_decode(&cleaned_content)?;
    let vault_content = String::from_utf8(decoded_bytes)
        .map_err(|e| NookError::Serialization(format!("Vault file is not valid UTF-8: {e}")))?;

    Ok(Some((vault_content, parsed.sha)))
}

async fn write_github_text_file(
    pat: &str,
    repo: &str,
    path: &str,
    content: &str,
    sha: Option<&str>,
) -> Result<String, NookError> {
    use base64::{Engine as _, engine::general_purpose};

    let base64_content = general_purpose::STANDARD.encode(content.as_bytes());

    let body = GitHubPutBody {
        message: "Update secrets store via Nook WASM".to_owned(),
        content: base64_content,
        sha: sha.map(String::from),
    };

    let body_str = serde_json::to_string(&body)
        .map_err(|e| NookError::Serialization(format!("Failed to serialize body: {}", e)))?;

    let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
    let client = reqwest::Client::new();
    let response = client
        .put(&url)
        .header("Authorization", format!("Bearer {}", pat.trim()))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .header("Content-Type", "application/json")
        .body(body_str)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let message = if status == reqwest::StatusCode::NOT_FOUND {
            format!(
                "Cannot write to {repo}/{path} (404). Ensure your PAT has repo scope and you can access {repo}."
            )
        } else {
            format!("GitHub API responded with status {status}")
        };
        return Err(NookError::GitHub(message));
    }

    let text = response.text().await?;

    let parsed: GitHubPutResponse = serde_json::from_str(&text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

    Ok(parsed.content.sha)
}

async fn write_github_text_file_with_retry(
    pat: &str,
    repo: &str,
    path: &str,
    content: &str,
    mut sha: Option<String>,
) -> Result<String, NookError> {
    for attempt in 0..3 {
        match write_github_text_file(pat, repo, path, content, sha.as_deref()).await {
            Ok(new_sha) => return Ok(new_sha),
            Err(NookError::GitHub(message))
                if attempt < 2 && (message.contains("422") || message.contains("409")) =>
            {
                if let Ok(Some((_, fresh_sha))) = fetch_github_vault(pat, repo, path, None).await {
                    sha = Some(fresh_sha);
                }
            }
            Err(err) => return Err(err),
        }
    }
    Err(NookError::GitHub(
        "GitHub vault write failed after retries.".to_owned(),
    ))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, NookError> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD
        .decode(input)
        .map_err(|e| NookError::Serialization(format!("Base64 decode error: {}", e)))
}
