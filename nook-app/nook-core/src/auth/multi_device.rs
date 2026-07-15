//! Compatibility exports for portable vault key-access primitives.
//!
//! The reusable device/member/password primitives live in `nook-auth2`. This
//! module keeps `nook-core`'s existing public API stable and owns the small
//! adapter that replays core event-log operations into auth metadata state.

pub use nook_auth2::{
    AuthEnvelopes, ConnectAccessStatus, DeviceIdentity, JoinRequest, MEMBER_RECORD_PREFIX,
    MemberEntry, OpenedSentinelShare, SENTINEL_SHARE_RECORD_PREFIX, SentinelParticipantEntry,
    SentinelShareEnvelope, VaultKeys, VaultMember, VaultMetaRecord, VaultMetaState,
    approve_join_request, assess_connect_access, auth_record, build_members_records,
    count_sentinel_share_records, create_join_request_record,
    create_join_request_record_with_signing_key, create_sentinel_share_records,
    create_sentinel_share_records_for_recipients, dec_auth_id, dec_auth_id_from_public_key,
    deny_join_request, device_is_enrolled, encrypt_for_recipient, encrypt_member_entry,
    enroll_device_with_dec, enroll_device_with_keys, ensure_self_in_roster,
    explain_connect_blocked, generate_dec, generate_id, generate_symmetric_key,
    generate_vault_keys, genesis_auth_record, genesis_dec_record, genesis_members_records,
    is_auth_id, is_auth_stored_record, is_dec_stored_record, is_join_stored_record,
    is_members_stored_record, is_reserved_device_label, is_sentinel_share_stored_record,
    is_vault_meta_record, join_record_key, list_join_requests, member_from_identity,
    member_from_join, member_stored_key, merge_remote_join_records,
    open_sentinel_share_for_identity, parse_auth_envelopes, parse_join_request,
    parse_sentinel_share_envelope, pending_join_for_device, reconstruct_sentinel_vault_keys,
    reconstruct_sentinel_vault_keys_from_opened, rename_vault_member, replace_member_records,
    resolve_dec, resolve_dek, resolve_member_roster, resolve_members_key, resolve_secrets_key,
    revoke_vault_member, roster_add_member, sentinel_share_record_key, user_stored_records,
    vault_has_multi_device_records,
};

use crate::vault_event::VaultOperation;

/// Apply a single core event-log meta operation to the typed auth metadata cache.
///
/// User secrets are projected separately; this covers join rows and other meta
/// keys that the event log records but `project_vault` does not replay.
pub fn apply_vault_meta_operation(
    state: &mut VaultMetaState,
    operation: &VaultOperation,
    requested_at: &str,
) -> nook_auth2::MultiDeviceResult<()> {
    match operation {
        VaultOperation::JoinRequested {
            device_id,
            encryption_public_key,
            signing_public_key,
            ..
        } => {
            state.joins.insert(
                device_id.clone(),
                JoinRequest {
                    device_id: device_id.clone(),
                    public_key: encryption_public_key.clone(),
                    signing_public_key: signing_public_key.clone(),
                    requested_at: requested_at.to_owned(),
                },
            );
        }
        VaultOperation::JoinApproved {
            device_id,
            encryption_public_key,
            secrets_key_ciphertext,
            members_key_ciphertext,
            ..
        } => {
            state.joins.remove(device_id);
            let auth_id = dec_auth_id_from_public_key(encryption_public_key)?;
            state.auth.insert(
                auth_id,
                AuthEnvelopes {
                    secrets_key: secrets_key_ciphertext.clone(),
                    members_key: members_key_ciphertext.clone(),
                },
            );
        }
        VaultOperation::SentinelParticipantEnrolled {
            device_id,
            encryption_public_key,
            signing_public_key,
            label,
        } => {
            state.joins.remove(device_id);
            state.sentinel_participants.insert(
                device_id.clone(),
                SentinelParticipantEntry {
                    device_id: device_id.clone(),
                    encryption_public_key: encryption_public_key.clone(),
                    signing_public_key: signing_public_key.clone(),
                    label: label.as_str().to_owned(),
                    enrolled_at: requested_at.to_owned(),
                },
            );
        }
        VaultOperation::JoinDenied { device_id } => {
            state.joins.remove(device_id);
        }
        VaultOperation::SentinelSharesIssued { shares } => {
            for share in shares {
                state.sentinel_shares.insert(
                    share.device_id.clone(),
                    SentinelShareEnvelope {
                        version: share.version,
                        threshold: share.threshold,
                        required_participants: share.required_participants,
                        share_index: share.share_index,
                        ciphertext: share.ciphertext.clone(),
                    },
                );
            }
        }
        VaultOperation::MemberRenamed { device_id, label } => {
            if let Some(participant) = state.sentinel_participants.get_mut(device_id) {
                label.as_str().clone_into(&mut participant.label);
            }
        }
        VaultOperation::DeviceRevoked { device_id } => {
            state.sentinel_participants.remove(device_id);
            state.sentinel_shares.remove(device_id);
        }
        VaultOperation::VaultImported { .. }
        | VaultOperation::SecretCreated { .. }
        | VaultOperation::SecretDeleted { .. }
        | VaultOperation::SecretReplaced { .. }
        | VaultOperation::SecretConflictResolved { .. }
        | VaultOperation::PasswordAdded { .. }
        | VaultOperation::PasswordRotated { .. }
        | VaultOperation::PasswordRemoved { .. }
        | VaultOperation::VaultCleared
        | VaultOperation::EpochCheckpoint { .. } => {}
    }
    Ok(())
}

