//! Side-effect-free preparation of an inert companion pairing activation.

use super::NookPrevalidatedCompanionPairingApproval;
use crate::manager::NookExternalEventLogRecords;
use nook_core::DeviceAuthorization;
use nook_core::VaultEvent;
use nook_core::{
    AuthEnvelopes, CheckedRemoteEvent, DeviceId, DevicePublicKey, DeviceSigningPublicKey,
    EventGraphDeviceAccess, EventGraphDeviceAccessRequest, EventGraphVaultArchitecture, EventId,
    LocalEventStore, StoreId, VaultMetaGraphProjection, VaultMetaState, VaultProjection,
};
#[cfg(test)]
use nook_core::{CreateSentinelShareRecordsRequest, SentinelShareEnvelope};
use std::collections::BTreeSet;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

mod candidate;
pub use candidate::{
    NookCompanionPairingCandidateFailure, NookCompanionPairingCandidateOutcome,
    NookCompanionPairingCandidateOutcomeState, NookStoredCompanionPairingActivationCandidate,
};

/// Opaque proof that pairing approval and event graph relationships were prepared.
/// It performs no storage or activation effect and conveys no live vault authority.
#[wasm_bindgen]
pub struct NookPreparedCompanionPairingActivation {
    approval: NookPrevalidatedCompanionPairingApproval,
    store_id: StoreId,
    records: NookExternalEventLogRecords,
    heads: Vec<EventId>,
    envelopes: AuthEnvelopes,
}

struct PreparedEventGraph {
    store_id: StoreId,
    heads: Vec<EventId>,
    envelopes: AuthEnvelopes,
}

#[derive(Debug, thiserror::Error)]
enum CompanionPairingPreparationFailure {
    #[error("invalid event record")]
    RecordInvalid,
    #[error("invalid event identifier")]
    IdentifierInvalid,
    #[error("duplicate event")]
    DuplicateEvent,
    #[error("event identifier mismatch")]
    EventIdMismatch,
    #[error("event vault mismatch")]
    VaultMismatch,
    #[error("invalid event graph")]
    GraphInvalid,
    #[error("event graph has pending history")]
    GraphPending,
    #[error("event graph has quarantined history")]
    GraphQuarantined,
    #[error("event projection conflict")]
    ProjectionConflict,
    #[error("unsupported vault architecture")]
    UnsupportedVaultArchitecture,
    #[error("recipient authorization mismatch")]
    RecipientAuthorizationMismatch,
}

impl CompanionPairingPreparationFailure {
    fn js_error(&self) -> JsError {
        let message = match self {
            Self::RecordInvalid
            | Self::IdentifierInvalid
            | Self::DuplicateEvent
            | Self::EventIdMismatch
            | Self::VaultMismatch
            | Self::GraphInvalid
            | Self::GraphPending
            | Self::GraphQuarantined
            | Self::ProjectionConflict
            | Self::UnsupportedVaultArchitecture
            | Self::RecipientAuthorizationMismatch => "pairing event authorization rejected",
        };
        JsError::new(message)
    }
}

