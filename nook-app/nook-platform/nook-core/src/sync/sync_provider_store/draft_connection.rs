//! Unauthenticated provider drafts and already-selected vault connections.
use super::{
    DEFAULT_DRIVE_BACKUP_NAME, OAuthRemoteStorageReference, OauthFilePreset, StorageConnectArgs,
    StorageMode, StorageProviderData, StoredGithubPat, StoredGithubRepository,
    StoredOAuthAccessCredential, StoredOAuthRemoteFileName, ValidationResult,
};
use crate::DriveBackupName;
pub struct GithubStorageDraft<'a> {
    pub credential: &'a StoredGithubPat,
    pub repository: &'a StoredGithubRepository,
}
pub struct OAuthStorageDraft<'a> {
    pub preset: OauthFilePreset,
    pub credential: &'a StoredOAuthAccessCredential,
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
    pub fn project(self) -> StorageConnectArgs {
        match self {
            Self::Local => StorageConnectArgs::local(),
            Self::Github(draft) => StorageConnectArgs {
                mode: StorageMode::Github.as_str().to_owned(),
                pat: match draft.credential {
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
                let name = match draft.file_name {
                    StoredOAuthRemoteFileName::FileName(name) if !name.trim().is_empty() => {
                        name.trim()
                    }
                    StoredOAuthRemoteFileName::FileName(_)
                    | StoredOAuthRemoteFileName::Unresolved => alternate,
                };
                let reference = match &draft.remote_reference {
                    OAuthRemoteStorageReference::Unresolved => "",
                    OAuthRemoteStorageReference::Resolved(reference) => reference.as_str(),
                };
                StorageConnectArgs {
                    mode: match draft.preset {
                        OauthFilePreset::GoogleDrive => StorageMode::GoogleDrive,
                        OauthFilePreset::ICloud => StorageMode::ICloud,
                    }
                    .as_str()
                    .to_owned(),
                    pat: match draft.credential {
                        StoredOAuthAccessCredential::SignedOut => String::new(),
                        StoredOAuthAccessCredential::AccessToken(token) => token.trim().to_owned(),
                    },
                    repo: DriveBackupName::format_storage_ref_raw(reference, name),
                }
            }
        }
    }
}
impl VaultStorageConnection<'_> {
    pub fn project(self) -> ValidationResult<StorageConnectArgs> {
        match self {
            Self::LocalCache => Ok(StorageConnectArgs::local()),
            Self::AuthenticatedProvider(provider) => provider.connection_args(),
            Self::Draft(draft) => Ok(draft.project()),
        }
    }
}
