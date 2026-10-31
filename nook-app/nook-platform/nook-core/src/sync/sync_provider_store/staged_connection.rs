//! Staged connections preserve provider-specific configuration and readiness.
use super::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, OAuthRemoteStorageReference,
    OauthFilePreset, ProviderSyncCheckpoint, ProviderVaultScope, StorageConnectArgs, StorageMode,
    StorageProviderData, StorageProviderType, StoredGithubPat, StoredGithubRepository,
    StoredLocalFolderConfiguration, StoredOAuthAccessCredential, StoredOAuthFileConfiguration,
    StoredOAuthRemoteFileName, StoredS3Configuration, ValidationResult,
};
pub struct StagedGithubConnection<'a> {
    pub credential: &'a StoredGithubPat,
    pub repository: &'a StoredGithubRepository,
}
pub struct StagedOAuthConnection<'a> {
    pub configuration: &'a StoredOAuthFileConfiguration,
    pub file_name: &'a StoredOAuthRemoteFileName,
}
/// An S3 connection about to connect: the validated block from the setup
/// form or a provider row, its secret still in plaintext.
pub struct StagedS3Connection<'a> {
    pub configuration: &'a StoredS3Configuration,
}
pub enum StagedRemoteConnection<'a> {
    Local,
    Github(StagedGithubConnection<'a>),
    OAuth(StagedOAuthConnection<'a>),
    S3(StagedS3Connection<'a>),
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
                // A signed-in provider is not connectable until its Drive folder or
                // `CloudKit` share exists.
                if config.remote_storage_ref() == OAuthRemoteStorageReference::Unresolved {
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
                    s3: StoredS3Configuration::NotApplicable,
                    store_id: ProviderVaultScope::Unscoped,
                    sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                    created_at: String::new(),
                }
                .connection_args()
                .map(StagedStorageConnection::Ready)
            }
            Self::S3(staged) => match staged.configuration {
                StoredS3Configuration::NotApplicable => Ok(StagedStorageConnection::Incomplete),
                StoredS3Configuration::Configured(config) => {
                    config.connect_args().map(StagedStorageConnection::Ready)
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{StagedRemoteConnection, StagedS3Connection, StagedStorageConnection};
    use crate::errors::ValidationError;
    use crate::{S3ProviderConfig, StoredS3Configuration, StoredS3SecretAccessKey};

    #[test]
    fn a_staged_s3_connection_is_ready_only_with_a_plaintext_secret() -> anyhow::Result<()> {
        assert_eq!(
            StagedRemoteConnection::S3(StagedS3Connection {
                configuration: &StoredS3Configuration::NotApplicable,
            })
            .project()?,
            StagedStorageConnection::Incomplete
        );
        let config = S3ProviderConfig::fixture()?;
        let StagedStorageConnection::Ready(args) = StagedRemoteConnection::S3(StagedS3Connection {
            configuration: &StoredS3Configuration::Configured(config.clone()),
        })
        .project()?
        else {
            anyhow::bail!("a configured S3 connection is ready");
        };
        assert_eq!(args, config.connect_args()?);
        let mut sealed = config;
        sealed.secret_access_key = StoredS3SecretAccessKey::transitioned(
            "-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n-----END AGE ENCRYPTED FILE-----".to_owned(),
        );
        assert!(matches!(
            StagedRemoteConnection::S3(StagedS3Connection {
                configuration: &StoredS3Configuration::Configured(sealed),
            })
            .project(),
            Err(ValidationError::S3SecretAccessKeyInvalid)
        ));
        Ok(())
    }
}
