//! `IndexedDB` persistence for the immutable vault event log.

use crate::{NookDatabase, NookError};
use nook_core::VaultEvent;
mod outbox;
mod security_epoch;

use rexie::TransactionMode;

pub(crate) use security_epoch::{
    EpochPairAppend, EventAppend, RemoteEventUnion, VaultEventPersistence,
};

use std::collections::HashSet;

use nook_core::{EventId, LocalEventStore};

const EVENT_LOG_MODE_KEY: &str = "event_log:mode";
pub(crate) const SIGNING_SEED_KEY: &str = "signing_seed";
const EVENT_LOG_ACTIVE: &str = "event_log";
const STORE_VAULT: &str = "vault";
const STORE_EVENTS: &str = "events";
const STORE_PROJECTIONS: &str = "projections";
const STORE_OUTBOX: &str = "outbox";

/// Named values required by NookDatabase::event_key.
pub(crate) struct EventDbEventKey<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) event_id: &'a str,
}

/// Named values required by NookDatabase::outbox_key.
pub(crate) struct EventDbOutboxKey<'a> {
    pub(crate) provider_id: &'a str,
    pub(crate) event_id: &'a str,
}

/// Named values required by NookDatabase::store_get.
pub(crate) struct EventDbStoreGet<'a> {
    pub(crate) store_name: &'a str,
    pub(crate) key: &'a str,
}

/// Named values required by NookDatabase::vault_put.
pub(crate) struct EventDbVaultPut<'a> {
    pub(crate) key: &'a str,
    pub(crate) value: &'a str,
}

/// Named values required by NookDatabase::store_put.
pub(crate) struct EventDbStorePut<'a> {
    pub(crate) store_name: &'a str,
    pub(crate) key: &'a str,
    pub(crate) value: &'a str,
}

/// Named values required by NookDatabase::store_delete.
pub(crate) struct EventDbStoreDelete<'a> {
    pub(crate) store_name: &'a str,
    pub(crate) key: &'a str,
}

/// Named values required by NookDatabase::remove_event_fixture.
pub(crate) struct EventDbRemoveEventFixture<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) event_id: &'a str,
}

/// Named values required by NookDatabase::save_heads.
pub(crate) struct EventDbSaveHeads<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) heads: &'a [String],
}

/// Named values required by NookDatabase::save_key_epoch.
pub(crate) struct EventDbSaveKeyEpoch<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) epoch: &'a str,
}

/// Named values required by NookDatabase::load_local_event_store_from_store.
pub(crate) struct EventDbLoadLocalEventStoreFromStore<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) store_id: &'a str,
}

/// Named values required by NookDatabase::save_event_bytes.
pub(crate) struct EventDbSaveEventBytes<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) event_id: &'a str,
    pub(crate) bytes: &'a [u8],
}

/// Named values required by NookDatabase::save_event_bytes_to_store.
pub(crate) struct EventDbSaveEventBytesToStore<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) store_id: &'a str,
    pub(crate) event_id: &'a str,
    pub(crate) bytes: &'a [u8],
}

/// Named values required by NookDatabase::queue_outbox_entry.
pub(crate) struct EventDbQueueOutboxEntry<'a> {
    pub(crate) provider_id: &'a str,
    pub(crate) event_id: &'a str,
    pub(crate) bytes: &'a [u8],
}

/// Named values required by NookDatabase::append_outbox_index.
pub(crate) struct EventDbAppendOutboxIndex<'a> {
    pub(crate) provider_id: &'a str,
    pub(crate) event_id: &'a str,
}

/// Named values required by NookDatabase::remove_outbox_entry.
pub(crate) struct EventDbRemoveOutboxEntry<'a> {
    pub(crate) provider_id: &'a str,
    pub(crate) event_id: &'a str,
}

impl NookDatabase {
    fn event_key(request: EventDbEventKey<'_>) -> String {
        let EventDbEventKey { store_id, event_id } = request;
        format!("event:{store_id}:{event_id}")
    }
}

impl NookDatabase {
    fn heads_key(store_id: &str) -> String {
        format!("event_heads:{store_id}")
    }
}

