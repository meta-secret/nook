//! Owned parsing and serialization actions for the persisted vault format.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::{VaultFormatError, VaultFormatResult};
use crate::vault_wire::{StoredVaultBlob, StoredVaultYaml as VaultYamlBlob};
use crate::{
    PasswordUnlockEntry, StoredSecretRecord, VaultArchitecture, VaultSchemaVersion, VaultUnlock,
};

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
            || first_line.starts_with("unlock:")
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

    fn ensure_supported_schema(version: VaultSchemaVersion) -> VaultFormatResult<()> {
        if version != Self::current_schema_version() {
            return Err(VaultFormatError::UnsupportedSchemaVersion {
                found: version,
                max_supported: Self::current_schema_version(),
            });
        }
        Ok(())
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
        Self::ensure_supported_schema(vault.schema_version.into())?;
        Ok(match vault.name {
            Some(name) => VaultName::from_named(&name),
            None => VaultName::Unnamed,
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
        Self::ensure_supported_schema(vault.schema_version.into())?;
        vault.name = match VaultName::from_named(name) {
            VaultName::Named(name) => Some(name),
            VaultName::Unnamed => None,
        };
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
        Self::ensure_supported_schema(vault.schema_version.into())?;
        Ok(vault.vault_version.into())
    }

    /// Read labelled backup passwords without unwinding the full record list.
    pub fn password_entries(&self) -> VaultFormatResult<Vec<PasswordUnlockEntry>> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        self.detect()?;
        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParsePasswordEntries)?;
        Self::ensure_supported_schema(vault.schema_version.into())?;
        Ok(vault.password_entries)
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
        Self::ensure_supported_schema(vault.schema_version.into())?;
        match vault.store_id {
            Some(id) => Ok(VaultStoreIdentity::Assigned(
                crate::validate_store_id(&id)?.to_string(),
            )),
            None => Ok(VaultStoreIdentity::Unassigned),
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
        Self::ensure_supported_schema(vault.schema_version.into())?;
        vault.architecture.validate()?;
        Ok(vault.architecture)
    }

    /// Read just the active unlock mode without unwinding the full record list.
    pub fn unlock(&self) -> VaultFormatResult<VaultUnlock> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok(VaultUnlock::Keys);
        }
        self.detect()?;
        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(VaultFormatError::YamlParseUnlock)?;
        Self::ensure_supported_schema(vault.schema_version.into())?;
        Ok(vault.unlock)
    }

    /// Deserialize records using the selected persisted format.
    pub fn deserialize(&self, format: VaultFormat) -> VaultFormatResult<Vec<StoredSecretRecord>> {
        match format {
            VaultFormat::Yaml => self.deserialize_yaml(),
        }
    }

    /// Deserialize records from YAML and retain the active unlock mode.
    pub fn deserialize_yaml_with_unlock(
        &self,
    ) -> VaultFormatResult<(Vec<StoredSecretRecord>, VaultUnlock)> {
        let trimmed = self.stored.trim();
        if trimmed.is_empty() {
            return Ok((Vec::new(), VaultUnlock::Keys));
        }

        let vault: StoredVaultYaml =
            serde_yaml::from_str(trimmed).map_err(|_| VaultFormatError::YamlMissingSections)?;
        Self::ensure_supported_schema(vault.schema_version.into())?;
        let unlock = vault.unlock.clone();
        let records = vault.into_stored_records()?;
        Ok((records, unlock))
    }

    /// Deserialize records from YAML.
    pub fn deserialize_yaml(&self) -> VaultFormatResult<Vec<StoredSecretRecord>> {
        Ok(self.deserialize_yaml_with_unlock()?.0)
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
        self.write_yaml_with_unlock(
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Unassigned,
            VaultVersionWrite::Initial,
        )
    }

    pub fn write_yaml_with_unlock(
        &self,
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        vault_version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        self.write_yaml_with_unlock_and_name(
            unlock,
            password_entries,
            store_id,
            VaultNameRef::Unnamed,
            vault_version,
        )
    }

    pub fn write_yaml_with_unlock_and_name(
        &self,
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        vault_name: VaultNameRef<'_>,
        vault_version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        self.write_yaml_with_unlock_name_architecture(
            unlock,
            password_entries,
            store_id,
            vault_name,
            vault_version,
            &VaultArchitecture::default(),
        )
    }

    pub fn write_yaml_with_unlock_name_architecture(
        &self,
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        vault_name: VaultNameRef<'_>,
        vault_version: VaultVersionWrite,
        architecture: &VaultArchitecture,
    ) -> VaultFormatResult<VaultYamlBlob> {
        architecture.validate_records(self.records)?;
        let mut vault = StoredVaultYaml::from_records(self.records)?;
        vault.schema_version = VaultFormatDocument::current_schema_version().into();
        vault.vault_version = match vault_version {
            VaultVersionWrite::Initial => 0,
            VaultVersionWrite::Version(version) => version.into(),
        };
        vault.store_id = match Self::resolve_store_id(store_id)? {
            VaultStoreIdentity::Assigned(store_id) => Some(store_id),
            VaultStoreIdentity::Unassigned => None,
        };
        vault.name = match VaultName::from_ref(vault_name) {
            VaultName::Named(name) => Some(name),
            VaultName::Unnamed => None,
        };
        vault.unlock = unlock.normalized_for_write();
        vault.architecture = architecture.clone();
        vault.password_entries = password_entries.to_vec();
        serde_yaml::to_string(&vault)
            .map(VaultYamlBlob::from_trusted)
            .map_err(VaultFormatError::YamlSerialize)
    }

    fn resolve_store_id(
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

    pub fn serialize(
        records: &[StoredSecretRecord],
        format: VaultFormat,
    ) -> VaultFormatResult<StoredVaultBlob> {
        Self::new(records).write(format)
    }

    pub fn serialize_yaml(records: &[StoredSecretRecord]) -> VaultFormatResult<VaultYamlBlob> {
        Self::new(records).write_yaml()
    }

    pub fn serialize_yaml_with_unlock(
        records: &[StoredSecretRecord],
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        vault_version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        Self::new(records).write_yaml_with_unlock(unlock, password_entries, store_id, vault_version)
    }

    pub fn serialize_yaml_with_unlock_and_name(
        records: &[StoredSecretRecord],
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        vault_name: VaultNameRef<'_>,
        vault_version: VaultVersionWrite,
    ) -> VaultFormatResult<VaultYamlBlob> {
        Self::new(records).write_yaml_with_unlock_and_name(
            unlock,
            password_entries,
            store_id,
            vault_name,
            vault_version,
        )
    }

    pub fn serialize_yaml_with_unlock_name_architecture(
        records: &[StoredSecretRecord],
        unlock: &VaultUnlock,
        password_entries: &[PasswordUnlockEntry],
        store_id: VaultStoreIdentityRef<'_>,
        vault_name: VaultNameRef<'_>,
        vault_version: VaultVersionWrite,
        architecture: &VaultArchitecture,
    ) -> VaultFormatResult<VaultYamlBlob> {
        Self::new(records).write_yaml_with_unlock_name_architecture(
            unlock,
            password_entries,
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

impl VaultUnlock {
    fn normalized_for_write(&self) -> Self {
        match self {
            Self::Passwords { .. } | Self::Keys => Self::Keys,
        }
    }
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests;
