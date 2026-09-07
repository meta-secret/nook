//! YAML vault poll reconciliation for an active unlocked session.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::VaultResult;
use crate::vault_connect::VaultAccessStatus;
use crate::{Database, DeviceIdentity, VaultContent, VaultMetaState, VaultUnlock};

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
    pub version: crate::VaultVersion,
}

/// Borrowed legacy YAML and active session state awaiting one reconciliation action.
pub struct YamlSyncSession<'a> {
    content: &'a str,
    last_synced_content: &'a str,
    members_key: &'a str,
    identity: &'a DeviceIdentity,
    state: &'a mut VaultMetaState,
    event_log_mode: bool,
}

impl<'a> YamlSyncSession<'a> {
    #[must_use]
    pub fn new(
        content: &'a str,
        last_synced_content: &'a str,
        members_key: &'a str,
        identity: &'a DeviceIdentity,
        state: &'a mut VaultMetaState,
        event_log_mode: bool,
    ) -> Self {
        Self {
            content,
            last_synced_content,
            members_key,
            identity,
            state,
            event_log_mode,
        }
    }

    /// Consume the session into the correct unchanged, access, new-vault, or reload outcome.
    pub fn reconcile(self) -> VaultResult<YamlSyncOutcome> {
        if self.content.trim() == self.last_synced_content.trim() {
            if self.members_key.is_empty() && self.event_log_mode && !self.content.trim().is_empty()
            {
                return Ok(YamlSyncOutcome::Reloaded(Box::new(self.reload()?)));
            }
            return Ok(YamlSyncOutcome::Unchanged);
        }

        if self.content.trim().is_empty() {
            return Ok(YamlSyncOutcome::NewVault);
        }

        if self.members_key.is_empty() {
            let status = VaultContent::new(self.content).access_status(self.identity)?;
            return Ok(YamlSyncOutcome::AccessStatus(status));
        }

        let format = crate::VaultFormatDocument::new(self.content).detect()?;
        let fresh_records = crate::VaultFormatDocument::new(self.content).deserialize(format)?;
        self.state.replace_join_records(&fresh_records)?;
        Ok(YamlSyncOutcome::Reloaded(Box::new(self.reload()?)))
    }

    fn reload(&self) -> VaultResult<YamlSyncReloaded> {
        let loaded = VaultContent::new(self.content).load(self.identity)?;
        let metadata = VaultContent::new(self.content).capture_unlock()?;
        Ok(YamlSyncReloaded {
            database: loaded.database,
            meta: loaded.meta,
            secrets_key: loaded.secrets_key,
            members_key: loaded.members_key,
            unlock: metadata.unlock,
            password_entries: metadata.password_entries,
            store_id: metadata.store_id,
            vault_name: metadata.vault_name,
            version: metadata.version,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::{VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite};

    use super::*;
    use crate::errors;
    use crate::{
        PasswordEnvelope, PasswordUnlockEntry, StoreId, VaultKeys, VaultRecordSet, VaultResult,
        genesis_members_records,
    };

    struct YamlSyncTestData;

    impl YamlSyncTestData {
        fn genesis_yaml(
            keys: &VaultKeys,
            identity: &DeviceIdentity,
        ) -> VaultResult<crate::StoredVaultYaml> {
            let mut records = vec![identity.auth_record(&keys.secrets_key, &keys.members_key)?];
            records.extend(genesis_members_records(
                identity,
                &keys.members_key,
                "2026-06-28T00:00:00Z",
            )?);
            let store_id = StoreId::generate()?;
            VaultRecordSet::serialize_yaml_with_unlock(
                &records,
                &VaultUnlock::Keys,
                &[],
                VaultStoreIdentityRef::Assigned(store_id.as_str()),
                VaultVersionWrite::Initial,
            )
            .map_err(Into::into)
        }

        fn password_entry(id: &str) -> PasswordUnlockEntry {
            PasswordUnlockEntry {
                id: id.to_owned(),
                label: "Backup password".to_owned(),
                created_at: "2026-06-28T00:00:00Z".to_owned(),
                envelope: PasswordEnvelope {
                    version: crate::PasswordEnvelopeVersion::LEGACY,
                    kdf: "argon2id".to_owned(),
                    work_factor: 3.into(),
                    recipient: String::new(),
                    wrapped_keys: String::new(),
                    ciphertext: "AGE-ENCRYPTED-KEYS".to_owned(),
                },
            }
        }
    }

    #[test]
    fn unchanged_when_content_matches_and_keys_present() -> VaultResult<()> {
        let keys = VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let yaml = YamlSyncTestData::genesis_yaml(&keys, &identity)?;
        let yaml_str = yaml.as_str();
        let mut state = VaultMetaState::default();
        let outcome = YamlSyncSession::new(
            yaml_str,
            yaml_str,
            keys.members_key.as_str(),
            &identity,
            &mut state,
            false,
        )
        .reconcile()?;
        assert_eq!(outcome, YamlSyncOutcome::Unchanged);
        Ok(())
    }

    #[test]
    fn event_log_mode_rehydrates_when_keys_missing_but_cache_present() -> VaultResult<()> {
        let keys = VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let password_entries = vec![YamlSyncTestData::password_entry("backup-password")];
        let mut records = vec![identity.auth_record(&keys.secrets_key, &keys.members_key)?];
        records.extend(genesis_members_records(
            &identity,
            &keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        let store_id = StoreId::generate()?;
        let yaml = VaultRecordSet::serialize_yaml_with_unlock_and_name(
            &records,
            &VaultUnlock::Passwords {
                entries: password_entries.clone(),
            },
            &password_entries,
            VaultStoreIdentityRef::Assigned(store_id.as_str()),
            VaultNameRef::Named("Team Vault"),
            VaultVersionWrite::Version(42.into()),
        )?;
        let mut state = VaultMetaState::default();
        let outcome = YamlSyncSession::new(
            yaml.as_str(),
            yaml.as_str(),
            "",
            &identity,
            &mut state,
            true,
        )
        .reconcile()?;
        match outcome {
            YamlSyncOutcome::Reloaded(reloaded) => {
                assert_eq!(reloaded.secrets_key.as_str(), keys.secrets_key.as_str());
                assert_eq!(reloaded.members_key.as_str(), keys.members_key.as_str());
                assert_eq!(reloaded.unlock, VaultUnlock::Keys);
                assert_eq!(reloaded.password_entries, password_entries);
                assert_eq!(reloaded.store_id, store_id.as_str());
                assert_eq!(reloaded.vault_name, "Team Vault");
                assert_eq!(u64::from(reloaded.version), 42);
            }
            other => {
                return Err(errors::VaultSyncError::UnexpectedYamlSyncOutcome {
                    outcome: format!("{other:?}"),
                }
                .into());
            }
        }
        Ok(())
    }
}
