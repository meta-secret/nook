//! Key-epoch rotation: fresh `secrets_key` / `members_key` for append-only security events.

use crate::errors::{EventError, VaultEpochError, VaultEpochResult, VaultResult};
use crate::multi_device::{DeviceIdentity, VaultKeys};
#[cfg(test)]
use crate::secret_types::StoredRecordPayload;
use crate::secret_types::StoredSecretRecord;
use crate::vault_connect::apply_member_records;
use crate::vault_crypto::VaultCrypto;
use crate::vault_event::EncryptedSecretPayload;
use crate::vault_wire::{AgeArmoredCiphertext, OpaqueCiphertext, Sha256Hex, SymmetricKey};
use crate::{VaultMetaRecord, build_members_records, genesis_auth_record, resolve_member_roster};

/// Re-encrypt user secrets under a new `secrets_key`.
pub fn reencrypt_user_secrets_for_epoch(
    records: &[StoredSecretRecord],
    old_secrets_key: &SymmetricKey,
    new_secrets_key: &SymmetricKey,
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
        let armored = AgeArmoredCiphertext::from_trusted_armored(record.value.as_str().to_owned());
        let mut plaintext = old_crypto.decrypt_value(&armored)?;
        let mut value = crate::SecretValue::from_yaml_str(secret_type, plaintext.as_str())?;
        let fingerprint = crate::secret_fingerprint(&value, new_secrets_key);
        let ciphertext = new_crypto.encrypt_value(&plaintext)?;
        plaintext.zeroize_plaintext();
        value.zeroize_plaintext();
        out.push(EncryptedSecretPayload {
            id: record.key.clone(),
            secret_type,
            ciphertext: OpaqueCiphertext::from_trusted(ciphertext.as_str().to_owned()),
            fingerprint: Some(fingerprint),
        });
    }
    Ok(out)
}

/// Rotate vault keys and rebuild encrypted secret payloads for a new epoch.
pub fn rotate_vault_keys_with_secrets(
    user_records: &[StoredSecretRecord],
    old_secrets_key: &SymmetricKey,
) -> VaultEpochResult<(VaultKeys, Vec<EncryptedSecretPayload>)> {
    let new_keys = crate::generate_vault_keys()?;
    let secrets =
        reencrypt_user_secrets_for_epoch(user_records, old_secrets_key, &new_keys.secrets_key)?;
    Ok((new_keys, secrets))
}

/// Hash of member roster records after re-encrypting under a new `members_key`.
pub fn members_checkpoint_hash_from_roster(
    records: &[StoredSecretRecord],
    old_members_key: &SymmetricKey,
    new_members_key: &SymmetricKey,
) -> VaultResult<Sha256Hex> {
    let roster = resolve_member_roster(records, old_members_key)?;
    let member_records = build_members_records(&roster, new_members_key)?;
    let json =
        serde_json::to_string(&member_records).map_err(EventError::MemberRecordsSerialize)?;
    Ok(crate::sha256_hex(json.as_bytes()))
}

/// Replace auth + member meta rows in the typed session meta state after epoch rotation.
pub fn rewrap_vault_meta_for_epoch(
    state: &mut crate::VaultMetaState,
    identity: &DeviceIdentity,
    records_snapshot: &[StoredSecretRecord],
    old_members_key: &SymmetricKey,
    new_keys: &VaultKeys,
) -> VaultResult<()> {
    let auth = genesis_auth_record(identity, &new_keys.secrets_key, &new_keys.members_key)?;
    state.auth.clear();
    if let VaultMetaRecord::Auth(auth_id, envelopes) = VaultMetaRecord::classify(&auth) {
        state.auth.insert(auth_id, envelopes);
    }
    let roster = resolve_member_roster(records_snapshot, old_members_key)?;
    let member_records = build_members_records(&roster, &new_keys.members_key)?;
    apply_member_records(state, &member_records);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ApiKeySecret, DeviceIdentity, SecretId, SecretValue, VaultResult, generate_vault_keys,
        genesis_members_records,
    };

    #[test]
    fn reencrypt_produces_decryptable_new_epoch_secrets() {
        let old_key =
            SymmetricKey::parse("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
                .unwrap();
        let record = StoredSecretRecord {
            key: SecretId::from_vault_record("secret_testtoken1"),
            secret_type: Some(crate::SecretType::ApiKey),
            value: StoredRecordPayload::from_age_armored(
                VaultCrypto::new(&old_key)
                    .unwrap()
                    .encrypt_value(
                        SecretValue::ApiKey(ApiKeySecret {
                            website_url: "https://example.com".to_owned(),
                            key: "hunter2".to_owned(),
                            expires_at: String::new(),
                        })
                        .to_yaml()
                        .unwrap(),
                    )
                    .unwrap(),
            ),
        };
        let new_key =
            SymmetricKey::parse("cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe")
                .unwrap();
        let payloads = reencrypt_user_secrets_for_epoch(&[record], &old_key, &new_key).unwrap();
        let new_crypto = VaultCrypto::new(&new_key).unwrap();
        let plaintext = new_crypto
            .decrypt_value(&AgeArmoredCiphertext::from_trusted_armored(
                payloads[0].ciphertext.as_str().to_owned(),
            ))
            .unwrap();
        assert!(plaintext.as_str().contains("hunter2"));
    }

    #[test]
    fn members_checkpoint_hash_produces_hex_digest() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let new_keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let mut records = vec![genesis_auth_record(
            &identity,
            &keys.secrets_key,
            &keys.members_key,
        )?];
        records.extend(genesis_members_records(
            &identity,
            &keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        let hash = members_checkpoint_hash_from_roster(
            &records,
            &keys.members_key,
            &new_keys.members_key,
        )?;
        assert_eq!(hash.as_str().len(), 64);
        assert!(hash.as_str().chars().all(|c| c.is_ascii_hexdigit()));
        Ok(())
    }

    #[test]
    fn rewrap_vault_meta_updates_auth_and_member_rows() -> VaultResult<()> {
        let old_keys = generate_vault_keys()?;
        let new_keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let mut records = vec![genesis_auth_record(
            &identity,
            &old_keys.secrets_key,
            &old_keys.members_key,
        )?];
        records.extend(genesis_members_records(
            &identity,
            &old_keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        let mut state = crate::VaultMetaState::from_stored_records(&records);
        let old_auth_envelopes = state.auth.get(&identity.auth_id()).cloned();

        rewrap_vault_meta_for_epoch(
            &mut state,
            &identity,
            &records,
            &old_keys.members_key,
            &new_keys,
        )?;

        assert_ne!(
            state.auth.get(&identity.auth_id()),
            old_auth_envelopes.as_ref()
        );
        assert!(!state.members.is_empty());
        Ok(())
    }
}
