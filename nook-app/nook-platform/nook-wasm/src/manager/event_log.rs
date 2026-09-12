//! Event-log persistence and provider fan-out.

use crate::EventDbSaveHeads;
use crate::EventDbSaveKeyEpoch;
use crate::manager::device_protection::ExtensionIdentityPublication;
use crate::storage::event_db::StoredKeyEpoch;
use crate::storage::identity_record::LocalIdentitySigner;
use crate::storage::identity_record::StoredIdentityProtection;
use crate::{NookDatabase, NookError};
use nook_core::StoredSigningSeed;
use nook_core::{
    EventError, IsoTimestamp, StoreId, VaultError, VaultMetaGraphProjection,
    VaultMetaOperationApplier, VaultMetaOperationRequest, VaultNameRef, VaultProjection,
    VaultStoreIdentityRef, VaultUnlock, VaultVersionWrite,
};
mod extension_import;
mod import_as_local;
mod provider_io;
mod provider_sync;
mod provider_sync_export;
mod records;
mod security_epoch;

pub(in crate::manager) use records::{
    EventLogStorageRecord, ExtensionEventLogImportStatus, ExternalEventLogRecord,
};
pub(in crate::manager) use security_epoch::SecurityEpochRotationFailure;

use super::{EventLogSyncIssueState, NookVaultManager, VaultCryptoState, VaultNameState};

use crate::storage::drive_events::DriveEventStore;
use crate::storage::event_db::{EventAppend, VaultEventPersistence};
use crate::storage::github_events::GitHubEventStore;
use crate::storage::icloud::ICloudEventStore;

use crate::storage::local_folder::{LocalFolderEventWrite, LocalFolderHandles};
use nook_core::{
    AppendEventInput, EventId, RemoteEventLogClassification, SigningIdentity, VaultEvent,
    VaultOperation, VaultUserRecordBatch,
};

pub(super) struct BuiltVaultEvent {
    pub(super) event: VaultEvent,
    pub(super) bytes: Vec<u8>,
}

impl NookVaultManager {
    pub(in crate::manager) async fn live_secret_dedup_state(
        &self,
    ) -> Result<
        Vec<(
            nook_core::StoredSecretRecord,
            nook_core::SecretFingerprint,
            nook_core::SecretFingerprint,
        )>,
        NookError,
    > {
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        let projection = VaultProjection::from_graph(&graph, &self.vault.store_id)?;
        Ok(projection
            .secrets
            .values()
            .filter(|secret| secret.is_live(&graph))
            .map(|secret| {
                (
                    secret.record.clone(),
                    secret.identity_fingerprint.clone(),
                    secret.fingerprint.clone(),
                )
            })
            .collect())
    }

    fn validate_event_record_id(
        expected_event_id: &EventId,
        event: &VaultEvent,
    ) -> Result<(), nook_core::VaultError> {
        let canonical_id = event.id()?;
        if canonical_id != *expected_event_id {
            return Err(VaultError::Event(EventError::EventStoreIdMismatch {
                expected: canonical_id.as_str().to_owned(),
                actual: expected_event_id.as_str().to_owned(),
            }));
        }
        Ok(())
    }

    pub(in crate::manager) fn parse_event_log_storage_record(
        event_id: &str,
        path: &str,
        content: &str,
    ) -> Result<EventLogStorageRecord, NookError> {
        let event_id = EventId::parse(event_id)?;
        let event = VaultEvent::parse_event_storage_bytes(&content.as_bytes().to_vec().into())?;
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
        let bytes = VaultEvent::serialize_event_storage_yaml(&record.event)?;
        String::from_utf8(bytes.into()).map_err(|e| {
            NookError::Serialization(format!("Event storage content is not UTF-8: {e}"))
        })
    }

    pub(in crate::manager) async fn ensure_event_log_mode(&mut self) -> Result<bool, NookError> {
        if self.event_log.enabled {
            if !NookDatabase::is_event_log_mode().await? {
                NookDatabase::set_event_log_mode().await?;
            }
            return Ok(true);
        }
        if NookDatabase::is_event_log_mode().await? {
            self.event_log.enabled = true;
            return Ok(true);
        }
        Ok(false)
    }

