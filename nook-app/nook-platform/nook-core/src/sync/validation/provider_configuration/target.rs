//! Stable provider target identity retains unconfigured state explicitly.
use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, StoredGoogleDriveFolder, StoredLocalFolderDirectory,
    StoredLocalFolderHandle, StoredOAuthAccessCredential, StoredOAuthAccountIdentity,
    StoredOAuthRemoteFileId, StoredOAuthRemoteFileName, SyncProviderTarget,
};
use std::fmt;
use zeroize::Zeroize;
#[derive(Clone, PartialEq, Eq)]
pub struct ProviderTargetKey(String);
impl From<String> for ProviderTargetKey {
    fn from(value: String) -> Self {
        Self(value)
    }
}
impl fmt::Debug for ProviderTargetKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderTargetKey([redacted])")
    }
}
impl Drop for ProviderTargetKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncProviderTargetIdentity {
    Unconfigured,
    Configured(ProviderTargetKey),
}
impl SyncProviderTarget {
    #[must_use]
    pub fn stable_key(&self) -> SyncProviderTargetIdentity {
        let key = match self {
            Self::Empty => return SyncProviderTargetIdentity::Unconfigured,
            Self::Local => "local".to_owned(),
            Self::LocalFolder(folder) => {
                let name = match &folder.directory_name {
                    StoredLocalFolderDirectory::DirectoryName(name) if !name.trim().is_empty() => {
                        name.trim()
                    }
                    StoredLocalFolderDirectory::DirectoryName(_)
                    | StoredLocalFolderDirectory::Unnamed => "unselected",
                };
                let key = match &folder.handle_id {
                    StoredLocalFolderHandle::HandleId(id) if !id.trim().is_empty() => id.trim(),
                    StoredLocalFolderHandle::HandleId(_) | StoredLocalFolderHandle::Unbound => name,
                };
                format!("local-folder:{key}")
            }
            Self::Github(github) => format!(
                "github:{}:{}",
                github.repo.trim().to_lowercase(),
                github.pat.trim()
            ),
            Self::OauthFile(oauth) => {
                let name = match &oauth.file_name {
                    StoredOAuthRemoteFileName::FileName(name) if !name.trim().is_empty() => {
                        name.trim()
                    }
                    StoredOAuthRemoteFileName::FileName(_)
                    | StoredOAuthRemoteFileName::Unresolved => DEFAULT_DRIVE_BACKUP_NAME,
                };
                let file = match &oauth.file_id {
                    StoredOAuthRemoteFileId::FileId(id) if !id.trim().is_empty() => id.trim(),
                    StoredOAuthRemoteFileId::FileId(_) | StoredOAuthRemoteFileId::Unresolved => {
                        name
                    }
                };
                let file_key = match &oauth.folder_id {
                    StoredGoogleDriveFolder::FolderId(folder) if !folder.trim().is_empty() => {
                        format!("shared:{}", folder.trim())
                    }
                    StoredGoogleDriveFolder::FolderId(_) | StoredGoogleDriveFolder::Root => {
                        file.to_owned()
                    }
                };
                let token = match &oauth.access_token {
                    StoredOAuthAccessCredential::SignedOut => "",
                    StoredOAuthAccessCredential::AccessToken(token) => token.trim(),
                };
                let account = match &oauth.account_email {
                    StoredOAuthAccountIdentity::Email(email) if !email.trim().is_empty() => {
                        email.trim()
                    }
                    StoredOAuthAccountIdentity::Email(_) | StoredOAuthAccountIdentity::Unknown => {
                        token
                    }
                };
                format!("oauth-file:{}:{file_key}:{account}", oauth.preset.as_str())
            }
        };
        SyncProviderTargetIdentity::Configured(key.into())
    }
}
