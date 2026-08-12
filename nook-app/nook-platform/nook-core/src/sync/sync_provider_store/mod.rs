//! Persisted sync-provider facade plus the pure transforms the web app
//! runs over it (normalize, field migration, local-row seeding, dedup).
//!
//! The browser stores an [`AuthProvidersSnapshotData`] in the `nook_auth`
//! `IndexedDB` database. All shaping of that data lives here so it is unit-tested
//! in Rust; `nook-wasm` owns the `IndexedDB` I/O and device-key sealing, and the
//! web layer keeps only thin call adapters plus i18n presentation.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{ValidationError, ValidationResult};
use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, GoogleDriveMode, ICloudMode,
    ICloudSharedTarget, OauthFilePreset, ProviderReplicationCapability, ReplicationType,
    StorageMode, StorageProviderType, format_drive_storage_ref_raw,
    provider_replication_capability, storage_mode_for_provider, validate_provider_replication,
};

mod active_credentials;
mod catalog;
mod enrollment;
mod legacy_storage;
mod oauth;
mod save;
mod scope;
mod state;
mod storage_args;
mod sync_metadata;

pub use active_credentials::{
    ActiveProviderCredentialsProjection, ActiveProviderCredentialsRequest,
    active_provider_credentials_projection,
};
pub use catalog::{
    ensure_local_provider_row, find_duplicate_sync_provider, localize_provider_label,
    normalize_auth_snapshot, provider_storage_detail, provider_target_key,
};
pub use enrollment::{
    enrollment_provider_for_architecture, enrollment_provider_for_architecture_with_storage_target,
    enrollment_provider_onboarding_type, provider_onboarding_type, shared_grant_provider_id,
};
pub use legacy_storage::auth_snapshot_legacy_storage_value;
pub use oauth::{
    bind_google_drive_shared_folder, google_oauth_tokens_to_config, icloud_oauth_tokens_to_config,
    oauth_remote_storage_ref, set_google_drive_provider_mode, set_icloud_provider_mode,
    update_oauth_remote_ref,
};
pub use save::{
    ProviderSaveOutcome, ProviderSaveRequest, ProviderSaveSetup, apply_provider_save_policy,
};
pub use scope::{
    active_vault_providers, local_provider_for_active_vault, provider_label_by_id,
    providers_visible_while_device_locked, replace_active_vault_provider_grants,
    sync_providers_for_active_vault,
};
pub use state::*;
pub use storage_args::*;
pub use sync_metadata::update_provider_sync_metadata;

/// OAuth-file (Google Drive / iCloud) credential block for a stored provider.
///
/// Field names are `camelCase` on the wire to match the structured-clone object
/// the web layer and e2e seeders read/write directly in `IndexedDB`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct OAuthFileConfig {
    pub preset: OauthFilePreset,
    pub access_token: StoredOAuthAccessCredential,
    pub refresh_token: StoredOAuthRefreshCredential,
    pub expires_at: StoredOAuthTokenExpiry,
    pub file_id: StoredOAuthRemoteFileId,
    pub file_name: StoredOAuthRemoteFileName,
    pub account_email: StoredOAuthAccountIdentity,
    /// Explicit Google Drive provider mode.
    pub drive_mode: GoogleDriveMode,
    /// Shared-mode My Drive folder id (`drive.file` writes plus cross-account
    /// `drive.readonly`). Private-mode
    /// providers leave this unset and continue using `drive.appdata`.
    pub folder_id: StoredGoogleDriveFolder,
    /// Explicit iCloud provider mode.
    #[serde(rename = "iCloudMode")]
    pub icloud_mode: ICloudMode,
    /// Opaque, validated `ICloudSharedTarget` storage id. It contains `CloudKit`
    /// share/zone routing only and never contains an account credential.
    #[serde(rename = "iCloudShareTarget")]
    pub icloud_share_target: StoredICloudShareTarget,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthFileConfigWire {
    preset: OauthFilePreset,
    access_token: StoredOAuthAccessCredential,
    refresh_token: StoredOAuthRefreshCredential,
    expires_at: StoredOAuthTokenExpiry,
    file_id: StoredOAuthRemoteFileId,
    file_name: StoredOAuthRemoteFileName,
    account_email: StoredOAuthAccountIdentity,
    drive_mode: GoogleDriveMode,
    folder_id: StoredGoogleDriveFolder,
    #[serde(rename = "iCloudMode")]
    icloud_mode: ICloudMode,
    #[serde(default, rename = "iCloudShareTarget", alias = "icloudShareTarget")]
    icloud_share_target: StoredICloudShareTarget,
}

impl<'de> Deserialize<'de> for OAuthFileConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = OAuthFileConfigWire::deserialize(deserializer)?;
        Ok(Self {
            preset: wire.preset,
            access_token: wire.access_token,
            refresh_token: wire.refresh_token,
            expires_at: wire.expires_at,
            file_id: wire.file_id,
            file_name: wire.file_name,
            account_email: wire.account_email,
            drive_mode: wire.drive_mode,
            folder_id: wire.folder_id,
            icloud_mode: wire.icloud_mode,
            icloud_share_target: wire.icloud_share_target,
        })
    }
}