    /// Activate event-log persistence for this vault session.
    ///
    /// Idempotent when the current event log exists.
    pub(in crate::manager) async fn ensure_event_log_ready(&mut self) -> Result<(), NookError> {
        if self.ensure_event_log_mode().await? && self.event_log_has_events().await? {
            return Ok(());
        }
        if self.event_log_has_events().await? {
            self.activate_event_log_mode().await?;
            return Ok(());
        }
        Err(NookError::Database(
            "Vault event log is required.".to_owned(),
        ))
    }

    pub(in crate::manager) async fn activate_event_log_mode(&mut self) -> Result<(), NookError> {
        NookDatabase::set_event_log_mode().await?;
        self.event_log.enabled = true;
        Ok(())
    }

    pub(in crate::manager) async fn ensure_signing_identity(
        &mut self,
    ) -> Result<SigningIdentity, NookError> {
        if matches!(
            &self.device.pending_extension_handoff,
            ExtensionIdentityPublication::Staged(_)
        ) && !self.event_log.signing_seed.is_empty()
        {
            return Ok(SigningIdentity::from_seed_hex_stored(
                &self.event_log.signing_seed,
            )?);
        }
        let app_key = self.device_identity()?;
        if matches!(
            NookDatabase::load_entry_for_app_id(app_key.app_id()).await?,
            StoredIdentityProtection::Protected(_)
        ) {
            self.event_log.signing_seed = LocalIdentitySigner { app_key: &app_key }
                .load_or_create()
                .await?;
            return Ok(SigningIdentity::from_seed_hex_stored(
                &self.event_log.signing_seed,
            )?);
        }
        if self.event_log.signing_seed.is_empty() {
            if let StoredSigningSeed::Stored(seed) = NookDatabase::load_signing_seed().await? {
                self.event_log.signing_seed = seed;
            } else {
                // New devices still mint a signer so they can submit JoinRequested
                // against an existing log. Unauthorized JoinApproved is blocked by
                // the quarantine check in append_vault_operations.
                let (identity, seed) = SigningIdentity::generate()?;
                NookDatabase::save_signing_seed(seed.as_str()).await?;
                self.event_log.signing_seed = seed.into_inner();
                return Ok(identity);
            }
        } else {
            // Prefer a durable authorized signer over a transient handoff seed
            // when the vault already has events. Persist in-memory seeds only
            // for empty-log create paths.
            match NookDatabase::load_signing_seed().await? {
                StoredSigningSeed::Stored(stored) if stored != self.event_log.signing_seed => {
                    if self.event_log_has_events().await? {
                        self.event_log.signing_seed = stored;
                    } else {
                        NookDatabase::save_signing_seed(&self.event_log.signing_seed).await?;
                    }
                }
                StoredSigningSeed::Missing => {
                    if !self.event_log_has_events().await? {
                        NookDatabase::save_signing_seed(&self.event_log.signing_seed).await?;
                    }
                }
                StoredSigningSeed::Stored(_) => {}
            }
        }
        Ok(SigningIdentity::from_seed_hex_stored(
            &self.event_log.signing_seed,
        )?)
    }

    pub(in crate::manager) async fn load_event_heads(&mut self) -> Result<Vec<String>, NookError> {
        if !self.vault.store_id.is_empty() {
            let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
            if !store.event_ids().is_empty() {
                // Prefer applicable causal heads so a quarantined/unauthorized
                // approval cannot remain a permanent parent tip.
                let graph = store.load_graph(&self.vault.store_id)?;
                let heads = graph
                    .heads()
                    .into_iter()
                    .map(|id| id.as_str().to_owned())
                    .collect::<Vec<_>>();
                if !heads.is_empty() {
                    if self.event_log.heads != heads {
                        self.event_log.heads = heads;
                        NookDatabase::save_heads(EventDbSaveHeads {
                            store_id: &self.vault.store_id,
                            heads: &self.event_log.heads,
                        })
                        .await?;
                    }
                    return Ok(self.event_log.heads.clone());
                }
            }
            if self.event_log.heads.is_empty() {
                self.event_log.heads = NookDatabase::load_heads(&self.vault.store_id).await?;
            }
        }
        Ok(self.event_log.heads.clone())
    }

