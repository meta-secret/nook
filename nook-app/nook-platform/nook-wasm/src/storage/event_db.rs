//! `IndexedDB` persistence for the immutable vault event log.

mod security_epoch;

use rexie::TransactionMode;

pub(crate) use security_epoch::{
    save_security_epoch_event_pair, save_verified_event, save_verified_remote_events,
};

use std::collections::HashSet;

use crate::{NookError, storage::open_nook_database};
use nook_core::{EventId, LocalEventStore};

const EVENT_LOG_MODE_KEY: &str = "event_log:mode";
pub(crate) const SIGNING_SEED_KEY: &str = "signing_seed";
const EVENT_LOG_ACTIVE: &str = "event_log";
const STORE_VAULT: &str = "vault";
const STORE_EVENTS: &str = "events";
const STORE_PROJECTIONS: &str = "projections";
const STORE_OUTBOX: &str = "outbox";

fn event_key(store_id: &str, event_id: &str) -> String {
    format!("event:{store_id}:{event_id}")
}

fn heads_key(store_id: &str) -> String {
    format!("event_heads:{store_id}")
}

fn epoch_key(store_id: &str) -> String {
    format!("event_epoch:{store_id}")
}

fn outbox_key(provider_id: &str, event_id: &str) -> String {
    format!("outbox:{provider_id}:{event_id}")
}

async fn vault_get(key: &str) -> Result<Option<String>, NookError> {
    store_get(STORE_VAULT, key).await
}

async fn store_get(store_name: &str, key: &str) -> Result<Option<String>, NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&[store_name], TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store(store_name)
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let js_key = serde_wasm_bindgen::to_value(key)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let value = store
        .get(js_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    match value {
        None => Ok(None),
        Some(val) if val.is_undefined() || val.is_null() => Ok(None),
        Some(val) => serde_wasm_bindgen::from_value(val)
            .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {e:?}")))
            .map(Some),
    }
}

async fn vault_put(key: &str, value: &str) -> Result<(), NookError> {
    store_put(STORE_VAULT, key, value).await
}

