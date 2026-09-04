//! Crash-resumable cleanup journal for destructive local identity recovery.

use crate::storage::indexed_db;
use rexie::TransactionMode;

use crate::{NookError, storage::open_nook_database};
use serde::{Deserialize, Serialize};

pub(crate) const PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY: &str =
    "pending_local_identity_recovery_cleanup_v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct LocalIdentityRecovery {
    pub(crate) retired_app_id: Option<nook_core::AppId>,
    pub(crate) has_remaining_local_identities: bool,
}

pub(super) async fn load_pending_recovery_cleanup(
    store: &rexie::Store,
) -> Result<Option<LocalIdentityRecovery>, NookError> {
    let key = serde_wasm_bindgen::to_value(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Recovery cleanup key error: {error:?}")))?;
    let Some(value) = store
        .get(key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Recovery cleanup read error: {error:?}")))?
        .filter(|value| !value.is_undefined() && !value.is_null())
    else {
        return Ok(None);
    };
    let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
        NookError::IndexedDb(format!("Recovery cleanup value error: {error:?}"))
    })?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| NookError::IndexedDb(format!("Recovery cleanup decode error: {error}")))
}

pub(crate) async fn has_pending_identity_recovery_cleanup() -> Result<bool, NookError> {
    Ok(
        indexed_db::idb_get_string(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
            .await?
            .is_some(),
    )
}

pub(super) async fn write_pending_recovery_cleanup(
    store: &rexie::Store,
    recovery: &LocalIdentityRecovery,
) -> Result<(), NookError> {
    let raw = serde_json::to_string(recovery)
        .map_err(|error| NookError::IndexedDb(format!("Recovery cleanup encode error: {error}")))?;
    let key = serde_wasm_bindgen::to_value(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Recovery cleanup key error: {error:?}")))?;
    let value = serde_wasm_bindgen::to_value(&raw).map_err(|error| {
        NookError::IndexedDb(format!("Recovery cleanup value error: {error:?}"))
    })?;
    store.put(&value, Some(&key)).await.map_err(|error| {
        NookError::IndexedDb(format!("Recovery cleanup write error: {error:?}"))
    })?;
    Ok(())
}

pub(crate) async fn complete_identity_recovery_cleanup(
    recovery: &LocalIdentityRecovery,
) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup completion error: {error:?}"))
        })?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!(
            "Recovery cleanup completion store error: {error:?}"
        ))
    })?;
    if let Some(pending) = load_pending_recovery_cleanup(&store).await? {
        if pending != *recovery {
            return Err(NookError::Database(
                "Recovery cleanup target changed before completion".to_owned(),
            ));
        }
        let key = serde_wasm_bindgen::to_value(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
            .map_err(|error| {
                NookError::IndexedDb(format!("Recovery cleanup delete key error: {error:?}"))
            })?;
        store.delete(key).await.map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup delete error: {error:?}"))
        })?;
    }
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Recovery cleanup completion error: {error:?}"))
    })?;
    Ok(())
}