pub type OAuthFileConfigData = OAuthFileConfig;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OAuthAccessTokenRef<'a> {
    Missing,
    Available(&'a str),
}

impl OAuthFileConfigData {
    #[must_use]
    pub const fn resolved_google_drive_mode(&self) -> GoogleDriveMode {
        self.drive_mode
    }

    #[must_use]
    pub const fn resolved_icloud_mode(&self) -> ICloudMode {
        self.icloud_mode
    }

    #[must_use]
    pub fn usable_access_token(&self) -> OAuthAccessTokenRef<'_> {
        match self.access_token.as_deref().map(str::trim) {
            Some(token) if !token.is_empty() => OAuthAccessTokenRef::Available(token),
            _ => OAuthAccessTokenRef::Missing,
        }
    }
}

/// Browser-local File System Access folder handle metadata.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct LocalFolderConfig {
    pub directory_name: StoredLocalFolderDirectory,
    pub handle_id: StoredLocalFolderHandle,
}

pub type LocalFolderConfigData = LocalFolderConfig;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderSyncCheckpoint {
    #[default]
    NeverSynced,
    Synced {
        version: ProviderSyncedVaultVersion,
        synced_at: String,
        revision: ProviderSyncRevision,
        common_content_hash: String,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "version", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderSyncedVaultVersion {
    #[default]
    Unknown,
    Version(i64),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "revision", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderSyncRevision {
    #[default]
    Unknown,
    Revision(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderSyncRevisionRef<'a> {
    Unreported,
    Revision(&'a str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManagerStoreScopeRef<'a> {
    Unscoped,
    Store(&'a str),
}

/// One persisted sync provider row.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct StorageProvider {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: StorageProviderType,
    pub label: String,
    pub github_pat: StoredGithubPat,
    pub github_repo: StoredGithubRepository,
    pub oauth_file: StoredOAuthFileConfiguration,
    pub local_folder: StoredLocalFolderConfiguration,
    pub store_id: ProviderVaultScope,
    #[serde(default)]
    pub sync_checkpoint: ProviderSyncCheckpoint,
    pub created_at: String,
}

impl StorageProvider {
    #[must_use]
    pub fn github(id: &str, label: &str, pat: &str, repo: &str, created_at: &str) -> Self {
        Self {
            id: id.to_owned(),
            provider_type: StorageProviderType::Github,
            label: label.to_owned(),
            github_pat: StoredGithubPat::Token(pat.to_owned()),
            github_repo: StoredGithubRepository::Repository(repo.to_owned()),
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: created_at.to_owned(),
        }
    }
}

pub type StorageProviderData = StorageProvider;

/// The full persisted snapshot: provider rows plus the active vault scope.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthProvidersSnapshot {
    pub providers: Vec<StorageProvider>,
    pub active_vault_store_id: ActiveVaultScope,
}

pub type AuthProvidersSnapshotData = AuthProvidersSnapshot;

/// Result of [`normalize_auth_snapshot`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedAuthSnapshot {
    pub snapshot: AuthProvidersSnapshot,
    pub changed: bool,
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;

    fn github_provider(id: &str, repo: &str, pat: &str) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: StorageProviderType::Github,
            label: "GitHub".to_owned(),
            github_pat: crate::StoredGithubPat::Token(pat.to_owned()),
            github_repo: crate::StoredGithubRepository::Repository(repo.to_owned()),
            oauth_file: crate::StoredOAuthFileConfiguration::NotApplicable,
            local_folder: crate::StoredLocalFolderConfiguration::NotApplicable,
            store_id: crate::ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn storage_provider_defaults_missing_legacy_sync_checkpoint() -> anyhow::Result<()> {
        let mut value = serde_json::to_value(github_provider("github", "owner/repo", "pat"))?;
        value
            .as_object_mut()
            .ok_or_else(|| std::io::Error::other("provider must serialize as an object"))?
            .remove("syncCheckpoint");

        let provider: StorageProviderData = serde_json::from_value(value)?;

        assert_eq!(
            provider.sync_checkpoint,
            ProviderSyncCheckpoint::NeverSynced
        );
        Ok(())
    }

    #[test]
    fn legacy_oauth_config_defaults_icloud_target_but_serializes_explicit_state()
    -> serde_json::Result<()> {
        #[derive(Deserialize)]
        struct SerializedTarget {
            #[serde(rename = "iCloudShareTarget")]
            target: crate::StoredICloudShareTarget,
        }

        let mut legacy = serde_json::to_value(OAuthFileConfigData::default())?;
        let object = legacy
            .as_object_mut()
            .ok_or_else(|| serde_json::Error::io(std::io::Error::other("expected object")))?;
        object.remove("iCloudShareTarget");

        let migrated: OAuthFileConfigData = serde_json::from_value(legacy)?;
        assert_eq!(
            migrated.icloud_share_target,
            crate::StoredICloudShareTarget::Personal
        );

        let current: SerializedTarget = serde_json::from_value(serde_json::to_value(migrated)?)?;
        assert_eq!(current.target, crate::StoredICloudShareTarget::Personal);
        Ok(())
    }
}
