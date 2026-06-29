//! Event-log persistence, migration, and provider fan-out.

use super::NookVaultManager;
use crate::NookError;
use crate::storage::drive_events::{list_drive_event_ids, put_drive_event_if_absent};
use crate::storage::event_db::{
    append_outbox_index, is_event_log_mode, load_heads, load_key_epoch, load_local_event_store,
    load_outbox, load_signing_seed, queue_outbox_entry, remove_outbox_entry, save_event_bytes,
    save_heads, save_key_epoch, save_legacy_backup, save_signing_seed, set_event_log_mode,
};
use crate::storage::github_events::{
    fetch_github_event, list_github_event_ids, put_github_event_if_absent,
};
use crate::storage::indexed_db::save_to_indexed_db;
use nook_core::{
    AppendEventInput, EventId, SigningIdentity, VaultOperation, build_signed_event,
    legacy_vault_to_import_event, project_vault, union_remote_events,
};

fn iso_timestamp() -> String {
    let ms = js_sys::Date::now() as i64;
    let secs = ms / 1000;
    format!("{secs}") // audit-only; sufficient for v1
}

impl NookVaultManager {
    pub(in crate::manager) async fn ensure_event_log_mode(&mut self) -> Result<bool, NookError> {
        if is_event_log_mode().await? {
            self.event_log_mode = true;
            return Ok(true);
        }
        Ok(false)
    }

    pub(in crate::manager) async fn activate_event_log_mode(&mut self) -> Result<(), NookError> {
        set_event_log_mode().await?;
        self.event_log_mode = true;
        Ok(())
    }

    pub(in crate::manager) async fn ensure_signing_identity(
        &mut self,
    ) -> Result<SigningIdentity, NookError> {
        if self.signing_seed.is_empty() {
            if let Some(seed) = load_signing_seed().await? {
                self.signing_seed = seed;
            } else {
                let (identity, seed) =
                    SigningIdentity::generate().map_err(NookError::Encryption)?;
                save_signing_seed(&seed).await?;
                self.signing_seed = seed;
                return Ok(identity);
            }
        }
        SigningIdentity::from_seed_hex_stored(&self.signing_seed).map_err(NookError::Encryption)
    }

    pub(in crate::manager) async fn load_event_heads(&mut self) -> Result<Vec<String>, NookError> {
        if self.event_heads.is_empty() && !self.store_id.is_empty() {
            self.event_heads = load_heads(&self.store_id).await?;
        }
        Ok(self.event_heads.clone())
    }

    pub(in crate::manager) async fn ensure_key_epoch(&mut self) -> Result<String, NookError> {
        if !self.key_epoch.is_empty() {
            return Ok(self.key_epoch.clone());
        }
        if let Some(epoch) = load_key_epoch(&self.store_id).await? {
            self.key_epoch = epoch;
            return Ok(self.key_epoch.clone());
        }
        let epoch = format!("sha256:{}", nook_core::sha256_hex(self.store_id.as_bytes()));
        self.key_epoch = epoch;
        if !self.store_id.is_empty() {
            save_key_epoch(&self.store_id, &self.key_epoch).await?;
        }
        Ok(self.key_epoch.clone())
    }

    pub(in crate::manager) async fn migrate_legacy_yaml_to_event_log(
        &mut self,
        legacy_yaml: &str,
    ) -> Result<(), NookError> {
        if self.store_id.is_empty() {
            self.store_id = nook_core::generate_store_id().map_err(NookError::Database)?;
        }
        save_legacy_backup(&self.store_id, legacy_yaml).await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id().map_err(NookError::Encryption)?;
        let import = legacy_vault_to_import_event(
            legacy_yaml,
            &self.store_id,
            &actor_id,
            signing.signing_key(),
            &iso_timestamp(),
        )
        .map_err(NookError::Encryption)?;
        let event_id = import.id().map_err(NookError::Encryption)?;
        let bytes =
            serde_json::to_vec(&import).map_err(|e| NookError::Serialization(e.to_string()))?;
        save_event_bytes(&self.store_id, event_id.as_str(), &bytes).await?;
        self.event_heads = vec![event_id.as_str().to_owned()];
        self.key_epoch = import.body.key_epoch.clone();
        save_heads(&self.store_id, &self.event_heads).await?;
        save_key_epoch(&self.store_id, &self.key_epoch).await?;
        self.activate_event_log_mode().await?;
        self.apply_event_projection_to_session().await?;
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        Ok(())
    }

