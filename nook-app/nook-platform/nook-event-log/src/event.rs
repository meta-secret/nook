//! Vault event envelope, typed domain operations, and signing helpers.

use nook_auth2::RecordTypeDeclaration;
use std::{fmt, str};

use crate::canonical::{Ed25519Signature, EventId};
use crate::signing::SigningIdentity;
use crate::{CanonicalEventBodyBytes, EventError, EventResult, EventStorageBytes};
use crate::{PasswordEnvelope, PasswordUnlockEntry, SecretFingerprint, SentinelShareVersion};
use ed25519_dalek::{SigningKey, VerifyingKey};
use nook_auth2::{
    AgeArmoredCiphertext, AuthKeyId, DeviceId, DevicePublicKey, DeviceSigningPublicKey,
    IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId, SENTINEL_SHARE_RECORD_PREFIX,
    SecretId, SecretType, SentinelParticipantCount, SentinelShareIndex, SentinelThreshold,
    Sha256Hex, StoreId, StoredRecordPayload, StoredSecretRecord,
};
use serde::{Deserialize, Serialize, ser::Error as _};
use serde_json::Value;
#[cfg(test)]
use serde_json::json;

/// Supported `schema_version` values on the event wire.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, tsify::Tsify,
)]
#[serde(transparent)]
pub struct VaultEventSchemaVersion(u32);

impl VaultEventSchemaVersion {
    pub const V2: Self = Self(2);
    pub const V3: Self = Self(3);
    pub const CURRENT: Self = Self::V3;

    #[must_use]
    pub const fn is_supported(self) -> bool {
        self.0 >= Self::V2.0 && self.0 <= Self::CURRENT.0
    }
}

impl From<VaultEventSchemaVersion> for u32 {
    fn from(value: VaultEventSchemaVersion) -> Self {
        value.0
    }
}

impl fmt::Display for VaultEventSchemaVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Encrypted secret payload embedded in an event operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
pub struct EncryptedSecretPayload {
    pub id: SecretId,
    #[serde(rename = "type")]
    #[tsify(type = "SecretTypeWire")]
    pub secret_type: SecretType,
    pub ciphertext: OpaqueCiphertext,
    pub identity_fingerprint: SecretFingerprint,
    pub fingerprint: SecretFingerprint,
}

impl EncryptedSecretPayload {
    #[must_use]
    pub fn from_armored(
        id: &SecretId,
        secret_type: SecretType,
        ciphertext: &str,
        identity_fingerprint: SecretFingerprint,
        fingerprint: SecretFingerprint,
    ) -> Self {
        Self {
            id: id.clone(),
            secret_type,
            ciphertext: OpaqueCiphertext::from_trusted(ciphertext.to_owned()),
            identity_fingerprint,
            fingerprint,
        }
    }

    #[must_use]
    pub fn to_stored(&self) -> StoredSecretRecord {
        StoredSecretRecord {
            key: self.id.clone(),
            secret_type: RecordTypeDeclaration::Secret(self.secret_type),
            value: StoredRecordPayload::from_trusted(self.ciphertext.as_str().to_owned()),
        }
    }
}

/// One sentinel share encrypted to a participant device, recorded in the event log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
#[serde(rename_all = "snake_case")]
pub struct SentinelShareIssuedPayload {
    pub device_id: DeviceId,
    pub version: SentinelShareVersion,
    pub threshold: SentinelThreshold,
    pub required_participants: SentinelParticipantCount,
    pub share_index: SentinelShareIndex,
    pub ciphertext: AgeArmoredCiphertext,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(from = "Vec<PasswordUnlockEntry>")]
pub enum EpochPasswordState {
    #[default]
    LegacyRetain,
    Replace(Vec<PasswordUnlockEntry>),
}

/// Checkpoint metadata replacement. Omitted legacy fields retain the previous
/// metadata, while an explicit empty array clears every metadata record.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(from = "Vec<StoredSecretRecord>")]
pub enum EpochMetadataState {
    #[default]
    LegacyRetain,
    Replace(Vec<StoredSecretRecord>),
}

impl EpochMetadataState {
    fn is_legacy_retain(&self) -> bool {
        matches!(self, Self::LegacyRetain)
    }
}

