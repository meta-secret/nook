//! Event-log persistence, migration, and provider fan-out.

use super::NookVaultManager;
use crate::NookError;
use crate::conversion::wasm_iso_timestamp;
use crate::storage::drive_events::{
    fetch_drive_event, list_drive_event_ids, put_drive_event_if_absent,
};
use crate::storage::event_db::{
    append_outbox_index, is_event_log_mode, load_heads, load_key_epoch, load_local_event_store,
    load_outbox, load_signing_seed, queue_outbox_entry, remove_outbox_entry, save_event_bytes,
    save_heads, save_key_epoch, save_signing_seed, save_source_backup_if_absent,
    set_event_log_mode,
};
use crate::storage::github_events::{
    fetch_github_event, list_github_event_ids, put_github_event_if_absent,
};
use crate::storage::icloud::{
    fetch_icloud_event, list_icloud_event_ids, put_icloud_event_if_absent,
};
use crate::storage::indexed_db::save_to_indexed_db;
use nook_core::{
    AppendEventInput, EventId, SigningIdentity, VaultOperation,
    apply_user_records_to_armored_session, build_signed_event, members_checkpoint_hash_from_roster,
    project_vault, rewrap_vault_meta_for_epoch, stored_vault_to_import_event,
    union_remote_events_and_heads, verify_stored_vault_import,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

fn iso_timestamp() -> String {
    wasm_iso_timestamp()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::manager) struct ExternalEventLogRecord {
    pub event_id: String,
    pub yaml: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::manager) struct EventLogStorageRecord {
    pub event_id: String,
    pub path: String,
    pub yaml: String,
}

impl NookVaultManager {
    pub(in crate::manager) async fn ensure_event_log_mode(&mut self) -> Result<bool, NookError> {
        if self.event_log_mode {
            if !is_event_log_mode().await? {
                set_event_log_mode().await?;
            }
            return Ok(true);
        }
        if is_event_log_mode().await? {
            self.event_log_mode = true;
            return Ok(true);
        }
        Ok(false)
    }

    /// Activate event-log persistence for this vault session.
    ///
    /// Idempotent when the log already exists. Otherwise imports the current
    /// session projection or bootstraps a genesis event before any write.
    pub(in crate::manager) async fn ensure_event_log_ready(&mut self) -> Result<(), NookError> {
        if self.ensure_event_log_mode().await? && self.event_log_has_events().await? {
            return Ok(());
        }
        if self.event_log_has_events().await? {
            self.activate_event_log_mode().await?;
            return Ok(());
        }
        if !self.meta.is_empty() {
            let yaml = self.serialize_current_projection_yaml()?;
            self.import_stored_vault_to_event_log(&yaml).await?;
            return Ok(());
        }
        if !self.last_synced_content.trim().is_empty() {
            let yaml = self.last_synced_content.clone();
            self.import_stored_vault_to_event_log(&yaml).await?;
            return Ok(());
        }
        if self.store_id.is_empty() {
            self.store_id = nook_core::generate_store_id()?.to_string();
        }
        self.bootstrap_event_log_genesis().await?;
        Ok(())
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
                let (identity, seed) = SigningIdentity::generate()?;
                save_signing_seed(seed.as_str()).await?;
                self.signing_seed = seed.into_inner();
                return Ok(identity);
            }
        }
        Ok(SigningIdentity::from_seed_hex_stored(&self.signing_seed)?)
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
        let epoch = format!(
            "sha256:{}",
            nook_core::sha256_hex(self.store_id.as_bytes()).as_str()
        );
        self.key_epoch = epoch;
        if !self.store_id.is_empty() {
            save_key_epoch(&self.store_id, &self.key_epoch).await?;
        }
        Ok(self.key_epoch.clone())
    }

    pub(in crate::manager) async fn import_stored_vault_to_event_log(
        &mut self,
        stored_vault: &str,
    ) -> Result<(), NookError> {
        if self.store_id.is_empty() {
            self.store_id = nook_core::generate_store_id()?.to_string();
        }
        let _ = self.status_tx.send("MIGRATION_START".to_owned());
        save_source_backup_if_absent(&self.store_id, stored_vault).await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id()?;
        let ctx = nook_core::VaultHashContext::from(stored_vault);
        let import = stored_vault_to_import_event(
            &ctx,
            &nook_core::StoreId::parse(&self.store_id)?,
            &actor_id,
            signing.signing_key(),
            &nook_core::IsoTimestamp::parse(&iso_timestamp())?,
        )?;
        verify_stored_vault_import(&ctx, &import)?;
        let event_id = import.id()?;
        let bytes = nook_core::serialize_event_storage_yaml(&import)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        save_event_bytes(&self.store_id, event_id.as_str(), &bytes).await?;
        self.event_heads = vec![event_id.as_str().to_owned()];
        self.key_epoch = import.body.key_epoch.as_str().to_owned();
        save_heads(&self.store_id, &self.event_heads).await?;
        save_key_epoch(&self.store_id, &self.key_epoch).await?;
        self.activate_event_log_mode().await?;
        if self.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
            self.apply_event_projection_to_session().await?;
        }
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        let _ = self.status_tx.send("MIGRATION_SUCCESS".to_owned());
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
            self.store_id = nook_core::generate_store_id()?.to_string();
        }
        self.activate_event_log_mode().await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id()?;
        let parents = self.load_event_heads().await?;
        let key_epoch = self.ensure_key_epoch().await?;
        let store_id = nook_core::StoreId::parse(&self.store_id)?;
        let key_epoch = nook_core::EventId::parse(&key_epoch)?;
        let created_at = nook_core::IsoTimestamp::parse(&iso_timestamp())?;
        let parents: Vec<EventId> = parents
            .iter()
            .map(|parent| EventId::parse(parent).map_err(NookError::from))
            .collect::<Result<_, _>>()?;
        let (event, bytes) = build_signed_event(AppendEventInput {
            store_id: &store_id,
            actor_id: &actor_id,
            signing_identity: &signing,
            parents,
            key_epoch: &key_epoch,
            created_at: &created_at,
            operations: operations.clone(),
        })?;
        let event_id = event.id()?;
        save_event_bytes(&self.store_id, event_id.as_str(), &bytes).await?;
        self.event_heads = vec![event_id.as_str().to_owned()];
        save_heads(&self.store_id, &self.event_heads).await?;
        if self.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
            self.apply_event_projection_to_session().await?;
        } else {
            for operation in &operations {
                nook_core::apply_vault_meta_operation(
                    &mut self.meta,
                    operation,
                    created_at.as_str(),
                )?;
            }
        }
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        self.persist_projection_cache().await?;
        Ok(())
    }

    pub(in crate::manager) async fn apply_event_projection_to_session(
        &mut self,
    ) -> Result<(), NookError> {
        self.ensure_vault_crypto_from_cache().await?;
        let store = load_local_event_store(&self.store_id).await?;
        let graph = store.load_graph(&self.store_id)?;
        let projection = project_vault(&graph, &self.store_id)?;
        let live = projection.live_secrets(&graph);
        let user_records: Vec<nook_core::StoredSecretRecord> = live.into_values().collect();
        self.password_entries = projection.password_entries;
        self.unlock = nook_core::VaultUnlock::Keys;
        let crypto = self
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        self.decrypted_jsonl =
            apply_user_records_to_armored_session(user_records, crypto, &mut self.meta)?
                .into_inner();
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.meta)?;
        if let Ok(identity) = self.device_identity() {
            let _ = self.maybe_sync_self_into_roster(&identity);
        }
        Ok(())
    }

    pub(in crate::manager) async fn persist_projection_cache(&mut self) -> Result<(), NookError> {
        let records = self.meta.to_stored_records();
        let yaml = nook_core::serialize_stored_yaml_with_unlock_and_name(
            &records,
            &self.unlock,
            &self.password_entries,
            Some(self.store_id.as_str()),
            self.vault_name.as_deref(),
            None,
        )?;
        save_to_indexed_db(yaml.as_str()).await?;
        self.last_synced_content = yaml.into_inner();
        Ok(())
    }

    async fn queue_event_outbox_for_current_provider(
        &mut self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let provider_id = if self.storage_mode == nook_core::StorageMode::Local {
            if self.sync_outbox_provider_id.is_empty() {
                return Ok(());
            }
            self.sync_outbox_provider_id.clone()
        } else {
            self.local_cache_ref()
        };
        queue_outbox_entry(&provider_id, event_id.as_str(), bytes).await?;
        append_outbox_index(&provider_id, event_id.as_str()).await?;
        Ok(())
    }

    pub(in crate::manager) async fn flush_sync_event_outbox(&mut self) -> Result<(), NookError> {
        if self.storage_mode != nook_core::StorageMode::Local {
            return self.flush_event_outbox().await;
        }
        if self.sync_outbox_provider_id.is_empty() {
            return Ok(());
        }
        let mode = self.sync_outbox_storage_mode.to_string();
        let pat = self.sync_outbox_pat.clone();
        let repo = self.sync_outbox_repo_arg.clone();
        self.prepare_storage(&mode, &pat, &repo).await?;
        self.flush_event_outbox().await?;
        self.prepare_storage("local", "", "").await?;
        Ok(())
    }

    pub(in crate::manager) async fn flush_event_outbox(&mut self) -> Result<(), NookError> {
        if self.storage_mode == nook_core::StorageMode::Local {
            return Ok(());
        }
        let provider_id = self.local_cache_ref();
        let mut remote_ids = self.list_current_provider_event_ids().await?;
        let pending = load_outbox(&provider_id).await?;
        for (raw_id, bytes) in pending {
            let event_id = EventId::parse(&raw_id)?;
            if !remote_ids.contains(&event_id) {
                self.put_current_provider_event_if_absent(&event_id, &bytes)
                    .await?;
                remote_ids.insert(event_id.clone());
            }
            remove_outbox_entry(&provider_id, &raw_id).await?;
        }

        if !self.store_id.is_empty() {
            let local = load_local_event_store(&self.store_id).await?;
            for event_id in local.event_ids() {
                if remote_ids.contains(&event_id) {
                    continue;
                }
                if let Some(bytes) = local.get_bytes(&event_id) {
                    self.put_current_provider_event_if_absent(&event_id, bytes)
                        .await?;
                    remote_ids.insert(event_id);
                }
            }
        }
        Ok(())
    }

    pub(in crate::manager) async fn sync_events_from_current_provider(
        &mut self,
    ) -> Result<(), NookError> {
        let remote_ids = self.list_current_provider_event_ids().await?;

        let mut remote_events = Vec::new();
        if self.store_id.is_empty() {
            let mut discovered_store_ids = BTreeSet::new();
            let mut fetched = Vec::new();
            for event_id in remote_ids {
                let bytes = self.fetch_current_provider_event(&event_id).await?;
                let store_id = nook_core::remote_event_store_id(&event_id, &bytes)?;
                let store_id = store_id.as_str().to_owned();
                discovered_store_ids.insert(store_id.clone());
                fetched.push((event_id, bytes, store_id));
            }
            if discovered_store_ids.is_empty() {
                return Ok(());
            }
            if discovered_store_ids.len() > 1 {
                return Err(NookError::Database(
                    "Multiple vault event logs found at this provider. Use a dedicated repo or path for one vault.".to_owned(),
                ));
            }
            self.store_id = discovered_store_ids.into_iter().next().ok_or_else(|| {
                NookError::Database(
                    "Provider event discovery returned no vault store id.".to_owned(),
                )
            })?;
            self.activate_event_log_mode().await?;
            remote_events = fetched
                .into_iter()
                .filter(|(_, _, store_id)| store_id == &self.store_id)
                .map(|(event_id, bytes, _)| (event_id, bytes))
                .collect();
        } else {
            for event_id in remote_ids {
                let bytes = self.fetch_current_provider_event(&event_id).await?;
                if !nook_core::remote_event_belongs_to_store(&event_id, &bytes, &self.store_id)? {
                    continue;
                }
                remote_events.push((event_id, bytes));
            }
        }

        let mut local = load_local_event_store(&self.store_id).await?;
        let heads = union_remote_events_and_heads(&mut local, &remote_events, &self.store_id)?;
        for (event_id, bytes) in &remote_events {
            save_event_bytes(&self.store_id, event_id.as_str(), bytes).await?;
        }

        self.event_heads = heads.clone();
        save_heads(&self.store_id, &heads).await?;
        let graph = local.load_graph(&self.store_id)?;
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.meta)?;
        if self.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
            self.apply_event_projection_to_session().await?;
        }
        self.persist_projection_cache().await?;
        Ok(())
    }

    fn export_event_records_from_store(
        store: &nook_core::LocalEventStore,
    ) -> Result<Vec<EventLogStorageRecord>, NookError> {
        let mut records = Vec::new();
        for event_id in store.event_ids() {
            let bytes = store.get_bytes(&event_id).ok_or_else(|| {
                NookError::Database(format!("Event {} missing from local store.", event_id))
            })?;
            let yaml = String::from_utf8(bytes.to_vec())
                .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))?;
            records.push(EventLogStorageRecord {
                event_id: event_id.as_str().to_owned(),
                path: event_id.storage_path(),
                yaml,
            });
        }
        Ok(records)
    }

    pub(in crate::manager) async fn export_event_log_records(
        &self,
    ) -> Result<Vec<EventLogStorageRecord>, NookError> {
        if self.store_id.is_empty() {
            return Ok(Vec::new());
        }
        let store = load_local_event_store(&self.store_id).await?;
        Self::export_event_records_from_store(&store)
    }

    pub(in crate::manager) async fn sync_external_event_log_records(
        &mut self,
        records: Vec<ExternalEventLogRecord>,
    ) -> Result<Vec<EventLogStorageRecord>, NookError> {
        let parsed_records: Vec<(EventId, Vec<u8>)> = records
            .into_iter()
            .map(|record| {
                let event_id = EventId::parse(&record.event_id)?;
                Ok((event_id, record.yaml.into_bytes()))
            })
            .collect::<Result<_, nook_core::VaultError>>()?;

        let mut remote_events = Vec::new();
        if self.store_id.is_empty() {
            let mut discovered_store_ids = BTreeSet::new();
            let mut fetched = Vec::new();
            for (event_id, bytes) in parsed_records {
                let store_id = nook_core::remote_event_store_id(&event_id, &bytes)?;
                let store_id = store_id.as_str().to_owned();
                discovered_store_ids.insert(store_id.clone());
                fetched.push((event_id, bytes, store_id));
            }
            if discovered_store_ids.is_empty() {
                return self.export_event_log_records().await;
            }
            if discovered_store_ids.len() > 1 {
                return Err(NookError::Database(
                    "Multiple vault event logs found in this backup folder. Use a dedicated folder for one vault."
                        .to_owned(),
                ));
            }
            self.store_id = discovered_store_ids.into_iter().next().ok_or_else(|| {
                NookError::Database(
                    "Backup folder event discovery returned no vault store id.".to_owned(),
                )
            })?;
            self.activate_event_log_mode().await?;
            remote_events = fetched
                .into_iter()
                .filter(|(_, _, store_id)| store_id == &self.store_id)
                .map(|(event_id, bytes, _)| (event_id, bytes))
                .collect();
        } else {
            for (event_id, bytes) in parsed_records {
                if !nook_core::remote_event_belongs_to_store(&event_id, &bytes, &self.store_id)? {
                    continue;
                }
                remote_events.push((event_id, bytes));
            }
        }

        if !self.store_id.is_empty() {
            let mut local = load_local_event_store(&self.store_id).await?;
            let heads = union_remote_events_and_heads(&mut local, &remote_events, &self.store_id)?;
            for (event_id, bytes) in &remote_events {
                save_event_bytes(&self.store_id, event_id.as_str(), bytes).await?;
            }

            self.event_heads = heads.clone();
            save_heads(&self.store_id, &heads).await?;
            let graph = local.load_graph(&self.store_id)?;
            nook_core::materialize_vault_meta_from_graph(&graph, &mut self.meta)?;
            if self.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
                self.apply_event_projection_to_session().await?;
            }
            self.persist_projection_cache().await?;
        }

        self.export_event_log_records().await
    }

    async fn list_current_provider_event_ids(&self) -> Result<BTreeSet<EventId>, NookError> {
        let raw_ids = match self.storage_mode {
            nook_core::StorageMode::Github => {
                list_github_event_ids(&self.github_pat, &self.github_repo).await?
            }
            nook_core::StorageMode::GoogleDrive => list_drive_event_ids(&self.github_pat).await?,
            nook_core::StorageMode::ICloud => list_icloud_event_ids(&self.github_pat).await?,
            nook_core::StorageMode::Local => Vec::new(),
        };
        raw_ids
            .into_iter()
            .map(|raw| EventId::parse(&raw).map_err(NookError::from))
            .collect()
    }

    async fn fetch_current_provider_event(&self, event_id: &EventId) -> Result<Vec<u8>, NookError> {
        match self.storage_mode {
            nook_core::StorageMode::Github => {
                fetch_github_event(&self.github_pat, &self.github_repo, event_id).await
            }
            nook_core::StorageMode::GoogleDrive => {
                fetch_drive_event(&self.github_pat, event_id).await
            }
            nook_core::StorageMode::ICloud => fetch_icloud_event(&self.github_pat, event_id).await,
            nook_core::StorageMode::Local => Ok(Vec::new()),
        }
    }

    async fn put_current_provider_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        match self.storage_mode {
            nook_core::StorageMode::Github => {
                put_github_event_if_absent(&self.github_pat, &self.github_repo, event_id, bytes)
                    .await
            }
            nook_core::StorageMode::GoogleDrive => {
                put_drive_event_if_absent(&self.github_pat, event_id, bytes)
                    .await
                    .map(|_| ())
            }
            nook_core::StorageMode::ICloud => {
                put_icloud_event_if_absent(&self.github_pat, event_id, bytes).await
            }
            nook_core::StorageMode::Local => Ok(()),
        }
    }

    pub(in crate::manager) async fn bootstrap_event_log_genesis(
        &mut self,
    ) -> Result<(), NookError> {
        self.activate_event_log_mode().await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id()?;
        let key_epoch = self.ensure_key_epoch().await?;
        let identity = self.device_identity()?;
        let mut operations = vec![VaultOperation::VaultImported {
            source_content_hash: nook_core::Sha256Hex::from_trusted("0".repeat(64)),
            secrets: vec![],
            password_entries: self.password_entries.clone(),
        }];
        if !self.secrets_key.is_empty() && !self.members_key.is_empty() {
            let secrets_key = nook_core::SymmetricKey::parse(&self.secrets_key)?;
            let members_key = nook_core::SymmetricKey::parse(&self.members_key)?;
            let auth_record =
                nook_core::genesis_auth_record(&identity, &secrets_key, &members_key)?;
            let envelopes = nook_core::parse_auth_envelopes(auth_record.value.as_str())?;
            operations.push(VaultOperation::JoinApproved {
                device_id: identity.device_id().clone(),
                encryption_public_key: identity.public_key(),
                signing_public_key: nook_core::DeviceSigningPublicKey::from_trusted(hex::encode(
                    signing.signing_key().verifying_key().as_bytes(),
                )),
                label: nook_core::MemberLabel::from_trusted("genesis".to_owned()),
                secrets_key_ciphertext: envelopes.secrets_key,
                members_key_ciphertext: envelopes.members_key,
            });
        }
        let body = nook_core::VaultEventBody {
            schema_version: nook_core::VaultEventSchemaVersion::CURRENT,
            store_id: nook_core::StoreId::parse(&self.store_id)?,
            actor_id,
            actor_signing_public_key: Some(nook_core::DeviceSigningPublicKey::from_trusted(
                hex::encode(signing.signing_key().verifying_key().as_bytes()),
            )),
            parents: Vec::new(),
            created_at: nook_core::IsoTimestamp::parse(&iso_timestamp())?,
            key_epoch: EventId::parse(&key_epoch)?,
            operations,
        };
        let import = nook_core::VaultEvent::sign(body, signing.signing_key())?;
        let event_id = import.id()?;
        let bytes = nook_core::serialize_event_storage_yaml(&import)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        save_event_bytes(&self.store_id, event_id.as_str(), &bytes).await?;
        self.event_heads = vec![event_id.as_str().to_owned()];
        save_heads(&self.store_id, &self.event_heads).await?;
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        Ok(())
    }

    pub(in crate::manager) async fn persist_vault_change(
        &mut self,
        operations: Vec<VaultOperation>,
    ) -> Result<(), NookError> {
        self.ensure_event_log_ready().await?;
        if operations.is_empty() {
            self.persist_projection_cache().await?;
            self.flush_sync_event_outbox().await?;
        } else {
            self.append_vault_operations(operations).await?;
        }
        Ok(())
    }

    pub(in crate::manager) async fn sync_event_log_from_storage(
        &mut self,
    ) -> Result<bool, NookError> {
        if !self.ensure_event_log_mode().await? {
            return Ok(false);
        }
        let before = self.event_heads.clone();
        self.sync_events_from_current_provider().await?;
        let changed = self.event_heads != before;
        if changed && (self.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok())
        {
            self.apply_event_projection_to_session().await?;
        }
        Ok(changed)
    }

    fn rewrap_device_meta_for_epoch(
        &mut self,
        records_snapshot: &[nook_core::StoredSecretRecord],
        old_members_key: &nook_core::SymmetricKey,
        new_keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        let identity = self.device_identity()?;
        rewrap_vault_meta_for_epoch(
            &mut self.meta,
            &identity,
            records_snapshot,
            old_members_key,
            new_keys,
        )?;
        Ok(())
    }

    pub(in crate::manager) async fn rotate_security_epoch(
        &mut self,
        trigger: VaultOperation,
    ) -> Result<(), NookError> {
        self.activate_event_log_mode().await?;
        self.append_vault_operations(vec![trigger]).await?;
        let new_epoch = self.event_heads.last().cloned().ok_or_else(|| {
            NookError::Database("Security epoch rotation did not produce an event head.".to_owned())
        })?;
        self.key_epoch = new_epoch.clone();
        save_key_epoch(&self.store_id, &self.key_epoch).await?;

        let old_secrets_key = nook_core::SymmetricKey::parse(&self.secrets_key)?;
        let old_members_key = nook_core::SymmetricKey::parse(&self.members_key)?;
        let records_snapshot = self.stored_records_snapshot();
        let user_records: Vec<nook_core::StoredSecretRecord> = records_snapshot
            .iter()
            .filter(|record| !nook_core::is_vault_meta_record(record))
            .cloned()
            .collect();
        let (new_keys, secrets) =
            nook_core::rotate_vault_keys_with_secrets(&user_records, &old_secrets_key)?;
        let members_checkpoint_hash = members_checkpoint_hash_from_roster(
            &records_snapshot,
            &old_members_key,
            &new_keys.members_key,
        )?;
        self.apply_vault_keys(new_keys.secrets_key.as_str(), new_keys.members_key.as_str())?;
        self.rewrap_device_meta_for_epoch(&records_snapshot, &old_members_key, &new_keys)?;
        for payload in &secrets {
            self.meta.secrets.insert(
                payload.id.clone(),
                (
                    payload.secret_type,
                    nook_core::StoredRecordPayload::from_trusted(
                        payload.ciphertext.as_str().to_owned(),
                    ),
                ),
            );
        }
        self.append_vault_operations(vec![VaultOperation::EpochCheckpoint {
            secrets,
            members_checkpoint_hash,
        }])
        .await?;
        Ok(())
    }

    pub(in crate::manager) async fn rotate_password_security_epoch(
        &mut self,
        entry_id: nook_core::PasswordEntryId,
        password: &str,
        work_factor: u8,
    ) -> Result<nook_core::PasswordEnvelope, NookError> {
        self.activate_event_log_mode().await?;

        let old_secrets_key = nook_core::SymmetricKey::parse(&self.secrets_key)?;
        let old_members_key = nook_core::SymmetricKey::parse(&self.members_key)?;
        let records_snapshot = self.stored_records_snapshot();
        let user_records: Vec<nook_core::StoredSecretRecord> = records_snapshot
            .iter()
            .filter(|record| !nook_core::is_vault_meta_record(record))
            .cloned()
            .collect();
        let (new_keys, secrets) =
            nook_core::rotate_vault_keys_with_secrets(&user_records, &old_secrets_key)?;
        let envelope =
            nook_core::attach_password_envelope_with_work_factor(&new_keys, password, work_factor)?;

        self.append_vault_operations(vec![VaultOperation::PasswordRotated {
            entry_id,
            envelope: envelope.clone(),
        }])
        .await?;
        let new_epoch = self.event_heads.last().cloned().ok_or_else(|| {
            NookError::Database("Security epoch rotation did not produce an event head.".to_owned())
        })?;
        self.key_epoch = new_epoch.clone();
        save_key_epoch(&self.store_id, &self.key_epoch).await?;

        let members_checkpoint_hash = members_checkpoint_hash_from_roster(
            &records_snapshot,
            &old_members_key,
            &new_keys.members_key,
        )?;
        self.apply_vault_keys(new_keys.secrets_key.as_str(), new_keys.members_key.as_str())?;
        self.rewrap_device_meta_for_epoch(&records_snapshot, &old_members_key, &new_keys)?;
        for payload in &secrets {
            self.meta.secrets.insert(
                payload.id.clone(),
                (
                    payload.secret_type,
                    nook_core::StoredRecordPayload::from_trusted(
                        payload.ciphertext.as_str().to_owned(),
                    ),
                ),
            );
        }
        self.append_vault_operations(vec![VaultOperation::EpochCheckpoint {
            secrets,
            members_checkpoint_hash,
        }])
        .await?;
        Ok(envelope)
    }

    pub(in crate::manager) async fn load_projection_conflicts(
        &self,
    ) -> Result<nook_core::VaultProjection, NookError> {
        if self.store_id.is_empty() {
            return Ok(nook_core::VaultProjection::default());
        }
        let store = load_local_event_store(&self.store_id).await?;
        let graph = store.load_graph(&self.store_id)?;
        Ok(project_vault(&graph, &self.store_id)?)
    }
}
