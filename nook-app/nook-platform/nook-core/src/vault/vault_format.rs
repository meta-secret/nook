use crate::errors::{VaultFormatError, VaultFormatResult};
use crate::vault_wire::{StoredVaultBlob, StoredVaultYaml as VaultYamlBlob};
use crate::{PasswordUnlockEntry, StoredSecretRecord, VaultArchitecture, VaultUnlock};

mod model;
mod vault_yaml;

pub use model::*;
use vault_yaml::{
    StoredVaultYaml, auth_to_stored_record, members_to_stored_record, partition_yaml_records,
};

/// Detect stored vault format from file contents.
pub fn detect_stored_format(stored: &str) -> VaultFormatResult<VaultFormat> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(VaultFormat::Yaml);
    }

    let first_line = trimmed
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");

    if first_line.starts_with('-')
        || first_line.starts_with('[')
        || first_line.starts_with("%YAML")
        || first_line.starts_with("name:")
        || first_line.starts_with("secrets:")
        || first_line.starts_with("store_id:")
        || first_line.starts_with("schema_version:")
        || first_line.starts_with("vault_version:")
        || first_line.starts_with("architecture:")
        || first_line.starts_with("auth:")
        || first_line.starts_with("joins:")
        || first_line.starts_with("members:")
        || first_line.starts_with("sentinel_shares:")
        || first_line.starts_with("unlock:")
    {
        return Ok(VaultFormat::Yaml);
    }

    Err(VaultFormatError::UnrecognizedFormat {
        first_line: first_line.to_owned(),
    })
}

pub fn serialize_stored(
    records: &[StoredSecretRecord],
    format: VaultFormat,
) -> VaultFormatResult<StoredVaultBlob> {
    match format {
        VaultFormat::Yaml => serialize_stored_yaml(records).map(StoredVaultBlob::Yaml),
    }
}

pub fn deserialize_stored(
    stored: &str,
    format: VaultFormat,
) -> VaultFormatResult<Vec<StoredSecretRecord>> {
    match format {
        VaultFormat::Yaml => deserialize_stored_yaml(stored),
    }
}

/// Maximum projection YAML schema this build reads and writes.
pub const CURRENT_VAULT_SCHEMA_VERSION: u32 = 1;

fn ensure_supported_vault_schema(version: u32) -> VaultFormatResult<()> {
    if version != CURRENT_VAULT_SCHEMA_VERSION {
        return Err(VaultFormatError::UnsupportedSchemaVersion {
            found: version,
            max_supported: CURRENT_VAULT_SCHEMA_VERSION,
        });
    }
    Ok(())
}

/// Schema version written on new projection caches.
#[must_use]
pub fn current_vault_schema_version() -> u32 {
    CURRENT_VAULT_SCHEMA_VERSION
}

/// Cheap parse of top-level `schema_version` (missing → `1`).
pub fn read_vault_schema_version(stored: &str) -> VaultFormatResult<u32> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(1);
    }
    detect_stored_format(trimmed)?;
    let vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseVersion)?;
    Ok(vault.schema_version)
}

pub fn serialize_stored_yaml(records: &[StoredSecretRecord]) -> VaultFormatResult<VaultYamlBlob> {
    serialize_stored_yaml_with_unlock(
        records,
        &VaultUnlock::Keys,
        &[],
        VaultStoreIdentityRef::Unassigned,
        VaultVersionWrite::Initial,
    )
}

fn resolve_store_id_for_write(
    store_id: VaultStoreIdentityRef<'_>,
) -> VaultFormatResult<VaultStoreIdentity> {
    match store_id {
        VaultStoreIdentityRef::Assigned(id) if !id.trim().is_empty() => Ok(
            VaultStoreIdentity::Assigned(crate::normalize_store_id(id.trim())?.to_string()),
        ),
        VaultStoreIdentityRef::Unassigned | VaultStoreIdentityRef::Assigned(_) => {
            Ok(VaultStoreIdentity::Unassigned)
        }
    }
}

