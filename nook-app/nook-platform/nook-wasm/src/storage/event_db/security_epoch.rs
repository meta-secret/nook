#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Transaction-bound persistence for admitted event graphs.
use crate::{NookError, storage};
use nook_core::{EventGraph, EventId, EventInsertStatus, LocalEventStore, VaultEvent};
use rexie::{Rexie, Store, Transaction, TransactionMode};
use std::collections::BTreeSet;
use std::rc::Rc;
const STORE_EVENTS: &str = "events";
const STORE_PROJECTIONS: &str = "projections";
#[cfg(test)]
mod tests;

/// Vault scope only. Admission and commit remain private to each operation.
#[derive(Clone, Copy)]
pub(crate) struct VaultEventPersistence<'a> {
    store_id: &'a str,
}
#[derive(Clone, Copy)]
pub(crate) struct EventAppend<'a> {
    pub(crate) event: &'a VaultEvent,
    pub(crate) bytes: &'a [u8],
}
#[derive(Clone, Copy)]
pub(crate) struct EpochPairAppend<'a> {
    pub(crate) trigger: EventAppend<'a>,
    pub(crate) checkpoint: EventAppend<'a>,
}
#[derive(Clone, Copy)]
pub(crate) struct RemoteEventUnion<'a> {
    pub(crate) events: &'a [(EventId, Vec<u8>)],
}

#[derive(Clone, Copy)]
enum AppendKind {
    Single,
    EpochPair,
    Remote,
}
impl AppendKind {
    fn event_context(self) -> &'static str {
        match self {
            Self::Single => "Event store error",
            Self::EpochPair => "Epoch events store error",
            Self::Remote => "Remote events store error",
        }
    }
    fn projection_context(self) -> &'static str {
        match self {
            Self::Single => "Projection store error",
            Self::EpochPair => "Epoch projections store error",
            Self::Remote => "Remote projections store error",
        }
    }
    fn completion_context(self) -> &'static str {
        match self {
            Self::Single => "Event transaction completion error",
            Self::EpochPair => "Epoch transaction completion error",
            Self::Remote => "Remote event transaction completion error",
        }
    }
}