impl NookPrevalidatedCompanionPairingApproval {
    fn prepare_event_graph(
        &self,
        records: &NookExternalEventLogRecords,
    ) -> Result<PreparedEventGraph, CompanionPairingPreparationFailure> {
        let store_id = StoreId::parse(&self.binding.vault_store_id)
            .map_err(|_| CompanionPairingPreparationFailure::VaultMismatch)?;
        let mut unique = BTreeSet::new();
        let mut event_store = LocalEventStore::new();
        for record in &records.0 {
            let event_id = EventId::parse(&record.event_id)
                .map_err(|_| CompanionPairingPreparationFailure::IdentifierInvalid)?;
            if !unique.insert(event_id.clone()) {
                return Err(CompanionPairingPreparationFailure::DuplicateEvent);
            }
            if record
                .event
                .id()
                .map_err(|_| CompanionPairingPreparationFailure::RecordInvalid)?
                != event_id
            {
                return Err(CompanionPairingPreparationFailure::EventIdMismatch);
            }
            let bytes = VaultEvent::serialize_event_storage_yaml(&record.event)
                .map_err(|_| CompanionPairingPreparationFailure::RecordInvalid)?;
            let checked = CheckedRemoteEvent::parse(&event_id, &bytes)
                .map_err(|_| CompanionPairingPreparationFailure::RecordInvalid)?;
            if !checked.belongs_to_store(store_id.as_str()) {
                return Err(CompanionPairingPreparationFailure::VaultMismatch);
            }
            event_store = event_store.put_event(nook_core::LocalEventWrite { event_id, bytes });
        }
        if unique.is_empty() {
            return Err(CompanionPairingPreparationFailure::GraphInvalid);
        }
        let graph = event_store
            .load_graph(store_id.as_str())
            .map_err(|_| CompanionPairingPreparationFailure::GraphInvalid)?;
        if graph.classify_vault_architecture() == EventGraphVaultArchitecture::Sentinel {
            return Err(CompanionPairingPreparationFailure::UnsupportedVaultArchitecture);
        }
        if !graph.pending_events().is_empty() {
            return Err(CompanionPairingPreparationFailure::GraphPending);
        }
        if !graph.quarantined().is_empty() {
            return Err(CompanionPairingPreparationFailure::GraphQuarantined);
        }
        graph
            .validate_authorizations()
            .map_err(|_| CompanionPairingPreparationFailure::GraphInvalid)?;
        let projection = VaultProjection::from_graph(&graph, store_id.as_str())
            .map_err(|_| CompanionPairingPreparationFailure::GraphInvalid)?;
        if !projection.security_conflicts.is_empty() {
            return Err(CompanionPairingPreparationFailure::ProjectionConflict);
        }
        let installation = &self.binding.request.installation;
        let device_id = DeviceId::parse(&installation.app_id)
            .map_err(|_| CompanionPairingPreparationFailure::RecipientAuthorizationMismatch)?;
        let public_key = DevicePublicKey::parse(&installation.encryption_public_key)
            .map_err(|_| CompanionPairingPreparationFailure::RecipientAuthorizationMismatch)?;
        let signing_public_key = DeviceSigningPublicKey::parse(&installation.signing_public_key)
            .map_err(|_| CompanionPairingPreparationFailure::RecipientAuthorizationMismatch)?;
        let envelopes = match EventGraphDeviceAccess::new(&graph)
            .active_envelopes(&EventGraphDeviceAccessRequest {
                expected_device_id: &device_id,
                expected_public_key: &public_key,
                expected_signing_public_key: &signing_public_key,
            })
            .map_err(|_| CompanionPairingPreparationFailure::RecipientAuthorizationMismatch)?
        {
            DeviceAuthorization::Granted(envelopes) => envelopes,
            DeviceAuthorization::NotGranted => {
                return Err(CompanionPairingPreparationFailure::RecipientAuthorizationMismatch);
            }
        };
        let mut meta = VaultMetaState::default();
        VaultMetaGraphProjection::new(&graph)
            .materialize(&mut meta)
            .map_err(|_| CompanionPairingPreparationFailure::GraphInvalid)?;
        if !meta.auth.contains_key(
            &public_key
                .auth_id()
                .map_err(|_| CompanionPairingPreparationFailure::RecipientAuthorizationMismatch)?,
        ) {
            return Err(CompanionPairingPreparationFailure::RecipientAuthorizationMismatch);
        }
        Ok(PreparedEventGraph {
            store_id,
            heads: graph.heads(),
            envelopes,
        })
    }

    fn prepare_with_event_log(
        self,
        records: NookExternalEventLogRecords,
    ) -> Result<NookPreparedCompanionPairingActivation, CompanionPairingPreparationFailure> {
        let prepared = self.prepare_event_graph(&records)?;
        Ok(NookPreparedCompanionPairingActivation {
            approval: self,
            store_id: prepared.store_id,
            records,
            heads: prepared.heads,
            envelopes: prepared.envelopes,
        })
    }
}

