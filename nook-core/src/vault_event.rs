//! Vault event envelope, typed domain operations, and signing helpers.

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::{
    Ed25519Signature, EventId, canonical_json_bytes, canonicalize_json, event_id_from_body_bytes,
    sign_body, verify_body_signature,
};
use crate::secret_types::{SecretType, StoredRecordPayload, StoredSecretRecord};
use crate::vault_ids::{AuthKeyId, DeviceId, SecretId, StoreId};
use crate::vault_signing::SigningIdentity;
use crate::vault_wire::{
    AgeArmoredCiphertext, DevicePublicKey, DeviceSigningPublicKey, IsoTimestamp, MemberLabel,
    OpaqueCiphertext, PasswordEntryId, Sha256Hex,
};
use ed25519_dalek::{SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Supported `schema_version` values on the event wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VaultEventSchemaVersion(u32);

impl VaultEventSchemaVersion {
    pub const V1: Self = Self(1);
    pub const V2: Self = Self(2);
    pub const CURRENT: Self = Self::V2;

    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }

    #[must_use]
    pub const fn requires_actor_signature(self) -> bool {
        self.0 >= Self::V2.0
    }
}

/// Encrypted secret payload embedded in an event operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EncryptedSecretPayload {
    pub id: SecretId,
    #[serde(rename = "type")]
    pub secret_type: SecretType,
    pub ciphertext: OpaqueCiphertext,
}

impl EncryptedSecretPayload {
    #[must_use]
    pub fn from_stored(record: &StoredSecretRecord) -> Self {
        Self {
            id: record.key.clone(),
            secret_type: record.secret_type.unwrap_or(SecretType::ApiKey),
            ciphertext: OpaqueCiphertext::from_trusted(record.value.as_str().to_owned()),
        }
    }

    #[must_use]
    pub fn to_stored(&self) -> StoredSecretRecord {
        StoredSecretRecord {
            key: self.id.clone(),
            secret_type: Some(self.secret_type),
            value: StoredRecordPayload::from_trusted(self.ciphertext.as_str().to_owned()),
        }
    }
}

/// Atomic domain operations recorded in the immutable event log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum VaultOperation {
    VaultImported {
        source_content_hash: Sha256Hex,
        secrets: Vec<EncryptedSecretPayload>,
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
        envelope_ciphertext: OpaqueCiphertext,
    },
    PasswordRotated {
        entry_id: PasswordEntryId,
        envelope_ciphertext: OpaqueCiphertext,
    },
    PasswordRemoved {
        entry_id: PasswordEntryId,
    },
    VaultCleared,
    EpochCheckpoint {
        secrets: Vec<EncryptedSecretPayload>,
        members_checkpoint_hash: Sha256Hex,
    },
}

/// Signed event body (everything except the signature field).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct VaultEventBody {
    pub schema_version: VaultEventSchemaVersion,
    pub store_id: StoreId,
    pub actor_id: AuthKeyId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_signing_public_key: Option<DeviceSigningPublicKey>,
    pub parents: Vec<EventId>,
    pub created_at: IsoTimestamp,
    pub key_epoch: EventId,
    pub operations: Vec<VaultOperation>,
}

impl VaultEventBody {
    pub fn to_canonical_value(&self) -> VaultResult<Value> {
        let mut value = serde_json::to_value(self).map_err(EventError::EventBodySerialize)?;
        if let Value::Object(ref mut map) = value {
            let mut sorted_parents: Vec<String> = self
                .parents
                .iter()
                .map(|id| id.as_str().to_owned())
                .collect();
            sorted_parents.sort();
            map.insert("parents".to_owned(), json!(sorted_parents));
        }
        Ok(canonicalize_json(&value))
    }

    pub fn to_canonical_bytes(&self) -> VaultResult<Vec<u8>> {
        canonical_json_bytes(&self.to_canonical_value()?)
    }

    pub fn event_id(&self) -> VaultResult<EventId> {
        Ok(event_id_from_body_bytes(&self.to_canonical_bytes()?))
    }
}

/// Full signed vault event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct VaultEvent {
    #[serde(flatten)]
    pub body: VaultEventBody,
    pub signature: Ed25519Signature,
}

impl VaultEvent {
    pub fn id(&self) -> VaultResult<EventId> {
        self.body.event_id()
    }

