//! Provider labels and credential readiness consume provider-specific field states.
use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, OauthFilePreset, StoredGithubPat,
    StoredGithubRepository, StoredLocalFolderDirectory, StoredLocalFolderHandle,
    StoredOAuthAccessCredential, StoredOAuthRemoteFileName,
};
pub struct OAuthProviderLabel<'a> {
    pub preset: OauthFilePreset,
    pub file_name: &'a StoredOAuthRemoteFileName,
}
pub enum ProviderLabel<'a> {
    Local,
    LocalFolder(&'a StoredLocalFolderDirectory),
    Github(&'a StoredGithubRepository),
    OAuth(OAuthProviderLabel<'a>),
}
impl ProviderLabel<'_> {
    #[must_use]
    pub fn render(self) -> String {
        match self {
            Self::Local => "This device".to_owned(),
            Self::LocalFolder(directory) => match directory {
                StoredLocalFolderDirectory::DirectoryName(name) if !name.trim().is_empty() => {
                    format!("Local backup · {}", name.trim())
                }
                StoredLocalFolderDirectory::DirectoryName(_)
                | StoredLocalFolderDirectory::Unnamed => "Local backup".to_owned(),
            },
            Self::Github(repository) => match repository {
                StoredGithubRepository::Repository(name)
                    if !name.trim().is_empty() && name.trim() != DEFAULT_GITHUB_REPO_NAME =>
                {
                    format!("GitHub · {}", name.trim())
                }
                StoredGithubRepository::Repository(_)
                | StoredGithubRepository::DefaultRepository => "GitHub".to_owned(),
            },
            Self::OAuth(label) => {
                let prefix = match label.preset {
                    OauthFilePreset::GoogleDrive => "Google Drive",
                    OauthFilePreset::ICloud => "iCloud",
                };
                match label.file_name {
                    StoredOAuthRemoteFileName::FileName(name)
                        if !name.trim().is_empty() && name.trim() != DEFAULT_DRIVE_BACKUP_NAME =>
                    {
                        format!("{prefix} · {}", name.trim())
                    }
                    StoredOAuthRemoteFileName::FileName(_)
                    | StoredOAuthRemoteFileName::Unresolved => prefix.to_owned(),
                }
            }
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderCredentialReadiness {
    Ready,
    Required,
}
pub enum ProviderCredentialEvidence<'a> {
    Local,
    Github(&'a StoredGithubPat),
    OAuth(&'a StoredOAuthAccessCredential),
    LocalFolder(&'a StoredLocalFolderHandle),
}
impl ProviderCredentialEvidence<'_> {
    #[must_use]
    pub fn readiness(self) -> ProviderCredentialReadiness {
        match self {
            Self::Local => ProviderCredentialReadiness::Ready,
            Self::Github(StoredGithubPat::Token(value))
            | Self::OAuth(StoredOAuthAccessCredential::AccessToken(value))
            | Self::LocalFolder(StoredLocalFolderHandle::HandleId(value))
                if !value.trim().is_empty() =>
            {
                ProviderCredentialReadiness::Ready
            }
            Self::Github(_) | Self::OAuth(_) | Self::LocalFolder(_) => {
                ProviderCredentialReadiness::Required
            }
        }
    }
}