async fn store_put(store_name: &str, key: &str, value: &str) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&[store_name], TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store(store_name)
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let js_key = serde_wasm_bindgen::to_value(key)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let js_value = serde_wasm_bindgen::to_value(value)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    store
        .put(&js_value, Some(&js_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

async fn store_delete(store_name: &str, key: &str) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&[store_name], TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store(store_name)
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let js_key = serde_wasm_bindgen::to_value(key)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    store
        .delete(js_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Delete error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) async fn remove_event_fixture(store_id: &str, event_id: &str) -> Result<(), NookError> {
    store_delete(STORE_EVENTS, &event_key(store_id, event_id)).await
}

pub(crate) async fn is_event_log_mode() -> Result<bool, NookError> {
    Ok(vault_get(EVENT_LOG_MODE_KEY)
        .await?
        .is_some_and(|value| value == EVENT_LOG_ACTIVE))
}

pub(crate) async fn set_event_log_mode() -> Result<(), NookError> {
    vault_put(EVENT_LOG_MODE_KEY, EVENT_LOG_ACTIVE).await
}

pub(crate) async fn load_signing_seed() -> Result<Option<String>, NookError> {
    vault_get(SIGNING_SEED_KEY).await
}

pub(crate) async fn save_signing_seed(seed: &str) -> Result<(), NookError> {
    vault_put(SIGNING_SEED_KEY, seed).await
}

pub(crate) async fn load_heads(store_id: &str) -> Result<Vec<String>, NookError> {
    let key = heads_key(store_id);
    match store_get(STORE_PROJECTIONS, &key).await? {
        None => Ok(Vec::new()),
        Some(json) => {
            serde_json::from_str(&json).map_err(|e| NookError::Serialization(e.to_string()))
        }
    }
}

pub(crate) async fn save_heads(store_id: &str, heads: &[String]) -> Result<(), NookError> {
    let json = serde_json::to_string(heads).map_err(|e| NookError::Serialization(e.to_string()))?;
    store_put(STORE_PROJECTIONS, &heads_key(store_id), &json).await
}

pub(crate) async fn load_key_epoch(store_id: &str) -> Result<Option<String>, NookError> {
    let key = epoch_key(store_id);
    store_get(STORE_PROJECTIONS, &key).await
}

pub(crate) async fn save_key_epoch(store_id: &str, epoch: &str) -> Result<(), NookError> {
    store_put(STORE_PROJECTIONS, &epoch_key(store_id), epoch).await
}

pub(crate) async fn load_local_event_store(store_id: &str) -> Result<LocalEventStore, NookError> {
    let mut local = LocalEventStore::new();
    let index_key = format!("event_index:{store_id}");
    if let Some(list_json) = store_get(STORE_EVENTS, &index_key).await? {
        let ids: Vec<String> = serde_json::from_str(&list_json)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        for raw_id in ids {
            let key = event_key(store_id, &raw_id);
            if let Some(bytes) = store_get(STORE_EVENTS, &key).await?
                && let Ok(event_id) = EventId::parse(&raw_id)
            {
                local.put_event(event_id, bytes.into_bytes());
            }
        }
    }
    Ok(local)
}

pub(crate) async fn load_local_event_store_strict(
    store_id: &str,
) -> Result<LocalEventStore, NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
        .map_err(|error| NookError::IndexedDb(format!("Transaction error: {error:?}")))?;
    let store = transaction
        .store(STORE_EVENTS)
        .map_err(|error| NookError::IndexedDb(format!("Store error: {error:?}")))?;
    let result = load_local_event_store_from_store(&store, store_id).await;
    transaction
        .done()
        .await
        .map_err(|error| NookError::IndexedDb(format!("Transaction done error: {error:?}")))?;
    result
}

/// Load one vault graph from an already-open `events` store.
///
/// Callers use this inside a multi-store transaction when authorization
/// evidence and the resulting security-state write must be one linearizable
/// operation.
pub(crate) async fn load_local_event_store_from_store(
    store: &rexie::Store,
    store_id: &str,
) -> Result<LocalEventStore, NookError> {
    let mut local = LocalEventStore::new();
    let index_key = serde_wasm_bindgen::to_value(&format!("event_index:{store_id}"))
        .map_err(|error| NookError::IndexedDb(format!("Event index key error: {error:?}")))?;
    let index_value = store
        .get(index_key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Event index read error: {error:?}")))?
        .filter(|value| !value.is_undefined() && !value.is_null());
    let ids: Vec<String> = match index_value {
        Some(index_value) => {
            let index_json: String =
                serde_wasm_bindgen::from_value(index_value).map_err(|error| {
                    NookError::IndexedDb(format!("Event index decode error: {error:?}"))
                })?;
            serde_json::from_str(&index_json)
                .map_err(|error| NookError::Serialization(error.to_string()))?
        }
        None => Vec::new(),
    };
    let indexed_ids = ids.iter().cloned().collect::<HashSet<_>>();
    if indexed_ids.len() != ids.len() {
        return Err(NookError::IndexedDb(
            "Event index contains duplicate event IDs.".to_owned(),
        ));
    }
    let event_prefix = format!("event:{store_id}:");
    let mut stored_ids = HashSet::new();
    for key in store
        .get_all_keys(None, None)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Event key scan error: {error:?}")))?
    {
        let key: String = serde_wasm_bindgen::from_value(key)
            .map_err(|error| NookError::IndexedDb(format!("Event key decode error: {error:?}")))?;
        if let Some(event_id) = key.strip_prefix(&event_prefix) {
            stored_ids.insert(event_id.to_owned());
        }
    }
    if let Some(event_id) = indexed_ids.difference(&stored_ids).next() {
        return Err(NookError::IndexedDb(format!(
            "Event index references missing event {event_id}."
        )));
    }
    if let Some(event_id) = stored_ids.difference(&indexed_ids).next() {
        return Err(NookError::IndexedDb(format!(
            "Event row {event_id} is missing from the index."
        )));
    }
    for raw_id in ids {
        let key = serde_wasm_bindgen::to_value(&event_key(store_id, &raw_id))
            .map_err(|error| NookError::IndexedDb(format!("Event key error: {error:?}")))?;
        let value = store
            .get(key)
            .await
            .map_err(|error| NookError::IndexedDb(format!("Event read error: {error:?}")))?
            .filter(|value| !value.is_undefined() && !value.is_null())
            .ok_or_else(|| {
                NookError::IndexedDb(format!("Event index references missing event {raw_id}."))
            })?;
        let bytes: String = serde_wasm_bindgen::from_value(value)
            .map_err(|error| NookError::IndexedDb(format!("Event decode error: {error:?}")))?;
        let event_id = EventId::parse(&raw_id).map_err(|error| {
            NookError::Serialization(format!("Invalid indexed event id {raw_id}: {error}"))
        })?;
        let bytes = bytes.into_bytes();
        let stored_event = nook_core::parse_event_storage_bytes(&bytes)?;
        let stored_event_id = stored_event.id()?;
        if stored_event_id != event_id {
            return Err(NookError::IndexedDb(format!(
                "Event row {raw_id} contains event {stored_event_id}."
            )));
        }
        local.put_event(event_id, bytes);
    }
    Ok(local)
}

/// Drop a vault's local event-log projection (events, heads, epoch).
///
/// Used when an extension pairing import rejects access so a poisoned or
/// quarantined partial import cannot permanently block later approvals.
pub(crate) async fn clear_local_event_store(store_id: &str) -> Result<(), NookError> {
    let index_key = format!("event_index:{store_id}");
    let event_prefix = format!("event:{store_id}:");
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&[STORE_EVENTS], TransactionMode::ReadWrite)
        .map_err(|error| NookError::IndexedDb(format!("Event cleanup error: {error:?}")))?;
    let store = transaction
        .store(STORE_EVENTS)
        .map_err(|error| NookError::IndexedDb(format!("Event cleanup store error: {error:?}")))?;
    for key in store
        .get_all_keys(None, None)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Event cleanup scan error: {error:?}")))?
    {
        let raw: String = serde_wasm_bindgen::from_value(key.clone()).map_err(|error| {
            NookError::IndexedDb(format!("Event cleanup key decode error: {error:?}"))
        })?;
        if raw == index_key || raw.starts_with(&event_prefix) {
            store.delete(key).await.map_err(|error| {
                NookError::IndexedDb(format!("Event cleanup delete error: {error:?}"))
            })?;
        }
    }
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Event cleanup completion error: {error:?}"))
    })?;
    store_delete(STORE_PROJECTIONS, &heads_key(store_id)).await?;
    store_delete(STORE_PROJECTIONS, &epoch_key(store_id)).await?;
    Ok(())
}

