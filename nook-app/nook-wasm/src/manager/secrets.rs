//! Secret CRUD + small utility methods (search, password / id generation,
//! status-channel poll).

use super::NookVaultManager;
use crate::NookError;
use crate::NookSecretRecord;
use crate::conversion::records_to_vec;
use serde::Serialize;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

fn serialize_js_objects<T: Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
}

#[wasm_bindgen]
impl NookVaultManager {
    pub fn filter_secrets(&self, query: &str) -> Result<Vec<NookSecretRecord>, JsError> {
        let filtered = nook_core::filter_secrets(&self.vault.database.list(), query);
        records_to_vec(filtered).map_err(Into::into)
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
        let typed_value = nook_core::SecretValue::from_yaml_str(secret_type, &data)?;
        self.vault.database.insert(id.clone(), typed_value);

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
        nook_core::replace_secret(
            &mut self.vault.database,
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
        self.vault.database.remove_and_zeroize(&id);
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
