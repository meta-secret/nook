//! Compatibility exports for portable vault key-access primitives.
//!
//! The reusable device/member/password primitives live in `nook-auth2`. This
//! module keeps `nook-core`'s existing public API stable and owns the small
//! adapter that replays core event-log operations into auth metadata state.

use crate::MemberLabel;
use nook_auth2::{
    AgeArmoredCiphertext, DevicePublicKey, MultiDeviceError,
    encrypt_for_recipient as encrypt_for_auth_recipient,
};

pub use nook_auth2::multi_device_api::*;

use crate::VaultOperation;

#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "serialization boundary: encrypts serialized age plaintext bytes"
    )
)]
pub fn encrypt_for_recipient(
    plaintext: &[u8],
    recipient_public: &DevicePublicKey,
) -> nook_auth2::MultiDeviceResult<AgeArmoredCiphertext> {
    encrypt_for_auth_recipient(plaintext, recipient_public)
}

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

#[cfg(test)]
mod tests {
    use crate::{
        AppKey, EpochMetadataState, EpochPasswordState, IdentityRecord, PasswordEntryId, SecretId,
        SecretType, StoredRecordPayload, StoredSecretRecord,
    };

    use std::io;

    use super::*;
    use crate::{
        EventGraph, EventGraphAuthorizationProjection, EventGraphDeviceAccess,
        EventGraphDeviceAccessRequest, EventId, IsoTimestamp, MemberLabel,
        SentinelMemberRecordProjection, SentinelMemberRecordProjectionRequest, SigningIdentity,
        StoreId, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultMetaGraphProjection,
        VaultMetaOperationApplier, VaultMetaOperationRequest,
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
                    nook_auth2::Sha256Hex::from_bytes(store_id.as_str().as_bytes()).as_str(),
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
                    source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
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
                    members_checkpoint_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
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
        let public_key = device.public_key();
        Ok(
            EventGraphDeviceAccess::new(graph).active_envelopes(
                &EventGraphDeviceAccessRequest {
                    expected_device_id: device.device_id(),
                    expected_public_key: &public_key,
                    expected_signing_public_key: &signing.public_key(),
                },
            )?,
        )
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
        VaultMetaOperationApplier::new(&mut state).apply(VaultMetaOperationRequest {
            operation: &operation,
            requested_at: &IsoTimestamp::parse("2026-07-09T00:00:00Z")?,
        })?;
        let participant = state
            .sentinel_participants
            .get(identity.device_id())
            .ok_or_else(|| io::Error::other("sentinel participant must exist"))?;
        assert_eq!(participant.encryption_public_key, identity.public_key());
        assert_eq!(participant.signing_public_key, signing.public_key());
        assert_eq!(participant.label, "Owner");

        let members_key = crate::generate_symmetric_key()?;
        let records = SentinelMemberRecordProjection::new(SentinelMemberRecordProjectionRequest {
            state: &state,
            members_key: &members_key,
        })
        .build()?;
        let roster = crate::resolve_member_roster(&records, &members_key)?;
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].device_id, *identity.device_id());

        let operation = VaultOperation::MemberRenamed {
            device_id: identity.device_id().clone(),
            label: MemberLabel::from_trusted("Renamed".to_owned()),
        };
        VaultMetaOperationApplier::new(&mut state).apply(VaultMetaOperationRequest {
            operation: &operation,
            requested_at: &IsoTimestamp::parse("2026-07-09T00:01:00Z")?,
        })?;
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
            VaultMetaOperationApplier::new(&mut state).apply(VaultMetaOperationRequest {
                operation,
                requested_at: &IsoTimestamp::parse("2026-08-14T00:00:00Z")?,
            })?;
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
                    source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
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

        let extension_public_key = extension.public_key();
        let signing_public_key = signing.public_key();
        let extension_access = EventGraphDeviceAccess::new(&graph);
        assert!(extension_access.has_access(&EventGraphDeviceAccessRequest {
            expected_device_id: extension.device_id(),
            expected_public_key: &extension_public_key,
            expected_signing_public_key: &signing_public_key,
        })?);
        let auth_id = dec_auth_id_from_public_key(&extension.public_key())?;
        assert_eq!(
            EventGraphAuthorizationProjection::new(&graph).active_auth_ids()?,
            vec![auth_id.clone()]
        );
        let mut meta = VaultMetaState::default();
        VaultMetaGraphProjection::new(&graph).materialize(&mut meta)?;
        assert!(meta.auth.contains_key(&auth_id));
        assert_eq!(meta.enrolled_devices.len(), 1);
        assert!(meta.enrolled_devices.contains_key(extension.device_id()));
        let (other_signing, _) = SigningIdentity::generate()?;
        let other_signing_public_key = other_signing.public_key();
        assert!(
            !extension_access.has_access(&EventGraphDeviceAccessRequest {
                expected_device_id: extension.device_id(),
                expected_public_key: &extension_public_key,
                expected_signing_public_key: &other_signing_public_key,
            })?
        );
        assert!(
            EventGraphDeviceAccess::new(&graph)
                .has_access(&EventGraphDeviceAccessRequest {
                    expected_device_id: owner.device_id(),
                    expected_public_key: &owner.public_key(),
                    expected_signing_public_key: &signing_public_key,
                })
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
        assert!(!EventGraphDeviceAccess::new(&graph).has_access(
            &EventGraphDeviceAccessRequest {
                expected_device_id: extension.device_id(),
                expected_public_key: &extension_public_key,
                expected_signing_public_key: &signing_public_key,
            },
        )?);
        assert!(
            EventGraphAuthorizationProjection::new(&graph)
                .active_auth_ids()?
                .is_empty()
        );
        VaultMetaGraphProjection::new(&graph).materialize(&mut meta)?;
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

        let graph = EventGraph::new();
        VaultMetaGraphProjection::new(&graph).materialize(&mut meta)?;

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
        let operation = VaultOperation::JoinApproved {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key(),
            signing_public_key: signing.public_key(),
            label: MemberLabel::from_trusted("Owner".to_owned()),
            secrets_key_ciphertext: envelopes.secrets_key,
            members_key_ciphertext: envelopes.members_key,
        };
        VaultMetaOperationApplier::new(&mut meta).apply(VaultMetaOperationRequest {
            operation: &operation,
            requested_at: &IsoTimestamp::parse("2026-08-14T23:59:00Z")?,
        })?;
        assert_eq!(meta.enrolled_devices.len(), 1);

        let operation = VaultOperation::EpochCheckpoint {
            secrets: Vec::new(),
            members_checkpoint_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
            rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
            password_entries: EpochPasswordState::LegacyRetain,
        };
        VaultMetaOperationApplier::new(&mut meta).apply(VaultMetaOperationRequest {
            operation: &operation,
            requested_at: &IsoTimestamp::parse("2026-08-15T00:00:00Z")?,
        })?;

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
            members_checkpoint_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
            rotated_meta_records: EpochMetadataState::Replace(vec![invalid]),
            password_entries: EpochPasswordState::LegacyRetain,
        };
        match VaultMetaOperationApplier::new(&mut meta).apply(VaultMetaOperationRequest {
            operation: &operation,
            requested_at: &IsoTimestamp::parse("2026-08-15T00:00:00Z")?,
        }) {
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
