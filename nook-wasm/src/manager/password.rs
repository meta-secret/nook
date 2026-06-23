//! Password unlock mode — `set` / `remove` / `verify` / `connectWithPassword`.
//!
//! All five methods enforce the `VaultUnlock` strict-mutex invariant:
//! switching to password drops every `auth:` / `joins:` row, switching back
//! writes only this device's auth row. `connectWithPassword` is the
//! self-enrolment path used by QR-based device joins.

use super::NookVaultManager;
use crate::NookError;
use crate::conversion::{records_to_armored, records_to_secret_types, wasm_iso_timestamp};
use crate::storage::indexed_db::save_device_identity_to_indexed_db;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// String tag of the active unlock mode: `"keys"` or `"password"`. Lets
    /// the web layer render mode-aware UI without exposing the enum shape.
    #[wasm_bindgen(js_name = "vaultUnlockMode")]
    pub fn vault_unlock_mode(&self) -> String {
        match &self.unlock {
            nook_core::VaultUnlock::Keys => "keys",
            nook_core::VaultUnlock::Password { .. } => "password",
        }
        .to_owned()
    }

    /// Verify a password decrypts the current envelope. Used to guard issuing
    /// an enrollment code so the user has just confirmed possession.
    /// Returns false when the vault is not in password mode.
    #[wasm_bindgen(js_name = "verifyVaultPassword")]
    pub fn verify_vault_password(&self, password: &str) -> bool {
        match &self.unlock {
            nook_core::VaultUnlock::Password { envelope } => {
                nook_core::verify_password(envelope, password)
            }
            nook_core::VaultUnlock::Keys => false,
        }
    }

    /// Switch the vault to password unlock mode. Wraps the active
    /// `secrets_key` + `members_key` with a scrypt-derived key and **drops
    /// every per-device auth row plus any pending joins** — the mutex
    /// invariant of `VaultUnlock`. Devices will then unlock with the
    /// password instead of their device identity.
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

        // Strict mutex: drop every auth row and pending join from the flat
        // record cache before flipping the mode. `members:` rows survive —
        // they're encrypted with `members_key`, not the per-device pk, and
        // remain a useful enrolment roster.
        self.stored_armored.retain(|key, value| {
            let record = nook_core::StoredSecretRecord {
                key: key.clone(),
                secret_type: None,
                value: value.clone(),
            };
            !nook_core::is_auth_stored_record(&record) && !nook_core::is_join_stored_record(&record)
        });
        self.secret_types
            .retain(|key, _| self.stored_armored.contains_key(key));

        self.unlock = nook_core::VaultUnlock::Password { envelope };
        self.save_current_db().await?;
        Ok(())
    }

    /// Switch the vault back to keys unlock mode. Drops the envelope,
    /// writes a fresh `auth:` row for **this** device only — other devices
    /// that previously unlocked via password must re-enrol via the standard
    /// join/approve flow (or temporarily restore password mode).
    #[wasm_bindgen(js_name = "removeVaultPassword")]
    pub async fn remove_vault_password(&mut self) -> Result<(), JsError> {
        if !self.unlock.is_password() {
            return Ok(());
        }
        if self.secrets_key.is_empty() || self.members_key.is_empty() {
            return Err(NookError::Database(
                "Vault must be unlocked before removing the password.".to_owned(),
            )
            .into());
        }
        let identity = self.device_identity()?;
        let secrets_key = self.secrets_key.clone();
        let members_key = self.members_key.clone();
        let auth = nook_core::genesis_auth_record(&identity, &secrets_key, &members_key)
            .map_err(NookError::Encryption)?;
        self.stored_armored.insert(auth.key.clone(), auth.value);

        self.unlock = nook_core::VaultUnlock::Keys;
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

        let envelope = match &self.unlock {
            nook_core::VaultUnlock::Password { envelope } => envelope.clone(),
            nook_core::VaultUnlock::Keys => {
                return Err(NookError::Decryption(
                    "This vault has no password set. Ask an enrolled device to attach a password."
                        .to_owned(),
                )
                .into());
            }
        };
        let keys = nook_core::resolve_keys_from_password(&envelope, &password)
            .map_err(NookError::Decryption)?;

        let format = nook_core::detect_stored_format(&content).map_err(NookError::Decryption)?;
        let mut records =
            nook_core::deserialize_stored(&content, format).map_err(NookError::Decryption)?;

        // Strict mutex: password mode has no per-device auth rows and no
        // pending joins. Drop any stragglers so this device's write keeps
        // the vault consistent with the enum invariant.
        records.retain(|record| {
            !nook_core::is_auth_stored_record(record) && !nook_core::is_join_stored_record(record)
        });

        // Ensure this device appears in the members: roster (so the UI can
        // show "who has joined"). Members rows are encrypted with
        // members_key, not with any per-device pk, so they're still
        // meaningful in password mode.
        let auth_id = nook_core::dec_auth_id(&identity);
        let self_member_key = nook_core::member_stored_key(&auth_id);
        records.retain(|record| {
            !nook_core::is_members_stored_record(record) || record.key != self_member_key
        });
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

        // Materialise the decrypted session from our own in-memory armored
        // state directly — `load_stored_vault` requires a `Keys`-mode vault
        // because it unwraps via the device identity, which is unavailable
        // (and unnecessary) when the unlock mode is `Password`.
        let crypto =
            nook_core::VaultCrypto::new(&keys.secrets_key).map_err(NookError::Encryption)?;
        let stored_records = self.stored_records_snapshot();
        let user_records = nook_core::user_stored_records(&stored_records);
        let database = nook_core::Database::from_stored_records_with_crypto(&user_records, &crypto)
            .map_err(NookError::Decryption)?;
        self.decrypted_jsonl = database.to_jsonl().map_err(NookError::Database)?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }
}
