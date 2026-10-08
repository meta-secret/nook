//! Signed durable graph fixtures for extension projection admission.

use super::super::{ExtensionVaultOpenRequest, ExtensionVaultProjectionRequest, NookVaultManager};
use nook_core::{
    CanonicalEventBodyBytes, DeviceIdentity, EncryptedSecretPayload, EpochMetadataState,
    EpochPasswordState, EventGraph, EventGraphInsert, EventGraphRejection, EventId, IsoTimestamp,
    MemberLabel, SecretFingerprint, SecretId, SecretType, Sha256Hex, SigningIdentity, StoreId,
    VaultCrypto, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultKeys, VaultOperation,
};

pub(super) enum FixtureEnvelopeKey {
    Generated,
    Malformed,
}

pub(super) struct ExtensionProjectionFixture {
    pub(super) identity: DeviceIdentity,
    pub(super) grant: ExtensionVaultOpenRequest,
    graph: EventGraph,
    pub(super) signing: SigningIdentity,
    epoch: EventId,
}

struct ProjectionEventFixture {
    parents: Vec<EventId>,
    key_epoch: EventId,
    operations: Vec<VaultOperation>,
}

impl ExtensionProjectionFixture {
    pub(super) fn new(envelope_key: FixtureEnvelopeKey) -> anyhow::Result<Self> {
        let identity = DeviceIdentity::generate()?;
        let keys = VaultKeys::generate()?;
        let envelope_secrets_key = match envelope_key {
            FixtureEnvelopeKey::Generated => keys.secrets_key.as_str(),
            FixtureEnvelopeKey::Malformed => "invalid",
        };
        let (signing, _) = SigningIdentity::generate()?;
        let store_id = StoreId::generate()?;
        let epoch = EventId::from_body_bytes(&CanonicalEventBodyBytes::from(
            b"extension projection epoch".to_vec(),
        ));
        let mut fixture = Self {
            grant: ExtensionVaultOpenRequest {
                store_id,
                app_id: identity.app_id().clone(),
                encryption_public_key: identity.public_key(),
                signing_public_key: signing.public_key(),
            },
            identity,
            graph: EventGraph::new(),
            signing,
            epoch,
        };
        let ciphertext = VaultCrypto::new(&keys.secrets_key)?.encrypt_value("encrypted fixture")?;
        let secrets = (0..1_300)
            .map(|index| {
                EncryptedSecretPayload::from_armored(
                    &SecretId::from_vault_record(&format!("secret_projection{index:05}")),
                    SecretType::Login,
                    ciphertext.as_str(),
                    SecretFingerprint::from_trusted("fixture identity".to_owned()),
                    SecretFingerprint::from_trusted("fixture version".to_owned()),
                )
            })
            .collect();
        let root = fixture.event(ProjectionEventFixture {
            parents: Vec::new(),
            key_epoch: fixture.epoch.clone(),
            operations: vec![
                VaultOperation::VaultImported {
                    source_content_hash: Sha256Hex::from_bytes(b"fixture"),
                    secrets,
                    password_entries: Vec::new(),
                },
                VaultOperation::JoinApproved {
                    device_id: fixture.identity.app_id().clone(),
                    encryption_public_key: fixture.identity.public_key(),
                    signing_public_key: fixture.signing.public_key(),
                    label: MemberLabel::from_trusted("Extension".to_owned()),
                    secrets_key_ciphertext: fixture.identity.seal_utf8(envelope_secrets_key)?,
                    members_key_ciphertext: fixture
                        .identity
                        .seal_utf8(keys.members_key.as_str())?,
                },
            ],
        })?;
        fixture.graph = fixture
            .graph
            .insert(EventGraphInsert {
                event: root,
                expected_store_id: fixture.grant.store_id.as_str(),
            })
            .map_err(EventGraphRejection::into_cause)?
            .graph;
        Ok(fixture)
    }

    fn event(&self, request: ProjectionEventFixture) -> anyhow::Result<VaultEvent> {
        Ok(VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: self.grant.store_id.clone(),
                actor_id: self.signing.actor_id()?,
                actor_signing_public_key: self.signing.public_key(),
                parents: request.parents,
                created_at: IsoTimestamp::parse("2026-10-07T00:00:00Z")?,
                key_epoch: request.key_epoch,
                operations: request.operations,
            },
            self.signing.signing_key(),
        )?)
    }

    pub(super) fn manager(&self) -> NookVaultManager {
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = self.identity.secret_string().into_inner();
        manager
    }

    pub(super) fn request(&self) -> ExtensionVaultProjectionRequest<'_> {
        ExtensionVaultProjectionRequest {
            grant: &self.grant,
            identity: &self.identity,
            graph: &self.graph,
        }
    }

    #[must_use = "retain the revoked durable graph fixture"]
    pub(super) fn revoke(mut self) -> anyhow::Result<Self> {
        let trigger = self.event(ProjectionEventFixture {
            parents: self.graph.heads(),
            key_epoch: self.epoch.clone(),
            operations: vec![VaultOperation::DeviceRevoked {
                device_id: self.identity.app_id().clone(),
            }],
        })?;
        let trigger_id = trigger.id()?;
        let checkpoint = self.event(ProjectionEventFixture {
            parents: vec![trigger_id.clone()],
            key_epoch: trigger_id,
            operations: vec![VaultOperation::EpochCheckpoint {
                secrets: Vec::new(),
                members_checkpoint_hash: Sha256Hex::from_bytes(b"empty roster"),
                rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
                password_entries: EpochPasswordState::Replace(Vec::new()),
            }],
        })?;
        for event in [trigger, checkpoint] {
            self.graph = self
                .graph
                .insert(EventGraphInsert {
                    event,
                    expected_store_id: self.grant.store_id.as_str(),
                })
                .map_err(EventGraphRejection::into_cause)?
                .graph;
        }
        Ok(self)
    }
}
