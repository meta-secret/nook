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

mod catalog;
mod enrollment;
mod oauth;
mod scope;
mod state;
mod sync_metadata;

pub use catalog::{
    ensure_local_provider_row, find_duplicate_sync_provider, localize_provider_label,
    normalize_auth_snapshot, provider_storage_detail, provider_target_key,
};
pub use enrollment::{
    enrollment_provider_for_architecture, enrollment_provider_for_architecture_with_storage_target,
    enrollment_provider_onboarding_type, provider_onboarding_type,
};
pub use oauth::{
    bind_google_drive_shared_folder, google_oauth_tokens_to_config, icloud_oauth_tokens_to_config,
    oauth_remote_storage_ref, set_google_drive_provider_mode, set_icloud_provider_mode,
    update_oauth_remote_ref,
};
pub use scope::{
    active_vault_providers, local_provider_for_active_vault, provider_label_by_id,
    providers_visible_while_device_locked, replace_active_vault_provider_grants,
    sync_providers_for_active_vault,
};
pub use state::*;
pub use sync_metadata::update_provider_sync_metadata;

/// OAuth-file (Google Drive / iCloud) credential block for a stored provider.
///
/// Field names are `camelCase` on the wire to match the structured-clone object
/// the web layer and e2e seeders read/write directly in `IndexedDB`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
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
    #[serde(default, rename = "iCloudShareTarget", alias = "icloudShareTarget")]
    pub icloud_share_target: StoredICloudShareTarget,
}

pub type OAuthFileConfigData = OAuthFileConfig;

impl OAuthFileConfigData {
    #[must_use]
    pub const fn resolved_google_drive_mode(&self) -> GoogleDriveMode {
        self.drive_mode
    }

