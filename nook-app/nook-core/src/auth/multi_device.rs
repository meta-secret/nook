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
    use crate::{MemberLabel, SigningIdentity};

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
}
