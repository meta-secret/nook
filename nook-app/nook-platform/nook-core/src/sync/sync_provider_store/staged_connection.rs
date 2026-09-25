//! Staged connections preserve provider-specific configuration and readiness.
use super::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, GoogleDriveMode, OauthFilePreset,
    ProviderSaveSetup, ProviderSyncCheckpoint, ProviderVaultScope, StorageConnectArgs, StorageMode,
    StorageProviderData, StorageProviderType, StoredGithubPat, StoredGithubRepository,
    StoredGoogleDriveFolder, StoredGoogleDrivePrivateTarget, StoredLocalFolderConfiguration,
    StoredOAuthAccessCredential, StoredOAuthFileConfiguration, StoredOAuthRemoteFileName,
    ValidationResult,
};
pub struct StagedGithubConnection<'a> {
    pub credential: &'a StoredGithubPat,
    pub repository: &'a StoredGithubRepository,
}
pub struct StagedOAuthConnection<'a> {
    pub configuration: &'a StoredOAuthFileConfiguration,
    pub file_name: &'a StoredOAuthRemoteFileName,
    pub setup: ProviderSaveSetup,
}
pub enum StagedRemoteConnection<'a> {
    Local,
    Github(StagedGithubConnection<'a>),
    OAuth(StagedOAuthConnection<'a>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StagedStorageConnection {
    Incomplete,
    Ready(StorageConnectArgs),
}
impl StagedRemoteConnection<'_> {
    pub fn project(self) -> ValidationResult<StagedStorageConnection> {
        match self {
            Self::Local => Ok(StagedStorageConnection::Incomplete),
            Self::Github(draft) => {
                let StoredGithubPat::Token(pat) = draft.credential else {
                    return Ok(StagedStorageConnection::Incomplete);
                };
                let pat = pat.trim();
                if pat.is_empty() {
                    return Ok(StagedStorageConnection::Incomplete);
                }
                let repo = match draft.repository {
                    StoredGithubRepository::Repository(repo) if !repo.trim().is_empty() => {
                        repo.trim()
                    }
                    StoredGithubRepository::Repository(_)
                    | StoredGithubRepository::DefaultRepository => DEFAULT_GITHUB_REPO_NAME,
                };
                Ok(StagedStorageConnection::Ready(StorageConnectArgs {
                    mode: StorageMode::Github.as_str().to_owned(),
                    pat: pat.to_owned(),
                    repo: repo.to_owned(),
                }))
            }
            Self::OAuth(draft) => {
                let StoredOAuthFileConfiguration::Configured(config) = draft.configuration else {
                    return Ok(StagedStorageConnection::Incomplete);
                };
                let StoredOAuthAccessCredential::AccessToken(token) = &config.access_token else {
                    return Ok(StagedStorageConnection::Incomplete);
                };
                let token = token.trim();
                if token.is_empty() {
                    return Ok(StagedStorageConnection::Incomplete);
                }
                let stored_name = match &config.file_name {
                    StoredOAuthRemoteFileName::FileName(name) if !name.trim().is_empty() => {
                        name.trim()
                    }
                    StoredOAuthRemoteFileName::Unresolved
                    | StoredOAuthRemoteFileName::FileName(_) => DEFAULT_DRIVE_BACKUP_NAME,
                };
                let file_name = match (
                    draft.setup,
                    config.preset,
                    config.resolved_google_drive_mode(),
                    &config.drive_private_target,
                    &config.folder_id,
                    &draft.file_name,
                ) {
                    (
                        ProviderSaveSetup::Existing,
                        OauthFilePreset::GoogleDrive,
                        GoogleDriveMode::Private,
                        StoredGoogleDrivePrivateTarget::Pending
                        | StoredGoogleDrivePrivateTarget::FolderId(_),
                        _,
                        _,
                    )
                    | (_, OauthFilePreset::GoogleDrive, GoogleDriveMode::Shared, _, _, _) => {
                        stored_name
                    }
                    (
                        _,
                        OauthFilePreset::GoogleDrive,
                        _,
                        _,
                        StoredGoogleDriveFolder::FolderId(id),
                        _,
                    ) if !id.trim().is_empty() => stored_name,
                    (_, _, _, _, _, StoredOAuthRemoteFileName::FileName(name))
                        if !name.trim().is_empty() =>
                    {
                        name.trim()
                    }
                    (_, _, _, _, _, StoredOAuthRemoteFileName::Unresolved)
                    | (_, _, _, _, _, StoredOAuthRemoteFileName::FileName(_)) => stored_name,
                };
                let mut oauth = config.with_provider_save_setup(draft.setup);
                oauth.access_token = StoredOAuthAccessCredential::AccessToken(token.to_owned());
                oauth.file_name = StoredOAuthRemoteFileName::FileName(file_name.to_owned());
                StorageProviderData {
                    id: "staged-oauth-file".to_owned(),
                    provider_type: StorageProviderType::OauthFile,
                    label: String::new(),
                    github_pat: StoredGithubPat::Missing,
                    github_repo: StoredGithubRepository::DefaultRepository,
                    oauth_file: StoredOAuthFileConfiguration::configured(oauth),
                    local_folder: StoredLocalFolderConfiguration::NotApplicable,
                    store_id: ProviderVaultScope::Unscoped,
                    sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                    created_at: String::new(),
                }
                .connection_args()
                .map(StagedStorageConnection::Ready)
            }
        }
    }
}