    #[must_use]
    pub const fn resolved_icloud_mode(&self) -> ICloudMode {
        self.icloud_mode
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

/// Positional connect arguments expected by the current wasm manager boundary:
/// storage mode, credential/token, and remote reference/repo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageConnectArgs {
    pub mode: String,
    pub pat: String,
    pub repo: String,
}

impl StorageConnectArgs {
    #[must_use]
    pub fn local() -> Self {
        Self {
            mode: StorageMode::Local.as_str().to_owned(),
            pat: String::new(),
            repo: String::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderStorageDetailLabels {
    pub this_device_desc: String,
    pub no_token_saved: String,
    pub google_signed_in: String,
    pub icloud_signed_in: String,
    pub google_not_signed_in: String,
    pub icloud_not_signed_in: String,
    pub local_folder_needs_reconnect: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderLabelLabels {
    pub this_device: String,
    pub github: String,
    pub local_folder: String,
    pub google_drive: String,
    pub icloud: String,
}

/// Trim optional persisted fields and discard empty values.
#[must_use]
fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Derive connect args from a configured persisted provider row.
///
/// Local-folder rows are browser-side backup targets, so manager sync still uses
/// the local encrypted vault cache for the main connect boundary.
pub fn storage_args_for_provider(
    provider: &StorageProviderData,
) -> ValidationResult<StorageConnectArgs> {
    let provider_type = provider.provider_type;
    let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
    let resolved_oauth_preset = oauth_preset;
    let mode = storage_mode_for_provider(provider_type, resolved_oauth_preset)
        .as_str()
        .to_owned();
    match provider_type {
        StorageProviderType::Local | StorageProviderType::LocalFolder => {
            Ok(StorageConnectArgs::local())
        }
        StorageProviderType::Github => Ok(StorageConnectArgs {
            mode,
            pat: non_empty(provider.github_pat.as_deref()).unwrap_or_default(),
            repo: non_empty(provider.github_repo.as_deref())
                .unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
        }),
        StorageProviderType::OauthFile => {
            let oauth = provider.oauth_file.as_ref();
            let file_name = oauth
                .and_then(|oauth| non_empty(oauth.file_name.as_deref()))
                .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned());
            // Shared replication stores events under a My Drive folder id.
            // Encode with the `shared:` prefix so prepare_storage can select
            // Shared Drive parent vs personal appDataFolder without a 4th arg.
            let storage_id = match (resolved_oauth_preset, oauth) {
                (Some(OauthFilePreset::GoogleDrive), Some(oauth))
                    if oauth.resolved_google_drive_mode() == GoogleDriveMode::Shared =>
                {
                    format!(
                        "shared:{}",
                        non_empty(oauth.folder_id.as_deref())
                            .ok_or(ValidationError::SharedStorageTargetRequired)?
                    )
                }
                (Some(OauthFilePreset::ICloud), Some(oauth))
                    if oauth.resolved_icloud_mode() == ICloudMode::Shared =>
                {
                    non_empty(oauth.icloud_share_target.as_deref())
                        .ok_or(ValidationError::SharedStorageTargetRequired)?
                }
                _ => oauth
                    .and_then(|oauth| non_empty(oauth.file_id.as_deref()))
                    .unwrap_or_default(),
            };
            Ok(StorageConnectArgs {
                mode,
                pat: oauth
                    .and_then(|oauth| non_empty(oauth.access_token.as_deref()))
                    .unwrap_or_default(),
                repo: format_drive_storage_ref_raw(&storage_id, &file_name),
            })
        }
    }
}

pub fn provider_replication_capability_for_row(
    provider: &StorageProviderData,
) -> ValidationResult<ProviderReplicationCapability> {
    let provider_type = provider.provider_type;
    let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
    Ok(provider_replication_capability(
        provider_type,
        match oauth_preset {
            Some(preset) => crate::ProviderOauthPreset::Preset(preset),
            None => crate::ProviderOauthPreset::NotApplicable,
        },
    ))
}

pub fn validate_provider_row_replication(
    provider: &StorageProviderData,
    replication_type: ReplicationType,
) -> ValidationResult<ProviderReplicationCapability> {
    let provider_type = provider.provider_type;
    let oauth_preset = provider.oauth_file.as_ref().map(|oauth| oauth.preset);
    let capability = validate_provider_replication(
        provider_type,
        match oauth_preset {
            Some(preset) => crate::ProviderOauthPreset::Preset(preset),
            None => crate::ProviderOauthPreset::NotApplicable,
        },
        replication_type,
    )?;
    if replication_type == ReplicationType::Shared && oauth_preset == Some(OauthFilePreset::ICloud)
    {
        let oauth = provider
            .oauth_file
            .as_ref()
            .ok_or(ValidationError::SharedStorageTargetRequired)?;
        if oauth.resolved_icloud_mode() != ICloudMode::Shared {
            return Err(ValidationError::SharedStorageTargetRequired);
        }
        let storage_target = non_empty(oauth.icloud_share_target.as_deref())
            .ok_or(ValidationError::SharedStorageTargetRequired)?;
        ICloudSharedTarget::from_storage_id(&storage_target)?;
    }
    Ok(capability)
}

/// Whether a persisted provider row is fully usable for the requested
/// replication mode. This includes provider-specific shared-target checks.
#[must_use]
pub fn provider_supports_replication(
    provider: &StorageProviderData,
    replication_type: ReplicationType,
) -> bool {
    validate_provider_row_replication(provider, replication_type).is_ok()
}

/// Select the preferred compatible provider, or the first compatible row.
/// Returning the id lets host adapters retain their own object/reference while
/// core owns the compatibility and ordering decision.
#[must_use]
pub fn first_compatible_provider_id(
    providers: &[StorageProviderData],
    replication_type: ReplicationType,
    preferred_id: Option<&str>,
) -> Option<String> {
    preferred_id
        .and_then(|preferred_id| {
            providers.iter().find(|provider| {
                provider.id == preferred_id
                    && provider_supports_replication(provider, replication_type)
            })
        })
        .or_else(|| {
            providers
                .iter()
                .find(|provider| provider_supports_replication(provider, replication_type))
        })
        .map(|provider| provider.id.clone())
}

#[allow(clippy::too_many_arguments)]
#[must_use]
pub fn draft_storage_args(
    provider_type: StorageProviderType,
    github_pat: Option<&str>,
    github_repo: Option<&str>,
    oauth_preset: Option<OauthFilePreset>,
    oauth_access_token: Option<&str>,
    oauth_file_id: Option<&str>,
    oauth_file_name: Option<&str>,
) -> StorageConnectArgs {
    let mode = storage_mode_for_provider(provider_type, oauth_preset)
        .as_str()
        .to_owned();
    if provider_type == StorageProviderType::OauthFile {
        let file_name = non_empty(oauth_file_name)
            .or_else(|| non_empty(github_repo))
            .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned());
        return StorageConnectArgs {
            mode,
            pat: non_empty(oauth_access_token).unwrap_or_default(),
            repo: format_drive_storage_ref_raw(oauth_file_id.unwrap_or_default(), &file_name),
        };
    }
    StorageConnectArgs {
        mode,
        pat: github_pat.unwrap_or_default().to_owned(),
        repo: github_repo.unwrap_or_default().to_owned(),
    }
}

/// Resolve a usable staged remote-provider draft. Empty/incomplete drafts do
/// not cross the manager boundary; configured drafts reuse the same typed
/// provider conversion as persisted rows.
pub fn staged_remote_storage_args(
    provider_type: StorageProviderType,
    github_pat: Option<&str>,
    github_repo: Option<&str>,
    oauth_file: Option<&OAuthFileConfigData>,
) -> ValidationResult<Option<StorageConnectArgs>> {
    match provider_type {
        StorageProviderType::Local | StorageProviderType::LocalFolder => Ok(None),
        StorageProviderType::Github => {
            let Some(pat) = non_empty(github_pat) else {
                return Ok(None);
            };
            Ok(Some(StorageConnectArgs {
                mode: StorageMode::Github.as_str().to_owned(),
                pat,
                repo: non_empty(github_repo).unwrap_or_else(|| DEFAULT_GITHUB_REPO_NAME.to_owned()),
            }))
        }
        StorageProviderType::OauthFile => {
            let Some(oauth_file) = oauth_file else {
                return Ok(None);
            };
            let Some(access_token) = non_empty(oauth_file.access_token.as_deref()) else {
                return Ok(None);
            };
            let preset = oauth_file.preset;
            let shared_google_drive = preset == OauthFilePreset::GoogleDrive
                && (oauth_file.resolved_google_drive_mode() == GoogleDriveMode::Shared
                    || non_empty(oauth_file.folder_id.as_deref()).is_some());
            let mut oauth_file = oauth_file.clone();
            oauth_file.access_token = StoredOAuthAccessCredential::AccessToken(access_token);
            oauth_file.file_name = StoredOAuthRemoteFileName::FileName(
                if shared_google_drive {
                    non_empty(oauth_file.file_name.as_deref())
                } else {
                    non_empty(github_repo).or_else(|| non_empty(oauth_file.file_name.as_deref()))
                }
                .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned()),
            );
            let provider = StorageProviderData {
                id: "staged-oauth-file".to_owned(),
                provider_type: StorageProviderType::OauthFile,
                label: String::new(),
                github_pat: StoredGithubPat::Missing,
                github_repo: StoredGithubRepository::DefaultRepository,
                oauth_file: StoredOAuthFileConfiguration::Configured(oauth_file),
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::Unscoped,
                sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
                created_at: String::new(),
            };
            storage_args_for_provider(&provider).map(Some)
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn vault_storage_args(
    local_vault_present: bool,
    is_authenticated: bool,
    sync_provider: Option<&StorageProviderData>,
    provider_type: StorageProviderType,
    github_pat: Option<&str>,
    github_repo: Option<&str>,
    oauth_preset: Option<OauthFilePreset>,
    oauth_access_token: Option<&str>,
    oauth_file_id: Option<&str>,
    oauth_file_name: Option<&str>,
) -> ValidationResult<StorageConnectArgs> {
    if local_vault_present {
        return Ok(StorageConnectArgs::local());
    }
    if is_authenticated && let Some(provider) = sync_provider {
        return storage_args_for_provider(provider);
    }
    Ok(draft_storage_args(
        provider_type,
        github_pat,
        github_repo,
        oauth_preset,
        oauth_access_token,
        oauth_file_id,
        oauth_file_name,
    ))
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;
    use crate::{EnrollmentProvider, SharedEnrollmentProvider, VaultArchitecture};

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

    fn local_folder_provider(id: &str, handle_id: &str) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: StorageProviderType::LocalFolder,
            label: "Local backup".to_owned(),
            github_pat: crate::StoredGithubPat::Missing,
            github_repo: crate::StoredGithubRepository::DefaultRepository,
            oauth_file: crate::StoredOAuthFileConfiguration::NotApplicable,
            local_folder: crate::StoredLocalFolderConfiguration::configured(
                LocalFolderConfigData {
                    directory_name: crate::StoredLocalFolderDirectory::DirectoryName(
                        "Nook Backup".to_owned(),
                    ),
                    handle_id: crate::StoredLocalFolderHandle::HandleId(handle_id.to_owned()),
                },
            ),
            store_id: crate::ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    fn oauth_provider(
        id: &str,
        preset: OauthFilePreset,
        file_id: Option<&str>,
        file_name: &str,
    ) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: StorageProviderType::OauthFile,
            label: "Google Drive".to_owned(),
            github_pat: crate::StoredGithubPat::Missing,
            github_repo: crate::StoredGithubRepository::DefaultRepository,
            oauth_file: crate::StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                preset,
                access_token: crate::StoredOAuthAccessCredential::AccessToken(" token ".to_owned()),
                file_id: file_id.map(str::to_owned),
                file_name: crate::StoredOAuthRemoteFileName::FileName(file_name.to_owned()),
                ..OAuthFileConfigData::default()
            }),
            local_folder: crate::StoredLocalFolderConfiguration::NotApplicable,
            store_id: crate::ProviderVaultScope::Unscoped,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn configured_provider_rows_match_the_manager_connect_contract() -> anyhow::Result<()> {
        assert_eq!(
            storage_args_for_provider(&github_provider("gh", " team-vault ", " pat "))?,
            StorageConnectArgs {
                mode: "github".to_owned(),
                pat: "pat".to_owned(),
                repo: "team-vault".to_owned(),
            }
        );
        assert_eq!(
            storage_args_for_provider(&oauth_provider(
                "drive",
                OauthFilePreset::GoogleDrive,
                Some(" file-1 "),
                " events ",
            ))?,
            StorageConnectArgs {
                mode: "google-drive".to_owned(),
                pat: "token".to_owned(),
                repo: "file-1\tevents".to_owned(),
            }
        );
        assert_eq!(
            storage_args_for_provider(&local_folder_provider("folder", "handle-1"))?,
            StorageConnectArgs::local()
        );
        Ok(())
    }

    #[test]
    fn shared_drive_storage_requires_a_folder_target() -> anyhow::Result<()> {
        let mut provider = oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "events");
        let oauth = provider
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("OAuth config must exist"))?;
        oauth.drive_mode = GoogleDriveMode::Shared;
        assert_eq!(
            storage_args_for_provider(&provider),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        provider
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("OAuth config must exist"))?
            .folder_id = crate::StoredGoogleDriveFolder::FolderId("folder-1".to_owned());
        assert_eq!(
            storage_args_for_provider(&provider)?.repo,
            "shared:folder-1\tevents"
        );
        Ok(())
    }

