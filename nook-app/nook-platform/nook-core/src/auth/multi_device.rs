//! Compatibility exports for portable vault key-access primitives.
//!
//! The reusable device/member/password primitives live in `nook-auth2`. This
//! module keeps `nook-core`'s existing public API stable and owns the small
//! adapter that replays core event-log operations into auth metadata state.

use crate::{EpochMetadataState, MemberLabel};
use nook_auth2::MultiDeviceError;

pub use nook_auth2::multi_device_api::*;

use std::collections::BTreeMap;

use crate::VaultOperation;

/// Inputs for the immutable Simple-vault identity roster written at genesis.
pub struct SimpleIdentityGenesisOperationsInput<'a> {
    pub identity: &'a crate::IdentityRecord,
    pub keys: &'a VaultKeys,
    pub current_app_id: &'a crate::AppId,
    pub current_signing_public_key: &'a crate::DeviceSigningPublicKey,
    pub created_at: &'a str,
}

/// Build one signed-log authorization operation for every identity app key.
///
/// Identity membership is portable ownership state. The event log must carry
/// the complete roster because encrypted metadata projections are disposable.
pub fn simple_identity_genesis_operations(
    input: &SimpleIdentityGenesisOperationsInput<'_>,
) -> nook_auth2::MultiDeviceResult<Vec<VaultOperation>> {
    let identity = input.identity;
    let keys = input.keys;
    let current_app_id = input.current_app_id;
    let current_signing_public_key = input.current_signing_public_key;
    let created_at = input.created_at;
    if identity
        .members
        .iter()
        .all(|member| &member.app_id != current_app_id)
    {
        return Err(MultiDeviceError::IdentityEnrollmentRequired);
    }
    let records = crate::identity_vault_genesis_records(identity, keys, created_at)?;
    identity
        .members
        .iter()
        .map(|member| {
            let record = records
                .iter()
                .find(|record| record.key.as_str() == member.auth_id.as_str())
                .ok_or_else(|| {
                    MultiDeviceError::InvalidDeviceIdentity(
                        "identity genesis is missing a member authorization envelope".to_owned(),
                    )
                })?;
            let envelopes = crate::parse_auth_envelopes(record.value.as_str())?;
            Ok(VaultOperation::JoinApproved {
                device_id: member.app_id.clone(),
                encryption_public_key: member.public_key.clone(),
                signing_public_key: if &member.app_id == current_app_id {
                    current_signing_public_key.clone()
                } else if member.signing_public_key.is_empty() {
                    return Err(MultiDeviceError::InvalidDeviceIdentity(
                        "identity member is missing its event signing public key".to_owned(),
                    ));
                } else {
                    member.signing_public_key.clone()
                },
                label: MemberLabel::from_trusted(
                    member
                        .label
                        .clone()
                        .unwrap_or_else(|| "Identity app key".to_owned()),
                ),
                secrets_key_ciphertext: envelopes.secrets_key,
                members_key_ciphertext: envelopes.members_key,
            })
        })
        .collect()
}

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
        } => record_pending_join(
            state,
            device_id,
            encryption_public_key,
            signing_public_key,
            requested_at,
        ),
        VaultOperation::JoinApproved {
            device_id,
            encryption_public_key,
            signing_public_key,
            secrets_key_ciphertext,
            members_key_ciphertext,
            ..
        } => apply_join_approved(
            state,
            &JoinApprovedReplay {
                device_id,
                encryption_public_key,
                signing_public_key,
                secrets_key_ciphertext,
                members_key_ciphertext,
                requested_at,
            },
        )?,
        VaultOperation::SentinelParticipantEnrolled {
            device_id,
            encryption_public_key,
            signing_public_key,
            label,
        } => record_sentinel_participant(
            state,
            device_id,
            encryption_public_key,
            signing_public_key,
            label,
            requested_at,
        ),
        VaultOperation::JoinDenied { device_id } => {
            state.joins.remove(device_id);
        }
        VaultOperation::SentinelSharesIssued { shares } => {
            apply_sentinel_shares(state, shares);
        }
        VaultOperation::MemberRenamed { device_id, label } => {
            if let Some(participant) = state.sentinel_participants.get_mut(device_id) {
                label.as_str().clone_into(&mut participant.label);
            }
        }
        VaultOperation::DeviceRevoked { device_id } => {
            state.sentinel_participants.remove(device_id);
            state.sentinel_shares.remove(device_id);
            state.enrolled_devices.remove(device_id);
        }
        VaultOperation::EpochCheckpoint {
            rotated_meta_records: EpochMetadataState::Replace(rotated_meta_records),
            ..
        } => {
            let mut replacement = state.clone();
            replacement.auth.clear();
            replacement.members.clear();
            replacement.enrolled_devices.clear();
            for record in rotated_meta_records {
                replacement.apply_record(record)?;
            }
            *state = replacement;
        }
        VaultOperation::VaultImported { .. }
        | VaultOperation::SecretCreated { .. }
        | VaultOperation::SecretDeleted { .. }
        | VaultOperation::SecretReplaced { .. }
        | VaultOperation::SecretConflictResolved { .. }
        | VaultOperation::PasswordAdded { .. }
        | VaultOperation::PasswordRotated { .. }
        | VaultOperation::PasswordEnvelopeUpgraded { .. }
        | VaultOperation::PasswordRemoved { .. }
        | VaultOperation::VaultCleared
        | VaultOperation::EpochCheckpoint {
            rotated_meta_records: EpochMetadataState::LegacyRetain,
            ..
        } => {}
    }
    Ok(())
}

