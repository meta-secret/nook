//! Plaintext session hydration from projected or stored user records.

use crate::errors::VaultResult;
use crate::{Database, StoredSecretRecord, VaultCrypto, VaultMetaState};

/// Merge live user secrets into the typed session meta state and return the
/// decrypted in-memory database.
///
/// Vault meta rows (auth, members, join) in `state` are preserved; the `secrets`
/// bucket is fully replaced from `user_records`.
pub fn apply_user_records_to_armored_session(
    user_records: Vec<StoredSecretRecord>,
    crypto: &VaultCrypto,
    state: &mut VaultMetaState,
) -> VaultResult<Database> {
    let db = Database::from_stored_records_with_crypto(&user_records, crypto)?;
    state.secrets.clear();
    for record in user_records {
        if let Some(secret_type) = record.secret_type {
            state
                .secrets
                .insert(record.key, (secret_type, record.value));
        }
    }
    Ok(db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ApiKeySecret, SecretId, SecretValue, StoredRecordPayload, VaultResult, generate_vault_keys,
        genesis_auth_record,
    };

    #[test]
    fn apply_user_records_preserves_meta_and_replaces_secrets() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let identity = crate::DeviceIdentity::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let auth = genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key)?;
        let ciphertext = crypto.encrypt_value(
            &SecretValue::ApiKey(ApiKeySecret {
                website_url: "https://example.com".to_owned(),
                key: "secret-value".to_owned(),
                expires_at: String::new(),
            })
            .to_yaml()?,
        )?;

        let old_id = SecretId::from_vault_record("secret_old0000001");
        let mut state = VaultMetaState::from_stored_records(std::slice::from_ref(&auth));
        state.secrets.insert(
            old_id.clone(),
            (
                crate::SecretType::ApiKey,
                StoredRecordPayload::from_trusted("stale".to_owned()),
            ),
        );

        let new_id = SecretId::from_vault_record("secret_new0000001");
        let user_records = vec![StoredSecretRecord {
            key: new_id.clone(),
            secret_type: Some(crate::SecretType::ApiKey),
            value: StoredRecordPayload::from_age_armored(ciphertext),
        }];

        let db = apply_user_records_to_armored_session(user_records, &crypto, &mut state)?;

        assert!(db.list().iter().any(|record| record.id == new_id));
        assert!(!state.secrets.contains_key(&old_id));
        assert!(state.secrets.contains_key(&new_id));
        assert!(state.auth.contains_key(&identity.auth_id()));
        assert_eq!(state.secrets.len(), 1);
        Ok(())
    }
}
