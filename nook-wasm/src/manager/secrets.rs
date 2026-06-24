//! Secret CRUD + small utility methods (search, password / id generation,
//! status-channel poll).

use super::NookVaultManager;
use crate::NookError;
use crate::conversion::records_to_array;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
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
}
