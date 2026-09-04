//! Atomic persistence for verified event appends.

use rexie::TransactionMode;
use std::rc;

use crate::{NookError, storage::open_nook_database};
use nook_core::{EventGraph, EventId, EventInsertStatus, LocalEventStore, VaultEvent};
use std::collections::BTreeSet;

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

async fn delete_event_row(
    events: &rexie::Store,
    store_id: &str,
    event_id: &str,
) -> Result<(), NookError> {
    let key = serde_wasm_bindgen::to_value(&event_key(store_id, event_id))
        .map_err(|error| NookError::IndexedDb(format!("Remote event key error: {error:?}")))?;
    events
        .delete(key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Remote event delete error: {error:?}")))?;
    Ok(())
}

fn removed_persisted_event_ids(persisted_ids: &[String], accepted_ids: &[String]) -> Vec<String> {
    let accepted = accepted_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    persisted_ids
        .iter()
        .filter(|event_id| !accepted.contains(event_id.as_str()))
        .cloned()
        .collect()
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

async fn begin_append_transaction() -> Result<(rc::Rc<rexie::Rexie>, rexie::Transaction), NookError>
{
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(
            &[STORE_EVENTS, STORE_PROJECTIONS],
            TransactionMode::ReadWrite,
        )
        .map_err(|error| NookError::IndexedDb(format!("Event transaction error: {error:?}")))?;
    Ok((rexie, transaction))
}

/// Validate and persist one event and its derived heads atomically.
///
/// The transaction overlaps the same events store as security-epoch commits,
/// so `IndexedDB` serializes their frontier checks and writes across tabs.
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

/// Revalidate and persist a remote set with its derived heads atomically.
///
/// The transaction shares the events store with local appends and epoch-pair
/// commits. A remote union therefore cannot validate one frontier and write
/// into a newer one.
pub(crate) async fn save_verified_remote_events(
    store_id: &str,
    remote_events: &[(EventId, Vec<u8>)],
) -> Result<(Vec<String>, LocalEventStore), NookError> {
    let (_rexie, transaction) = begin_append_transaction().await?;
    let events = transaction
        .store(STORE_EVENTS)
        .map_err(|error| NookError::IndexedDb(format!("Remote events store error: {error:?}")))?;
    let projections = transaction.store(STORE_PROJECTIONS).map_err(|error| {
        NookError::IndexedDb(format!("Remote projections store error: {error:?}"))
    })?;
    let (persisted_ids, mut local) = load_local_store(&events, store_id).await?;
    let heads = nook_core::union_remote_events_and_heads(&mut local, remote_events, store_id)?;
    let graph = local.load_graph(store_id)?;
    if !nook_core::project_vault(&graph, store_id)?
        .security_conflicts
        .is_empty()
    {
        return Err(NookError::Database(
            "Remote events conflict with a concurrent security transition.".to_owned(),
        ));
    }
    for (event_id, bytes) in remote_events {
        if local.get_bytes(event_id).is_none()
            || persisted_ids.iter().any(|id| id == event_id.as_str())
        {
            continue;
        }
        let value = String::from_utf8(bytes.clone())
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        put_string(
            &events,
            &event_key(store_id, event_id.as_str()),
            &value,
            "Remote event",
        )
        .await?;
    }
    let mut ids = local
        .event_ids()
        .into_iter()
        .map(|event_id| event_id.as_str().to_owned())
        .collect::<Vec<_>>();
    ids.sort();
    for event_id in removed_persisted_event_ids(&persisted_ids, &ids) {
        delete_event_row(&events, store_id, &event_id).await?;
    }
    put_string(
        &events,
        &event_index_key(store_id),
        &serde_json::to_string(&ids)
            .map_err(|error| NookError::Serialization(error.to_string()))?,
        "Remote event index",
    )
    .await?;
    put_string(
        &projections,
        &heads_key(store_id),
        &serde_json::to_string(&heads)
            .map_err(|error| NookError::Serialization(error.to_string()))?,
        "Remote event heads",
    )
    .await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!(
            "Remote event transaction completion error: {error:?}"
        ))
    })?;
    Ok((heads, local))
}

#[cfg(test)]
mod tests {
    use super::removed_persisted_event_ids;

    #[test]
    fn remote_contraction_identifies_orphan_rows_for_deletion() {
        let persisted = vec!["accepted".to_owned(), "quarantined".to_owned()];
        let accepted = vec!["accepted".to_owned()];

        assert_eq!(
            removed_persisted_event_ids(&persisted, &accepted),
            vec!["quarantined".to_owned()]
        );
    }
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
