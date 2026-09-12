//! Durable outbox publication states.
use super::{
    BTreeSet, EventDbRemoveOutboxEntry, EventId, EventStorageBytes, NookDatabase, NookError,
    NookVaultManager,
};

pub(super) enum OutboxIndexScope {
    Unrestricted,
    CurrentVault(BTreeSet<EventId>),
}
pub(super) struct PendingOutboxEvent<'a> {
    pub(super) provider_id: &'a str,
    pub(super) event_id: EventId,
    pub(super) bytes: EventStorageBytes,
    pub(super) local_ids: &'a OutboxIndexScope,
}

pub(super) struct PublishedOutboxEvent<'a> {
    pub(super) provider_id: &'a str,
    pub(super) event_id: EventId,
}

impl PendingOutboxEvent<'_> {
    pub(super) fn is_current(&self) -> bool {
        match self.local_ids {
            OutboxIndexScope::Unrestricted => true,
            OutboxIndexScope::CurrentVault(ids) => ids.contains(&self.event_id),
        }
    }

    pub(super) async fn discard(self) -> Result<(), NookError> {
        NookDatabase::remove_outbox_entry(EventDbRemoveOutboxEntry {
            provider_id: self.provider_id,
            event_id: self.event_id.as_str(),
        })
        .await
    }
}

impl<'a> PendingOutboxEvent<'a> {
    pub(super) async fn publish(
        self,
        manager: &NookVaultManager,
    ) -> Result<PublishedOutboxEvent<'a>, NookError> {
        // Always put-if-absent: a listed remote name may be unreadable junk.
        manager
            .put_current_provider_event_if_absent(&self.event_id, self.bytes.as_ref())
            .await?;
        Ok(PublishedOutboxEvent {
            provider_id: self.provider_id,
            event_id: self.event_id,
        })
    }
}

impl PublishedOutboxEvent<'_> {
    pub(super) async fn acknowledge(self) -> Result<EventId, NookError> {
        NookDatabase::remove_outbox_entry(EventDbRemoveOutboxEntry {
            provider_id: self.provider_id,
            event_id: self.event_id.as_str(),
        })
        .await?;
        Ok(self.event_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{EventDbAppendOutboxIndex, EventDbQueueOutboxEntry};
    use nook_core::StorageMode;
    use wasm_bindgen_test::wasm_bindgen_test;
    impl OutboxFixture {
        async fn queue(&self) -> Result<PendingOutboxEvent<'_>, NookError> {
            NookDatabase::queue_outbox_entry(EventDbQueueOutboxEntry {
                provider_id: &self.provider_id,
                event_id: self.event_id.as_str(),
                bytes: &self.bytes,
            })
            .await?;
            NookDatabase::append_outbox_index(EventDbAppendOutboxIndex {
                provider_id: &self.provider_id,
                event_id: self.event_id.as_str(),
            })
            .await?;
            Ok(PendingOutboxEvent {
                provider_id: &self.provider_id,
                event_id: self.event_id.clone(),
                bytes: self.bytes.clone().into(),
                local_ids: &OutboxIndexScope::Unrestricted,
            })
        }
    }
    struct OutboxFixture {
        provider_id: String,
        event_id: EventId,
        bytes: Vec<u8>,
    }
    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn outbox_publication_failure_and_durable_completion() -> anyhow::Result<()> {
        let fixture = OutboxFixture {
            provider_id: format!("outbox-lifecycle-{}", nook_core::StoreId::generate()?),
            event_id: EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?,
            bytes: b"invalid event fixture".to_vec(),
        };
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::Github;
        match fixture.queue().await?.publish(&manager).await {
            Err(NookError::Serialization(message)) => {
                assert!(message.starts_with("GitHub event parse:"));
            }
            Err(_) => anyhow::bail!("unexpected publication failure"),
            Ok(_) => anyhow::bail!("malformed event was published"),
        }
        assert_eq!(
            NookDatabase::load_outbox(&fixture.provider_id).await?,
            vec![(fixture.event_id.to_string(), fixture.bytes.clone())]
        );
        let excluded = OutboxIndexScope::CurrentVault(BTreeSet::new());
        let mut pending = fixture.queue().await?;
        pending.local_ids = &excluded;
        assert!(!pending.is_current());
        pending.discard().await?;
        assert!(
            NookDatabase::load_outbox(&fixture.provider_id)
                .await?
                .is_empty()
        );

        // Dropping an unpolled publication leaves the durable row intact.
        drop(fixture.queue().await?.publish(&manager));
        assert_eq!(
            NookDatabase::load_outbox(&fixture.provider_id).await?,
            vec![(fixture.event_id.to_string(), fixture.bytes.clone())]
        );
        // Exercise durable acknowledgement independently of remote publication.
        let published = PublishedOutboxEvent {
            provider_id: &fixture.provider_id,
            event_id: fixture.event_id.clone(),
        };
        assert_eq!(published.acknowledge().await?, fixture.event_id);
        assert!(
            NookDatabase::load_outbox(&fixture.provider_id)
                .await?
                .is_empty()
        );
        Ok(())
    }
    #[test]
    fn durable_outbox_rejects_an_event_removed_from_the_active_index() -> anyhow::Result<()> {
        let retained = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let quarantined = EventId::parse(&format!("sha256u:{}", "E".repeat(43)))?;
        let local_ids = OutboxIndexScope::CurrentVault(BTreeSet::from([retained.clone()]));
        let empty = OutboxIndexScope::CurrentVault(BTreeSet::new());
        for (index, event_id, expected) in [
            (&OutboxIndexScope::Unrestricted, retained.clone(), true),
            (&local_ids, retained, true),
            (&local_ids, quarantined.clone(), false),
            (&empty, quarantined, false),
        ] {
            let pending = PendingOutboxEvent {
                provider_id: "index-fixture",
                event_id,
                bytes: Vec::new().into(),
                local_ids: index,
            };
            assert_eq!(pending.is_current(), expected);
        }
        Ok(())
    }
}
