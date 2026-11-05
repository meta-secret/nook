//! Owned parsing and serialization actions for the persisted vault format.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::{VaultFormatError, VaultFormatResult};
use crate::vault_wire::{StoredVaultBlob, StoredVaultYaml as VaultYamlBlob};
use crate::{StoredSecretRecord, VaultArchitecture, VaultSchemaVersion};

mod model;
mod vault_yaml;

pub use model::*;
use vault_yaml::StoredVaultYaml;

/// Borrowed persisted vault content with owned format transitions.
pub struct VaultFormatDocument<'a> {
    stored: &'a str,
}

impl<'a> VaultFormatDocument<'a> {
    #[must_use]
    pub const fn new(stored: &'a str) -> Self {
        Self { stored }
    }

    /// Detect the persisted representation without accepting arbitrary JSON.
    pub fn detect(&self) -> VaultFormatResult<VaultFormat> {
        let trimmed = self.stored.trim();
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
        {
            return Ok(VaultFormat::Yaml);
        }

        Err(VaultFormatError::UnrecognizedFormat {
            first_line: first_line.to_owned(),
        })
    }

    /// Maximum projection YAML schema this build reads and writes.
    #[must_use]
    pub const fn current_schema_version() -> VaultSchemaVersion {
        VaultSchemaVersion::CURRENT
    }

    /// Cheap parse of top-level `schema_version` (missing → `1`).
    pub fn schema_version(&self) -> VaultFormatResult<VaultSchemaVersion> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok(1.into());
        }
        self.detect()?;
        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseVersion)?;
        Ok(vault.schema_version.into())
    }

    /// Read the human-readable vault label from on-disk YAML.
    pub fn name(&self) -> VaultFormatResult<VaultName> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok(VaultName::Unnamed);
        }
        self.detect()?;
        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseName)?;
        VaultSchemaVersion::from(vault.schema_version).ensure_supported()?;
        Ok(match vault.name {
            VaultName::Named(name) => VaultName::from_named(&name),
            VaultName::Unnamed => VaultName::Unnamed,
        })
    }

    /// Replace the human-readable vault label without decrypting records.
    pub fn rename(self, name: &str) -> VaultFormatResult<VaultYamlBlob> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Err(VaultFormatError::YamlMissingSections);
        }
        self.detect()?;
        let mut vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseName)?;
        VaultSchemaVersion::from(vault.schema_version).ensure_supported()?;
        vault.name = VaultName::from_named(name);
        serde_yaml::to_string(&vault)
            .map(VaultYamlBlob::from_trusted)
            .map_err(VaultFormatError::YamlSerialize)
    }

    /// Read the monotonic revision counter from on-disk YAML.
    pub fn version(&self) -> VaultFormatResult<crate::VaultVersion> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok(0.into());
        }
        self.detect()?;
        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseVersion)?;
        VaultSchemaVersion::from(vault.schema_version).ensure_supported()?;
        Ok(vault.vault_version.into())
    }

    /// Read the logical secret-store id from on-disk YAML.
    pub fn store_id(&self) -> VaultFormatResult<VaultStoreIdentity> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok(VaultStoreIdentity::Unassigned);
        }
        self.detect()?;
        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseStoreId)?;
        VaultSchemaVersion::from(vault.schema_version).ensure_supported()?;
        match vault.store_id {
            VaultStoreIdentity::Assigned(id) => Ok(VaultStoreIdentity::Assigned(
                crate::StoreId::parse(&id)?.to_string(),
            )),
            VaultStoreIdentity::Unassigned => Ok(VaultStoreIdentity::Unassigned),
        }
    }

    /// Read grouped architecture metadata from on-disk YAML.
    pub fn architecture(&self) -> VaultFormatResult<VaultArchitecture> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok(VaultArchitecture::default());
        }
        self.detect()?;
        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseArchitecture)?;
        VaultSchemaVersion::from(vault.schema_version).ensure_supported()?;
        vault.architecture.validate()?;
        Ok(vault.architecture)
    }

    /// Deserialize records using the selected persisted format.
    pub fn deserialize(&self, format: VaultFormat) -> VaultFormatResult<Vec<StoredSecretRecord>> {
        match format {
            VaultFormat::Yaml => self.deserialize_yaml(),
        }
    }

    /// Deserialize records from YAML.
    pub fn deserialize_yaml(&self) -> VaultFormatResult<Vec<StoredSecretRecord>> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(|_| VaultFormatError::YamlMissingSections)?;
        VaultSchemaVersion::from(vault.schema_version).ensure_supported()?;
        vault.into_stored_records()
    }
}

/// Record collection that owns serialization options at the format boundary.
pub struct VaultRecordSet {
    records: Vec<StoredSecretRecord>,
}