#[wasm_bindgen]
impl NookPrevalidatedCompanionPairingApproval {
    pub fn with_event_log(
        self,
        records: NookExternalEventLogRecords,
    ) -> Result<NookPreparedCompanionPairingActivation, JsError> {
        self.prepare_with_event_log(records)
            .map_err(|error| error.js_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manager::{
        NookCompanionPairingExtensionEndpoint, NookVaultManager, VaultNameState,
        event_log::ExternalEventLogRecord,
    };
    use nook_companion_core::{
        CompanionPairingApproval, CompanionPairingApprovalAttempt,
        CompanionPairingEpochMilliseconds, CompanionPairingInstallation,
        CompanionPairingProviderManifestDigest, CompanionPairingRequest, ExtensionConnectScope,
        ExtensionPairingVaultType,
    };
    use nook_core::{
        ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity, EpochMetadataState,
        EpochPasswordState, IsoTimestamp, MemberLabel, Sha256Hex, SigningIdentity, StoreId,
        VaultApplication, VaultKeys, VaultOperation,
    };

    pub(super) struct ActivationFixture {
        pub(super) capability: NookPrevalidatedCompanionPairingApproval,
        pub(super) records: NookExternalEventLogRecords,
        pub(super) manager: NookVaultManager,
        pub(super) identity: DeviceIdentity,
    }

    struct AccessRecordsRequest<'a> {
        manager: &'a NookVaultManager,
        identity: &'a DeviceIdentity,
    }

    struct EventRecordRequest<'a> {
        manager: &'a NookVaultManager,
        signer: &'a SigningIdentity,
        parents: Vec<EventId>,
        created_at: IsoTimestamp,
        operation: VaultOperation,
    }

    impl ActivationFixture {
        pub(super) fn epoch(value: &str) -> anyhow::Result<CompanionPairingEpochMilliseconds> {
            Ok(serde_json::from_str(value)?)
        }

        pub(super) fn new() -> anyhow::Result<Self> {
            let identity = DeviceIdentity::generate()?;
            let (extension_signing, signing_seed) = SigningIdentity::generate()?;
            let mut manager = NookVaultManager::new();
            manager.application = VaultApplication::Extension;
            manager.vault.store_id = "store_testtoken11".to_owned();
            manager.vault.vault_name = VaultNameState::Named("Personal".to_owned());
            manager.device.id = identity.device_id().as_str().to_owned();
            manager.device.identity_private_key = identity.secret_string().into_inner();
            manager.event_log.signing_seed = signing_seed.into_inner();
            let providers = AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId(manager.vault.store_id.clone()),
            };
            let request = CompanionPairingRequest {
                request_id: "request-activation-1".to_owned(),
                nonce: "nonce-activation-1".to_owned(),
                issued_at: Self::epoch("100")?,
                expires_at: Self::epoch("200")?,
                vault_type: ExtensionPairingVaultType::Simple,
                installation: CompanionPairingInstallation {
                    extension_runtime_id: "runtime-1".to_owned(),
                    app_id: identity.device_id().as_str().to_owned(),
                    encryption_public_key: identity.public_key().as_str().to_owned(),
                    signing_public_key: extension_signing.public_key().as_str().to_owned(),
                    installation_label: "Extension".to_owned(),
                },
                scopes: vec![ExtensionConnectScope::VaultAccess],
            };
            let approval = CompanionPairingApproval {
                request: request.clone(),
                vault_store_id: manager.vault.store_id.clone(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-09-08T00:00:00Z".to_owned(),
                provider_manifest_digest: CompanionPairingProviderManifestDigest::parse(
                    providers.companion_pairing_manifest_digest()?.as_str(),
                )?,
            };
            let endpoint = NookCompanionPairingExtensionEndpoint::new(request)
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let authority = endpoint
                .take_authority()
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let capability = authority
                .prevalidate(
                    &manager,
                    CompanionPairingApprovalAttempt {
                        approval,
                        observed_at: Self::epoch("150")?,
                    },
                    providers,
                )
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let records = Self::access_records(AccessRecordsRequest {
                manager: &manager,
                identity: &identity,
            })?;
            Ok(Self {
                capability,
                records,
                manager,
                identity,
            })
        }

