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
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, ICloudSharedTarget, OAuthFilePreset,
    OauthFilePreset, ProviderReplicationCapability, ReplicationType, StorageMode,
    StorageProviderType,
};

mod active_credentials;
mod catalog;
mod draft_connection;
pub use draft_connection::{
    DraftStorageConnection, GithubStorageDraft, OAuthStorageDraft, VaultStorageConnection,
};
mod enrollment;
mod identity_mounts;
mod wire;
pub use identity_mounts::{DeviceJoinReach, IdentityMountCapability, ProviderReplicationTarget};
mod oauth;
mod save;
mod scope;
mod selection;
pub use selection::{
    ProviderId, ProviderSelection, ProviderSelectionPolicy, ProviderSelectionRequest,
};
mod staged_connection;
pub use staged_connection::{
    StagedGithubConnection, StagedOAuthConnection, StagedRemoteConnection, StagedStorageConnection,
};
mod state;
mod storage_args;
mod sync_metadata;

pub use active_credentials::{
    ActiveProviderCredentialDraft, ActiveProviderCredentialsProjection,
    ActiveProviderCredentialsRequest, ActiveProviderLoginSetup,
};
pub use catalog::{
    DuplicateCandidatePolicy, DuplicateProviderSelection, LocalProviderRowChange,
    LocalProviderRowOutcome, LocalProviderRowRequest,
};
pub use enrollment::{
    EnrollmentAudience, ProviderEnrollmentRequest, SharedEnrollmentAudience,
    SharedGrantProviderSelection,
};
pub use oauth::{
    GoogleOAuthTokenInput, ICloudOAuthTokenInput, OAuthRemoteConfigurationUpdate,
    OAuthRemoteStorageReference, OAuthStorageReference,
};
pub use save::{ProviderSaveOutcome, ProviderSaveRequest, ProviderSaveSetup};
pub use scope::{
    ActiveVaultProviderRows, LocalProviderSelection, ProviderEventFlushTarget, ProviderRows,
    RemoteEventFlushProviderRequest,
};
pub use state::*;
pub use storage_args::{ProviderLabelLabels, ProviderStorageDetailLabels, StorageConnectArgs};

/// OAuth-file (Google Drive / iCloud) credential block for a stored provider.
///
/// Every OAuth-file provider is shared: Google Drive uses one visible folder
/// whose Drive permissions list the authorized accounts, and iCloud uses one
/// `CloudKit` share whose participants are the authorized accounts. Each
/// account signs in with its own token; tokens are never transferred.
///
/// Field names are `camelCase` on the wire to match the structured-clone object
/// the web layer and e2e seeders read/write directly in `IndexedDB`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Tsify, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthFileConfig {
    pub preset: OAuthFilePreset,
    pub access_token: StoredOAuthAccessCredential,
    pub refresh_token: StoredOAuthRefreshCredential,
    pub expires_at: StoredOAuthTokenExpiry,
    pub file_id: StoredOAuthRemoteFileId,
    pub file_name: StoredOAuthRemoteFileName,
    pub account_email: StoredOAuthAccountIdentity,
    /// Vault My Drive folder id (`drive.file` writes plus cross-account
    /// `drive.readonly`). `Root` until the folder is created or connected.
    pub folder_id: StoredGoogleDriveFolder,
    /// Opaque, validated `ICloudSharedTarget` storage id. It contains `CloudKit`
    /// share/zone routing only and never contains an account credential.
    #[serde(rename = "iCloudShareTarget")]
    pub icloud_share_target: StoredICloudShareTarget,
}

pub type OAuthFileConfigData = OAuthFileConfig;

/// Owned credential snapshot returned to the browser for immediate use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum OAuthAccessToken {
    Missing,
    Available { token: String },
}
impl From<OAuthAccessTokenRef<'_>> for OAuthAccessToken {
    fn from(value: OAuthAccessTokenRef<'_>) -> Self {
        match value {
            OAuthAccessTokenRef::Missing => Self::Missing,
            OAuthAccessTokenRef::Available(token) => Self::Available {
                token: token.to_owned(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum DuplicateSyncProvider {
    Unique,
    Duplicate { provider: Box<StorageProvider> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OAuthAccessTokenRef<'a> {
    Missing,
    Available(&'a str),
}

impl OAuthFileConfigData {
    #[must_use]
    pub fn usable_access_token(&self) -> OAuthAccessTokenRef<'_> {
        match &self.access_token {
            StoredOAuthAccessCredential::AccessToken(token) if !token.trim().is_empty() => {
                OAuthAccessTokenRef::Available(token.trim())
            }
            StoredOAuthAccessCredential::AccessToken(_)
            | StoredOAuthAccessCredential::SignedOut => OAuthAccessTokenRef::Missing,
        }
    }
}

/// Browser-local File System Access folder handle metadata.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct LocalFolderConfig {
    pub directory_name: StoredLocalFolderDirectory,
    pub handle_id: StoredLocalFolderHandle,
}

pub type LocalFolderConfigData = LocalFolderConfig;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
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
pub enum ProviderSyncedVaultVersion {
    #[default]
    Unknown,
    Version(crate::ProviderSyncedVaultVersionValue),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "revision", rename_all = "camelCase")]
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
pub struct AuthProvidersSnapshot {
    pub providers: Vec<StorageProvider>,
    pub active_vault_store_id: ActiveVaultScope,
}

pub type AuthProvidersSnapshotData = AuthProvidersSnapshot;

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use crate::{
        ProviderOauthPreset, ProviderVaultScope, StoredGithubPat, StoredGithubRepository,
        StoredLocalFolderConfiguration, StoredOAuthFileConfiguration,
    };

    use std::io;

    use super::*;

    fn github_provider(id: &str, repo: &str, pat: &str) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: StorageProviderType::Github,
            label: "GitHub".to_owned(),
            github_pat: StoredGithubPat::Token(pat.to_owned()),
            github_repo: StoredGithubRepository::Repository(repo.to_owned()),
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn storage_provider_defaults_missing_legacy_sync_checkpoint() -> anyhow::Result<()> {
        let mut value = serde_json::to_value(github_provider("github", "owner/repo", "pat"))?;
        value
            .as_object_mut()
            .ok_or_else(|| io::Error::other("provider must serialize as an object"))?
            .remove("syncCheckpoint");

        let provider: StorageProviderData = serde_json::from_value(value)?;

        assert_eq!(
            provider.sync_checkpoint,
            ProviderSyncCheckpoint::NeverSynced
        );
        Ok(())
    }

    #[test]
    fn exported_provider_contracts_reference_the_canonical_oauth_preset() {
        for declaration in [
            OAuthFileConfig::DECL,
            ProviderSaveRequest::DECL,
            SharedGrantProviderRequest::DECL,
            ProviderOauthPreset::DECL,
        ] {
            assert!(declaration.contains("OAuthFilePreset"));
            assert!(!declaration.contains("OauthFilePreset"));
        }
    }
}

mod persistence;
pub use persistence::*;

mod enrollment_projection;
pub use enrollment_projection::*;

mod shared_grant;
pub use shared_grant::*;