impl From<Vec<StoredSecretRecord>> for EpochMetadataState {
    fn from(values: Vec<StoredSecretRecord>) -> Self {
        Self::Replace(values)
    }
}

impl EpochMetadataState {
    fn serialize_epoch_metadata_state<S>(
        state: &EpochMetadataState,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match state {
            EpochMetadataState::Replace(records) => records.serialize(serializer),
            EpochMetadataState::LegacyRetain => Err(S::Error::custom(
                "legacy checkpoint metadata state must be omitted",
            )),
        }
    }
}

impl EpochPasswordState {
    fn is_legacy_retain(&self) -> bool {
        matches!(self, Self::LegacyRetain)
    }
}

impl From<Vec<PasswordUnlockEntry>> for EpochPasswordState {
    fn from(values: Vec<PasswordUnlockEntry>) -> Self {
        Self::Replace(values)
    }
}

impl EpochPasswordState {
    fn serialize_epoch_password_state<S>(
        state: &EpochPasswordState,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match state {
            EpochPasswordState::Replace(entries) => entries.serialize(serializer),
            EpochPasswordState::LegacyRetain => Err(S::Error::custom(
                "legacy checkpoint password state must be omitted",
            )),
        }
    }
}

/// Atomic domain operations recorded in the immutable event log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum VaultOperation {
    VaultImported {
        source_content_hash: Sha256Hex,
        secrets: Vec<EncryptedSecretPayload>,
        password_entries: Vec<PasswordUnlockEntry>,
    },
    SecretCreated {
        secret: EncryptedSecretPayload,
    },
    SecretDeleted {
        secret_id: SecretId,
    },
    SecretReplaced {
        old_id: SecretId,
        new_secret: EncryptedSecretPayload,
    },
    SecretConflictResolved {
        old_id: SecretId,
        chosen_secret_id: SecretId,
        rejected_secret_ids: Vec<SecretId>,
    },
    JoinRequested {
        device_id: DeviceId,
        encryption_public_key: DevicePublicKey,
        signing_public_key: DeviceSigningPublicKey,
        label: MemberLabel,
    },
    JoinApproved {
        device_id: DeviceId,
        encryption_public_key: DevicePublicKey,
        signing_public_key: DeviceSigningPublicKey,
        label: MemberLabel,
        secrets_key_ciphertext: AgeArmoredCiphertext,
        members_key_ciphertext: AgeArmoredCiphertext,
    },
    /// Sentinel participant enrolled without a full per-device vault-key envelope.
    ///
    /// Used when `vault_type=sentinel`: the joiner is added to the roster, but
    /// vault keys remain threshold-shared rather than encrypted in full to
    /// each device.
    SentinelParticipantEnrolled {
        device_id: DeviceId,
        encryption_public_key: DevicePublicKey,
        signing_public_key: DeviceSigningPublicKey,
        label: MemberLabel,
    },
    /// Threshold shares of the vault key bundle, each encrypted to one device.
    SentinelSharesIssued {
        shares: Vec<SentinelShareIssuedPayload>,
    },
    JoinDenied {
        device_id: DeviceId,
    },
    MemberRenamed {
        device_id: DeviceId,
        label: MemberLabel,
    },
    DeviceRevoked {
        device_id: DeviceId,
    },
    PasswordAdded {
        entry_id: PasswordEntryId,
        label: String,
        created_at: IsoTimestamp,
        envelope: PasswordEnvelope,
    },
    PasswordRotated {
        entry_id: PasswordEntryId,
        envelope: PasswordEnvelope,
    },
    PasswordEnvelopeUpgraded {
        entry_id: PasswordEntryId,
        envelope: PasswordEnvelope,
    },
    PasswordRemoved {
        entry_id: PasswordEntryId,
    },
    VaultCleared,
    EpochCheckpoint {
        secrets: Vec<EncryptedSecretPayload>,
        members_checkpoint_hash: Sha256Hex,
        #[serde(
            default,
            skip_serializing_if = "EpochMetadataState::is_legacy_retain",
            serialize_with = "EpochMetadataState::serialize_epoch_metadata_state"
        )]
        // This custom serde field emits Replace records as an array and omits LegacyRetain.
        #[tsify(type = "StoredSecretRecord[]", optional)]
        rotated_meta_records: EpochMetadataState,
        #[serde(
            default,
            skip_serializing_if = "EpochPasswordState::is_legacy_retain",
            serialize_with = "EpochPasswordState::serialize_epoch_password_state"
        )]
        // The custom serializer likewise preserves the legacy omitted/explicit-array distinction.
        #[tsify(type = "PasswordUnlockEntry[]", optional)]
        password_entries: EpochPasswordState,
    },
}