    pub(in crate::manager) async fn event_log_has_events(&self) -> Result<bool, NookError> {
        if self.store_id.is_empty() {
            return Ok(false);
        }
        let store = load_local_event_store(&self.store_id).await?;
        Ok(!store.event_ids().is_empty())
    }

    pub(in crate::manager) async fn append_vault_operations(
        &mut self,
        operations: Vec<VaultOperation>,
    ) -> Result<(), NookError> {
        if self.store_id.is_empty() {
            self.store_id = nook_core::generate_store_id().map_err(NookError::Database)?;
        }
        self.activate_event_log_mode().await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id().map_err(NookError::Encryption)?;
        let parents = self.load_event_heads().await?;
        let key_epoch = self.ensure_key_epoch().await?;
        let (event, bytes) = build_signed_event(AppendEventInput {
            store_id: &self.store_id,
            actor_id: &actor_id,
            signing_identity: &signing,
            parents,
            key_epoch: &key_epoch,
            created_at: &iso_timestamp(),
            operations,
        })
        .map_err(NookError::Encryption)?;
        let event_id = event.id().map_err(NookError::Encryption)?;
        save_event_bytes(&self.store_id, event_id.as_str(), &bytes).await?;
        self.event_heads = vec![event_id.as_str().to_owned()];
        save_heads(&self.store_id, &self.event_heads).await?;
        self.apply_event_projection_to_session().await?;
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        self.persist_projection_cache().await?;
        Ok(())
    }

    pub(in crate::manager) async fn apply_event_projection_to_session(
        &mut self,
    ) -> Result<(), NookError> {
        let store = load_local_event_store(&self.store_id).await?;
        let graph = store
            .load_graph(&self.store_id)
            .map_err(NookError::Database)?;
        let projection = project_vault(&graph, &self.store_id).map_err(NookError::Database)?;
        let live = projection.live_secrets(&graph);
        let crypto = self
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let user_records: Vec<nook_core::StoredSecretRecord> = live.into_values().collect();
        let db = nook_core::Database::from_stored_records_with_crypto(&user_records, crypto)
            .map_err(NookError::Decryption)?;
        self.decrypted_jsonl = db.to_jsonl().map_err(NookError::Database)?;
        self.stored_armored.retain(|key, value| {
            nook_core::is_vault_meta_record(&nook_core::StoredSecretRecord {
                key: key.clone(),
                secret_type: None,
                value: value.clone(),
            })
        });
        self.secret_types
            .retain(|key, _| self.stored_armored.contains_key(key));
        for record in user_records {
            self.stored_armored.insert(record.key.clone(), record.value);
            if let Some(secret_type) = record.secret_type {
                self.secret_types.insert(record.key, secret_type);
            }
        }
        Ok(())
    }

    pub(in crate::manager) async fn persist_projection_cache(&mut self) -> Result<(), NookError> {
        let records = nook_core::Database::stored_records_from_armored(
            &self.stored_armored,
            &self.secret_types,
        );
        let yaml = nook_core::serialize_stored_yaml_with_unlock(
            &records,
            &self.unlock,
            &self.password_entries,
            Some(self.store_id.as_str()),
            None,
        )
        .map_err(NookError::Encryption)?;
        save_to_indexed_db(&yaml).await?;
        self.last_synced_content = yaml;
        Ok(())
    }

