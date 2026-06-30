//! Backup password entries — parallel to device-key unlock.
//!
//! Passwords are optional recovery credentials stored alongside `auth:` rows.
//! Adding a password never removes device keys. Unlocking via password writes
//! (or refreshes) this device's auth row so device-key unlock works again.

use super::NookVaultManager;
use crate::NookError;
use crate::NookPasswordEntrySummary;
use crate::NookSecretRecord;
use crate::conversion::{records_to_armored, records_to_secret_types, wasm_iso_timestamp};
use crate::storage::indexed_db::{load_vault_local_cache, save_device_identity_to_indexed_db};
use crate::types::password_entries_to_vec;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = "vaultUnlockMode")]
    pub fn vault_unlock_mode(&self) -> String {
        // Device keys are always the primary unlock path; backup passwords
        // coexist in `password_entries` without changing the mode tag.
        "keys".to_owned()
    }

    #[wasm_bindgen(js_name = "listVaultPasswordEntries")]
    pub fn list_vault_password_entries(&self) -> Result<Vec<NookPasswordEntrySummary>, JsError> {
        Ok(password_entries_to_vec(&self.password_entries))
    }

    #[wasm_bindgen(js_name = "fetchVaultPasswordEntries")]
    pub async fn fetch_vault_password_entries(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<NookPasswordEntrySummary>, JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let mut vault_missing = false;
        let mut content = self.fetch_vault_content(&mut vault_missing).await?;
        if vault_missing || content.trim().is_empty() {
            if let Some(cached) = load_vault_local_cache(&self.local_cache_ref()).await? {
                if cached.trim().is_empty() {
                    return Ok(Vec::new());
                }
                content = cached;
            } else {
                return Ok(Vec::new());
            }
        }
        let entries = nook_core::read_vault_password_entries(&content)?;
        self.password_entries = entries.clone();
        Ok(password_entries_to_vec(&entries))
    }

    #[wasm_bindgen(js_name = "verifyVaultPassword")]
    pub fn verify_vault_password(&self, entry_id: &str, password: &str) -> bool {
        match self
            .password_entries
            .iter()
            .find(|entry| entry.id == entry_id)
        {
            Some(entry) => nook_core::verify_password_entry(entry, password),
            None => false,
        }
    }

    #[wasm_bindgen(js_name = "addVaultPassword")]
    pub async fn add_vault_password(
        &mut self,
        label: String,
        password: String,
    ) -> Result<(), JsError> {
        if self.secrets_key.is_empty() || self.members_key.is_empty() {
            return Err(NookError::Database(
                "Vault must be unlocked before adding a password.".to_owned(),
            )
            .into());
        }
        let keys = nook_core::VaultKeys {
            secrets_key: self.secrets_key.clone(),
            members_key: self.members_key.clone(),
        };
        let entry = nook_core::create_password_entry(
            &keys,
            &nook_core::generate_id()?,
            &label,
            &wasm_iso_timestamp(),
            &password,
        )?;

        self.password_entries.push(entry);
        self.unlock = nook_core::VaultUnlock::Keys;
        let entry_id = self
            .password_entries
            .last()
            .map(|e| e.id.clone())
            .unwrap_or_default();
        let envelope_ciphertext = self
            .password_entries
            .last()
            .map(|e| serde_json::to_string(&e.envelope))
            .transpose()
            .map_err(|e| NookError::Serialization(e.to_string()))?
            .unwrap_or_default();
        self.persist_vault_change(vec![nook_core::VaultOperation::PasswordAdded {
            entry_id,
            envelope_ciphertext,
        }])
        .await?;
        Ok(())
    }

    #[wasm_bindgen(js_name = "setVaultPassword")]
    pub async fn set_vault_password(&mut self, password: String) -> Result<(), JsError> {
        self.add_vault_password("Vault password".to_owned(), password)
            .await
    }

    #[wasm_bindgen(js_name = "updateVaultPasswordEntry")]
    pub async fn update_vault_password_entry(
        &mut self,
        entry_id: String,
        password: String,
    ) -> Result<(), JsError> {
        if self.secrets_key.is_empty() || self.members_key.is_empty() {
            return Err(NookError::Database(
                "Vault must be unlocked before updating a password.".to_owned(),
            )
            .into());
        }
        let keys = nook_core::VaultKeys {
            secrets_key: self.secrets_key.clone(),
            members_key: self.members_key.clone(),
        };
        {
            let target = self
                .password_entries
                .iter_mut()
                .find(|entry| entry.id == entry_id)
                .ok_or_else(|| NookError::Database("Password entry not found.".to_owned()))?;
            target.envelope = nook_core::attach_password_envelope(&keys, &password)?;
        }
        let envelope_ciphertext = self
            .password_entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .map(|entry| {
                serde_json::to_string(&entry.envelope)
                    .map_err(|e| NookError::Serialization(e.to_string()))
            })
            .transpose()?
            .unwrap_or_default();
        if self.event_log_mode || self.ensure_event_log_mode().await? {
            self.rotate_security_epoch(nook_core::VaultOperation::PasswordRotated {
                entry_id: entry_id.clone(),
                envelope_ciphertext,
            })
            .await?;
            let rotated_keys = nook_core::VaultKeys {
                secrets_key: self.secrets_key.clone(),
                members_key: self.members_key.clone(),
            };
            let target = self
                .password_entries
                .iter_mut()
                .find(|entry| entry.id == entry_id)
                .ok_or_else(|| NookError::Database("Password entry not found.".to_owned()))?;
            target.envelope = nook_core::attach_password_envelope(&rotated_keys, &password)?;
            self.persist_vault_change(vec![]).await?;
        } else {
            self.save_current_db().await?;
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = "removeVaultPasswordEntry")]
    pub async fn remove_vault_password_entry(&mut self, entry_id: String) -> Result<(), JsError> {
        self.password_entries.retain(|entry| entry.id != entry_id);
        if self.event_log_mode || self.ensure_event_log_mode().await? {
            self.rotate_security_epoch(nook_core::VaultOperation::PasswordRemoved {
                entry_id: entry_id.clone(),
            })
            .await?;
        } else {
            self.save_current_db().await?;
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = "removeVaultPassword")]
    pub async fn remove_vault_password(&mut self) -> Result<(), JsError> {
        self.password_entries.clear();
        if self.event_log_mode || self.ensure_event_log_mode().await? {
            self.rotate_security_epoch(nook_core::VaultOperation::PasswordRemoved {
                entry_id: String::new(),
            })
            .await?;
        } else {
            self.save_current_db().await?;
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = "connectWithPassword")]
    pub async fn connect_with_password(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        entry_id: String,
        password: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
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
        self.capture_vault_unlock(&content);

        let entry = self
            .password_entries
            .iter()
            .find(|entry| {
                if entry_id.trim().is_empty() {
                    true
                } else {
                    entry.id == entry_id
                }
            })
            .or_else(|| self.password_entries.first())
            .ok_or_else(|| {
                NookError::Decryption("No backup password found on this vault.".to_owned())
            })?
            .clone();
        let keys = nook_core::resolve_keys_from_entry(&entry, &password)?;

        let format = nook_core::detect_stored_format(&content)?;
        let mut records = nook_core::deserialize_stored(&content, format)?;

        records.retain(|record| !nook_core::is_join_stored_record(record));

        let auth_id = nook_core::dec_auth_id(&identity);
        let auth = nook_core::genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key)?;
        records.retain(|record| !nook_core::is_auth_stored_record(record) || record.key != auth_id);
        records.push(auth);

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
        records.extend(nook_core::build_members_records(
            &updated_roster,
            &keys.members_key,
        )?);

        self.stored_armored = records_to_armored(&records);
        self.secret_types = records_to_secret_types(&records);
        self.apply_vault_keys(&keys.secrets_key, &keys.members_key)?;
        self.unlock = nook_core::VaultUnlock::Keys;
        save_device_identity_to_indexed_db(&self.device_id, &self.device_identity_secret).await?;
        self.save_current_db().await?;

        let crypto = nook_core::VaultCrypto::new(&keys.secrets_key)?;
        let stored_records = self.stored_records_snapshot();
        let user_records = nook_core::user_stored_records(&stored_records);
        let database =
            nook_core::Database::from_stored_records_with_crypto(&user_records, &crypto)?;
        self.decrypted_jsonl = database.to_jsonl()?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }
}
