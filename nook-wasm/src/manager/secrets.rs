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
        let jsonl = nook_core::SessionJsonl::parse(&self.decrypted_jsonl)?;
        let db = nook_core::Database::from_jsonl(&jsonl)?;
        let filtered = nook_core::filter_secrets(&db.list(), query);
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
            .status_rx
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
        while let Ok(message) = self.status_rx.try_recv() {
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
        let ciphertext = armored.as_str().to_owned();
        self.meta.secrets.insert(
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
        let _ = self.status_tx.send("READY".to_owned());
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
        let _ = self.status_tx.send("REPLACE_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        let secret_type = nook_core::SecretType::parse(&secret_type)?;
        let crypto = self
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let jsonl = nook_core::SessionJsonl::parse(&self.decrypted_jsonl)?;
        let mut db = nook_core::Database::from_jsonl(&jsonl)?;
        nook_core::replace_secret(
            &mut db,
            &mut self.meta,
            crypto,
            &nook_core::ReplaceSecretInput {
                old_id: &old_id,
                new_id: &new_id,
                secret_type,
                data_yaml: &data,
            },
        )?;
        self.decrypted_jsonl = db.to_jsonl()?.into_inner();

        let validated_new = nook_core::validate_secret_id(&new_id)?;
        let validated_old = nook_core::validate_secret_id(&old_id)?;
        let ciphertext = self
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
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }

    #[wasm_bindgen(js_name = pushRemoteVaultYamlSnapshot)]
    pub async fn push_remote_vault_yaml_snapshot_js(&mut self) -> Result<(), JsError> {
        self.push_remote_vault_yaml_snapshot()
            .await
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = pushRemoteVaultYamlSnapshotForProvider)]
    pub async fn push_remote_vault_yaml_snapshot_for_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        let password_entries = self.password_entries.clone();
        let unlock = self.unlock.clone();
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.password_entries = password_entries;
        self.unlock = unlock;
        self.push_remote_vault_yaml_snapshot()
            .await
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = mergeRemoteJoinsFromProvider)]
    pub async fn merge_remote_joins_from_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<crate::NookJoinRequest>, JsError> {
        let restore_local = self.storage_mode == nook_core::StorageMode::Local;
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let _ = self.merge_remote_yaml_joins_from_storage().await?;
        if restore_local {
            self.prepare_storage("local", "", "").await?;
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
        let restore_local = self.storage_mode == nook_core::StorageMode::Local;
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.flush_event_outbox().await?;
        if restore_local {
            self.prepare_storage("local", "", "").await?;
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
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        let _ = self.merge_remote_yaml_joins_from_storage().await?;
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

    #[wasm_bindgen(js_name = listProjectionSecurityConflicts)]
    pub async fn list_projection_security_conflicts(
        &self,
    ) -> Result<Vec<crate::NookSecurityConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        crate::types::security_conflicts_to_vec(projection.security_conflicts).map_err(Into::into)
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
        self.meta.secrets.remove(&id);
        self.append_vault_operations(vec![nook_core::VaultOperation::SecretDeleted {
            secret_id: id.clone(),
        }])
        .await?;
        let _ = self.status_tx.send("READY".to_owned());
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
