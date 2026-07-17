//! Connect-time vault assessment and session hydration from stored YAML.

use crate::errors::VaultResult;
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
    pub version: u64,
    pub architecture: VaultArchitecture,
}

/// Whether connect should bootstrap a genesis vault for this content.
pub fn content_requires_genesis(content: &str, force_genesis: bool) -> VaultResult<bool> {
    if force_genesis {
        return Ok(true);
    }
    if content.trim().is_empty() {
        return Ok(true);
    }
    let format = detect_stored_format(content)?;
    let records = deserialize_stored(content, format)?;
    Ok(!vault_has_multi_device_records(&records))
}

/// Pre-flight connect status tag for the web layer.
pub fn access_status_for_vault_content(
    content: &str,
    identity: &DeviceIdentity,
) -> VaultResult<VaultAccessStatus> {
    if content.trim().is_empty() {
        return Ok(VaultAccessStatus::NewVault);
    }
    let format = detect_stored_format(content)?;
    let records = deserialize_stored(content, format)?;
    if !vault_has_multi_device_records(&records) {
        return Ok(VaultAccessStatus::NewVault);
    }
    Ok(assess_connect_access(&records, identity).into())
}

/// Decrypt and hydrate an in-memory session from stored vault YAML.
///
/// Sentinel vaults never unlock through per-device auth envelopes. A single
/// identity is never enough for the default 2-of-N policy; use
/// [`load_sentinel_vault`] when enough participant identities are available.
pub fn load_stored_vault(content: &str, identity: &DeviceIdentity) -> VaultResult<LoadedVault> {
    let unlocked = unlock_stored_vault(content, identity)?;
    hydrate_loaded_vault(unlocked)
}

/// Resolve vault keys and retain encrypted records without decrypting user items.
pub fn unlock_stored_vault(content: &str, identity: &DeviceIdentity) -> VaultResult<UnlockedVault> {
    let format = detect_stored_format(content)?;
    let architecture = crate::read_vault_architecture(content)?;
    if architecture.vault_type == VaultType::Sentinel {
        return Err(crate::MultiDeviceError::SentinelCeremonyRequired.into());
    }
    let stored_records = deserialize_stored(content, format)?;
    validate_user_secret_types(&stored_records)?;
    let secrets_key = resolve_secrets_key(&stored_records, identity)?;
    let members_key = resolve_members_key(&stored_records, identity)?;
    Ok(UnlockedVault {
        meta: VaultMetaState::from_stored_records(&stored_records),
        secrets_key,
        members_key,
    })
}

fn validate_user_secret_types(records: &[StoredSecretRecord]) -> VaultResult<()> {
    for record in records {
        if record.secret_type.is_none()
            && matches!(
                crate::VaultMetaRecord::classify(record),
                crate::VaultMetaRecord::Secret(..)
            )
        {
            return Err(crate::DatabaseError::MissingSecretType {
                key: record.key.clone(),
            }
            .into());
        }
    }
    Ok(())
}

/// Native/test helper: reconstruct a sentinel vault when enough participant
/// identities can open their encrypted shares locally.
///
/// Browser unlock must not collect peer identities. Use
/// [`crate::open_sentinel_share_for_identity`] on each device and
/// [`load_sentinel_vault_from_opened`] on the reconstructing device.
pub fn load_sentinel_vault(
    content: &str,
    identities: &[DeviceIdentity],
) -> VaultResult<LoadedVault> {
    let format = detect_stored_format(content)?;
    let architecture = crate::read_vault_architecture(content)?;
    if architecture.vault_type != VaultType::Sentinel {
        return Err(crate::MultiDeviceError::InvalidSentinelThreshold.into());
    }
    let stored_records = deserialize_stored(content, format)?;
    validate_user_secret_types(&stored_records)?;
    architecture.validate_records(&stored_records)?;
    let keys = crate::reconstruct_sentinel_vault_keys(&stored_records, identities)?;
    hydrate_loaded_vault(UnlockedVault {
        meta: VaultMetaState::from_stored_records(&stored_records),
        secrets_key: keys.secrets_key,
        members_key: keys.members_key,
    })
}

/// Reconstruct a sentinel vault session from opened-share ceremony contributions.
pub fn load_sentinel_vault_from_opened(
    content: &str,
    opened: &[crate::OpenedSentinelShare],
) -> VaultResult<LoadedVault> {
    let format = detect_stored_format(content)?;
    let architecture = crate::read_vault_architecture(content)?;
    if architecture.vault_type != VaultType::Sentinel {
        return Err(crate::MultiDeviceError::InvalidSentinelThreshold.into());
    }
    let stored_records = deserialize_stored(content, format)?;
    validate_user_secret_types(&stored_records)?;
    architecture.validate_records(&stored_records)?;
    let keys = crate::reconstruct_sentinel_vault_keys_from_opened(&stored_records, opened)?;
    hydrate_loaded_vault(UnlockedVault {
        meta: VaultMetaState::from_stored_records(&stored_records),
        secrets_key: keys.secrets_key,
        members_key: keys.members_key,
    })
}