pub(crate) async fn save_event_bytes(
    store_id: &str,
    event_id: &str,
    bytes: &[u8],
) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&[STORE_EVENTS], TransactionMode::ReadWrite)
        .map_err(|error| NookError::IndexedDb(format!("Event transaction error: {error:?}")))?;
    let store = transaction.store(STORE_EVENTS).map_err(|error| {
        NookError::IndexedDb(format!("Event transaction store error: {error:?}"))
    })?;
    save_event_bytes_to_store(&store, store_id, event_id, bytes).await?;
    transaction.done().await.map(|_| ()).map_err(|error| {
        NookError::IndexedDb(format!("Event transaction completion error: {error:?}"))
    })
}

pub(crate) async fn save_event_bytes_to_store(
    store: &rexie::Store,
    store_id: &str,
    event_id: &str,
    bytes: &[u8],
) -> Result<(), NookError> {
    let value = String::from_utf8(bytes.to_vec())
        .map_err(|e| NookError::Serialization(format!("Event bytes not UTF-8: {e}")))?;
    let index_key = serde_wasm_bindgen::to_value(&format!("event_index:{store_id}"))
        .map_err(|error| NookError::IndexedDb(format!("Event index key error: {error:?}")))?;
    let index_value = store
        .get(index_key.clone())
        .await
        .map_err(|error| NookError::IndexedDb(format!("Event index read error: {error:?}")))?;
    let mut ids: Vec<String> =
        match index_value.filter(|value| !value.is_undefined() && !value.is_null()) {
            None => Vec::new(),
            Some(value) => {
                let json: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                    NookError::IndexedDb(format!("Event index decode error: {error:?}"))
                })?;
                serde_json::from_str(&json)
                    .map_err(|error| NookError::Serialization(error.to_string()))?
            }
        };
    let event_key = serde_wasm_bindgen::to_value(&event_key(store_id, event_id))
        .map_err(|error| NookError::IndexedDb(format!("Event key error: {error:?}")))?;
    let event_value = serde_wasm_bindgen::to_value(&value)
        .map_err(|error| NookError::IndexedDb(format!("Event value error: {error:?}")))?;
    store
        .put(&event_value, Some(&event_key))
        .await
        .map_err(|error| {
            NookError::IndexedDb(format!("Event transaction write error: {error:?}"))
        })?;
    if !ids.iter().any(|id| id == event_id) {
        ids.push(event_id.to_owned());
        ids.sort();
        let json =
            serde_json::to_string(&ids).map_err(|e| NookError::Serialization(e.to_string()))?;
        let index_value = serde_wasm_bindgen::to_value(&json)
            .map_err(|error| NookError::IndexedDb(format!("Event index value error: {error:?}")))?;
        store
            .put(&index_value, Some(&index_key))
            .await
            .map_err(|error| NookError::IndexedDb(format!("Event index write error: {error:?}")))?;
    }
    Ok(())
}

