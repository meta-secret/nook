#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::storage::event_db::{RemoteEventUnion, VaultEventPersistence};
use nook_core::{
    CheckedRemoteEvent, EventStorageBytes, MultiDeviceError, ProjectionEpoch, RemoteEventBatch,
    RemoteEventWrites, StorageMode, VaultCrypto, VaultMetaGraphProjection, VaultType,
};
use std::collections::BTreeSet;

use super::{
    EventId, EventLogStorageRecord, EventLogSyncIssueState, ExternalEventLogRecord,
    LocalFolderEventWrite, LocalFolderHandles, NookError, NookVaultManager,
    RemoteEventLogClassification, VaultCryptoState, append_outbox_index, load_from_indexed_db,
    load_local_event_store, load_outbox, queue_outbox_entry, remove_outbox_entry, save_key_epoch,
};

struct PendingOutboxEvent<'a> {
    provider_id: &'a str,
    event_id: EventId,
    bytes: EventStorageBytes,
    local_ids: Option<&'a BTreeSet<EventId>>,
}

struct PublishedOutboxEvent<'a> {
    provider_id: &'a str,
    event_id: EventId,
}

impl PendingOutboxEvent<'_> {
    fn is_current(&self) -> bool {
        self.local_ids
            .is_none_or(|ids| ids.contains(&self.event_id))
    }

    async fn discard(self) -> Result<(), NookError> {
        remove_outbox_entry(self.provider_id, self.event_id.as_str()).await
    }
}

impl<'a> PendingOutboxEvent<'a> {
    async fn publish(
        self,
        manager: &NookVaultManager,
    ) -> Result<PublishedOutboxEvent<'a>, NookError> {
        // Always put-if-absent: a listed remote name may be unreadable junk.
        manager
            .put_current_provider_event_if_absent(&self.event_id, self.bytes.as_ref())
            .await?;
        Ok(PublishedOutboxEvent {
            provider_id: self.provider_id,
            event_id: self.event_id,
        })
    }
}

impl PublishedOutboxEvent<'_> {
    async fn acknowledge(self) -> Result<EventId, NookError> {
        remove_outbox_entry(self.provider_id, self.event_id.as_str()).await?;
        Ok(self.event_id)
    }
}

