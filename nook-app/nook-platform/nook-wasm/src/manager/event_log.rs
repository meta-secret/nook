//! Event-log persistence and provider fan-out.

mod extension_import;
mod import_as_local;
mod provider_io;
mod provider_sync;
mod records;
mod security_epoch;

pub(in crate::manager) use records::{
    EventLogStorageRecord, ExtensionEventLogImportStatus, ExternalEventLogRecord,
};

use super::{EventLogSyncIssueState, NookVaultManager, VaultNameState};
use crate::NookError;
use crate::conversion::wasm_iso_timestamp;
use crate::storage::drive_events::{
    fetch_drive_event_optional, list_drive_event_ids, put_drive_event_if_absent,
};
use crate::storage::event_db::{
    append_outbox_index, is_event_log_mode, load_heads, load_key_epoch, load_local_event_store,
    load_outbox, load_signing_seed, queue_outbox_entry, remove_outbox_entry, save_event_bytes,
    save_heads, save_key_epoch, save_signing_seed, set_event_log_mode,
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
    VaultOperation, apply_user_records_to_encrypted_session, build_signed_event,
    classify_remote_event_log, members_checkpoint_hash_from_roster, project_vault,
    rewrap_vault_meta_for_epoch, rewrapped_vault_meta_records_for_epoch,
    union_remote_events_and_heads,
};

fn iso_timestamp() -> String {
    wasm_iso_timestamp()
}

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
        let store = load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        let projection = project_vault(&graph, &self.vault.store_id)?;
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
                // New devices still mint a signer so they can submit JoinRequested
                // against an existing log. Unauthorized JoinApproved is blocked by
                // the quarantine check in append_vault_operations.
                let (identity, seed) = SigningIdentity::generate()?;
                save_signing_seed(seed.as_str()).await?;
                self.event_log.signing_seed = seed.into_inner();
                return Ok(identity);
            }
        } else {
            // Prefer a durable authorized signer over a transient handoff seed
            // when the vault already has events. Persist in-memory seeds only
            // for empty-log create paths.
            match load_signing_seed().await? {
                Some(stored) if stored != self.event_log.signing_seed => {
                    if self.event_log_has_events().await? {
                        self.event_log.signing_seed = stored;
                    } else {
                        save_signing_seed(&self.event_log.signing_seed).await?;
                    }
                }
                None => {
                    if !self.event_log_has_events().await? {
                        save_signing_seed(&self.event_log.signing_seed).await?;
                    }
                }
                Some(_) => {}
            }
        }
        Ok(SigningIdentity::from_seed_hex_stored(
            &self.event_log.signing_seed,
        )?)
    }

    pub(in crate::manager) async fn load_event_heads(&mut self) -> Result<Vec<String>, NookError> {
        if !self.vault.store_id.is_empty() {
            let store = load_local_event_store(&self.vault.store_id).await?;
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
                        save_heads(&self.vault.store_id, &self.event_log.heads).await?;
                    }
                    return Ok(self.event_log.heads.clone());
                }
            }
            if self.event_log.heads.is_empty() {
                self.event_log.heads = load_heads(&self.vault.store_id).await?;
            }
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
    ) -> Result<EventId, NookError> {
        if self.vault.store_id.is_empty() {
            self.vault.store_id = nook_core::generate_store_id()?.to_string();
        }
        self.activate_event_log_mode().await?;
        let parents = self.load_event_heads().await?;
        let key_epoch = self.ensure_key_epoch().await?;
        let key_epoch = nook_core::EventId::parse(&key_epoch)?;
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
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
        let created_at = nook_core::IsoTimestamp::parse(&iso_timestamp())?;
        let (event, bytes) = build_signed_event(AppendEventInput {
            store_id: &store_id,
            actor_id: &actor_id,
            signing_identity: &signing,
            parents,
            key_epoch: &key_epoch,
            created_at: &created_at,
            operations,
        })?;
        Ok(BuiltVaultEvent { event, bytes })
    }

    pub(super) async fn persist_built_vault_event(
        &mut self,
        built: BuiltVaultEvent,
    ) -> Result<EventId, NookError> {
        let BuiltVaultEvent { event, bytes } = built;
        let event_id = event.id()?;
        let operations = event.body.operations.clone();
        let created_at = event.body.created_at.clone();
        // Refuse to persist events the causal graph would quarantine. Otherwise
        // an unauthorized JoinApproved becomes a permanent poisoned head that
        // blocks later extension pairing imports.
        let local = load_local_event_store(&self.vault.store_id).await?;
        let mut graph = local.load_graph(&self.vault.store_id)?;
        match graph.insert(event.clone(), self.vault.store_id.as_str())? {
            nook_core::EventInsertStatus::Quarantined(reason) => {
                return Err(NookError::Database(format!(
                    "Refusing to append unauthorized vault event: {reason}"
                )));
            }
            nook_core::EventInsertStatus::Pending(reason) => {
                return Err(NookError::Database(format!(
                    "Refusing to append vault event with unresolved parents: {reason:?}"
                )));
            }
            nook_core::EventInsertStatus::Duplicate | nook_core::EventInsertStatus::Applied => {}
        }
        save_event_bytes(&self.vault.store_id, event_id.as_str(), &bytes).await?;
        self.event_log.heads = graph
            .heads()
            .into_iter()
            .map(nook_core::EventId::into_inner)
            .collect();
        save_heads(&self.vault.store_id, &self.event_log.heads).await?;
        if self.vault.crypto.is_unlocked() || self.ensure_vault_crypto_from_cache().await.is_ok() {
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
        Ok(event_id)
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
        apply_user_records_to_encrypted_session(user_records, &mut self.vault.meta);
        self.vault.mark_search_catalog_dirty();
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
        self.ensure_sentinel_architecture_from_shares()?;
        if let Ok(identity) = self.device_identity() {
            let _ = self.maybe_sync_self_into_roster(&identity);
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
        let store = load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
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
        let store = load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        let projection = project_vault(&graph, &self.vault.store_id)?;
        self.vault.password_entries = projection.password_entries;
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
        self.ensure_sentinel_architecture_from_shares()?;
        Ok(())
    }

    pub(in crate::manager) async fn persist_projection_cache(&mut self) -> Result<(), NookError> {
        let records = self.vault.meta.to_stored_records();
        let yaml = nook_core::serialize_stored_yaml_with_unlock_name_architecture(
            &records,
            &self.vault.unlock,
            &self.vault.password_entries,
            nook_core::VaultStoreIdentityRef::Assigned(self.vault.store_id.as_str()),
            match &self.vault.vault_name {
                VaultNameState::Unnamed => nook_core::VaultNameRef::Unnamed,
                VaultNameState::Named(name) => nook_core::VaultNameRef::Named(name),
            },
            nook_core::VaultVersionWrite::Initial,
            &self.vault.architecture,
        )?;
        save_to_indexed_db(yaml.as_str()).await?;
        self.vault.last_synced_content = yaml.into_inner();
        Ok(())
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

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
#[path = "event_log_browser_tests.rs"]
mod browser_tests;
