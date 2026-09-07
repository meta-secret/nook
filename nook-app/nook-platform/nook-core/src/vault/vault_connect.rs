//! Connect-time vault assessment and session hydration from stored YAML.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{DatabaseError, MultiDeviceError, VaultMetaRecord, VaultName, VaultStoreIdentity};

use crate::errors::{self, VaultResult};
use crate::{
    ConnectAccessStatus, Database, DeviceIdentity, StoredSecretRecord, VaultArchitecture,
    VaultCrypto, VaultMetaState, VaultType, VaultUnlock, assess_connect_access, deserialize_stored,
    detect_stored_format, resolve_members_key, resolve_secrets_key, user_stored_records,
    vault_has_multi_device_records,
};
use std::fmt;
use wasm_bindgen::prelude::wasm_bindgen;

/// Connect pre-flight status shared by every host adapter.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultAccessStatus {
    NewVault,
    Ready,
    NeedsEnrollment,
    JoinPending,
    /// The selected remote provider has no vault and no usable local cache.
    RemoteMissing,
    /// The selected remote provider has no vault, but a local recovery cache exists.
    RemoteMissingLocalCache,
}

impl VaultAccessStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NewVault => "new_vault",
            Self::Ready => "ready",
            Self::NeedsEnrollment => "needs_enrollment",
            Self::JoinPending => "join_pending",
            Self::RemoteMissing => "remote_missing",
            Self::RemoteMissingLocalCache => "remote_missing_local_cache",
        }
    }
}

impl fmt::Display for VaultAccessStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl From<ConnectAccessStatus> for VaultAccessStatus {
    fn from(status: ConnectAccessStatus) -> Self {
        match status {
            ConnectAccessStatus::Ready => Self::Ready,
            ConnectAccessStatus::NeedsEnrollment => Self::NeedsEnrollment,
            ConnectAccessStatus::JoinPending => Self::JoinPending,
        }
    }
}

/// Decrypted session material loaded from a stored vault blob.
pub struct LoadedVault {
    pub database: Database,
    pub meta: VaultMetaState,
    pub secrets_key: crate::SymmetricKey,
    pub members_key: crate::SymmetricKey,
}

/// Unlocked vault material without a hydrated plaintext secret database.
pub struct UnlockedVault {
    pub meta: VaultMetaState,
    pub secrets_key: crate::SymmetricKey,
    pub members_key: crate::SymmetricKey,
}

/// Non-secret top-level YAML metadata captured without decrypting records.
pub struct VaultContentMetadata {
    pub unlock: VaultUnlock,
    pub password_entries: Vec<crate::PasswordUnlockEntry>,
    pub store_id: String,
    pub vault_name: String,
    pub version: crate::VaultVersion,
    pub architecture: VaultArchitecture,
}

/// Borrowed stored vault content awaiting a connect action.
pub struct VaultContent<'a> {
    content: &'a str,
}

impl<'a> VaultContent<'a> {
    #[must_use]
    pub fn new(content: &'a str) -> Self {
        Self { content }
    }

    /// Whether connect should bootstrap a genesis vault for this content.
    pub fn requires_genesis(&self, force_genesis: bool) -> VaultResult<bool> {
        if force_genesis || self.content.trim().is_empty() {
            return Ok(true);
        }
        let format = detect_stored_format(self.content)?;
        let records = deserialize_stored(self.content, format)?;
        Ok(!vault_has_multi_device_records(&records)?)
    }

    /// Pre-flight connect status tag for the web layer.
    pub fn access_status(&self, identity: &DeviceIdentity) -> VaultResult<VaultAccessStatus> {
        if self.content.trim().is_empty() {
            return Ok(VaultAccessStatus::NewVault);
        }
        let format = detect_stored_format(self.content)?;
        let records = deserialize_stored(self.content, format)?;
        if !vault_has_multi_device_records(&records)? {
            return Ok(VaultAccessStatus::NewVault);
        }
        Ok(assess_connect_access(&records, identity)?.into())
    }

    /// Read unlock metadata without decrypting secrets.
    pub fn capture_unlock(&self) -> VaultResult<VaultContentMetadata> {
        let unlock = crate::read_vault_unlock(self.content)?;
        let password_entries = crate::read_vault_password_entries(self.content)?;
        let store_id = match crate::read_vault_store_id(self.content)? {
            VaultStoreIdentity::Assigned(store_id) => store_id,
            VaultStoreIdentity::Unassigned => {
                return Err(errors::VaultFormatError::YamlMissingSections.into());
            }
        };
        let vault_name = match crate::read_vault_name(self.content)? {
            VaultName::Named(name) => name,
            VaultName::Unnamed => crate::default_vault_name_for_store_id(&store_id),
        };
        let version = crate::read_vault_version(self.content).unwrap_or_default();
        let architecture = crate::read_vault_architecture(self.content)?;
        Ok(VaultContentMetadata {
            unlock,
            password_entries,
            store_id,
            vault_name,
            version,
            architecture,
        })
    }

