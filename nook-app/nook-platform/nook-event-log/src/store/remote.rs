#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{LocalEventStore, RemoteEventLogClassification};
use crate::GenesisImportRequest;
use crate::LocalEventBytes;
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

/// Local selection against which a provider event batch is classified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteStoreIdentity<'a> {
    Empty,
    Identified(&'a str),
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
        active_store_id: RemoteStoreIdentity<'_>,
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

        let active_store_id = match active_store_id {
            RemoteStoreIdentity::Identified(store_id) if !store_id.trim().is_empty() => {
                RemoteStoreIdentity::Identified(store_id.trim())
            }
            RemoteStoreIdentity::Identified(_) | RemoteStoreIdentity::Empty => {
                RemoteStoreIdentity::Empty
            }
        };

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
            RemoteStoreIdentity::Identified(local_store_id)
                if local_store_id != remote_store_id =>
            {
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

pub struct LocalRemoteUnion<'a> {
    pub remote_events: &'a [(EventId, EventStorageBytes)],
    pub store_id: &'a str,
}
#[derive(Debug)]
pub struct LocalRemoteUnionOutcome {
    pub store: LocalEventStore,
    pub imported: Vec<EventId>,
    pub heads: Vec<String>,
}
struct PreparedRemoteUnion {
    local: LocalEventStore,
    additions: Vec<(EventId, EventStorageBytes)>,
    excluded: BTreeSet<EventId>,
    heads: Vec<String>,
}
impl PreparedRemoteUnion {
    fn prepare(
        local: LocalEventStore,
        request: LocalRemoteUnion<'_>,
    ) -> Result<Self, super::LocalEventStoreRejection> {
        let LocalRemoteUnion {
            remote_events,
            store_id,
        } = request;
        let prepared: EventResult<_> = (|| {
            let expected_store = StoreId::parse(store_id)?;
            for (event_id, bytes) in remote_events {
                let event = VaultEvent::parse_remote_event_storage_bytes(bytes)?;
                if event.id()? != *event_id {
                    return Err(EventError::RemoteEventIdMismatch {
                        event_id: event_id.as_str().to_owned(),
                    });
                }
                event.validate_envelope(&expected_store)?;
            }
            let visible = local.visibility_gated_remote_events(remote_events, store_id)?;
            let mut additions = Vec::new();
            let mut addition_ids = BTreeSet::new();
            for (event_id, bytes) in visible {
                if matches!(local.get_bytes(&event_id), LocalEventBytes::Stored(_))
                    || addition_ids.contains(&event_id)
                {
                    continue;
                }
                addition_ids.insert(event_id.clone());
                additions.push((event_id, bytes));
            }
            let graph = crate::remote_epoch_visibility::LocalGraphProjection {
                local: &local,
                remote: &additions,
                store_id,
                excluded: &BTreeSet::new(),
            }
            .build()?;
            let mut excluded = graph.quarantined().keys().cloned().collect::<BTreeSet<_>>();
            excluded.extend(graph.incomplete_security_transition_events()?);
            let accepted_graph = crate::remote_epoch_visibility::LocalGraphProjection {
                local: &local,
                remote: &additions,
                store_id,
                excluded: &excluded,
            }
            .build()?;
            let heads = accepted_graph
                .heads()
                .into_iter()
                .map(|id| id.to_string())
                .collect();
            let additions = additions
                .into_iter()
                .filter(|(id, _)| !excluded.contains(id))
                .collect();
            Ok((additions, excluded, heads))
        })();
        match prepared {
            Ok((additions, excluded, heads)) => Ok(Self {
                local,
                additions,
                excluded,
                heads,
            }),
            Err(cause) => Err(super::LocalEventStoreRejection {
                store: local,
                cause,
            }),
        }
    }
    #[cfg(test)]
    fn cancel(self) -> LocalEventStore {
        self.local
    }

    fn commit(self) -> LocalRemoteUnionOutcome {
        let Self {
            mut local,
            additions,
            excluded,
            heads,
        } = self;
        local.replica = local.replica.excluding_events(&excluded);
        let mut imported = Vec::with_capacity(additions.len());
        for (event_id, bytes) in additions {
            imported.push(event_id.clone());
            local = local.put_event(super::LocalEventWrite { event_id, bytes });
        }
        LocalRemoteUnionOutcome {
            store: local,
            imported,
            heads,
        }
    }
}
impl LocalEventStore {
    pub fn union_remote(
        self,
        request: LocalRemoteUnion<'_>,
    ) -> Result<LocalRemoteUnionOutcome, super::LocalEventStoreRejection> {
        Ok(PreparedRemoteUnion::prepare(self, request)?.commit())
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
    fn cancelling_prepared_union_returns_destination_and_outbox() -> EventResult<()> {
        let fixture = RemoteFixture::new()?;
        let (id, bytes) = &fixture.records[0];
        let mut local = LocalEventStore::new();
        local = local.queue_outbox(crate::LocalOutboxWrite {
            provider_id: "provider",
            event: crate::LocalEventWrite {
                event_id: id.clone(),
                bytes: bytes.clone(),
            },
        });
        let outbox = local.pending_outbox("provider");
        let prepared = PreparedRemoteUnion::prepare(
            local,
            LocalRemoteUnion {
                remote_events: &fixture.records,
                store_id: STORE,
            },
        )
        .map_err(|rejected| rejected.into_cause())?;
        assert_eq!(prepared.additions, vec![(id.clone(), bytes.clone())]);
        local = prepared.cancel();
        assert!(local.event_ids().is_empty());
        assert_eq!(local.pending_outbox("provider"), outbox);
        Ok(())
    }

    #[test]
    fn consuming_commit_matches_public_union_and_preserves_outbox() -> EventResult<()> {
        let fixture = RemoteFixture::new()?;
        let (id, bytes) = &fixture.records[0];
        let mut local = LocalEventStore::new();
        local = local.queue_outbox(crate::LocalOutboxWrite {
            provider_id: "provider",
            event: crate::LocalEventWrite {
                event_id: id.clone(),
                bytes: bytes.clone(),
            },
        });
        let mut expected = local.clone();
        let expected_ids = match expected.union_remote(crate::LocalRemoteUnion {
            remote_events: &fixture.records,
            store_id: STORE,
        }) {
            Ok(outcome) => {
                expected = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                expected = rejected.store;
                Err(rejected.cause)
            }
        }?;
        let prepared = PreparedRemoteUnion::prepare(
            local,
            LocalRemoteUnion {
                remote_events: &fixture.records,
                store_id: STORE,
            },
        )
        .map_err(|rejected| rejected.into_cause())?;
        let committed = prepared.commit();
        local = committed.store;
        assert_eq!(committed.imported, expected_ids);
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
    fn conflicting_duplicate_ids_reject_without_changing_store_or_outbox() -> anyhow::Result<()> {
        let fixture = RemoteFixture::new()?;
        let (id, bytes) = &fixture.records[0];
        let mut different_event = fixture.event.clone();
        different_event.body.created_at =
            IsoTimestamp::from_trusted("2026-06-29T00:00:00Z".to_owned());
        let different_bytes = VaultEvent::serialize_event_storage_yaml(&different_event)?;
        assert_ne!(different_event.id()?, *id);
        for existing in [false, true] {
            let mut local = LocalEventStore::new();
            if existing {
                local = local.put_event(crate::LocalEventWrite {
                    event_id: id.clone(),
                    bytes: bytes.clone(),
                });
            }
            local = local.queue_outbox(crate::LocalOutboxWrite {
                provider_id: "provider",
                event: crate::LocalEventWrite {
                    event_id: id.clone(),
                    bytes: bytes.clone(),
                },
            });
            let original_ids = local.event_ids();
            let original_bytes = local.get_bytes(id);
            let original_outbox = local.pending_outbox("provider");
            let records = if existing {
                vec![(id.clone(), different_bytes.clone())]
            } else {
                vec![
                    (id.clone(), bytes.clone()),
                    (id.clone(), different_bytes.clone()),
                ]
            };
            let rejected = match local.union_remote(LocalRemoteUnion {
                remote_events: &records,
                store_id: STORE,
            }) {
                Err(rejected) => rejected,
                Ok(_) => anyhow::bail!("conflicting duplicate ID was accepted"),
            };
            assert!(matches!(
                rejected.cause,
                EventError::RemoteEventIdMismatch { .. }
            ));
            assert_eq!(rejected.store.event_ids(), original_ids);
            assert_eq!(rejected.store.get_bytes(id), original_bytes);
            assert_eq!(rejected.store.pending_outbox("provider"), original_outbox);
        }
        Ok(())
    }

    #[test]
    fn identical_remote_duplicates_are_admitted_once() -> anyhow::Result<()> {
        let fixture = RemoteFixture::new()?;
        let record = fixture.records[0].clone();
        let records = vec![record.clone(), record.clone()];
        let admitted = LocalEventStore::new()
            .union_remote(LocalRemoteUnion {
                remote_events: &records,
                store_id: STORE,
            })
            .map_err(|rejected| rejected.into_cause())?;
        assert_eq!(admitted.imported, vec![record.0.clone()]);
        assert_eq!(
            admitted.store.get_bytes(&record.0),
            LocalEventBytes::Stored(record.1)
        );
        Ok(())
    }

    #[test]
    fn failed_preparation_retains_existing_bytes_and_outbox() -> anyhow::Result<()> {
        let fixture = RemoteFixture::new()?;
        let (id, _) = &fixture.records[0];
        let mut local = LocalEventStore::new();
        let corrupt = EventStorageBytes::from(b"invalid local event".to_vec());
        local = local.put_event(crate::LocalEventWrite {
            event_id: id.clone(),
            bytes: corrupt.clone(),
        });
        local = local.queue_outbox(crate::LocalOutboxWrite {
            provider_id: "provider",
            event: crate::LocalEventWrite {
                event_id: id.clone(),
                bytes: corrupt.clone(),
            },
        });
        let rejected = match PreparedRemoteUnion::prepare(
            local,
            LocalRemoteUnion {
                remote_events: &[],
                store_id: STORE,
            },
        ) {
            Err(rejected) => rejected,
            Ok(_) => anyhow::bail!("corrupt local graph was prepared"),
        };
        local = rejected.store;
        assert!(matches!(rejected.cause, EventError::ParseStoredEvent(_)));
        assert_eq!(
            local.get_bytes(id),
            LocalEventBytes::Stored(corrupt.clone())
        );
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
            RemoteEventBatch::new(&fixture.records)
                .classify(RemoteStoreIdentity::Identified("  store_testtoken11  "))?,
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
