//! Event-log export boundary shared by provider and local-folder adapters.

use super::{EventLogStorageRecord, NookError, NookVaultManager};
use crate::NookDatabase;
use nook_core::LocalEventBytes;
use nook_core::VaultEvent;

impl NookVaultManager {
    pub(super) fn export_event_records_from_store(
        store: &nook_core::LocalEventStore,
    ) -> Result<Vec<EventLogStorageRecord>, NookError> {
        let mut records = Vec::new();
        for event_id in store.event_ids() {
            let bytes = match store.get_bytes(&event_id) {
                LocalEventBytes::Stored(bytes) => bytes,
                LocalEventBytes::UnknownEvent => {
                    return Err(NookError::Database(format!(
                        "Event {} missing from local store.",
                        event_id
                    )));
                }
            };
            let event = VaultEvent::parse_event_storage_bytes(&bytes)?;
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
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
        Self::export_event_records_from_store(&store)
    }
}
