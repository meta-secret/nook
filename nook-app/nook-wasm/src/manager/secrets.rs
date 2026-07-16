//! Secret CRUD + small utility methods (search, password / id generation,
//! status-channel poll).

use super::NookVaultManager;
use crate::NookError;
use crate::NookImportResult;
use crate::{NookSecretPage, NookSecretRecord, NookTotpCode};
use serde::Serialize;
use std::collections::HashSet;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

fn serialize_js_objects<T: Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
}

#[derive(Clone, Copy)]
enum SecretImportSource {
    ApplePasswords,
    Bitwarden,
    ChromePasswords,
    OnePassword,
}

impl SecretImportSource {
    const fn status(self) -> &'static str {
        match self {
            Self::ApplePasswords => "IMPORT_APPLE_PASSWORDS_START",
            Self::Bitwarden => "IMPORT_BITWARDEN_START",
            Self::ChromePasswords => "IMPORT_CHROME_PASSWORDS_START",
            Self::OnePassword => "IMPORT_ONEPASSWORD_START",
        }
    }

    const fn action(self) -> &'static str {
        match self {
            Self::ApplePasswords => "import-apple-passwords",
            Self::Bitwarden => "import-bitwarden",
            Self::ChromePasswords => "import-chrome-passwords",
            Self::OnePassword => "import-onepassword",
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::ApplePasswords => "Apple Passwords",
            Self::Bitwarden => "Bitwarden",
            Self::ChromePasswords => "Chrome passwords",
            Self::OnePassword => "1Password",
        }
    }
}

impl NookVaultManager {
    async fn commit_secret_import(
        &mut self,
        items: Vec<nook_core::SecretValue>,
        skipped_unsupported: usize,
        source: SecretImportSource,
    ) -> Result<NookImportResult, JsError> {
        let _ = self.status.tx.send(source.status().to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        if !self
            .vault
            .architecture
            .can_create_secret_with_records(&self.stored_records_snapshot())
        {
            return Err(NookError::Database(
                "Sentinel vault is not ready for secret import.".to_owned(),
            )
            .into());
        }

        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut seen = HashSet::with_capacity(self.vault.meta.secrets.len());
        for (secret_type, payload) in self.vault.meta.secrets.values() {
            let ciphertext = nook_core::AgeArmoredCiphertext::parse(payload.as_str())?;
            let mut plaintext = crypto.decrypt_value(&ciphertext)?;
            let mut value =
                nook_core::SecretValue::from_yaml_str(*secret_type, plaintext.as_str())?;
            plaintext.zeroize_plaintext();
            let mut canonical = value.to_yaml()?;
            seen.insert(nook_core::sha256_hex(canonical.as_str().as_bytes()));
            canonical.zeroize_plaintext();
            value.zeroize_plaintext();
        }
        let mut skipped_duplicates = 0;
        let mut operations = Vec::new();

        for mut value in items {
            let mut yaml = value.to_yaml()?;
            if !seen.insert(nook_core::sha256_hex(yaml.as_str().as_bytes())) {
                skipped_duplicates += 1;
                yaml.zeroize_plaintext();
                value.zeroize_plaintext();
                continue;
            }
            let secret_type = value.secret_type();
            let ciphertext = self
                .vault
                .crypto
                .as_ref()
                .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?
                .encrypt_value(yaml.as_str())?;
            yaml.zeroize_plaintext();
            value.zeroize_plaintext();
            let id = nook_core::generate_secret_id()?;
            operations.push(nook_core::VaultOperation::SecretCreated {
                secret: nook_core::encrypted_secret_from_armored(
                    &id,
                    secret_type,
                    ciphertext.as_str(),
                ),
            });
        }

        let imported = operations.len();
        if !operations.is_empty() {
            self.append_vault_operations(operations).await?;
        }
        let _ = self.status.tx.send("READY".to_owned());
        tracing::info!(
            scope = "wasm-secrets",
            action = source.action(),
            import_source = source.label(),
            imported,
            skipped_unsupported,
            skipped_duplicates,
            "Password-manager import completed"
        );
        Ok(NookImportResult::new(
            imported,
            skipped_unsupported,
            skipped_duplicates,
        ))
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    pub fn filter_secrets(&self, query: &str) -> Result<Vec<NookSecretRecord>, JsError> {
        let mut records = self.get_records()?;
        records.retain(|record| record.matches_search(query));
        Ok(records)
    }

    #[wasm_bindgen(js_name = querySecretPage)]
    pub fn query_secret_page_js(
        &self,
        query: &str,
        offset: u32,
        limit: u32,
    ) -> Result<NookSecretPage, JsError> {
        Ok(NookSecretPage::from_core(
            self.query_secret_page(query, offset, limit)?,
        )?)
    }

    /// Decrypt one full record only after an explicit reveal or secret-value copy.
    #[wasm_bindgen(js_name = decryptSecret)]
    pub fn decrypt_secret_js(&self, id: &str) -> Result<NookSecretRecord, JsError> {
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let id = nook_core::SecretId::from_vault_record(id);
        let record = nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, &id)?;
        tracing::info!(
            scope = "wasm-secrets",
            action = "decrypt-secret",
            secret_id = %id,
            "secret plaintext exposed on demand"
        );
        Ok(NookSecretRecord::from_record(record))
    }

    #[wasm_bindgen(js_name = currentAuthenticatorCode)]
    pub fn current_authenticator_code(
        &self,
        id: &str,
        unix_seconds: u32,
    ) -> Result<NookTotpCode, JsError> {
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let id = nook_core::SecretId::from_vault_record(id);
        let mut record =
            nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, &id)?;
        let code = if let nook_core::SecretValue::Authenticator(value) = &record.data {
            value.current_code(u64::from(unix_seconds))?
        } else {
            record.zeroize_plaintext();
            return Err(NookError::Database(
                "Requested secret is not an authenticator item.".to_owned(),
            )
            .into());
        };
        record.zeroize_plaintext();
        Ok(NookTotpCode::from_core(code))
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
            .status
            .rx
            .recv_async()
            .await
            .map_err(|e| NookError::Channel(format!("Receive error: {}", e)))?;
        Ok(msg)
    }