impl VaultOperation {
    /// Whether immutable operation history proves Sentinel architecture.
    pub(crate) fn is_sentinel_architecture_evidence(&self) -> bool {
        match self {
            Self::SentinelParticipantEnrolled { .. } | Self::SentinelSharesIssued { .. } => true,
            Self::EpochCheckpoint {
                rotated_meta_records: EpochMetadataState::Replace(records),
                ..
            } => records.iter().any(|record| {
                record
                    .key
                    .as_str()
                    .starts_with(SENTINEL_SHARE_RECORD_PREFIX)
            }),
            _ => false,
        }
    }
}

/// Signed event body (everything except the signature field).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
#[serde(rename_all = "snake_case")]
pub struct VaultEventBody {
    pub schema_version: VaultEventSchemaVersion,
    pub store_id: StoreId,
    pub actor_id: AuthKeyId,
    pub actor_signing_public_key: DeviceSigningPublicKey,
    pub parents: Vec<EventId>,
    pub created_at: IsoTimestamp,
    pub key_epoch: EventId,
    pub operations: Vec<VaultOperation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenesisImportContents {
    Other,
    Empty,
    Populated,
}
pub enum EpochCheckpointRequirement<'a> {
    NotRequired,
    SecurityRotationParent(&'a EventId),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityRotationTrigger {
    Other,
    PasswordRotated,
    PasswordRemoved,
    DeviceRevoked,
}
impl VaultEventBody {
    #[must_use]
    pub fn genesis_import_contents(&self) -> GenesisImportContents {
        match self.operations.as_slice() {
            [
                VaultOperation::VaultImported {
                    secrets,
                    password_entries,
                    ..
                },
            ] => {
                if secrets.is_empty() && password_entries.is_empty() {
                    GenesisImportContents::Empty
                } else {
                    GenesisImportContents::Populated
                }
            }
            _ => GenesisImportContents::Other,
        }
    }
    #[must_use]
    pub fn security_rotation_trigger(&self) -> SecurityRotationTrigger {
        match self.operations.as_slice() {
            [VaultOperation::PasswordRotated { .. }] => SecurityRotationTrigger::PasswordRotated,
            [VaultOperation::PasswordRemoved { .. }] => SecurityRotationTrigger::PasswordRemoved,
            [VaultOperation::DeviceRevoked { .. }] => SecurityRotationTrigger::DeviceRevoked,
            _ => SecurityRotationTrigger::Other,
        }
    }
    pub fn epoch_checkpoint_requirement(&self) -> EventResult<EpochCheckpointRequirement<'_>> {
        let checkpoints = self
            .operations
            .iter()
            .filter(|op| matches!(op, VaultOperation::EpochCheckpoint { .. }))
            .count();
        if checkpoints == 0 || self.schema_version < VaultEventSchemaVersion::V3 {
            return Ok(EpochCheckpointRequirement::NotRequired);
        }
        if checkpoints != 1 || self.operations.len() != 1 {
            return Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint must be the event's sole operation",
            });
        }
        let [parent] = self.parents.as_slice() else {
            return Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint must have exactly one direct parent",
            });
        };
        if self.key_epoch != *parent {
            return Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint key epoch must equal its direct parent id",
            });
        }
        Ok(EpochCheckpointRequirement::SecurityRotationParent(parent))
    }
}

impl VaultEventBody {
    pub fn to_canonical_value(&self) -> EventResult<Value> {
        let mut body = self.clone();
        body.parents
            .sort_by(|left, right| left.as_str().cmp(right.as_str()));
        // The generic canonical JSON writer is the signing wire boundary.
        let value = serde_json::to_value(&body).map_err(EventError::EventBodySerialize)?;
        Ok(CanonicalEventBodyBytes::canonical_value(&value))
    }

