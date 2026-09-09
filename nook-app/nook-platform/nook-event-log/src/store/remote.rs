#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{LocalEventStore, RemoteEventLogClassification};
use crate::GenesisImportRequest;
use crate::{EventError, EventId, EventResult, EventStorageBytes, StoreId, VaultEvent};
use std::collections::BTreeSet;

/// A remote envelope with a matching content ID, supported schema and actor signature.
/// Graph membership and security-epoch visibility are checked separately.
/// Callers cannot construct a checked envelope from an unchecked event.
///
/// ```compile_fail,E0451
/// use nook_event_log::{CheckedRemoteEvent, VaultEvent};
/// let forge = |event: VaultEvent| CheckedRemoteEvent { event };
/// ```
pub struct CheckedRemoteEvent {
    event: VaultEvent,
}

impl CheckedRemoteEvent {
    pub fn parse(event_id: &EventId, bytes: &EventStorageBytes) -> EventResult<Self> {
        let event = VaultEvent::parse_remote_event_storage_bytes(bytes)?;
        if event.id()? != *event_id {
            return Err(EventError::RemoteEventIdMismatch {
                event_id: event_id.as_str().to_owned(),
            });
        }
        if !event.body.schema_version.is_supported() {
            return Err(EventError::UnsupportedSchemaVersion {
                version: event.body.schema_version,
            });
        }
        event.validate_actor_signature()?;
        Ok(Self { event })
    }
    #[must_use]
    pub fn store_id(&self) -> &StoreId {
        &self.event.body.store_id
    }
    #[must_use]
    pub fn into_store_id(self) -> StoreId {
        self.event.body.store_id
    }
    #[must_use]
    pub fn belongs_to_store(&self, store_id: &str) -> bool {
        self.store_id().as_str() == store_id
    }
}

/// Borrowed provider records; classification validates every envelope before reporting scope.
pub struct RemoteEventBatch<'a> {
    events: &'a [(EventId, EventStorageBytes)],
}
impl<'a> RemoteEventBatch<'a> {
    #[must_use]
    pub fn new(events: &'a [(EventId, EventStorageBytes)]) -> Self {
        Self { events }
    }
    pub fn classify(
        &self,
        active_store_id: Option<&str>,
    ) -> EventResult<RemoteEventLogClassification> {
        let mut remote_store_ids = BTreeSet::new();
        for (event_id, bytes) in self.events {
            remote_store_ids.insert(
                CheckedRemoteEvent::parse(event_id, bytes)?
                    .store_id()
                    .as_str()
                    .to_owned(),
            );
        }

        if remote_store_ids.is_empty() {
            return Ok(RemoteEventLogClassification::Empty);
        }

        let active_store_id = active_store_id
            .map(str::trim)
            .filter(|store_id| !store_id.is_empty());

        if remote_store_ids.len() > 1 {
            return Ok(RemoteEventLogClassification::MultipleStores {
                store_ids: remote_store_ids.into_iter().collect(),
            });
        }

        let remote_store_id =
            remote_store_ids
                .into_iter()
                .next()
                .ok_or_else(|| EventError::MissingEvent {
                    event_id: "provider-store-id".to_owned(),
                })?;

        match active_store_id {
            Some(local_store_id) if local_store_id != remote_store_id => {
                Ok(RemoteEventLogClassification::DifferentStore {
                    local_store_id: local_store_id.to_owned(),
                    remote_store_id,
                })
            }
            _ => Ok(RemoteEventLogClassification::SameStore {
                store_id: remote_store_id,
            }),
        }
    }
}

