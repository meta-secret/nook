//! YAML vault poll reconciliation for an active unlocked session.

use crate::{
    DeviceIdentity, VaultUnlock, capture_vault_unlock_from_content, load_stored_vault,
    merge_remote_join_records,
};
use std::collections::HashMap;

/// Outcome of comparing remote YAML against the last synced snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YamlSyncOutcome {
    Unchanged,
    NewVault,
    AccessStatus(String),
    Reloaded(Box<YamlSyncReloaded>),
}

/// Session fields reloaded from remote YAML.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YamlSyncReloaded {
    pub jsonl: String,
    pub armored: HashMap<String, String>,
    pub secret_types: HashMap<String, crate::SecretType>,
    pub secrets_key: String,
    pub members_key: String,
    pub unlock: VaultUnlock,
    pub password_entries: Vec<crate::PasswordUnlockEntry>,
    pub store_id: Option<String>,
    pub version: u64,
}

/// Decide how to update session state when remote YAML changes (legacy blob sync path).
#[allow(clippy::implicit_hasher)]
pub fn reconcile_yaml_sync(
    content: &str,
    last_synced_content: &str,
    members_key: &str,
    identity: &DeviceIdentity,
    armored: &mut HashMap<String, String>,
    event_log_mode: bool,
) -> Result<YamlSyncOutcome, String> {
    if content.trim() == last_synced_content.trim() {
        if members_key.is_empty() {
            if event_log_mode && !content.trim().is_empty() {
                let loaded = load_stored_vault(content, identity)?;
                return Ok(YamlSyncOutcome::Reloaded(Box::new(YamlSyncReloaded {
                    jsonl: loaded.jsonl,
                    armored: loaded.armored,
                    secret_types: loaded.secret_types,
                    secrets_key: loaded.secrets_key,
                    members_key: loaded.members_key,
                    unlock: VaultUnlock::Keys,
                    password_entries: Vec::new(),
                    store_id: None,
                    version: 0,
                })));
            }
            return Ok(YamlSyncOutcome::Unchanged);
        }
        return Ok(YamlSyncOutcome::Unchanged);
    }

    if content.trim().is_empty() {
        return Ok(YamlSyncOutcome::NewVault);
    }

    if members_key.is_empty() {
        let status = crate::access_status_for_vault_content(content, identity)?;
        return Ok(YamlSyncOutcome::AccessStatus(status));
    }

    let format = crate::detect_stored_format(content)?;
    let fresh_records = crate::deserialize_stored(content, format)?;
    merge_remote_join_records(armored, &fresh_records);
    let loaded = load_stored_vault(content, identity)?;
    let (unlock, password_entries, store_id, version) =
        capture_vault_unlock_from_content(content)?;
    Ok(YamlSyncOutcome::Reloaded(Box::new(YamlSyncReloaded {
        jsonl: loaded.jsonl,
        armored: loaded.armored,
        secret_types: loaded.secret_types,
        secrets_key: loaded.secrets_key,
        members_key: loaded.members_key,
        unlock,
        password_entries,
        store_id,
        version,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        VaultKeys, generate_store_id, generate_vault_keys, genesis_auth_record,
        genesis_members_records, serialize_stored_yaml_with_unlock,
    };

    fn genesis_yaml(keys: &VaultKeys, identity: &DeviceIdentity) -> Result<String, String> {
        let mut records = vec![genesis_auth_record(identity, &keys.secrets_key, &keys.members_key)?];
        records.extend(genesis_members_records(identity, &keys.members_key, "2026-06-28T00:00:00Z")?);
        serialize_stored_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(&generate_store_id()?),
            None,
        )
    }

    #[test]
    fn unchanged_when_content_matches_and_keys_present() -> Result<(), String> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let yaml = genesis_yaml(&keys, &identity)?;
        let mut armored = HashMap::new();
        let outcome = reconcile_yaml_sync(&yaml, &yaml, &keys.members_key, &identity, &mut armored, false)?;
        assert_eq!(outcome, YamlSyncOutcome::Unchanged);
        Ok(())
    }

    #[test]
    fn event_log_mode_rehydrates_when_keys_missing_but_cache_present() -> Result<(), String> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let yaml = genesis_yaml(&keys, &identity)?;
        let mut armored = HashMap::new();
        let outcome = reconcile_yaml_sync(&yaml, &yaml, "", &identity, &mut armored, true)?;
        match outcome {
            YamlSyncOutcome::Reloaded(reloaded) => {
                assert_eq!(reloaded.secrets_key, keys.secrets_key);
                assert_eq!(reloaded.members_key, keys.members_key);
            }
            other => {
                return Err(format!("expected Reloaded, got {other:?}"));
            }
        }
        Ok(())
    }
}
