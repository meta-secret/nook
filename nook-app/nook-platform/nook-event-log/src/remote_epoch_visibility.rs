//! Provider visibility rules for two-event security epoch transitions.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::LocalEventBytes;
use std::collections::{BTreeMap, BTreeSet};

use crate::{EventId, EventResult, EventStorageBytes, LocalEventStore, VaultEvent, VaultOperation};

impl VaultEvent {
    pub(crate) fn starts_security_epoch(&self) -> bool {
        self.body.operations.iter().any(|operation| {
            matches!(
                operation,
                VaultOperation::PasswordRotated { .. }
                    | VaultOperation::PasswordRemoved { .. }
                    | VaultOperation::DeviceRevoked { .. }
            )
        })
    }
}

enum CheckpointCommit<'a> {
    NotCheckpoint,
    Commits(&'a EventId),
}

impl VaultEvent {
    fn committed_epoch_parent(&self) -> CheckpointCommit<'_> {
        let is_checkpoint = self
            .body
            .operations
            .iter()
            .any(|operation| matches!(operation, VaultOperation::EpochCheckpoint { .. }));
        match self.body.parents.as_slice() {
            [parent] if is_checkpoint && self.body.key_epoch == *parent => {
                CheckpointCommit::Commits(parent)
            }
            _ => CheckpointCommit::NotCheckpoint,
        }
    }
}

pub(crate) struct LocalGraphProjection<'a> {
    pub(crate) local: &'a LocalEventStore,
    pub(crate) remote: &'a [(EventId, EventStorageBytes)],
    pub(crate) store_id: &'a str,
    pub(crate) excluded: &'a BTreeSet<EventId>,
}
impl LocalGraphProjection<'_> {
    pub(crate) fn build(self) -> EventResult<crate::EventGraph> {
        let mut events = BTreeMap::new();
        for id in self.local.event_ids() {
            if self.excluded.contains(&id) {
                continue;
            }
            let bytes = match self.local.get_bytes(&id) {
                LocalEventBytes::Stored(bytes) => bytes,
                LocalEventBytes::UnknownEvent => {
                    return Err(crate::EventError::MissingEvent {
                        event_id: id.to_string(),
                    });
                }
            };
            events.insert(id, VaultEvent::parse_event_storage_bytes(&bytes)?);
        }
        for (id, bytes) in self.remote {
            if self.excluded.contains(id) || events.contains_key(id) {
                continue;
            }
            events.insert(id.clone(), VaultEvent::parse_event_storage_bytes(bytes)?);
        }
        let mut graph = crate::EventGraph::new();
        for event in events.into_values() {
            graph = graph
                .insert(crate::EventGraphInsert {
                    event,
                    expected_store_id: self.store_id,
                })
                .map_err(|rejected| rejected.into_cause())?
                .graph;
        }
        Ok(graph)
    }
}
impl crate::EventGraph {
    pub(crate) fn incomplete_security_transition_events(&self) -> EventResult<BTreeSet<EventId>> {
        let committed = self
            .applicable_events()
            .into_iter()
            .filter_map(|event| match event.committed_epoch_parent() {
                CheckpointCommit::Commits(parent) => Some(parent),
                CheckpointCommit::NotCheckpoint => None,
            })
            .cloned()
            .collect::<BTreeSet<_>>();
        let security_triggers = self
            .applicable_events()
            .into_iter()
            .filter(|event| event.starts_security_epoch())
            .map(VaultEvent::id)
            .collect::<EventResult<Vec<_>>>()?;
        let incomplete = security_triggers
            .into_iter()
            .filter(|id| !committed.contains(id))
            .collect::<Vec<_>>();
        Ok(self
            .events()
            .map(|(id, _)| id.clone())
            .filter(|id| {
                incomplete
                    .iter()
                    .any(|trigger| trigger == id || self.is_ancestor(trigger, id))
            })
            .collect())
    }
}

/// Hide a remotely visible epoch trigger until its directly committing
/// checkpoint is also visible. Descendants then remain quarantined behind the
/// omitted trigger instead of extending an incomplete security transition.
impl LocalEventStore {
    pub(crate) fn visibility_gated_remote_events(
        &self,
        remote_events: &[(EventId, EventStorageBytes)],
        store_id: &str,
    ) -> EventResult<Vec<(EventId, EventStorageBytes)>> {
        let graph = LocalGraphProjection {
            local: self,
            remote: remote_events,
            store_id,
            excluded: &BTreeSet::new(),
        }
        .build()?;
        let hidden = graph.incomplete_security_transition_events()?;
        remote_events
            .iter()
            .map(|(event_id, bytes)| {
                Ok((
                    event_id.clone(),
                    bytes.clone(),
                    VaultEvent::parse_event_storage_bytes(bytes)?,
                ))
            })
            .collect::<EventResult<Vec<_>>>()
            .map(|events| {
                events
                    .into_iter()
                    .filter(|(event_id, _, _)| !hidden.contains(event_id))
                    .map(|(event_id, bytes, _)| (event_id, bytes))
                    .collect()
            })
    }
}