    pub fn sign(body: VaultEventBody, signing_key: &SigningKey) -> VaultResult<Self> {
        let body_bytes = body.to_canonical_bytes()?;
        let signature = sign_body(&body_bytes, signing_key);
        Ok(Self { body, signature })
    }

    pub fn verify_signature(&self, verifying_key: &VerifyingKey) -> VaultResult<()> {
        let body_bytes = self.body.to_canonical_bytes()?;
        verify_body_signature(&body_bytes, self.signature.as_str(), verifying_key)
    }

    pub fn validate_actor_signature(&self) -> VaultResult<()> {
        if !self.body.schema_version.requires_actor_signature() {
            return Ok(());
        }
        let public_key = self
            .body
            .actor_signing_public_key
            .as_ref()
            .filter(|key| !key.is_empty())
            .ok_or(EventError::MissingActorSigningPublicKey)?;
        let verifying_key =
            SigningIdentity::verifying_key_from_public_key_hex(public_key.as_str())?;
        let signing_key_actor_id = SigningIdentity::actor_id_for_verifying_key(&verifying_key)?;
        if signing_key_actor_id != self.body.actor_id {
            return Err(EventError::ActorSigningKeyMismatch {
                actor_id: self.body.actor_id.as_str().to_owned(),
                signing_key_actor_id: signing_key_actor_id.as_str().to_owned(),
            }
            .into());
        }
        self.verify_signature(&verifying_key)
    }

    pub fn validate_envelope(&self, expected_store_id: &StoreId) -> VaultResult<EventId> {
        if self.body.schema_version > VaultEventSchemaVersion::CURRENT {
            return Err(EventError::UnsupportedSchemaVersion {
                version: self.body.schema_version.get(),
            }
            .into());
        }
        if &self.body.store_id != expected_store_id {
            return Err(EventError::EventStoreIdMismatch {
                expected: expected_store_id.as_str().to_owned(),
                actual: self.body.store_id.as_str().to_owned(),
            }
            .into());
        }
        if self.body.parents.is_empty()
            && !self
                .body
                .operations
                .iter()
                .any(|operation| matches!(operation, VaultOperation::VaultImported { .. }))
        {
            return Err(EventError::MissingEventParents.into());
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
pub fn serialize_event_storage_yaml(event: &VaultEvent) -> VaultResult<Vec<u8>> {
    let mut yaml =
        serde_yaml::to_string(event).map_err(|e| EventError::EventSerialize(e.to_string()))?;
    if !yaml.ends_with('\n') {
        yaml.push('\n');
    }
    Ok(yaml.into_bytes())
}

/// Parse a stored event from the current YAML format or legacy JSON bytes.
pub fn parse_event_storage_bytes(bytes: &[u8]) -> VaultResult<VaultEvent> {
    let text = std::str::from_utf8(bytes).map_err(|e| {
        EventError::ParseStoredEvent(format!("event storage bytes are not UTF-8: {e}"))
    })?;
    serde_yaml::from_str(text)
        .or_else(|yaml_error| {
            serde_json::from_slice(bytes).map_err(|json_error| {
                EventError::ParseStoredEvent(format!(
                    "YAML parse failed: {yaml_error}; JSON fallback failed: {json_error}"
                ))
            })
        })
        .map_err(Into::into)
}

/// Parse a remote event and classify errors for provider sync.
pub fn parse_remote_event_storage_bytes(bytes: &[u8]) -> VaultResult<VaultEvent> {
    parse_event_storage_bytes(bytes).map_err(|error| match error {
        crate::errors::VaultError::Event(EventError::ParseStoredEvent(message)) => {
            EventError::ParseRemoteEvent(message).into()
        }
        other => other,
    })
}

/// Build a genesis import event from encrypted snapshot data.
pub fn build_genesis_import_event(
    store_id: &StoreId,
    actor_id: &AuthKeyId,
    key_epoch: &EventId,
    source_content_hash: &Sha256Hex,
    secrets: Vec<EncryptedSecretPayload>,
    created_at: &IsoTimestamp,
    signing_key: &SigningKey,
) -> VaultResult<VaultEvent> {
    let signing_actor_id =
        SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?;
    if signing_actor_id != *actor_id {
        return Err(EventError::ActorSigningKeyMismatch {
            actor_id: actor_id.as_str().to_owned(),
            signing_key_actor_id: signing_actor_id.as_str().to_owned(),
        }
        .into());
    }
    let body = VaultEventBody {
        schema_version: VaultEventSchemaVersion::CURRENT,
        store_id: store_id.clone(),
        actor_id: actor_id.clone(),
        actor_signing_public_key: Some(DeviceSigningPublicKey::from_trusted(hex::encode(
            signing_key.verifying_key().as_bytes(),
        ))),
        parents: Vec::new(),
        created_at: created_at.clone(),
        key_epoch: key_epoch.clone(),
        operations: vec![VaultOperation::VaultImported {
            source_content_hash: source_content_hash.clone(),
            secrets,
        }],
    };
    VaultEvent::sign(body, signing_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    fn test_signing_key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    fn actor(signing_key: &SigningKey) -> AuthKeyId {
        SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key()).unwrap()
    }

    fn public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
        DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().as_bytes()))
    }