        fn access_records(
            request: AccessRecordsRequest<'_>,
        ) -> anyhow::Result<NookExternalEventLogRecords> {
            let AccessRecordsRequest { manager, identity } = request;
            let (website_signing, _) = SigningIdentity::generate()?;
            let store_id = StoreId::parse(&manager.vault.store_id)?;
            let key_epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
            let vault_keys = VaultKeys::generate()?;
            let extension_signing =
                SigningIdentity::from_seed_hex_stored(&manager.event_log.signing_seed)?;
            let (event, _) = nook_core::AppendEventInput::build(nook_core::AppendEventInput {
                store_id: &store_id,
                actor_id: &website_signing.actor_id()?,
                signing_identity: &website_signing,
                parents: Vec::new(),
                key_epoch: &key_epoch,
                created_at: &IsoTimestamp::parse("2026-09-08T00:00:00Z")?,
                operations: vec![
                    VaultOperation::VaultImported {
                        source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                        secrets: Vec::new(),
                        password_entries: Vec::new(),
                    },
                    VaultOperation::JoinApproved {
                        device_id: identity.device_id().clone(),
                        encryption_public_key: identity.public_key(),
                        signing_public_key: extension_signing.public_key(),
                        label: MemberLabel::from_trusted("Extension".to_owned()),
                        secrets_key_ciphertext: identity
                            .public_key()
                            .seal_bytes(vault_keys.secrets_key.as_str().as_bytes())?,
                        members_key_ciphertext: identity
                            .public_key()
                            .seal_bytes(vault_keys.members_key.as_str().as_bytes())?,
                    },
                ],
            })?;
            Ok(NookExternalEventLogRecords(vec![ExternalEventLogRecord {
                event_id: event.id()?.as_str().to_owned(),
                event,
            }]))
        }

        fn append_sentinel_membership(&mut self) -> anyhow::Result<()> {
            let parent = EventId::parse(
                &self
                    .records
                    .0
                    .first()
                    .ok_or_else(|| anyhow::anyhow!("genesis record must be present"))?
                    .event_id,
            )?;
            let signing =
                SigningIdentity::from_seed_hex_stored(&self.manager.event_log.signing_seed)?;
            let participant = DeviceIdentity::generate()?;
            let (participant_signing, _) = SigningIdentity::generate()?;
            self.records.0.push(Self::event_record(EventRecordRequest {
                manager: &self.manager,
                signer: &signing,
                parents: vec![parent],
                created_at: IsoTimestamp::parse("2026-09-08T00:00:01Z")?,
                operation: VaultOperation::SentinelParticipantEnrolled {
                    device_id: participant.device_id().clone(),
                    encryption_public_key: participant.public_key(),
                    signing_public_key: participant_signing.public_key(),
                    label: MemberLabel::from_trusted("Sentinel".to_owned()),
                },
            })?);
            Ok(())
        }

        fn append_sentinel_checkpoint(&mut self) -> anyhow::Result<()> {
            let parent = EventId::parse(
                &self
                    .records
                    .0
                    .first()
                    .ok_or_else(|| anyhow::anyhow!("genesis record must be present"))?
                    .event_id,
            )?;
            let signing =
                SigningIdentity::from_seed_hex_stored(&self.manager.event_log.signing_seed)?;
            let trigger = Self::event_record(EventRecordRequest {
                manager: &self.manager,
                signer: &signing,
                parents: vec![parent],
                created_at: IsoTimestamp::parse("2026-09-08T00:00:07Z")?,
                operation: VaultOperation::DeviceRevoked {
                    device_id: DeviceIdentity::generate()?.device_id().clone(),
                },
            })?;
            let trigger_id = EventId::parse(&trigger.event_id)?;
            self.records.0.push(trigger);
            let first = DeviceIdentity::generate()?;
            let second = DeviceIdentity::generate()?;
            let shares = SentinelShareEnvelope::create_sentinel_share_records(
                CreateSentinelShareRecordsRequest {
                    keys: &VaultKeys::generate()?,
                    participants: &[first, second],
                    threshold: 2.into(),
                },
            )?;
            let store_id = StoreId::parse(&self.manager.vault.store_id)?;
            let (event, _) = nook_core::AppendEventInput::build(nook_core::AppendEventInput {
                store_id: &store_id,
                actor_id: &signing.actor_id()?,
                signing_identity: &signing,
                parents: vec![trigger_id.clone()],
                key_epoch: &trigger_id,
                created_at: &IsoTimestamp::parse("2026-09-08T00:00:08Z")?,
                operations: vec![VaultOperation::EpochCheckpoint {
                    secrets: Vec::new(),
                    members_checkpoint_hash: Sha256Hex::from_trusted("0".repeat(64)),
                    rotated_meta_records: EpochMetadataState::Replace(shares),
                    password_entries: EpochPasswordState::Replace(Vec::new()),
                }],
            })?;
            self.records.0.push(ExternalEventLogRecord {
                event_id: event.id()?.as_str().to_owned(),
                event,
            });
            Ok(())
        }