    async fn queue_event_outbox_for_current_provider(
        &mut self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        if self.storage_mode == nook_core::StorageMode::Local {
            return Ok(());
        }
        let provider_id = self.local_cache_ref();
        queue_outbox_entry(&provider_id, event_id.as_str(), bytes).await?;
        append_outbox_index(&provider_id, event_id.as_str()).await?;
        Ok(())
    }

    pub(in crate::manager) async fn flush_event_outbox(&mut self) -> Result<(), NookError> {
        if self.storage_mode == nook_core::StorageMode::Local {
            return Ok(());
        }
        let provider_id = self.local_cache_ref();
        let pending = load_outbox(&provider_id).await?;
        for (raw_id, bytes) in pending {
            let event_id = EventId::parse(&raw_id).map_err(NookError::Database)?;
            match self.storage_mode {
                nook_core::StorageMode::Github => {
                    put_github_event_if_absent(
                        &self.github_pat,
                        &self.github_repo,
                        &event_id,
                        &bytes,
                    )
                    .await?;
                }
                nook_core::StorageMode::GoogleDrive => {
                    put_drive_event_if_absent(&self.github_pat, &event_id, &bytes).await?;
                }
                nook_core::StorageMode::Local | nook_core::StorageMode::ICloud => {}
            }
            remove_outbox_entry(&provider_id, &raw_id).await?;
        }
        Ok(())
    }

    pub(in crate::manager) async fn sync_events_from_current_provider(
        &mut self,
    ) -> Result<(), NookError> {
        if self.store_id.is_empty() {
            return Ok(());
        }
        let remote_ids = match self.storage_mode {
            nook_core::StorageMode::Github => {
                list_github_event_ids(&self.github_pat, &self.github_repo).await?
            }
            nook_core::StorageMode::GoogleDrive => {
                list_drive_event_ids(&self.github_pat, &format!("{}.event", self.store_id)).await?
            }
            _ => Vec::new(),
        };

        let mut remote_events = Vec::new();
        for raw_id in remote_ids {
            let event_id = EventId::parse(&raw_id).map_err(NookError::Database)?;
            let bytes = match self.storage_mode {
                nook_core::StorageMode::Github => {
                    fetch_github_event(&self.github_pat, &self.github_repo, &event_id).await?
                }
                _ => continue,
            };
            remote_events.push((event_id, bytes));
        }

        let mut local = load_local_event_store(&self.store_id).await?;
        union_remote_events(&mut local, &remote_events, &self.store_id)
            .map_err(NookError::Database)?;
        for (event_id, bytes) in &remote_events {
            save_event_bytes(&self.store_id, event_id.as_str(), bytes).await?;
        }

        let graph = local
            .load_graph(&self.store_id)
            .map_err(NookError::Database)?;
        let heads: Vec<String> = graph
            .heads()
            .into_iter()
            .map(|id| id.as_str().to_owned())
            .collect();
        self.event_heads = heads.clone();
        save_heads(&self.store_id, &heads).await?;
        self.apply_event_projection_to_session().await?;
        Ok(())
    }

    pub(in crate::manager) async fn bootstrap_event_log_genesis(
        &mut self,
    ) -> Result<(), NookError> {
        self.activate_event_log_mode().await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id().map_err(NookError::Encryption)?;
        let key_epoch = self.ensure_key_epoch().await?;
        let import = nook_core::build_genesis_import_event(
            &self.store_id,
            &actor_id,
            &EventId::parse(&key_epoch).map_err(NookError::Database)?,
            "genesis",
            vec![],
            &iso_timestamp(),
            signing.signing_key(),
        )
        .map_err(NookError::Encryption)?;
        let event_id = import.id().map_err(NookError::Encryption)?;
        let bytes =
            serde_json::to_vec(&import).map_err(|e| NookError::Serialization(e.to_string()))?;
        save_event_bytes(&self.store_id, event_id.as_str(), &bytes).await?;
        self.event_heads = vec![event_id.as_str().to_owned()];
        save_heads(&self.store_id, &self.event_heads).await?;
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        Ok(())
    }
}
