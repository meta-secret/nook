//! Requests and outcomes for owned local event-store transitions.
use super::LocalEventStore;
use crate::{EventError, EventId, EventInsertStatus, EventStorageBytes, VaultEvent};

pub struct LocalEventWrite {
    pub event_id: EventId,
    pub bytes: EventStorageBytes,
}
pub struct LocalOutboxWrite<'a> {
    pub provider_id: &'a str,
    pub event: LocalEventWrite,
}
#[derive(Clone, Copy)]
pub struct LocalOutboxRemoval<'a> {
    pub provider_id: &'a str,
    pub event_id: &'a EventId,
}
#[derive(Clone, Copy)]
pub struct LocalEventAppend<'a> {
    pub event: &'a VaultEvent,
    pub store_id: &'a str,
}
#[derive(Debug)]
pub struct LocalEventAppendOutcome {
    pub store: LocalEventStore,
    pub event_id: EventId,
    pub status: EventInsertStatus,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalOutboxRemovalResult {
    NotQueued,
    Removed(EventStorageBytes),
}
#[derive(Debug)]
pub struct LocalOutboxRemoved {
    pub store: LocalEventStore,
    pub removal: LocalOutboxRemovalResult,
}
#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub struct LocalEventStoreRejection {
    pub store: LocalEventStore,
    #[source]
    pub cause: EventError,
}
impl LocalEventStoreRejection {
    #[must_use]
    pub fn into_cause(self) -> EventError {
        self.cause
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejected_store_transition_returns_its_typed_cause() {
        let rejection = LocalEventStoreRejection {
            store: LocalEventStore::new(),
            cause: EventError::MissingEventParents,
        };

        assert!(matches!(
            rejection.into_cause(),
            EventError::MissingEventParents
        ));
    }
}