    pub fn to_canonical_bytes(&self) -> EventResult<CanonicalEventBodyBytes> {
        CanonicalEventBodyBytes::from_json(&self.to_canonical_value()?)
    }

    pub fn event_id(&self) -> EventResult<EventId> {
        Ok(EventId::from_body_bytes(&self.to_canonical_bytes()?))
    }
}

/// Full signed vault event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
#[serde(rename_all = "snake_case")]
pub struct VaultEvent {
    #[serde(flatten)]
    pub body: VaultEventBody,
    pub signature: Ed25519Signature,
}

/// Named values required by `VaultEvent::build_genesis_import_event`.
pub struct GenesisImportRequest<'a> {
    pub store_id: &'a StoreId,
    pub actor_id: &'a AuthKeyId,
    pub key_epoch: &'a EventId,
    pub payload: GenesisImportPayload,
    pub created_at: &'a IsoTimestamp,
    pub signing_key: &'a SigningKey,
}

impl VaultEvent {
    pub fn id(&self) -> EventResult<EventId> {
        self.body.event_id()
    }

    pub fn sign(body: VaultEventBody, signing_key: &SigningKey) -> EventResult<Self> {
        let body_bytes = body.to_canonical_bytes()?;
        let signature = Ed25519Signature::sign(&body_bytes, signing_key);
        Ok(Self { body, signature })
    }

    pub fn verify_signature(&self, verifying_key: &VerifyingKey) -> EventResult<()> {
        let body_bytes = self.body.to_canonical_bytes()?;
        self.signature.verify(&body_bytes, verifying_key)
    }

    pub fn validate_actor_signature(&self) -> EventResult<()> {
        let public_key = &self.body.actor_signing_public_key;
        if public_key.is_empty() {
            return Err(EventError::MissingActorSigningPublicKey);
        }
        let verifying_key =
            SigningIdentity::verifying_key_from_public_key_hex(public_key.as_str())?;
        let signing_key_actor_id = SigningIdentity::actor_id_for_verifying_key(&verifying_key)?;
        if signing_key_actor_id != self.body.actor_id {
            return Err(EventError::ActorSigningKeyMismatch {
                actor_id: self.body.actor_id.as_str().to_owned(),
                signing_key_actor_id: signing_key_actor_id.as_str().to_owned(),
            });
        }
        self.verify_signature(&verifying_key)
    }

    pub fn validate_envelope(&self, expected_store_id: &StoreId) -> EventResult<EventId> {
        if !self.body.schema_version.is_supported() {
            return Err(EventError::UnsupportedSchemaVersion {
                version: self.body.schema_version,
            });
        }
        if &self.body.store_id != expected_store_id {
            return Err(EventError::EventStoreIdMismatch {
                expected: expected_store_id.as_str().to_owned(),
                actual: self.body.store_id.as_str().to_owned(),
            });
        }
        if self.body.schema_version >= VaultEventSchemaVersion::V3 {
            for operation in &self.body.operations {
                if let VaultOperation::EpochCheckpoint {
                    rotated_meta_records,
                    password_entries,
                    ..
                } = operation
                {
                    if matches!(rotated_meta_records, EpochMetadataState::LegacyRetain) {
                        return Err(EventError::MissingEpochCheckpointReplacement {
                            field: "rotated_meta_records",
                        });
                    }
                    if matches!(password_entries, EpochPasswordState::LegacyRetain) {
                        return Err(EventError::MissingEpochCheckpointReplacement {
                            field: "password_entries",
                        });
                    }
                }
            }
        }
        if self.body.parents.is_empty()
            && !self
                .body
                .operations
                .iter()
                .any(|operation| matches!(operation, VaultOperation::VaultImported { .. }))
        {
            return Err(EventError::MissingEventParents);
        }
        for parent in &self.body.parents {
            EventId::parse(parent.as_str())?;
        }
        EventId::parse(self.body.key_epoch.as_str())?;
        self.validate_actor_signature()?;
        self.id()
    }
}

