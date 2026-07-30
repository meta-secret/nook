//! Rollback-safe `nook_auth` storage projection.
//!
//! The Rust domain model uses semantic enums. `IndexedDB` keeps the original
//! string-or-absent wire shape so an older deployed build can still read rows
//! after a rollback. A future incompatible wire change must use a new schema
//! version and an explicit forward/backward migration.

use serde::Serialize;

use super::{
    AuthProvidersSnapshotData, LocalFolderConfig, OAuthFileConfig, ProviderSyncCheckpoint,
    StorageProviderData,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyOAuthFileConfig<'a> {
    preset: &'a crate::OauthFilePreset,
    access_token: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    refresh_token: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_email: Option<&'a str>,
    drive_mode: &'a crate::GoogleDriveMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    folder_id: Option<&'a str>,
    #[serde(rename = "iCloudMode")]
    icloud_mode: &'a crate::ICloudMode,
    #[serde(rename = "iCloudShareTarget", skip_serializing_if = "Option::is_none")]
    icloud_share_target: Option<&'a str>,
}

impl<'a> From<&'a OAuthFileConfig> for LegacyOAuthFileConfig<'a> {
    fn from(config: &'a OAuthFileConfig) -> Self {
        Self {
            preset: &config.preset,
            access_token: config.access_token.as_deref().unwrap_or_default(),
            refresh_token: config.refresh_token.as_deref(),
            expires_at: config.expires_at.as_deref(),
            file_id: config.file_id.as_deref(),
            file_name: config.file_name.as_deref(),
            account_email: config.account_email.as_deref(),
            drive_mode: &config.drive_mode,
            folder_id: config.folder_id.as_deref(),
            icloud_mode: &config.icloud_mode,
            icloud_share_target: config.icloud_share_target.as_deref(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyLocalFolderConfig<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    directory_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    handle_id: Option<&'a str>,
}

impl<'a> From<&'a LocalFolderConfig> for LegacyLocalFolderConfig<'a> {
    fn from(config: &'a LocalFolderConfig) -> Self {
        Self {
            directory_name: config.directory_name.as_deref(),
            handle_id: config.handle_id.as_deref(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStorageProvider<'a> {
    id: &'a str,
    #[serde(rename = "type")]
    provider_type: &'a crate::StorageProviderType,
    label: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    github_pat: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    github_repo: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    oauth_file: Option<LegacyOAuthFileConfig<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    local_folder: Option<LegacyLocalFolderConfig<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    store_id: Option<&'a str>,
    sync_checkpoint: &'a ProviderSyncCheckpoint,
    created_at: &'a str,
}

impl<'a> From<&'a StorageProviderData> for LegacyStorageProvider<'a> {
    fn from(provider: &'a StorageProviderData) -> Self {
        Self {
            id: &provider.id,
            provider_type: &provider.provider_type,
            label: &provider.label,
            github_pat: provider.github_pat.as_deref(),
            github_repo: provider.github_repo.as_deref(),
            oauth_file: provider.oauth_file.as_ref().map(Into::into),
            local_folder: provider.local_folder.as_ref().map(Into::into),
            store_id: provider.store_id.as_deref(),
            sync_checkpoint: &provider.sync_checkpoint,
            created_at: &provider.created_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAuthProvidersSnapshot<'a> {
    providers: Vec<LegacyStorageProvider<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_vault_store_id: Option<&'a str>,
}

pub fn auth_snapshot_legacy_storage_value(
    snapshot: &AuthProvidersSnapshotData,
) -> Result<serde_json::Value, serde_json::Error> {
    serde_json::to_value(LegacyAuthProvidersSnapshot {
        providers: snapshot.providers.iter().map(Into::into).collect(),
        active_vault_store_id: snapshot.active_vault_store_id.as_deref(),
    })
}

#[cfg(test)]
mod tests {
    use super::auth_snapshot_legacy_storage_value;

    #[test]
    fn semantic_states_project_to_the_rollback_safe_wire_shape() -> anyhow::Result<()> {
        let snapshot = crate::AuthProvidersSnapshotData {
            providers: vec![crate::StorageProviderData::github(
                "github",
                "GitHub",
                "sealed-token",
                "owner/repo",
                "2026-07-29T00:00:00.000Z",
            )],
            active_vault_store_id: crate::ActiveVaultScope::StoreId("store-1".to_owned()),
        };

        let value = auth_snapshot_legacy_storage_value(&snapshot)?;
        let round_trip = crate::normalize_auth_snapshot(&value).snapshot;
        assert_eq!(round_trip, snapshot);
        Ok(())
    }
}
