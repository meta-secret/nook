//! Connect-time vault assessment and session hydration from stored YAML.

use crate::errors::VaultResult;
use crate::{
    ConnectAccessStatus, Database, DeviceIdentity, StoredSecretRecord, VaultArchitecture,
    VaultCrypto, VaultMetaState, VaultType, VaultUnlock, assess_connect_access, deserialize_stored,
    detect_stored_format, resolve_members_key, resolve_secrets_key, user_stored_records,
    vault_has_multi_device_records,
};
use std::fmt;

/// Connect pre-flight status for the web layer (`new_vault` or enrolled-device access).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultAccessStatus {
    NewVault,
    Ready,
    NeedsEnrollment,
    JoinPending,
}

impl VaultAccessStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NewVault => "new_vault",
            Self::Ready => "ready",
            Self::NeedsEnrollment => "needs_enrollment",
            Self::JoinPending => "join_pending",
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
pub fn load_stored_vault(content: &str, identity: &DeviceIdentity) -> VaultResult<LoadedVault> {
    let format = detect_stored_format(content)?;
    let architecture = crate::read_vault_architecture(content)?;
    let stored_records = deserialize_stored(content, format)?;
    if architecture.vault_type == VaultType::Nexus {
        return Err(crate::MultiDeviceError::NotEnoughNexusShares {
            threshold: architecture.nexus.unwrap_or_default().threshold,
            available: 1,
        }
        .into());
    }
    let secrets_key = resolve_secrets_key(&stored_records, identity)?;
    let members_key = resolve_members_key(&stored_records, identity)?;
    let crypto = VaultCrypto::new(&secrets_key)?;
    let meta = VaultMetaState::from_stored_records(&stored_records);
    let user_records = user_stored_records(&stored_records);
    let db = Database::from_stored_records_with_crypto(&user_records, &crypto)?;
    Ok(LoadedVault {
        database: db,
        meta,
        secrets_key,
        members_key,
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
    use crate::{
        DeviceMode, NexusPolicy, ReplicationType, VaultResult, generate_store_id,
        generate_vault_keys, genesis_auth_record, genesis_members_records,
        serialize_stored_yaml_with_unlock, serialize_stored_yaml_with_unlock_name_architecture,
    };

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
    fn nexus_yaml_rejects_single_device_full_envelope_unlock_path() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let records = vec![genesis_auth_record(
            &identity,
            &keys.secrets_key,
            &keys.members_key,
        )?];
        let architecture = VaultArchitecture {
            device_mode: DeviceMode::Standard,
            vault_type: VaultType::Nexus,
            replication_type: ReplicationType::Personal,
            nexus: Some(NexusPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            }),
        };
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

        assert!(load_stored_vault(yaml.as_str(), &identity).is_err());
        Ok(())
    }
}
