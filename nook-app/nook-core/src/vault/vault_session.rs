//! Ciphertext-backed session access for projected or stored user records.

use crate::errors::VaultResult;
use crate::{
    Database, SecretId, SecretListItem, SecretRecord, SecretType, SecretValue, StoredRecordPayload,
    StoredSecretRecord, VaultCrypto, VaultMetaState,
};
use std::collections::HashMap;
use std::hash::BuildHasher;

pub const DEFAULT_SECRET_PAGE_SIZE: usize = 50;
pub const MAX_SECRET_PAGE_SIZE: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretPage {
    pub records: Vec<SecretListItem>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
}

fn decrypt_secret_record(
    id: &SecretId,
    secret_type: SecretType,
    payload: &StoredRecordPayload,
    crypto: &VaultCrypto,
) -> VaultResult<SecretRecord> {
    let ciphertext = crate::AgeArmoredCiphertext::parse(payload.as_str())?;
    let mut plaintext = crypto.decrypt_value(&ciphertext)?;
    let data = SecretValue::from_yaml_str(secret_type, plaintext.as_str())?;
    plaintext.zeroize_plaintext();
    Ok(SecretRecord {
        id: id.clone(),
        secret_type,
        data,
    })
}

pub fn decrypt_encrypted_secret<S: BuildHasher>(
    secrets: &HashMap<SecretId, (SecretType, StoredRecordPayload), S>,
    crypto: &VaultCrypto,
    id: &SecretId,
) -> VaultResult<SecretRecord> {
    let (secret_type, payload) = secrets
        .get(id)
        .ok_or_else(|| crate::SessionError::SecretNotFound { id: id.clone() })?;
    decrypt_secret_record(id, *secret_type, payload, crypto)
}

/// Decrypt only the requested page from a ciphertext-backed vault session.
///
/// Empty queries select the page by sorted id without decrypting records outside
/// the page. Non-empty production search uses [`super::SecretSearchCatalog`];
/// this fallback still zeroizes each decrypted candidate immediately.
pub fn query_encrypted_secrets<S: BuildHasher>(
    secrets: &HashMap<SecretId, (SecretType, StoredRecordPayload), S>,
    crypto: &VaultCrypto,
    query: &str,
    secret_type_filter: Option<SecretType>,
    offset: usize,
    limit: usize,
) -> VaultResult<SecretPage> {
    let limit = limit.clamp(1, MAX_SECRET_PAGE_SIZE);
    let needle = query.trim();
    let mut ids = secrets.keys().cloned().collect::<Vec<_>>();
    ids.sort();

    if needle.is_empty() {
        let total = ids
            .iter()
            .filter(|id| {
                secret_type_filter.is_none_or(|expected| {
                    secrets
                        .get(id)
                        .is_some_and(|(secret_type, _)| *secret_type == expected)
                })
            })
            .count();
        let records = ids
            .into_iter()
            .filter(|id| {
                secret_type_filter.is_none_or(|expected| {
                    secrets
                        .get(id)
                        .is_some_and(|(secret_type, _)| *secret_type == expected)
                })
            })
            .skip(offset)
            .take(limit)
            .map(|id| {
                let (secret_type, payload) =
                    secrets.get(&id).expect("secret id came from the same map");
                let mut record = decrypt_secret_record(&id, *secret_type, payload, crypto)?;
                let item = record.list_item();
                record.zeroize_plaintext();
                Ok(item)
            })
            .collect::<VaultResult<Vec<_>>>()?;
        return Ok(SecretPage {
            records,
            total,
            offset,
            limit,
        });
    }

    let mut total = 0;
    let mut records = Vec::with_capacity(limit);
    for id in ids {
        let (secret_type, payload) = secrets.get(&id).expect("secret id came from the same map");
        if secret_type_filter.is_some_and(|expected| *secret_type != expected) {
            continue;
        }
        let mut record = decrypt_secret_record(&id, *secret_type, payload, crypto)?;
        if record.matches_search(needle) {
            if total >= offset && records.len() < limit {
                records.push(record.list_item());
                record.zeroize_plaintext();
            } else {
                record.zeroize_plaintext();
            }
            total += 1;
        } else {
            record.zeroize_plaintext();
        }
    }

    Ok(SecretPage {
        records,
        total,
        offset,
        limit,
    })
}

