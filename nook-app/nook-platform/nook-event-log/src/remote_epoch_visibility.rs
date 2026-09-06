//! Provider visibility rules for two-event security epoch transitions.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::{BTreeMap, BTreeSet};

use crate::{
    EventId, EventResult, EventStorageBytes, LocalEventStore, VaultEvent, VaultOperation,
    parse_event_storage_bytes,
};

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

impl VaultEvent {
    pub(crate) fn committed_epoch_parent(&self) -> Option<&EventId> {
        let is_checkpoint = self
            .body
            .operations
            .iter()
            .any(|operation| matches!(operation, VaultOperation::EpochCheckpoint { .. }));
        match self.body.parents.as_slice() {
            [parent] if is_checkpoint && self.body.key_epoch == *parent => Some(parent),
            _ => None,
        }
    }
}

impl LocalEventStore {
    fn authorized_checkpoint_parents(
        &self,
        remote_events: &[(EventId, EventStorageBytes)],
        store_id: &str,
    ) -> EventResult<BTreeSet<EventId>> {
        let mut candidate = self.clone();
        for (event_id, bytes) in remote_events {
            candidate.put_event(event_id.clone(), bytes.clone());
        }
        let graph = candidate.load_graph(store_id)?;
        let mut parents = BTreeSet::new();
        for event in graph.applicable_events() {
            if let Some(parent) = event.committed_epoch_parent() {
                parents.insert(parent.clone());
            }
        }
        Ok(parents)
    }
}

impl LocalEventStore {
    pub(crate) fn incomplete_security_transition_events(
        &self,
        store_id: &str,
    ) -> EventResult<BTreeSet<EventId>> {
        let graph = self.load_graph(store_id)?;
        let committed = self.authorized_checkpoint_parents(&[], store_id)?;
        let security_triggers = graph
            .applicable_events()
            .into_iter()
            .filter(|event| event.starts_security_epoch())
            .map(VaultEvent::id)
            .collect::<EventResult<Vec<_>>>()?;
        let incomplete = security_triggers
            .into_iter()
            .filter(|event_id| !committed.contains(event_id))
            .collect::<Vec<_>>();
        Ok(graph
            .events()
            .map(|(event_id, _)| event_id.clone())
            .filter(|event_id| {
                incomplete
                    .iter()
                    .any(|trigger| trigger == event_id || graph.is_ancestor(trigger, event_id))
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
        let mut candidate = self.clone();
        for (event_id, bytes) in remote_events {
            candidate.put_event(event_id.clone(), bytes.clone());
        }
        let hidden = candidate.incomplete_security_transition_events(store_id)?;
        remote_events
            .iter()
            .map(|(event_id, bytes)| {
                Ok((
                    event_id.clone(),
                    bytes.clone(),
                    parse_event_storage_bytes(bytes)?,
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
        if self.committed_epoch_parent().is_some() {
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
            let event = parse_event_storage_bytes(bytes)?;
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
        GenesisImportPayload, IsoTimestamp, PasswordEntryId, Sha256Hex, SigningIdentity, StoreId,
        VaultEventBody, VaultEventSchemaVersion, build_genesis_import_event,
        serialize_event_storage_yaml,
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
            let genesis = build_genesis_import_event(
                &StoreId::parse(STORE)?,
                &SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?,
                &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                GenesisImportPayload {
                    source_content_hash: Sha256Hex::from_trusted("00".repeat(32)),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                },
                &IsoTimestamp::from_trusted("2026-08-14T00:00:00Z".to_owned()),
                &signing_key,
            )?;
            let previous = genesis.id()?;
            let mut local = LocalEventStore::new();
            local.put_event(previous.clone(), serialize_event_storage_yaml(&genesis)?);
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
                (trigger_id, serialize_event_storage_yaml(&trigger)?),
                (checkpoint_id, serialize_event_storage_yaml(&checkpoint)?),
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
            (checkpoint.id()?, serialize_event_storage_yaml(&checkpoint)?),
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
            (descendant.id()?, serialize_event_storage_yaml(&descendant)?),
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
        local.put_event(trigger.0.clone(), trigger.1.clone());
        let signing_key = test_support::signing_key();
        let descendant = EpochPairFixture::signed_event(
            &signing_key,
            vec![trigger.0.clone()],
            trigger.0.clone(),
            VaultOperation::VaultCleared,
        )?;
        let descendant_id = descendant.id()?;
        let imported = local.union_remote(
            &[(
                descendant_id.clone(),
                serialize_event_storage_yaml(&descendant)?,
            )],
            STORE,
        )?;

        assert!(imported.is_empty());
        assert!(local.get_bytes(&trigger.0).is_none());
        assert!(local.get_bytes(&descendant_id).is_none());
        assert_eq!(local.event_ids().len(), 1);
        Ok(())
    }
}
