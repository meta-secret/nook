use super::{ExtensionEventLogImportStatus, ExternalEventLogRecord, NookVaultManager};
use crate::NookError;
use crate::manager::{CeremonyState, EventLogSessionState, SyncOutboxState, VaultSessionState};
use crate::storage::event_db::load_local_event_store;
use nook_core::EventId;

impl NookVaultManager {
    fn validate_extension_import_records(
        expected_store_id: &nook_core::StoreId,
        records: &[ExternalEventLogRecord],
    ) -> Result<(), NookError> {
        for record in records {
            let event_id = EventId::parse(&record.event_id)?;
            Self::validate_event_record_id(&event_id, &record.event)?;
            let bytes = nook_core::serialize_event_storage_yaml(&record.event)?;
            let record_store_id = nook_core::remote_event_store_id(&event_id, &bytes)?;
            if record_store_id != *expected_store_id {
                return Err(NookError::Database(format!(
                    "Approved vault store_id {} does not match imported store_id {}.",
                    expected_store_id.as_str(),
                    record_store_id.as_str()
                )));
            }
        }
        Ok(())
    }

    async fn restore_rejected_extension_import(
        &mut self,
        previous_active_store_id: Option<&str>,
        previous_vault: VaultSessionState,
        previous_event_log: EventLogSessionState,
        previous_sync_outbox: SyncOutboxState,
    ) -> Result<(), NookError> {
        self.vault.reset();
        self.vault = previous_vault;
        self.event_log = previous_event_log;
        self.sync_outbox = previous_sync_outbox;
        if let Some(store_id) = previous_active_store_id {
            crate::storage::indexed_db::switch_active_vault(store_id).await?;
        } else {
            crate::storage::indexed_db::clear_active_vault_id().await?;
        }
        Ok(())
    }

    /// Import the website's encrypted event-log projection for the extension.
    ///
    /// The caller transports bytes only. Rust owns every trust decision: the
    /// application capability, protected local device identity, canonical event
    /// ids/signatures, vault store id, and current (non-revoked) device grant.
    pub(in crate::manager) async fn import_extension_event_log_records(
        &mut self,
        expected_store_id: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
        records: Vec<ExternalEventLogRecord>,
    ) -> Result<ExtensionEventLogImportStatus, NookError> {
        if self.application != nook_core::VaultApplication::Extension {
            return Err(NookError::Database(
                "Extension event-log import requires the extension application capability."
                    .to_owned(),
            ));
        }
        if records.is_empty() {
            return Err(NookError::Database(
                "Extension event-log import requires at least one event.".to_owned(),
            ));
        }

        let expected_store_id = nook_core::StoreId::parse(expected_store_id)?;
        let expected_device_id = nook_core::DeviceId::parse(expected_device_id)?;
        let expected_device_public_key =
            nook_core::DevicePublicKey::parse(expected_device_public_key)?;
        let expected_device_signing_public_key =
            nook_core::DeviceSigningPublicKey::parse(expected_device_signing_public_key)?;
        let (stored_device_id, _) = crate::storage::indexed_db::load_wrapped_device_identity()
            .await?
            .ok_or_else(|| {
                NookError::IndexedDb(
                    "Extension device protection must be configured before vault import."
                        .to_owned(),
                )
            })?;
        if stored_device_id != expected_device_id.as_str() {
            return Err(NookError::Decryption(
                "Approved extension device does not match the protected local identity.".to_owned(),
            ));
        }
        Self::validate_extension_import_records(&expected_store_id, &records)?;

        let previous_active_store_id = crate::storage::indexed_db::get_active_vault_id().await?;
        let mut previous_vault = std::mem::take(&mut self.vault);
        let mut previous_event_log = std::mem::take(&mut self.event_log);
        let mut previous_sync_outbox = std::mem::take(&mut self.sync_outbox);
        let import = async {
            let merged = self.sync_external_event_log_records(records).await?;
            if self.vault.store_id != expected_store_id.as_str() {
                return Err(NookError::Database(format!(
                    "Approved vault store_id {} does not match imported store_id {}.",
                    expected_store_id.as_str(),
                    self.vault.store_id
                )));
            }

            let store = load_local_event_store(&self.vault.store_id).await?;
            let graph = store.load_graph(&self.vault.store_id)?;
            let has_active_grant = nook_core::event_graph_has_active_device_access(
                &graph,
                &expected_device_id,
                &expected_device_public_key,
                &expected_device_signing_public_key,
            )?;
            let auth_id = nook_core::dec_auth_id_from_public_key(&expected_device_public_key)?;
            let has_device_envelope = self.vault.meta.auth.contains_key(&auth_id);

            Ok(ExtensionEventLogImportStatus {
                vault_store_id: self.vault.store_id.clone(),
                event_count: merged.len(),
                heads: self.event_log.heads.clone(),
                access_granted: has_active_grant && has_device_envelope,
            })
        }
        .await;
        match import {
            Ok(status) if status.access_granted => {
                previous_vault.reset();
                previous_event_log.reset();
                previous_sync_outbox.reset();
                self.sentinel_genesis = CeremonyState::Inactive;
                self.sentinel_genesis_phase = nook_core::SentinelGenesisPhase::Inactive;
                self.pending_sentinel_genesis_request = CeremonyState::Inactive;
                self.sentinel_unlock = CeremonyState::Inactive;
                Ok(status)
            }
            Ok(status) => {
                self.restore_rejected_extension_import(
                    previous_active_store_id.as_deref(),
                    previous_vault,
                    previous_event_log,
                    previous_sync_outbox,
                )
                .await?;
                Ok(status)
            }
            Err(error) => {
                self.restore_rejected_extension_import(
                    previous_active_store_id.as_deref(),
                    previous_vault,
                    previous_event_log,
                    previous_sync_outbox,
                )
                .await?;
                Err(error)
            }
        }
    }
}