impl VaultRecordSet {
    #[must_use]
    pub fn new(records: &[StoredSecretRecord]) -> Self {
        Self {
            records: records.to_vec(),
        }
    }

    /// Serialize records using the selected persisted format.
    pub fn write(&self, format: VaultFormat) -> VaultFormatResult<StoredVaultBlob> {
        match format {
            VaultFormat::Yaml => self.write_yaml().map(StoredVaultBlob::Yaml),
        }
    }

    pub fn write_yaml(&self) -> VaultFormatResult<VaultYamlBlob> {
        self.write_yaml_with_store(
            VaultStoreIdentityRef::Unassigned,
            VaultVersionWrite::Initial,
        )
    }

    pub fn write_yaml_with_store(
        &self,
        store_id: VaultStoreIdentityRef<'_>,
        vault_version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        self.write_yaml_with_name(store_id, VaultNameRef::Unnamed, vault_version)
    }

    pub fn write_yaml_with_name(
        &self,
        store_id: VaultStoreIdentityRef<'_>,
        vault_name: VaultNameRef<'_>,
        vault_version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        self.write_yaml_with_name_architecture(
            store_id,
            vault_name,
            vault_version,
            &VaultArchitecture::default(),
        )
    }

    pub fn write_yaml_with_name_architecture(
        &self,
        store_id: VaultStoreIdentityRef<'_>,
        vault_name: VaultNameRef<'_>,
        vault_version: VaultVersionWrite,
        architecture: &VaultArchitecture,
    ) -> VaultFormatResult<VaultYamlBlob> {
        architecture.validate_records(&self.records)?;
        let mut vault = StoredVaultYaml::from_records(&self.records)?;
        vault.schema_version = VaultFormatDocument::current_schema_version().into();
        vault.vault_version = match vault_version {
            VaultVersionWrite::Initial => 0,
            VaultVersionWrite::Version(version) => version.into(),
        };
        vault.store_id = Self::resolve_store_id(store_id)?;
        vault.name = VaultName::from_ref(vault_name);
        vault.architecture = architecture.clone();
        serde_yaml::to_string(&vault)
            .map(VaultYamlBlob::from_trusted)
            .map_err(VaultFormatError::YamlSerialize)
    }

    fn resolve_store_id(
        store_id: VaultStoreIdentityRef<'_>,
    ) -> VaultFormatResult<VaultStoreIdentity> {
        match store_id {
            VaultStoreIdentityRef::Assigned(id) if !id.trim().is_empty() => Ok(
                VaultStoreIdentity::Assigned(crate::StoreId::parse(id.trim())?.to_string()),
            ),
            VaultStoreIdentityRef::Unassigned | VaultStoreIdentityRef::Assigned(_) => {
                Ok(VaultStoreIdentity::Unassigned)
            }
        }
    }

    pub fn serialize(
        records: &[StoredSecretRecord],
        format: VaultFormat,
    ) -> VaultFormatResult<StoredVaultBlob> {
        Self::new(records).write(format)
    }

    pub fn serialize_yaml(records: &[StoredSecretRecord]) -> VaultFormatResult<VaultYamlBlob> {
        Self::new(records).write_yaml()
    }

    pub fn serialize_yaml_with_store(
        records: &[StoredSecretRecord],
        store_id: VaultStoreIdentityRef<'_>,
        vault_version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        Self::new(records).write_yaml_with_store(store_id, vault_version)
    }

    pub fn serialize_yaml_with_name(
        records: &[StoredSecretRecord],
        store_id: VaultStoreIdentityRef<'_>,
        vault_name: VaultNameRef<'_>,
        vault_version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        Self::new(records).write_yaml_with_name(store_id, vault_name, vault_version)
    }

    pub fn serialize_yaml_with_name_architecture(
        records: &[StoredSecretRecord],
        store_id: VaultStoreIdentityRef<'_>,
        vault_name: VaultNameRef<'_>,
        vault_version: VaultVersionWrite,
        architecture: &VaultArchitecture,
    ) -> VaultFormatResult<VaultYamlBlob> {
        Self::new(records).write_yaml_with_name_architecture(
            store_id,
            vault_name,
            vault_version,
            architecture,
        )
    }
}

impl VaultStoreIdentity {
    #[must_use]
    pub fn default_name_for_store_id(store_id: &str) -> String {
        let suffix = store_id
            .rsplit('_')
            .next()
            .filter(|part| !part.is_empty())
            .unwrap_or(store_id);
        format!("Vault {suffix}")
    }
}

