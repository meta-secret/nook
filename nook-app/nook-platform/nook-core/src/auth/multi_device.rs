//! Compatibility exports for portable vault key-access primitives.
//!
//! The reusable device/member/password primitives live in `nook-auth2`. This
//! module keeps `nook-core`'s existing public API stable and owns the small
//! adapter that replays core event-log operations into auth metadata state.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{MemberLabel, VaultOperation};
use nook_auth2::{CreateSentinelShareRecordsRequest, SentinelShareEnvelope};
use nook_auth2::{
    IdentityRecord, IdentityVaultGenesisRecordsRequest, MultiDeviceError,
    ResolveMemberRosterRequest, VaultMember,
};

pub use nook_auth2::multi_device_api::*;

/// Inputs for the immutable Simple-vault identity roster written at genesis.
pub struct SimpleIdentityGenesisOperationsInput<'a> {
    pub identity: &'a crate::IdentityRecord,
    pub keys: &'a VaultKeys,
    pub current_app_id: &'a crate::AppId,
    pub current_signing_public_key: &'a crate::DeviceSigningPublicKey,
    pub created_at: &'a str,
}

impl SimpleIdentityGenesisOperationsInput<'_> {
    /// Build one signed-log authorization operation for every identity app key.
    ///
    /// Identity membership is portable ownership state. The event log must
    /// carry the complete roster because encrypted metadata projections are
    /// disposable.
    pub fn operations(&self) -> nook_auth2::MultiDeviceResult<Vec<VaultOperation>> {
        let identity = self.identity;
        let keys = self.keys;
        let current_app_id = self.current_app_id;
        let current_signing_public_key = self.current_signing_public_key;
        let created_at = self.created_at;
        if identity
            .members
            .iter()
            .all(|member| &member.app_id != current_app_id)
        {
            return Err(MultiDeviceError::IdentityEnrollmentRequired);
        }
        let records =
            IdentityRecord::identity_vault_genesis_records(IdentityVaultGenesisRecordsRequest {
                identity: identity,
                keys: keys,
                enrolled_at: created_at,
            })?;
        identity
            .members
            .iter()
            .map(|member| {
                let record = records
                    .iter()
                    .find(|record| record.key.as_str() == member.auth_id.as_str())
                    .ok_or_else(|| {
                        MultiDeviceError::InvalidDeviceIdentity(
                            "identity genesis is missing a member authorization envelope"
                                .to_owned(),
                        )
                    })?;
                let envelopes = crate::AuthEnvelopes::parse(record.value.as_str())?;
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
}

#[cfg(test)]
mod tests {
    struct FixturePasswordRotation {
        graph: EventGraph,
        event_id: EventId,
        envelopes: AuthEnvelopes,
    }

    use crate::{
        AppKey, EpochMetadataState, EpochPasswordState, IdentityRecord, PasswordEntryId, SecretId,
        SecretType, StoredRecordPayload, StoredSecretRecord,
    };

    use std::io;

    use super::*;
    use crate::{
        DeviceAuthorization, EventGraph, EventGraphAuthorizationProjection, EventGraphDeviceAccess,
        EventGraphDeviceAccessRequest, EventGraphVaultArchitecture, EventId, EventInsertStatus,
        IsoTimestamp, MemberLabel, SentinelMemberRecordProjection,
        SentinelMemberRecordProjectionRequest, SigningIdentity, StoreId, VaultEvent,
        VaultEventBody, VaultEventSchemaVersion, VaultMetaGraphProjection,
        VaultMetaOperationApplier, VaultMetaOperationRequest,
    };

    struct Fixtures;

    impl Fixtures {
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
            let root = Fixtures::signed_event(
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
            match graph.insert(crate::EventGraphInsert {
                event: root,
                expected_store_id: store_id.as_str(),
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?;
            Ok((graph, root_id))
        }

        fn append_password_rotation_checkpoint(
            mut graph: EventGraph,
            signing: &SigningIdentity,
            store_id: &StoreId,
            parent: EventId,
            device: &DeviceIdentity,
        ) -> anyhow::Result<FixturePasswordRotation> {
            let replacement_keys = crate::VaultKeys::generate()?;
            let replacement_record =
                device.auth_record(&replacement_keys.secrets_key, &replacement_keys.members_key)?;
            let replacement_auth = crate::AuthEnvelopes::parse(replacement_record.value.as_str())?;
            let trigger = Fixtures::signed_event(
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
            match graph.insert(crate::EventGraphInsert {
                event: trigger,
                expected_store_id: store_id.as_str(),
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?;
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
                        members_checkpoint_hash: nook_auth2::Sha256Hex::from_trusted(
                            "0".repeat(64),
                        ),
                        rotated_meta_records: EpochMetadataState::Replace(vec![replacement_record]),
                        password_entries: EpochPasswordState::Replace(Vec::new()),
                    }],
                },
                signing.signing_key(),
            )?;
            let checkpoint_id = checkpoint.id()?;
            match graph.insert(crate::EventGraphInsert {
                event: checkpoint,
                expected_store_id: store_id.as_str(),
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?;
            Ok(FixturePasswordRotation {
                graph,
                event_id: checkpoint_id,
                envelopes: replacement_auth,
            })
        }

        fn active_envelopes_for(
            graph: &EventGraph,
            device: &DeviceIdentity,
            signing: &SigningIdentity,
        ) -> anyhow::Result<DeviceAuthorization> {
            let public_key = device.public_key();
            Ok(EventGraphDeviceAccess::new(graph).active_envelopes(
                &EventGraphDeviceAccessRequest {
                    expected_device_id: device.device_id(),
                    expected_public_key: &public_key,
                    expected_signing_public_key: &signing.public_key(),
                },
            )?)
        }
    }

    struct SentinelCheckpointHistory {
        graph: EventGraph,
        store_id: StoreId,
        owner_signing: SigningIdentity,
        first: DeviceIdentity,
        second: DeviceIdentity,
        checkpoint_id: EventId,
    }

    impl SentinelCheckpointHistory {
        fn new() -> anyhow::Result<Self> {
            let owner = DeviceIdentity::generate()?;
            let retired = DeviceIdentity::generate()?;
            let first = DeviceIdentity::generate()?;
            let second = DeviceIdentity::generate()?;
            let (owner_signing, _) = SigningIdentity::generate()?;
            let store_id = StoreId::generate()?;
            let owner_keys = VaultKeys::generate()?;
            let owner_auth = AuthEnvelopes::parse(
                owner
                    .auth_record(&owner_keys.secrets_key, &owner_keys.members_key)?
                    .value
                    .as_str(),
            )?;
            let (mut graph, root_id) =
                Fixtures::owner_access_graph(&owner, &owner_signing, &store_id, owner_auth)?;
            let trigger = Fixtures::signed_event(
                &owner_signing,
                &store_id,
                vec![root_id],
                vec![VaultOperation::DeviceRevoked {
                    device_id: retired.device_id().clone(),
                }],
                "2026-08-15T00:01:00Z",
            )?;
            let trigger_id = trigger.id()?;
            anyhow::ensure!(
                match graph.insert(crate::EventGraphInsert {
                    event: trigger,
                    expected_store_id: store_id.as_str()
                }) {
                    Ok(inserted) => {
                        graph = inserted.graph;
                        Ok(inserted.status)
                    }
                    Err(rejected) => {
                        graph = rejected.graph;
                        Err(rejected.cause)
                    }
                }? == EventInsertStatus::Applied,
                "security trigger must apply"
            );
            let share_records = SentinelShareEnvelope::create_sentinel_share_records(
                CreateSentinelShareRecordsRequest {
                    keys: &VaultKeys::generate()?,
                    participants: &[first.clone(), second.clone()],
                    threshold: 2.into(),
                },
            )?;
            let checkpoint = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: store_id.clone(),
                    actor_id: owner_signing.actor_id()?,
                    actor_signing_public_key: owner_signing.public_key(),
                    parents: vec![trigger_id.clone()],
                    created_at: IsoTimestamp::parse("2026-08-15T00:01:01Z")?,
                    key_epoch: trigger_id,
                    operations: vec![VaultOperation::EpochCheckpoint {
                        secrets: Vec::new(),
                        members_checkpoint_hash: nook_auth2::Sha256Hex::from_trusted(
                            "0".repeat(64),
                        ),
                        rotated_meta_records: EpochMetadataState::Replace(share_records),
                        password_entries: EpochPasswordState::Replace(Vec::new()),
                    }],
                },
                owner_signing.signing_key(),
            )?;
            let checkpoint_id = checkpoint.id()?;
            anyhow::ensure!(
                match graph.insert(crate::EventGraphInsert {
                    event: checkpoint,
                    expected_store_id: store_id.as_str()
                }) {
                    Ok(inserted) => {
                        graph = inserted.graph;
                        Ok(inserted.status)
                    }
                    Err(rejected) => {
                        graph = rejected.graph;
                        Err(rejected.cause)
                    }
                }? == EventInsertStatus::Applied,
                "Sentinel checkpoint must apply"
            );
            graph.validate_authorizations()?;
            Ok(Self {
                graph,
                store_id,
                owner_signing,
                first,
                second,
                checkpoint_id,
            })
        }

        fn projected_meta(&self) -> anyhow::Result<VaultMetaState> {
            let mut meta = VaultMetaState::default();
            VaultMetaGraphProjection::new(&self.graph).materialize(&mut meta)?;
            Ok(meta)
        }

        fn first_revocation(&self) -> anyhow::Result<VaultEvent> {
            Fixtures::signed_event(
                &self.owner_signing,
                &self.store_id,
                vec![self.checkpoint_id.clone()],
                vec![VaultOperation::DeviceRevoked {
                    device_id: self.first.device_id().clone(),
                }],
                "2026-08-15T00:01:02Z",
            )
        }

        fn self_approval(&self, parent: EventId) -> anyhow::Result<VaultEvent> {
            let joiner = DeviceIdentity::generate()?;
            let (joiner_signing, _) = SigningIdentity::generate()?;
            let joiner_keys = VaultKeys::generate()?;
            let joiner_envelopes = AuthEnvelopes::parse(
                joiner
                    .auth_record(&joiner_keys.secrets_key, &joiner_keys.members_key)?
                    .value
                    .as_str(),
            )?;
            Fixtures::signed_event(
                &joiner_signing,
                &self.store_id,
                vec![parent],
                vec![VaultOperation::JoinApproved {
                    device_id: joiner.device_id().clone(),
                    encryption_public_key: joiner.public_key(),
                    signing_public_key: joiner_signing.public_key(),
                    label: MemberLabel::from_trusted("Joiner".to_owned()),
                    secrets_key_ciphertext: joiner_envelopes.secrets_key,
                    members_key_ciphertext: joiner_envelopes.members_key,
                }],
                "2026-08-15T00:01:03Z",
            )
        }
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
        VaultMetaOperationApplier::new(&mut state).apply(&VaultMetaOperationRequest {
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

        let members_key = crate::SymmetricKey::generate_for_vault()?;
        let records = SentinelMemberRecordProjection::new(&SentinelMemberRecordProjectionRequest {
            state: &state,
            members_key: &members_key,
        })
        .build()?;
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &records,
            members_key: &members_key,
        })?;
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].device_id, *identity.device_id());

        let operation = VaultOperation::MemberRenamed {
            device_id: identity.device_id().clone(),
            label: MemberLabel::from_trusted("Renamed".to_owned()),
        };
        VaultMetaOperationApplier::new(&mut state).apply(&VaultMetaOperationRequest {
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
        identity = identity.add_member(crate::IdentityMember {
            app_id: second.app_id().clone(),
            auth_id: second.auth_id(),
            public_key: second.public_key(),
            signing_public_key: second_signing.public_key(),
            label: Some("Phone".to_owned()),
        })?;
        let keys = crate::VaultKeys::generate()?;
        let operations = (SimpleIdentityGenesisOperationsInput {
            identity: &identity,
            keys: &keys,
            current_app_id: current.app_id(),
            current_signing_public_key: &current_signing.public_key(),
            created_at: "2026-08-14T00:00:00Z",
        })
        .operations()?;

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
            VaultMetaOperationApplier::new(&mut state).apply(&VaultMetaOperationRequest {
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
        let keys = crate::VaultKeys::generate()?;
        let auth = extension.auth_record(&keys.secrets_key, &keys.members_key)?;
        let envelopes = crate::AuthEnvelopes::parse(auth.value.as_str())?;
        let store_id = crate::StoreId::generate()?;
        let mut graph = EventGraph::new();
        let approval = Fixtures::signed_event(
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
        match graph.insert(crate::EventGraphInsert {
            event: approval,
            expected_store_id: store_id.as_str(),
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let extension_public_key = extension.public_key();
        let signing_public_key = signing.public_key();
        let extension_access = EventGraphDeviceAccess::new(&graph);
        assert!(extension_access.has_access(&EventGraphDeviceAccessRequest {
            expected_device_id: extension.device_id(),
            expected_public_key: &extension_public_key,
            expected_signing_public_key: &signing_public_key,
        })?);
        let auth_id = extension.public_key().auth_id()?;
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

        let revocation = Fixtures::signed_event(
            &signing,
            &store_id,
            vec![approval_id],
            vec![VaultOperation::DeviceRevoked {
                device_id: extension.device_id().clone(),
            }],
            "2026-07-14T00:01:00Z",
        )?;
        match graph.insert(crate::EventGraphInsert {
            event: revocation,
            expected_store_id: store_id.as_str(),
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
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
        let keys = crate::VaultKeys::generate()?;
        let auth = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
        let mut meta = VaultMetaState::from_stored_records(&[auth])?;
        let secret_id = crate::SecretId::generate()?;
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
        let keys = crate::VaultKeys::generate()?;
        let auth = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
        let envelopes = crate::AuthEnvelopes::parse(auth.value.as_str())?;
        let mut meta = VaultMetaState::from_stored_records(&[auth])?;
        let operation = VaultOperation::JoinApproved {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key(),
            signing_public_key: signing.public_key(),
            label: MemberLabel::from_trusted("Owner".to_owned()),
            secrets_key_ciphertext: envelopes.secrets_key,
            members_key_ciphertext: envelopes.members_key,
        };
        VaultMetaOperationApplier::new(&mut meta).apply(&VaultMetaOperationRequest {
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
        VaultMetaOperationApplier::new(&mut meta).apply(&VaultMetaOperationRequest {
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
        let keys = crate::VaultKeys::generate()?;
        let auth = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
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
        match VaultMetaOperationApplier::new(&mut meta).apply(&VaultMetaOperationRequest {
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
    fn checkpoint_history_remains_sentinel_after_share_revocation() -> anyhow::Result<()> {
        let mut history = SentinelCheckpointHistory::new()?;
        assert_eq!(
            history.graph.classify_vault_architecture(),
            EventGraphVaultArchitecture::Sentinel
        );
        assert!(
            history
                .projected_meta()?
                .sentinel_shares
                .contains_key(history.first.device_id())
        );

        let revocation = history.first_revocation()?;
        let revocation_id = revocation.id()?;
        assert_eq!(
            history
                .graph
                .insert(revocation, history.store_id.as_str())?,
            EventInsertStatus::Applied
        );
        let meta = history.projected_meta()?;
        assert!(!meta.sentinel_shares.contains_key(history.first.device_id()));
        assert!(
            meta.sentinel_shares
                .contains_key(history.second.device_id())
        );
        assert_eq!(
            history.graph.classify_vault_architecture(),
            EventGraphVaultArchitecture::Sentinel
        );

        let self_approval = history.self_approval(revocation_id)?;
        assert!(matches!(
            history
                .graph
                .insert(self_approval, history.store_id.as_str())?,
            EventInsertStatus::Quarantined(_)
        ));
        Ok(())
    }

    #[test]
    fn active_device_envelopes_follow_revocation_and_reapproval() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let extension = DeviceIdentity::generate()?;
        let (owner_signing, _) = SigningIdentity::generate()?;
        let (extension_signing, _) = SigningIdentity::generate()?;
        let store_id = crate::StoreId::generate()?;
        let owner_keys = crate::VaultKeys::generate()?;
        let owner_auth = crate::AuthEnvelopes::parse(
            owner
                .auth_record(&owner_keys.secrets_key, &owner_keys.members_key)?
                .value
                .as_str(),
        )?;
        let (mut graph, root_id) =
            Fixtures::owner_access_graph(&owner, &owner_signing, &store_id, owner_auth)?;

        let old_keys = crate::VaultKeys::generate()?;
        let old_auth = crate::AuthEnvelopes::parse(
            extension
                .auth_record(&old_keys.secrets_key, &old_keys.members_key)?
                .value
                .as_str(),
        )?;
        let approval = Fixtures::signed_event(
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
        match graph.insert(crate::EventGraphInsert {
            event: approval,
            expected_store_id: store_id.as_str(),
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        let (checkpoint_id, replacement_auth) = {
            let prepared = Fixtures::append_password_rotation_checkpoint(
                graph,
                &owner_signing,
                &store_id,
                approval_id,
                &extension,
            )?;
            graph = prepared.graph;
            (prepared.event_id, prepared.envelopes)
        };
        assert_eq!(
            Fixtures::active_envelopes_for(&graph, &extension, &extension_signing)?,
            DeviceAuthorization::Granted(replacement_auth)
        );
        let revocation = Fixtures::signed_event(
            &owner_signing,
            &store_id,
            vec![checkpoint_id],
            vec![VaultOperation::DeviceRevoked {
                device_id: extension.device_id().clone(),
            }],
            "2026-08-15T00:02:00Z",
        )?;
        let revocation_id = revocation.id()?;
        match graph.insert(crate::EventGraphInsert {
            event: revocation,
            expected_store_id: store_id.as_str(),
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        assert_eq!(
            Fixtures::active_envelopes_for(&graph, &extension, &extension_signing)?,
            DeviceAuthorization::NotGranted
        );

        let replacement_keys = crate::VaultKeys::generate()?;
        let replacement_auth = crate::AuthEnvelopes::parse(
            extension
                .auth_record(&replacement_keys.secrets_key, &replacement_keys.members_key)?
                .value
                .as_str(),
        )?;
        let expected = replacement_auth.clone();
        let reapproval = Fixtures::signed_event(
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
        match graph.insert(crate::EventGraphInsert {
            event: reapproval,
            expected_store_id: store_id.as_str(),
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        assert_eq!(
            Fixtures::active_envelopes_for(&graph, &extension, &extension_signing)?,
            DeviceAuthorization::Granted(expected)
        );
        Ok(())
    }
}
