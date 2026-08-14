//! Atomic persistence for verified event appends.

use crate::{NookError, storage::open_nook_database};
use nook_core::{EventGraph, EventId, EventInsertStatus, LocalEventStore, VaultEvent};

const STORE_EVENTS: &str = "events";
const STORE_PROJECTIONS: &str = "projections";

fn event_key(store_id: &str, event_id: &str) -> String {
    format!("event:{store_id}:{event_id}")
}

fn event_index_key(store_id: &str) -> String {
    format!("event_index:{store_id}")
}

fn heads_key(store_id: &str) -> String {
    format!("event_heads:{store_id}")
}

async fn read_string(
    store: &rexie::Store,
    key: &str,
    context: &str,
) -> Result<Option<String>, NookError> {
    let key = serde_wasm_bindgen::to_value(key)
        .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
    let value = store
        .get(key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("{context} read error: {error:?}")))?;
    match value {
        None => Ok(None),
        Some(value) if value.is_undefined() || value.is_null() => Ok(None),
        Some(value) => serde_wasm_bindgen::from_value(value)
            .map(Some)
            .map_err(|error| NookError::IndexedDb(format!("{context} decode error: {error:?}"))),
    }
}

async fn put_string(
    store: &rexie::Store,
    key: &str,
    value: &str,
    context: &str,
) -> Result<(), NookError> {
    let key = serde_wasm_bindgen::to_value(key)
        .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
    let value = serde_wasm_bindgen::to_value(value)
        .map_err(|error| NookError::IndexedDb(format!("{context} encode error: {error:?}")))?;
    store
        .put(&value, Some(&key))
        .await
        .map_err(|error| NookError::IndexedDb(format!("{context} write error: {error:?}")))?;
    Ok(())
}

async fn load_local_store(
    events: &rexie::Store,
    store_id: &str,
) -> Result<(Vec<String>, LocalEventStore), NookError> {
    let mut ids: Vec<String> = read_string(events, &event_index_key(store_id), "Epoch index")
        .await?
        .map(|json| serde_json::from_str(&json))
        .transpose()
        .map_err(|error| NookError::Serialization(error.to_string()))?
        .unwrap_or_default();
    ids.sort();
    let mut local = LocalEventStore::new();
    for raw_id in &ids {
        if let Some(bytes) =
            read_string(events, &event_key(store_id, raw_id), "Epoch event").await?
            && let Ok(event_id) = EventId::parse(raw_id)
        {
            local.put_event(event_id, bytes.into_bytes());
        }
    }
    Ok((ids, local))
}

fn insert_pair(
    graph: &mut EventGraph,
    store_id: &str,
    trigger: &VaultEvent,
    checkpoint: &VaultEvent,
) -> Result<(EventId, EventId), NookError> {
    let trigger_id = trigger.id()?;
    let checkpoint_id = checkpoint.id()?;
    if checkpoint.body.parents.as_slice() != [trigger_id.clone()]
        || checkpoint.body.key_epoch != trigger_id
    {
        return Err(NookError::Database(
            "Security epoch checkpoint does not directly commit its trigger.".to_owned(),
        ));
    }
    if !graph.contains(&trigger_id) {
        let mut current = graph.heads();
        let mut expected = trigger.body.parents.clone();
        current.sort();
        expected.sort();
        if current != expected {
            return Err(NookError::Database(
                "Vault changed before the security epoch pair could commit.".to_owned(),
            ));
        }
    } else if !graph.contains(&checkpoint_id) && graph.heads() != vec![trigger_id.clone()] {
        return Err(NookError::Database(
            "Vault changed between the security epoch trigger and checkpoint.".to_owned(),
        ));
    }
    for event in [trigger, checkpoint] {
        match graph.insert(event.clone(), store_id)? {
            EventInsertStatus::Applied | EventInsertStatus::Duplicate => {}
            EventInsertStatus::Quarantined(reason) => {
                return Err(NookError::Database(format!(
                    "Refusing conflicting security epoch event: {reason}"
                )));
            }
            EventInsertStatus::Pending(reason) => {
                return Err(NookError::Database(format!(
                    "Refusing security epoch event with unresolved parents: {reason:?}"
                )));
            }
        }
    }
    let projection = nook_core::project_vault(graph, store_id)?;
    if projection.security_conflicts.iter().any(|conflict| {
        conflict.events.contains(&trigger_id) || conflict.events.contains(&checkpoint_id)
    }) {
        return Err(NookError::Database(
            "Concurrent security epoch transition detected; recovery is required.".to_owned(),
        ));
    }
    Ok((trigger_id, checkpoint_id))
}