struct PreparedRemoteUnion<'a> {
    local: &'a mut LocalEventStore,
    accepted: LocalEventStore,
    imported: Vec<EventId>,
}
impl<'a> PreparedRemoteUnion<'a> {
    fn prepare(
        local: &'a mut LocalEventStore,
        remote_events: &[(EventId, EventStorageBytes)],
        store_id: &str,
    ) -> EventResult<Self> {
        let visible_remote_events =
            local.visibility_gated_remote_events(remote_events, store_id)?;
        let mut candidate = local.clone();
        let mut candidates = Vec::new();
        for (event_id, bytes) in &visible_remote_events {
            if local.get_bytes(event_id).is_some() || candidate.get_bytes(event_id).is_some() {
                continue;
            }
            let event = VaultEvent::parse_remote_event_storage_bytes(bytes)?;
            if event.id()? != *event_id {
                return Err(EventError::RemoteEventIdMismatch {
                    event_id: event_id.as_str().to_owned(),
                });
            }
            event.validate_envelope(&StoreId::parse(store_id)?)?;
            candidate.put_event(event_id.clone(), bytes.clone());
            candidates.push(event_id.clone());
        }
        let graph = candidate.load_graph(store_id)?;
        let mut quarantined: BTreeSet<EventId> = graph.quarantined().keys().cloned().collect();
        quarantined.extend(candidate.incomplete_security_transition_events(store_id)?);
        let mut accepted = LocalEventStore::new();
        for event_id in candidate.event_ids() {
            if quarantined.contains(&event_id) {
                continue;
            }
            let bytes = candidate
                .get_bytes(&event_id)
                .ok_or_else(|| EventError::MissingEvent {
                    event_id: event_id.as_str().to_owned(),
                })?;
            accepted.put_event(event_id, bytes);
        }
        for (provider_id, event_id, bytes) in local.replica.outbox_entries() {
            if !quarantined.contains(&event_id) {
                accepted.queue_outbox(&provider_id, event_id, bytes.into());
            }
        }
        let imported = candidates
            .into_iter()
            .filter(|event_id| !quarantined.contains(event_id))
            .collect();
        let _ = accepted.load_graph(store_id)?;
        Ok(Self {
            local,
            accepted,
            imported,
        })
    }
    fn commit(self) -> Vec<EventId> {
        *self.local = self.accepted;
        self.imported
    }
}

