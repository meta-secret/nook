use crate::{
    DeviceMode, ReplicationType, SecretType, SentinelConfiguration, SymmetricKey, VaultType,
};

use std::{error, io, slice};

use super::*;
use crate::{SecretId, StoredRecordPayload};

struct VaultFormatTestData;

impl VaultFormatTestData {
    fn sid(label: &str) -> SecretId {
        SecretId::from_vault_record(label)
    }

    fn sample_records() -> Vec<StoredSecretRecord> {
        vec![
                StoredSecretRecord {
                    key: Self::sid("github.com"),
                    secret_type: Some(SecretType::Login),
                    value: StoredRecordPayload::from_trusted(
                        "-----BEGIN AGE ENCRYPTED FILE-----\nline1\nline2\n-----END AGE ENCRYPTED FILE-----"
                            .to_owned(),
                    ),
                },
                StoredSecretRecord {
                    key: Self::sid("work-vpn"),
                    secret_type: Some(SecretType::ApiKey),
                    value: StoredRecordPayload::from_trusted(
                        "-----BEGIN AGE ENCRYPTED FILE-----\nsecret\n-----END AGE ENCRYPTED FILE-----"
                            .to_owned(),
                    ),
                },
            ]
    }

    fn detect_stored_format(stored: &str) -> VaultFormatResult<VaultFormat> {
        VaultFormatDocument::new(stored).detect()
    }

    fn serialize_stored(
        records: &[StoredSecretRecord],
        format: VaultFormat,
    ) -> VaultFormatResult<StoredVaultBlob> {
        VaultRecordSet::serialize(records, format)
    }

    fn deserialize_stored(
        stored: &str,
        format: VaultFormat,
    ) -> VaultFormatResult<Vec<StoredSecretRecord>> {
        VaultFormatDocument::new(stored).deserialize(format)
    }

    fn serialize_stored_yaml(records: &[StoredSecretRecord]) -> VaultFormatResult<VaultYamlBlob> {
        VaultRecordSet::serialize_yaml(records)
    }

    fn serialize_stored_yaml_with_unlock(
        records: &[StoredSecretRecord],
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        VaultRecordSet::serialize_yaml_with_unlock(
            records,
            unlock,
            password_entries,
            store_id,
            version,
        )
    }

    fn serialize_stored_yaml_with_unlock_and_name(
        records: &[StoredSecretRecord],
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        name: VaultNameRef<'_>,
        version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        VaultRecordSet::serialize_yaml_with_unlock_and_name(
            records,
            unlock,
            password_entries,
            store_id,
            name,
            version,
        )
    }

    fn serialize_stored_yaml_with_unlock_name_architecture(
        records: &[StoredSecretRecord],
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        name: VaultNameRef<'_>,
        version: VaultVersionWrite,
        architecture: &VaultArchitecture,
    ) -> VaultFormatResult<VaultYamlBlob> {
        VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
            records,
            unlock,
            password_entries,
            store_id,
            name,
            version,
            architecture,
        )
    }

    fn deserialize_stored_yaml(stored: &str) -> VaultFormatResult<Vec<StoredSecretRecord>> {
        VaultFormatDocument::new(stored).deserialize_yaml()
    }

    fn deserialize_stored_yaml_with_unlock(
        stored: &str,
    ) -> VaultFormatResult<(Vec<StoredSecretRecord>, VaultUnlock)> {
        VaultFormatDocument::new(stored).deserialize_yaml_with_unlock()
    }

    fn read_vault_password_entries(stored: &str) -> VaultFormatResult<Vec<PasswordUnlockEntry>> {
        VaultFormatDocument::new(stored).password_entries()
    }

    fn read_vault_unlock(stored: &str) -> VaultFormatResult<VaultUnlock> {
        VaultFormatDocument::new(stored).unlock()
    }

    fn read_vault_schema_version(stored: &str) -> VaultFormatResult<VaultSchemaVersion> {
        VaultFormatDocument::new(stored).schema_version()
    }

    fn read_vault_version(stored: &str) -> VaultFormatResult<crate::VaultVersion> {
        VaultFormatDocument::new(stored).version()
    }

    fn read_vault_store_id(stored: &str) -> VaultFormatResult<VaultStoreIdentity> {
        VaultFormatDocument::new(stored).store_id()
    }

    fn read_vault_architecture(stored: &str) -> VaultFormatResult<VaultArchitecture> {
        VaultFormatDocument::new(stored).architecture()
    }

    fn read_vault_name(stored: &str) -> VaultFormatResult<VaultName> {
        VaultFormatDocument::new(stored).name()
    }

    fn set_vault_name(stored: &str, name: &str) -> VaultFormatResult<VaultYamlBlob> {
        VaultFormatDocument::new(stored).rename(name)
    }
}

