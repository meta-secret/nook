//! Compatibility exports for portable vault key-access primitives.
//!
//! The reusable device/member/password primitives live in `nook-auth2`. This
//! module keeps `nook-core`'s existing public API stable and owns the small
//! adapter that replays core event-log operations into auth metadata state.

pub use nook_auth2::{
    AuthEnvelopes, ConnectAccessStatus, DeviceIdentity, JoinRequest, MEMBER_RECORD_PREFIX,
    MemberEntry, NEXUS_SHARE_RECORD_PREFIX, NexusShareEnvelope, VaultKeys, VaultMember,
    VaultMetaRecord, VaultMetaState, approve_join_request, assess_connect_access, auth_record,
    build_members_records, create_join_request_record, create_join_request_record_with_signing_key,
    create_nexus_share_records, dec_auth_id, dec_auth_id_from_public_key, deny_join_request,
    device_is_enrolled, encrypt_for_recipient, encrypt_member_entry, enroll_device_with_dec,
    enroll_device_with_keys, ensure_self_in_roster, explain_connect_blocked, generate_dec,
    generate_id, generate_symmetric_key, generate_vault_keys, genesis_auth_record,
    genesis_dec_record, genesis_members_records, is_auth_id, is_auth_stored_record,
    is_dec_stored_record, is_join_stored_record, is_members_stored_record,
    is_nexus_share_stored_record, is_reserved_device_label, is_vault_meta_record, join_record_key,
    list_join_requests, member_from_identity, member_from_join, member_stored_key,
    merge_remote_join_records, nexus_share_record_key, parse_auth_envelopes, parse_join_request,
    parse_nexus_share_envelope, pending_join_for_device, reconstruct_nexus_vault_keys,
    rename_vault_member, replace_member_records, resolve_dec, resolve_dek, resolve_member_roster,
    resolve_members_key, resolve_secrets_key, revoke_vault_member, roster_add_member,
    user_stored_records, vault_has_multi_device_records,
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
        VaultOperation::JoinDenied { device_id } => {
            state.joins.remove(device_id);
        }
        VaultOperation::VaultImported { .. }
        | VaultOperation::SecretCreated { .. }
        | VaultOperation::SecretDeleted { .. }
        | VaultOperation::SecretReplaced { .. }
        | VaultOperation::SecretConflictResolved { .. }
        | VaultOperation::MemberRenamed { .. }
        | VaultOperation::DeviceRevoked { .. }
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
