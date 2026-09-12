//! Provider storage projections preserve the existing string-or-omitted wire shape.
//! Tagged domain serialization remains separate from this persisted projection.
use super::{
    AuthProvidersSnapshotData, LocalFolderConfig, OAuthFileConfig, StorageProviderData,
    StoredLocalFolderConfiguration, StoredOAuthFileConfiguration,
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

pub struct LegacyAuthProvidersSnapshot<'a>(&'a AuthProvidersSnapshotData);
impl Serialize for LegacyAuthProvidersSnapshot<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        let providers: Vec<_> = self.0.providers.iter().map(LegacyStorageProvider).collect();
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
    use crate::{ActiveVaultScope, NormalizedAuthSnapshot, StorageProviderData};

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
}