struct JoinApprovedReplay<'a> {
    device_id: &'a crate::DeviceId,
    encryption_public_key: &'a crate::DevicePublicKey,
    signing_public_key: &'a crate::DeviceSigningPublicKey,
    secrets_key_ciphertext: &'a crate::AgeArmoredCiphertext,
    members_key_ciphertext: &'a crate::AgeArmoredCiphertext,
    requested_at: &'a str,
}

fn record_pending_join(
    state: &mut VaultMetaState,
    device_id: &crate::DeviceId,
    encryption_public_key: &crate::DevicePublicKey,
    signing_public_key: &crate::DeviceSigningPublicKey,
    requested_at: &str,
) {
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

fn record_sentinel_participant(
    state: &mut VaultMetaState,
    device_id: &crate::DeviceId,
    encryption_public_key: &crate::DevicePublicKey,
    signing_public_key: &crate::DeviceSigningPublicKey,
    label: &crate::MemberLabel,
    requested_at: &str,
) {
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

fn apply_join_approved(
    state: &mut VaultMetaState,
    approved: &JoinApprovedReplay<'_>,
) -> nook_auth2::MultiDeviceResult<()> {
    state.joins.remove(approved.device_id);
    state.enrolled_devices.insert(
        approved.device_id.clone(),
        JoinRequest {
            device_id: approved.device_id.clone(),
            public_key: approved.encryption_public_key.clone(),
            signing_public_key: approved.signing_public_key.clone(),
            requested_at: approved.requested_at.to_owned(),
        },
    );
    let auth_id = dec_auth_id_from_public_key(approved.encryption_public_key)?;
    state.auth.insert(
        auth_id,
        AuthEnvelopes {
            secrets_key: approved.secrets_key_ciphertext.clone(),
            members_key: approved.members_key_ciphertext.clone(),
        },
    );
    Ok(())
}

fn apply_sentinel_shares(state: &mut VaultMetaState, shares: &[crate::SentinelShareIssuedPayload]) {
    for share in shares {
        state.sentinel_shares.insert(
            share.device_id.clone(),
            SentinelShareEnvelope {
                version: share.version,
                threshold: share.threshold.into(),
                required_participants: share.required_participants.into(),
                share_index: share.share_index.into(),
                ciphertext: share.ciphertext.clone(),
            },
        );
    }
}

/// Replay core event-log meta operations from the event graph in topological order.
pub fn materialize_vault_meta_from_graph(
    graph: &crate::EventGraph,
    state: &mut VaultMetaState,
) -> nook_auth2::MultiDeviceResult<()> {
    // User secrets have their own encrypted event-log projection. Rebuild only
    // the authorization metadata owned by this adapter, while preserving that
    // already-materialized user projection. Clone first so a replay failure
    // leaves the complete live state unchanged.
    let mut rebuilt = VaultMetaState {
        secrets: state.secrets.clone(),
        ..VaultMetaState::default()
    };
    let order = graph
        .topological_order()
        .map_err(|e| MultiDeviceError::InvalidDeviceIdentity(e.to_string()))?;
    for event_id in order {
        let event = graph.get(&event_id).ok_or_else(|| {
            MultiDeviceError::InvalidDeviceIdentity(format!("Missing event {event_id} in graph."))
        })?;
        for operation in &event.body.operations {
            apply_vault_meta_operation(&mut rebuilt, operation, event.body.created_at.as_str())?;
        }
    }
    *state = rebuilt;
    Ok(())
}

/// Return whether the event graph currently grants a device access to a Simple
/// vault. The event log is the authorization source of truth: an old encrypted
/// auth envelope must not keep an extension active after `DeviceRevoked`.
pub fn event_graph_has_active_device_access(
    graph: &crate::EventGraph,
    expected_device_id: &crate::DeviceId,
    expected_public_key: &crate::DevicePublicKey,
    expected_signing_public_key: &crate::DeviceSigningPublicKey,
) -> nook_auth2::MultiDeviceResult<bool> {
    Ok(event_graph_active_device_envelopes(
        graph,
        expected_device_id,
        expected_public_key,
        expected_signing_public_key,
    )?
    .is_some())
}

/// Return current DEK envelopes only when the signed graph grants this exact
/// device encryption and signing key tuple access.
pub fn event_graph_active_device_envelopes(
    graph: &crate::EventGraph,
    expected_device_id: &crate::DeviceId,
    expected_public_key: &crate::DevicePublicKey,
    expected_signing_public_key: &crate::DeviceSigningPublicKey,
) -> nook_auth2::MultiDeviceResult<Option<AuthEnvelopes>> {
    let derived_device_id = nook_auth2::device_id_from_public_key(expected_public_key)?;
    if &derived_device_id != expected_device_id {
        return Err(MultiDeviceError::InvalidDeviceIdentity(
            "Extension device_id does not match its encryption public key.".to_owned(),
        ));
    }
    let expected_auth_id = dec_auth_id_from_public_key(expected_public_key)?;

    let mut active = None;
    let order = graph
        .topological_order()
        .map_err(|error| MultiDeviceError::InvalidDeviceIdentity(error.to_string()))?;
    for event_id in order {
        let event = graph.get(&event_id).ok_or_else(|| {
            MultiDeviceError::InvalidDeviceIdentity(format!("Missing event {event_id} in graph."))
        })?;
        for operation in &event.body.operations {
            match operation {
                VaultOperation::JoinApproved {
                    device_id,
                    encryption_public_key,
                    signing_public_key,
                    secrets_key_ciphertext,
                    members_key_ciphertext,
                    ..
                } if device_id == expected_device_id => {
                    active = (encryption_public_key == expected_public_key
                        && signing_public_key == expected_signing_public_key)
                        .then(|| AuthEnvelopes {
                            secrets_key: secrets_key_ciphertext.clone(),
                            members_key: members_key_ciphertext.clone(),
                        });
                }
                VaultOperation::DeviceRevoked { device_id } if device_id == expected_device_id => {
                    active = None;
                }
                VaultOperation::EpochCheckpoint {
                    rotated_meta_records: EpochMetadataState::Replace(records),
                    ..
                } if active.is_some() => {
                    let checkpoint_meta = VaultMetaState::from_stored_records(records)?;
                    active = checkpoint_meta.auth.get(&expected_auth_id).cloned();
                }
                _ => {}
            }
        }
    }
    Ok(active)
}

/// Return the active Simple-vault authorization recipients after replaying
/// approvals and revocations from the signed event graph.
pub fn event_graph_active_auth_ids(
    graph: &crate::EventGraph,
) -> nook_auth2::MultiDeviceResult<Vec<crate::AuthKeyId>> {
    let mut active = BTreeMap::<crate::DeviceId, crate::AuthKeyId>::new();
    let order = graph
        .topological_order()
        .map_err(|error| MultiDeviceError::InvalidDeviceIdentity(error.to_string()))?;
    for event_id in order {
        let event = graph.get(&event_id).ok_or_else(|| {
            MultiDeviceError::InvalidDeviceIdentity(format!("Missing event {event_id} in graph."))
        })?;
        for operation in &event.body.operations {
            match operation {
                VaultOperation::JoinApproved {
                    device_id,
                    encryption_public_key,
                    ..
                } => {
                    let derived_device_id =
                        nook_auth2::device_id_from_public_key(encryption_public_key)?;
                    if &derived_device_id != device_id {
                        return Err(MultiDeviceError::InvalidDeviceIdentity(
                            "Approved device id does not match its encryption public key."
                                .to_owned(),
                        ));
                    }
                    active.insert(
                        device_id.clone(),
                        crate::dec_auth_id_from_public_key(encryption_public_key)?,
                    );
                }
                VaultOperation::DeviceRevoked { device_id } => {
                    active.remove(device_id);
                }
                _ => {}
            }
        }
    }
    let mut auth_ids = active.into_values().collect::<Vec<_>>();
    auth_ids.sort();
    auth_ids.dedup();
    Ok(auth_ids)
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
    use crate::{
        AppKey, EpochMetadataState, EpochPasswordState, IdentityRecord, PasswordEntryId, SecretId,
        SecretType, StoredRecordPayload, StoredSecretRecord,
    };

    use std::io;

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
    ) -> anyhow::Result<VaultEvent> {
        Ok(VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store_id.clone(),
                actor_id: signing.actor_id()?,
                actor_signing_public_key: signing.public_key(),
                parents,
                created_at: IsoTimestamp::parse(timestamp)?,
                key_epoch: EventId::from_sha256_hex(
                    crate::sha256_hex(store_id.as_str().as_bytes()).as_str(),
                )?,
                operations,
            },
            signing.signing_key(),
        )?)
    }

    fn owner_access_graph(
        owner: &DeviceIdentity,
        signing: &SigningIdentity,
        store_id: &StoreId,
        envelopes: AuthEnvelopes,
    ) -> anyhow::Result<(EventGraph, EventId)> {
        let root = signed_event(
            signing,
            store_id,
            vec![],
            vec![
                VaultOperation::VaultImported {
                    source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                    secrets: vec![],
                    password_entries: vec![],
                },
                VaultOperation::JoinApproved {
                    device_id: owner.device_id().clone(),
                    encryption_public_key: owner.public_key(),
                    signing_public_key: signing.public_key(),
                    label: MemberLabel::from_trusted("Owner".to_owned()),
                    secrets_key_ciphertext: envelopes.secrets_key,
                    members_key_ciphertext: envelopes.members_key,
                },
            ],
            "2026-08-15T00:00:00Z",
        )?;
        let root_id = root.id()?;
        let mut graph = EventGraph::new();
        graph.insert(root, store_id.as_str())?;
        Ok((graph, root_id))
    }

    fn append_password_rotation_checkpoint(
        graph: &mut EventGraph,
        signing: &SigningIdentity,
        store_id: &StoreId,
        parent: EventId,
        device: &DeviceIdentity,
    ) -> anyhow::Result<(EventId, AuthEnvelopes)> {
        let replacement_keys = crate::generate_vault_keys()?;
        let replacement_record = crate::genesis_auth_record(
            device,
            &replacement_keys.secrets_key,
            &replacement_keys.members_key,
        )?;
        let replacement_auth = crate::parse_auth_envelopes(replacement_record.value.as_str())?;
        let trigger = signed_event(
            signing,
            store_id,
            vec![parent],
            vec![VaultOperation::PasswordRotated {
                entry_id: PasswordEntryId::parse("pwdentry001")?,
                envelope: crate::PasswordEnvelope {
                    version: crate::PasswordEnvelopeVersion::CURRENT,
                    kdf: "scrypt".to_owned(),
                    work_factor: 10.into(),
                    recipient: "recipient".to_owned(),
                    wrapped_keys: "wrapped".to_owned(),
                    ciphertext: "ciphertext".to_owned(),
                },
            }],
            "2026-08-15T00:01:30Z",
        )?;
        let trigger_id = trigger.id()?;
        graph.insert(trigger, store_id.as_str())?;
        let checkpoint = VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store_id.clone(),
                actor_id: signing.actor_id()?,
                actor_signing_public_key: signing.public_key(),
                parents: vec![trigger_id.clone()],
                created_at: IsoTimestamp::parse("2026-08-15T00:01:31Z")?,
                key_epoch: trigger_id,
                operations: vec![VaultOperation::EpochCheckpoint {
                    secrets: Vec::new(),
                    members_checkpoint_hash: Sha256Hex::from_trusted("0".repeat(64)),
                    rotated_meta_records: EpochMetadataState::Replace(vec![replacement_record]),
                    password_entries: EpochPasswordState::Replace(Vec::new()),
                }],
            },
            signing.signing_key(),
        )?;
        let checkpoint_id = checkpoint.id()?;
        graph.insert(checkpoint, store_id.as_str())?;
        Ok((checkpoint_id, replacement_auth))
    }

    fn active_envelopes_for(
        graph: &EventGraph,
        device: &DeviceIdentity,
        signing: &SigningIdentity,
    ) -> anyhow::Result<Option<AuthEnvelopes>> {
        Ok(event_graph_active_device_envelopes(
            graph,
            device.device_id(),
            &device.public_key(),
            &signing.public_key(),
        )?)
    }

    #[test]
    fn sentinel_event_materialization_retains_complete_public_roster() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let operation = VaultOperation::SentinelParticipantEnrolled {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key(),
            signing_public_key: signing.public_key(),
            label: MemberLabel::from_trusted("Owner".to_owned()),
        };
        let mut state = VaultMetaState::default();
        apply_vault_meta_operation(&mut state, &operation, "2026-07-09T00:00:00Z")?;
        let participant = state
            .sentinel_participants
            .get(identity.device_id())
            .ok_or_else(|| io::Error::other("sentinel participant must exist"))?;
        assert_eq!(participant.encryption_public_key, identity.public_key());
        assert_eq!(participant.signing_public_key, signing.public_key());
        assert_eq!(participant.label, "Owner");

        let members_key = crate::generate_symmetric_key()?;
        let records = sentinel_member_records_from_public_roster(&state, &members_key)?;
        let roster = crate::resolve_member_roster(&records, &members_key)?;
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].device_id, *identity.device_id());

        apply_vault_meta_operation(
            &mut state,
            &VaultOperation::MemberRenamed {
                device_id: identity.device_id().clone(),
                label: MemberLabel::from_trusted("Renamed".to_owned()),
            },
            "2026-07-09T00:01:00Z",
        )?;
        assert_eq!(
            state
                .sentinel_participants
                .get(identity.device_id())
                .ok_or_else(|| io::Error::other("sentinel participant must exist"))?
                .label,
            "Renamed"
        );
        Ok(())
    }

    #[test]
    fn simple_identity_genesis_retains_every_app_key_authorization() -> anyhow::Result<()> {
        let current = AppKey::generate()?;
        let second = AppKey::generate()?;
        let (current_signing, _) = SigningIdentity::generate()?;
        let (second_signing, _) = SigningIdentity::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &current, Some("Browser".to_owned()))?;
        identity.add_member(crate::IdentityMember {
            app_id: second.app_id().clone(),
            auth_id: second.auth_id(),
            public_key: second.public_key(),
            signing_public_key: second_signing.public_key(),
            label: Some("Phone".to_owned()),
        })?;
        let keys = crate::generate_vault_keys()?;
        let operations =
            simple_identity_genesis_operations(&SimpleIdentityGenesisOperationsInput {
                identity: &identity,
                keys: &keys,
                current_app_id: current.app_id(),
                current_signing_public_key: &current_signing.public_key(),
                created_at: "2026-08-14T00:00:00Z",
            })?;

        assert_eq!(operations.len(), 2);
        assert!(operations.iter().any(|operation| matches!(
            operation,
            VaultOperation::JoinApproved {
                device_id,
                signing_public_key,
                ..
            } if device_id == second.app_id()
                && signing_public_key == &second_signing.public_key()
        )));
        let mut state = VaultMetaState::default();
        for operation in &operations {
            apply_vault_meta_operation(&mut state, operation, "2026-08-14T00:00:00Z")?;
        }
        assert_eq!(state.enrolled_devices.len(), 2);
        for app_key in [&current, &second] {
            let envelopes = state
                .auth
                .get(&app_key.auth_id())
                .ok_or_else(|| io::Error::other("member authorization must be replayable"))?;
            assert_eq!(
                app_key.decrypt_envelope(&envelopes.secrets_key)?,
                keys.secrets_key
            );
            assert_eq!(
                app_key.decrypt_envelope(&envelopes.members_key)?,
                keys.members_key
            );
        }
        Ok(())
    }

    #[test]
    fn extension_access_follows_approval_and_revocation_events() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let extension = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let keys = crate::generate_vault_keys()?;
        let auth = crate::genesis_auth_record(&extension, &keys.secrets_key, &keys.members_key)?;
        let envelopes = crate::parse_auth_envelopes(auth.value.as_str())?;
        let store_id = crate::generate_store_id()?;
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
        )?;
        let approval_id = approval.id()?;
        graph.insert(approval, store_id.as_str())?;

        assert!(event_graph_has_active_device_access(
            &graph,
            extension.device_id(),
            &extension.public_key(),
            &signing.public_key(),
        )?);
        let auth_id = dec_auth_id_from_public_key(&extension.public_key())?;
        assert_eq!(event_graph_active_auth_ids(&graph)?, vec![auth_id.clone()]);
        let mut meta = VaultMetaState::default();
        materialize_vault_meta_from_graph(&graph, &mut meta)?;
        assert!(meta.auth.contains_key(&auth_id));
        assert_eq!(meta.enrolled_devices.len(), 1);
        assert!(meta.enrolled_devices.contains_key(extension.device_id()));
        let (other_signing, _) = SigningIdentity::generate()?;
        assert!(!event_graph_has_active_device_access(
            &graph,
            extension.device_id(),
            &extension.public_key(),
            &other_signing.public_key(),
        )?);
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
        )?;
        graph.insert(revocation, store_id.as_str())?;
        assert!(!event_graph_has_active_device_access(
            &graph,
            extension.device_id(),
            &extension.public_key(),
            &signing.public_key(),
        )?);
        assert!(event_graph_active_auth_ids(&graph)?.is_empty());
        materialize_vault_meta_from_graph(&graph, &mut meta)?;
        assert!(!meta.enrolled_devices.contains_key(extension.device_id()));
        Ok(())
    }

    #[test]
    fn metadata_rebuild_discards_state_absent_from_the_accepted_graph() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let keys = crate::generate_vault_keys()?;
        let auth = crate::genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key)?;
        let mut meta = VaultMetaState::from_stored_records(&[auth])?;
        let secret_id = crate::generate_secret_id()?;
        meta.secrets.insert(
            secret_id.clone(),
            (
                SecretType::Login,
                StoredRecordPayload::from_trusted("ciphertext".to_owned()),
            ),
        );
        assert!(!meta.auth.is_empty());

        materialize_vault_meta_from_graph(&EventGraph::new(), &mut meta)?;

        assert!(meta.auth.is_empty());
        assert!(meta.secrets.contains_key(&secret_id));
        Ok(())
    }

    #[test]
    fn explicit_empty_checkpoint_metadata_clears_live_grants() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let keys = crate::generate_vault_keys()?;
        let auth = crate::genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key)?;
        let envelopes = crate::parse_auth_envelopes(auth.value.as_str())?;
        let mut meta = VaultMetaState::from_stored_records(&[auth])?;
        apply_vault_meta_operation(
            &mut meta,
            &VaultOperation::JoinApproved {
                device_id: identity.device_id().clone(),
                encryption_public_key: identity.public_key(),
                signing_public_key: signing.public_key(),
                label: MemberLabel::from_trusted("Owner".to_owned()),
                secrets_key_ciphertext: envelopes.secrets_key,
                members_key_ciphertext: envelopes.members_key,
            },
            "2026-08-14T23:59:00Z",
        )?;
        assert_eq!(meta.enrolled_devices.len(), 1);

        apply_vault_meta_operation(
            &mut meta,
            &VaultOperation::EpochCheckpoint {
                secrets: Vec::new(),
                members_checkpoint_hash: Sha256Hex::from_trusted("0".repeat(64)),
                rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
                password_entries: EpochPasswordState::LegacyRetain,
            },
            "2026-08-15T00:00:00Z",
        )?;

        assert!(meta.auth.is_empty());
        assert!(meta.members.is_empty());
        assert!(meta.enrolled_devices.is_empty());
        Ok(())
    }

    #[test]
    fn invalid_checkpoint_sentinel_share_preserves_live_grants() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let keys = crate::generate_vault_keys()?;
        let auth = crate::genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key)?;
        let mut meta = VaultMetaState::from_stored_records(&[auth])?;
        let before = meta.clone();
        let invalid = StoredSecretRecord {
            key: SecretId::from_vault_record("sentinel_share:0123456789abcdef"),
            secret_type: None,
            value: StoredRecordPayload::from_trusted(r#"{"version":3}"#.to_owned()),
        };
        let operation = VaultOperation::EpochCheckpoint {
            secrets: Vec::new(),
            members_checkpoint_hash: Sha256Hex::from_trusted("0".repeat(64)),
            rotated_meta_records: EpochMetadataState::Replace(vec![invalid]),
            password_entries: EpochPasswordState::LegacyRetain,
        };
        match apply_vault_meta_operation(&mut meta, &operation, "2026-08-15T00:00:00Z") {
            Err(_) => {}
            Ok(()) => return Err(anyhow::anyhow!("invalid checkpoint must be rejected")),
        }
        assert_eq!(meta, before);
        Ok(())
    }

    #[test]
    fn active_device_envelopes_follow_revocation_and_reapproval() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let extension = DeviceIdentity::generate()?;
        let (owner_signing, _) = SigningIdentity::generate()?;
        let (extension_signing, _) = SigningIdentity::generate()?;
        let store_id = crate::generate_store_id()?;
        let owner_keys = crate::generate_vault_keys()?;
        let owner_auth = crate::parse_auth_envelopes(
            crate::genesis_auth_record(&owner, &owner_keys.secrets_key, &owner_keys.members_key)?
                .value
                .as_str(),
        )?;
        let (mut graph, root_id) =
            owner_access_graph(&owner, &owner_signing, &store_id, owner_auth)?;

        let old_keys = crate::generate_vault_keys()?;
        let old_auth = crate::parse_auth_envelopes(
            crate::genesis_auth_record(&extension, &old_keys.secrets_key, &old_keys.members_key)?
                .value
                .as_str(),
        )?;
        let approval = signed_event(
            &owner_signing,
            &store_id,
            vec![root_id],
            vec![VaultOperation::JoinApproved {
                device_id: extension.device_id().clone(),
                encryption_public_key: extension.public_key(),
                signing_public_key: extension_signing.public_key(),
                label: MemberLabel::from_trusted("Extension".to_owned()),
                secrets_key_ciphertext: old_auth.secrets_key,
                members_key_ciphertext: old_auth.members_key,
            }],
            "2026-08-15T00:01:00Z",
        )?;
        let approval_id = approval.id()?;
        graph.insert(approval, store_id.as_str())?;
        let (checkpoint_id, replacement_auth) = append_password_rotation_checkpoint(
            &mut graph,
            &owner_signing,
            &store_id,
            approval_id,
            &extension,
        )?;
        assert_eq!(
            active_envelopes_for(&graph, &extension, &extension_signing)?,
            Some(replacement_auth)
        );
        let revocation = signed_event(
            &owner_signing,
            &store_id,
            vec![checkpoint_id],
            vec![VaultOperation::DeviceRevoked {
                device_id: extension.device_id().clone(),
            }],
            "2026-08-15T00:02:00Z",
        )?;
        let revocation_id = revocation.id()?;
        graph.insert(revocation, store_id.as_str())?;
        assert!(active_envelopes_for(&graph, &extension, &extension_signing)?.is_none());

        let replacement_keys = crate::generate_vault_keys()?;
        let replacement_auth = crate::parse_auth_envelopes(
            crate::genesis_auth_record(
                &extension,
                &replacement_keys.secrets_key,
                &replacement_keys.members_key,
            )?
            .value
            .as_str(),
        )?;
        let expected = replacement_auth.clone();
        let reapproval = signed_event(
            &owner_signing,
            &store_id,
            vec![revocation_id],
            vec![VaultOperation::JoinApproved {
                device_id: extension.device_id().clone(),
                encryption_public_key: extension.public_key(),
                signing_public_key: extension_signing.public_key(),
                label: MemberLabel::from_trusted("Extension".to_owned()),
                secrets_key_ciphertext: replacement_auth.secrets_key,
                members_key_ciphertext: replacement_auth.members_key,
            }],
            "2026-08-15T00:03:00Z",
        )?;
        graph.insert(reapproval, store_id.as_str())?;

        assert_eq!(
            active_envelopes_for(&graph, &extension, &extension_signing)?,
            Some(expected)
        );
        Ok(())
    }
}