        fn event_record(request: EventRecordRequest<'_>) -> anyhow::Result<ExternalEventLogRecord> {
            let EventRecordRequest {
                manager,
                signer,
                parents,
                created_at,
                operation,
            } = request;
            let store_id = StoreId::parse(&manager.vault.store_id)?;
            let key_epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
            let (event, _) = nook_core::AppendEventInput::build(nook_core::AppendEventInput {
                store_id: &store_id,
                actor_id: &signer.actor_id()?,
                signing_identity: signer,
                parents,
                key_epoch: &key_epoch,
                created_at: &created_at,
                operations: vec![operation],
            })?;
            Ok(ExternalEventLogRecord {
                event_id: event.id()?.as_str().to_owned(),
                event,
            })
        }

        pub(super) fn prepare(
            self,
        ) -> Result<NookPreparedCompanionPairingActivation, CompanionPairingPreparationFailure>
        {
            self.capability.prepare_with_event_log(self.records)
        }
    }

    #[test]
    fn prepares_real_admission_and_authorized_event_graph() -> anyhow::Result<()> {
        let prepared = ActivationFixture::new()?.prepare();
        assert!(prepared.is_ok());
        assert_eq!(
            prepared
                .map_err(|error| anyhow::anyhow!("{error:?}"))?
                .heads
                .len(),
            1
        );
        Ok(())
    }