impl VaultName {
    fn from_named(value: &str) -> Self {
        match value.trim() {
            value if !value.is_empty() => Self::Named(value.to_owned()),
            _ => Self::Unnamed,
        }
    }

    fn from_ref(value: VaultNameRef<'_>) -> Self {
        match value {
            VaultNameRef::Named(value) => Self::from_named(value),
            VaultNameRef::Unnamed => Self::Unnamed,
        }
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module, clippy::unnecessary_wraps)]
mod tests {
    use crate::RecordTypeDeclaration;
    use crate::{DeviceMode, ReplicationType, SecretType, SentinelConfiguration, VaultType};

    use std::{error, io};

    use super::*;
    use crate::{SecretId, StoredRecordPayload};

    type TestResult = Result<(), Box<dyn error::Error>>;

    struct VaultFormatTestData;

    impl VaultFormatTestData {
        fn sid(label: &str) -> SecretId {
            SecretId::from_vault_record(label)
        }

        fn sample_records() -> Vec<StoredSecretRecord> {
            vec![
                    StoredSecretRecord {
                        key: Self::sid("github.com"),
                        secret_type: RecordTypeDeclaration::Secret(SecretType::Login),
                        value: StoredRecordPayload::from_trusted(
                            "-----BEGIN AGE ENCRYPTED FILE-----\nline1\nline2\n-----END AGE ENCRYPTED FILE-----"
                                .to_owned(),
                        ),
                    },
                    StoredSecretRecord {
                        key: Self::sid("work-vpn"),
                        secret_type: RecordTypeDeclaration::Secret(SecretType::ApiKey),
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

        fn serialize_stored_yaml(
            records: &[StoredSecretRecord],
        ) -> VaultFormatResult<VaultYamlBlob> {
            VaultRecordSet::serialize_yaml(records)
        }

        fn serialize_stored_yaml_with_store(
            records: &[StoredSecretRecord],
            store_id: VaultStoreIdentityRef<'_>,
            version: VaultVersionWrite,
        ) -> VaultFormatResult<VaultYamlBlob> {
            VaultRecordSet::serialize_yaml_with_store(records, store_id, version)
        }

        fn serialize_stored_yaml_with_name(
            records: &[StoredSecretRecord],
            store_id: VaultStoreIdentityRef<'_>,
            name: VaultNameRef<'_>,
            version: VaultVersionWrite,
        ) -> VaultFormatResult<VaultYamlBlob> {
            VaultRecordSet::serialize_yaml_with_name(records, store_id, name, version)
        }

        fn serialize_stored_yaml_with_name_architecture(
            records: &[StoredSecretRecord],
            store_id: VaultStoreIdentityRef<'_>,
            name: VaultNameRef<'_>,
            version: VaultVersionWrite,
            architecture: &VaultArchitecture,
        ) -> VaultFormatResult<VaultYamlBlob> {
            VaultRecordSet::serialize_yaml_with_name_architecture(
                records,
                store_id,
                name,
                version,
                architecture,
            )
        }

        fn deserialize_stored_yaml(stored: &str) -> VaultFormatResult<Vec<StoredSecretRecord>> {
            VaultFormatDocument::new(stored).deserialize_yaml()
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
    fn yaml_roundtrip_stored_records() -> TestResult {
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
    fn detect_yaml_and_reject_json_objects() -> TestResult {
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
    fn detect_empty_defaults_to_yaml() -> TestResult {
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
    fn detect_yaml_document_header() -> TestResult {
        assert_eq!(
            VaultFormatTestData::detect_stored_format("%YAML 1.2\n---\nsecrets: []\n")?,
            VaultFormat::Yaml
        );
        Ok(())
    }

    #[test]
    fn detect_unrecognized_format_fails() -> TestResult {
        assert!(VaultFormatTestData::detect_stored_format("not a vault file").is_err());
        assert!(VaultFormatTestData::detect_stored_format("key: value").is_err());
        Ok(())
    }

    #[test]
    fn empty_stored_records_roundtrip_yaml() -> TestResult {
        let stored = VaultFormatTestData::serialize_stored(&[], VaultFormat::Yaml)?;
        let parsed = VaultFormatTestData::deserialize_stored(stored.as_str(), VaultFormat::Yaml)?;
        assert!(parsed.is_empty());
        assert!(VaultFormatTestData::deserialize_stored_yaml("")?.is_empty());
        assert!(VaultFormatTestData::deserialize_stored_yaml("  \n")?.is_empty());
        Ok(())
    }

    #[test]
    fn yaml_requires_secrets_auth_joins_sections() -> TestResult {
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
    fn serialize_stored_matches_format_specific_helpers() -> TestResult {
        let records = VaultFormatTestData::sample_records();
        assert_eq!(
            VaultFormatTestData::serialize_stored(&records, VaultFormat::Yaml)?.as_str(),
            VaultFormatTestData::serialize_stored_yaml(&records)?.as_str()
        );
        Ok(())
    }

    #[test]
    fn yaml_preserves_multiline_armored_value_exactly() -> TestResult {
        let records = VaultFormatTestData::sample_records();
        let stored = VaultFormatTestData::serialize_stored_yaml(&records)?;
        let parsed = VaultFormatTestData::deserialize_stored_yaml(stored.as_str())?;

        let parsed_record = parsed
            .first()
            .unwrap_or_else(|| panic!("parsed fixture must contain one record"));
        let source_record = records
            .first()
            .unwrap_or_else(|| panic!("source fixture must contain one record"));
        assert_eq!(parsed_record.value, source_record.value);
        assert!(parsed_record.value.as_str().contains('\n'));
        Ok(())
    }

    #[test]
    fn yaml_accepts_root_sequence_format_detection_only() -> TestResult {
        assert_eq!(
            VaultFormatTestData::detect_stored_format("- key: a\n  value: b\n")?,
            VaultFormat::Yaml
        );
        assert!(VaultFormatTestData::deserialize_stored_yaml("- key: a\n  value: b\n").is_err());
        Ok(())
    }

    #[test]
    fn serialize_empty_yaml_has_secrets_key() -> TestResult {
        let stored = VaultFormatTestData::serialize_stored_yaml(&[])?;
        assert!(stored.as_str().contains("secrets:"));
        assert!(!stored.as_str().contains("auth:"));
        assert!(VaultFormatTestData::deserialize_stored_yaml(stored.as_str())?.is_empty());
        Ok(())
    }

    #[test]
    fn yaml_carries_only_device_key_access() -> TestResult {
        let records = VaultFormatTestData::sample_records();
        let yaml = VaultFormatTestData::serialize_stored_yaml(&records)?;
        assert!(!yaml.as_str().contains("unlock:"));
        assert!(!yaml.as_str().contains("envelope:"));

        assert_eq!(
            VaultFormatTestData::deserialize_stored_yaml(yaml.as_str())?,
            records
        );
        Ok(())
    }

    #[test]
    fn store_id_roundtrip() -> TestResult {
        let records = VaultFormatTestData::sample_records();
        let yaml = VaultFormatTestData::serialize_stored_yaml_with_store(
            &records,
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
    fn architecture_roundtrips_when_explicit() -> TestResult {
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
        let yaml = VaultFormatTestData::serialize_stored_yaml_with_name_architecture(
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
    fn invalid_architecture_metadata_is_rejected() -> TestResult {
        let invalid = concat!(
            "schema_version: 1\n",
            "store_id: store_SMypl8K0w9Y\n",
            "architecture:\n",
            "  vault_type: simple\n",
            "  sentinel:\n",
            "    threshold: 2\n",
            "    required_participants: 3\n",
            "secrets: []\n",
        );
        assert!(VaultFormatTestData::read_vault_architecture(invalid).is_err());
        Ok(())
    }

    #[test]
    fn unknown_architecture_mode_reports_stable_validation_key() -> TestResult {
        use error::Error;

        let invalid = concat!(
            "schema_version: 1\n",
            "store_id: store_SMypl8K0w9Y\n",
            "architecture:\n",
            "  device_mode: future-device-mode\n",
            "  vault_type: simple\n",
            "  replication_type: personal\n",
            "secrets: []\n",
        );
        let error = VaultFormatTestData::read_vault_architecture(invalid)
            .err()
            .ok_or_else(|| io::Error::other("vault format test should reject invalid input"))?;
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
    fn vault_name_roundtrip_and_update() -> TestResult {
        let records = VaultFormatTestData::sample_records();
        let yaml = VaultFormatTestData::serialize_stored_yaml_with_name(
            &records,
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
    fn unsupported_schema_version_is_rejected() -> TestResult {
        let future = "schema_version: 99\nsecrets: []\n";
        let err = VaultFormatTestData::deserialize_stored_yaml(future)
            .err()
            .ok_or_else(|| io::Error::other("vault format test should reject invalid input"))?;
        assert!(matches!(
            err,
            VaultFormatError::UnsupportedSchemaVersion {
                found,
                max_supported
            } if u32::from(found) == 99 && u32::from(max_supported) == 1
        ));
        Ok(())
    }
}

impl VaultSchemaVersion {
    fn ensure_supported(self) -> VaultFormatResult<()> {
        if self != Self::CURRENT {
            return Err(VaultFormatError::UnsupportedSchemaVersion {
                found: self,
                max_supported: Self::CURRENT,
            });
        }
        Ok(())
    }
}