impl VaultEvent {
    fn publish_priority(&self) -> u8 {
        if matches!(self.committed_epoch_parent(), CheckpointCommit::Commits(_)) {
            0
        } else if self.starts_security_epoch() {
            2
        } else {
            1
        }
    }
}

/// Order provider writes so a checkpoint becomes visible before its trigger.
/// An observer may temporarily see an orphan checkpoint, which is quarantined;
/// it never sees an appendable epoch trigger without its checkpoint.
/// Mutable provider writes ordered only after every representation is parsed.
///
/// ```
/// use nook_event_log::{EventId, EventResult, RemoteEventWrites};
/// # fn main() -> EventResult<()> {
/// let mut records: Vec<(EventId, nook_event_log::EventStorageBytes)> = Vec::new();
/// RemoteEventWrites::new(&mut records).order()?;
/// records.clear();
/// # Ok(())
/// # }
/// ```
/// The mutable observation is consumed by ordering.
///
/// ```compile_fail,E0382
/// use nook_event_log::{EventId, RemoteEventWrites};
/// let mut records: Vec<(EventId, nook_event_log::EventStorageBytes)> = Vec::new();
/// let writes = RemoteEventWrites::new(&mut records);
/// let _ = writes.order();
/// let _ = writes.order();
/// ```
/// The source cannot change while that observation remains live.
///
/// ```compile_fail,E0499
/// use nook_event_log::{EventId, RemoteEventWrites};
/// let mut records: Vec<(EventId, nook_event_log::EventStorageBytes)> = Vec::new();
/// let writes = RemoteEventWrites::new(&mut records);
/// records.clear();
/// let _ = writes.order();
/// ```
pub struct RemoteEventWrites<'a> {
    events: &'a mut [(EventId, EventStorageBytes)],
}
impl<'a> RemoteEventWrites<'a> {
    #[must_use]
    pub fn new(events: &'a mut [(EventId, EventStorageBytes)]) -> Self {
        Self { events }
    }
    pub fn order(self) -> EventResult<()> {
        let events = self.events;
        let mut priorities = BTreeMap::new();
        for (event_id, bytes) in events.iter() {
            let event = VaultEvent::parse_event_storage_bytes(bytes)?;
            priorities.insert(event_id.clone(), event.publish_priority());
        }
        events.sort_by_key(|(event_id, _)| {
            (
                priorities.get(event_id).copied().unwrap_or(1),
                event_id.clone(),
            )
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::slice;

    use super::*;
    use crate::test_support;
    use crate::{
        DeviceSigningPublicKey, EpochMetadataState, EpochPasswordState, EventError,
        GenesisImportPayload, GenesisImportRequest, IsoTimestamp, PasswordEntryId, Sha256Hex,
        SigningIdentity, StoreId, VaultEventBody, VaultEventSchemaVersion,
    };
    use ed25519_dalek::SigningKey;

    const STORE: &str = "store_testtoken11";
    type RemoteEvent = (EventId, EventStorageBytes);

    impl EpochPairFixture {
        fn signed_event(
            signing_key: &SigningKey,
            parents: Vec<EventId>,
            key_epoch: EventId,
            operation: VaultOperation,
        ) -> EventResult<VaultEvent> {
            VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: StoreId::parse(STORE)?,
                    actor_id: SigningIdentity::actor_id_for_verifying_key(
                        &signing_key.verifying_key(),
                    )?,
                    actor_signing_public_key: DeviceSigningPublicKey::from_trusted(hex::encode(
                        signing_key.verifying_key().as_bytes(),
                    )),
                    parents,
                    created_at: IsoTimestamp::from_trusted("2026-08-14T00:00:00Z".to_owned()),
                    key_epoch,
                    operations: vec![operation],
                },
                signing_key,
            )
        }
    }

    struct EpochPairFixture(LocalEventStore, RemoteEvent, RemoteEvent);

    impl EpochPairFixture {
        fn new() -> EventResult<Self> {
            let signing_key = test_support::signing_key();
            let genesis = VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &StoreId::parse(STORE)?,
                actor_id: &SigningIdentity::actor_id_for_verifying_key(
                    &signing_key.verifying_key(),
                )?,
                key_epoch: &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                payload: GenesisImportPayload {
                    source_content_hash: Sha256Hex::from_trusted("00".repeat(32)),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                },
                created_at: &IsoTimestamp::from_trusted("2026-08-14T00:00:00Z".to_owned()),
                signing_key: &signing_key,
            })?;
            let previous = genesis.id()?;
            let mut local = LocalEventStore::new();
            local = local.put_event(crate::LocalEventWrite {
                event_id: previous.clone(),
                bytes: VaultEvent::serialize_event_storage_yaml(&genesis)?,
            });
            let trigger = Self::signed_event(
                &signing_key,
                vec![previous.clone()],
                previous,
                VaultOperation::PasswordRemoved {
                    entry_id: PasswordEntryId::from_trusted("pwdentry001".to_owned()),
                },
            )?;
            let trigger_id = trigger.id()?;
            let checkpoint = Self::signed_event(
                &signing_key,
                vec![trigger_id.clone()],
                trigger_id.clone(),
                VaultOperation::EpochCheckpoint {
                    secrets: Vec::new(),
                    members_checkpoint_hash: Sha256Hex::from_trusted("00".repeat(32)),
                    rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
                    password_entries: EpochPasswordState::Replace(Vec::new()),
                },
            )?;
            let checkpoint_id = checkpoint.id()?;
            Ok(Self(
                local,
                (
                    trigger_id,
                    VaultEvent::serialize_event_storage_yaml(&trigger)?,
                ),
                (
                    checkpoint_id,
                    VaultEvent::serialize_event_storage_yaml(&checkpoint)?,
                ),
            ))
        }
    }

    #[test]
    fn malformed_write_batch_preserves_original_order_and_bytes() -> EventResult<()> {
        let EpochPairFixture(_, trigger, checkpoint) = EpochPairFixture::new()?;
        let mut writes = vec![trigger, checkpoint];
        writes[1].1 = b"invalid event".to_vec().into();
        let original = writes.clone();
        assert!(matches!(
            RemoteEventWrites::new(&mut writes).order(),
            Err(EventError::ParseStoredEvent(_))
        ));
        assert_eq!(writes, original);
        Ok(())
    }

    #[test]
    fn defers_remote_trigger_until_checkpoint_is_visible() -> EventResult<()> {
        let EpochPairFixture(local, trigger, checkpoint) = EpochPairFixture::new()?;

        assert!(
            local
                .visibility_gated_remote_events(slice::from_ref(&trigger), STORE)?
                .is_empty()
        );
        assert_eq!(
            local
                .visibility_gated_remote_events(&[trigger, checkpoint], STORE)?
                .len(),
            2
        );
        Ok(())
    }

    #[test]
    fn publishes_checkpoint_before_trigger() -> EventResult<()> {
        let EpochPairFixture(_, trigger, checkpoint) = EpochPairFixture::new()?;
        let checkpoint_id = checkpoint.0.clone();
        let mut events = vec![trigger, checkpoint];

        RemoteEventWrites::new(&mut events).order()?;

        assert_eq!(events[0].0, checkpoint_id);
        Ok(())
    }

    #[test]
    fn unauthorized_checkpoint_does_not_release_trigger() -> EventResult<()> {
        let EpochPairFixture(local, trigger, _) = EpochPairFixture::new()?;
        let stranger = SigningKey::from_bytes(&[42_u8; 32]);
        let checkpoint = EpochPairFixture::signed_event(
            &stranger,
            vec![trigger.0.clone()],
            trigger.0.clone(),
            VaultOperation::EpochCheckpoint {
                secrets: Vec::new(),
                members_checkpoint_hash: Sha256Hex::from_trusted("00".repeat(32)),
                rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
                password_entries: EpochPasswordState::Replace(Vec::new()),
            },
        )?;
        let remote = vec![
            trigger.clone(),
            (
                checkpoint.id()?,
                VaultEvent::serialize_event_storage_yaml(&checkpoint)?,
            ),
        ];

        let visible = local.visibility_gated_remote_events(&remote, STORE)?;

        assert!(!visible.iter().any(|(event_id, _)| event_id == &trigger.0));
        Ok(())
    }

    #[test]
    fn hides_a_remote_trigger_and_every_remote_descendant_until_checkpoint() -> EventResult<()> {
        let EpochPairFixture(local, trigger, _) = EpochPairFixture::new()?;
        let signing_key = test_support::signing_key();
        let descendant = EpochPairFixture::signed_event(
            &signing_key,
            vec![trigger.0.clone()],
            trigger.0.clone(),
            VaultOperation::VaultCleared,
        )?;
        let remote = vec![
            trigger,
            (
                descendant.id()?,
                VaultEvent::serialize_event_storage_yaml(&descendant)?,
            ),
        ];

        assert!(
            local
                .visibility_gated_remote_events(&remote, STORE)?
                .is_empty()
        );
        Ok(())
    }

    #[test]
    fn quarantines_a_legacy_local_trigger_and_its_remote_descendant() -> EventResult<()> {
        let EpochPairFixture(mut local, trigger, _) = EpochPairFixture::new()?;
        local = local.put_event(crate::LocalEventWrite {
            event_id: trigger.0.clone(),
            bytes: trigger.1.clone(),
        });
        let signing_key = test_support::signing_key();
        let descendant = EpochPairFixture::signed_event(
            &signing_key,
            vec![trigger.0.clone()],
            trigger.0.clone(),
            VaultOperation::VaultCleared,
        )?;
        let descendant_id = descendant.id()?;
        let imported = match local.union_remote(crate::LocalRemoteUnion {
            remote_events: &[(
                descendant_id.clone(),
                VaultEvent::serialize_event_storage_yaml(&descendant)?,
            )],
            store_id: STORE,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.imported)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;

        assert!(imported.is_empty());
        assert!(matches!(
            local.get_bytes(&trigger.0),
            LocalEventBytes::UnknownEvent
        ));
        assert!(matches!(
            local.get_bytes(&descendant_id),
            LocalEventBytes::UnknownEvent
        ));
        assert_eq!(local.event_ids().len(), 1);
        Ok(())
    }
}