    pub(in crate::manager) async fn ensure_key_epoch(&mut self) -> Result<String, NookError> {
        if !self.event_log.key_epoch.is_empty() {
            return Ok(self.event_log.key_epoch.clone());
        }
        if let StoredKeyEpoch::Recorded(epoch) =
            NookDatabase::load_key_epoch(&self.vault.store_id).await?
        {
            self.event_log.key_epoch = epoch;
            return Ok(self.event_log.key_epoch.clone());
        }
        let epoch = EventId::from_sha256_hex(
            nook_auth2::Sha256Hex::from_bytes(self.vault.store_id.as_bytes()).as_str(),
        )?
        .into_inner();
        self.event_log.key_epoch = epoch;
        if !self.vault.store_id.is_empty() {
            NookDatabase::save_key_epoch(EventDbSaveKeyEpoch {
                store_id: &self.vault.store_id,
                epoch: &self.event_log.key_epoch,
            })
            .await?;
        }
        Ok(self.event_log.key_epoch.clone())
    }

    pub(in crate::manager) async fn event_log_has_events(&self) -> Result<bool, NookError> {
        if self.vault.store_id.is_empty() {
            return Ok(false);
        }
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
        Ok(!store.event_ids().is_empty())
    }

    pub(in crate::manager) async fn append_vault_operations(
        &mut self,
        operations: Vec<VaultOperation>,
    ) -> Result<EventId, NookError> {
        if self.vault.store_id.is_empty() {
            self.vault.store_id = nook_core::StoreId::generate()?.to_string();
        }
        self.activate_event_log_mode().await?;
        let parents = self.load_event_heads().await?;
        let key_epoch = self.ensure_key_epoch().await?;
        let key_epoch = EventId::parse(&key_epoch)?;
        let parents: Vec<EventId> = parents
            .iter()
            .map(|parent| EventId::parse(parent).map_err(NookError::from))
            .collect::<Result<_, _>>()?;
        let built = self
            .build_vault_operations_event(operations, parents, key_epoch)
            .await?;
        self.persist_built_vault_event(built).await
    }

    /// Return one verified event that causally dominates the current frontier.
    pub(in crate::manager) async fn ensure_causal_event_checkpoint(
        &mut self,
    ) -> Result<String, NookError> {
        let heads = self.load_event_heads().await?;
        match heads.as_slice() {
            [] => self.ensure_key_epoch().await,
            [head] => Ok(head.clone()),
            _ => Ok(self.append_vault_operations(Vec::new()).await?.into_inner()),
        }
    }

    pub(super) async fn build_vault_operations_event(
        &mut self,
        operations: Vec<VaultOperation>,
        parents: Vec<EventId>,
        key_epoch: EventId,
    ) -> Result<BuiltVaultEvent, NookError> {
        let signing = self.ensure_signing_identity().await?;
        let actor_id = signing.actor_id()?;
        let store_id = StoreId::parse(&self.vault.store_id)?;
        let created_at = IsoTimestamp::parse(&crate::BrowserTimestamp::now().into_iso_string())?;
        let (event, bytes) = AppendEventInput::build(AppendEventInput {
            store_id: &store_id,
            actor_id: &actor_id,
            signing_identity: &signing,
            parents,
            key_epoch: &key_epoch,
            created_at: &created_at,
            operations,
        })?;
        Ok(BuiltVaultEvent {
            event,
            bytes: bytes.into(),
        })
    }