pub(crate) async fn queue_outbox_entry(
    provider_id: &str,
    event_id: &str,
    bytes: &[u8],
) -> Result<(), NookError> {
    let value = String::from_utf8(bytes.to_vec())
        .map_err(|e| NookError::Serialization(format!("Event bytes not UTF-8: {e}")))?;
    store_put(STORE_OUTBOX, &outbox_key(provider_id, event_id), &value).await
}

pub(crate) async fn load_outbox(provider_id: &str) -> Result<Vec<(String, Vec<u8>)>, NookError> {
    let index_key = format!("outbox_index:{provider_id}");
    let entries = match store_get(STORE_OUTBOX, &index_key).await? {
        None => Vec::new(),
        Some(json) => serde_json::from_str::<Vec<String>>(&json)
            .map_err(|e| NookError::Serialization(e.to_string()))?,
    };
    let mut out = Vec::new();
    for event_id in entries {
        let key = outbox_key(provider_id, &event_id);
        if let Some(text) = store_get(STORE_OUTBOX, &key).await? {
            out.push((event_id, text.into_bytes()));
        }
    }
    Ok(out)
}

pub(crate) async fn append_outbox_index(
    provider_id: &str,
    event_id: &str,
) -> Result<(), NookError> {
    let index_key = format!("outbox_index:{provider_id}");
    let mut ids: Vec<String> = match store_get(STORE_OUTBOX, &index_key).await? {
        None => Vec::new(),
        Some(json) => {
            serde_json::from_str(&json).map_err(|e| NookError::Serialization(e.to_string()))?
        }
    };
    if !ids.iter().any(|id| id == event_id) {
        ids.push(event_id.to_owned());
        let json =
            serde_json::to_string(&ids).map_err(|e| NookError::Serialization(e.to_string()))?;
        store_put(STORE_OUTBOX, &index_key, &json).await?;
    }
    Ok(())
}