/// The connection stays alive through completion; stores cannot be substituted after admission.
struct EventTransaction {
    _connection: Rc<Rexie>,
    transaction: Transaction,
    events: Store,
    projections: Store,
    kind: AppendKind,
}
impl EventTransaction {
    async fn begin(kind: AppendKind) -> Result<Self, NookError> {
        let connection = storage::open_nook_database().await?;
        let transaction = connection
            .transaction(
                &[STORE_EVENTS, STORE_PROJECTIONS],
                TransactionMode::ReadWrite,
            )
            .map_err(|error| NookError::IndexedDb(format!("Event transaction error: {error:?}")))?;
        let events = transaction.store(STORE_EVENTS).map_err(|error| {
            NookError::IndexedDb(format!("{}: {error:?}", kind.event_context()))
        })?;
        let projections = transaction.store(STORE_PROJECTIONS).map_err(|error| {
            NookError::IndexedDb(format!("{}: {error:?}", kind.projection_context()))
        })?;
        Ok(Self {
            _connection: connection,
            transaction,
            events,
            projections,
            kind,
        })
    }
    async fn complete(self) -> Result<(), NookError> {
        self.transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("{}: {error:?}", self.kind.completion_context()))
        })?;
        Ok(())
    }
}
struct EventString<'a> {
    store: &'a Store,
    key: &'a str,
    context: &'static str,
}
struct TransactionEvents<'a> {
    store: &'a Store,
    vault: VaultEventPersistence<'a>,
}
struct PersistedEventIds<'a> {
    ids: &'a [String],
}
struct VaultAppendGraph<'a> {
    graph: EventGraph,
    store_id: &'a str,
}
struct EventBytes<'a> {
    event_id: EventId,
    bytes: &'a [u8],
}
/// Graph admission binds these entries to this exact live transaction.
/// Serialized bytes remain the caller's supplied bytes, as before this migration.
///
/// The prepared capability is not part of the public WASM or Rust surface.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::event_db::security_epoch::PreparedEventAppend;
/// ```
struct PreparedEventAppend<'a, 'b> {
    vault: VaultEventPersistence<'a>,
    transaction: EventTransaction,
    ids: Vec<String>,
    graph: EventGraph,
    entries: Vec<EventBytes<'b>>,
}
/// Remote admission likewise cannot be constructed by an external caller.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::event_db::security_epoch::PreparedRemoteUnion;
/// ```
struct PreparedRemoteUnion<'a, 'b> {
    vault: VaultEventPersistence<'a>,
    transaction: EventTransaction,
    persisted_ids: Vec<String>,
    local: LocalEventStore,
    heads: Vec<String>,
    remote_events: &'b [(EventId, Vec<u8>)],
}
impl<'a> VaultEventPersistence<'a> {
    #[must_use]
    pub(crate) fn new(store_id: &'a str) -> Self {
        Self { store_id }
    }
    fn event_key(&self, event_id: &str) -> String {
        format!("event:{}:{event_id}", self.store_id)
    }
    fn index_key(&self) -> String {
        format!("event_index:{}", self.store_id)
    }
    fn heads_key(&self) -> String {
        format!("event_heads:{}", self.store_id)
    }
    pub(crate) async fn append(&self, request: EventAppend<'_>) -> Result<Vec<String>, NookError> {
        self.prepare_append(request).await?.commit().await
    }
    pub(crate) async fn append_epoch_pair(
        &self,
        request: EpochPairAppend<'_>,
    ) -> Result<Vec<String>, NookError> {
        self.prepare_pair(request).await?.commit().await
    }
    pub(crate) async fn union_remote(
        &self,
        request: RemoteEventUnion<'_>,
    ) -> Result<(Vec<String>, LocalEventStore), NookError> {
        self.prepare_union(request).await?.commit().await
    }
    async fn prepare_append<'b>(
        &self,
        request: EventAppend<'b>,
    ) -> Result<PreparedEventAppend<'a, 'b>, NookError> {
        let transaction = EventTransaction::begin(AppendKind::Single).await?;
        let (ids, local) = TransactionEvents {
            store: &transaction.events,
            vault: *self,
        }
        .load()
        .await?;
        let graph = VaultAppendGraph {
            graph: local.load_graph(self.store_id)?,
            store_id: self.store_id,
        };
        let (graph, event_id) = graph.insert(request.event)?;
        Ok(PreparedEventAppend {
            vault: *self,
            transaction,
            ids,
            graph: graph.graph,
            entries: vec![EventBytes {
                event_id,
                bytes: request.bytes,
            }],
        })
    }
    async fn prepare_pair<'b>(
        &self,
        request: EpochPairAppend<'b>,
    ) -> Result<PreparedEventAppend<'a, 'b>, NookError> {
        let transaction = EventTransaction::begin(AppendKind::EpochPair).await?;
        let (ids, local) = TransactionEvents {
            store: &transaction.events,
            vault: *self,
        }
        .load()
        .await?;
        let graph = VaultAppendGraph {
            graph: local.load_graph(self.store_id)?,
            store_id: self.store_id,
        };
        let (graph, trigger_id, checkpoint_id) = graph.insert_pair(request)?;
        Ok(PreparedEventAppend {
            vault: *self,
            transaction,
            ids,
            graph: graph.graph,
            entries: vec![
                EventBytes {
                    event_id: trigger_id,
                    bytes: request.trigger.bytes,
                },
                EventBytes {
                    event_id: checkpoint_id,
                    bytes: request.checkpoint.bytes,
                },
            ],
        })
    }
    async fn prepare_union<'b>(
        &self,
        request: RemoteEventUnion<'b>,
    ) -> Result<PreparedRemoteUnion<'a, 'b>, NookError> {
        let store_id = self.store_id;
        let remote_events = request.events;
        let transaction = EventTransaction::begin(AppendKind::Remote).await?;
        let (persisted_ids, mut local) = TransactionEvents {
            store: &transaction.events,
            vault: *self,
        }
        .load()
        .await?;
        let typed_events = remote_events
            .iter()
            .map(|(event_id, bytes)| (event_id.clone(), bytes.clone().into()))
            .collect::<Vec<_>>();
        let heads = local.union_remote_and_heads(&typed_events, store_id)?;
        let graph = local.load_graph(store_id)?;
        if !nook_core::project_vault(&graph, store_id)?
            .security_conflicts
            .is_empty()
        {
            return Err(NookError::Database(
                "Remote events conflict with a concurrent security transition.".to_owned(),
            ));
        }
        Ok(PreparedRemoteUnion {
            vault: *self,
            transaction,
            persisted_ids,
            local,
            heads,
            remote_events,
        })
    }
}
impl EventString<'_> {
    async fn read(&self) -> Result<Option<String>, NookError> {
        let Self {
            store,
            key,
            context,
        } = *self;
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
                .map_err(|error| {
                    NookError::IndexedDb(format!("{context} decode error: {error:?}"))
                }),
        }
    }
}
impl EventString<'_> {
    async fn put(&self, value: &str) -> Result<(), NookError> {
        let Self {
            store,
            key,
            context,
        } = *self;
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
}
impl TransactionEvents<'_> {
    async fn delete(&self, event_id: &str) -> Result<(), NookError> {
        let events = self.store;
        let store_id = self.vault.store_id;
        let key =
            serde_wasm_bindgen::to_value(&VaultEventPersistence::new(store_id).event_key(event_id))
                .map_err(|error| {
                    NookError::IndexedDb(format!("Remote event key error: {error:?}"))
                })?;
        events.delete(key).await.map_err(|error| {
            NookError::IndexedDb(format!("Remote event delete error: {error:?}"))
        })?;
        Ok(())
    }
}
impl PersistedEventIds<'_> {
    fn removed(&self, accepted_ids: &[String]) -> Vec<String> {
        let persisted_ids = self.ids;
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
}
impl TransactionEvents<'_> {
    async fn load(&self) -> Result<(Vec<String>, LocalEventStore), NookError> {
        let events = self.store;
        let store_id = self.vault.store_id;
        let mut ids: Vec<String> = EventString {
            store: events,
            key: &VaultEventPersistence::new(store_id).index_key(),
            context: "Epoch index",
        }
        .read()
        .await?
        .map(|json| serde_json::from_str(&json))
        .transpose()
        .map_err(|error| NookError::Serialization(error.to_string()))?
        .unwrap_or_default();
        ids.sort();
        let mut local = LocalEventStore::new();
        for raw_id in &ids {
            if let Some(bytes) = (EventString {
                store: events,
                key: &VaultEventPersistence::new(store_id).event_key(raw_id),
                context: "Epoch event",
            })
            .read()
            .await?
                && let Ok(event_id) = EventId::parse(raw_id)
            {
                local.put_event(event_id, bytes.into_bytes().into());
            }
        }
        Ok((ids, local))
    }
}
impl VaultAppendGraph<'_> {
    fn insert(mut self, event: &VaultEvent) -> Result<(Self, EventId), NookError> {
        let store_id = self.store_id;
        let graph = &mut self.graph;
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
        Ok((self, event_id))
    }
}
impl VaultAppendGraph<'_> {
    fn insert_pair(
        mut self,
        request: EpochPairAppend<'_>,
    ) -> Result<(Self, EventId, EventId), NookError> {
        let store_id = self.store_id;
        let graph = &mut self.graph;
        let trigger = request.trigger.event;
        let checkpoint = request.checkpoint.event;
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
        Ok((self, trigger_id, checkpoint_id))
    }
}
impl PreparedEventAppend<'_, '_> {
    async fn commit(self) -> Result<Vec<String>, NookError> {
        let Self {
            vault,
            transaction,
            mut ids,
            graph,
            entries,
        } = self;
        let store_id = vault.store_id;
        let events = &transaction.events;
        let projections = &transaction.projections;

        for EventBytes { event_id, bytes } in entries {
            let value = String::from_utf8(bytes.to_vec())
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            EventString {
                store: events,
                key: &VaultEventPersistence::new(store_id).event_key(event_id.as_str()),
                context: "Epoch event",
            }
            .put(&value)
            .await?;
            if !ids.iter().any(|id| id == event_id.as_str()) {
                ids.push(event_id.as_str().to_owned());
            }
        }
        ids.sort();
        EventString {
            store: events,
            key: &VaultEventPersistence::new(store_id).index_key(),
            context: "Epoch index",
        }
        .put(
            &serde_json::to_string(&ids)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        let heads = graph
            .heads()
            .into_iter()
            .map(EventId::into_inner)
            .collect::<Vec<_>>();
        EventString {
            store: projections,
            key: &VaultEventPersistence::new(store_id).heads_key(),
            context: "Epoch heads",
        }
        .put(
            &serde_json::to_string(&heads)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        transaction.complete().await?;
        Ok(heads)
    }
}
impl PreparedRemoteUnion<'_, '_> {
    async fn commit(self) -> Result<(Vec<String>, LocalEventStore), NookError> {
        let Self {
            vault,
            transaction,
            persisted_ids,
            local,
            heads,
            remote_events,
        } = self;
        let store_id = vault.store_id;
        let events = &transaction.events;
        let projections = &transaction.projections;
        for (event_id, bytes) in remote_events {
            if local.get_bytes(event_id).is_none()
                || persisted_ids.iter().any(|id| id == event_id.as_str())
            {
                continue;
            }
            let value = String::from_utf8(bytes.clone())
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            EventString {
                store: events,
                key: &VaultEventPersistence::new(store_id).event_key(event_id.as_str()),
                context: "Remote event",
            }
            .put(&value)
            .await?;
        }
        let mut ids = local
            .event_ids()
            .into_iter()
            .map(|event_id| event_id.as_str().to_owned())
            .collect::<Vec<_>>();
        ids.sort();
        for event_id in (PersistedEventIds {
            ids: &persisted_ids,
        })
        .removed(&ids)
        {
            TransactionEvents {
                store: events,
                vault: VaultEventPersistence::new(store_id),
            }
            .delete(&event_id)
            .await?;
        }
        EventString {
            store: events,
            key: &VaultEventPersistence::new(store_id).index_key(),
            context: "Remote event index",
        }
        .put(
            &serde_json::to_string(&ids)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        EventString {
            store: projections,
            key: &VaultEventPersistence::new(store_id).heads_key(),
            context: "Remote event heads",
        }
        .put(
            &serde_json::to_string(&heads)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        transaction.complete().await?;
        Ok((heads, local))
    }
}
