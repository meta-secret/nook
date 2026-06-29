//! Secret CRUD + small utility methods (search, password / id generation,
//! status-channel poll).

use super::NookVaultManager;
use crate::NookError;
use crate::NookSecretRecord;
use crate::conversion::records_to_vec;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    pub fn filter_secrets(&self, query: &str) -> Result<Vec<NookSecretRecord>, JsError> {
        let db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        let filtered = nook_core::filter_secrets(&db.list(), query);
        records_to_vec(filtered).map_err(Into::into)
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

    /// Prefixed secret item id (`secret_{token}`).
    pub fn generate_secret_id(&self) -> Result<String, JsError> {
        nook_core::generate_secret_id()
            .map_err(NookError::Database)
            .map_err(Into::into)
    }

    /// Compact random token (11 chars, base64url) without a type prefix.
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
    // Add a secret
    pub async fn add_secret(
        &mut self,
        id: String,
        secret_type: String,
        data: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
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
        self.secret_types.insert(id.clone(), secret_type);

        if self.event_log_mode || self.ensure_event_log_mode().await? {
            let ciphertext = self.stored_armored.get(&id).cloned().unwrap_or_default();
            self.append_vault_operations(vec![nook_core::VaultOperation::SecretCreated {
                secret: nook_core::encrypted_secret_from_armored(&id, secret_type, &ciphertext),
            }])
            .await?;
        } else {
            self.save_current_db().await?;
        }
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }

    // Replace a secret (new id + payload, single save)
    pub async fn replace_secret(
        &mut self,
        old_id: String,
        new_id: String,
        secret_type: String,
        data: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status_tx.send("REPLACE_SECRET_START".to_owned());
        let secret_type =
            nook_core::SecretType::parse(&secret_type).map_err(NookError::Database)?;
        let crypto = self
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        nook_core::replace_secret(
            &mut db,
            &mut self.stored_armored,
            &mut self.secret_types,
            crypto,
            &nook_core::ReplaceSecretInput {
                old_id: &old_id,
                new_id: &new_id,
                secret_type,
                data_yaml: &data,
            },
        )
        .map_err(NookError::Database)?;
        self.decrypted_jsonl = db.to_jsonl().map_err(NookError::Database)?;

        if self.event_log_mode || self.ensure_event_log_mode().await? {
            let validated_new =
                nook_core::validate_secret_id(&new_id).map_err(NookError::Database)?;
            let validated_old =
                nook_core::validate_secret_id(&old_id).map_err(NookError::Database)?;
            let ciphertext = self
                .stored_armored
                .get(&validated_new)
                .cloned()
                .unwrap_or_default();
            self.append_vault_operations(vec![nook_core::VaultOperation::SecretReplaced {
                old_id: validated_old,
                new_secret: nook_core::encrypted_secret_from_armored(
                    &validated_new,
                    secret_type,
                    &ciphertext,
                ),
            }])
            .await?;
        } else {
            self.save_current_db().await?;
        }
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }

    #[wasm_bindgen(js_name = syncEventLogForProvider)]
    pub async fn sync_event_log_for_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        self.flush_event_outbox().await?;
        Ok(())
    }

    #[wasm_bindgen(getter, js_name = eventLogMode)]
    pub fn event_log_mode(&self) -> bool {
        self.event_log_mode
    }

    // Delete a secret
    pub async fn delete_secret(&mut self, id: String) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status_tx.send("DELETE_SECRET_START".to_owned());
        let id = nook_core::validate_secret_id(&id).map_err(NookError::Database)?;
        let mut db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        db.remove(&id);
        let new_jsonl = db.to_jsonl().map_err(NookError::Database)?;
        self.decrypted_jsonl = new_jsonl;
        self.stored_armored.remove(&id);
        self.secret_types.remove(&id);
        if self.event_log_mode || self.ensure_event_log_mode().await? {
            self.append_vault_operations(vec![nook_core::VaultOperation::SecretDeleted {
                secret_id: id.clone(),
            }])
            .await?;
        } else {
            self.save_current_db().await?;
        }
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }
}
