//! Vault event envelope, typed domain operations, and signing helpers.

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::{
    Ed25519Signature, EventId, canonical_json_bytes, canonicalize_json, event_id_from_body_bytes,
    sign_body, verify_body_signature,
};
use crate::secret_types::{SecretType, StoredRecordPayload, StoredSecretRecord};
use crate::vault_ids::{AuthKeyId, DeviceId, SecretId, StoreId};
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
    pub const CURRENT: Self = Self::V1;

    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
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
            && !matches!(
                self.body.operations.as_slice(),
                [VaultOperation::VaultImported { .. }]
            )
        {
            return Err(EventError::MissingEventParents.into());
        }
        for parent in &self.body.parents {
            EventId::parse(parent.as_str())?;
        }
        EventId::parse(self.body.key_epoch.as_str())?;
        self.id()
    }
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
    let body = VaultEventBody {
        schema_version: VaultEventSchemaVersion::CURRENT,
        store_id: store_id.clone(),
        actor_id: actor_id.clone(),
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

    #[test]
    fn genesis_event_has_no_parents() {
        let signing_key = test_signing_key();
        let epoch = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )
        .unwrap();
        let event = build_genesis_import_event(
            &StoreId::parse("store_testtoken11").unwrap(),
            &AuthKeyId::parse(
                "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            )
            .unwrap(),
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
        let _signing_key = test_signing_key();
        let epoch = EventId::parse(
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        )
        .unwrap();
        let mut body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse("store_testtoken11").unwrap(),
            actor_id: AuthKeyId::parse(
                "key_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            )
            .unwrap(),
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
}