fn hydrate_loaded_vault(unlocked: UnlockedVault) -> VaultResult<LoadedVault> {
    let crypto = VaultCrypto::new(&unlocked.secrets_key)?;
    let user_records = user_stored_records(&unlocked.meta.to_stored_records());
    let db = Database::from_stored_records_with_crypto(&user_records, &crypto)?;
    Ok(LoadedVault {
        database: db,
        meta: unlocked.meta,
        secrets_key: unlocked.secrets_key,
        members_key: unlocked.members_key,
    })
}

/// Replace member roster rows in the typed session meta state.
pub fn apply_member_records(state: &mut VaultMetaState, member_records: &[StoredSecretRecord]) {
    state.members.clear();
    for record in member_records {
        if let crate::VaultMetaRecord::Member(auth_id, payload) =
            crate::VaultMetaRecord::classify(record)
        {
            state.members.insert(auth_id, payload);
        }
    }
}

/// Read unlock metadata from vault YAML without decrypting secrets.
pub fn capture_vault_unlock_from_content(content: &str) -> VaultResult<VaultContentMetadata> {
    let unlock = crate::read_vault_unlock(content).unwrap_or(VaultUnlock::Keys);
    let password_entries = crate::read_vault_password_entries(content).unwrap_or_default();
    let store_id = crate::read_vault_store_id(content)?
        .ok_or(crate::errors::VaultFormatError::YamlMissingSections)?;
    let vault_name = crate::read_vault_name(content)?
        .unwrap_or_else(|| crate::default_vault_name_for_store_id(&store_id));
    let version = crate::read_vault_version(content).unwrap_or(0);
    let architecture = crate::read_vault_architecture(content)?;
    Ok(VaultContentMetadata {
        unlock,
        password_entries,
        store_id,
        vault_name,
        version,
        architecture,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        generate_vault_keys, genesis_auth_record, genesis_members_records, load_sentinel_vault,
        serialize_stored_yaml_with_unlock, serialize_stored_yaml_with_unlock_name_architecture,
    };

    #[test]
    fn encrypted_unlock_rejects_user_rows_without_a_secret_type() {
        let record = StoredSecretRecord {
            key: crate::SecretId::from_vault_record("secret_missing_type"),
            secret_type: None,
            value: crate::StoredRecordPayload::from_trusted(
                "-----BEGIN AGE ENCRYPTED FILE-----\ninvalid".to_owned(),
            ),
        };

        let error = validate_user_secret_types(&[record]).unwrap_err();

        assert!(matches!(
            error,
            crate::VaultError::Database(crate::DatabaseError::MissingSecretType { .. })
        ));
    }

    #[test]
    fn empty_content_requires_genesis() -> VaultResult<()> {
        assert!(content_requires_genesis("", false)?);
        assert!(content_requires_genesis("  ", false)?);
        Ok(())
    }

    #[test]
    fn genesis_yaml_reports_ready_for_enrolled_device() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
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
        let store_id = generate_store_id()?;
        let yaml = serialize_stored_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(store_id.as_str()),
            None,
        )?;
        assert!(!content_requires_genesis(yaml.as_str(), false)?);
        assert_eq!(
            access_status_for_vault_content(yaml.as_str(), &identity)?,
            VaultAccessStatus::Ready
        );
        let loaded = load_stored_vault(yaml.as_str(), &identity)?;
        assert_eq!(loaded.secrets_key, keys.secrets_key);
        assert!(loaded.database.list().is_empty());
        assert!(loaded.meta.auth.len() + loaded.meta.members.len() >= 2);
        Ok(())
    }

    #[test]
    fn sentinel_yaml_rejects_full_device_key_envelopes_before_write() -> VaultResult<()> {
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
            sentinel: Some(SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            }),
        };
        let store_id = generate_store_id()?;
        let error = serialize_stored_yaml_with_unlock_name_architecture(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(store_id.as_str()),
            None,
            None,
            &architecture,
        )
        .unwrap_err();

        assert!(matches!(
            error,
            crate::VaultFormatError::Validation(
                crate::ValidationError::SentinelVaultHasFullKeyEnvelopes
            )
        ));
        assert!(
            load_stored_vault(
                "schema_version: 1\nstore_id: store_testtoken11\narchitecture:\n  device_mode: standard\n  vault_type: sentinel\n  replication_type: personal\n  sentinel:\n    threshold: 2\n    required_participants: 2\n    ready_participants: 0\nsecrets: []\n",
                &identity,
            )
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
            2,
        )?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 3,
            },
        );
        let store_id = generate_store_id()?;
        let yaml = serialize_stored_yaml_with_unlock_name_architecture(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(store_id.as_str()),
            None,
            None,
            &architecture,
        )?;

        assert!(load_stored_vault(yaml.as_str(), &first).is_err());
        let loaded = load_sentinel_vault(yaml.as_str(), &[first, second])?;
        assert_eq!(loaded.secrets_key, keys.secrets_key);
        assert_eq!(loaded.members_key, keys.members_key);
        assert_eq!(loaded.meta.sentinel_shares.len(), 3);
        Ok(())
    }
}