    pub(super) async fn persist_built_vault_event(
        &mut self,
        built: BuiltVaultEvent,
    ) -> Result<EventId, NookError> {
        let BuiltVaultEvent { event, bytes } = built;
        let event_id = event.id()?;
        let operations = event.body.operations.clone();
        let created_at = event.body.created_at.clone();
        // Keep validation, the event write, the index update, and derived heads
        // in the same transaction as security-epoch commits. Otherwise another
        // tab can commit a new epoch between validation and this write.
        self.event_log.heads = VaultEventPersistence::new(&self.vault.store_id)
            .append(EventAppend {
                event: &event,
                bytes: &bytes,
            })
            .await?;
        if self.vault.crypto.is_unlocked() || self.ensure_vault_crypto_from_cache().await.is_ok() {
            self.apply_event_projection_to_session().await?;
        } else {
            for operation in &operations {
                VaultMetaOperationApplier::new(&mut self.vault.meta).apply(
                    &VaultMetaOperationRequest {
                        operation,
                        requested_at: &created_at,
                    },
                )?;
            }
        }
        self.queue_event_outbox_for_current_provider(&event_id, &bytes)
            .await?;
        self.persist_projection_cache().await?;
        Ok(event_id)
    }

    pub(in crate::manager) async fn apply_event_projection_to_session(
        &mut self,
    ) -> Result<(), NookError> {
        self.ensure_vault_crypto_from_cache().await?;
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        let projection = VaultProjection::from_graph(&graph, &self.vault.store_id)?;
        let live = projection.live_secrets(&graph);
        let user_records: Vec<nook_core::StoredSecretRecord> = live.into_values().collect();
        self.vault.password_entries = projection.password_entries;
        self.vault.unlock = VaultUnlock::Keys;
        VaultUserRecordBatch::new(user_records).replace(&mut self.vault.meta);
        self.vault.mark_search_catalog_dirty();
        VaultMetaGraphProjection::new(&graph).materialize(&mut self.vault.meta)?;
        self.ensure_sentinel_architecture_from_shares()?;
        if let Ok(identity) = self.device_identity() {
            drop(self.maybe_sync_self_into_roster(&identity));
        }
        Ok(())
    }

    /// Materialize join/share meta from the local event graph without vault keys.
    /// Used by locked sentinel joiners before the opened-share ceremony.
    pub(in crate::manager) async fn materialize_vault_meta_from_events(
        &mut self,
    ) -> Result<(), NookError> {
        if self.vault.store_id.is_empty() {
            return Ok(());
        }
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        VaultMetaGraphProjection::new(&graph).materialize(&mut self.vault.meta)?;
        self.ensure_sentinel_architecture_from_shares()?;
        Ok(())
    }

    /// Hydrate locked-session projection fields from the event graph.
    ///
    /// Import-as-new-vault runs while locked, so `apply_event_projection_to_session`
    /// cannot decrypt secrets. Auth rows and backup-password envelopes still must
    /// land in the cached YAML so login assess/unlock see the real vault.
    pub(in crate::manager) async fn hydrate_locked_projection_from_events(
        &mut self,
    ) -> Result<(), NookError> {
        if self.vault.store_id.trim().is_empty() {
            return Ok(());
        }
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        let projection = VaultProjection::from_graph(&graph, &self.vault.store_id)?;
        self.vault.password_entries = projection.password_entries;
        VaultMetaGraphProjection::new(&graph).materialize(&mut self.vault.meta)?;
        self.ensure_sentinel_architecture_from_shares()?;
        Ok(())
    }

    pub(in crate::manager) async fn persist_projection_cache(&mut self) -> Result<(), NookError> {
        let records = self.vault.meta.to_stored_records();
        let yaml = nook_core::VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
            &records,
            &self.vault.unlock,
            &self.vault.password_entries,
            VaultStoreIdentityRef::Assigned(self.vault.store_id.as_str()),
            match &self.vault.vault_name {
                VaultNameState::Unnamed => VaultNameRef::Unnamed,
                VaultNameState::Named(name) => VaultNameRef::Named(name),
            },
            VaultVersionWrite::Initial,
            &self.vault.architecture,
        )?;
        NookDatabase::save_to_indexed_db(yaml.as_str()).await?;
        self.vault.last_synced_content = yaml.into_inner();
        Ok(())
    }

    pub(in crate::manager) async fn load_projection_conflicts(
        &self,
    ) -> Result<nook_core::VaultProjection, NookError> {
        if self.vault.store_id.is_empty() {
            return Ok(VaultProjection::default());
        }
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        Ok(VaultProjection::from_graph(&graph, &self.vault.store_id)?)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
#[path = "event_log_browser_tests.rs"]
mod browser_tests;
