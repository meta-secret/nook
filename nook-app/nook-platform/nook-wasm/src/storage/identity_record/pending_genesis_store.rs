//! The pending Simple-genesis marker in the identity store.
use super::{PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis};
use crate::storage::identity_record::SimpleGenesisProgress;
use crate::{NookDatabase, NookError};

impl NookDatabase {
    pub(super) async fn load_pending_genesis(
        store: &rexie::Store,
    ) -> Result<SimpleGenesisProgress, NookError> {
        let pending_id =
            serde_wasm_bindgen::to_value(PENDING_SIMPLE_GENESIS_KEY).map_err(|error| {
                NookError::IndexedDb(format!("Pending genesis key error: {error:?}"))
            })?;
        let pending = store.get(pending_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Pending genesis read error: {error:?}"))
        })?;
        let Some(pending) = pending.filter(|pending| !pending.is_undefined() && !pending.is_null())
        else {
            return Ok(SimpleGenesisProgress::NotPending);
        };
        let raw = serde_wasm_bindgen::from_value::<String>(pending).map_err(|error| {
            NookError::IndexedDb(format!("Pending genesis value error: {error:?}"))
        })?;
        PendingSimpleGenesis::decode(&raw).map(SimpleGenesisProgress::pending)
    }
}
