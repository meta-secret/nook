use std::collections::BTreeSet;

use super::{
    EventId, EventLogStorageRecord, EventLogSyncIssueState, ExternalEventLogRecord,
    LocalFolderEventWrite, NookError, NookVaultManager, RemoteEventLogClassification,
    VaultCryptoState, append_outbox_index, classify_remote_event_log, load_from_indexed_db,
    load_local_event_store, load_outbox, queue_outbox_entry, read_local_folder_event_files,
    remove_outbox_entry, save_key_epoch, write_local_folder_event_files,
};

fn outbox_event_is_current(local_ids: Option<&BTreeSet<EventId>>, event_id: &EventId) -> bool {
    local_ids.is_none_or(|ids| ids.contains(event_id))
}

impl NookVaultManager {
    fn projected_epoch_keys(
        meta: &nook_core::VaultMetaState,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<nook_core::VaultKeys, NookError> {
        let envelopes = meta.auth.get(&identity.auth_id()).ok_or_else(|| {
            NookError::Database(
                "The current security epoch no longer authorizes this device.".to_owned(),
            )
        })?;
        Ok(nook_core::VaultKeys {
            secrets_key: identity.decrypt_envelope(&envelopes.secrets_key)?,
            members_key: identity.decrypt_envelope(&envelopes.members_key)?,
        })
    }

    pub(in crate::manager) async fn adopt_projected_security_epoch(
        &mut self,
        projection: &nook_core::VaultProjection,
    ) -> Result<(), NookError> {
        let nook_core::ProjectionEpoch::Current(nook_core::KeyEpoch(key_epoch)) = &projection.epoch
        else {
            return Ok(());
        };
        if self.event_log.key_epoch == key_epoch.as_str() {
            return Ok(());
        }
        if self.vault.architecture.vault_type == nook_core::VaultType::Sentinel {
            let error = NookError::from(nook_core::MultiDeviceError::SentinelCeremonyRequired);
            self.clear_vault_keys();
            return Err(error);
        }
        let keys = match self
            .device_identity()
            .and_then(|identity| Self::projected_epoch_keys(&self.vault.meta, &identity))
        {
            Ok(keys) => keys,
            Err(error) => {
                self.clear_vault_keys();
                return Err(error);
            }
        };
        let crypto = match nook_core::VaultCrypto::new(&keys.secrets_key) {
            Ok(crypto) => crypto,
            Err(error) => {
                self.clear_vault_keys();
                return Err(error.into());
            }
        };
        let next_epoch = key_epoch.as_str().to_owned();
        if let Err(error) = save_key_epoch(&self.vault.store_id, &next_epoch).await {
            self.clear_vault_keys();
            return Err(error);
        }
        self.vault.secrets_key = keys.secrets_key.as_str().to_owned();
        self.vault.members_key = keys.members_key.as_str().to_owned();
        self.vault.crypto = VaultCryptoState::Unlocked(crypto);
        self.event_log.key_epoch = next_epoch;
        Ok(())
    }

    pub(super) async fn queue_event_outbox_for_current_provider(
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
        &mut self,
        provider_label: &str,
        classification: &RemoteEventLogClassification,
    ) -> Result<(), NookError> {
        match classification {
            RemoteEventLogClassification::Empty
            | RemoteEventLogClassification::SameStore { .. } => Ok(()),
            RemoteEventLogClassification::DifferentStore {
                local_store_id,
                remote_store_id,
            } => {
                self.event_log_sync_issue = EventLogSyncIssueState::Pending {
                    provider_label: provider_label.to_owned(),
                    classification: classification.clone(),
                };
                Err(Self::provider_store_mismatch_error(
                    provider_label,
                    local_store_id,
                    remote_store_id,
                ))
            }
            RemoteEventLogClassification::MultipleStores { store_ids } => {
                self.event_log_sync_issue = EventLogSyncIssueState::Pending {
                    provider_label: provider_label.to_owned(),
                    classification: classification.clone(),
                };
                Err(Self::provider_multiple_stores_error(
                    provider_label,
                    store_ids,
                ))
            }
        }
    }

    async fn fetch_current_provider_events(
        &mut self,
        event_ids: impl IntoIterator<Item = EventId>,
    ) -> Result<Vec<(EventId, Vec<u8>)>, NookError> {
        let mut events = Vec::new();
        for event_id in event_ids {
            // Listed names can outlive readable content (Drive junk duplicates).
            // Skip absent ids so sync/assess can recover by publishing local bytes.
            if let Some(bytes) = self
                .fetch_current_provider_event_optional(&event_id)
                .await?
            {
                events.push((event_id, bytes));
            }
        }
        Ok(events)
    }

    async fn guard_current_provider_writable_for_active_store(
        &mut self,
        remote_ids: &BTreeSet<EventId>,
    ) -> Result<(), NookError> {
        if self.vault.store_id.trim().is_empty() || remote_ids.is_empty() {
            return Ok(());
        }
        let local_ids: BTreeSet<EventId> = load_local_event_store(&self.vault.store_id)
            .await?
            .event_ids()
            .into_iter()
            .collect();
        // Already-local remote ids share this store (content-addressed). Only fetch
        // missing ids — foreign-store events never match local ids.
        let missing = remote_ids
            .difference(&local_ids)
            .cloned()
            .collect::<Vec<_>>();
        if missing.is_empty() {
            return Ok(());
        }
        let remote_events = self.fetch_current_provider_events(missing).await?;
        let classification =
            classify_remote_event_log(&remote_events, Some(self.vault.store_id.as_str()))?;
        self.guard_remote_event_log_classification("Sync provider", &classification)
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
        let sync_result = async {
            self.prepare_storage_preserving_vault_metadata(&mode, &pat, &repo)
                .await?;
            self.flush_event_outbox().await
        }
        .await;
        let restore_result = self
            .prepare_storage_preserving_vault_metadata("local", "", "")
            .await;
        sync_result.and(restore_result)
    }

    pub(in crate::manager) async fn flush_event_outbox(&mut self) -> Result<(), NookError> {
        if self.storage.mode == nook_core::StorageMode::Local {
            return Ok(());
        }
        let provider_id = self.local_cache_ref();
        let mut remote_ids = self.list_current_provider_event_ids().await?;
        self.guard_current_provider_writable_for_active_store(&remote_ids)
            .await?;
        let local_ids = if self.vault.store_id.is_empty() {
            None
        } else {
            Some(
                load_local_event_store(&self.vault.store_id)
                    .await?
                    .event_ids()
                    .into_iter()
                    .collect::<BTreeSet<_>>(),
            )
        };
        let mut pending = load_outbox(&provider_id)
            .await?
            .into_iter()
            .map(|(event_id, bytes)| Ok((EventId::parse(&event_id)?, bytes)))
            .collect::<Result<Vec<_>, NookError>>()?;
        nook_core::order_remote_events_for_visibility(&mut pending)?;
        for (event_id, bytes) in pending {
            if !outbox_event_is_current(local_ids.as_ref(), &event_id) {
                remove_outbox_entry(&provider_id, event_id.as_str()).await?;
                continue;
            }
            // Always put-if-absent: a listed remote name may be unreadable junk.
            // Only drop the outbox row after a successful idempotent publish.
            self.put_current_provider_event_if_absent(&event_id, &bytes)
                .await?;
            remove_outbox_entry(&provider_id, event_id.as_str()).await?;
            remote_ids.insert(event_id);
        }

        if !self.vault.store_id.is_empty() {
            let local = load_local_event_store(&self.vault.store_id).await?;
            let mut missing = local
                .missing_event_ids(&remote_ids)
                .into_iter()
                .map(|event_id| {
                    let bytes = local.get_bytes(&event_id).ok_or_else(|| {
                        NookError::Database(format!("Local event {event_id} is missing"))
                    })?;
                    Ok((event_id, bytes.to_vec()))
                })
                .collect::<Result<Vec<_>, NookError>>()?;
            nook_core::order_remote_events_for_visibility(&mut missing)?;
            for (event_id, bytes) in missing {
                self.put_current_provider_event_if_absent(&event_id, &bytes)
                    .await?;
                remote_ids.insert(event_id);
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
                let store_ids = discovered_store_ids.iter().cloned().collect::<Vec<_>>();
                let classification = RemoteEventLogClassification::MultipleStores { store_ids };
                return self
                    .guard_remote_event_log_classification("Sync provider", &classification);
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
            let missing_ids = remote_ids
                .difference(&local_ids)
                .cloned()
                .collect::<BTreeSet<_>>();
            let fetched = self.fetch_current_provider_events(missing_ids).await?;
            let classification =
                classify_remote_event_log(&fetched, Some(self.vault.store_id.as_str()))?;
            self.guard_remote_event_log_classification("Sync provider", &classification)?;
            for (event_id, bytes) in fetched {
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
        self.persist_merged_remote_events(&mut local, &remote_events, false)
            .await?;
        // Locked sentinel sessions keep share/join meta in memory for ceremony
        // without rewriting a keyless projection cache.
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

    async fn persist_merged_remote_events(
        &mut self,
        local: &mut nook_core::LocalEventStore,
        remote_events: &[(EventId, Vec<u8>)],
        persist_locked_projection: bool,
    ) -> Result<(), NookError> {
        let (heads, persisted) = crate::storage::event_db::save_verified_remote_events(
            &self.vault.store_id,
            remote_events,
        )
        .await?;
        *local = persisted;
        self.event_log.heads = heads.clone();
        let graph = local.load_graph(&self.vault.store_id)?;
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
        let projection = nook_core::project_vault(&graph, &self.vault.store_id)?;
        self.ensure_sentinel_architecture_from_shares()?;
        let unlocked =
            self.vault.crypto.is_unlocked() || self.ensure_vault_crypto_from_cache().await.is_ok();
        if unlocked {
            self.adopt_projected_security_epoch(&projection).await?;
            self.apply_event_projection_to_session().await?;
        } else if persist_locked_projection {
            self.hydrate_locked_projection_from_events().await?;
        }
        if unlocked || persist_locked_projection {
            self.persist_projection_cache().await?;
        }
        Ok(())
    }

    pub(super) async fn read_external_local_folder_records(
        handle_id: &str,
    ) -> Result<Vec<ExternalEventLogRecord>, NookError> {
        read_local_folder_event_files(handle_id)
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
            .collect()
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
                let store_ids = discovered_store_ids.iter().cloned().collect::<Vec<_>>();
                let classification = RemoteEventLogClassification::MultipleStores { store_ids };
                self.guard_remote_event_log_classification("Backup folder", &classification)?;
                unreachable!("multiple-store classification must be rejected");
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
            self.guard_remote_event_log_classification("Backup folder", &classification)?;
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
            self.persist_merged_remote_events(&mut local, &remote_events, true)
                .await?;
        }

        self.export_event_log_records().await
    }

    pub(in crate::manager) async fn sync_local_folder_provider(
        &mut self,
        handle_id: &str,
    ) -> Result<String, NookError> {
        let remote_records = Self::read_external_local_folder_records(handle_id).await?;
        let remote_event_ids = remote_records
            .iter()
            .map(|record| record.event_id.clone())
            .collect::<BTreeSet<_>>();
        let merged = self.sync_external_event_log_records(remote_records).await?;
        let mut writes = merged
            .iter()
            .filter(|record| !remote_event_ids.contains(&record.event_id))
            .map(|record| {
                Ok((
                    EventId::parse(&record.event_id)?,
                    Self::serialize_event_log_storage_record(record)?.into_bytes(),
                ))
            })
            .collect::<Result<Vec<_>, NookError>>()?;
        nook_core::order_remote_events_for_visibility(&mut writes)?;
        let writes = writes
            .into_iter()
            .map(|(event_id, content)| {
                Ok(LocalFolderEventWrite {
                    event_id: event_id.into_inner(),
                    content: String::from_utf8(content)
                        .map_err(|error| NookError::Serialization(error.to_string()))?,
                })
            })
            .collect::<Result<Vec<_>, NookError>>()?;
        write_local_folder_event_files(handle_id, &writes).await?;
        Ok(load_from_indexed_db().await?.unwrap_or_default())
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use wasm_bindgen::JsError;

    #[test]
    fn projected_epoch_keys_use_the_current_auth_envelopes() -> anyhow::Result<()> {
        let identity = nook_core::DeviceIdentity::generate()?;
        let keys = nook_core::generate_vault_keys()?;
        let auth = nook_core::genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key)?;
        let meta = nook_core::VaultMetaState::from_stored_records(&[auth]);

        let resolved = NookVaultManager::projected_epoch_keys(&meta, &identity)?;

        assert_eq!(resolved, keys);
        Ok(())
    }

    #[test]
    fn durable_outbox_rejects_an_event_removed_from_the_active_index() -> anyhow::Result<()> {
        let retained = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let quarantined = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let local_ids = BTreeSet::from([retained.clone()]);
        assert!(outbox_event_is_current(Some(&local_ids), &retained));
        assert!(!outbox_event_is_current(Some(&local_ids), &quarantined));
        Ok(())
    }

    #[test]
    #[allow(
        unknown_lints,
        non_local_effect_before_unhandled_error,
        reason = "the contract records a typed sync issue before rejecting the remote store"
    )]
    fn rejected_event_log_classification_is_available_as_a_typed_issue() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        let classification = RemoteEventLogClassification::DifferentStore {
            local_store_id: "store_local12345".to_owned(),
            remote_store_id: "store_remote1234".to_owned(),
        };

        assert!(
            manager
                .guard_remote_event_log_classification("Sync provider", &classification)
                .is_err()
        );
        let issue = manager.take_event_log_sync_issue().issue()?;
        assert!(issue.is_store_mismatch());
        assert_eq!(issue.local_store_id()?, "store_local12345");
        assert_eq!(issue.remote_store_id()?, "store_remote1234");
        Ok(())
    }
}
