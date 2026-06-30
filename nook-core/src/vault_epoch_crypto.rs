//! Key-epoch rotation: fresh `secrets_key` / `members_key` for append-only security events.

use crate::errors::{VaultEpochError, VaultEpochResult};
use crate::multi_device::VaultKeys;
use crate::secret_types::StoredSecretRecord;
use crate::vault_crypto::VaultCrypto;
use crate::vault_event::EncryptedSecretPayload;

/// Re-encrypt user secrets under a new `secrets_key`.
pub fn reencrypt_user_secrets_for_epoch(
    records: &[StoredSecretRecord],
    old_secrets_key: &str,
    new_secrets_key: &str,
) -> VaultEpochResult<Vec<EncryptedSecretPayload>> {
    let old_crypto = VaultCrypto::new(old_secrets_key)?;
    let new_crypto = VaultCrypto::new(new_secrets_key)?;
    let mut out = Vec::new();
    for record in records {
        let secret_type = record
            .secret_type
            .ok_or(VaultEpochError::MissingSecretType {
                key: record.key.to_string(),
            })?;
        let plaintext = old_crypto.decrypt_value(&record.value)?;
        let ciphertext = new_crypto.encrypt_value(&plaintext)?;
        out.push(EncryptedSecretPayload {
            id: record.key.to_string(),
            secret_type,
            ciphertext,
        });
    }
    Ok(out)
}

/// Rotate vault keys and rebuild encrypted secret payloads for a new epoch.
pub fn rotate_vault_keys_with_secrets(
    user_records: &[StoredSecretRecord],
    old_secrets_key: &str,
) -> VaultEpochResult<(VaultKeys, Vec<EncryptedSecretPayload>)> {
    let new_keys = crate::generate_vault_keys()?;
    let secrets =
        reencrypt_user_secrets_for_epoch(user_records, old_secrets_key, &new_keys.secrets_key)?;
    Ok((new_keys, secrets))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ApiKeySecret, SecretId, SecretValue};

    #[test]
    fn reencrypt_produces_decryptable_new_epoch_secrets() {
        let old_key = "deadbeefdeadbeefdeadbeefdeadbeef";
        let record = StoredSecretRecord {
            key: SecretId::from_vault_record("secret_testtoken1"),
            secret_type: Some(crate::SecretType::ApiKey),
            value: VaultCrypto::new(old_key)
                .unwrap()
                .encrypt_value(
                    &SecretValue::ApiKey(ApiKeySecret {
                        website_url: "https://example.com".to_owned(),
                        key: "hunter2".to_owned(),
                        expires_at: String::new(),
                    })
                    .to_yaml()
                    .unwrap(),
                )
                .unwrap(),
        };
        let new_key = "cafebabecafebabecafebabecafebabe";
        let payloads = reencrypt_user_secrets_for_epoch(&[record], old_key, new_key).unwrap();
        let new_crypto = VaultCrypto::new(new_key).unwrap();
        let plaintext = new_crypto.decrypt_value(&payloads[0].ciphertext).unwrap();
        assert!(plaintext.contains("hunter2"));
    }
}