pub(crate) async fn remove_outbox_entry(
    provider_id: &str,
    event_id: &str,
) -> Result<(), NookError> {
    store_put(STORE_OUTBOX, &outbox_key(provider_id, event_id), "").await?;
    let index_key = format!("outbox_index:{provider_id}");
    if let Some(json) = store_get(STORE_OUTBOX, &index_key).await? {
        let mut ids: Vec<String> =
            serde_json::from_str(&json).map_err(|e| NookError::Serialization(e.to_string()))?;
        ids.retain(|id| id != event_id);
        let json =
            serde_json::to_string(&ids).map_err(|e| NookError::Serialization(e.to_string()))?;
        store_put(STORE_OUTBOX, &index_key, &json).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use nook_core::{EventId, IsoTimestamp, Sha256Hex, SigningIdentity, VaultOperation};
    use rexie::TransactionMode;

    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn transactional_loader_rejects_missing_indexed_event() -> Result<(), NookError> {
        let store_id = "missing-indexed-event-test";
        let event_id = "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo";
        let index_key = format!("event_index:{store_id}");
        store_put(
            STORE_EVENTS,
            &index_key,
            &serde_json::to_string(&vec![event_id])
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;

        let rexie = open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
            .map_err(|error| NookError::IndexedDb(format!("Test transaction error: {error:?}")))?;
        let store = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("Test transaction store error: {error:?}"))
        })?;
        let result = load_local_event_store_from_store(&store, store_id).await;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Test transaction completion error: {error:?}"))
        })?;
        store_delete(STORE_EVENTS, &index_key).await?;

        let Err(error) = result else {
            return Err(NookError::Database(
                "Missing indexed event did not fail closed.".to_owned(),
            ));
        };
        assert!(error.to_string().contains("references missing event"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn strict_loader_rejects_malformed_indexed_event_id() -> Result<(), NookError> {
        let store_id = "malformed-indexed-id-test";
        let index_key = format!("event_index:{store_id}");
        store_put(STORE_EVENTS, &index_key, "[\"not-an-event-id\"]").await?;
        store_put(
            STORE_EVENTS,
            &event_key(store_id, "not-an-event-id"),
            "event bytes",
        )
        .await?;

        let result = load_local_event_store_strict(store_id).await;
        clear_local_event_store(store_id).await?;

        let Err(error) = result else {
            return Err(NookError::Database(
                "Malformed indexed event ID did not fail closed.".to_owned(),
            ));
        };
        assert!(error.to_string().contains("Invalid indexed event id"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn transactional_loader_rejects_unindexed_event_row() -> Result<(), NookError> {
        let store_id = "unindexed-event-test";
        let event_id = "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo";
        let row_key = event_key(store_id, event_id);
        store_put(STORE_EVENTS, &row_key, "event bytes").await?;

        let rexie = open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
            .map_err(|error| NookError::IndexedDb(format!("Test transaction error: {error:?}")))?;
        let store = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("Test transaction store error: {error:?}"))
        })?;
        let result = load_local_event_store_from_store(&store, store_id).await;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Test transaction completion error: {error:?}"))
        })?;
        store_delete(STORE_EVENTS, &row_key).await?;

        let Err(error) = result else {
            return Err(NookError::Database(
                "Unindexed event row did not fail closed.".to_owned(),
            ));
        };
        assert!(error.to_string().contains("missing from the index"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn cleanup_removes_orphan_rows_even_with_malformed_index() -> Result<(), NookError> {
        let store_id = "malformed-cleanup-test";
        let row_key = event_key(store_id, "orphan");
        let index_key = format!("event_index:{store_id}");
        store_put(STORE_EVENTS, &row_key, "event bytes").await?;
        store_put(STORE_EVENTS, &index_key, "not-json").await?;

        clear_local_event_store(store_id).await?;

        assert!(store_get(STORE_EVENTS, &row_key).await?.is_none());
        assert!(store_get(STORE_EVENTS, &index_key).await?.is_none());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn malformed_index_is_rejected_before_event_row_write() -> Result<(), NookError> {
        let store_id = "malformed-save-test";
        let event_id = "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo";
        let row_key = event_key(store_id, event_id);
        let index_key = format!("event_index:{store_id}");
        store_put(STORE_EVENTS, &index_key, "not-json").await?;

        assert!(
            save_event_bytes(store_id, event_id, b"event bytes")
                .await
                .is_err()
        );
        assert!(store_get(STORE_EVENTS, &row_key).await?.is_none());
        clear_local_event_store(store_id).await
    }

    #[wasm_bindgen_test]
    async fn transactional_loader_rejects_event_row_with_wrong_id() -> Result<(), NookError> {
        let store_id = nook_core::generate_store_id()?;
        let indexed_id = "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo";
        let (signing, _) = SigningIdentity::generate()?;
        let actor_id = signing.actor_id()?;
        let key_epoch = EventId::parse(indexed_id)?;
        let (_, event_bytes) = nook_core::build_signed_event(nook_core::AppendEventInput {
            store_id: &store_id,
            actor_id: &actor_id,
            signing_identity: &signing,
            parents: Vec::new(),
            key_epoch: &key_epoch,
            created_at: &IsoTimestamp::from_trusted("2026-08-15T00:00:00Z".to_owned()),
            operations: vec![VaultOperation::VaultImported {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            }],
        })?;
        let index_key = format!("event_index:{store_id}");
        let row_key = event_key(store_id.as_str(), indexed_id);
        store_put(
            STORE_EVENTS,
            &index_key,
            &serde_json::to_string(&vec![indexed_id])
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        store_put(
            STORE_EVENTS,
            &row_key,
            &String::from_utf8(event_bytes)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;

        let rexie = open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
            .map_err(|error| NookError::IndexedDb(format!("Test transaction error: {error:?}")))?;
        let store = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("Test transaction store error: {error:?}"))
        })?;
        let result = load_local_event_store_from_store(&store, store_id.as_str()).await;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Test transaction completion error: {error:?}"))
        })?;
        store_delete(STORE_EVENTS, &row_key).await?;
        store_delete(STORE_EVENTS, &index_key).await?;

        let Err(error) = result else {
            return Err(NookError::Database(
                "Mismatched event row did not fail closed.".to_owned(),
            ));
        };
        assert!(error.to_string().contains("contains event"));
        Ok(())
    }
}
