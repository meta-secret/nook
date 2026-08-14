//! Provider visibility rules for two-event security epoch transitions.

use std::collections::BTreeSet;

use crate::{
    EventId, EventResult, LocalEventStore, VaultEvent, VaultOperation, parse_event_storage_bytes,
};

fn starts_security_epoch(event: &VaultEvent) -> bool {
    event.body.operations.iter().any(|operation| {
        matches!(
            operation,
            VaultOperation::PasswordRotated { .. }
                | VaultOperation::PasswordRemoved { .. }
                | VaultOperation::DeviceRevoked { .. }
        )
    })
}

fn committed_epoch_parent(event: &VaultEvent) -> Option<&EventId> {
    let is_checkpoint = event
        .body
        .operations
        .iter()
        .any(|operation| matches!(operation, VaultOperation::EpochCheckpoint { .. }));
    match event.body.parents.as_slice() {
        [parent] if is_checkpoint && event.body.key_epoch == *parent => Some(parent),
        _ => None,
    }
}

fn checkpoint_parents(
    local: &LocalEventStore,
    remote_events: &[(EventId, Vec<u8>)],
) -> EventResult<BTreeSet<EventId>> {
    let mut parents = BTreeSet::new();
    for event_id in local.event_ids() {
        if let Some(bytes) = local.get_bytes(&event_id) {
            let event = parse_event_storage_bytes(bytes)?;
            if let Some(parent) = committed_epoch_parent(&event) {
                parents.insert(parent.clone());
            }
        }
    }
    for (_, bytes) in remote_events {
        let event = parse_event_storage_bytes(bytes)?;
        if let Some(parent) = committed_epoch_parent(&event) {
            parents.insert(parent.clone());
        }
    }
    Ok(parents)
}

/// Hide a remotely visible epoch trigger until its directly committing
/// checkpoint is also visible. Descendants then remain quarantined behind the
/// omitted trigger instead of extending an incomplete security transition.
pub(crate) fn visibility_gated_remote_events(
    local: &LocalEventStore,
    remote_events: &[(EventId, Vec<u8>)],
) -> EventResult<Vec<(EventId, Vec<u8>)>> {
    let committed = checkpoint_parents(local, remote_events)?;
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
                .filter(|(event_id, _, event)| {
                    !starts_security_epoch(event) || committed.contains(event_id)
                })
                .map(|(event_id, bytes, _)| (event_id, bytes))
                .collect()
        })
}

fn publish_priority(event: &VaultEvent) -> u8 {
    if committed_epoch_parent(event).is_some() {
        0
    } else if starts_security_epoch(event) {
        2
    } else {
        1
    }
}

/// Order provider writes so a checkpoint becomes visible before its trigger.
/// An observer may temporarily see an orphan checkpoint, which is quarantined;
/// it never sees an appendable epoch trigger without its checkpoint.
pub fn order_remote_events_for_visibility(events: &mut [(EventId, Vec<u8>)]) -> EventResult<()> {
    let mut priorities = std::collections::BTreeMap::new();
    for (event_id, bytes) in events.iter() {
        let event = parse_event_storage_bytes(bytes)?;
        priorities.insert(event_id.clone(), publish_priority(&event));
    }
    events.sort_by_key(|(event_id, _)| {
        (
            priorities.get(event_id).copied().unwrap_or(1),
            event_id.clone(),
        )
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeviceSigningPublicKey, IsoTimestamp, PasswordEntryId, Sha256Hex, SigningIdentity, StoreId,
        VaultEventBody, VaultEventSchemaVersion, serialize_event_storage_yaml,
    };
    use ed25519_dalek::SigningKey;

    const STORE: &str = "store_testtoken11";
    type RemoteEvent = (EventId, Vec<u8>);

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

    fn epoch_pair() -> EventResult<(RemoteEvent, RemoteEvent)> {
        let signing_key = crate::test_support::signing_key();
        let previous = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let trigger = signed_event(
            &signing_key,
            vec![previous.clone()],
            previous,
            VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::from_trusted("pwdentry001".to_owned()),
            },
        )?;
        let trigger_id = trigger.id()?;
        let checkpoint = signed_event(
            &signing_key,
            vec![trigger_id.clone()],
            trigger_id.clone(),
            VaultOperation::EpochCheckpoint {
                secrets: Vec::new(),
                members_checkpoint_hash: Sha256Hex::from_trusted("00".repeat(32)),
                rotated_meta_records: Vec::new(),
                password_entries: Some(Vec::new()),
            },
        )?;
        let checkpoint_id = checkpoint.id()?;
        Ok((
            (trigger_id, serialize_event_storage_yaml(&trigger)?),
            (checkpoint_id, serialize_event_storage_yaml(&checkpoint)?),
        ))
    }

    #[test]
    fn defers_remote_trigger_until_checkpoint_is_visible() -> EventResult<()> {
        let (trigger, checkpoint) = epoch_pair()?;
        let local = LocalEventStore::new();

        assert!(visibility_gated_remote_events(&local, std::slice::from_ref(&trigger))?.is_empty());
        assert_eq!(
            visibility_gated_remote_events(&local, &[trigger, checkpoint])?.len(),
            2
        );
        Ok(())
    }

    #[test]
    fn publishes_checkpoint_before_trigger() -> EventResult<()> {
        let (trigger, checkpoint) = epoch_pair()?;
        let checkpoint_id = checkpoint.0.clone();
        let mut events = vec![trigger, checkpoint];

        order_remote_events_for_visibility(&mut events)?;

        assert_eq!(events[0].0, checkpoint_id);
        Ok(())
    }
}
