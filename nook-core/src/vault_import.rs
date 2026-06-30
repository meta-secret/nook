//! Stored vault blob → genesis import event conversion.

use crate::errors::VaultResult;
use crate::event_canonical::{EventId, sha256_hex};
use crate::multi_device::user_stored_records;
use crate::secret_types::StoredSecretRecord;
use crate::vault_event::{EncryptedSecretPayload, VaultEvent, build_genesis_import_event};
use crate::vault_format::deserialize_stored;
use crate::vault_ids::{AuthKeyId, StoreId};
use crate::vault_wire::{IsoTimestamp, Sha256Hex};
use ed25519_dalek::SigningKey;

/// Content-addressed context for a stored vault blob (YAML/JSONL on disk).
///
/// Hash is SHA-256 over trimmed UTF-8 bytes — stable across providers for the
/// same on-wire vault file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultHashContext {
    stored: String,
    content_hash: Sha256Hex,
}

impl VaultHashContext {
    #[must_use]
    pub fn from_stored(stored: &str) -> Self {
        Self {
            stored: stored.to_owned(),
            content_hash: sha256_hex(stored.trim().as_bytes()),
        }
    }

    #[must_use]
    pub fn content_hash(&self) -> &Sha256Hex {
        &self.content_hash
    }

    #[must_use]
    pub fn stored(&self) -> &str {
        &self.stored
    }

    pub fn encrypted_secrets(&self) -> VaultResult<Vec<EncryptedSecretPayload>> {
        let format = crate::vault_format::detect_stored_format(&self.stored)?;
        let records = deserialize_stored(&self.stored, format)?;
        Ok(user_stored_records(&records)
            .iter()
            .map(EncryptedSecretPayload::from_stored)
            .collect())
    }

    #[must_use]
    pub fn genesis_epoch_id(&self) -> KeyEpochId {
        KeyEpochId::from_content_hash(self.content_hash.as_str())
    }
}

impl From<&str> for VaultHashContext {
    fn from(stored: &str) -> Self {
        Self::from_stored(stored)
    }
}

/// Build a signed genesis `vault-imported` event from a stored vault blob.
pub fn stored_vault_to_import_event(
    ctx: &VaultHashContext,
    store_id: &StoreId,
    actor_id: &AuthKeyId,
    signing_key: &SigningKey,
    created_at: &IsoTimestamp,
) -> VaultResult<VaultEvent> {
    let secrets = ctx.encrypted_secrets()?;
    build_genesis_import_event(
        store_id,
        actor_id,
        ctx.genesis_epoch_id().as_event_id(),
        ctx.content_hash(),
        secrets,
        created_at,
        signing_key,
    )
}

/// Genesis epoch id derived from the vault content hash.
#[derive(Debug, Clone)]
pub struct KeyEpochId(EventId);

impl KeyEpochId {
    #[must_use]
    pub fn from_content_hash(content_hash: &str) -> Self {
        Self(EventId::from_trusted(format!("sha256:{content_hash}")))
    }

    #[must_use]
    pub fn as_event_id(&self) -> &EventId {
        &self.0
    }
}

/// Verify that a genesis import event matches the source stored vault blob.
pub fn verify_stored_vault_import(ctx: &VaultHashContext, import: &VaultEvent) -> VaultResult<()> {
    let crate::vault_event::VaultOperation::VaultImported {
        secrets,
        source_content_hash,
    } = import
        .body
        .operations
        .first()
        .ok_or(crate::errors::EventError::ExpectedImportOperation)?
    else {
        return Err(crate::errors::EventError::ExpectedImportOperation.into());
    };

    if source_content_hash != ctx.content_hash() {
        return Err(crate::errors::EventError::ImportContentHashMismatch.into());
    }

    let source_ids: std::collections::BTreeSet<String> = ctx
        .encrypted_secrets()?
        .into_iter()
        .map(|secret| secret.id.to_string())
        .collect();
    let import_ids: std::collections::BTreeSet<String> =
        secrets.iter().map(|secret| secret.id.to_string()).collect();
    if source_ids != import_ids {
        return Err(crate::errors::EventError::ImportSecretSetMismatch.into());
    }
    Ok(())
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
    use crate::{ApiKeySecret, SecretId, SecretValue, generate_store_id};
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    #[test]
    fn stored_vault_import_is_idempotent_by_content_hash() -> VaultResult<()> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let store_id = generate_store_id()?;
        let actor = AuthKeyId::parse(
            "key_1111111111111111111111111111111111111111111111111111111111111111",
        )?;
        let created_at = IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned());

        let mut db = Database::new();
        db.insert(
            SecretId::from_vault_record("secret_testtoken1"),
            SecretValue::ApiKey(ApiKeySecret {
                website_url: "https://example.com".to_owned(),
                key: "hunter2".to_owned(),
                expires_at: String::new(),
            }),
        );
        let passphrase = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
        let yaml = db.to_stored_yaml(passphrase)?;
        let ctx = VaultHashContext::from(yaml.as_str());

        let first =
            stored_vault_to_import_event(&ctx, &store_id, &actor, &signing_key, &created_at)?;
        let second =
            stored_vault_to_import_event(&ctx, &store_id, &actor, &signing_key, &created_at)?;
        assert_eq!(first.id()?, second.id()?);

        if let crate::vault_event::VaultOperation::VaultImported {
            secrets,
            source_content_hash,
        } = &first.body.operations[0]
        {
            assert_eq!(secrets.len(), 1);
            assert_eq!(secrets[0].secret_type, SecretType::ApiKey);
            assert_eq!(source_content_hash, ctx.content_hash());
        } else {
            return Err(crate::errors::EventError::ExpectedImportOperation.into());
        }
        verify_stored_vault_import(&ctx, &first)?;
        Ok(())
    }

    #[test]
    fn vault_hash_context_from_str_matches_from_stored() {
        let stored = "secrets:\n  version: 1\n";
        assert_eq!(
            VaultHashContext::from(stored),
            VaultHashContext::from_stored(stored)
        );
    }
}