fn insert_event(
    graph: &mut EventGraph,
    store_id: &str,
    event: &VaultEvent,
) -> Result<EventId, NookError> {
    let event_id = event.id()?;
    if !graph.contains(&event_id) {
        let mut current = graph.heads();
        let mut expected = event.body.parents.clone();
        current.sort();
        expected.sort();
        if current != expected {
            return Err(NookError::Database(
                "Vault changed before the event could commit.".to_owned(),
            ));
        }
    }
    match graph.insert(event.clone(), store_id)? {
        EventInsertStatus::Applied | EventInsertStatus::Duplicate => {}
        EventInsertStatus::Quarantined(reason) => {
            return Err(NookError::Database(format!(
                "Refusing to append unauthorized vault event: {reason}"
            )));
        }
        EventInsertStatus::Pending(reason) => {
            return Err(NookError::Database(format!(
                "Refusing to append vault event with unresolved parents: {reason:?}"
            )));
        }
    }
    Ok(event_id)
}

async fn write_events<const COUNT: usize>(
    events: &rexie::Store,
    projections: &rexie::Store,
    store_id: &str,
    mut ids: Vec<String>,
    graph: &EventGraph,
    entries: [(&EventId, &[u8]); COUNT],
) -> Result<Vec<String>, NookError> {
    for (event_id, bytes) in entries {
        let value = String::from_utf8(bytes.to_vec())
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        put_string(
            events,
            &event_key(store_id, event_id.as_str()),
            &value,
            "Epoch event",
        )
        .await?;
        if !ids.iter().any(|id| id == event_id.as_str()) {
            ids.push(event_id.as_str().to_owned());
        }
    }
    ids.sort();
    put_string(
        events,
        &event_index_key(store_id),
        &serde_json::to_string(&ids)
            .map_err(|error| NookError::Serialization(error.to_string()))?,
        "Epoch index",
    )
    .await?;
    let heads = graph
        .heads()
        .into_iter()
        .map(EventId::into_inner)
        .collect::<Vec<_>>();
    put_string(
        projections,
        &heads_key(store_id),
        &serde_json::to_string(&heads)
            .map_err(|error| NookError::Serialization(error.to_string()))?,
        "Epoch heads",
    )
    .await?;
    Ok(heads)
}

async fn begin_append_transaction(
) -> Result<(rexie::Rexie, rexie::Transaction), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(
            &[STORE_EVENTS, STORE_PROJECTIONS],
            rexie::TransactionMode::ReadWrite,
        )
        .map_err(|error| NookError::IndexedDb(format!("Event transaction error: {error:?}")))?;
    Ok((rexie, transaction))
}

/// Validate and persist one event and its derived heads atomically.
///
/// The transaction overlaps the same events store as security-epoch commits,
/// so IndexedDB serializes their frontier checks and writes across tabs.
pub(crate) async fn save_verified_event(
    store_id: &str,
    event: &VaultEvent,
    bytes: &[u8],
) -> Result<Vec<String>, NookError> {
    let (_rexie, transaction) = begin_append_transaction().await?;
    let events = transaction
        .store(STORE_EVENTS)
        .map_err(|error| NookError::IndexedDb(format!("Event store error: {error:?}")))?;
    let projections = transaction
        .store(STORE_PROJECTIONS)
        .map_err(|error| NookError::IndexedDb(format!("Projection store error: {error:?}")))?;
    let (ids, local) = load_local_store(&events, store_id).await?;
    let mut graph = local.load_graph(store_id)?;
    let event_id = insert_event(&mut graph, store_id, event)?;
    let heads = write_events(
        &events,
        &projections,
        store_id,
        ids,
        &graph,
        [(&event_id, bytes)],
    )
    .await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Event transaction completion error: {error:?}"))
    })?;
    Ok(heads)
}

/// Persist the trigger and checkpoint in one `IndexedDB` transaction.
///
/// Read-write transactions overlapping the events store serialize across tabs.
/// The exact-frontier checks therefore cannot be separated from either write.
pub(crate) async fn save_security_epoch_event_pair(
    store_id: &str,
    trigger: &VaultEvent,
    trigger_bytes: &[u8],
    checkpoint: &VaultEvent,
    checkpoint_bytes: &[u8],
) -> Result<Vec<String>, NookError> {
    let (_rexie, transaction) = begin_append_transaction().await?;
    let events = transaction
        .store(STORE_EVENTS)
        .map_err(|error| NookError::IndexedDb(format!("Epoch events store error: {error:?}")))?;
    let projections = transaction.store(STORE_PROJECTIONS).map_err(|error| {
        NookError::IndexedDb(format!("Epoch projections store error: {error:?}"))
    })?;
    let (ids, local) = load_local_store(&events, store_id).await?;
    let mut graph = local.load_graph(store_id)?;
    let (trigger_id, checkpoint_id) = insert_pair(&mut graph, store_id, trigger, checkpoint)?;
    let heads = write_events(
        &events,
        &projections,
        store_id,
        ids,
        &graph,
        [
            (&trigger_id, trigger_bytes),
            (&checkpoint_id, checkpoint_bytes),
        ],
    )
    .await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Epoch transaction completion error: {error:?}"))
    })?;
    Ok(heads)
}
