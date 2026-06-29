//! Connect-time vault assessment and session hydration from stored YAML.

use crate::error::{VaultError, VaultResult};
use crate::{
    Database, DeviceIdentity, SecretType, StoredSecretRecord, VaultCrypto, VaultUnlock,
    assess_connect_access, deserialize_stored, detect_stored_format, resolve_members_key,
    resolve_secrets_key, user_stored_records, vault_has_multi_device_records,
};
use std::collections::HashMap;

/// Decrypted session material loaded from a stored vault blob.
pub struct LoadedVault {
    pub jsonl: String,
    pub armored: HashMap<String, String>,
    pub secret_types: HashMap<String, SecretType>,
    pub secrets_key: String,
    pub members_key: String,
}

/// Whether connect should bootstrap a genesis vault for this content.
pub fn content_requires_genesis(content: &str, force_genesis: bool) -> VaultResult<bool> {
    if force_genesis {
        return Ok(true);
    }
    if content.trim().is_empty() {
        return Ok(true);
    }
    let format = VaultError::from_vault_format(detect_stored_format(content))?;
    let records = VaultError::from_vault_format(deserialize_stored(content, format))?;
    Ok(!vault_has_multi_device_records(&records))
}

/// Pre-flight connect status tag for the web layer.
pub fn access_status_for_vault_content(
    content: &str,
    identity: &DeviceIdentity,
) -> VaultResult<String> {
    if content.trim().is_empty() {
        return Ok("new_vault".to_owned());
    }
    let format = VaultError::from_vault_format(detect_stored_format(content))?;
    let records = VaultError::from_vault_format(deserialize_stored(content, format))?;
    if !vault_has_multi_device_records(&records) {
        return Ok("new_vault".to_owned());
    }
    Ok(match assess_connect_access(&records, identity) {
        crate::ConnectAccessStatus::Ready => "ready",
        crate::ConnectAccessStatus::NeedsEnrollment => "needs_enrollment",
        crate::ConnectAccessStatus::JoinPending => "join_pending",
    }
    .to_owned())
}

fn records_to_secret_types(records: &[StoredSecretRecord]) -> HashMap<String, SecretType> {
    records
        .iter()
        .filter_map(|record| {
            record
                .secret_type
                .map(|secret_type| (record.key.clone(), secret_type))
        })
        .collect()
}

/// Decrypt and hydrate an in-memory session from stored vault YAML.
#[allow(clippy::implicit_hasher)]
pub fn load_stored_vault(
    content: &str,
    identity: &DeviceIdentity,
) -> VaultResult<LoadedVault> {
    let format = VaultError::from_vault_format(detect_stored_format(content))?;
    let stored_records = VaultError::from_vault_format(deserialize_stored(content, format))?;
    let secrets_key =
        VaultError::from_multi_device(resolve_secrets_key(&stored_records, identity))?;
    let members_key =
        VaultError::from_multi_device(resolve_members_key(&stored_records, identity))?;
    let crypto = VaultError::from_crypto(VaultCrypto::new(&secrets_key))?;
    let mut armored = HashMap::with_capacity(stored_records.len());
    for record in &stored_records {
        armored.insert(record.key.clone(), record.value.clone());
    }
    let user_records = user_stored_records(&stored_records);
    let db = VaultError::from_database(Database::from_stored_records_with_crypto(
        &user_records,
        &crypto,
    ))?;
    let jsonl = VaultError::from_database(db.to_jsonl())?;
    let secret_types = records_to_secret_types(&stored_records);
    Ok(LoadedVault {
        jsonl,
        armored,
        secret_types,
        secrets_key,
        members_key,
    })
}

/// Replace member roster rows in an armored cache map.
#[allow(clippy::implicit_hasher)]
pub fn apply_member_records(
    armored: &mut HashMap<String, String>,
    member_records: &[StoredSecretRecord],
) {
    armored.retain(|key, _| !key.starts_with(crate::MEMBER_RECORD_PREFIX));
    for record in member_records {
        armored.insert(record.key.clone(), record.value.clone());
    }
}

/// Read unlock metadata from vault YAML without decrypting secrets.
pub fn capture_vault_unlock_from_content(
    content: &str,
) -> VaultResult<(VaultUnlock, Vec<crate::PasswordUnlockEntry>, Option<String>, u64)> {
    let unlock = crate::read_vault_unlock(content).unwrap_or(VaultUnlock::Keys);
    let password_entries = crate::read_vault_password_entries(content).unwrap_or_default();
    let store_id = crate::read_vault_store_id(content).ok().flatten();
    let version = crate::read_vault_version(content).unwrap_or(0);
    Ok((unlock, password_entries, store_id, version))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        VaultResult, generate_store_id, generate_vault_keys, genesis_auth_record,
        genesis_members_records, serialize_stored_yaml_with_unlock,
    };

    #[test]
    fn empty_content_requires_genesis() -> VaultResult<()> {
        assert!(content_requires_genesis("", false)?);
        assert!(content_requires_genesis("  ", false)?);
        Ok(())
    }

    #[test]
    fn genesis_yaml_reports_ready_for_enrolled_device() -> VaultResult<()> {
        let keys = VaultError::from_multi_device(generate_vault_keys())?;
        let identity = VaultError::from_multi_device(DeviceIdentity::generate())?;
        let mut records = vec![VaultError::from_multi_device(genesis_auth_record(
            &identity,
            &keys.secrets_key,
            &keys.members_key,
        ))?];
        records.extend(VaultError::from_multi_device(genesis_members_records(
            &identity,
            &keys.members_key,
            "2026-06-28T00:00:00Z",
        ))?);
        let yaml = VaultError::from_vault_format(serialize_stored_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(&VaultError::from_multi_device(generate_store_id())?),
            None,
        ))?;
        assert!(!content_requires_genesis(&yaml, false)?);
        assert_eq!(access_status_for_vault_content(&yaml, &identity)?, "ready");
        let loaded = load_stored_vault(&yaml, &identity)?;
        assert_eq!(loaded.secrets_key, keys.secrets_key);
        assert!(loaded.jsonl.is_empty() || loaded.armored.len() >= 2);
        Ok(())
    }
}