    #[test]
    fn genesis_event_has_no_parents() {
        let signing_key = test_signing_key();
        let epoch = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )
        .unwrap();
        let event = build_genesis_import_event(
            &StoreId::parse("store_testtoken11").unwrap(),
            &actor(&signing_key),
            &epoch,
            &Sha256Hex::from_trusted("deadbeef".repeat(8)),
            vec![],
            &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            &signing_key,
        )
        .unwrap();
        event
            .verify_signature(&signing_key.verifying_key())
            .unwrap();
        assert!(event.body.parents.is_empty());
    }

    #[test]
    fn event_id_changes_when_parents_change() {
        let signing_key = test_signing_key();
        let epoch = EventId::parse(
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        )
        .unwrap();
        let mut body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse("store_testtoken11").unwrap(),
            actor_id: actor(&signing_key),
            actor_signing_public_key: Some(public_key(&signing_key)),
            parents: vec![epoch.clone()],
            created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            key_epoch: epoch.clone(),
            operations: vec![VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload {
                    id: SecretId::from_vault_record("secret_abc12345678"),
                    secret_type: SecretType::Login,
                    ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
                },
            }],
        };
        let id_a = body.event_id().unwrap();
        body.parents.push(
            EventId::parse(
                "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            )
            .unwrap(),
        );
        body.parents.sort();
        let id_b = body.event_id().unwrap();
        assert_ne!(id_a, id_b);
    }

    #[test]
    fn validate_envelope_rejects_wrong_store() {
        let signing_key = test_signing_key();
        let epoch = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )
        .unwrap();
        let event = build_genesis_import_event(
            &StoreId::parse("store_testtoken11").unwrap(),
            &actor(&signing_key),
            &epoch,
            &Sha256Hex::from_trusted("deadbeef".repeat(8)),
            vec![],
            &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            &signing_key,
        )
        .unwrap();
        let wrong_store = StoreId::parse("store_otherid0001").unwrap();
        assert!(event.validate_envelope(&wrong_store).is_err());
    }

    #[test]
    fn event_storage_is_pretty_yaml_and_roundtrips() {
        let signing_key = test_signing_key();
        let epoch = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )
        .unwrap();
        let event = build_genesis_import_event(
            &StoreId::parse("store_testtoken11").unwrap(),
            &actor(&signing_key),
            &epoch,
            &Sha256Hex::from_trusted("deadbeef".repeat(8)),
            vec![EncryptedSecretPayload {
                id: SecretId::from_vault_record("secret_abc12345678"),
                secret_type: SecretType::Login,
                ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
            }],
            &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            &signing_key,
        )
        .unwrap();

        let yaml = String::from_utf8(serialize_event_storage_yaml(&event).unwrap()).unwrap();
        assert!(yaml.starts_with("schema_version: 2\n"));
        assert!(yaml.contains("operations:\n- type: vault-imported\n"));
        assert!(yaml.contains("\n  secrets:\n  - id: secret_abc12345678\n"));
        assert!(yaml.contains("\nsignature: ed25519:"));
        assert!(yaml.ends_with('\n'));
        assert!(!yaml.trim_start().starts_with('{'));
        assert_eq!(
            parse_event_storage_bytes(yaml.as_bytes())
                .unwrap()
                .id()
                .unwrap(),
            event.id().unwrap()
        );
    }
}