impl LocalEventStore {
    pub fn union_remote(
        &mut self,
        remote_events: &[(EventId, EventStorageBytes)],
        store_id: &str,
    ) -> EventResult<Vec<EventId>> {
        Ok(PreparedRemoteUnion::prepare(self, remote_events, store_id)?.commit())
    }
    pub fn union_remote_and_heads(
        &mut self,
        remote_events: &[(EventId, EventStorageBytes)],
        store_id: &str,
    ) -> EventResult<Vec<String>> {
        self.union_remote(remote_events, store_id)?;
        let graph = self.load_graph(store_id)?;
        Ok(graph
            .heads()
            .into_iter()
            .map(|id| id.as_str().to_owned())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Ed25519Signature, GenesisImportPayload, IsoTimestamp, Sha256Hex, test_support};

    const STORE: &str = "store_testtoken11";

    struct RemoteFixture {
        event: VaultEvent,
        records: Vec<(EventId, EventStorageBytes)>,
    }

    impl RemoteFixture {
        fn new() -> EventResult<Self> {
            let key = test_support::signing_key();
            let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &test_support::store()?,
                actor_id: &test_support::actor(&key)?,
                key_epoch: &test_support::epoch()?,
                payload: GenesisImportPayload {
                    source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                },
                created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                signing_key: &key,
            })?;
            let records = vec![(
                event.id()?,
                VaultEvent::serialize_event_storage_yaml(&event)?,
            )];
            Ok(Self { event, records })
        }
    }

    #[test]
    fn dropping_prepared_union_preserves_destination_and_outbox() -> EventResult<()> {
        let fixture = RemoteFixture::new()?;
        let (id, bytes) = &fixture.records[0];
        let mut local = LocalEventStore::new();
        local.queue_outbox("provider", id.clone(), bytes.clone());
        let outbox = local.pending_outbox("provider");
        let prepared = PreparedRemoteUnion::prepare(&mut local, &fixture.records, STORE)?;
        assert_eq!(prepared.imported, vec![id.clone()]);
        assert_eq!(prepared.accepted.get_bytes(id), Some(bytes.clone()));
        drop(prepared);
        assert!(local.event_ids().is_empty());
        assert_eq!(local.pending_outbox("provider"), outbox);
        Ok(())
    }

    #[test]
    fn consuming_commit_matches_public_union_and_preserves_outbox() -> EventResult<()> {
        let fixture = RemoteFixture::new()?;
        let (id, bytes) = &fixture.records[0];
        let mut local = LocalEventStore::new();
        local.queue_outbox("provider", id.clone(), bytes.clone());
        let mut expected = local.clone();
        let expected_ids = expected.union_remote(&fixture.records, STORE)?;
        let prepared = PreparedRemoteUnion::prepare(&mut local, &fixture.records, STORE)?;
        assert_eq!(prepared.commit(), expected_ids);
        assert_eq!(local.event_ids(), expected.event_ids());
        assert_eq!(local.get_bytes(id), expected.get_bytes(id));
        assert_eq!(
            local.pending_outbox("provider"),
            expected.pending_outbox("provider")
        );
        assert_eq!(
            local.load_graph(STORE)?.heads(),
            expected.load_graph(STORE)?.heads()
        );
        Ok(())
    }

    #[test]
    fn failed_preparation_retains_existing_bytes_and_outbox() -> anyhow::Result<()> {
        let fixture = RemoteFixture::new()?;
        let (id, _) = &fixture.records[0];
        let mut local = LocalEventStore::new();
        let corrupt = EventStorageBytes::from(b"invalid local event".to_vec());
        local.put_event(id.clone(), corrupt.clone());
        local.queue_outbox("provider", id.clone(), corrupt.clone());
        match PreparedRemoteUnion::prepare(&mut local, &[], STORE) {
            Err(EventError::ParseStoredEvent(_)) => {}
            Err(error) => return Err(error.into()),
            Ok(_) => anyhow::bail!("corrupt local graph was prepared"),
        }
        assert_eq!(local.get_bytes(id), Some(corrupt.clone()));
        assert_eq!(
            local.pending_outbox("provider"),
            vec![(id.clone(), corrupt)]
        );
        Ok(())
    }

    #[test]
    fn checked_observation_and_batch_preserve_scope_without_claiming_membership() -> EventResult<()>
    {
        let fixture = RemoteFixture::new()?;
        let (id, bytes) = &fixture.records[0];
        let checked = CheckedRemoteEvent::parse(id, bytes)?;
        assert!(checked.belongs_to_store(STORE));
        assert!(!checked.belongs_to_store("store_otherstore1"));
        assert_eq!(checked.store_id().as_str(), STORE);
        assert_eq!(checked.into_store_id().as_str(), STORE);
        assert_eq!(
            RemoteEventBatch::new(&fixture.records).classify(Some("  store_testtoken11  "))?,
            RemoteEventLogClassification::SameStore {
                store_id: STORE.to_owned()
            }
        );
        Ok(())
    }

    #[test]
    fn checked_admission_rejects_id_before_invalid_signature() -> EventResult<()> {
        let mut fixture = RemoteFixture::new()?;
        let (id, _) = &fixture.records[0];
        fixture.event.signature =
            Ed25519Signature::from_trusted(format!("ed25519:{}", "00".repeat(64)));
        let bytes = VaultEvent::serialize_event_storage_yaml(&fixture.event)?;
        let wrong_id = EventId::parse("sha256u:3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d0")?;
        assert!(matches!(
            CheckedRemoteEvent::parse(&wrong_id, &bytes),
            Err(EventError::RemoteEventIdMismatch { .. })
        ));
        assert!(matches!(
            CheckedRemoteEvent::parse(id, &bytes),
            Err(EventError::SignatureVerificationFailed)
        ));
        Ok(())
    }
}