/// Serialize an event for provider/local storage.
///
/// Event ids and signatures still use canonical compact JSON body bytes. The
/// persisted event envelope is pretty YAML so humans can inspect provider files.
impl VaultEvent {
    pub fn serialize_event_storage_yaml(event: &VaultEvent) -> EventResult<EventStorageBytes> {
        let mut yaml =
            serde_yaml::to_string(event).map_err(|e| EventError::EventSerialize(e.to_string()))?;
        if !yaml.ends_with('\n') {
            yaml.push('\n');
        }
        Ok(yaml.into_bytes().into())
    }
}

/// Parse a stored event from YAML bytes.
impl VaultEvent {
    pub fn parse_event_storage_bytes(bytes: &EventStorageBytes) -> EventResult<VaultEvent> {
        let text = str::from_utf8(bytes.as_ref()).map_err(|e| {
            EventError::ParseStoredEvent(format!("event storage bytes are not UTF-8: {e}"))
        })?;
        serde_yaml::from_str(text)
            .map_err(|e| EventError::ParseStoredEvent(format!("YAML parse failed: {e}")))
    }
}

/// Parse a remote event and classify errors for provider sync.
impl VaultEvent {
    pub fn parse_remote_event_storage_bytes(bytes: &EventStorageBytes) -> EventResult<VaultEvent> {
        VaultEvent::parse_event_storage_bytes(bytes).map_err(|error| match error {
            EventError::ParseStoredEvent(message) => EventError::ParseRemoteEvent(message),
            other => other,
        })
    }
}

/// Build a genesis import event from encrypted snapshot data.
pub struct GenesisImportPayload {
    pub source_content_hash: Sha256Hex,
    pub secrets: Vec<EncryptedSecretPayload>,
    pub password_entries: Vec<PasswordUnlockEntry>,
}