fn resolve_vault_name_for_write(name: VaultNameRef<'_>) -> VaultName {
    match name {
        VaultNameRef::Named(value) if !value.trim().is_empty() => {
            VaultName::Named(value.trim().to_owned())
        }
        VaultNameRef::Unnamed | VaultNameRef::Named(_) => VaultName::Unnamed,
    }
}

#[must_use]
pub fn default_vault_name_for_store_id(store_id: &str) -> String {
    let suffix = store_id
        .rsplit('_')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or(store_id);
    format!("Vault {suffix}")
}

/// Serialize records together with unlock metadata. Backup passwords live in
/// `password_entries` alongside `auth:` device-key rows; `unlock.type` stays
/// `keys` for hybrid vaults.
pub fn serialize_stored_yaml_with_unlock(
    records: &[StoredSecretRecord],
    unlock: &VaultUnlock,
    password_entries: &[PasswordUnlockEntry],
    store_id: VaultStoreIdentityRef<'_>,
    vault_version: VaultVersionWrite,
) -> VaultFormatResult<VaultYamlBlob> {
    serialize_stored_yaml_with_unlock_and_name(
        records,
        unlock,
        password_entries,
        store_id,
        VaultNameRef::Unnamed,
        vault_version,
    )
}

/// Serialize records together with unlock metadata and a human vault label.
pub fn serialize_stored_yaml_with_unlock_and_name(
    records: &[StoredSecretRecord],
    unlock: &VaultUnlock,
    password_entries: &[PasswordUnlockEntry],
    store_id: VaultStoreIdentityRef<'_>,
    vault_name: VaultNameRef<'_>,
    vault_version: VaultVersionWrite,
) -> VaultFormatResult<VaultYamlBlob> {
    serialize_stored_yaml_with_unlock_name_architecture(
        records,
        unlock,
        password_entries,
        store_id,
        vault_name,
        vault_version,
        &VaultArchitecture::default(),
    )
}

/// Serialize records together with unlock, name, and grouped architecture metadata.
pub fn serialize_stored_yaml_with_unlock_name_architecture(
    records: &[StoredSecretRecord],
    unlock: &VaultUnlock,
    password_entries: &[PasswordUnlockEntry],
    store_id: VaultStoreIdentityRef<'_>,
    vault_name: VaultNameRef<'_>,
    vault_version: VaultVersionWrite,
    architecture: &VaultArchitecture,
) -> VaultFormatResult<VaultYamlBlob> {
    architecture.validate_records(records)?;
    let mut vault = partition_yaml_records(records)?;
    vault.schema_version = CURRENT_VAULT_SCHEMA_VERSION;
    vault.vault_version = match vault_version {
        VaultVersionWrite::Initial => 0,
        VaultVersionWrite::Version(version) => version,
    };
    vault.store_id = match resolve_store_id_for_write(store_id)? {
        VaultStoreIdentity::Assigned(store_id) => Some(store_id),
        VaultStoreIdentity::Unassigned => None,
    };
    vault.name = match resolve_vault_name_for_write(vault_name) {
        VaultName::Named(name) => Some(name),
        VaultName::Unnamed => None,
    };
    vault.unlock = normalize_unlock_for_write(unlock);
    vault.architecture = architecture.clone();
    vault.password_entries = password_entries.to_vec();
    serde_yaml::to_string(&vault)
        .map(VaultYamlBlob::from_trusted)
        .map_err(VaultFormatError::YamlSerialize)
}

/// Read the human-readable vault label from on-disk YAML.
pub fn read_vault_name(stored: &str) -> VaultFormatResult<VaultName> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(VaultName::Unnamed);
    }
    detect_stored_format(trimmed)?;
    let vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseName)?;
    ensure_supported_vault_schema(vault.schema_version)?;
    Ok(match vault.name {
        Some(name) => resolve_vault_name_for_write(VaultNameRef::Named(&name)),
        None => VaultName::Unnamed,
    })
}

