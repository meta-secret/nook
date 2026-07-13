//! `IndexedDB` persistence for the immutable vault event log.

use crate::NookError;
use nook_core::{EventId, LocalEventStore};

const EVENT_LOG_MODE_KEY: &str = "event_log:mode";
const SIGNING_SEED_KEY: &str = "signing_seed";
const EVENT_LOG_ACTIVE: &str = "event_log";
const STORE_VAULT: &str = "vault";
const STORE_EVENTS: &str = "events";
const STORE_PROJECTIONS: &str = "projections";
const STORE_PROVIDER_RECEIPTS: &str = "provider_receipts";
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

async fn open_nook_db() -> Result<rexie::Rexie, NookError> {
    rexie::Rexie::builder("nook_db")
        .version(2)
        .add_object_store(rexie::ObjectStore::new(STORE_VAULT))
        .add_object_store(rexie::ObjectStore::new(STORE_EVENTS))
        .add_object_store(rexie::ObjectStore::new(STORE_PROJECTIONS))
        .add_object_store(rexie::ObjectStore::new(STORE_PROVIDER_RECEIPTS))
        .add_object_store(rexie::ObjectStore::new(STORE_OUTBOX))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {e:?}")))
}

async fn store_get(store_name: &str, key: &str) -> Result<Option<String>, NookError> {
    let rexie = open_nook_db().await?;
    let transaction = rexie
        .transaction(&[store_name], rexie::TransactionMode::ReadOnly)
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
    let rexie = open_nook_db().await?;
    let transaction = rexie
        .transaction(&[store_name], rexie::TransactionMode::ReadWrite)
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

pub(crate) async fn save_event_bytes(
    store_id: &str,
    event_id: &str,
    bytes: &[u8],
) -> Result<(), NookError> {
    let key = event_key(store_id, event_id);
    let value = String::from_utf8(bytes.to_vec())
        .map_err(|e| NookError::Serialization(format!("Event bytes not UTF-8: {e}")))?;
    store_put(STORE_EVENTS, &key, &value).await?;

    let index_key = format!("event_index:{store_id}");
    let mut ids: Vec<String> = match store_get(STORE_EVENTS, &index_key).await? {
        None => Vec::new(),
        Some(json) => {
            serde_json::from_str(&json).map_err(|e| NookError::Serialization(e.to_string()))?
        }
    };
    if !ids.iter().any(|id| id == event_id) {
        ids.push(event_id.to_owned());
        ids.sort();
        let json =
            serde_json::to_string(&ids).map_err(|e| NookError::Serialization(e.to_string()))?;
        store_put(STORE_EVENTS, &index_key, &json).await?;
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
