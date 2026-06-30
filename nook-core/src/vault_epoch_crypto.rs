//! Key-epoch rotation: fresh `secrets_key` / `members_key` for append-only security events.

use crate::errors::{EventError, VaultEpochError, VaultEpochResult, VaultResult};
use crate::multi_device::{DeviceIdentity, VaultKeys};
use crate::secret_types::StoredSecretRecord;
use crate::vault_connect::apply_member_records;
use crate::vault_crypto::VaultCrypto;
use crate::vault_event::EncryptedSecretPayload;
use crate::{
    build_members_records, genesis_auth_record, is_auth_stored_record, resolve_member_roster,
};
use std::collections::HashMap;

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
                key: record.key.clone(),
            })?;
        let plaintext = old_crypto.decrypt_value(&record.value)?;
        let ciphertext = new_crypto.encrypt_value(&plaintext)?;
        out.push(EncryptedSecretPayload {
            id: record.key.clone(),
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

/// Hash of member roster records after re-encrypting under a new `members_key`.
pub fn members_checkpoint_hash_from_roster(
    records: &[StoredSecretRecord],
    old_members_key: &str,
    new_members_key: &str,
) -> VaultResult<String> {
    let roster = resolve_member_roster(records, old_members_key)?;
    let member_records = build_members_records(&roster, new_members_key)?;
    let json =
        serde_json::to_string(&member_records).map_err(EventError::MemberRecordsSerialize)?;
    Ok(crate::sha256_hex(json.as_bytes()))
}

/// Replace auth + member meta rows in an armored cache after epoch rotation.
#[allow(clippy::implicit_hasher)]
pub fn rewrap_vault_meta_for_epoch(
    armored: &mut HashMap<String, String>,
    identity: &DeviceIdentity,
    records_snapshot: &[StoredSecretRecord],
    old_members_key: &str,
    new_keys: &VaultKeys,
) -> VaultResult<()> {
    let auth = genesis_auth_record(identity, &new_keys.secrets_key, &new_keys.members_key)?;
    armored.retain(|key, value| {
        !is_auth_stored_record(&StoredSecretRecord {
            key: key.clone(),
            secret_type: None,
            value: value.clone(),
        })
    });
    armored.insert(auth.key, auth.value);
    let roster = resolve_member_roster(records_snapshot, old_members_key)?;
    let member_records = build_members_records(&roster, &new_keys.members_key)?;
    apply_member_records(armored, &member_records);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ApiKeySecret;
    use crate::SecretValue;

    #[test]
    fn reencrypt_produces_decryptable_new_epoch_secrets() {
        let old_key = "deadbeefdeadbeefdeadbeefdeadbeef";
        let record = StoredSecretRecord {
            key: "secret_testtoken1".to_owned(),
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