    /// Drain all queued status messages without blocking.
    ///
    /// Unlike `next_status`, this never awaits, so it does not hold the
    /// wasm-bindgen borrow across a pending future (which would block every
    /// `&mut self` call like `connect` / `sync_vault_from_storage`).
    #[wasm_bindgen(js_name = drainStatusLog)]
    pub fn drain_status_log(&self) -> Vec<String> {
        let mut messages = Vec::new();
        while let Ok(message) = self.status.rx.try_recv() {
            messages.push(message);
        }
        messages
    }

    /// Check whether this device can decrypt the vault before attempting connect.
    // Add a secret
    pub async fn add_secret(
        &mut self,
        id: String,
        secret_type: String,
        data: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("ADD_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        if !self
            .vault
            .architecture
            .can_create_secret_with_records(&self.stored_records_snapshot())
        {
            return Err(NookError::Database(
                "Sentinel vault is not ready for secret creation.".to_owned(),
            )
            .into());
        }
        let id = nook_core::validate_secret_id(&id)?;
        nook_core::validate_secret_data(&data)?;
        let secret_type = nook_core::SecretType::parse(&secret_type)?;
        let mut typed_value = nook_core::SecretValue::from_yaml_str(secret_type, &data)?;
        typed_value.zeroize_plaintext();

        let armored = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?
            .encrypt_value(&data)?;
        let ciphertext = armored.as_str().to_owned();
        self.vault.meta.secrets.insert(
            id.clone(),
            (
                secret_type,
                nook_core::StoredRecordPayload::from_trusted(ciphertext.clone()),
            ),
        );

        self.append_vault_operations(vec![nook_core::VaultOperation::SecretCreated {
            secret: nook_core::encrypted_secret_from_armored(&id, secret_type, &ciphertext),
        }])
        .await?;
        let _ = self.status.tx.send("READY".to_owned());
        let records = self.get_records()?;
        tracing::info!(
            scope = "wasm-secrets",
            action = "add",
            id = %id,
            secret_type = ?secret_type,
            count = records.len(),
            "secret added"
        );
        Ok(records)
    }

    /// Import supported entries from a plaintext or password-protected encrypted
    /// Bitwarden JSON export in one signed event. Exact values already present in
    /// the active vault are not imported again.
    #[wasm_bindgen(js_name = importBitwardenJson)]
    pub async fn import_bitwarden_json(
        &mut self,
        json: String,
        password: String,
    ) -> Result<NookImportResult, JsError> {
        let json = zeroize::Zeroizing::new(json);
        let password = zeroize::Zeroizing::new(password);
        let plan = nook_core::plan_bitwarden_import_with_password(
            json.as_str(),
            (!password.is_empty()).then_some(password.as_str()),
        )
        .map_err(|error| NookError::Database(error.to_string()))?;
        drop(password);
        drop(json);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::Bitwarden,
        )
        .await
    }