    #[test]
    fn rejects_event_grant_for_another_recipient() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        let other = DeviceIdentity::generate()?;
        fixture.records = ActivationFixture::access_records(AccessRecordsRequest {
            manager: &fixture.manager,
            identity: &other,
        })?;
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::RecipientAuthorizationMismatch)
        ));
        Ok(())
    }

    #[test]
    fn rejects_empty_event_graph() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture.records.0.clear();
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::GraphInvalid)
        ));
        Ok(())
    }

    #[test]
    fn rejects_duplicate_event() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        let duplicate = fixture
            .records
            .0
            .first()
            .ok_or_else(|| anyhow::anyhow!("event fixture must be present"))?
            .clone();
        fixture.records.0.push(duplicate);
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::DuplicateEvent)
        ));
        Ok(())
    }

    #[test]
    fn rejects_event_id_substitution() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture
            .records
            .0
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("event fixture must be present"))?
            .event_id = "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo".to_owned();
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::EventIdMismatch)
        ));
        Ok(())
    }

    #[test]
    fn rejects_invalid_event_identifier() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture
            .records
            .0
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("event fixture must be present"))?
            .event_id = "not-an-event-identifier".to_owned();
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::IdentifierInvalid)
        ));
        Ok(())
    }

    #[test]
    fn rejects_event_with_invalid_signature() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        let (other_signer, _) = SigningIdentity::generate()?;
        let parent = EventId::parse(
            &fixture
                .records
                .0
                .first()
                .ok_or_else(|| anyhow::anyhow!("event fixture must be present"))?
                .event_id,
        )?;
        let other_record = ActivationFixture::event_record(EventRecordRequest {
            manager: &fixture.manager,
            signer: &other_signer,
            parents: vec![parent],
            created_at: IsoTimestamp::parse("2026-09-08T00:00:02Z")?,
            operation: VaultOperation::VaultCleared,
        })?;
        fixture
            .records
            .0
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("event fixture must be present"))?
            .event
            .signature = other_record.event.signature;
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::RecordInvalid)
        ));
        Ok(())
    }

    #[test]
    fn rejects_event_graph_with_missing_parent() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        let signing =
            SigningIdentity::from_seed_hex_stored(&fixture.manager.event_log.signing_seed)?;
        fixture
            .records
            .0
            .push(ActivationFixture::event_record(EventRecordRequest {
                manager: &fixture.manager,
                signer: &signing,
                parents: vec![EventId::parse(
                    "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo",
                )?],
                created_at: IsoTimestamp::parse("2026-09-08T00:00:03Z")?,
                operation: VaultOperation::MemberRenamed {
                    device_id: fixture.identity.device_id().clone(),
                    label: MemberLabel::from_trusted("Pending".to_owned()),
                },
            })?);
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::GraphPending)
        ));
        Ok(())
    }

    #[test]
    fn rejects_quarantined_unauthorized_event() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        let (unauthorized, _) = SigningIdentity::generate()?;
        let parent = EventId::parse(
            &fixture
                .records
                .0
                .first()
                .ok_or_else(|| anyhow::anyhow!("event fixture must be present"))?
                .event_id,
        )?;
        fixture
            .records
            .0
            .push(ActivationFixture::event_record(EventRecordRequest {
                manager: &fixture.manager,
                signer: &unauthorized,
                parents: vec![parent],
                created_at: IsoTimestamp::parse("2026-09-08T00:00:04Z")?,
                operation: VaultOperation::MemberRenamed {
                    device_id: fixture.identity.device_id().clone(),
                    label: MemberLabel::from_trusted("Unauthorized".to_owned()),
                },
            })?);
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::GraphQuarantined)
        ));
        Ok(())
    }

    #[test]
    fn rejects_concurrent_projection_security_conflict() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        let signing =
            SigningIdentity::from_seed_hex_stored(&fixture.manager.event_log.signing_seed)?;
        let parent = EventId::parse(
            &fixture
                .records
                .0
                .first()
                .ok_or_else(|| anyhow::anyhow!("event fixture must be present"))?
                .event_id,
        )?;
        fixture
            .records
            .0
            .push(ActivationFixture::event_record(EventRecordRequest {
                manager: &fixture.manager,
                signer: &signing,
                parents: vec![parent.clone()],
                created_at: IsoTimestamp::parse("2026-09-08T00:00:05Z")?,
                operation: VaultOperation::DeviceRevoked {
                    device_id: DeviceId::parse("abcd1234ef567890")?,
                },
            })?);
        fixture
            .records
            .0
            .push(ActivationFixture::event_record(EventRecordRequest {
                manager: &fixture.manager,
                signer: &signing,
                parents: vec![parent],
                created_at: IsoTimestamp::parse("2026-09-08T00:00:06Z")?,
                operation: VaultOperation::VaultCleared,
            })?);
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::ProjectionConflict)
        ));
        Ok(())
    }

    #[test]
    fn rejects_event_for_another_vault() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture.manager.vault.store_id = "store_testtoken12".to_owned();
        fixture.records = ActivationFixture::access_records(AccessRecordsRequest {
            manager: &fixture.manager,
            identity: &fixture.identity,
        })?;
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::VaultMismatch)
        ));
        Ok(())
    }

    #[test]
    fn rejects_sentinel_operation_in_simple_history() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture.append_sentinel_membership()?;
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::UnsupportedVaultArchitecture)
        ));
        Ok(())
    }

    #[test]
    fn rejects_sentinel_checkpoint_in_simple_history() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture.append_sentinel_checkpoint()?;
        assert!(matches!(
            fixture.prepare(),
            Err(CompanionPairingPreparationFailure::UnsupportedVaultArchitecture)
        ));
        Ok(())
    }
}