/// Replay core event-log meta operations from the event graph in topological order.
pub fn materialize_vault_meta_from_graph(
    graph: &crate::vault_event_graph::EventGraph,
    state: &mut VaultMetaState,
) -> nook_auth2::MultiDeviceResult<()> {
    let order = graph
        .topological_order()
        .map_err(|e| nook_auth2::MultiDeviceError::InvalidDeviceIdentity(e.to_string()))?;
    for event_id in order {
        let event = graph.get(&event_id).ok_or_else(|| {
            nook_auth2::MultiDeviceError::InvalidDeviceIdentity(format!(
                "Missing event {event_id} in graph."
            ))
        })?;
        for operation in &event.body.operations {
            apply_vault_meta_operation(state, operation, event.body.created_at.as_str())?;
        }
    }
    Ok(())
}

/// Return whether the event graph currently grants a device access to a Simple
/// vault. The event log is the authorization source of truth: an old encrypted
/// auth envelope must not keep an extension active after `DeviceRevoked`.
pub fn event_graph_has_active_device_access(
    graph: &crate::vault_event_graph::EventGraph,
    expected_device_id: &crate::DeviceId,
    expected_public_key: &crate::DevicePublicKey,
    expected_signing_public_key: &crate::DeviceSigningPublicKey,
) -> nook_auth2::MultiDeviceResult<bool> {
    let derived_device_id = nook_auth2::device_id_from_public_key(expected_public_key)?;
    if &derived_device_id != expected_device_id {
        return Err(nook_auth2::MultiDeviceError::InvalidDeviceIdentity(
            "Extension device_id does not match its encryption public key.".to_owned(),
        ));
    }

    let mut active = false;
    let order = graph
        .topological_order()
        .map_err(|error| nook_auth2::MultiDeviceError::InvalidDeviceIdentity(error.to_string()))?;
    for event_id in order {
        let event = graph.get(&event_id).ok_or_else(|| {
            nook_auth2::MultiDeviceError::InvalidDeviceIdentity(format!(
                "Missing event {event_id} in graph."
            ))
        })?;
        for operation in &event.body.operations {
            match operation {
                VaultOperation::JoinApproved {
                    device_id,
                    encryption_public_key,
                    signing_public_key,
                    ..
                } if device_id == expected_device_id => {
                    active = encryption_public_key == expected_public_key
                        && signing_public_key == expected_signing_public_key;
                }
                VaultOperation::DeviceRevoked { device_id } if device_id == expected_device_id => {
                    active = false;
                }
                _ => {}
            }
        }
    }
    Ok(active)
}