    /// Resolve keys and retain encrypted records without decrypting user items.
    pub fn unlock(self, identity: &DeviceIdentity) -> VaultResult<UnlockedVault> {
        let format = detect_stored_format(self.content)?;
        let architecture = crate::read_vault_architecture(self.content)?;
        if architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelCeremonyRequired.into());
        }
        let stored_records = deserialize_stored(self.content, format)?;
        Self::validate_user_secret_types(&stored_records)?;
        let secrets_key = resolve_secrets_key(&stored_records, identity)?;
        let members_key = resolve_members_key(&stored_records, identity)?;
        Ok(UnlockedVault {
            meta: VaultMetaState::from_stored_records(&stored_records)?,
            secrets_key,
            members_key,
        })
    }

    /// Decrypt and hydrate an in-memory session from stored vault YAML.
    ///
    /// Sentinel vaults never unlock through per-device auth envelopes. A
    /// single identity is never enough for the default 2-of-N policy; use
    /// [`Self::load_sentinel`] when enough participant identities are available.
    pub fn load(self, identity: &DeviceIdentity) -> VaultResult<LoadedVault> {
        self.unlock(identity)?.hydrate()
    }

    /// Reconstruct a sentinel vault when participant identities can open their
    /// encrypted shares locally. Browser unlock uses opened-share contributions.
    pub fn load_sentinel(self, identities: &[DeviceIdentity]) -> VaultResult<LoadedVault> {
        let stored_records = self.sentinel_records()?;
        let keys = crate::SentinelKeyReconstruction::from_identities(&stored_records, identities)
            .reconstruct()?;
        UnlockedVault {
            meta: VaultMetaState::from_stored_records(&stored_records)?,
            secrets_key: keys.secrets_key,
            members_key: keys.members_key,
        }
        .hydrate()
    }

    /// Reconstruct a sentinel vault from opened-share ceremony contributions.
    pub fn load_sentinel_from_opened(
        self,
        opened: &[crate::OpenedSentinelShare],
    ) -> VaultResult<LoadedVault> {
        let stored_records = self.sentinel_records()?;
        let keys =
            crate::SentinelKeyReconstruction::from_opened(&stored_records, opened).reconstruct()?;
        UnlockedVault {
            meta: VaultMetaState::from_stored_records(&stored_records)?,
            secrets_key: keys.secrets_key,
            members_key: keys.members_key,
        }
        .hydrate()
    }

    fn sentinel_records(&self) -> VaultResult<Vec<StoredSecretRecord>> {
        let format = detect_stored_format(self.content)?;
        let architecture = crate::read_vault_architecture(self.content)?;
        if architecture.vault_type != VaultType::Sentinel {
            return Err(MultiDeviceError::InvalidSentinelThreshold.into());
        }
        let stored_records = deserialize_stored(self.content, format)?;
        Self::validate_user_secret_types(&stored_records)?;
        architecture.validate_records(&stored_records)?;
        Ok(stored_records)
    }

    fn validate_user_secret_types(records: &[StoredSecretRecord]) -> VaultResult<()> {
        for record in records {
            if record.secret_type.is_none()
                && matches!(
                    VaultMetaRecord::classify(record)?,
                    VaultMetaRecord::Secret(..)
                )
            {
                return Err(DatabaseError::MissingSecretType {
                    key: record.key.clone(),
                }
                .into());
            }
        }
        Ok(())
    }
}

