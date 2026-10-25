//! Staged connections preserve provider-specific configuration and readiness.
use super::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, OauthFilePreset, ProviderSyncCheckpoint,
    ProviderVaultScope, StorageConnectArgs, StorageMode, StorageProviderData, StorageProviderType,
    StoredGithubPat, StoredGithubRepository, StoredLocalFolderConfiguration,
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
                // Drive events live in the vault folder under the stored backup
                // name; an iCloud draft may rename its event file.
                let file_name = match (config.preset, draft.file_name) {
                    (OauthFilePreset::ICloud, StoredOAuthRemoteFileName::FileName(name))
                        if !name.trim().is_empty() =>
                    {
                        name.trim()
                    }
                    (OauthFilePreset::GoogleDrive | OauthFilePreset::ICloud, _) => stored_name,
                };
                let mut oauth = config.as_ref().clone();
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
