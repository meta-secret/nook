//! Plaintext session hydration from projected or stored user records.

use crate::errors::VaultResult;
use crate::{Database, SecretType, StoredSecretRecord, VaultCrypto, is_vault_meta_record};
use std::collections::HashMap;

/// Merge live user secrets into an armored session cache and return decrypted JSONL.
///
/// Vault meta rows (auth, members, join) in `armored` are preserved; user secret rows
/// are replaced from `user_records`.
#[allow(clippy::implicit_hasher)]
pub fn apply_user_records_to_armored_session(
    user_records: Vec<StoredSecretRecord>,
    crypto: &VaultCrypto,
    armored: &mut HashMap<String, String>,
    secret_types: &mut HashMap<String, SecretType>,
) -> VaultResult<String> {
    let db = Database::from_stored_records_with_crypto(&user_records, crypto)?;
    let jsonl = db.to_jsonl()?;
    armored.retain(|key, value| {
        is_vault_meta_record(&StoredSecretRecord {
            key: key.clone(),
            secret_type: None,
            value: value.clone(),
        })
    });
    secret_types.retain(|key, _| armored.contains_key(key));
    for record in user_records {
        armored.insert(record.key.clone(), record.value);
        if let Some(secret_type) = record.secret_type {
            secret_types.insert(record.key, secret_type);
        }
    }
    Ok(jsonl)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ApiKeySecret, SecretValue, VaultResult, generate_vault_keys, genesis_auth_record,
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

        let mut armored = HashMap::from([
            (auth.key.clone(), auth.value),
            ("secret_old0000001".to_owned(), "stale".to_owned()),
        ]);
        let mut secret_types =
            HashMap::from([("secret_old0000001".to_owned(), crate::SecretType::ApiKey)]);

        let user_records = vec![StoredSecretRecord {
            key: "secret_new0000001".to_owned(),
            secret_type: Some(crate::SecretType::ApiKey),
            value: ciphertext,
        }];

        let jsonl = apply_user_records_to_armored_session(
            user_records,
            &crypto,
            &mut armored,
            &mut secret_types,
        )?;

        assert!(jsonl.contains("secret_new0000001"));
        assert!(!armored.contains_key("secret_old0000001"));
        assert!(armored.contains_key("secret_new0000001"));
        assert!(armored.contains_key(&auth.key));
        assert_eq!(secret_types.len(), 1);
        Ok(())
    }
}
