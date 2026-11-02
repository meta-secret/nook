//! One namespace's immutable events at a provider: the same four operations
//! for every store, and every event read at once.

use futures_util::{StreamExt, TryStreamExt, stream};
use nook_core::{EventId, LocalEventWrite};
use std::collections::BTreeSet;

use super::checked_event_write::CheckedEventWrite;
use super::remote_event::RemoteEventRead;
use crate::NookError;

/// One namespace's events at a provider.
pub(crate) trait EventStore {
    /// Reads one namespace keeps in flight at once.
    const READ_CONCURRENCY: usize = 8;

    /// The events the namespace holds.
    async fn event_ids(&self) -> Result<BTreeSet<EventId>, NookError>;

    /// One event's stored bytes, or that the namespace does not hold it.
    async fn read(&self, event_id: &EventId) -> Result<RemoteEventRead, NookError>;

    /// Create one checked event. The same event already stored is a success;
    /// other bytes under its id fail.
    async fn put_checked(&self, event: CheckedEventWrite<'_>) -> Result<(), NookError>;

    /// Delete everything the namespace holds.
    async fn delete_events(&self) -> Result<(), NookError>;

    /// Every event, read and not yet verified. One that vanished between the
    /// listing and its read is left out.
    async fn events(&self) -> Result<Vec<LocalEventWrite>, NookError> {
        let reads: Vec<StoredEventRead> = stream::iter(self.event_ids().await?)
            .map(|event_id| async move {
                let read = self.read(&event_id).await?;
                Ok::<_, NookError>(StoredEventRead { event_id, read })
            })
            .buffered(Self::READ_CONCURRENCY)
            .try_collect()
            .await?;
        Ok(reads
            .into_iter()
            .flat_map(StoredEventRead::into_events)
            .collect())
    }
}

/// One listed event and what reading it found.
pub(crate) struct StoredEventRead {
    pub(crate) event_id: EventId,
    pub(crate) read: RemoteEventRead,
}

impl StoredEventRead {
    /// The retrieved event, or none for one that vanished since the listing.
    pub(crate) fn into_events(self) -> Vec<LocalEventWrite> {
        match self.read {
            RemoteEventRead::Retrieved(bytes) => vec![LocalEventWrite {
                event_id: self.event_id,
                bytes,
            }],
            RemoteEventRead::Unavailable => Vec::new(),
        }
    }
}
