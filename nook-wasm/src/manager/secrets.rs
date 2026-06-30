//! Secret CRUD + small utility methods (search, password / id generation,
//! status-channel poll).

use super::NookVaultManager;
use crate::NookError;
use crate::NookSecretRecord;
use crate::conversion::{
    records_to_vec, secret_id_armored_to_string, secret_id_types_to_string,
    string_armored_to_secret_id, string_secret_types_to_secret_id,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    pub fn filter_secrets(&self, query: &str) -> Result<Vec<NookSecretRecord>, JsError> {
        let jsonl = nook_core::SessionJsonl::parse(&self.decrypted_jsonl)?;
        let db = nook_core::Database::from_jsonl(&jsonl)?;
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
        Ok(nook_core::generate_password(&nook_core::PasswordOptions {
            length: length as usize,
            lowercase,
            uppercase,
            numbers,
            symbols,
        })?)
    }

    /// Prefixed secret item id (`secret_{token}`).
    pub fn generate_secret_id(&self) -> Result<String, JsError> {
        Ok(nook_core::generate_secret_id()?.to_string())
    }

    /// Compact random token (11 chars, base64url) without a type prefix.
    pub fn generate_id(&self) -> Result<String, JsError> {
        Ok(nook_core::generate_id()?.to_string())
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
        self.ensure_vault_crypto_from_cache().await?;
        let id = nook_core::validate_secret_id(&id)?;
        nook_core::validate_secret_data(&data)?;
        let secret_type = nook_core::SecretType::parse(&secret_type)?;
        let typed_value = nook_core::SecretValue::from_yaml_str(secret_type, &data)?;
        let jsonl = nook_core::SessionJsonl::parse(&self.decrypted_jsonl)?;
        let mut db = nook_core::Database::from_jsonl(&jsonl)?;
        db.insert(id.clone(), typed_value);
        let new_jsonl = db.to_jsonl()?;
        self.decrypted_jsonl = new_jsonl.into_inner();

        let armored = self
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?
            .encrypt_value(&data)?;
        self.stored_armored
            .insert(id.to_string(), armored.as_str().to_owned());
        self.secret_types.insert(id.to_string(), secret_type);

        if self.event_log_mode || self.ensure_event_log_mode().await? {
            let id_str = id.to_string();
            let ciphertext = self
                .stored_armored
                .get(&id_str)
                .cloned()
                .unwrap_or_default();
            self.append_vault_operations(vec![nook_core::VaultOperation::SecretCreated {
                secret: nook_core::encrypted_secret_from_armored(
                    id.as_str(),
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

    // Replace a secret (new id + payload, single save)
    pub async fn replace_secret(
        &mut self,
        old_id: String,
        new_id: String,
        secret_type: String,
        data: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status_tx.send("REPLACE_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        let secret_type = nook_core::SecretType::parse(&secret_type)?;
        let crypto = self
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let jsonl = nook_core::SessionJsonl::parse(&self.decrypted_jsonl)?;
        let mut db = nook_core::Database::from_jsonl(&jsonl)?;
        let mut armored_sid = string_armored_to_secret_id(&self.stored_armored);
        let mut secret_types_sid = string_secret_types_to_secret_id(&self.secret_types);
        nook_core::replace_secret(
            &mut db,
            &mut armored_sid,
            &mut secret_types_sid,
            crypto,
            &nook_core::ReplaceSecretInput {
                old_id: &old_id,
                new_id: &new_id,
                secret_type,
                data_yaml: &data,
            },
        )?;
        self.stored_armored = secret_id_armored_to_string(&armored_sid);
        self.secret_types = secret_id_types_to_string(&secret_types_sid);
        self.decrypted_jsonl = db.to_jsonl()?.into_inner();

        if self.event_log_mode || self.ensure_event_log_mode().await? {
            let validated_new = nook_core::validate_secret_id(&new_id)?;
            let validated_old = nook_core::validate_secret_id(&old_id)?;
            let validated_new_str = validated_new.to_string();
            let ciphertext = self
                .stored_armored
                .get(&validated_new_str)
                .cloned()
                .unwrap_or_default();
            self.append_vault_operations(vec![nook_core::VaultOperation::SecretReplaced {
                old_id: validated_old.to_string(),
                new_secret: nook_core::encrypted_secret_from_armored(
                    validated_new.as_str(),
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

    #[wasm_bindgen(js_name = eventLogMode)]
    pub fn event_log_mode(&self) -> bool {
        self.event_log_mode
    }

    #[wasm_bindgen(js_name = listProjectionConflicts)]
    pub async fn list_projection_conflicts(
        &self,
    ) -> Result<Vec<crate::NookReplacementConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        crate::types::replacement_conflicts_to_vec(projection.replacement_conflicts)
            .map_err(Into::into)
    }

    // Delete a secret
    pub async fn delete_secret(&mut self, id: String) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status_tx.send("DELETE_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        let id = nook_core::validate_secret_id(&id)?;
        let jsonl = nook_core::SessionJsonl::parse(&self.decrypted_jsonl)?;
        let mut db = nook_core::Database::from_jsonl(&jsonl)?;
        db.remove(&id);
        let new_jsonl = db.to_jsonl()?;
        self.decrypted_jsonl = new_jsonl.into_inner();
        let id_str = id.to_string();
        self.stored_armored.remove(&id_str);
        self.secret_types.remove(&id_str);
        if self.event_log_mode || self.ensure_event_log_mode().await? {
            self.append_vault_operations(vec![nook_core::VaultOperation::SecretDeleted {
                secret_id: id_str,
            }])
            .await?;
        } else {
            self.save_current_db().await?;
        }
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }
}
