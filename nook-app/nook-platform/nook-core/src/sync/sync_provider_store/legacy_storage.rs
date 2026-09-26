//! Provider storage projections preserve the existing string-or-omitted wire shape.
//! Tagged domain serialization remains separate from this persisted projection.
use super::{
    AuthProvidersSnapshotData, LocalFolderConfig, OAuthFileConfig, StorageProviderData,
    StoredGoogleDrivePrivateTarget, StoredLocalFolderConfiguration, StoredOAuthFileConfiguration,
};
use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

struct LegacyOAuthFileConfig<'a>(&'a OAuthFileConfig);
impl Serialize for LegacyOAuthFileConfig<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let config = self.0;
        // serde owns the optional map-length hint.
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("preset", &config.preset)?;
        config.access_token.serialize_storage_field(&mut map)?;
        config.refresh_token.serialize_storage_field(&mut map)?;
        config.expires_at.serialize_storage_field(&mut map)?;
        config.file_id.serialize_storage_field(&mut map)?;
        config.file_name.serialize_storage_field(&mut map)?;
        config.account_email.serialize_storage_field(&mut map)?;
        config.folder_id.serialize_storage_field(&mut map)?;
        config
            .icloud_share_target
            .serialize_storage_field(&mut map)?;
        map.serialize_entry("driveMode", &config.drive_mode)?;
        map.serialize_entry("iCloudMode", &config.icloud_mode)?;
        map.end()
    }
}

struct LegacyLocalFolderConfig<'a>(&'a LocalFolderConfig);
impl Serialize for LegacyLocalFolderConfig<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        self.0.directory_name.serialize_storage_field(&mut map)?;
        self.0.handle_id.serialize_storage_field(&mut map)?;
        map.end()
    }
}

impl StoredOAuthFileConfiguration {
    fn serialize_storage_field<M: SerializeMap>(&self, map: &mut M) -> Result<(), M::Error> {
        match self {
            Self::NotApplicable => Ok(()),
            Self::Configured(config) => {
                map.serialize_entry("oauthFile", &LegacyOAuthFileConfig(config))
            }
        }
    }
}
impl StoredLocalFolderConfiguration {
    fn serialize_storage_field<M: SerializeMap>(&self, map: &mut M) -> Result<(), M::Error> {
        match self {
            Self::NotApplicable => Ok(()),
            Self::Configured(config) => {
                map.serialize_entry("localFolder", &LegacyLocalFolderConfig(config))
            }
        }
    }
}

struct LegacyStorageProvider<'a>(&'a StorageProviderData);
impl LegacyStorageProvider<'_> {
    fn is_rollback_compatible(&self) -> bool {
        match self.0.provider_type {
            crate::StorageProviderType::OauthFile => match &self.0.oauth_file {
                StoredOAuthFileConfiguration::Configured(config) => {
                    Self::oauth_config_is_rollback_compatible(config)
                }
                StoredOAuthFileConfiguration::NotApplicable => true,
            },
            crate::StorageProviderType::Local
            | crate::StorageProviderType::LocalFolder
            | crate::StorageProviderType::Github => true,
        }
    }

    fn oauth_config_is_rollback_compatible(config: &super::OAuthFileConfig) -> bool {
        match (config.preset, config.resolved_google_drive_mode()) {
            (crate::OauthFilePreset::GoogleDrive, crate::GoogleDriveMode::Private) => {
                match &config.drive_private_target {
                    StoredGoogleDrivePrivateTarget::LegacyAppDataFolder => true,
                    StoredGoogleDrivePrivateTarget::Pending
                    | StoredGoogleDrivePrivateTarget::FolderId(_) => false,
                }
            }
            (
                crate::OauthFilePreset::GoogleDrive | crate::OauthFilePreset::ICloud,
                crate::GoogleDriveMode::Shared,
            )
            | (crate::OauthFilePreset::ICloud, crate::GoogleDriveMode::Private) => true,
        }
    }
}
impl Serialize for LegacyStorageProvider<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let provider = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("id", &provider.id)?;
        map.serialize_entry("type", &provider.provider_type)?;
        map.serialize_entry("label", &provider.label)?;
        provider.github_pat.serialize_storage_field(&mut map)?;
        provider.github_repo.serialize_storage_field(&mut map)?;
        provider.oauth_file.serialize_storage_field(&mut map)?;
        provider.local_folder.serialize_storage_field(&mut map)?;
        provider.store_id.serialize_storage_field(&mut map)?;
        map.serialize_entry("syncCheckpoint", &provider.sync_checkpoint)?;
        map.serialize_entry("createdAt", &provider.created_at)?;
        map.end()
    }
}

