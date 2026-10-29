//! Cleanup for completed Simple-vault genesis.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{NookDatabase, NookError};
use rexie::TransactionMode;

use super::{PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis};

/// The genesis marker a connected Simple vault no longer needs.
pub(crate) struct SimpleGenesisCompletion<'a> {
    pub(crate) pending: &'a PendingSimpleGenesis,
}

impl SimpleGenesisCompletion<'_> {
    pub(crate) async fn clear_pending(self) -> Result<(), NookError> {
        let completed = self.pending;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Genesis cleanup error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Genesis cleanup store error: {error:?}"))
        })?;
        let id = serde_wasm_bindgen::to_value(PENDING_SIMPLE_GENESIS_KEY)
            .map_err(|error| NookError::IndexedDb(format!("Genesis key error: {error:?}")))?;
        let current = store.get(id.clone()).await.map_err(|error| {
            NookError::IndexedDb(format!("Genesis cleanup read error: {error:?}"))
        })?;
        if let Some(current) = current.filter(|value| !value.is_undefined() && !value.is_null()) {
            let raw: String = serde_wasm_bindgen::from_value(current).map_err(|error| {
                NookError::IndexedDb(format!("Genesis cleanup decode error: {error:?}"))
            })?;
            let pending = PendingSimpleGenesis::decode(&raw)?;
            if pending.store_id == completed.store_id
                && pending.identity_id == completed.identity_id
                && pending.created_at == completed.created_at
            {
                store.delete(id).await.map_err(|error| {
                    NookError::IndexedDb(format!("Genesis cleanup delete error: {error:?}"))
                })?;
            }
        }
        transaction.done().await.map(|_| ()).map_err(|error| {
            NookError::IndexedDb(format!("Genesis cleanup completion error: {error:?}"))
        })
    }
}