/// Rebuild encrypted `members:` rows after quorum unlock of an event-only
/// Sentinel vault. Public event roster entries are retained before unlock; the
/// reconstructed members key turns them back into the canonical encrypted
/// member projection without inventing full-key auth envelopes.
pub fn sentinel_member_records_from_public_roster(
    state: &VaultMetaState,
    members_key: &crate::SymmetricKey,
) -> nook_auth2::MultiDeviceResult<Vec<crate::StoredSecretRecord>> {
    let mut roster = state
        .sentinel_participants
        .values()
        .map(|participant| {
            Ok(VaultMember {
                auth_id: dec_auth_id_from_public_key(&participant.encryption_public_key)?,
                device_id: participant.device_id.clone(),
                public_key: participant.encryption_public_key.clone(),
                enrolled_at: participant.enrolled_at.clone(),
                label: (!participant.label.is_empty()).then(|| participant.label.clone()),
            })
        })
        .collect::<nook_auth2::MultiDeviceResult<Vec<_>>>()?;
    roster.sort_by(|left, right| left.auth_id.cmp(&right.auth_id));
    build_members_records(&roster, members_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        EventGraph, EventId, IsoTimestamp, MemberLabel, Sha256Hex, SigningIdentity, StoreId,
        VaultEvent, VaultEventBody, VaultEventSchemaVersion,
    };

    fn signed_event(
        signing: &SigningIdentity,
        store_id: &StoreId,
        parents: Vec<EventId>,
        operations: Vec<VaultOperation>,
        timestamp: &str,
    ) -> VaultEvent {
        VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store_id.clone(),
                actor_id: signing.actor_id().unwrap(),
                actor_signing_public_key: Some(signing.public_key()),
                parents,
                created_at: IsoTimestamp::parse(timestamp).unwrap(),
                key_epoch: EventId::from_sha256_hex(
                    crate::sha256_hex(store_id.as_str().as_bytes()).as_str(),
                )
                .unwrap(),
                operations,
            },
            signing.signing_key(),
        )
        .unwrap()
    }

    #[test]
    fn sentinel_event_materialization_retains_complete_public_roster() {
        let identity = DeviceIdentity::generate().unwrap();
        let (signing, _) = SigningIdentity::generate().unwrap();
        let operation = VaultOperation::SentinelParticipantEnrolled {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key(),
            signing_public_key: signing.public_key(),
            label: MemberLabel::from_trusted("Owner".to_owned()),
        };
        let mut state = VaultMetaState::default();
        apply_vault_meta_operation(&mut state, &operation, "2026-07-09T00:00:00Z").unwrap();
        let participant = state
            .sentinel_participants
            .get(identity.device_id())
            .unwrap();
        assert_eq!(participant.encryption_public_key, identity.public_key());
        assert_eq!(participant.signing_public_key, signing.public_key());
        assert_eq!(participant.label, "Owner");

        let members_key = crate::generate_symmetric_key().unwrap();
        let records = sentinel_member_records_from_public_roster(&state, &members_key).unwrap();
        let roster = crate::resolve_member_roster(&records, &members_key).unwrap();
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].device_id, *identity.device_id());

        apply_vault_meta_operation(
            &mut state,
            &VaultOperation::MemberRenamed {
                device_id: identity.device_id().clone(),
                label: MemberLabel::from_trusted("Renamed".to_owned()),
            },
            "2026-07-09T00:01:00Z",
        )
        .unwrap();
        assert_eq!(
            state
                .sentinel_participants
                .get(identity.device_id())
                .unwrap()
                .label,
            "Renamed"
        );
    }

    #[test]
    fn extension_access_follows_approval_and_revocation_events() {
        let owner = DeviceIdentity::generate().unwrap();
        let extension = DeviceIdentity::generate().unwrap();
        let (signing, _) = SigningIdentity::generate().unwrap();
        let keys = crate::generate_vault_keys().unwrap();
        let auth =
            crate::genesis_auth_record(&extension, &keys.secrets_key, &keys.members_key).unwrap();
        let envelopes = crate::parse_auth_envelopes(auth.value.as_str()).unwrap();
        let store_id = crate::generate_store_id().unwrap();
        let mut graph = EventGraph::new();
        let approval = signed_event(
            &signing,
            &store_id,
            vec![],
            vec![
                VaultOperation::VaultImported {
                    source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                    secrets: vec![],
                    password_entries: vec![],
                },
                VaultOperation::JoinApproved {
                    device_id: extension.device_id().clone(),
                    encryption_public_key: extension.public_key(),
                    signing_public_key: signing.public_key(),
                    label: MemberLabel::from_trusted("Browser extension".to_owned()),
                    secrets_key_ciphertext: envelopes.secrets_key,
                    members_key_ciphertext: envelopes.members_key,
                },
            ],
            "2026-07-14T00:00:00Z",
        );
        let approval_id = approval.id().unwrap();
        graph.insert(approval, store_id.as_str()).unwrap();

        assert!(
            event_graph_has_active_device_access(
                &graph,
                extension.device_id(),
                &extension.public_key(),
                &signing.public_key(),
            )
            .unwrap()
        );
        let (other_signing, _) = SigningIdentity::generate().unwrap();
        assert!(
            !event_graph_has_active_device_access(
                &graph,
                extension.device_id(),
                &extension.public_key(),
                &other_signing.public_key(),
            )
            .unwrap()
        );
        assert!(
            event_graph_has_active_device_access(
                &graph,
                owner.device_id(),
                &owner.public_key(),
                &signing.public_key(),
            )
            .is_ok_and(|active| !active)
        );

        let revocation = signed_event(
            &signing,
            &store_id,
            vec![approval_id],
            vec![VaultOperation::DeviceRevoked {
                device_id: extension.device_id().clone(),
            }],
            "2026-07-14T00:01:00Z",
        );
        graph.insert(revocation, store_id.as_str()).unwrap();
        assert!(
            !event_graph_has_active_device_access(
                &graph,
                extension.device_id(),
                &extension.public_key(),
                &signing.public_key(),
            )
            .unwrap()
        );
    }
}
