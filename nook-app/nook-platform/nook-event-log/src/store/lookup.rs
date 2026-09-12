//! Explicit local event storage membership.
use crate::EventStorageBytes;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalEventBytes {
    UnknownEvent,
    Stored(EventStorageBytes),
}