/// Update the human-readable vault label without decrypting records.
pub fn set_vault_name(stored: &str, name: &str) -> VaultFormatResult<VaultYamlBlob> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Err(VaultFormatError::YamlMissingSections);
    }
    detect_stored_format(trimmed)?;
    let mut vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseName)?;
    ensure_supported_vault_schema(vault.schema_version)?;
    vault.name = match resolve_vault_name_for_write(VaultNameRef::Named(name)) {
        VaultName::Named(name) => Some(name),
        VaultName::Unnamed => None,
    };
    serde_yaml::to_string(&vault)
        .map(VaultYamlBlob::from_trusted)
        .map_err(VaultFormatError::YamlSerialize)
}

/// Read the monotonic revision counter from on-disk YAML.
pub fn read_vault_version(stored: &str) -> VaultFormatResult<u64> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(0);
    }
    detect_stored_format(trimmed)?;
    let vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseVersion)?;
    ensure_supported_vault_schema(vault.schema_version)?;
    Ok(vault.vault_version)
}

fn vault_unlock_is_keys(unlock: &VaultUnlock) -> bool {
    matches!(unlock, VaultUnlock::Keys)
}

fn normalize_unlock_for_write(unlock: &VaultUnlock) -> VaultUnlock {
    match unlock {
        VaultUnlock::Passwords { .. } | VaultUnlock::Keys => VaultUnlock::Keys,
    }
}

fn extract_password_entries(vault: &StoredVaultYaml) -> Vec<PasswordUnlockEntry> {
    vault.password_entries.clone()
}

/// Read labelled backup passwords without unwinding the full record list.
pub fn read_vault_password_entries(stored: &str) -> VaultFormatResult<Vec<PasswordUnlockEntry>> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    detect_stored_format(trimmed)?;
    let vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParsePasswordEntries)?;
    ensure_supported_vault_schema(vault.schema_version)?;
    Ok(extract_password_entries(&vault))
}

/// Read the logical secret-store id from on-disk YAML.
pub fn read_vault_store_id(stored: &str) -> VaultFormatResult<VaultStoreIdentity> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(VaultStoreIdentity::Unassigned);
    }
    detect_stored_format(trimmed)?;
    let vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseStoreId)?;
    ensure_supported_vault_schema(vault.schema_version)?;
    match vault.store_id {
        Some(id) => Ok(VaultStoreIdentity::Assigned(
            crate::validate_store_id(&id)?.to_string(),
        )),
        None => Ok(VaultStoreIdentity::Unassigned),
    }
}

/// Read grouped architecture metadata from on-disk YAML.
///
pub fn read_vault_architecture(stored: &str) -> VaultFormatResult<VaultArchitecture> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(VaultArchitecture::default());
    }
    detect_stored_format(trimmed)?;
    let vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseArchitecture)?;
    ensure_supported_vault_schema(vault.schema_version)?;
    vault.architecture.validate()?;
    Ok(vault.architecture)
}

pub fn deserialize_stored_yaml(stored: &str) -> VaultFormatResult<Vec<StoredSecretRecord>> {
    Ok(deserialize_stored_yaml_with_unlock(stored)?.0)
}

/// Deserialize records and the active unlock mode side-by-side.
pub fn deserialize_stored_yaml_with_unlock(
    stored: &str,
) -> VaultFormatResult<(Vec<StoredSecretRecord>, VaultUnlock)> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok((Vec::new(), VaultUnlock::Keys));
    }

    let vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(|_| VaultFormatError::YamlMissingSections)?;

    ensure_supported_vault_schema(vault.schema_version)?;

    let unlock = vault.unlock.clone();

    let mut records = vault.secrets;
    records.extend(
        vault
            .auth
            .into_iter()
            .map(auth_to_stored_record)
            .collect::<VaultFormatResult<Vec<_>>>()?,
    );
    records.extend(vault.joins);
    records.extend(
        vault
            .members
            .into_iter()
            .map(members_to_stored_record)
            .collect::<VaultFormatResult<Vec<_>>>()?,
    );
    records.extend(vault.sentinel_shares);
    Ok((records, unlock))
}

