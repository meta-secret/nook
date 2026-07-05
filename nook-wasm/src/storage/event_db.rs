//! `IndexedDB` persistence for the immutable vault event log.

use crate::NookError;
use nook_core::{EventId, LocalEventStore};

const EVENT_LOG_MODE_KEY: &str = "event_log:mode";
const SIGNING_SEED_KEY: &str = "signing_seed";
const EVENT_LOG_ACTIVE: &str = "event_log";
const STORE_VAULT: &str = "vault";
const STORE_EVENTS: &str = "events";
const STORE_PROJECTIONS: &str = "projections";
const STORE_OUTBOX: &str = "outbox";
const EVENT_LOG_V2_MIGRATION_KEY: &str = "event_log:v2_migrated";
const EVENT_LOG_V2_MIGRATION_DONE: &str = "done";

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

fn source_backup_key(store_id: &str) -> String {
    format!("source_backup:{store_id}")
}

async fn vault_get(key: &str) -> Result<Option<String>, NookError> {
    store_get(STORE_VAULT, key).await
}

async fn open_nook_db() -> Result<rexie::Rexie, NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(2)
        .add_object_store(rexie::ObjectStore::new(STORE_VAULT))
        .add_object_store(rexie::ObjectStore::new(STORE_EVENTS))
        .add_object_store(rexie::ObjectStore::new(STORE_PROJECTIONS))
        .add_object_store(rexie::ObjectStore::new("provider_receipts"))
        .add_object_store(rexie::ObjectStore::new(STORE_OUTBOX))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {e:?}")))?;
    migrate_legacy_event_log_state(&rexie).await?;
    Ok(rexie)
}

fn legacy_event_log_target_store(key: &str) -> Option<&'static str> {
    if key.starts_with("event_heads:")
        || key.starts_with("event_epoch:")
        || key.starts_with("source_backup:")
    {
        return Some(STORE_PROJECTIONS);
    }
    if key.starts_with("event_index:") || key.starts_with("event:") {
        return Some(STORE_EVENTS);
    }
    if key.starts_with("outbox_index:") || key.starts_with("outbox:") {
        return Some(STORE_OUTBOX);
    }
    None
}

async fn migrate_legacy_event_log_state(rexie: &rexie::Rexie) -> Result<(), NookError> {
    let transaction = rexie
        .transaction(
            &[STORE_VAULT, STORE_EVENTS, STORE_PROJECTIONS, STORE_OUTBOX],
            rexie::TransactionMode::ReadWrite,
        )
        .map_err(|e| NookError::IndexedDb(format!("Migration transaction error: {e:?}")))?;
    let vault = transaction
        .store(STORE_VAULT)
        .map_err(|e| NookError::IndexedDb(format!("Migration vault store error: {e:?}")))?;
    let marker_key = serde_wasm_bindgen::to_value(EVENT_LOG_V2_MIGRATION_KEY)
        .map_err(|e| NookError::IndexedDb(format!("Migration key serialization error: {e:?}")))?;
    if let Some(marker) = vault
        .get(marker_key.clone())
        .await
        .map_err(|e| NookError::IndexedDb(format!("Migration marker read error: {e:?}")))?
        && serde_wasm_bindgen::from_value::<String>(marker)
            .ok()
            .as_deref()
            == Some(EVENT_LOG_V2_MIGRATION_DONE)
    {
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!("Migration transaction done error: {e:?}"))
        })?;
        return Ok(());
    }

    let events = transaction
        .store(STORE_EVENTS)
        .map_err(|e| NookError::IndexedDb(format!("Migration events store error: {e:?}")))?;
    let projections = transaction
        .store(STORE_PROJECTIONS)
        .map_err(|e| NookError::IndexedDb(format!("Migration projections store error: {e:?}")))?;
    let outbox = transaction
        .store(STORE_OUTBOX)
        .map_err(|e| NookError::IndexedDb(format!("Migration outbox store error: {e:?}")))?;

    for (raw_key, raw_value) in vault
        .scan(None, None, None, None)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Migration vault scan error: {e:?}")))?
    {
        let Ok(key) = serde_wasm_bindgen::from_value::<String>(raw_key) else {
            continue;
        };
        let Some(target_store) = legacy_event_log_target_store(&key) else {
            continue;
        };
        let Ok(value) = serde_wasm_bindgen::from_value::<String>(raw_value) else {
            continue;
        };
        let target = match target_store {
            STORE_EVENTS => &events,
            STORE_PROJECTIONS => &projections,
            STORE_OUTBOX => &outbox,
            _ => continue,
        };
        let js_key = serde_wasm_bindgen::to_value(&key).map_err(|e| {
            NookError::IndexedDb(format!("Migration key serialization error: {e:?}"))
        })?;
        if target
            .get(js_key.clone())
            .await
            .map_err(|e| NookError::IndexedDb(format!("Migration target read error: {e:?}")))?
            .is_none()
        {
            let js_value = serde_wasm_bindgen::to_value(&value).map_err(|e| {
                NookError::IndexedDb(format!("Migration value serialization error: {e:?}"))
            })?;
            target.put(&js_value, Some(&js_key)).await.map_err(|e| {
                NookError::IndexedDb(format!("Migration target write error: {e:?}"))
            })?;
        }
    }

    let marker_value = serde_wasm_bindgen::to_value(EVENT_LOG_V2_MIGRATION_DONE)
        .map_err(|e| NookError::IndexedDb(format!("Migration value serialization error: {e:?}")))?;
    vault
        .put(&marker_value, Some(&marker_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Migration marker write error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Migration transaction done error: {e:?}")))?;
    Ok(())
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

/// Preserve the source projection bytes byte-for-byte (first write wins).
pub(crate) async fn save_source_backup_if_absent(
    store_id: &str,
    content: &str,
) -> Result<bool, NookError> {
    let key = source_backup_key(store_id);
    if store_get(STORE_PROJECTIONS, &key).await?.is_some() {
        return Ok(false);
    }
    store_put(STORE_PROJECTIONS, &key, content).await?;
    Ok(true)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_event_log_keys_route_to_v2_stores() {
        assert_eq!(
            legacy_event_log_target_store("event_heads:store_abc"),
            Some(STORE_PROJECTIONS)
        );
        assert_eq!(
            legacy_event_log_target_store("event_epoch:store_abc"),
            Some(STORE_PROJECTIONS)
        );
        assert_eq!(
            legacy_event_log_target_store("source_backup:store_abc"),
            Some(STORE_PROJECTIONS)
        );
        assert_eq!(
            legacy_event_log_target_store(
                "event:store_abc:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
            Some(STORE_EVENTS)
        );
        assert_eq!(
            legacy_event_log_target_store("event_index:store_abc"),
            Some(STORE_EVENTS)
        );
        assert_eq!(
            legacy_event_log_target_store("outbox:provider:sha256:abc"),
            Some(STORE_OUTBOX)
        );
        assert_eq!(
            legacy_event_log_target_store("outbox_index:provider"),
            Some(STORE_OUTBOX)
        );
        assert_eq!(legacy_event_log_target_store("encrypted_db"), None);
    }
}
