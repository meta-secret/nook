#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Contextual event rows and vault indexes within one live `IndexedDB` transaction.
use super::VaultEventPersistence;
use crate::{NookError, storage};
use nook_core::{EventId, LocalEventStore};
use rexie::{Rexie, Store, Transaction, TransactionMode};
use std::collections::BTreeSet;
use std::rc::Rc;

const STORE_EVENTS: &str = "events";
const STORE_PROJECTIONS: &str = "projections";

#[derive(Clone, Copy)]
pub(super) enum AppendKind {
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
pub(super) struct EventTransaction {
    _connection: Rc<Rexie>,
    transaction: Transaction,
    pub(super) events: Store,
    pub(super) projections: Store,
    kind: AppendKind,
}
impl EventTransaction {
    pub(super) async fn begin(kind: AppendKind) -> Result<Self, NookError> {
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
    pub(super) async fn complete(self) -> Result<(), NookError> {
        self.transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("{}: {error:?}", self.kind.completion_context()))
        })?;
        Ok(())
    }
}
pub(super) struct EventString<'a> {
    pub(super) store: &'a Store,
    pub(super) key: &'a str,
    pub(super) context: &'static str,
}
pub(super) struct TransactionEvents<'a> {
    pub(super) store: &'a Store,
    pub(super) vault: VaultEventPersistence<'a>,
}
pub(super) struct PersistedEventIds<'a> {
    pub(super) ids: &'a [String],
}
impl EventString<'_> {
    pub(super) async fn read(&self) -> Result<Option<String>, NookError> {
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
    pub(super) async fn put(&self, value: &str) -> Result<(), NookError> {
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
    pub(super) async fn delete(&self, event_id: &str) -> Result<(), NookError> {
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
    pub(super) fn removed(&self, accepted_ids: &[String]) -> Vec<String> {
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
    pub(super) async fn load(&self) -> Result<(Vec<String>, LocalEventStore), NookError> {
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

#[cfg(test)]
mod tests {
    use super::PersistedEventIds;
    #[test]
    fn remote_contraction_identifies_orphan_rows_for_deletion() {
        let persisted = vec!["accepted".to_owned(), "quarantined".to_owned()];
        let accepted = vec!["accepted".to_owned()];
        assert_eq!(
            PersistedEventIds { ids: &persisted }.removed(&accepted),
            vec!["quarantined".to_owned()]
        );
    }
}