pub struct LegacyAuthProvidersSnapshot<'a>(&'a AuthProvidersSnapshotData);
impl Serialize for LegacyAuthProvidersSnapshot<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        let providers: Vec<_> = self
            .0
            .providers
            .iter()
            .map(LegacyStorageProvider)
            .filter(LegacyStorageProvider::is_rollback_compatible)
            .collect();
        map.serialize_entry("providers", &providers)?;
        self.0
            .active_vault_store_id
            .serialize_storage_field(&mut map)?;
        map.end()
    }
}
impl AuthProvidersSnapshotData {
    pub fn legacy_storage_snapshot(&self) -> LegacyAuthProvidersSnapshot<'_> {
        LegacyAuthProvidersSnapshot(self)
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshotData, GoogleDriveMode, NormalizedAuthSnapshot,
        OAuthFileConfigData, OauthFilePreset, ProviderSyncCheckpoint, ProviderVaultScope,
        StorageProviderData, StorageProviderType, StoredGoogleDriveFolder,
        StoredGoogleDrivePrivateTarget, StoredLocalFolderConfiguration,
        StoredOAuthFileConfiguration, StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    };
    use serde::{Deserialize, Serialize};

    /// Concrete schema-1 projection contract used by rollback-compatibility
    /// assertions; strict decoding rejects schema-2 fields in the legacy wire.
    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Schema1StorageSnapshot {
        providers: Vec<Schema1StorageProvider>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        active_vault_store_id: Option<String>,
    }

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Schema1StorageProvider {
        id: String,
        #[serde(rename = "type")]
        provider_type: StorageProviderType,
        label: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        github_pat: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        github_repo: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        oauth_file: Option<Schema1OAuthFileConfig>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        local_folder: Option<Schema1LocalFolderConfig>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        store_id: Option<String>,
        sync_checkpoint: ProviderSyncCheckpoint,
        created_at: String,
    }

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Schema1OAuthFileConfig {
        preset: OauthFilePreset,
        access_token: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        refresh_token: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expires_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        account_email: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        folder_id: Option<String>,
        #[serde(
            default,
            rename = "iCloudShareTarget",
            skip_serializing_if = "Option::is_none"
        )]
        icloud_share_target: Option<String>,
        drive_mode: GoogleDriveMode,
        #[serde(rename = "iCloudMode")]
        icloud_mode: crate::ICloudMode,
    }

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Schema1LocalFolderConfig {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        directory_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        handle_id: Option<String>,
    }

    type Schema2StorageSnapshot = AuthProvidersSnapshotData;

    fn schema1_round_trip(
        snapshot: &impl serde::Serialize,
    ) -> anyhow::Result<Schema1StorageSnapshot> {
        let encoded = serde_json::to_vec(snapshot)?;
        let decoded: Schema1StorageSnapshot = serde_json::from_slice(&encoded)?;
        let reencoded = serde_json::to_vec(&decoded)?;
        let round_trip: Schema1StorageSnapshot = serde_json::from_slice(&reencoded)?;
        assert_eq!(round_trip, decoded);
        Ok(decoded)
    }

    fn drive_provider(id: &str, target: StoredGoogleDrivePrivateTarget) -> StorageProviderData {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            drive_mode: GoogleDriveMode::Private,
            file_id: StoredOAuthRemoteFileId::FileId(format!("old-file-{id}")),
            file_name: StoredOAuthRemoteFileName::FileName(format!("{id}.yaml")),
            drive_private_target: target,
            ..OAuthFileConfigData::default()
        };
        StorageProviderData {
            id: id.to_owned(),
            provider_type: StorageProviderType::OauthFile,
            label: id.to_owned(),
            github_pat: crate::StoredGithubPat::Missing,
            github_repo: crate::StoredGithubRepository::DefaultRepository,
            oauth_file: StoredOAuthFileConfiguration::configured(config),
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
            created_at: "now".to_owned(),
        }
    }

    fn shared_drive_provider() -> StorageProviderData {
        let mut provider = drive_provider(
            "shared",
            StoredGoogleDrivePrivateTarget::LegacyAppDataFolder,
        );
        if let StoredOAuthFileConfiguration::Configured(config) = &mut provider.oauth_file {
            config.drive_mode = GoogleDriveMode::Shared;
            config.folder_id = StoredGoogleDriveFolder::FolderId("shared-folder-id".to_owned());
        }
        provider
    }

    #[test]
    fn semantic_states_project_to_the_rollback_safe_wire_shape() -> anyhow::Result<()> {
        let snapshot = crate::AuthProvidersSnapshotData {
            providers: vec![StorageProviderData::github(
                "github",
                "GitHub",
                "sealed-token",
                "owner/repo",
                "2026-07-29T00:00:00.000Z",
            )],
            active_vault_store_id: ActiveVaultScope::StoreId("store-1".to_owned()),
        };

        let legacy_json = serde_json::to_vec(&snapshot.legacy_storage_snapshot())?;
        let typed_legacy: Schema1StorageSnapshot = serde_json::from_slice(&legacy_json)?;
        assert_eq!(typed_legacy.providers.len(), 1);
        let round_trip = NormalizedAuthSnapshot::from(serde_json::from_slice::<serde_json::Value>(
            &legacy_json,
        )?)
        .snapshot;
        assert_eq!(round_trip, snapshot);
        Ok(())
    }

    #[test]
    fn schema_one_migration_preserves_file_id_and_defaults_private_drive_to_legacy_root()
    -> anyhow::Result<()> {
        let snapshot = crate::AuthProvidersSnapshotData {
            providers: vec![drive_provider(
                "legacy",
                StoredGoogleDrivePrivateTarget::LegacyAppDataFolder,
            )],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        let legacy = schema1_round_trip(&snapshot.legacy_storage_snapshot())?;
        let legacy_provider = legacy
            .providers
            .first()
            .ok_or_else(|| anyhow::anyhow!("legacy Drive provider should be present"))?;
        let oauth_file = legacy_provider
            .oauth_file
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("schema-1 Drive provider should include oauthFile"))?;
        assert_eq!(oauth_file.file_id.as_deref(), Some("old-file-legacy"));
        // The schema-1 contract rejects unknown fields, so successful decoding
        // also proves that drivePrivateTarget is omitted from the legacy wire.

        let legacy_json = serde_json::to_vec(&snapshot.legacy_storage_snapshot())?;
        let migrated = NormalizedAuthSnapshot::from(serde_json::from_slice::<serde_json::Value>(
            &legacy_json,
        )?);
        let migrated_provider = migrated
            .snapshot
            .providers
            .first()
            .ok_or_else(|| anyhow::anyhow!("migrated Drive provider should be present"))?;
        let StoredOAuthFileConfiguration::Configured(config) = &migrated_provider.oauth_file else {
            panic!("expected configured Drive provider")
        };
        assert_eq!(
            config.file_id,
            StoredOAuthRemoteFileId::FileId("old-file-legacy".to_owned())
        );
        assert_eq!(
            config.drive_private_target,
            StoredGoogleDrivePrivateTarget::LegacyAppDataFolder
        );
        Ok(())
    }

    #[test]
    fn schema_one_rollback_projection_omits_only_new_private_folder_targets() -> anyhow::Result<()>
    {
        let snapshot = crate::AuthProvidersSnapshotData {
            providers: vec![
                drive_provider(
                    "legacy",
                    StoredGoogleDrivePrivateTarget::LegacyAppDataFolder,
                ),
                shared_drive_provider(),
                drive_provider("pending", StoredGoogleDrivePrivateTarget::Pending),
                drive_provider(
                    "new-target",
                    StoredGoogleDrivePrivateTarget::FolderId("stable-folder-id".to_owned()),
                ),
            ],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };

        let legacy = schema1_round_trip(&snapshot.legacy_storage_snapshot())?;
        let ids = legacy
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["legacy", "shared"]);
        let legacy_provider = legacy
            .providers
            .first()
            .ok_or_else(|| anyhow::anyhow!("legacy private Drive provider should be present"))?;
        let oauth_file = legacy_provider.oauth_file.as_ref().ok_or_else(|| {
            anyhow::anyhow!("legacy private Drive provider should include oauthFile")
        })?;
        assert_eq!(oauth_file.file_id.as_deref(), Some("old-file-legacy"));
        Ok(())
    }

    #[test]
    fn schema_two_snapshot_keeps_the_private_folder_target_typed() -> anyhow::Result<()> {
        let snapshot = crate::AuthProvidersSnapshotData {
            providers: vec![drive_provider(
                "new-target",
                StoredGoogleDrivePrivateTarget::FolderId("stable-folder-id".to_owned()),
            )],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };

        let encoded = serde_json::to_vec(&snapshot)?;
        let round_trip: Schema2StorageSnapshot = serde_json::from_slice(&encoded)?;
        assert_eq!(round_trip, snapshot);
        let provider = round_trip
            .providers
            .first()
            .ok_or_else(|| anyhow::anyhow!("schema-2 Drive provider should be present"))?;
        let StoredOAuthFileConfiguration::Configured(config) = &provider.oauth_file else {
            anyhow::bail!("schema-2 Drive provider should include typed oauthFile config");
        };
        assert_eq!(
            config.drive_private_target,
            StoredGoogleDrivePrivateTarget::FolderId("stable-folder-id".to_owned())
        );
        Ok(())
    }
}
