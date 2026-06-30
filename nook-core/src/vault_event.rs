//! Vault event envelope, typed domain operations, and signing helpers.

use crate::SecretId;
use crate::errors::{EventError, VaultResult};
use crate::event_canonical::{
    EventId, canonical_json_bytes, canonicalize_json, event_id_from_body_bytes, sign_body,
    verify_body_signature,
};
use crate::secret_types::{SecretType, StoredRecordPayload, StoredSecretRecord};
use ed25519_dalek::{SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const VAULT_EVENT_SCHEMA_VERSION: u32 = 1;

/// Encrypted secret payload embedded in an event operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EncryptedSecretPayload {
    pub id: String,
    #[serde(rename = "type")]
    pub secret_type: SecretType,
    pub ciphertext: String,
}

impl EncryptedSecretPayload {
    #[must_use]
    pub fn from_stored(record: &StoredSecretRecord) -> Self {
        Self {
            id: record.key.to_string(),
            secret_type: record.secret_type.unwrap_or(SecretType::ApiKey),
            ciphertext: record.value.as_str().to_owned(),
        }
    }

    #[must_use]
    pub fn to_stored(&self) -> StoredSecretRecord {
        StoredSecretRecord {
            key: SecretId::from_vault_record(&self.id),
            secret_type: Some(self.secret_type),
            value: StoredRecordPayload::from_trusted(self.ciphertext.clone()),
        }
    }
}

/// Atomic domain operations recorded in the immutable event log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum VaultOperation {
    VaultImported {
        source_content_hash: String,
        secrets: Vec<EncryptedSecretPayload>,
    },
    SecretCreated {
        secret: EncryptedSecretPayload,
    },
    SecretDeleted {
        secret_id: String,
    },
    SecretReplaced {
        old_id: String,
        new_secret: EncryptedSecretPayload,
    },
    SecretConflictResolved {
        old_id: String,
        chosen_secret_id: String,
        rejected_secret_ids: Vec<String>,
    },
    JoinRequested {
        device_id: String,
        encryption_public_key: String,
        signing_public_key: String,
        label: String,
    },
    JoinApproved {
        device_id: String,
        encryption_public_key: String,
        signing_public_key: String,
        label: String,
        secrets_key_ciphertext: String,
        members_key_ciphertext: String,
    },
    JoinDenied {
        device_id: String,
    },
    MemberRenamed {
        device_id: String,
        label: String,
    },
    DeviceRevoked {
        device_id: String,
    },
    PasswordAdded {
        entry_id: String,
        envelope_ciphertext: String,
    },
    PasswordRotated {
        entry_id: String,
        envelope_ciphertext: String,
    },
    PasswordRemoved {
        entry_id: String,
    },
    VaultCleared,
    EpochCheckpoint {
        secrets: Vec<EncryptedSecretPayload>,
        members_checkpoint_hash: String,
    },
}

/// Signed event body (everything except the signature field).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct VaultEventBody {
    pub schema_version: u32,
    pub store_id: String,
    pub actor_id: String,
    pub parents: Vec<String>,
    pub created_at: String,
    pub key_epoch: String,
    pub operations: Vec<VaultOperation>,
}

impl VaultEventBody {
    pub fn to_canonical_value(&self) -> VaultResult<Value> {
        let mut value = serde_json::to_value(self).map_err(EventError::EventBodySerialize)?;
        if let Value::Object(ref mut map) = value {
            let mut sorted_parents = self.parents.clone();
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
    pub signature: String,
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
        verify_body_signature(&body_bytes, &self.signature, verifying_key)
    }

    pub fn validate_envelope(&self, expected_store_id: &str) -> VaultResult<EventId> {
        if self.body.schema_version > VAULT_EVENT_SCHEMA_VERSION {
            return Err(EventError::UnsupportedSchemaVersion {
                version: self.body.schema_version,
            }
            .into());
        }
        if self.body.store_id != expected_store_id {
            return Err(EventError::EventStoreIdMismatch {
                expected: expected_store_id.to_owned(),
                actual: self.body.store_id.clone(),
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
            EventId::parse(parent)?;
        }
        EventId::parse(&self.body.key_epoch)?;
        self.id()
    }
}

/// Build a genesis import event from encrypted snapshot data.
pub fn build_genesis_import_event(
    store_id: &str,
    actor_id: &str,
    key_epoch: &EventId,
    source_content_hash: &str,
    secrets: Vec<EncryptedSecretPayload>,
    created_at: &str,
    signing_key: &SigningKey,
) -> VaultResult<VaultEvent> {
    let body = VaultEventBody {
        schema_version: VAULT_EVENT_SCHEMA_VERSION,
        store_id: store_id.to_owned(),
        actor_id: actor_id.to_owned(),
        parents: Vec::new(),
        created_at: created_at.to_owned(),
        key_epoch: key_epoch.as_str().to_owned(),
        operations: vec![VaultOperation::VaultImported {
            source_content_hash: source_content_hash.to_owned(),
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
            "store_testtoken1",
            "key_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            &epoch,
            "deadbeef",
            vec![],
            "2026-06-28T00:00:00Z",
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
            schema_version: VAULT_EVENT_SCHEMA_VERSION,
            store_id: "store_testtoken1".to_owned(),
            actor_id: "key_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
                .to_owned(),
            parents: vec![epoch.as_str().to_owned()],
            created_at: "2026-06-28T00:00:00Z".to_owned(),
            key_epoch: epoch.as_str().to_owned(),
            operations: vec![VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload {
                    id: "secret_abc12345678".to_owned(),
                    secret_type: SecretType::Login,
                    ciphertext: "cipher".to_owned(),
                },
            }],
        };
        let id_a = body.event_id().unwrap();
        body.parents.push(
            EventId::parse(
                "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            )
            .unwrap()
            .as_str()
            .to_owned(),
        );
        body.parents.sort();
        let id_b = body.event_id().unwrap();
        assert_ne!(id_a, id_b);
    }
}