impl NookVaultManager {
    async fn persist_projected_key_epoch(
        &mut self,
        projection: &nook_core::VaultProjection,
    ) -> Result<(), NookError> {
        let ProjectionEpoch::Current(nook_core::KeyEpoch(key_epoch)) = &projection.epoch else {
            return Ok(());
        };
        let next_epoch = key_epoch.as_str().to_owned();
        save_key_epoch(&self.vault.store_id, &next_epoch).await?;
        self.event_log.key_epoch = next_epoch;
        Ok(())
    }

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
        let ProjectionEpoch::Current(nook_core::KeyEpoch(key_epoch)) = &projection.epoch else {
            return Ok(());
        };
        if self.event_log.key_epoch == key_epoch.as_str() && self.vault.crypto.is_unlocked() {
            return Ok(());
        }
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            let error = NookError::from(MultiDeviceError::SentinelCeremonyRequired);
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
        let crypto = match VaultCrypto::new(&keys.secrets_key) {
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
        let provider_id = if self.storage.mode == StorageMode::Local {
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
    ) -> Result<Vec<(EventId, EventStorageBytes)>, NookError> {
        let mut events = Vec::new();
        for event_id in event_ids {
            // Listed names can outlive readable content (Drive junk duplicates).
            // Skip absent ids so sync/assess can recover by publishing local bytes.
            if let Some(bytes) = self
                .fetch_current_provider_event_optional(&event_id)
                .await?
            {
                events.push((event_id, bytes.into()));
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
            RemoteEventBatch::new(&remote_events).classify(Some(self.vault.store_id.as_str()))?;
        self.guard_remote_event_log_classification("Sync provider", &classification)
    }

    pub(in crate::manager) async fn flush_sync_event_outbox(&mut self) -> Result<(), NookError> {
        if self.storage.mode != StorageMode::Local {
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
        if self.storage.mode == StorageMode::Local {
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
            .map(|(event_id, bytes)| Ok((EventId::parse(&event_id)?, bytes.into())))
            .collect::<Result<Vec<_>, NookError>>()?;
        RemoteEventWrites::new(&mut pending).order()?;
        for (event_id, bytes) in pending {
            let pending = PendingOutboxEvent {
                provider_id: &provider_id,
                event_id,
                bytes,
                local_ids: local_ids.as_ref(),
            };
            if !pending.is_current() {
                pending.discard().await?;
                continue;
            }
            let event_id = pending.publish(self).await?.acknowledge().await?;
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
                    Ok((event_id, bytes))
                })
                .collect::<Result<Vec<_>, NookError>>()?;
            RemoteEventWrites::new(&mut missing).order()?;
            for (event_id, bytes) in missing {
                self.put_current_provider_event_if_absent(&event_id, bytes.as_ref())
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
                let store_id = CheckedRemoteEvent::parse(&event_id, &bytes)
                    .map(CheckedRemoteEvent::into_store_id)?;
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
                RemoteEventBatch::new(&fetched).classify(Some(self.vault.store_id.as_str()))?;
            self.guard_remote_event_log_classification("Sync provider", &classification)?;
            for (event_id, bytes) in fetched {
                if !CheckedRemoteEvent::parse(&event_id, &bytes)
                    .map(|event| event.belongs_to_store(&self.vault.store_id))?
                {
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

    async fn persist_merged_remote_events(
        &mut self,
        local: &mut nook_core::LocalEventStore,
        remote_events: &[(EventId, EventStorageBytes)],
        persist_locked_projection: bool,
    ) -> Result<(), NookError> {
        let storage_records = remote_events
            .iter()
            .map(|(event_id, bytes)| (event_id.clone(), bytes.clone().into()))
            .collect::<Vec<_>>();
        let (heads, persisted) = VaultEventPersistence::new(&self.vault.store_id)
            .union_remote(RemoteEventUnion {
                events: &storage_records,
            })
            .await?;
        *local = persisted;
        self.event_log.heads = heads.clone();
        let graph = local.load_graph(&self.vault.store_id)?;
        VaultMetaGraphProjection::new(&graph).materialize(&mut self.vault.meta)?;
        let projection = nook_core::VaultProjection::from_graph(&graph, &self.vault.store_id)?;
        self.ensure_sentinel_architecture_from_shares()?;
        let unlocked =
            self.vault.crypto.is_unlocked() || self.ensure_vault_crypto_from_cache().await.is_ok();
        if unlocked {
            self.adopt_projected_security_epoch(&projection).await?;
            self.apply_event_projection_to_session().await?;
        } else if persist_locked_projection {
            self.persist_projected_key_epoch(&projection).await?;
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
        LocalFolderHandles::current()
            .open_folder(handle_id)
            .await?
            .read_events()
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

    pub(in crate::manager) async fn sync_external_event_log_records(
        &mut self,
        records: Vec<ExternalEventLogRecord>,
    ) -> Result<Vec<EventLogStorageRecord>, NookError> {
        let parsed_records: Vec<(EventId, EventStorageBytes)> = records
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
                let store_id = CheckedRemoteEvent::parse(&event_id, &bytes)
                    .map(CheckedRemoteEvent::into_store_id)?;
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
            let classification = RemoteEventBatch::new(&parsed_records)
                .classify(Some(self.vault.store_id.as_str()))?;
            self.guard_remote_event_log_classification("Backup folder", &classification)?;
            for (event_id, bytes) in parsed_records {
                if !CheckedRemoteEvent::parse(&event_id, &bytes)
                    .map(|event| event.belongs_to_store(&self.vault.store_id))?
                {
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
                    Self::serialize_event_log_storage_record(record)?
                        .into_bytes()
                        .into(),
                ))
            })
            .collect::<Result<Vec<_>, NookError>>()?;
        RemoteEventWrites::new(&mut writes).order()?;
        let writes = writes
            .into_iter()
            .map(|(event_id, content)| {
                Ok(LocalFolderEventWrite {
                    event_id: event_id.into_inner(),
                    content: String::from_utf8(content.into())
                        .map_err(|error| NookError::Serialization(error.to_string()))?,
                })
            })
            .collect::<Result<Vec<_>, NookError>>()?;
        LocalFolderHandles::current()
            .open_folder(handle_id)
            .await?
            .write_events(&writes)
            .await?;
        Ok(load_from_indexed_db().await?.unwrap_or_default())
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use crate::manager::session::NookEventLogSyncIssueState;

    use super::*;
    use nook_core::{
        DeviceIdentity, IsoTimestamp, SigningIdentity, VaultEvent, VaultEventBody,
        VaultEventSchemaVersion, VaultMetaState, VaultOperation,
    };
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct OutboxFixture {
        provider_id: String,
        event_id: EventId,
        bytes: Vec<u8>,
    }

    #[expect(
        unowned_function,
        reason = "framework boundary: test fixture constructs a signed event for provider export coverage"
    )]
    fn event_fixture() -> anyhow::Result<(EventId, EventStorageBytes, VaultEvent)> {
        let signing = SigningIdentity::generate()?.0;
        let event = VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: nook_core::StoreId::parse("store_testtoken11")?,
                actor_id: signing.actor_id()?,
                actor_signing_public_key: signing.public_key(),
                parents: Vec::new(),
                created_at: IsoTimestamp::parse("2026-08-15T00:00:00Z")?,
                key_epoch: EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?,
                operations: vec![VaultOperation::VaultCleared],
            },
            signing.signing_key(),
        )?;
        let event_id = event.id()?;
        let bytes = nook_core::serialize_event_storage_yaml(&event)?;
        Ok((event_id, bytes, event))
    }

    impl OutboxFixture {
        async fn queue(&self) -> Result<PendingOutboxEvent<'_>, NookError> {
            queue_outbox_entry(&self.provider_id, self.event_id.as_str(), &self.bytes).await?;
            append_outbox_index(&self.provider_id, self.event_id.as_str()).await?;
            Ok(PendingOutboxEvent {
                provider_id: &self.provider_id,
                event_id: self.event_id.clone(),
                bytes: self.bytes.clone().into(),
                local_ids: None,
            })
        }
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn outbox_publication_failure_and_durable_completion() -> anyhow::Result<()> {
        let fixture = OutboxFixture {
            provider_id: format!("outbox-lifecycle-{}", nook_core::StoreId::generate()?),
            event_id: EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?,
            bytes: b"invalid event fixture".to_vec(),
        };
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::Github;
        match fixture.queue().await?.publish(&manager).await {
            Err(NookError::Serialization(message)) => {
                assert!(message.starts_with("GitHub event parse:"));
            }
            Err(_) => anyhow::bail!("unexpected publication failure"),
            Ok(_) => anyhow::bail!("malformed event was published"),
        }
        assert_eq!(
            load_outbox(&fixture.provider_id).await?,
            vec![(fixture.event_id.to_string(), fixture.bytes.clone())]
        );
        let excluded = BTreeSet::new();
        let mut pending = fixture.queue().await?;
        pending.local_ids = Some(&excluded);
        assert!(!pending.is_current());
        pending.discard().await?;
        assert!(load_outbox(&fixture.provider_id).await?.is_empty());

        // Dropping an unpolled publication leaves the durable row intact.
        drop(fixture.queue().await?.publish(&manager));
        assert_eq!(
            load_outbox(&fixture.provider_id).await?,
            vec![(fixture.event_id.to_string(), fixture.bytes.clone())]
        );
        // Exercise durable acknowledgement independently of remote publication.
        let published = PublishedOutboxEvent {
            provider_id: &fixture.provider_id,
            event_id: fixture.event_id.clone(),
        };
        assert_eq!(published.acknowledge().await?, fixture.event_id);
        assert!(load_outbox(&fixture.provider_id).await?.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn projected_epoch_keys_use_the_current_auth_envelopes() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let keys = nook_core::VaultKeys::generate()?;
        let auth = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
        let meta = VaultMetaState::from_stored_records(&[auth])?;

        let resolved = NookVaultManager::projected_epoch_keys(&meta, &identity)?;

        assert_eq!(resolved, keys);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn durable_outbox_rejects_an_event_removed_from_the_active_index() -> anyhow::Result<()> {
        let retained = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let quarantined = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let local_ids = BTreeSet::from([retained.clone()]);
        for (index, event_id, expected) in [
            (None, retained.clone(), true),
            (Some(&local_ids), retained, true),
            (Some(&local_ids), quarantined.clone(), false),
            (Some(&BTreeSet::new()), quarantined, false),
        ] {
            let pending = PendingOutboxEvent {
                provider_id: "index-fixture",
                event_id,
                bytes: Vec::new().into(),
                local_ids: index,
            };
            assert_eq!(pending.is_current(), expected);
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
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

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn empty_and_same_store_classifications_leave_no_pending_issue() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        for classification in [
            RemoteEventLogClassification::Empty,
            RemoteEventLogClassification::SameStore {
                store_id: "store_same12345".to_owned(),
            },
        ] {
            manager.guard_remote_event_log_classification("Drive", &classification)?;
            assert_eq!(
                manager.take_event_log_sync_issue().state(),
                NookEventLogSyncIssueState::Clear
            );
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    #[allow(
        non_local_effect_before_unhandled_error,
        reason = "the test intentionally observes and then inspects the stored multi-store issue"
    )]
    fn multiple_store_classification_records_all_store_ids_in_the_issue() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        let classification = RemoteEventLogClassification::MultipleStores {
            store_ids: vec!["store_first1234".to_owned(), "store_second12".to_owned()],
        };
        let error = manager
            .guard_remote_event_log_classification("GitHub", &classification)
            .expect_err("multiple provider stores must be rejected");
        assert!(
            matches!(error, NookError::Database(message) if message.contains("store_first1234") && message.contains("store_second12"))
        );
        let issue = manager.take_event_log_sync_issue().issue()?;
        assert!(issue.is_multiple_stores());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn provider_classification_errors_include_the_provider_and_store_context() {
        let mismatch = NookVaultManager::provider_store_mismatch_error(
            "Drive",
            "store_local12345",
            "store_remote1234",
        );
        assert!(matches!(
            mismatch,
            NookError::Database(message)
                if message == "Drive already contains another vault (local store_id store_local12345, provider store_id store_remote1234). Choose which vault to use before syncing."
        ));

        let multiple = NookVaultManager::provider_multiple_stores_error(
            "Backup folder",
            &["store_first1234".to_owned(), "store_second12".to_owned()],
        );
        assert!(matches!(
            multiple,
            NookError::Database(message)
                if message == "Backup folder contains multiple vault event logs (store_id: store_first1234, store_second12). Use a dedicated provider path for one vault before syncing."
        ));
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn event_export_round_trips_content_addressed_records() -> anyhow::Result<()> {
        let (event_id, bytes, event) = event_fixture()?;
        let mut store = nook_core::LocalEventStore::new();
        store.put_event(event_id.clone(), bytes);

        let records = NookVaultManager::export_event_records_from_store(&store)?;

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].event_id, event_id.as_str());
        assert_eq!(records[0].path, event_id.storage_path());
        assert_eq!(records[0].event.id()?, event.id()?);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn event_export_rejects_corrupt_local_bytes() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let mut store = nook_core::LocalEventStore::new();
        store.put_event(event_id, b"corrupt event bytes".to_vec().into());

        assert!(NookVaultManager::export_event_records_from_store(&store).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn wasm_projected_epoch_keys_reject_an_unknown_device() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let error = NookVaultManager::projected_epoch_keys(&VaultMetaState::default(), &identity)
            .expect_err("missing auth envelope must fail closed");
        assert!(matches!(
            error,
            NookError::Database(message)
                if message == "The current security epoch no longer authorizes this device."
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    #[allow(
        non_local_effect_before_unhandled_error,
        reason = "the test intentionally observes and then inspects the stored provider issue"
    )]
    async fn wasm_provider_classification_errors_preserve_store_details() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        let different = RemoteEventLogClassification::DifferentStore {
            local_store_id: "store_local12345".to_owned(),
            remote_store_id: "store_remote1234".to_owned(),
        };
        let error = manager
            .guard_remote_event_log_classification("Drive", &different)
            .expect_err("different stores must be rejected");
        assert!(matches!(
            error,
            NookError::Database(message)
                if message.contains("Drive")
                    && message.contains("store_local12345")
                    && message.contains("store_remote1234")
        ));

        let multiple = RemoteEventLogClassification::MultipleStores {
            store_ids: vec!["store_first1234".to_owned(), "store_second12".to_owned()],
        };
        let error = manager
            .guard_remote_event_log_classification("GitHub", &multiple)
            .expect_err("multiple stores must be rejected");
        assert!(matches!(
            error,
            NookError::Database(message)
                if message.contains("GitHub")
                    && message.contains("store_first1234")
                    && message.contains("store_second12")
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn wasm_before_genesis_projection_is_a_safe_noop() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_projection_noop".to_owned();
        manager
            .persist_projected_key_epoch(&nook_core::VaultProjection::default())
            .await?;
        assert!(manager.event_log.key_epoch.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn wasm_current_projection_persists_its_key_epoch() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = format!("store_sync_epoch_{}", nook_core::StoreId::generate()?);
        let epoch = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let projection = nook_core::VaultProjection {
            epoch: ProjectionEpoch::Current(nook_core::KeyEpoch(epoch.clone())),
            ..Default::default()
        };

        manager.persist_projected_key_epoch(&projection).await?;

        assert_eq!(manager.event_log.key_epoch, epoch.as_str());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn wasm_adopting_the_active_epoch_is_idempotent_when_unlocked() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        let keys = nook_core::VaultKeys::generate()?;
        let epoch = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let epoch_name = epoch.to_string();
        manager.event_log.key_epoch = epoch.to_string();
        manager.vault.crypto = VaultCryptoState::Unlocked(VaultCrypto::new(&keys.secrets_key)?);
        let projection = nook_core::VaultProjection {
            epoch: ProjectionEpoch::Current(nook_core::KeyEpoch(epoch)),
            ..Default::default()
        };

        manager.adopt_projected_security_epoch(&projection).await?;

        assert!(manager.vault.crypto.is_unlocked());
        assert_eq!(manager.event_log.key_epoch, epoch_name);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn wasm_sentinel_epoch_adoption_fails_closed_before_key_lookup() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.architecture.vault_type = VaultType::Sentinel;
        manager.vault.secrets_key = "sentinel-secret".to_owned();
        manager.vault.members_key = "sentinel-members".to_owned();
        let epoch = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let projection = nook_core::VaultProjection {
            epoch: ProjectionEpoch::Current(nook_core::KeyEpoch(epoch)),
            ..Default::default()
        };

        let error = manager
            .adopt_projected_security_epoch(&projection)
            .await
            .expect_err("sentinel adoption requires the ceremony");

        assert!(
            matches!(error, NookError::Encryption(message) if message == MultiDeviceError::SentinelCeremonyRequired.to_string())
        );
        assert!(manager.vault.secrets_key.is_empty());
        assert!(manager.vault.members_key.is_empty());
        assert!(!manager.vault.crypto.is_unlocked());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn local_outbox_queue_is_noop_without_a_provider_and_persists_with_one()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::Local;
        let event_id = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;

        manager
            .queue_event_outbox_for_current_provider(&event_id, b"no provider")
            .await?;
        manager.sync_outbox.provider_id = "local-outbox-test".to_owned();
        manager
            .queue_event_outbox_for_current_provider(&event_id, b"queued")
            .await?;
        assert_eq!(
            load_outbox("local-outbox-test").await?,
            vec![(event_id.to_string(), b"queued".to_vec())]
        );
        remove_outbox_entry("local-outbox-test", event_id.as_str()).await?;
        assert!(load_outbox("local-outbox-test").await?.is_empty());
        Ok(())
    }
}