    /// Import supported entries from an unencrypted 1Password 1PUX archive in
    /// one signed event. The archive is parsed in memory and never persisted.
    #[wasm_bindgen(js_name = importOnePasswordPux)]
    pub async fn import_onepassword_pux(
        &mut self,
        archive: Vec<u8>,
    ) -> Result<NookImportResult, JsError> {
        let archive = zeroize::Zeroizing::new(archive);
        let plan = nook_core::plan_onepassword_import(archive.as_slice())
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(archive);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::OnePassword,
        )
        .await
    }

    /// Import passwords and verification codes from an Apple Passwords CSV
    /// export in one signed event. The plaintext CSV is parsed only in memory.
    #[wasm_bindgen(js_name = importApplePasswordsCsv)]
    pub async fn import_apple_passwords_csv(
        &mut self,
        csv: String,
    ) -> Result<NookImportResult, JsError> {
        let csv = zeroize::Zeroizing::new(csv);
        let plan = nook_core::plan_apple_passwords_import(csv.as_str())
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(csv);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::ApplePasswords,
        )
        .await
    }

    /// Import logins from a Chrome-family CSV export in one signed event. The
    /// plaintext CSV is parsed only in memory.
    #[wasm_bindgen(js_name = importChromePasswordsCsv)]
    pub async fn import_chrome_passwords_csv(
        &mut self,
        csv: String,
    ) -> Result<NookImportResult, JsError> {
        let csv = zeroize::Zeroizing::new(csv);
        let plan = nook_core::plan_chrome_passwords_import(csv.as_str())
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(csv);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::ChromePasswords,
        )
        .await
    }

    // Replace a secret (new id + payload, single save)
    pub async fn replace_secret(
        &mut self,
        old_id: String,
        new_id: String,
        secret_type: String,
        data: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("REPLACE_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        if !self
            .vault
            .architecture
            .can_create_secret_with_records(&self.stored_records_snapshot())
        {
            return Err(NookError::Database(
                "Sentinel vault is not ready for secret creation.".to_owned(),
            )
            .into());
        }
        let secret_type = nook_core::SecretType::parse(&secret_type)?;
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        nook_core::replace_encrypted_secret(
            &mut self.vault.meta,
            crypto,
            &nook_core::ReplaceSecretInput {
                old_id: &old_id,
                new_id: &new_id,
                secret_type,
                data_yaml: &data,
            },
        )?;
        let validated_new = nook_core::validate_secret_id(&new_id)?;
        let validated_old = nook_core::validate_secret_id(&old_id)?;
        let ciphertext = self
            .vault
            .meta
            .secrets
            .get(&validated_new)
            .map(|(_, payload)| payload.as_str().to_owned())
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
        let _ = self.status.tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }

    #[wasm_bindgen(js_name = mergeRemoteJoinsFromProvider)]
    pub async fn merge_remote_joins_from_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<crate::NookJoinRequest>, JsError> {
        let restore_local = self.storage.mode == nook_core::StorageMode::Local;
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Ok(self.pending_joins()?)
    }

    #[wasm_bindgen(js_name = flushEventOutboxForProvider)]
    pub async fn flush_event_outbox_for_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        let restore_local = self.storage.mode == nook_core::StorageMode::Local;
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.flush_event_outbox().await?;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = syncEventLogForProvider)]
    pub async fn sync_event_log_for_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        self.flush_event_outbox().await?;
        Ok(())
    }

    #[wasm_bindgen(js_name = exportEventLogRecords)]
    pub async fn export_event_log_records_js(&self) -> Result<JsValue, JsError> {
        let records = self.export_event_log_records().await?;
        serialize_js_objects(&records).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = parseEventLogStorageRecord)]
    pub fn parse_event_log_storage_record_js(
        &self,
        event_id: &str,
        path: &str,
        content: &str,
    ) -> Result<JsValue, JsError> {
        let record = Self::parse_event_log_storage_record(event_id, path, content)?;
        serde_wasm_bindgen::to_value(&record).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = serializeEventLogStorageRecord)]
    pub fn serialize_event_log_storage_record_js(
        &self,
        record: JsValue,
    ) -> Result<String, JsError> {
        let record =
            serde_wasm_bindgen::from_value(record).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Self::serialize_event_log_storage_record(&record)?)
    }

    #[wasm_bindgen(js_name = syncExternalEventLogRecords)]
    pub async fn sync_external_event_log_records_js(
        &mut self,
        records: JsValue,
    ) -> Result<JsValue, JsError> {
        let records =
            serde_wasm_bindgen::from_value(records).map_err(|e| JsError::new(&e.to_string()))?;
        let merged = self.sync_external_event_log_records(records).await?;
        serde_wasm_bindgen::to_value(&merged).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = importExtensionEventLogRecords)]
    pub async fn import_extension_event_log_records_js(
        &mut self,
        expected_store_id: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
        records: JsValue,
    ) -> Result<JsValue, JsError> {
        let records =
            serde_wasm_bindgen::from_value(records).map_err(|e| JsError::new(&e.to_string()))?;
        let status = self
            .import_extension_event_log_records(
                expected_store_id,
                expected_device_id,
                expected_device_public_key,
                expected_device_signing_public_key,
                records,
            )
            .await?;
        serde_wasm_bindgen::to_value(&status).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = syncLocalFolderProvider)]
    pub async fn sync_local_folder_provider_js(
        &mut self,
        handle_id: &str,
    ) -> Result<String, JsError> {
        self.sync_local_folder_provider(handle_id)
            .await
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = eventLogMode)]
    pub fn event_log_mode(&self) -> bool {
        self.event_log.enabled
    }

    #[wasm_bindgen(js_name = listProjectionConflicts)]
    pub async fn list_projection_conflicts(
        &self,
    ) -> Result<Vec<crate::NookReplacementConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        crate::types::replacement_conflicts_to_vec(projection.replacement_conflicts)
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = listProjectionSecurityConflicts)]
    pub async fn list_projection_security_conflicts(
        &self,
    ) -> Result<Vec<crate::NookSecurityConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        crate::types::security_conflicts_to_vec(projection.security_conflicts).map_err(Into::into)
    }

    // Delete a secret
    pub async fn delete_secret(&mut self, id: String) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("DELETE_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        let id = nook_core::validate_secret_id(&id)?;
        self.vault.meta.secrets.remove(&id);
        self.append_vault_operations(vec![nook_core::VaultOperation::SecretDeleted {
            secret_id: id.clone(),
        }])
        .await?;
        let _ = self.status.tx.send("READY".to_owned());
        let records = self.get_records()?;
        tracing::info!(
            scope = "wasm-secrets",
            action = "delete",
            id = %id,
            count = records.len(),
            "secret deleted"
        );
        Ok(records)
    }

    #[wasm_bindgen(js_name = resolveProjectionConflict)]
    pub async fn resolve_projection_conflict(
        &mut self,
        old_secret_id: String,
        chosen_secret_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let old_id = nook_core::validate_secret_id(&old_secret_id)?;
        let chosen_id = nook_core::validate_secret_id(&chosen_secret_id)?;
        let projection = self.load_projection_conflicts().await?;
        let conflict = projection
            .replacement_conflicts
            .get(&old_id)
            .ok_or_else(|| {
                NookError::Database("Secret replacement conflict not found.".to_owned())
            })?;
        if !conflict
            .candidates
            .values()
            .any(|secret_id| secret_id == &chosen_id)
        {
            return Err(NookError::Database(
                "Chosen secret is not part of this replacement conflict.".to_owned(),
            )
            .into());
        }
        let rejected_secret_ids = conflict
            .candidates
            .values()
            .filter(|secret_id| *secret_id != &chosen_id)
            .cloned()
            .collect();
        self.append_vault_operations(vec![nook_core::VaultOperation::SecretConflictResolved {
            old_id,
            chosen_secret_id: chosen_id,
            rejected_secret_ids,
        }])
        .await?;
        Ok(self.get_records()?)
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::*;

    #[derive(Serialize)]
    struct SignedEventBody {
        schema_version: u32,
    }

    #[derive(Serialize)]
    struct SignedEvent {
        #[serde(flatten)]
        body: SignedEventBody,
        signature: String,
    }

    #[derive(Serialize)]
    struct ExportedRecord {
        event_id: String,
        event: SignedEvent,
    }

    fn get(target: &JsValue, field: &str) -> JsValue {
        js_sys::Reflect::get(target, &JsValue::from_str(field)).expect("js field")
    }

    #[wasm_bindgen_test]
    fn event_log_export_serializes_flattened_signed_events_as_plain_objects() {
        let value = serialize_js_objects(&vec![ExportedRecord {
            event_id: "event-1".to_owned(),
            event: SignedEvent {
                body: SignedEventBody { schema_version: 1 },
                signature: "ed25519:test-signature".to_owned(),
            },
        }])
        .expect("serialize event-log records");
        let record = js_sys::Array::from(&value).get(0);
        let event = get(&record, "event");

        assert_eq!(get(&event, "schema_version").as_f64(), Some(1.0));
        assert_eq!(
            get(&event, "signature").as_string().as_deref(),
            Some("ed25519:test-signature"),
        );
    }
}
