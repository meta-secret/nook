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

fn rollback_compatible(provider: &StorageProviderData) -> bool {
    if provider.provider_type != crate::StorageProviderType::OauthFile {
        return true;
    }
    let StoredOAuthFileConfiguration::Configured(config) = &provider.oauth_file else {
        return true;
    };
    config.preset != crate::OauthFilePreset::GoogleDrive
        || config.resolved_google_drive_mode() != crate::GoogleDriveMode::Private
        || matches!(
            &config.drive_private_target,
            StoredGoogleDrivePrivateTarget::LegacyAppDataFolder
        )
}

pub struct LegacyAuthProvidersSnapshot<'a>(&'a AuthProvidersSnapshotData);
impl Serialize for LegacyAuthProvidersSnapshot<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        let providers: Vec<_> = self
            .0
            .providers
            .iter()
            .filter(|provider| rollback_compatible(provider))
            .map(LegacyStorageProvider)
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
        ActiveVaultScope, GoogleDriveMode, NormalizedAuthSnapshot, OAuthFileConfigData,
        OauthFilePreset, ProviderVaultScope, StorageProviderData, StorageProviderType,
        StoredGoogleDriveFolder, StoredGoogleDrivePrivateTarget, StoredLocalFolderConfiguration,
        StoredOAuthFileConfiguration, StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    };

    fn drive_provider(id: &str, target: StoredGoogleDrivePrivateTarget) -> StorageProviderData {
        let mut config = OAuthFileConfigData::default();
        config.preset = OauthFilePreset::GoogleDrive;
        config.drive_mode = GoogleDriveMode::Private;
        config.file_id = StoredOAuthRemoteFileId::FileId(format!("old-file-{id}"));
        config.file_name = StoredOAuthRemoteFileName::FileName(format!("{id}.yaml"));
        config.drive_private_target = target;
        StorageProviderData {
            id: id.to_owned(),
            provider_type: StorageProviderType::OauthFile,
            label: id.to_owned(),
            github_pat: crate::StoredGithubPat::Missing,
            github_repo: crate::StoredGithubRepository::DefaultRepository,
            oauth_file: StoredOAuthFileConfiguration::Configured(config),
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

        let value = serde_json::to_value(snapshot.legacy_storage_snapshot())?;
        let round_trip = NormalizedAuthSnapshot::from(value).snapshot;
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
        let value = serde_json::to_value(snapshot.legacy_storage_snapshot())?;
        let raw_file_id = value["providers"][0]["oauthFile"]["fileId"].as_str();
        assert_eq!(raw_file_id, Some("old-file-legacy"));
        assert!(value["providers"][0]["oauthFile"]["drivePrivateTarget"].is_null());

        let migrated = NormalizedAuthSnapshot::from(value);
        let StoredOAuthFileConfiguration::Configured(config) =
            &migrated.snapshot.providers[0].oauth_file
        else {
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

        let value = serde_json::to_value(snapshot.legacy_storage_snapshot())?;
        let ids = value["providers"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("providers should be an array"))?
            .iter()
            .filter_map(|provider| provider["id"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["legacy", "shared"]);
        assert_eq!(
            value["providers"][0]["oauthFile"]["fileId"].as_str(),
            Some("old-file-legacy")
        );
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

        let value = serde_json::to_value(&snapshot)?;
        assert_eq!(
            value["providers"][0]["oauthFile"]["config"]["drivePrivateTarget"]["state"],
            "folderId"
        );
        assert_eq!(
            value["providers"][0]["oauthFile"]["config"]["drivePrivateTarget"]["value"],
            "stable-folder-id"
        );
        Ok(())
    }
}
