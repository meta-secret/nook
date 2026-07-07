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
use crate::storage::indexed_db::{load_from_indexed_db, save_to_indexed_db};
use crate::storage::local_folder::{
    LocalFolderEventWrite, read_local_folder_event_files, write_local_folder_event_files,
};
use nook_core::{
    AppendEventInput, EventId, RemoteEventLogClassification, SigningIdentity, VaultEvent,
    VaultOperation, apply_user_records_to_armored_session, build_signed_event,
    classify_remote_event_log, members_checkpoint_hash_from_roster, project_vault,
    rewrap_vault_meta_for_epoch, stored_vault_to_import_event, union_remote_events_and_heads,
    verify_stored_vault_import,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

fn iso_timestamp() -> String {
    wasm_iso_timestamp()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::manager) struct ExternalEventLogRecord {
    pub event_id: String,
    pub event: VaultEvent,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::manager) struct EventLogStorageRecord {
    pub event_id: String,
    pub path: String,
    pub event: VaultEvent,
}

impl NookVaultManager {
    fn validate_event_record_id(
        expected_event_id: &EventId,
        event: &VaultEvent,
    ) -> Result<(), nook_core::VaultError> {
        let canonical_id = event.id()?;
        if canonical_id != *expected_event_id {
            return Err(nook_core::VaultError::Event(
                nook_core::EventError::EventStoreIdMismatch {
                    expected: canonical_id.as_str().to_owned(),
                    actual: expected_event_id.as_str().to_owned(),
                },
            ));
        }
        Ok(())
    }

    pub(in crate::manager) fn parse_event_log_storage_record(
        event_id: &str,
        path: &str,
        content: &str,
    ) -> Result<EventLogStorageRecord, NookError> {
        let event_id = EventId::parse(event_id)?;
        let event = nook_core::parse_event_storage_bytes(content.as_bytes())?;
        Self::validate_event_record_id(&event_id, &event)?;
        Ok(EventLogStorageRecord {
            event_id: event_id.as_str().to_owned(),
            path: path.to_owned(),
            event,
        })
    }

    pub(in crate::manager) fn serialize_event_log_storage_record(
        record: &EventLogStorageRecord,
    ) -> Result<String, NookError> {
        let event_id = EventId::parse(&record.event_id)?;
        Self::validate_event_record_id(&event_id, &record.event)?;
        let bytes = nook_core::serialize_event_storage_yaml(&record.event)?;
        String::from_utf8(bytes).map_err(|e| {
            NookError::Serialization(format!("Event storage content is not UTF-8: {e}"))
        })
    }

    pub(in crate::manager) async fn ensure_event_log_mode(&mut self) -> Result<bool, NookError> {
        if self.event_log.enabled {
            if !is_event_log_mode().await? {
                set_event_log_mode().await?;
            }
            return Ok(true);
        }
        if is_event_log_mode().await? {
            self.event_log.enabled = true;
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
        if !self.vault.meta.is_empty() {
            let yaml = self.serialize_current_projection_yaml()?;
            self.import_stored_vault_to_event_log(&yaml).await?;
            return Ok(());
        }
        if !self.vault.last_synced_content.trim().is_empty() {
            let yaml = self.vault.last_synced_content.clone();
            self.import_stored_vault_to_event_log(&yaml).await?;
            return Ok(());
        }
        if self.vault.store_id.is_empty() {
            self.vault.store_id = nook_core::generate_store_id()?.to_string();
        }
        self.bootstrap_event_log_genesis().await?;
        Ok(())
    }

    pub(in crate::manager) async fn activate_event_log_mode(&mut self) -> Result<(), NookError> {
        set_event_log_mode().await?;
        self.event_log.enabled = true;
        Ok(())
    }

    pub(in crate::manager) async fn ensure_signing_identity(
        &mut self,
    ) -> Result<SigningIdentity, NookError> {
        if self.event_log.signing_seed.is_empty() {
            if let Some(seed) = load_signing_seed().await? {
                self.event_log.signing_seed = seed;
            } else {
                let (identity, seed) = SigningIdentity::generate()?;
                save_signing_seed(seed.as_str()).await?;
                self.event_log.signing_seed = seed.into_inner();
                return Ok(identity);
            }
        }
        Ok(SigningIdentity::from_seed_hex_stored(
            &self.event_log.signing_seed,
        )?)
    }

    pub(in crate::manager) async fn load_event_heads(&mut self) -> Result<Vec<String>, NookError> {
        if self.event_log.heads.is_empty() && !self.vault.store_id.is_empty() {
            self.event_log.heads = load_heads(&self.vault.store_id).await?;
        }
        Ok(self.event_log.heads.clone())
    }

    pub(in crate::manager) async fn ensure_key_epoch(&mut self) -> Result<String, NookError> {
        if !self.event_log.key_epoch.is_empty() {
            return Ok(self.event_log.key_epoch.clone());
        }
        if let Some(epoch) = load_key_epoch(&self.vault.store_id).await? {
            self.event_log.key_epoch = epoch;
            return Ok(self.event_log.key_epoch.clone());
        }
        let epoch = nook_core::EventId::from_sha256_hex(
            nook_core::sha256_hex(self.vault.store_id.as_bytes()).as_str(),
        )?
        .into_inner();
        self.event_log.key_epoch = epoch;
        if !self.vault.store_id.is_empty() {
            save_key_epoch(&self.vault.store_id, &self.event_log.key_epoch).await?;
        }
        Ok(self.event_log.key_epoch.clone())
    }

    pub(in crate::manager) async fn import_stored_vault_to_event_log(
        &mut self,
        stored_vault: &str,
    ) -> Result<(), NookError> {
        if self.vault.store_id.is_empty() {
            self.vault.store_id = nook_core::generate_store_id()?.to_string();
        }
        let _ = self.status.tx.send("MIGRATION_START".to_owned());
        save_source_backup_if_absent(&self.vault.store_id, stored_vault).await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id()?;
        let ctx = nook_core::VaultHashContext::from(stored_vault);
        let import = stored_vault_to_import_event(
            &ctx,
            &nook_core::StoreId::parse(&self.vault.store_id)?,
            &actor_id,
            signing.signing_key(),
            &nook_core::IsoTimestamp::parse(&iso_timestamp())?,
        )?;
        verify_stored_vault_import(&ctx, &import)?;
        let event_id = import.id()?;
        let bytes = nook_core::serialize_event_storage_yaml(&import)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        save_event_bytes(&self.vault.store_id, event_id.as_str(), &bytes).await?;
        self.event_log.heads = vec![event_id.as_str().to_owned()];
        self.event_log.key_epoch = import.body.key_epoch.as_str().to_owned();
        save_heads(&self.vault.store_id, &self.event_log.heads).await?;
        save_key_epoch(&self.vault.store_id, &self.event_log.key_epoch).await?;
        self.activate_event_log_mode().await?;
        if self.vault.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
            self.apply_event_projection_to_session().await?;
        }
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        let _ = self.status.tx.send("MIGRATION_SUCCESS".to_owned());
        Ok(())
    }

    pub(in crate::manager) async fn event_log_has_events(&self) -> Result<bool, NookError> {
        if self.vault.store_id.is_empty() {
            return Ok(false);
        }
        let store = load_local_event_store(&self.vault.store_id).await?;
        Ok(!store.event_ids().is_empty())
    }

    pub(in crate::manager) async fn append_vault_operations(
        &mut self,
        operations: Vec<VaultOperation>,
    ) -> Result<(), NookError> {
        if self.vault.store_id.is_empty() {
            self.vault.store_id = nook_core::generate_store_id()?.to_string();
        }
        self.activate_event_log_mode().await?;
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id()?;
        let parents = self.load_event_heads().await?;
        let key_epoch = self.ensure_key_epoch().await?;
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
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
        save_event_bytes(&self.vault.store_id, event_id.as_str(), &bytes).await?;
        self.event_log.heads = vec![event_id.as_str().to_owned()];
        save_heads(&self.vault.store_id, &self.event_log.heads).await?;
        if self.vault.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
            self.apply_event_projection_to_session().await?;
        } else {
            for operation in &operations {
                nook_core::apply_vault_meta_operation(
                    &mut self.vault.meta,
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
        let store = load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        let projection = project_vault(&graph, &self.vault.store_id)?;
        let live = projection.live_secrets(&graph);
        let user_records: Vec<nook_core::StoredSecretRecord> = live.into_values().collect();
        self.vault.password_entries = projection.password_entries;
        self.vault.unlock = nook_core::VaultUnlock::Keys;
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        self.vault.database =
            apply_user_records_to_armored_session(user_records, crypto, &mut self.vault.meta)?;
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
        if let Ok(identity) = self.device_identity() {
            let _ = self.maybe_sync_self_into_roster(&identity);
        }
        Ok(())
    }

    pub(in crate::manager) async fn persist_projection_cache(&mut self) -> Result<(), NookError> {
        let records = self.vault.meta.to_stored_records();
        let yaml = nook_core::serialize_stored_yaml_with_unlock_and_name(
            &records,
            &self.vault.unlock,
            &self.vault.password_entries,
            Some(self.vault.store_id.as_str()),
            self.vault.vault_name.as_deref(),
            None,
        )?;
        save_to_indexed_db(yaml.as_str()).await?;
        self.vault.last_synced_content = yaml.into_inner();
        Ok(())
    }

    async fn queue_event_outbox_for_current_provider(
        &mut self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let provider_id = if self.storage.mode == nook_core::StorageMode::Local {
            if self.sync_outbox.provider_id.is_empty() {
                return Ok(());
            }
            self.sync_outbox.provider_id.clone()
        } else {
            self.local_cache_ref()
        };
        queue_outbox_entry(&provider_id, event_id.as_str(), bytes).await?;
        append_outbox_index(&provider_id, event_id.as_str()).await?;
        Ok(())
    }

    fn provider_store_mismatch_error(
        provider_label: &str,
        local_store_id: &str,
        remote_store_id: &str,
    ) -> NookError {
        NookError::Database(format!(
            "{provider_label} already contains another vault (local store_id {local_store_id}, provider store_id {remote_store_id}). Choose which vault to use before syncing."
        ))
    }

    fn provider_multiple_stores_error(provider_label: &str, store_ids: &[String]) -> NookError {
        NookError::Database(format!(
            "{provider_label} contains multiple vault event logs (store_id: {}). Use a dedicated provider path for one vault before syncing.",
            store_ids.join(", ")
        ))
    }

    fn guard_remote_event_log_classification(
        provider_label: &str,
        classification: &RemoteEventLogClassification,
    ) -> Result<(), NookError> {
        match classification {
            RemoteEventLogClassification::Empty
            | RemoteEventLogClassification::SameStore { .. } => Ok(()),
            RemoteEventLogClassification::DifferentStore {
                local_store_id,
                remote_store_id,
            } => Err(Self::provider_store_mismatch_error(
                provider_label,
                local_store_id,
                remote_store_id,
            )),
            RemoteEventLogClassification::MultipleStores { store_ids } => Err(
                Self::provider_multiple_stores_error(provider_label, store_ids),
            ),
        }
    }

    async fn fetch_current_provider_events(
        &self,
        event_ids: impl IntoIterator<Item = EventId>,
    ) -> Result<Vec<(EventId, Vec<u8>)>, NookError> {
        let mut events = Vec::new();
        for event_id in event_ids {
            let bytes = self.fetch_current_provider_event(&event_id).await?;
            events.push((event_id, bytes));
        }
        Ok(events)
    }

    async fn guard_current_provider_writable_for_active_store(
        &self,
        remote_ids: &BTreeSet<EventId>,
    ) -> Result<(), NookError> {
        if self.vault.store_id.trim().is_empty() || remote_ids.is_empty() {
            return Ok(());
        }
        let remote_events = self
            .fetch_current_provider_events(remote_ids.iter().cloned())
            .await?;
        let classification =
            classify_remote_event_log(&remote_events, Some(self.vault.store_id.as_str()))?;
        Self::guard_remote_event_log_classification("Sync provider", &classification)
    }

    pub(in crate::manager) async fn flush_sync_event_outbox(&mut self) -> Result<(), NookError> {
        if self.storage.mode != nook_core::StorageMode::Local {
            return self.flush_event_outbox().await;
        }
        if self.sync_outbox.provider_id.is_empty() {
            return Ok(());
        }
        let mode = self.sync_outbox.storage_mode.to_string();
        let pat = self.sync_outbox.access_token.clone();
        let repo = self.sync_outbox.repo_arg.clone();
        self.prepare_storage(&mode, &pat, &repo).await?;
        self.flush_event_outbox().await?;
        self.prepare_storage("local", "", "").await?;
        Ok(())
    }

    pub(in crate::manager) async fn flush_event_outbox(&mut self) -> Result<(), NookError> {
        if self.storage.mode == nook_core::StorageMode::Local {
            return Ok(());
        }
        let provider_id = self.local_cache_ref();
        let mut remote_ids = self.list_current_provider_event_ids().await?;
        self.guard_current_provider_writable_for_active_store(&remote_ids)
            .await?;
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

        if !self.vault.store_id.is_empty() {
            let local = load_local_event_store(&self.vault.store_id).await?;
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
        if self.vault.store_id.is_empty() {
            let mut discovered_store_ids = BTreeSet::new();
            let mut fetched = Vec::new();
            for (event_id, bytes) in self.fetch_current_provider_events(remote_ids).await? {
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
            self.vault.store_id = discovered_store_ids.into_iter().next().ok_or_else(|| {
                NookError::Database(
                    "Provider event discovery returned no vault store id.".to_owned(),
                )
            })?;
            self.activate_event_log_mode().await?;
            remote_events = fetched
                .into_iter()
                .filter(|(_, _, store_id)| store_id == &self.vault.store_id)
                .map(|(event_id, bytes, _)| (event_id, bytes))
                .collect();
        } else {
            let local_ids: BTreeSet<EventId> = load_local_event_store(&self.vault.store_id)
                .await?
                .event_ids()
                .into_iter()
                .collect();
            let fetched = self.fetch_current_provider_events(remote_ids).await?;
            let classification =
                classify_remote_event_log(&fetched, Some(self.vault.store_id.as_str()))?;
            Self::guard_remote_event_log_classification("Sync provider", &classification)?;
            for (event_id, bytes) in fetched {
                if local_ids.contains(&event_id) {
                    continue;
                }
                if !nook_core::remote_event_belongs_to_store(
                    &event_id,
                    &bytes,
                    &self.vault.store_id,
                )? {
                    continue;
                }
                remote_events.push((event_id, bytes));
            }
        }

        let mut local = load_local_event_store(&self.vault.store_id).await?;
        let heads =
            union_remote_events_and_heads(&mut local, &remote_events, &self.vault.store_id)?;
        for (event_id, bytes) in &remote_events {
            save_event_bytes(&self.vault.store_id, event_id.as_str(), bytes).await?;
        }

        self.event_log.heads = heads.clone();
        save_heads(&self.vault.store_id, &heads).await?;
        let graph = local.load_graph(&self.vault.store_id)?;
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
        if self.vault.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
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
            let event = nook_core::parse_event_storage_bytes(bytes)?;
            records.push(EventLogStorageRecord {
                event_id: event_id.as_str().to_owned(),
                path: event_id.storage_path(),
                event,
            });
        }
        Ok(records)
    }

    pub(in crate::manager) async fn export_event_log_records(
        &self,
    ) -> Result<Vec<EventLogStorageRecord>, NookError> {
        if self.vault.store_id.is_empty() {
            return Ok(Vec::new());
        }
        let store = load_local_event_store(&self.vault.store_id).await?;
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
                Self::validate_event_record_id(&event_id, &record.event)?;
                let bytes = nook_core::serialize_event_storage_yaml(&record.event)?;
                Ok((event_id, bytes))
            })
            .collect::<Result<_, nook_core::VaultError>>()?;

        let mut remote_events = Vec::new();
        if self.vault.store_id.is_empty() {
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
            self.vault.store_id = discovered_store_ids.into_iter().next().ok_or_else(|| {
                NookError::Database(
                    "Backup folder event discovery returned no vault store id.".to_owned(),
                )
            })?;
            self.activate_event_log_mode().await?;
            remote_events = fetched
                .into_iter()
                .filter(|(_, _, store_id)| store_id == &self.vault.store_id)
                .map(|(event_id, bytes, _)| (event_id, bytes))
                .collect();
        } else {
            let classification =
                classify_remote_event_log(&parsed_records, Some(self.vault.store_id.as_str()))?;
            Self::guard_remote_event_log_classification("Backup folder", &classification)?;
            for (event_id, bytes) in parsed_records {
                if !nook_core::remote_event_belongs_to_store(
                    &event_id,
                    &bytes,
                    &self.vault.store_id,
                )? {
                    continue;
                }
                remote_events.push((event_id, bytes));
            }
        }

        if !self.vault.store_id.is_empty() {
            let mut local = load_local_event_store(&self.vault.store_id).await?;
            let heads =
                union_remote_events_and_heads(&mut local, &remote_events, &self.vault.store_id)?;
            for (event_id, bytes) in &remote_events {
                save_event_bytes(&self.vault.store_id, event_id.as_str(), bytes).await?;
            }

            self.event_log.heads = heads.clone();
            save_heads(&self.vault.store_id, &heads).await?;
            let graph = local.load_graph(&self.vault.store_id)?;
            nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
            if self.vault.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok() {
                self.apply_event_projection_to_session().await?;
            }
            self.persist_projection_cache().await?;
        }

        self.export_event_log_records().await
    }

    pub(in crate::manager) async fn sync_local_folder_provider(
        &mut self,
        handle_id: &str,
    ) -> Result<String, NookError> {
        let remote_records = read_local_folder_event_files(handle_id)
            .await?
            .into_iter()
            .map(|file| {
                Self::parse_event_log_storage_record(&file.event_id, &file.path, &file.content).map(
                    |record| ExternalEventLogRecord {
                        event_id: record.event_id,
                        event: record.event,
                    },
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let remote_event_ids = remote_records
            .iter()
            .map(|record| record.event_id.clone())
            .collect::<BTreeSet<_>>();
        let merged = self.sync_external_event_log_records(remote_records).await?;
        let writes = merged
            .iter()
            .filter(|record| !remote_event_ids.contains(&record.event_id))
            .map(|record| {
                Ok(LocalFolderEventWrite {
                    event_id: record.event_id.clone(),
                    content: Self::serialize_event_log_storage_record(record)?,
                })
            })
            .collect::<Result<Vec<_>, NookError>>()?;
        write_local_folder_event_files(handle_id, &writes).await?;
        Ok(load_from_indexed_db().await?.unwrap_or_default())
    }

    async fn list_current_provider_event_ids(&self) -> Result<BTreeSet<EventId>, NookError> {
        let raw_ids = match self.storage.mode {
            nook_core::StorageMode::Github => {
                list_github_event_ids(&self.storage.access_token, &self.storage.remote_ref).await?
            }
            nook_core::StorageMode::GoogleDrive => {
                list_drive_event_ids(&self.storage.access_token).await?
            }
            nook_core::StorageMode::ICloud => {
                list_icloud_event_ids(&self.storage.access_token).await?
            }
            nook_core::StorageMode::Local => Vec::new(),
        };
        raw_ids
            .into_iter()
            .map(|raw| EventId::parse(&raw).map_err(NookError::from))
            .collect()
    }

    async fn fetch_current_provider_event(&self, event_id: &EventId) -> Result<Vec<u8>, NookError> {
        match self.storage.mode {
            nook_core::StorageMode::Github => {
                fetch_github_event(
                    &self.storage.access_token,
                    &self.storage.remote_ref,
                    event_id,
                )
                .await
            }
            nook_core::StorageMode::GoogleDrive => {
                fetch_drive_event(&self.storage.access_token, event_id).await
            }
            nook_core::StorageMode::ICloud => {
                fetch_icloud_event(&self.storage.access_token, event_id).await
            }
            nook_core::StorageMode::Local => Ok(Vec::new()),
        }
    }

    async fn put_current_provider_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        match self.storage.mode {
            nook_core::StorageMode::Github => {
                put_github_event_if_absent(
                    &self.storage.access_token,
                    &self.storage.remote_ref,
                    event_id,
                    bytes,
                )
                .await
            }
            nook_core::StorageMode::GoogleDrive => {
                put_drive_event_if_absent(&self.storage.access_token, event_id, bytes)
                    .await
                    .map(|_| ())
            }
            nook_core::StorageMode::ICloud => {
                put_icloud_event_if_absent(&self.storage.access_token, event_id, bytes).await
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
            password_entries: self.vault.password_entries.clone(),
        }];
        if !self.vault.secrets_key.is_empty() && !self.vault.members_key.is_empty() {
            let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
            let members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
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
            store_id: nook_core::StoreId::parse(&self.vault.store_id)?,
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
        save_event_bytes(&self.vault.store_id, event_id.as_str(), &bytes).await?;
        self.event_log.heads = vec![event_id.as_str().to_owned()];
        save_heads(&self.vault.store_id, &self.event_log.heads).await?;
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
        let before = self.event_log.heads.clone();
        self.sync_events_from_current_provider().await?;
        let changed = self.event_log.heads != before;
        if changed
            && (self.vault.crypto.is_some() || self.ensure_vault_crypto_from_cache().await.is_ok())
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
            &mut self.vault.meta,
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
        let new_epoch = self.event_log.heads.last().cloned().ok_or_else(|| {
            NookError::Database("Security epoch rotation did not produce an event head.".to_owned())
        })?;
        self.event_log.key_epoch = new_epoch.clone();
        save_key_epoch(&self.vault.store_id, &self.event_log.key_epoch).await?;

        let old_secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let old_members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
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
            self.vault.meta.secrets.insert(
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

        let old_secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let old_members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
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
        let new_epoch = self.event_log.heads.last().cloned().ok_or_else(|| {
            NookError::Database("Security epoch rotation did not produce an event head.".to_owned())
        })?;
        self.event_log.key_epoch = new_epoch.clone();
        save_key_epoch(&self.vault.store_id, &self.event_log.key_epoch).await?;

        let members_checkpoint_hash = members_checkpoint_hash_from_roster(
            &records_snapshot,
            &old_members_key,
            &new_keys.members_key,
        )?;
        self.apply_vault_keys(new_keys.secrets_key.as_str(), new_keys.members_key.as_str())?;
        self.rewrap_device_meta_for_epoch(&records_snapshot, &old_members_key, &new_keys)?;
        for payload in &secrets {
            self.vault.meta.secrets.insert(
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
        if self.vault.store_id.is_empty() {
            return Ok(nook_core::VaultProjection::default());
        }
        let store = load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        Ok(project_vault(&graph, &self.vault.store_id)?)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Copy a single-vault provider event log into local storage as its own vault.
    ///
    /// This is the safe recovery path when the active local vault and the provider
    /// have different `store_id`s: preserve the provider's append-only events
    /// locally, then let normal unlock/access checks decide whether this device
    /// can open that vault.
    #[wasm_bindgen(js_name = importProviderEventLogAsLocalVault)]
    pub async fn import_provider_event_log_as_local_vault(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<String, JsError> {
        self.reset_vault_session();
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        if self.vault.store_id.trim().is_empty() {
            return Err(NookError::Database(
                "No vault event log was found at this provider.".to_owned(),
            )
            .into());
        }
        self.persist_projection_cache().await?;
        Ok(self.vault.store_id.clone())
    }

    /// Copy a single-vault local-folder event log into local storage as its own vault.
    #[wasm_bindgen(js_name = importLocalFolderEventLogAsLocalVault)]
    pub async fn import_local_folder_event_log_as_local_vault(
        &mut self,
        handle_id: &str,
    ) -> Result<String, JsError> {
        self.reset_vault_session();
        let remote_records = read_local_folder_event_files(handle_id)
            .await?
            .into_iter()
            .map(|file| {
                Self::parse_event_log_storage_record(&file.event_id, &file.path, &file.content).map(
                    |record| ExternalEventLogRecord {
                        event_id: record.event_id,
                        event: record.event,
                    },
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let _ = self.sync_external_event_log_records(remote_records).await?;
        if self.vault.store_id.trim().is_empty() {
            return Err(NookError::Database(
                "No vault event log was found in this backup folder.".to_owned(),
            )
            .into());
        }
        self.persist_projection_cache().await?;
        Ok(self.vault.store_id.clone())
    }
}
