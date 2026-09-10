//! Owned provider outbox transitions.
use super::*;
use nook_replication::ReplicaOutboxRemovalResult;
impl LocalEventStore {
    pub fn queue_outbox(mut self, request: LocalOutboxWrite<'_>) -> Self {
        self.replica = self
            .replica
            .queue_outbox(nook_replication::ReplicaOutboxWrite {
                provider_id: request.provider_id,
                event: nook_replication::ReplicaEventWrite {
                    event_id: request.event.event_id,
                    bytes: request.event.bytes.into(),
                },
            })
            .store;
        self
    }
    pub fn dequeue_outbox(mut self, request: LocalOutboxRemoval<'_>) -> LocalOutboxRemoved {
        let removed = self
            .replica
            .dequeue_outbox(&nook_replication::ReplicaOutboxRemoval {
                provider_id: request.provider_id,
                event_id: request.event_id,
            });
        self.replica = removed.store;
        LocalOutboxRemoved {
            store: self,
            removal: match removed.removal {
                ReplicaOutboxRemovalResult::NotQueued => LocalOutboxRemovalResult::NotQueued,
                ReplicaOutboxRemovalResult::Removed(bytes) => {
                    LocalOutboxRemovalResult::Removed(bytes.into())
                }
            },
        }
    }
    #[must_use]
    pub fn pending_outbox(&self, provider_id: &str) -> Vec<(EventId, EventStorageBytes)> {
        self.replica
            .pending_outbox(provider_id)
            .into_iter()
            .map(|(event_id, bytes)| (event_id, bytes.into()))
            .collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn outbox_queue_and_dequeue() -> EventResult<()> {
        let mut local = LocalEventStore::new();
        let id = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        let bytes = EventStorageBytes::from(b"event-bytes".to_vec());
        local = local.queue_outbox(crate::LocalOutboxWrite {
            provider_id: "github",
            event: crate::LocalEventWrite {
                event_id: id.clone(),
                bytes: bytes.clone(),
            },
        });
        assert_eq!(local.pending_outbox("github").len(), 1);
        let dequeued = {
            let removed = local.dequeue_outbox(crate::LocalOutboxRemoval {
                provider_id: "github",
                event_id: &id,
            });
            local = removed.store;
            removed.removal
        };
        let dequeued = match dequeued {
            LocalOutboxRemovalResult::Removed(bytes) => bytes,
            LocalOutboxRemovalResult::NotQueued => return Err(EventError::MissingOutboxEntry),
        };
        assert_eq!(dequeued, bytes);
        assert!(local.pending_outbox("github").is_empty());
        Ok(())
    }
}
