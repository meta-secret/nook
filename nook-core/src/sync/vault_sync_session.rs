//! YAML vault poll reconciliation for an active unlocked session.

use crate::errors::VaultResult;
use crate::vault_connect::VaultAccessStatus;
use crate::{
    Database, DeviceIdentity, VaultMetaState, VaultUnlock, capture_vault_unlock_from_content,
    load_stored_vault, merge_remote_join_records,
};

/// Outcome of comparing remote YAML against the last synced snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YamlSyncOutcome {
    Unchanged,
    NewVault,
    AccessStatus(VaultAccessStatus),
    Reloaded(Box<YamlSyncReloaded>),
}

/// Session fields reloaded from remote YAML.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YamlSyncReloaded {
    pub database: Database,
    pub meta: VaultMetaState,
    pub secrets_key: crate::SymmetricKey,
    pub members_key: crate::SymmetricKey,
    pub unlock: VaultUnlock,
    pub password_entries: Vec<crate::PasswordUnlockEntry>,
    pub store_id: String,
    pub vault_name: String,
    pub version: u64,
}

/// Decide how to update session state when remote YAML changes (legacy blob sync path).
pub fn reconcile_yaml_sync(
    content: &str,
    last_synced_content: &str,
    members_key: &str,
    identity: &DeviceIdentity,
    state: &mut VaultMetaState,
    event_log_mode: bool,
) -> VaultResult<YamlSyncOutcome> {
    if content.trim() == last_synced_content.trim() {
        if members_key.is_empty() {
            if event_log_mode && !content.trim().is_empty() {
                let loaded = load_stored_vault(content, identity)?;
                let metadata = capture_vault_unlock_from_content(content)?;
                return Ok(YamlSyncOutcome::Reloaded(Box::new(YamlSyncReloaded {
                    database: loaded.database,
                    meta: loaded.meta,
                    secrets_key: loaded.secrets_key,
                    members_key: loaded.members_key,
                    unlock: metadata.unlock,
                    password_entries: metadata.password_entries,
                    store_id: metadata.store_id,
                    vault_name: metadata.vault_name,
                    version: metadata.version,
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
    merge_remote_join_records(state, &fresh_records);
    let loaded = load_stored_vault(content, identity)?;
    let metadata = capture_vault_unlock_from_content(content)?;
    Ok(YamlSyncOutcome::Reloaded(Box::new(YamlSyncReloaded {
        database: loaded.database,
        meta: loaded.meta,
        secrets_key: loaded.secrets_key,
        members_key: loaded.members_key,
        unlock: metadata.unlock,
        password_entries: metadata.password_entries,
        store_id: metadata.store_id,
        vault_name: metadata.vault_name,
        version: metadata.version,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        PasswordEnvelope, PasswordUnlockEntry, VaultKeys, VaultResult, generate_store_id,
        generate_vault_keys, genesis_auth_record, genesis_members_records,
        serialize_stored_yaml_with_unlock, serialize_stored_yaml_with_unlock_and_name,
    };

    fn genesis_yaml(
        keys: &VaultKeys,
        identity: &DeviceIdentity,
    ) -> VaultResult<crate::StoredVaultYaml> {
        let mut records = vec![genesis_auth_record(
            identity,
            &keys.secrets_key,
            &keys.members_key,
        )?];
        records.extend(genesis_members_records(
            identity,
            &keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        let store_id = generate_store_id()?;
        serialize_stored_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(store_id.as_str()),
            None,
        )
        .map_err(Into::into)
    }

    fn password_entry(id: &str) -> PasswordUnlockEntry {
        PasswordUnlockEntry {
            id: id.to_owned(),
            label: "Backup password".to_owned(),
            created_at: "2026-06-28T00:00:00Z".to_owned(),
            envelope: PasswordEnvelope {
                version: 1,
                kdf: "argon2id".to_owned(),
                work_factor: 3,
                ciphertext: "AGE-ENCRYPTED-KEYS".to_owned(),
            },
        }
    }

    #[test]
    fn unchanged_when_content_matches_and_keys_present() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let yaml = genesis_yaml(&keys, &identity)?;
        let yaml_str = yaml.as_str();
        let mut state = VaultMetaState::default();
        let outcome = reconcile_yaml_sync(
            yaml_str,
            yaml_str,
            keys.members_key.as_str(),
            &identity,
            &mut state,
            false,
        )?;
        assert_eq!(outcome, YamlSyncOutcome::Unchanged);
        Ok(())
    }

    #[test]
    fn event_log_mode_rehydrates_when_keys_missing_but_cache_present() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let password_entries = vec![password_entry("backup-password")];
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
        let store_id = generate_store_id()?;
        let yaml = serialize_stored_yaml_with_unlock_and_name(
            &records,
            &VaultUnlock::Passwords {
                entries: password_entries.clone(),
            },
            &password_entries,
            Some(store_id.as_str()),
            Some("Team Vault"),
            Some(42),
        )?;
        let mut state = VaultMetaState::default();
        let outcome = reconcile_yaml_sync(
            yaml.as_str(),
            yaml.as_str(),
            "",
            &identity,
            &mut state,
            true,
        )?;
        match outcome {
            YamlSyncOutcome::Reloaded(reloaded) => {
                assert_eq!(reloaded.secrets_key.as_str(), keys.secrets_key.as_str());
                assert_eq!(reloaded.members_key.as_str(), keys.members_key.as_str());
                assert_eq!(reloaded.unlock, VaultUnlock::Keys);
                assert_eq!(reloaded.password_entries, password_entries);
                assert_eq!(reloaded.store_id, store_id.as_str());
                assert_eq!(reloaded.vault_name, "Team Vault");
                assert_eq!(reloaded.version, 42);
            }
            other => {
                return Err(crate::errors::EventError::UnexpectedYamlSyncOutcome {
                    outcome: format!("{other:?}"),
                }
                .into());
            }
        }
        Ok(())
    }
}