#[test]
fn yaml_roundtrip_stored_records() -> anyhow::Result<()> {
    let records = VaultFormatTestData::sample_records();
    let stored = VaultFormatTestData::serialize_stored_yaml(&records)?;
    assert!(stored.as_str().contains("github.com"));
    assert!(stored.as_str().contains('|'));
    assert!(!stored.as_str().contains("\\n"));

    let parsed = VaultFormatTestData::deserialize_stored_yaml(stored.as_str())?;
    assert_eq!(parsed, records);
    Ok(())
}

#[test]
fn detect_yaml_and_reject_json_objects() -> anyhow::Result<()> {
    assert!(VaultFormatTestData::detect_stored_format(r#"{"key":"a","value":"b"}"#).is_err());
    assert_eq!(
        VaultFormatTestData::detect_stored_format("secrets:\n  - key: a\n    value: b\n")?,
        VaultFormat::Yaml
    );
    assert_eq!(
        VaultFormatTestData::detect_stored_format("- key: a\n  value: b\n")?,
        VaultFormat::Yaml
    );
    Ok(())
}

#[test]
fn detect_empty_defaults_to_yaml() -> anyhow::Result<()> {
    assert_eq!(
        VaultFormatTestData::detect_stored_format("")?,
        VaultFormat::Yaml
    );
    assert_eq!(
        VaultFormatTestData::detect_stored_format("   \n  \n")?,
        VaultFormat::Yaml
    );
    Ok(())
}

#[test]
fn detect_yaml_document_header() -> anyhow::Result<()> {
    assert_eq!(
        VaultFormatTestData::detect_stored_format("%YAML 1.2\n---\nsecrets: []\n")?,
        VaultFormat::Yaml
    );
    Ok(())
}

#[test]
fn detect_unrecognized_format_fails() -> anyhow::Result<()> {
    assert!(VaultFormatTestData::detect_stored_format("not a vault file").is_err());
    assert!(VaultFormatTestData::detect_stored_format("key: value").is_err());
    Ok(())
}

#[test]
fn empty_stored_records_roundtrip_yaml() -> anyhow::Result<()> {
    let stored = VaultFormatTestData::serialize_stored(&[], VaultFormat::Yaml)?;
    let parsed = VaultFormatTestData::deserialize_stored(stored.as_str(), VaultFormat::Yaml)?;
    assert!(parsed.is_empty());
    assert!(VaultFormatTestData::deserialize_stored_yaml("")?.is_empty());
    assert!(VaultFormatTestData::deserialize_stored_yaml("  \n")?.is_empty());
    Ok(())
}

#[test]
fn yaml_requires_secrets_auth_joins_sections() -> anyhow::Result<()> {
    let records = VaultFormatTestData::sample_records();
    let wrapped = VaultFormatTestData::serialize_stored_yaml(&records)?;
    assert_eq!(
        VaultFormatTestData::deserialize_stored_yaml(wrapped.as_str())?,
        records
    );

    let root = serde_yaml::to_string(&records)?;
    assert!(VaultFormatTestData::deserialize_stored_yaml(&root).is_err());
    Ok(())
}

#[test]
fn serialize_stored_matches_format_specific_helpers() -> anyhow::Result<()> {
    let records = VaultFormatTestData::sample_records();
    assert_eq!(
        VaultFormatTestData::serialize_stored(&records, VaultFormat::Yaml)?.as_str(),
        VaultFormatTestData::serialize_stored_yaml(&records)?.as_str()
    );
    Ok(())
}

#[test]
fn yaml_preserves_multiline_armored_value_exactly() -> anyhow::Result<()> {
    let records = VaultFormatTestData::sample_records();
    let stored = VaultFormatTestData::serialize_stored_yaml(&records)?;
    let parsed = VaultFormatTestData::deserialize_stored_yaml(stored.as_str())?;

    assert_eq!(parsed[0].value, records[0].value);
    assert!(parsed[0].value.as_str().contains('\n'));
    Ok(())
}

#[test]
fn yaml_accepts_root_sequence_format_detection_only() -> anyhow::Result<()> {
    assert_eq!(
        VaultFormatTestData::detect_stored_format("- key: a\n  value: b\n")?,
        VaultFormat::Yaml
    );
    assert!(VaultFormatTestData::deserialize_stored_yaml("- key: a\n  value: b\n").is_err());
    Ok(())
}

#[test]
fn serialize_empty_yaml_has_secrets_key() -> anyhow::Result<()> {
    let stored = VaultFormatTestData::serialize_stored_yaml(&[])?;
    assert!(stored.as_str().contains("secrets:"));
    assert!(!stored.as_str().contains("auth:"));
    assert!(VaultFormatTestData::deserialize_stored_yaml(stored.as_str())?.is_empty());
    Ok(())
}

#[test]
fn yaml_password_entries_roundtrip_with_keys_unlock() -> anyhow::Result<()> {
    use crate::{PasswordEnvelopeAttachment, PasswordEnvelopeResolution, multi_device::VaultKeys};

    let keys = VaultKeys {
        secrets_key: SymmetricKey::parse(&"d".repeat(64))?,
        members_key: SymmetricKey::parse(&"e".repeat(64))?,
    };
    let envelope = PasswordEnvelopeAttachment::with_work_factor(
        &keys,
        "correct horse battery staple",
        10.into(),
    )
    .attach()?;
    let entry = PasswordUnlockEntry {
        id: "pw-1".to_owned(),
        label: "test password".to_owned(),
        created_at: "2026-06-23T00:00:00Z".to_owned(),
        envelope: envelope.clone(),
    };

    let yaml = VaultFormatTestData::serialize_stored_yaml_with_unlock(
        &[],
        &VaultUnlock::Keys,
        slice::from_ref(&entry),
        VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
        VaultVersionWrite::Version(1.into()),
    )?;
    assert!(!yaml.as_str().contains("unlock:"));
    assert!(yaml.as_str().contains("password_entries:"));
    assert!(!yaml.as_str().starts_with("password_envelope:"));

    let parsed_entries = VaultFormatTestData::read_vault_password_entries(yaml.as_str())?;
    assert_eq!(parsed_entries.len(), 1);
    let parsed_envelope = parsed_entries[0].envelope.clone();
    assert_eq!(parsed_envelope.version, envelope.version);
    assert_eq!(parsed_envelope.kdf, envelope.kdf);
    assert_eq!(
        PasswordEnvelopeResolution::new(&parsed_envelope, "correct horse battery staple")
            .resolve()?,
        keys
    );

    let read = VaultFormatTestData::read_vault_unlock(yaml.as_str())?;
    assert_eq!(read, VaultUnlock::Keys);
    Ok(())
}

#[test]
fn yaml_keys_unlock_is_default() -> anyhow::Result<()> {
    let records = VaultFormatTestData::sample_records();
    let yaml = VaultFormatTestData::serialize_stored_yaml(&records)?;
    assert!(!yaml.as_str().contains("unlock:"));
    assert!(!yaml.as_str().contains("envelope:"));

    let (parsed_records, unlock) =
        VaultFormatTestData::deserialize_stored_yaml_with_unlock(yaml.as_str())?;
    assert_eq!(parsed_records, records);
    assert_eq!(unlock, VaultUnlock::Keys);
    assert_eq!(
        VaultFormatTestData::read_vault_unlock(yaml.as_str())?,
        VaultUnlock::Keys
    );
    Ok(())
}

#[test]
fn store_id_roundtrip() -> anyhow::Result<()> {
    let records = VaultFormatTestData::sample_records();
    let yaml = VaultFormatTestData::serialize_stored_yaml_with_unlock(
        &records,
        &VaultUnlock::Keys,
        &[],
        VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
        VaultVersionWrite::Version(1.into()),
    )?;
    assert!(yaml.as_str().contains("store_id: store_SMypl8K0w9Y"));
    assert!(yaml.as_str().contains("schema_version: 1"));
    assert!(yaml.as_str().contains("vault_version: 1"));
    assert_eq!(
        u32::from(VaultFormatTestData::read_vault_schema_version(
            yaml.as_str()
        )?),
        1
    );
    assert_eq!(
        u64::from(VaultFormatTestData::read_vault_version(yaml.as_str())?),
        1
    );
    assert_eq!(
        VaultFormatTestData::read_vault_store_id(yaml.as_str())?,
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
            threshold: 2.into(),
            required_participants: 3.into(),
            ready_participants: 0.into(),
        }),
    };
    let yaml = VaultFormatTestData::serialize_stored_yaml_with_unlock_name_architecture(
        &[],
        &VaultUnlock::Keys,
        &[],
        VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
        VaultNameRef::Named("Team vault"),
        VaultVersionWrite::Version(7.into()),
        &architecture,
    )?;
    assert!(yaml.as_str().contains("architecture:"));
    assert!(yaml.as_str().contains("device_mode: anti-hacker"));
    assert_eq!(
        VaultFormatTestData::read_vault_architecture(yaml.as_str())?,
        architecture
    );
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
    assert!(VaultFormatTestData::read_vault_architecture(invalid).is_err());
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
    let error = VaultFormatTestData::read_vault_architecture(invalid)
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
    let records = VaultFormatTestData::sample_records();
    let yaml = VaultFormatTestData::serialize_stored_yaml_with_unlock_and_name(
        &records,
        &VaultUnlock::Keys,
        &[],
        VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
        VaultNameRef::Named("  Personal vault  "),
        VaultVersionWrite::Version(1.into()),
    )?;
    assert!(yaml.as_str().contains("name: Personal vault"));
    assert_eq!(
        VaultFormatTestData::read_vault_name(yaml.as_str())?,
        VaultName::Named("Personal vault".to_owned())
    );
    assert_eq!(
        VaultFormatTestData::deserialize_stored_yaml(yaml.as_str())?,
        records
    );

    let renamed = VaultFormatTestData::set_vault_name(yaml.as_str(), "Work vault")?;
    assert_eq!(
        VaultFormatTestData::read_vault_name(renamed.as_str())?,
        VaultName::Named("Work vault".to_owned())
    );
    assert_eq!(
        u64::from(VaultFormatTestData::read_vault_version(renamed.as_str())?),
        1
    );
    assert_eq!(
        VaultFormatTestData::read_vault_store_id(renamed.as_str())?,
        VaultStoreIdentity::Assigned("store_SMypl8K0w9Y".to_owned())
    );
    assert_eq!(
        VaultFormatTestData::deserialize_stored_yaml(renamed.as_str())?,
        records
    );
    Ok(())
}

#[test]
fn unsupported_schema_version_is_rejected() -> anyhow::Result<()> {
    let future = "schema_version: 99\nunlock:\n  type: keys\nsecrets: []\n";
    let err = VaultFormatTestData::deserialize_stored_yaml(future)
        .err()
        .ok_or_else(|| anyhow::anyhow!("vault format test should reject invalid input"))?;
    assert!(matches!(
        err,
        VaultFormatError::UnsupportedSchemaVersion {
            found,
            max_supported
        } if u32::from(found) == 99 && u32::from(max_supported) == 1
    ));
    Ok(())
}
