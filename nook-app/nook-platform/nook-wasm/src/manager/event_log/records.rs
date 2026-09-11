//! Serializable records exchanged by the event-log manager.

use nook_core::VaultEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, tsify::Tsify)]
#[tsify(from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEventLogRecord {
    pub event_id: String,
    pub event: VaultEvent,
}

#[derive(Debug, Clone, Deserialize, Serialize, tsify::Tsify)]
#[tsify(into_wasm_abi, hashmap_as_object)]
#[serde(rename_all = "camelCase")]
pub struct EventLogStorageRecord {
    pub event_id: String,
    pub path: String,
    pub event: VaultEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::manager) struct ExtensionEventLogImportStatus {
    pub vault_store_id: String,
    pub event_count: usize,
    pub heads: Vec<String>,
    pub access_granted: bool,
}
