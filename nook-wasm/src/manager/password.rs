//! Backup password entries — parallel to device-key unlock.
//!
//! Passwords are optional recovery credentials stored alongside `auth:` rows.
//! Adding a password never removes device keys. Unlocking via password writes
//! (or refreshes) this device's auth row so device-key unlock works again.

use super::NookVaultManager;
use crate::NookError;
use crate::NookPasswordEntrySummary;
use crate::NookSecretRecord;
use crate::conversion::wasm_iso_timestamp;
use crate::storage::event_db::load_local_event_store;
use crate::storage::indexed_db::{load_vault_local_cache, save_to_indexed_db};
use crate::types::password_entries_to_vec;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

const E2E_PASSWORD_SCRYPT_LOG_N: u8 = 10;

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
        self.add_vault_password_with_work_factor(label, password, nook_core::PASSWORD_SCRYPT_LOG_N)
            .await
    }

    #[wasm_bindgen(js_name = "addVaultPasswordForE2e")]
    pub async fn add_vault_password_for_e2e(
        &mut self,
        label: String,
        password: String,
    ) -> Result<(), JsError> {
        self.add_vault_password_with_work_factor(label, password, E2E_PASSWORD_SCRYPT_LOG_N)
            .await
    }

    async fn add_vault_password_with_work_factor(
        &mut self,
        label: String,
        password: String,
        work_factor: u8,
    ) -> Result<(), JsError> {
        self.ensure_vault_crypto_from_cache().await?;
        if self.secrets_key.is_empty() || self.members_key.is_empty() {
            return Err(NookError::Database(
                "Vault must be unlocked before adding a password.".to_owned(),
            )
            .into());
        }
        let keys = nook_core::VaultKeys {
            secrets_key: nook_core::SymmetricKey::parse(&self.secrets_key)?,
            members_key: nook_core::SymmetricKey::parse(&self.members_key)?,
        };
        let entry = nook_core::create_password_entry_with_work_factor(
            &keys,
            nook_core::generate_id()?.as_str(),
            &label,
            &wasm_iso_timestamp(),
            &password,
            work_factor,
        )?;

        self.password_entries.push(entry.clone());
        self.unlock = nook_core::VaultUnlock::Keys;
        let envelope_ciphertext = self
            .password_entries
            .last()
            .map(|e| serde_json::to_string(&e.envelope))
            .transpose()
            .map_err(|e| NookError::Serialization(e.to_string()))?
            .unwrap_or_default();
        self.persist_vault_change(vec![nook_core::VaultOperation::PasswordAdded {
            entry_id: nook_core::PasswordEntryId::parse(&entry.id)?,
            label: entry.label,
            created_at: nook_core::IsoTimestamp::parse(&entry.created_at)?,
            envelope_ciphertext: nook_core::OpaqueCiphertext::from_trusted(envelope_ciphertext),
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
        self.update_vault_password_entry_with_work_factor(
            entry_id,
            password,
            nook_core::PASSWORD_SCRYPT_LOG_N,
        )
        .await
    }

    #[wasm_bindgen(js_name = "updateVaultPasswordEntryForE2e")]
    pub async fn update_vault_password_entry_for_e2e(
        &mut self,
        entry_id: String,
        password: String,
    ) -> Result<(), JsError> {
        self.update_vault_password_entry_with_work_factor(
            entry_id,
            password,
            E2E_PASSWORD_SCRYPT_LOG_N,
        )
        .await
    }

    async fn update_vault_password_entry_with_work_factor(
        &mut self,
        entry_id: String,
        password: String,
        work_factor: u8,
    ) -> Result<(), JsError> {
        self.ensure_vault_crypto_from_cache().await?;
        if self.secrets_key.is_empty() || self.members_key.is_empty() {
            return Err(NookError::Database(
                "Vault must be unlocked before updating a password.".to_owned(),
            )
            .into());
        }
        let keys = nook_core::VaultKeys {
            secrets_key: nook_core::SymmetricKey::parse(&self.secrets_key)?,
            members_key: nook_core::SymmetricKey::parse(&self.members_key)?,
        };
        {
            let target = self
                .password_entries
                .iter_mut()
                .find(|entry| entry.id == entry_id)
                .ok_or_else(|| NookError::Database("Password entry not found.".to_owned()))?;
            target.envelope = nook_core::attach_password_envelope_with_work_factor(
                &keys,
                &password,
                work_factor,
            )?;
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
        self.ensure_event_log_ready().await?;
        self.rotate_security_epoch(nook_core::VaultOperation::PasswordRotated {
            entry_id: nook_core::PasswordEntryId::parse(&entry_id)?,
            envelope_ciphertext: nook_core::OpaqueCiphertext::from_trusted(envelope_ciphertext),
        })
        .await?;
        let rotated_keys = nook_core::VaultKeys {
            secrets_key: nook_core::SymmetricKey::parse(&self.secrets_key)?,
            members_key: nook_core::SymmetricKey::parse(&self.members_key)?,
        };
        let target = self
            .password_entries
            .iter_mut()
            .find(|entry| entry.id == entry_id)
            .ok_or_else(|| NookError::Database("Password entry not found.".to_owned()))?;
        target.envelope = nook_core::attach_password_envelope_with_work_factor(
            &rotated_keys,
            &password,
            work_factor,
        )?;
        self.persist_vault_change(vec![]).await?;
        Ok(())
    }

    #[wasm_bindgen(js_name = "removeVaultPasswordEntry")]
    pub async fn remove_vault_password_entry(&mut self, entry_id: String) -> Result<(), JsError> {
        self.password_entries.retain(|entry| entry.id != entry_id);
        self.ensure_event_log_ready().await?;
        self.rotate_security_epoch(nook_core::VaultOperation::PasswordRemoved {
            entry_id: nook_core::PasswordEntryId::parse(&entry_id)?,
        })
        .await?;
        Ok(())
    }

    #[wasm_bindgen(js_name = "removeVaultPassword")]
    pub async fn remove_vault_password(&mut self) -> Result<(), JsError> {
        let entry_ids: Vec<String> = self
            .password_entries
            .iter()
            .map(|entry| entry.id.clone())
            .collect();
        self.password_entries.clear();
        self.ensure_event_log_ready().await?;
        if let Some(first_id) = entry_ids.first() {
            self.rotate_security_epoch(nook_core::VaultOperation::PasswordRemoved {
                entry_id: nook_core::PasswordEntryId::parse(first_id)?,
            })
            .await?;
            for entry_id in entry_ids.iter().skip(1) {
                self.append_vault_operations(vec![nook_core::VaultOperation::PasswordRemoved {
                    entry_id: nook_core::PasswordEntryId::parse(entry_id)?,
                }])
                .await?;
            }
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
        let identity = self.ensure_device_identity()?;

        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        let (event_log_remote, mut records) = self
            .load_password_unlock_records(&content, vault_missing)
            .await?;

        if records.is_empty() {
            return Err(
                NookError::Database("No vault records found at this provider.".to_owned()).into(),
            );
        }

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

        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        self.unlock = nook_core::VaultUnlock::Keys;
        self.persist_password_unlock_membership(
            event_log_remote,
            &mut records,
            &identity,
            &keys,
            &content,
        )
        .await?;

        let crypto = nook_core::VaultCrypto::new(&keys.secrets_key)?;
        let stored_records = self.stored_records_snapshot();
        let user_records = nook_core::user_stored_records(&stored_records);
        let database =
            nook_core::Database::from_stored_records_with_crypto(&user_records, &crypto)?;
        self.decrypted_jsonl = database.to_jsonl()?.into_inner();
        if event_log_remote {
            let yaml = self.serialize_current_projection_yaml()?;
            save_to_indexed_db(&yaml).await?;
        }
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }

    async fn load_password_unlock_records(
        &mut self,
        content: &str,
        vault_missing: bool,
    ) -> Result<(bool, Vec<nook_core::StoredSecretRecord>), NookError> {
        let event_log_remote = self.storage_mode != nook_core::StorageMode::Local
            && (vault_missing || content.trim().is_empty());
        if event_log_remote {
            self.sync_events_from_current_provider().await?;
            if self.store_id.is_empty() || !self.event_log_has_events().await? {
                return Err(NookError::Database(
                    "No event log found at this provider. Ask the inviter to confirm the repo/path."
                        .to_owned(),
                ));
            }
            let store = load_local_event_store(&self.store_id).await?;
            let graph = store.load_graph(&self.store_id)?;
            let projection = nook_core::project_vault(&graph, &self.store_id)?;
            self.password_entries = projection.password_entries.clone();
            let user_records: Vec<nook_core::StoredSecretRecord> =
                projection.live_secrets(&graph).into_values().collect();
            let mut meta = nook_core::VaultMetaState::from_stored_records(&user_records);
            nook_core::materialize_vault_meta_from_graph(&graph, &mut meta)?;
            self.meta = meta;
            return Ok((true, self.meta.to_stored_records()));
        }

        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database(
                "No vault found at this provider. Ask the inviter to confirm the repo/path."
                    .to_owned(),
            ));
        }
        self.capture_vault_unlock(content);
        let format = nook_core::detect_stored_format(content)?;
        let mut records = nook_core::deserialize_stored(content, format)?;
        records.retain(|record| !nook_core::is_join_stored_record(record));
        Ok((false, records))
    }

    async fn persist_password_unlock_membership(
        &mut self,
        event_log_remote: bool,
        records: &mut Vec<nook_core::StoredSecretRecord>,
        identity: &nook_core::DeviceIdentity,
        keys: &nook_core::VaultKeys,
        content: &str,
    ) -> Result<(), NookError> {
        if event_log_remote {
            let signing = self.ensure_signing_identity().await?;
            let signing_pk = nook_core::DeviceSigningPublicKey::from_trusted(hex::encode(
                signing.verifying_key().as_bytes(),
            ));
            self.append_vault_operations(vec![nook_core::VaultOperation::JoinRequested {
                device_id: identity.device_id().clone(),
                encryption_public_key: identity.public_key().clone(),
                signing_public_key: signing_pk,
                label: nook_core::MemberLabel::from_trusted(String::new()),
            }])
            .await?;
            self.flush_event_outbox().await?;
            return self.persist_projection_cache().await;
        }

        let auth_id =
            nook_core::SecretId::from_vault_record(nook_core::dec_auth_id(identity).as_str());
        let auth = nook_core::genesis_auth_record(identity, &keys.secrets_key, &keys.members_key)?;
        records.retain(|record| !nook_core::is_auth_stored_record(record) || record.key != auth_id);
        records.push(auth);

        let self_member_key = nook_core::SecretId::from_vault_record(
            &nook_core::member_stored_key(&identity.auth_id()),
        );
        records.retain(|record| {
            !nook_core::is_members_stored_record(record) || record.key != self_member_key
        });
        let existing_roster =
            nook_core::resolve_member_roster(records, &keys.members_key).unwrap_or_default();
        let updated_roster = nook_core::roster_add_member(
            existing_roster,
            nook_core::member_from_identity(identity, &wasm_iso_timestamp()),
        );
        records.retain(|record| !nook_core::is_members_stored_record(record));
        records.extend(nook_core::build_members_records(
            &updated_roster,
            &keys.members_key,
        )?);

        self.meta = nook_core::VaultMetaState::from_stored_records(records);
        let content_vault_name = nook_core::read_vault_name(content).ok().flatten();
        let import_yaml = nook_core::serialize_stored_yaml_with_unlock_and_name(
            records,
            &self.unlock,
            &self.password_entries,
            nook_core::read_vault_store_id(content)
                .ok()
                .flatten()
                .as_deref(),
            content_vault_name.as_deref().or(self.vault_name.as_deref()),
            None,
        )?;
        self.import_stored_vault_to_event_log(import_yaml.as_str())
            .await?;
        self.flush_event_outbox().await
    }
}