impl VaultEvent {
    pub fn build_genesis_import_event(
        request: GenesisImportRequest<'_>,
    ) -> EventResult<VaultEvent> {
        let GenesisImportRequest {
            store_id,
            actor_id,
            key_epoch,
            payload,
            created_at,
            signing_key,
        } = request;
        let signing_actor_id =
            SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?;
        if signing_actor_id != *actor_id {
            return Err(EventError::ActorSigningKeyMismatch {
                actor_id: actor_id.as_str().to_owned(),
                signing_key_actor_id: signing_actor_id.as_str().to_owned(),
            });
        }
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: store_id.clone(),
            actor_id: actor_id.clone(),
            actor_signing_public_key: DeviceSigningPublicKey::from_trusted(hex::encode(
                signing_key.verifying_key().as_bytes(),
            )),
            parents: Vec::new(),
            created_at: created_at.clone(),
            key_epoch: key_epoch.clone(),
            operations: vec![VaultOperation::VaultImported {
                source_content_hash: payload.source_content_hash,
                secrets: payload.secrets,
                password_entries: payload.password_entries,
            }],
        };
        VaultEvent::sign(body, signing_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{actor, epoch, public_key, signing_key as test_signing_key, store};
    use anyhow::Context;
    use ed25519_dalek::SigningKey;

    fn empty_genesis_event(signing_key: &SigningKey) -> EventResult<VaultEvent> {
        VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &store()?,
            actor_id: &actor(signing_key)?,
            key_epoch: &epoch()?,
            payload: GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            },
            created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            signing_key,
        })
    }

    #[test]
    fn genesis_event_has_no_parents() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let event = empty_genesis_event(&signing_key)?;
        event.verify_signature(&signing_key.verifying_key())?;
        assert!(event.body.parents.is_empty());
        Ok(())
    }

    #[test]
    fn checkpoint_distinguishes_explicit_empty_metadata_from_legacy_omission() -> anyhow::Result<()>
    {
        let operation: VaultOperation = serde_json::from_value(json!({
            "type": "epoch-checkpoint",
            "secrets": [],
            "members_checkpoint_hash": "00".repeat(32),
            "rotated_meta_records": []
        }))?;
        assert!(matches!(
            operation,
            VaultOperation::EpochCheckpoint {
                rotated_meta_records: EpochMetadataState::Replace(records),
                password_entries: EpochPasswordState::LegacyRetain,
                ..
            } if records.is_empty()
        ));
        let legacy: VaultOperation = serde_json::from_value(json!({
            "type": "epoch-checkpoint",
            "secrets": [],
            "members_checkpoint_hash": "00".repeat(32)
        }))?;
        assert!(matches!(
            legacy,
            VaultOperation::EpochCheckpoint {
                rotated_meta_records: EpochMetadataState::LegacyRetain,
                password_entries: EpochPasswordState::LegacyRetain,
                ..
            }
        ));
        Ok(())
    }

    #[test]
    fn reserved_sentinel_checkpoint_key_is_architecture_evidence() {
        let malformed_share = StoredSecretRecord {
            key: SecretId::from_vault_record("sentinel_share:not-a-device"),
            secret_type: RecordTypeDeclaration::Undeclared,
            value: StoredRecordPayload::from_trusted("malformed".to_owned()),
        };
        let operation = VaultOperation::EpochCheckpoint {
            secrets: Vec::new(),
            members_checkpoint_hash: Sha256Hex::from_trusted("0".repeat(64)),
            rotated_meta_records: EpochMetadataState::Replace(vec![malformed_share]),
            password_entries: EpochPasswordState::Replace(Vec::new()),
        };

        assert!(operation.is_sentinel_architecture_evidence());
    }

    #[test]
    fn current_checkpoint_requires_explicit_replacement_fields() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let mut body = empty_genesis_event(&signing_key)?.body;
        body.operations.push(VaultOperation::EpochCheckpoint {
            secrets: Vec::new(),
            members_checkpoint_hash: Sha256Hex::from_trusted("0".repeat(64)),
            rotated_meta_records: EpochMetadataState::LegacyRetain,
            password_entries: EpochPasswordState::LegacyRetain,
        });
        let current = VaultEvent::sign(body.clone(), &signing_key)?;
        assert!(matches!(
            current.validate_envelope(&StoreId::parse("store_testtoken11")?),
            Err(EventError::MissingEpochCheckpointReplacement {
                field: "rotated_meta_records"
            })
        ));

        body.schema_version = VaultEventSchemaVersion::V2;
        VaultEvent::sign(body, &signing_key)?
            .validate_envelope(&StoreId::parse("store_testtoken11")?)?;
        Ok(())
    }

    #[test]
    fn event_body_classifies_import_rotation_and_checkpoint_states() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let mut body = empty_genesis_event(&signing_key)?.body;
        assert_eq!(body.genesis_import_contents(), GenesisImportContents::Empty);
        assert_eq!(
            body.security_rotation_trigger(),
            SecurityRotationTrigger::Other
        );
        assert!(matches!(
            body.epoch_checkpoint_requirement()?,
            EpochCheckpointRequirement::NotRequired
        ));

        let Some(VaultOperation::VaultImported { secrets, .. }) = body.operations.first_mut()
        else {
            return Err(anyhow::anyhow!("fixture must contain a genesis import"));
        };
        secrets.push(EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_abc12345678"),
            secret_type: SecretType::Login,
            ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
            identity_fingerprint: SecretFingerprint::from_trusted("identity".to_owned()),
            fingerprint: SecretFingerprint::from_trusted("version".to_owned()),
        });
        assert_eq!(
            body.genesis_import_contents(),
            GenesisImportContents::Populated
        );

        let parent = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        body.parents = vec![parent.clone()];
        body.key_epoch = parent.clone();
        body.operations = vec![VaultOperation::PasswordRemoved {
            entry_id: PasswordEntryId::from_trusted("pwdentry001".to_owned()),
        }];
        assert_eq!(body.genesis_import_contents(), GenesisImportContents::Other);
        assert_eq!(
            body.security_rotation_trigger(),
            SecurityRotationTrigger::PasswordRemoved
        );

        body.operations = vec![VaultOperation::DeviceRevoked {
            device_id: DeviceId::parse("0123456789abcdef")?,
        }];
        assert_eq!(
            body.security_rotation_trigger(),
            SecurityRotationTrigger::DeviceRevoked
        );

        body.operations = vec![VaultOperation::EpochCheckpoint {
            secrets: Vec::new(),
            members_checkpoint_hash: Sha256Hex::from_trusted("0".repeat(64)),
            rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
            password_entries: EpochPasswordState::Replace(Vec::new()),
        }];
        assert!(matches!(
            body.epoch_checkpoint_requirement()?,
            EpochCheckpointRequirement::SecurityRotationParent(id) if id == &parent
        ));

        body.parents.clear();
        assert!(matches!(
            body.epoch_checkpoint_requirement(),
            Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint must have exactly one direct parent"
            })
        ));
        body.parents.push(parent);
        body.operations.push(VaultOperation::VaultCleared);
        assert!(matches!(
            body.epoch_checkpoint_requirement(),
            Err(EventError::InvalidEpochCheckpointStructure {
                reason: "checkpoint must be the event's sole operation"
            })
        ));
        Ok(())
    }

    #[test]
    fn schema_one_event_is_rejected() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let mut event = empty_genesis_event(&signing_key)?;
        event.body.schema_version = VaultEventSchemaVersion::V2;
        let event = VaultEvent::sign(event.body, &signing_key)?;
        event.validate_envelope(&StoreId::parse("store_testtoken11")?)?;
        let mut event = event;
        event.body.schema_version = VaultEventSchemaVersion(1);

        let err = event
            .validate_envelope(&StoreId::parse("store_testtoken11")?)
            .err()
            .ok_or_else(|| anyhow::anyhow!("event test should reject invalid input"))?;
        assert!(matches!(
            err,
            EventError::UnsupportedSchemaVersion { version }
                if version == VaultEventSchemaVersion(1)
        ));
        Ok(())
    }

    #[test]
    fn event_id_changes_when_parents_change() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let epoch = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        let mut body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse("store_testtoken11")?,
            actor_id: actor(&signing_key)?,
            actor_signing_public_key: public_key(&signing_key),
            parents: vec![epoch.clone()],
            created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            key_epoch: epoch.clone(),
            operations: vec![VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload {
                    id: SecretId::from_vault_record("secret_abc12345678"),
                    secret_type: SecretType::Login,
                    ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
                    identity_fingerprint: SecretFingerprint::from_trusted(
                        "test-identity".to_owned(),
                    ),
                    fingerprint: SecretFingerprint::from_trusted("test-version".to_owned()),
                },
            }],
        };
        let id_a = body.event_id()?;
        body.parents.push(EventId::parse(
            "sha256u:7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u4",
        )?);
        body.parents.sort();
        let id_b = body.event_id()?;
        assert_ne!(id_a, id_b);
        Ok(())
    }

    #[test]
    fn validate_envelope_rejects_wrong_store() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let event = empty_genesis_event(&signing_key)?;
        let wrong_store = StoreId::parse("store_otherid0001")?;
        assert!(event.validate_envelope(&wrong_store).is_err());
        Ok(())
    }

    #[test]
    fn event_storage_is_pretty_yaml_and_roundtrips() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &StoreId::parse("store_testtoken11")?,
            actor_id: &actor(&signing_key)?,
            key_epoch: &epoch,
            payload: GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![EncryptedSecretPayload {
                    id: SecretId::from_vault_record("secret_abc12345678"),
                    secret_type: SecretType::Login,
                    ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
                    identity_fingerprint: SecretFingerprint::from_trusted(format!(
                        "hmac-sha256:v1:{}",
                        "cd".repeat(32)
                    )),
                    fingerprint: SecretFingerprint::from_trusted(format!(
                        "hmac-sha256:v1:{}",
                        "ab".repeat(32)
                    )),
                }],
                password_entries: vec![],
            },
            created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            signing_key: &signing_key,
        })?;

        let yaml = String::from_utf8(VaultEvent::serialize_event_storage_yaml(&event)?.into())?;
        assert!(yaml.starts_with("schema_version: 3\n"));
        assert!(yaml.contains("operations:\n- type: vault-imported\n"));
        assert!(yaml.contains("\n  secrets:\n  - id: secret_abc12345678\n"));
        assert!(yaml.contains("fingerprint: hmac-sha256:v1:"));
        assert!(yaml.contains("\nsignature: ed25519:"));
        assert!(yaml.ends_with('\n'));
        assert!(!yaml.trim_start().starts_with('{'));
        assert_eq!(
            VaultEvent::parse_event_storage_bytes(&yaml.as_bytes().to_vec().into())?.id()?,
            event.id()?
        );
        assert!(matches!(
            VaultEvent::parse_event_storage_bytes(&vec![0xff].into()),
            Err(EventError::ParseStoredEvent(_))
        ));
        assert!(matches!(
            VaultEvent::parse_remote_event_storage_bytes(&b"not event yaml".to_vec().into()),
            Err(EventError::ParseRemoteEvent(_))
        ));
        Ok(())
    }

    #[test]
    fn encrypted_secret_payload_requires_non_empty_fingerprints() -> anyhow::Result<()> {
        let valid = serde_json::json!({
            "id": "secret_abc12345678",
            "type": "login",
            "ciphertext": "cipher",
            "identity_fingerprint": "hmac-sha256:v1:identity",
            "fingerprint": "hmac-sha256:v2:version"
        });
        assert!(serde_json::from_value::<EncryptedSecretPayload>(valid.clone()).is_ok());

        let mut missing = valid.clone();
        missing
            .as_object_mut()
            .context("encrypted secret fixture must be an object")?
            .remove("identity_fingerprint");
        assert!(serde_json::from_value::<EncryptedSecretPayload>(missing).is_err());

        let mut empty = valid;
        empty
            .as_object_mut()
            .context("encrypted secret fixture must be an object")?
            .insert("fingerprint".to_owned(), serde_json::json!(""));
        assert!(serde_json::from_value::<EncryptedSecretPayload>(empty).is_err());
        Ok(())
    }

    #[test]
    fn current_event_requires_actor_signing_key_field_and_value() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let valid = empty_genesis_event(&signing_key)?;
        let mut missing = serde_json::to_value(&valid)?;
        missing
            .as_object_mut()
            .context("event fixture must be an object")?
            .remove("actor_signing_public_key");
        assert!(serde_json::from_value::<VaultEvent>(missing).is_err());

        let mut unavailable_body = valid.body;
        unavailable_body.actor_signing_public_key = DeviceSigningPublicKey::Unavailable;
        let unavailable = VaultEvent::sign(unavailable_body, &signing_key)?;
        assert!(matches!(
            unavailable
                .validate_envelope(&StoreId::parse("store_testtoken11")?)
                .err()
                .ok_or_else(|| anyhow::anyhow!("event test should reject invalid input"))?,
            EventError::MissingActorSigningPublicKey
        ));
        Ok(())
    }

    #[test]
    fn password_envelope_event_storage_is_yaml_map() -> anyhow::Result<()> {
        let signing_key = test_signing_key();
        let epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse("store_testtoken11")?,
            actor_id: actor(&signing_key)?,
            actor_signing_public_key: public_key(&signing_key),
            parents: vec![epoch.clone()],
            created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            key_epoch: epoch,
            operations: vec![VaultOperation::PasswordAdded {
                entry_id: PasswordEntryId::from_trusted("pwdentry001".to_owned()),
                label: "Recovery".to_owned(),
                created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:01Z".to_owned()),
                envelope: PasswordEnvelope {
                    version: crate::PasswordEnvelopeVersion::LEGACY,
                    kdf: "scrypt".to_owned(),
                    work_factor: 18.into(),
                    recipient: String::new(),
                    wrapped_keys: String::new(),
                    ciphertext: "age-ciphertext".to_owned(),
                },
            }],
        };
        let event = VaultEvent::sign(body, &signing_key)?;

        let yaml = String::from_utf8(VaultEvent::serialize_event_storage_yaml(&event)?.into())?;
        assert!(yaml.contains("  envelope:\n"));
        assert!(yaml.contains("    version: 1\n"));
        assert!(yaml.contains("    kdf: scrypt\n"));
        assert!(yaml.contains("    work_factor: 18\n"));
        assert!(yaml.contains("    ciphertext: age-ciphertext\n"));
        assert!(!yaml.contains("envelope_"));
        assert!(!yaml.contains('{'));
        assert_eq!(
            VaultEvent::parse_event_storage_bytes(&yaml.as_bytes().to_vec().into())?,
            event
        );
        Ok(())
    }
}