/// Replace the encrypted user-record bucket without hydrating plaintext.
pub fn apply_user_records_to_encrypted_session(
    user_records: Vec<StoredSecretRecord>,
    state: &mut VaultMetaState,
) {
    state.secrets.clear();
    for record in user_records {
        if let Some(secret_type) = record.secret_type {
            state
                .secrets
                .insert(record.key, (secret_type, record.value));
        }
    }
}

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
    apply_user_records_to_encrypted_session(user_records, state);
    Ok(db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ApiKeySecret, LoginSecret, SecretId, SecretValue, StoredRecordPayload, VaultResult,
        generate_vault_keys, genesis_auth_record,
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

    fn encrypted_record(
        crypto: &VaultCrypto,
        id: &str,
        username: &str,
        password: &str,
    ) -> VaultResult<(SecretId, (crate::SecretType, StoredRecordPayload))> {
        let id = SecretId::from_vault_record(id);
        let value = SecretValue::Login(LoginSecret {
            website_url: format!("https://{username}.example.com"),
            username: username.to_owned(),
            password: password.to_owned(),
            notes: String::new(),
        });
        let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
        Ok((
            id,
            (
                crate::SecretType::Login,
                StoredRecordPayload::from_age_armored(ciphertext),
            ),
        ))
    }

    fn encrypted_note(
        crypto: &VaultCrypto,
        id: &str,
        title: &str,
    ) -> VaultResult<(SecretId, (crate::SecretType, StoredRecordPayload))> {
        let id = SecretId::from_vault_record(id);
        let value = SecretValue::SecureNote(crate::SecureNoteSecret {
            title: title.to_owned(),
            note: "private note body".to_owned(),
        });
        let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
        Ok((
            id,
            (
                crate::SecretType::SecureNote,
                StoredRecordPayload::from_age_armored(ciphertext),
            ),
        ))
    }

    #[test]
    fn empty_query_decrypts_only_requested_page() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut secrets = HashMap::new();
        secrets.extend([
            encrypted_record(&crypto, "secret_c", "carol", "pw-c")?,
            encrypted_record(&crypto, "secret_a", "alice", "pw-a")?,
            encrypted_record(&crypto, "secret_b", "bob", "pw-b")?,
        ]);

        let page = query_encrypted_secrets(&secrets, &crypto, "", None, 1, 1)?;

        assert_eq!(page.total, 3);
        assert_eq!(page.records.len(), 1);
        assert_eq!(page.records[0].id.as_str(), "secret_b");
        assert_eq!(page.records[0].summary(), "bob");
        Ok(())
    }

    #[test]
    fn search_counts_matches_and_returns_requested_window() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut secrets = HashMap::new();
        secrets.extend([
            encrypted_record(&crypto, "secret_a", "team-alice", "hidden-a")?,
            encrypted_record(&crypto, "secret_b", "other", "team-password")?,
            encrypted_record(&crypto, "secret_c", "team-carol", "hidden-c")?,
        ]);

        let page = query_encrypted_secrets(&secrets, &crypto, "team", None, 1, 1)?;

        assert_eq!(page.total, 2);
        assert_eq!(page.records.len(), 1);
        assert_eq!(page.records[0].id.as_str(), "secret_c");
        Ok(())
    }

    #[test]
    fn type_filter_counts_and_pages_only_matching_records() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut secrets = HashMap::new();
        secrets.extend([
            encrypted_record(&crypto, "secret_a", "alice", "hidden-a")?,
            encrypted_note(&crypto, "secret_b", "Recovery")?,
            encrypted_note(&crypto, "secret_c", "Operations")?,
        ]);

        let page = query_encrypted_secrets(
            &secrets,
            &crypto,
            "",
            Some(crate::SecretType::SecureNote),
            1,
            1,
        )?;

        assert_eq!(page.total, 2);
        assert_eq!(page.records.len(), 1);
        assert_eq!(page.records[0].id.as_str(), "secret_c");
        assert_eq!(page.records[0].secret_type(), crate::SecretType::SecureNote);
        Ok(())
    }

    #[test]
    fn type_filter_combines_with_metadata_search() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let secrets = HashMap::from([
            encrypted_record(&crypto, "secret_a", "recovery-user", "hidden")?,
            encrypted_note(&crypto, "secret_b", "Recovery plan")?,
            encrypted_note(&crypto, "secret_c", "Operations")?,
        ]);

        let page = query_encrypted_secrets(
            &secrets,
            &crypto,
            "recovery",
            Some(crate::SecretType::SecureNote),
            0,
            50,
        )?;

        assert_eq!(page.total, 1);
        assert_eq!(page.records[0].id.as_str(), "secret_b");
        Ok(())
    }

    #[test]
    fn page_results_never_contain_secret_plaintext() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let secrets = HashMap::from([encrypted_record(
            &crypto,
            "secret_a",
            "alice",
            "credential-must-not-cross-page-boundary",
        )?]);

        let page = query_encrypted_secrets(&secrets, &crypto, "", None, 0, 50)?;
        let debug = format!("{:?}", page.records);

        assert_eq!(page.records[0].summary(), "alice");
        assert!(!debug.contains("credential-must-not-cross-page-boundary"));
        Ok(())
    }

    #[test]
    fn explicit_decrypt_returns_only_requested_record() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let requested = encrypted_record(&crypto, "secret_a", "alice", "requested-password")?;
        let invalid_id = SecretId::from_vault_record("secret_invalid");
        let secrets = HashMap::from([
            requested,
            (
                invalid_id,
                (
                    crate::SecretType::Login,
                    StoredRecordPayload::from_trusted("not-age-ciphertext".to_owned()),
                ),
            ),
        ]);

        let id = SecretId::from_vault_record("secret_a");
        let mut record = decrypt_encrypted_secret(&secrets, &crypto, &id)?;

        assert_eq!(record.primary_credential(), "requested-password");
        record.zeroize_plaintext();
        Ok(())
    }

    #[test]
    fn explicit_decrypt_rejects_unknown_record() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let secrets = HashMap::new();
        let id = SecretId::from_vault_record("secret_missing");

        let error = decrypt_encrypted_secret(&secrets, &crypto, &id).unwrap_err();

        assert!(matches!(
            error,
            crate::VaultError::Session(crate::SessionError::SecretNotFound { .. })
        ));
        Ok(())
    }

    #[test]
    fn search_never_matches_secret_values() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let secrets = HashMap::from([encrypted_record(
            &crypto,
            "secret_a",
            "alice",
            "find-me-only-in-password",
        )?]);

        let page =
            query_encrypted_secrets(&secrets, &crypto, "find-me-only-in-password", None, 0, 50)?;

        assert_eq!(page.total, 0);
        assert!(page.records.is_empty());
        Ok(())
    }
}