impl NookDatabase {
    fn epoch_key(store_id: &str) -> String {
        format!("event_epoch:{store_id}")
    }
}

impl NookDatabase {
    async fn vault_get(key: &str) -> Result<Option<String>, NookError> {
        NookDatabase::store_get(EventDbStoreGet {
            store_name: STORE_VAULT,
            key: key,
        })
        .await
    }
}

impl NookDatabase {
    async fn store_get(request: EventDbStoreGet<'_>) -> Result<Option<String>, NookError> {
        let EventDbStoreGet { store_name, key } = request;
        let rexie = NookDatabase::open_nook_database().await?;
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
}

impl NookDatabase {
    async fn vault_put(request: EventDbVaultPut<'_>) -> Result<(), NookError> {
        let EventDbVaultPut { key, value } = request;
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_VAULT,
            key: key,
            value: value,
        })
        .await
    }
}

impl NookDatabase {
    async fn store_put(request: EventDbStorePut<'_>) -> Result<(), NookError> {
        let EventDbStorePut {
            store_name,
            key,
            value,
        } = request;
        let rexie = NookDatabase::open_nook_database().await?;
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
}

impl NookDatabase {
    async fn store_delete(request: EventDbStoreDelete<'_>) -> Result<(), NookError> {
        let EventDbStoreDelete { store_name, key } = request;
        let rexie = NookDatabase::open_nook_database().await?;
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
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
impl NookDatabase {
    pub(crate) async fn remove_event_fixture(
        request: EventDbRemoveEventFixture<'_>,
    ) -> Result<(), NookError> {
        let EventDbRemoveEventFixture { store_id, event_id } = request;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_EVENTS,
            key: &NookDatabase::event_key(EventDbEventKey {
                store_id: store_id,
                event_id: event_id,
            }),
        })
        .await
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
impl NookDatabase {
    pub(crate) async fn clear_event_log_mode() -> Result<(), NookError> {
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_VAULT,
            key: EVENT_LOG_MODE_KEY,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn is_event_log_mode() -> Result<bool, NookError> {
        Ok(NookDatabase::vault_get(EVENT_LOG_MODE_KEY)
            .await?
            .is_some_and(|value| value == EVENT_LOG_ACTIVE))
    }
}

impl NookDatabase {
    pub(crate) async fn set_event_log_mode() -> Result<(), NookError> {
        NookDatabase::vault_put(EventDbVaultPut {
            key: EVENT_LOG_MODE_KEY,
            value: EVENT_LOG_ACTIVE,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn load_signing_seed() -> Result<Option<String>, NookError> {
        NookDatabase::vault_get(SIGNING_SEED_KEY).await
    }
}

impl NookDatabase {
    pub(crate) async fn save_signing_seed(seed: &str) -> Result<(), NookError> {
        NookDatabase::vault_put(EventDbVaultPut {
            key: SIGNING_SEED_KEY,
            value: seed,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn load_heads(store_id: &str) -> Result<Vec<String>, NookError> {
        let key = NookDatabase::heads_key(store_id);
        match NookDatabase::store_get(EventDbStoreGet {
            store_name: STORE_PROJECTIONS,
            key: &key,
        })
        .await?
        {
            None => Ok(Vec::new()),
            Some(json) => {
                serde_json::from_str(&json).map_err(|e| NookError::Serialization(e.to_string()))
            }
        }
    }
}

impl NookDatabase {
    pub(crate) async fn save_heads(request: EventDbSaveHeads<'_>) -> Result<(), NookError> {
        let EventDbSaveHeads { store_id, heads } = request;
        let json =
            serde_json::to_string(heads).map_err(|e| NookError::Serialization(e.to_string()))?;
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_PROJECTIONS,
            key: &NookDatabase::heads_key(store_id),
            value: &json,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn load_key_epoch(store_id: &str) -> Result<Option<String>, NookError> {
        let key = NookDatabase::epoch_key(store_id);
        NookDatabase::store_get(EventDbStoreGet {
            store_name: STORE_PROJECTIONS,
            key: &key,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn save_key_epoch(request: EventDbSaveKeyEpoch<'_>) -> Result<(), NookError> {
        let EventDbSaveKeyEpoch { store_id, epoch } = request;
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_PROJECTIONS,
            key: &NookDatabase::epoch_key(store_id),
            value: epoch,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn load_local_event_store(
        store_id: &str,
    ) -> Result<LocalEventStore, NookError> {
        let mut local = LocalEventStore::new();
        let index_key = format!("event_index:{store_id}");
        if let Some(list_json) = NookDatabase::store_get(EventDbStoreGet {
            store_name: STORE_EVENTS,
            key: &index_key,
        })
        .await?
        {
            let ids: Vec<String> = serde_json::from_str(&list_json)
                .map_err(|e| NookError::Serialization(e.to_string()))?;
            for raw_id in ids {
                let key = NookDatabase::event_key(EventDbEventKey {
                    store_id: store_id,
                    event_id: &raw_id,
                });
                if let Some(bytes) = NookDatabase::store_get(EventDbStoreGet {
                    store_name: STORE_EVENTS,
                    key: &key,
                })
                .await?
                    && let Ok(event_id) = EventId::parse(&raw_id)
                {
                    local = local.put_event(nook_core::LocalEventWrite {
                        event_id: event_id,
                        bytes: bytes.into_bytes().into(),
                    });
                }
            }
        }
        Ok(local)
    }
}

impl NookDatabase {
    pub(crate) async fn load_local_event_store_strict(
        store_id: &str,
    ) -> Result<LocalEventStore, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
            .map_err(|error| NookError::IndexedDb(format!("Transaction error: {error:?}")))?;
        let store = transaction
            .store(STORE_EVENTS)
            .map_err(|error| NookError::IndexedDb(format!("Store error: {error:?}")))?;
        let result =
            NookDatabase::load_local_event_store_from_store(EventDbLoadLocalEventStoreFromStore {
                store: &store,
                store_id: store_id,
            })
            .await;
        transaction
            .done()
            .await
            .map_err(|error| NookError::IndexedDb(format!("Transaction done error: {error:?}")))?;
        result
    }
}

/// Load one vault graph from an already-open `events` store.
///
/// Callers use this inside a multi-store transaction when authorization
/// evidence and the resulting security-state write must be one linearizable
/// operation.
impl NookDatabase {
    pub(crate) async fn load_local_event_store_from_store(
        request: EventDbLoadLocalEventStoreFromStore<'_>,
    ) -> Result<LocalEventStore, NookError> {
        let EventDbLoadLocalEventStoreFromStore { store, store_id } = request;
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
            let key: String = serde_wasm_bindgen::from_value(key).map_err(|error| {
                NookError::IndexedDb(format!("Event key decode error: {error:?}"))
            })?;
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
            let key = serde_wasm_bindgen::to_value(&NookDatabase::event_key(EventDbEventKey {
                store_id: store_id,
                event_id: &raw_id,
            }))
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
            let bytes: nook_core::EventStorageBytes = bytes.into_bytes().into();
            let stored_event = VaultEvent::parse_event_storage_bytes(&bytes)?;
            let stored_event_id = stored_event.id()?;
            if stored_event_id != event_id {
                return Err(NookError::IndexedDb(format!(
                    "Event row {raw_id} contains event {stored_event_id}."
                )));
            }
            local = local.put_event(nook_core::LocalEventWrite {
                event_id: event_id,
                bytes: bytes,
            });
        }
        Ok(local)
    }
}

/// Drop a vault's local event-log projection (events, heads, epoch).
///
/// Used when an extension pairing import rejects access so a poisoned or
/// quarantined partial import cannot permanently block later approvals.
impl NookDatabase {
    pub(crate) async fn clear_local_event_store(store_id: &str) -> Result<(), NookError> {
        let index_key = format!("event_index:{store_id}");
        let event_prefix = format!("event:{store_id}:");
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Event cleanup error: {error:?}")))?;
        let store = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("Event cleanup store error: {error:?}"))
        })?;
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
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_PROJECTIONS,
            key: &NookDatabase::heads_key(store_id),
        })
        .await?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_PROJECTIONS,
            key: &NookDatabase::epoch_key(store_id),
        })
        .await?;
        Ok(())
    }
}

impl NookDatabase {
    pub(crate) async fn save_event_bytes(
        request: EventDbSaveEventBytes<'_>,
    ) -> Result<(), NookError> {
        let EventDbSaveEventBytes {
            store_id,
            event_id,
            bytes,
        } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Event transaction error: {error:?}")))?;
        let store = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("Event transaction store error: {error:?}"))
        })?;
        NookDatabase::save_event_bytes_to_store(EventDbSaveEventBytesToStore {
            store: &store,
            store_id: store_id,
            event_id: event_id,
            bytes: bytes,
        })
        .await?;
        transaction.done().await.map(|_| ()).map_err(|error| {
            NookError::IndexedDb(format!("Event transaction completion error: {error:?}"))
        })
    }
}

impl NookDatabase {
    pub(crate) async fn save_event_bytes_to_store(
        request: EventDbSaveEventBytesToStore<'_>,
    ) -> Result<(), NookError> {
        let EventDbSaveEventBytesToStore {
            store,
            store_id,
            event_id,
            bytes,
        } = request;
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
        let event_key = serde_wasm_bindgen::to_value(&NookDatabase::event_key(EventDbEventKey {
            store_id: store_id,
            event_id: event_id,
        }))
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
            let index_value = serde_wasm_bindgen::to_value(&json).map_err(|error| {
                NookError::IndexedDb(format!("Event index value error: {error:?}"))
            })?;
            store
                .put(&index_value, Some(&index_key))
                .await
                .map_err(|error| {
                    NookError::IndexedDb(format!("Event index write error: {error:?}"))
                })?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use nook_core::{EventId, IsoTimestamp, SigningIdentity, VaultOperation};
    use rexie::TransactionMode;

    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn transactional_loader_rejects_missing_indexed_event() -> Result<(), NookError> {
        let store_id = "missing-indexed-event-test";
        let event_id = "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo";
        let index_key = format!("event_index:{store_id}");
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &index_key,
            value: &serde_json::to_string(&vec![event_id])
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
        .await?;

        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
            .map_err(|error| NookError::IndexedDb(format!("Test transaction error: {error:?}")))?;
        let store = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("Test transaction store error: {error:?}"))
        })?;
        let result =
            NookDatabase::load_local_event_store_from_store(EventDbLoadLocalEventStoreFromStore {
                store: &store,
                store_id: store_id,
            })
            .await;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Test transaction completion error: {error:?}"))
        })?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_EVENTS,
            key: &index_key,
        })
        .await?;

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
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &index_key,
            value: "[\"not-an-event-id\"]",
        })
        .await?;
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &NookDatabase::event_key(EventDbEventKey {
                store_id: store_id,
                event_id: "not-an-event-id",
            }),
            value: "event bytes",
        })
        .await?;

        let result = NookDatabase::load_local_event_store_strict(store_id).await;
        NookDatabase::clear_local_event_store(store_id).await?;

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
        let row_key = NookDatabase::event_key(EventDbEventKey {
            store_id: store_id,
            event_id: event_id,
        });
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &row_key,
            value: "event bytes",
        })
        .await?;

        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
            .map_err(|error| NookError::IndexedDb(format!("Test transaction error: {error:?}")))?;
        let store = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("Test transaction store error: {error:?}"))
        })?;
        let result =
            NookDatabase::load_local_event_store_from_store(EventDbLoadLocalEventStoreFromStore {
                store: &store,
                store_id: store_id,
            })
            .await;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Test transaction completion error: {error:?}"))
        })?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_EVENTS,
            key: &row_key,
        })
        .await?;

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
        let row_key = NookDatabase::event_key(EventDbEventKey {
            store_id: store_id,
            event_id: "orphan",
        });
        let index_key = format!("event_index:{store_id}");
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &row_key,
            value: "event bytes",
        })
        .await?;
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &index_key,
            value: "not-json",
        })
        .await?;

        NookDatabase::clear_local_event_store(store_id).await?;

        assert!(
            NookDatabase::store_get(EventDbStoreGet {
                store_name: STORE_EVENTS,
                key: &row_key
            })
            .await?
            .is_none()
        );
        assert!(
            NookDatabase::store_get(EventDbStoreGet {
                store_name: STORE_EVENTS,
                key: &index_key
            })
            .await?
            .is_none()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn malformed_index_is_rejected_before_event_row_write() -> Result<(), NookError> {
        let store_id = "malformed-save-test";
        let event_id = "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo";
        let row_key = NookDatabase::event_key(EventDbEventKey {
            store_id: store_id,
            event_id: event_id,
        });
        let index_key = format!("event_index:{store_id}");
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &index_key,
            value: "not-json",
        })
        .await?;

        assert!(
            NookDatabase::save_event_bytes(EventDbSaveEventBytes {
                store_id: store_id,
                event_id: event_id,
                bytes: b"event bytes"
            })
            .await
            .is_err()
        );
        assert!(
            NookDatabase::store_get(EventDbStoreGet {
                store_name: STORE_EVENTS,
                key: &row_key
            })
            .await?
            .is_none()
        );
        NookDatabase::clear_local_event_store(store_id).await
    }

    #[wasm_bindgen_test]
    async fn transactional_loader_rejects_event_row_with_wrong_id() -> Result<(), NookError> {
        let store_id = nook_core::StoreId::generate()?;
        let indexed_id = "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo";
        let (signing, _) = SigningIdentity::generate()?;
        let actor_id = signing.actor_id()?;
        let key_epoch = EventId::parse(indexed_id)?;
        let (_, event_bytes) = nook_core::AppendEventInput::build(nook_core::AppendEventInput {
            store_id: &store_id,
            actor_id: &actor_id,
            signing_identity: &signing,
            parents: Vec::new(),
            key_epoch: &key_epoch,
            created_at: &IsoTimestamp::from_trusted("2026-08-15T00:00:00Z".to_owned()),
            operations: vec![VaultOperation::VaultImported {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            }],
        })?;
        let index_key = format!("event_index:{store_id}");
        let row_key = NookDatabase::event_key(EventDbEventKey {
            store_id: store_id.as_str(),
            event_id: indexed_id,
        });
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &index_key,
            value: &serde_json::to_string(&vec![indexed_id])
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
        .await?;
        NookDatabase::store_put(EventDbStorePut {
            store_name: STORE_EVENTS,
            key: &row_key,
            value: &String::from_utf8(event_bytes.into())
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
        .await?;

        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&[STORE_EVENTS], TransactionMode::ReadOnly)
            .map_err(|error| NookError::IndexedDb(format!("Test transaction error: {error:?}")))?;
        let store = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("Test transaction store error: {error:?}"))
        })?;
        let result =
            NookDatabase::load_local_event_store_from_store(EventDbLoadLocalEventStoreFromStore {
                store: &store,
                store_id: store_id.as_str(),
            })
            .await;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Test transaction completion error: {error:?}"))
        })?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_EVENTS,
            key: &row_key,
        })
        .await?;
        NookDatabase::store_delete(EventDbStoreDelete {
            store_name: STORE_EVENTS,
            key: &index_key,
        })
        .await?;

        let Err(error) = result else {
            return Err(NookError::Database(
                "Mismatched event row did not fail closed.".to_owned(),
            ));
        };
        assert!(error.to_string().contains("contains event"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn event_projection_rejects_non_utf8_before_persisting() -> Result<(), NookError> {
        let error = NookDatabase::save_event_bytes(EventDbSaveEventBytes {
            store_id: "non-utf8-projection",
            event_id: "event",
            bytes: &[0xff],
        })
        .await;
        assert!(matches!(
            error,
            Err(NookError::Serialization(message)) if message.starts_with("Event bytes not UTF-8:")
        ));
        Ok(())
    }
}
