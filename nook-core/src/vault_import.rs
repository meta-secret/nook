//! Legacy whole-vault YAML → genesis import event conversion.

use crate::error::{VaultError, VaultResult};
use crate::event_canonical::{EventId, sha256_hex};
use crate::multi_device::user_stored_records;
use crate::secret_types::StoredSecretRecord;
use crate::vault_event::{EncryptedSecretPayload, VaultEvent, build_genesis_import_event};
use crate::vault_format::deserialize_stored;
use ed25519_dalek::SigningKey;

/// Deterministic SHA-256 content hash for legacy vault bytes (trimmed UTF-8).
#[must_use]
pub fn legacy_vault_content_hash(stored: &str) -> String {
    sha256_hex(stored.trim().as_bytes())
}

/// Extract user secret ciphertext records from a legacy vault blob.
pub fn legacy_encrypted_secrets(stored: &str) -> VaultResult<Vec<EncryptedSecretPayload>> {
    let format = crate::vault_format::detect_stored_format(stored).map_err(VaultError::vault_format)?;
    let records = deserialize_stored(stored, format).map_err(VaultError::vault_format)?;
    Ok(user_stored_records(&records)
        .iter()
        .map(EncryptedSecretPayload::from_stored)
        .collect())
}

/// Build a signed genesis `vault-imported` event from legacy YAML/JSONL bytes.
pub fn legacy_vault_to_import_event(
    stored: &str,
    store_id: &str,
    actor_id: &str,
    signing_key: &SigningKey,
    created_at: &str,
) -> VaultResult<VaultEvent> {
    let source_hash = legacy_vault_content_hash(stored);
    let secrets = legacy_encrypted_secrets(stored)?;
    let epoch = KeyEpochId::from_source_hash(&source_hash);
    build_genesis_import_event(
        store_id,
        actor_id,
        epoch.as_event_id(),
        &source_hash,
        secrets,
        created_at,
        signing_key,
    )
}

/// Derive a stable genesis epoch id from the legacy content hash.
#[derive(Debug, Clone)]
pub struct KeyEpochId(EventId);

impl KeyEpochId {
    #[must_use]
    pub fn from_source_hash(source_hash: &str) -> Self {
        Self(EventId(format!("sha256:{source_hash}")))
    }

    #[must_use]
    pub fn as_event_id(&self) -> &EventId {
        &self.0
    }
}

/// Rebuild stored secret records from a genesis import event's encrypted payloads.
#[must_use]
pub fn secrets_from_import_event(secrets: &[EncryptedSecretPayload]) -> Vec<StoredSecretRecord> {
    secrets
        .iter()
        .map(EncryptedSecretPayload::to_stored)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultResult;
    use crate::database::Database;
    use crate::secret_types::SecretType;
    use crate::{ApiKeySecret, SecretValue, generate_store_id};
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    #[test]
    fn legacy_yaml_import_is_idempotent_by_content_hash() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let store_id = generate_store_id().map_err(VaultError::multi_device)?;
        let actor = "key_1111111111111111111111111111111111111111111111111111111111111111";

        let mut db = Database::new();
        db.insert(
            "secret_testtoken1".to_owned(),
            SecretValue::ApiKey(ApiKeySecret {
                website_url: "https://example.com".to_owned(),
                key: "hunter2".to_owned(),
                expires_at: String::new(),
            }),
        );
        let passphrase = "deadbeefdeadbeefdeadbeefdeadbeef";
        let yaml = db.to_stored_yaml(passphrase).map_err(VaultError::database)?;

        let first = legacy_vault_to_import_event(
            &yaml,
            &store_id,
            actor,
            &signing_key,
            "2026-06-28T00:00:00Z",
        )?;
        let second = legacy_vault_to_import_event(
            &yaml,
            &store_id,
            actor,
            &signing_key,
            "2026-06-28T00:00:00Z",
        )?;
        assert_eq!(first.id()?, second.id()?);

        if let crate::vault_event::VaultOperation::VaultImported {
            secrets,
            source_content_hash,
        } = &first.body.operations[0]
        {
            assert_eq!(secrets.len(), 1);
            assert_eq!(secrets[0].secret_type, SecretType::ApiKey);
            assert_eq!(source_content_hash, &legacy_vault_content_hash(&yaml));
        } else {
            return Err(VaultError::vault_format("expected import operation"));
        }
        Ok(())
    }
}