    #[test]
    fn draft_and_vault_storage_choose_the_correct_precedence() -> anyhow::Result<()> {
        assert_eq!(
            draft_storage_args(
                StorageProviderType::OauthFile,
                None,
                Some(" repo-fallback "),
                Some(OauthFilePreset::ICloud),
                Some(" token "),
                Some(" file-id "),
                Some(" "),
            ),
            StorageConnectArgs {
                mode: "icloud".to_owned(),
                pat: "token".to_owned(),
                repo: "file-id\trepo-fallback".to_owned(),
            }
        );

        let provider = github_provider("gh", "team-vault", "pat");
        assert_eq!(
            vault_storage_args(
                true,
                true,
                Some(&provider),
                StorageProviderType::Github,
                Some("draft-pat"),
                Some("draft-repo"),
                None,
                None,
                None,
                None,
            )?,
            StorageConnectArgs::local()
        );
        assert_eq!(
            vault_storage_args(
                false,
                true,
                Some(&provider),
                StorageProviderType::Github,
                Some("draft-pat"),
                Some("draft-repo"),
                None,
                None,
                None,
                None,
            )?
            .repo,
            "team-vault"
        );
        assert_eq!(
            vault_storage_args(
                false,
                false,
                Some(&provider),
                StorageProviderType::Github,
                Some("draft-pat"),
                Some("draft-repo"),
                None,
                None,
                None,
                None,
            )?
            .repo,
            "draft-repo"
        );
        Ok(())
    }