/// Read just the active unlock mode without unwinding the full record list.
pub fn read_vault_unlock(stored: &str) -> VaultFormatResult<VaultUnlock> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(VaultUnlock::Keys);
    }
    detect_stored_format(trimmed)?;
    let vault: StoredVaultYaml =
        serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseUnlock)?;
    ensure_supported_vault_schema(vault.schema_version)?;
    Ok(vault.unlock)
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use crate::{
        DeviceMode, ReplicationType, SecretType, SentinelConfiguration, SymmetricKey, VaultType,
    };

    use std::{error, io, slice};

    use super::*;
    use crate::{SecretId, StoredRecordPayload};

    fn sid(label: &str) -> SecretId {
        SecretId::from_vault_record(label)
    }

    fn sample_records() -> Vec<StoredSecretRecord> {
        vec![
            StoredSecretRecord {
                key: sid("github.com"),
                secret_type: Some(SecretType::Login),
                value: StoredRecordPayload::from_trusted(
                    "-----BEGIN AGE ENCRYPTED FILE-----\nline1\nline2\n-----END AGE ENCRYPTED FILE-----"
                        .to_owned(),
                ),
            },
            StoredSecretRecord {
                key: sid("work-vpn"),
                secret_type: Some(SecretType::ApiKey),
                value: StoredRecordPayload::from_trusted(
                    "-----BEGIN AGE ENCRYPTED FILE-----\nsecret\n-----END AGE ENCRYPTED FILE-----"
                        .to_owned(),
                ),
            },
        ]
    }

    #[test]
    fn yaml_roundtrip_stored_records() -> anyhow::Result<()> {
        let records = sample_records();
        let stored = serialize_stored_yaml(&records)?;
        assert!(stored.as_str().contains("github.com"));
        assert!(stored.as_str().contains('|'));
        assert!(!stored.as_str().contains("\\n"));

        let parsed = deserialize_stored_yaml(stored.as_str())?;
        assert_eq!(parsed, records);
        Ok(())
    }

    #[test]
    fn detect_yaml_and_reject_json_objects() -> anyhow::Result<()> {
        assert!(detect_stored_format(r#"{"key":"a","value":"b"}"#).is_err());
        assert_eq!(
            detect_stored_format("secrets:\n  - key: a\n    value: b\n")?,
            VaultFormat::Yaml
        );
        assert_eq!(
            detect_stored_format("- key: a\n  value: b\n")?,
            VaultFormat::Yaml
        );
        Ok(())
    }

    #[test]
    fn detect_empty_defaults_to_yaml() -> anyhow::Result<()> {
        assert_eq!(detect_stored_format("")?, VaultFormat::Yaml);
        assert_eq!(detect_stored_format("   \n  \n")?, VaultFormat::Yaml);
        Ok(())
    }

    #[test]
    fn detect_yaml_document_header() -> anyhow::Result<()> {
        assert_eq!(
            detect_stored_format("%YAML 1.2\n---\nsecrets: []\n")?,
            VaultFormat::Yaml
        );
        Ok(())
    }

    #[test]
    fn detect_unrecognized_format_fails() -> anyhow::Result<()> {
        assert!(detect_stored_format("not a vault file").is_err());
        assert!(detect_stored_format("key: value").is_err());
        Ok(())
    }

    #[test]
    fn empty_stored_records_roundtrip_yaml() -> anyhow::Result<()> {
        let stored = serialize_stored(&[], VaultFormat::Yaml)?;
        let parsed = deserialize_stored(stored.as_str(), VaultFormat::Yaml)?;
        assert!(parsed.is_empty());
        assert!(deserialize_stored_yaml("")?.is_empty());
        assert!(deserialize_stored_yaml("  \n")?.is_empty());
        Ok(())
    }

    #[test]
    fn yaml_requires_secrets_auth_joins_sections() -> anyhow::Result<()> {
        let records = sample_records();
        let wrapped = serialize_stored_yaml(&records)?;
        assert_eq!(deserialize_stored_yaml(wrapped.as_str())?, records);

        let root = serde_yaml::to_string(&records)?;
        assert!(deserialize_stored_yaml(&root).is_err());
        Ok(())
    }

    #[test]
    fn serialize_stored_matches_format_specific_helpers() -> anyhow::Result<()> {
        let records = sample_records();
        assert_eq!(
            serialize_stored(&records, VaultFormat::Yaml)?.as_str(),
            serialize_stored_yaml(&records)?.as_str()
        );
        Ok(())
    }

    #[test]
    fn yaml_preserves_multiline_armored_value_exactly() -> anyhow::Result<()> {
        let records = sample_records();
        let stored = serialize_stored_yaml(&records)?;
        let parsed = deserialize_stored_yaml(stored.as_str())?;

        assert_eq!(parsed[0].value, records[0].value);
        assert!(parsed[0].value.as_str().contains('\n'));
        Ok(())
    }

    #[test]
    fn yaml_accepts_root_sequence_format_detection_only() -> anyhow::Result<()> {
        assert_eq!(
            detect_stored_format("- key: a\n  value: b\n")?,
            VaultFormat::Yaml
        );
        assert!(deserialize_stored_yaml("- key: a\n  value: b\n").is_err());
        Ok(())
    }

    #[test]
    fn serialize_empty_yaml_has_secrets_key() -> anyhow::Result<()> {
        let stored = serialize_stored_yaml(&[])?;
        assert!(stored.as_str().contains("secrets:"));
        assert!(!stored.as_str().contains("auth:"));
        assert!(deserialize_stored_yaml(stored.as_str())?.is_empty());
        Ok(())
    }

    #[test]
    fn yaml_password_entries_roundtrip_with_keys_unlock() -> anyhow::Result<()> {
        use crate::{
            attach_password_envelope_with_work_factor, multi_device::VaultKeys,
            resolve_keys_from_password,
        };

        let keys = VaultKeys {
            secrets_key: SymmetricKey::parse(&"d".repeat(64))?,
            members_key: SymmetricKey::parse(&"e".repeat(64))?,
        };
        let envelope =
            attach_password_envelope_with_work_factor(&keys, "correct horse battery staple", 10)?;
        let entry = PasswordUnlockEntry {
            id: "pw-1".to_owned(),
            label: "test password".to_owned(),
            created_at: "2026-06-23T00:00:00Z".to_owned(),
            envelope: envelope.clone(),
        };

        let yaml = serialize_stored_yaml_with_unlock(
            &[],
            &VaultUnlock::Keys,
            slice::from_ref(&entry),
            VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
            VaultVersionWrite::Version(1),
        )?;
        assert!(!yaml.as_str().contains("unlock:"));
        assert!(yaml.as_str().contains("password_entries:"));
        assert!(!yaml.as_str().starts_with("password_envelope:"));

        let parsed_entries = read_vault_password_entries(yaml.as_str())?;
        assert_eq!(parsed_entries.len(), 1);
        let parsed_envelope = parsed_entries[0].envelope.clone();
        assert_eq!(parsed_envelope.version, envelope.version);
        assert_eq!(parsed_envelope.kdf, envelope.kdf);
        assert_eq!(
            resolve_keys_from_password(&parsed_envelope, "correct horse battery staple")?,
            keys
        );

        let read = read_vault_unlock(yaml.as_str())?;
        assert_eq!(read, VaultUnlock::Keys);
        Ok(())
    }

    #[test]
    fn yaml_keys_unlock_is_default() -> anyhow::Result<()> {
        let records = sample_records();
        let yaml = serialize_stored_yaml(&records)?;
        assert!(!yaml.as_str().contains("unlock:"));
        assert!(!yaml.as_str().contains("envelope:"));

        let (parsed_records, unlock) = deserialize_stored_yaml_with_unlock(yaml.as_str())?;
        assert_eq!(parsed_records, records);
        assert_eq!(unlock, VaultUnlock::Keys);
        assert_eq!(read_vault_unlock(yaml.as_str())?, VaultUnlock::Keys);
        Ok(())
    }

    #[test]
    fn store_id_roundtrip() -> anyhow::Result<()> {
        let records = sample_records();
        let yaml = serialize_stored_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
            VaultVersionWrite::Version(1),
        )?;
        assert!(yaml.as_str().contains("store_id: store_SMypl8K0w9Y"));
        assert!(yaml.as_str().contains("schema_version: 1"));
        assert!(yaml.as_str().contains("vault_version: 1"));
        assert_eq!(read_vault_schema_version(yaml.as_str())?, 1);
        assert_eq!(read_vault_version(yaml.as_str())?, 1);
        assert_eq!(
            read_vault_store_id(yaml.as_str())?,
            VaultStoreIdentity::Assigned("store_SMypl8K0w9Y".to_owned())
        );
        Ok(())
    }

    #[test]
    fn architecture_roundtrips_when_explicit() -> anyhow::Result<()> {
        let architecture = VaultArchitecture {
            device_mode: DeviceMode::AntiHacker,
            vault_type: VaultType::Sentinel,
            replication_type: ReplicationType::Shared,
            sentinel: SentinelConfiguration::Enabled(crate::SentinelPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 0,
            }),
        };
        let yaml = serialize_stored_yaml_with_unlock_name_architecture(
            &[],
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
            VaultNameRef::Named("Team vault"),
            VaultVersionWrite::Version(7),
            &architecture,
        )?;
        assert!(yaml.as_str().contains("architecture:"));
        assert!(yaml.as_str().contains("device_mode: anti-hacker"));
        assert_eq!(read_vault_architecture(yaml.as_str())?, architecture);
        Ok(())
    }

    #[test]
    fn invalid_architecture_metadata_is_rejected() -> anyhow::Result<()> {
        let invalid = "\
schema_version: 1
store_id: store_SMypl8K0w9Y
architecture:
  vault_type: simple
  sentinel:
    threshold: 2
    required_participants: 3
secrets: []
";
        assert!(read_vault_architecture(invalid).is_err());
        Ok(())
    }

    #[test]
    fn unknown_architecture_mode_reports_stable_validation_key() -> anyhow::Result<()> {
        use error::Error;

        let invalid = "\
schema_version: 1
store_id: store_SMypl8K0w9Y
architecture:
  device_mode: future-device-mode
  vault_type: simple
  replication_type: personal
secrets: []
";
        let error = read_vault_architecture(invalid)
            .err()
            .ok_or_else(|| anyhow::anyhow!("vault format test should reject invalid input"))?;
        let source = error
            .source()
            .ok_or_else(|| io::Error::other("test source value must exist"))?
            .to_string();
        assert!(
            source.contains("errors.validation.unknown_device_mode:future-device-mode"),
            "{source}"
        );
        Ok(())
    }

    #[test]
    fn vault_name_roundtrip_and_update() -> anyhow::Result<()> {
        let records = sample_records();
        let yaml = serialize_stored_yaml_with_unlock_and_name(
            &records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
            VaultNameRef::Named("  Personal vault  "),
            VaultVersionWrite::Version(1),
        )?;
        assert!(yaml.as_str().contains("name: Personal vault"));
        assert_eq!(
            read_vault_name(yaml.as_str())?,
            VaultName::Named("Personal vault".to_owned())
        );
        assert_eq!(deserialize_stored_yaml(yaml.as_str())?, records);

        let renamed = set_vault_name(yaml.as_str(), "Work vault")?;
        assert_eq!(
            read_vault_name(renamed.as_str())?,
            VaultName::Named("Work vault".to_owned())
        );
        assert_eq!(read_vault_version(renamed.as_str())?, 1);
        assert_eq!(
            read_vault_store_id(renamed.as_str())?,
            VaultStoreIdentity::Assigned("store_SMypl8K0w9Y".to_owned())
        );
        assert_eq!(deserialize_stored_yaml(renamed.as_str())?, records);
        Ok(())
    }

    #[test]
    fn unsupported_schema_version_is_rejected() -> anyhow::Result<()> {
        let future = "schema_version: 99\nunlock:\n  type: keys\nsecrets: []\n";
        let err = deserialize_stored_yaml(future)
            .err()
            .ok_or_else(|| anyhow::anyhow!("vault format test should reject invalid input"))?;
        assert!(matches!(
            err,
            VaultFormatError::UnsupportedSchemaVersion {
                found: 99,
                max_supported: 1
            }
        ));
        Ok(())
    }
}
