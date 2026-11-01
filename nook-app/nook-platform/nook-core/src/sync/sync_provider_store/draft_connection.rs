//! Unauthenticated provider drafts and already-selected vault connections.
use super::{
    DEFAULT_DRIVE_BACKUP_NAME, OAuthRemoteStorageReference, OauthFilePreset, StorageConnection,
    StorageProviderData, StoredGithubPat, StoredGithubRepository, StoredOAuthAccessCredential,
    StoredOAuthRemoteFileName, ValidationResult,
};
pub struct GithubStorageDraft<'a> {
    pub credential: &'a StoredGithubPat,
    pub repository: &'a StoredGithubRepository,
}
pub struct OAuthStorageDraft<'a> {
    pub preset: OauthFilePreset,
    pub credential: &'a StoredOAuthAccessCredential,
    /// The Drive folder id or `CloudKit` share the draft connects through.
    pub remote_reference: OAuthRemoteStorageReference,
    pub file_name: &'a StoredOAuthRemoteFileName,
    pub alternate_name: &'a StoredOAuthRemoteFileName,
}
pub enum DraftStorageConnection<'a> {
    Local,
    Github(GithubStorageDraft<'a>),
    OAuth(OAuthStorageDraft<'a>),
}
pub enum VaultStorageConnection<'a> {
    LocalCache,
    AuthenticatedProvider(&'a StorageProviderData),
    Draft(DraftStorageConnection<'a>),
}
impl DraftStorageConnection<'_> {
    #[must_use]
    pub fn project(self) -> StorageConnection {
        match self {
            Self::Local => StorageConnection::Local,
            Self::Github(draft) => StorageConnection::Github {
                token: match draft.credential {
                    StoredGithubPat::Missing => String::new(),
                    StoredGithubPat::Token(token) => token.clone(),
                },
                repo: match draft.repository {
                    StoredGithubRepository::DefaultRepository => String::new(),
                    StoredGithubRepository::Repository(repo) => repo.clone(),
                },
            },
            Self::OAuth(draft) => {
                let alternate = match draft.alternate_name {
                    StoredOAuthRemoteFileName::FileName(name) if !name.trim().is_empty() => {
                        name.trim()
                    }
                    StoredOAuthRemoteFileName::FileName(_)
                    | StoredOAuthRemoteFileName::Unresolved => DEFAULT_DRIVE_BACKUP_NAME,
                };
                let file_name = match draft.file_name {
                    StoredOAuthRemoteFileName::FileName(name) if !name.trim().is_empty() => {
                        name.trim()
                    }
                    StoredOAuthRemoteFileName::FileName(_)
                    | StoredOAuthRemoteFileName::Unresolved => alternate,
                }
                .to_owned();
                let target = match &draft.remote_reference {
                    OAuthRemoteStorageReference::Unresolved => "",
                    OAuthRemoteStorageReference::Resolved(reference) => reference.as_str().trim(),
                }
                .to_owned();
                let token = match draft.credential {
                    StoredOAuthAccessCredential::SignedOut => String::new(),
                    StoredOAuthAccessCredential::AccessToken(token) => token.trim().to_owned(),
                };
                match draft.preset {
                    OauthFilePreset::GoogleDrive => StorageConnection::GoogleDrive {
                        token,
                        folder_id: target,
                        file_name,
                    },
                    OauthFilePreset::ICloud => StorageConnection::ICloud {
                        token,
                        share_target: target,
                        file_name,
                    },
                }
            }
        }
    }
}
impl VaultStorageConnection<'_> {
    pub fn project(self) -> ValidationResult<StorageConnection> {
        match self {
            Self::LocalCache => Ok(StorageConnection::Local),
            Self::AuthenticatedProvider(provider) => provider.connection_args(),
            Self::Draft(draft) => Ok(draft.project()),
        }
    }
}