    #[test]
    fn provider_replication_capability_matches_the_provider_preset() -> anyhow::Result<()> {
        let github = github_provider("gh", "nook", "pat");
        assert!(validate_provider_row_replication(&github, ReplicationType::Personal).is_ok());
        assert!(validate_provider_row_replication(&github, ReplicationType::Shared).is_err());

        let drive = oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "events");
        let capability = validate_provider_row_replication(&drive, ReplicationType::Shared)?;
        assert!(capability.supports_shared);
        assert_eq!(
            capability.shared_joiner_identity,
            crate::ProviderJoinerIdentity::Required(crate::SharedJoinerIdentityKind::Email)
        );
        Ok(())
    }

    #[test]
    fn compatible_provider_selection_is_core_owned() {
        let providers = vec![
            github_provider("github", "nook", "github_pat_11AAAA"),
            oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "events"),
        ];
        assert_eq!(
            first_compatible_provider_id(&providers, ReplicationType::Shared, Some("github"))
                .as_deref(),
            Some("drive")
        );
        assert_eq!(
            first_compatible_provider_id(&providers, ReplicationType::Personal, Some("github"))
                .as_deref(),
            Some("github")
        );
        assert!(!provider_supports_replication(
            &providers[0],
            ReplicationType::Shared
        ));
        assert!(provider_supports_replication(
            &providers[1],
            ReplicationType::Shared
        ));
    }

    #[test]
    fn private_icloud_is_not_ready_for_shared_replication() -> anyhow::Result<()> {
        let mut icloud = oauth_provider("icloud", OauthFilePreset::ICloud, None, "nook-events");
        let oauth = icloud
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("OAuth config must exist"))?;
        oauth.icloud_mode = ICloudMode::Private;
        assert!(validate_provider_row_replication(&icloud, ReplicationType::Personal).is_ok());
        assert_eq!(
            validate_provider_row_replication(&icloud, ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        let oauth = icloud
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("OAuth config must exist"))?;
        oauth.icloud_mode = ICloudMode::Shared;
        oauth.icloud_share_target =
            crate::StoredICloudShareTarget::SharedTarget("not-a-cloudkit-share-target".to_owned());
        assert_eq!(
            validate_provider_row_replication(&icloud, ReplicationType::Shared),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        Ok(())
    }

    #[test]
    fn shared_icloud_onboarding_carries_target_without_owner_credentials() -> anyhow::Result<()> {
        let target = crate::ICloudSharedTarget::new(
            crate::ICloudShareRole::Owner,
            "zone",
            "owner",
            "root",
            "guid",
        )?
        .to_storage_id()?;
        let mut icloud = oauth_provider("icloud", OauthFilePreset::ICloud, None, "nook-events");
        let oauth = icloud
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("OAuth config must exist"))?;
        oauth.icloud_mode = ICloudMode::Shared;
        oauth.icloud_share_target = crate::StoredICloudShareTarget::SharedTarget(target.clone());

        assert_eq!(
            enrollment_provider_for_architecture(&icloud, &VaultArchitecture::default(), None)?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(target.clone()))
        );
        let args = storage_args_for_provider(&icloud)?;
        assert_eq!(args.mode, "icloud");
        assert_eq!(args.pat, "token");
        assert_eq!(args.repo, format!("{target}\tnook-events"));
        Ok(())
    }

    #[test]
    fn staged_remote_args_reject_incomplete_drafts_and_normalize_targets() -> anyhow::Result<()> {
        assert_eq!(
            staged_remote_storage_args(StorageProviderType::Local, None, None, None)?,
            None
        );
        assert_eq!(
            staged_remote_storage_args(StorageProviderType::Github, Some("  "), None, None)?,
            None
        );
        assert_eq!(
            staged_remote_storage_args(
                StorageProviderType::Github,
                Some(" pat "),
                Some(" owner/repo "),
                None,
            )?
            .ok_or_else(|| std::io::Error::other("GitHub args must exist"))?
            .repo,
            "owner/repo"
        );

        let mut oauth = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: crate::StoredOAuthAccessCredential::AccessToken(" token ".to_owned()),
            file_id: crate::StoredOAuthRemoteFileId::FileId("file-id".to_owned()),
            file_name: crate::StoredOAuthRemoteFileName::FileName("stored-name".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            staged_remote_storage_args(
                StorageProviderType::OauthFile,
                None,
                Some("draft-name"),
                Some(&oauth),
            )?
            .ok_or_else(|| std::io::Error::other("OAuth args must exist"))?
            .repo,
            "file-id\tdraft-name"
        );
        oauth.drive_mode = GoogleDriveMode::Shared;
        oauth.folder_id = crate::StoredGoogleDriveFolder::FolderId("shared-folder".to_owned());
        assert_eq!(
            staged_remote_storage_args(
                StorageProviderType::OauthFile,
                None,
                Some("ignored-draft-name"),
                Some(&oauth),
            )?
            .ok_or_else(|| std::io::Error::other("shared OAuth args must exist"))?
            .repo,
            "shared:shared-folder\tstored-name"
        );
        Ok(())
    }
}