impl UnlockedVault {
    /// Consume resolved keys into a hydrated plaintext session database.
    pub fn hydrate(self) -> VaultResult<LoadedVault> {
        let crypto = VaultCrypto::new(&self.secrets_key)?;
        let user_records = user_stored_records(&self.meta.to_stored_records())?;
        let db = Database::from_stored_records_with_crypto(&user_records, &crypto)?;
        Ok(LoadedVault {
            database: db,
            meta: self.meta,
            secrets_key: self.secrets_key,
            members_key: self.members_key,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        DatabaseError, SecretId, SentinelConfiguration, StoredRecordPayload, ValidationError,
        VaultError, VaultFormatError, VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite,
    };

    use super::*;
    use crate::test_support;

    #[test]
    fn vault_access_status_labels_are_stable_across_host_bindings() {
        assert_eq!(VaultAccessStatus::NewVault.as_str(), "new_vault");
        assert_eq!(VaultAccessStatus::Ready.as_str(), "ready");
        assert_eq!(
            VaultAccessStatus::NeedsEnrollment.as_str(),
            "needs_enrollment"
        );
        assert_eq!(VaultAccessStatus::JoinPending.as_str(), "join_pending");
        assert_eq!(VaultAccessStatus::RemoteMissing.as_str(), "remote_missing");
        assert_eq!(
            VaultAccessStatus::RemoteMissingLocalCache.as_str(),
            "remote_missing_local_cache"
        );
    }
    use crate::{
        DeviceMode, ReplicationType, SentinelPolicy, VaultResult, generate_store_id,
        generate_vault_keys, genesis_auth_record,
        serialize_stored_yaml_with_unlock_name_architecture,
    };

    #[test]
    fn encrypted_unlock_rejects_user_rows_without_a_secret_type() -> anyhow::Result<()> {
        let record = StoredSecretRecord {
            key: SecretId::from_vault_record("secret_missing_type"),
            secret_type: None,
            value: StoredRecordPayload::from_trusted(
                "-----BEGIN AGE ENCRYPTED FILE-----\ninvalid".to_owned(),
            ),
        };

        let error = VaultContent::validate_user_secret_types(&[record])
            .err()
            .ok_or_else(|| anyhow::anyhow!("vault connect test should reject invalid input"))?;

        assert!(matches!(
            error,
            VaultError::Database(DatabaseError::MissingSecretType { .. })
        ));
        Ok(())
    }

    #[test]
    fn empty_content_requires_genesis() -> VaultResult<()> {
        assert!(VaultContent::new("").requires_genesis(false)?);
        assert!(VaultContent::new("  ").requires_genesis(false)?);
        Ok(())
    }

    #[test]
    fn capture_rejects_unsupported_password_envelope_version() -> anyhow::Result<()> {
        let content = "schema_version: 1\nstore_id: store_testtoken11\npassword_entries:\n  - id: pwdentry001\n    label: Recovery\n    created_at: 2026-06-23T00:00:00Z\n    envelope:\n      version: 3\n      kdf: scrypt\n      work_factor: 18\n      ciphertext: invalid\n";
        let error = VaultContent::new(content)
            .capture_unlock()
            .err()
            .ok_or_else(|| anyhow::anyhow!("vault metadata capture must reject version 3"))?;

        assert!(matches!(
            error,
            VaultError::VaultFormat(VaultFormatError::YamlParseUnlock(_))
        ));
        Ok(())
    }

    #[test]
    fn genesis_yaml_reports_ready_for_enrolled_device() -> VaultResult<()> {
        let (keys, identity, yaml) = test_support::simple_genesis_projection()?;
        assert!(!VaultContent::new(yaml.as_str()).requires_genesis(false)?);
        assert_eq!(
            VaultContent::new(yaml.as_str()).access_status(&identity)?,
            VaultAccessStatus::Ready
        );
        let loaded = VaultContent::new(yaml.as_str()).load(&identity)?;
        assert_eq!(loaded.secrets_key, keys.secrets_key);
        assert!(loaded.database.list().is_empty());
        assert!(loaded.meta.auth.len() + loaded.meta.members.len() >= 2);
        Ok(())
    }

    #[test]
    fn sentinel_yaml_rejects_full_device_key_envelopes_before_write() -> anyhow::Result<()> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let records = vec![genesis_auth_record(
            &identity,
            &keys.secrets_key,
            &keys.members_key,
        )?];
        let architecture = VaultArchitecture {
            device_mode: DeviceMode::Standard,
            vault_type: VaultType::Sentinel,
            replication_type: ReplicationType::Personal,
            sentinel: SentinelConfiguration::Enabled(SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 2.into(),
            }),
        };
        let store_id = generate_store_id()?;
        let error = serialize_stored_yaml_with_unlock_name_architecture(
            &records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned(store_id.as_str()),
            VaultNameRef::Unnamed,
            VaultVersionWrite::Initial,
            &architecture,
        )
        .err()
        .ok_or_else(|| anyhow::anyhow!("vault connect test should reject invalid input"))?;

        assert!(matches!(
            error,
            VaultFormatError::Validation(ValidationError::SentinelVaultHasFullKeyEnvelopes)
        ));
        assert!(
            VaultContent::new(
                "schema_version: 1\nstore_id: store_testtoken11\narchitecture:\n  device_mode: standard\n  vault_type: sentinel\n  replication_type: personal\n  sentinel:\n    threshold: 2\n    required_participants: 2\n    ready_participants: 0\nsecrets: []\n",
            )
            .load(&identity)
            .is_err(),
            "sentinel vault must reject ordinary single-device unlock even before shares exist"
        );
        Ok(())
    }

    #[test]
    fn sentinel_yaml_reconstructs_with_threshold_identities() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let third = DeviceIdentity::generate()?;
        let records = crate::create_sentinel_share_records(
            &keys,
            &[first.clone(), second.clone(), third],
            2.into(),
        )?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2.into(),
                required_participants: 3.into(),
                ready_participants: 3.into(),
            },
        );
        let store_id = generate_store_id()?;
        let yaml = serialize_stored_yaml_with_unlock_name_architecture(
            &records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned(store_id.as_str()),
            VaultNameRef::Unnamed,
            VaultVersionWrite::Initial,
            &architecture,
        )?;

        assert!(VaultContent::new(yaml.as_str()).load(&first).is_err());
        let loaded = VaultContent::new(yaml.as_str()).load_sentinel(&[first, second])?;
        assert_eq!(loaded.secrets_key, keys.secrets_key);
        assert_eq!(loaded.members_key, keys.members_key);
        assert_eq!(loaded.meta.sentinel_shares.len(), 3);
        Ok(())
    }
}
