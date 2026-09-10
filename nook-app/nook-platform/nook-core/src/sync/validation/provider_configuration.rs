#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::ProviderOauthPreset;
use std::fmt;

use super::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, DRIVE_STORAGE_REF_SEP, OauthFilePreset,
    StorageMode, StorageProviderType, SyncProviderTarget, ValidationError, ValidationResult,
};

mod github;

pub use github::*;

/// Validated Google Drive app-data vault file name.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DriveBackupName(String);

impl DriveBackupName {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let file_name = if raw.trim().is_empty() {
            DEFAULT_DRIVE_BACKUP_NAME.to_owned()
        } else {
            raw.trim().to_owned()
        };
        if file_name.len() > 100 {
            return Err(ValidationError::DriveFileNameLength);
        }
        if file_name == "." || file_name == ".." {
            return Err(ValidationError::DriveFileNameInvalid);
        }
        if !file_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        {
            return Err(ValidationError::DriveFileNameChars);
        }
        Ok(Self(file_name))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

/// Validated Google Drive folder id used by shared provider connections.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GoogleDriveFolderId(String);

impl GoogleDriveFolderId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ValidationError::SharedStorageTargetRequired);
        }
        let without_suffix = trimmed
            .split(['?', '#'])
            .next()
            .unwrap_or_default()
            .trim_end_matches('/');
        let candidate = if let Some((_, tail)) = without_suffix.rsplit_once("/folders/") {
            tail.rsplit('/').next().unwrap_or_default()
        } else {
            without_suffix
        }
        .trim();
        if candidate.is_empty()
            || candidate.len() > 256
            || !candidate.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            return Err(ValidationError::SharedStorageTargetInvalid);
        }
        Ok(Self(candidate.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for DriveBackupName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for DriveBackupName {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Validated OAuth access token (Drive / iCloud connect boundary).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OauthAccessToken(String);

impl OauthAccessToken {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ValidationError::OauthAccessTokenEmpty);
        }
        Ok(Self(trimmed.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for OauthAccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for OauthAccessToken {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Parses the Drive storage reference from the web layer: `fileId\\tfileName`
/// or `fileName` alone when no cached file id exists yet.
///
/// Shared Google Drive provider folder ids are encoded as `shared:<folderId>` in the
/// `fileId` slot so connect args stay a 3-tuple.
impl DriveBackupName {
    /// Parse the Drive storage reference from the web layer: `fileId\tfileName`
    /// or `fileName` alone when no cached file id exists yet.
    pub fn parse_storage_ref(value: &str) -> ValidationResult<(String, Self)> {
        if let Some((file_id, file_name)) = value.split_once(DRIVE_STORAGE_REF_SEP) {
            Ok((file_id.trim().to_owned(), Self::parse(file_name)?))
        } else {
            Ok((String::new(), Self::parse(value)?))
        }
    }
}

/// Prefix used in Drive storage refs for shared My Drive folder parents.
pub const DRIVE_SHARED_FOLDER_REF_PREFIX: &str = "shared:";

/// Where Google Drive event files live for the current vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriveEventParent {
    /// Private provider mode: hidden application data folder (`drive.appdata`).
    AppDataFolder,
    /// Shared provider mode: a My Drive folder written with `drive.file` and
    /// read across collaborator accounts with `drive.readonly`.
    SharedFolder { folder_id: String },
}

impl DriveEventParent {
    /// Parse the storage-id slot from [`DriveBackupName::parse_storage_ref`].
    #[must_use]
    pub fn from_storage_id(storage_id: &str) -> Self {
        let trimmed = storage_id.trim();
        if let Some(folder_id) = trimmed.strip_prefix(DRIVE_SHARED_FOLDER_REF_PREFIX) {
            let folder_id = folder_id.trim();
            if !folder_id.is_empty() {
                return Self::SharedFolder {
                    folder_id: folder_id.to_owned(),
                };
            }
        }
        Self::AppDataFolder
    }

    #[must_use]
    pub fn shared_folder_id(folder_id: &str) -> Self {
        Self::SharedFolder {
            folder_id: folder_id.trim().to_owned(),
        }
    }

    #[must_use]
    pub fn encode_storage_id(&self) -> String {
        match self {
            Self::AppDataFolder => String::new(),
            Self::SharedFolder { folder_id } => {
                format!("{DRIVE_SHARED_FOLDER_REF_PREFIX}{}", folder_id.trim())
            }
        }
    }
}

impl DriveBackupName {
    #[must_use]
    pub fn format_storage_ref(file_id: &str, file_name: &Self) -> String {
        Self::format_storage_ref_raw(file_id, file_name.as_str())
    }

    #[must_use]
    pub fn format_storage_ref_raw(file_id: &str, file_name: &str) -> String {
        let id = file_id.trim();
        let name = file_name.trim();
        let name = if name.is_empty() {
            DEFAULT_DRIVE_BACKUP_NAME
        } else {
            name
        };
        if id.is_empty() {
            name.to_owned()
        } else {
            format!("{id}{DRIVE_STORAGE_REF_SEP}{name}")
        }
    }
}

impl StorageProviderType {
    #[must_use]
    pub fn storage_mode(self, oauth_preset: ProviderOauthPreset) -> StorageMode {
        match self {
            Self::Local | Self::LocalFolder => StorageMode::Local,
            Self::Github => StorageMode::Github,
            Self::OauthFile => match match oauth_preset {
                ProviderOauthPreset::NotApplicable => OauthFilePreset::GoogleDrive,
                ProviderOauthPreset::Preset(preset) => preset,
            } {
                OauthFilePreset::GoogleDrive => StorageMode::GoogleDrive,
                OauthFilePreset::ICloud => StorageMode::ICloud,
            },
        }
    }
}

mod label;
pub use label::{
    OAuthProviderLabel, ProviderCredentialEvidence, ProviderCredentialReadiness, ProviderLabel,
};

mod target;
pub use target::{ProviderTargetKey, SyncProviderTargetIdentity};

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::super::{GithubSyncTarget, LocalFolderSyncTarget, OauthFileSyncTarget};
    use super::*;
    use crate::{
        StoredGithubPat, StoredGithubRepository, StoredGoogleDriveFolder,
        StoredLocalFolderDirectory, StoredLocalFolderHandle, StoredOAuthAccessCredential,
        StoredOAuthAccountIdentity, StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    };

    #[test]
    fn storage_mode_for_provider_maps_oauth_presets() -> anyhow::Result<()> {
        assert_eq!(
            StorageProviderType::Local.storage_mode(ProviderOauthPreset::NotApplicable),
            StorageMode::Local
        );
        assert_eq!(
            StorageProviderType::LocalFolder.storage_mode(ProviderOauthPreset::NotApplicable),
            StorageMode::Local
        );
        assert_eq!(
            StorageProviderType::Github.storage_mode(ProviderOauthPreset::NotApplicable),
            StorageMode::Github
        );
        assert_eq!(
            StorageProviderType::OauthFile.storage_mode(ProviderOauthPreset::NotApplicable),
            StorageMode::GoogleDrive
        );
        assert_eq!(
            StorageProviderType::OauthFile
                .storage_mode(ProviderOauthPreset::Preset(OauthFilePreset::ICloud)),
            StorageMode::ICloud
        );
        Ok(())
    }

    #[test]
    fn provider_default_labels_match_sync_provider_ui() {
        assert_eq!(ProviderLabel::Local.render(), "This device");
        assert_eq!(
            ProviderLabel::LocalFolder(&StoredLocalFolderDirectory::DirectoryName(
                "Nook Backup".to_owned()
            ))
            .render(),
            "Local backup · Nook Backup"
        );
        assert_eq!(
            ProviderLabel::Github(&StoredGithubRepository::Repository(
                " team-vault ".to_owned()
            ))
            .render(),
            "GitHub · team-vault"
        );
        assert_eq!(
            ProviderLabel::Github(&StoredGithubRepository::Repository("  ".to_owned())).render(),
            "GitHub"
        );
        assert_eq!(
            ProviderLabel::OAuth(OAuthProviderLabel {
                preset: OauthFilePreset::GoogleDrive,
                file_name: &StoredOAuthRemoteFileName::Unresolved
            })
            .render(),
            "Google Drive"
        );
        assert_eq!(
            ProviderLabel::OAuth(OAuthProviderLabel {
                preset: OauthFilePreset::ICloud,
                file_name: &StoredOAuthRemoteFileName::FileName("work.yaml".to_owned())
            })
            .render(),
            "iCloud · work.yaml"
        );
        assert_eq!(
            ProviderLabel::LocalFolder(&StoredLocalFolderDirectory::Unnamed).render(),
            "Local backup"
        );
    }
    #[test]
    fn provider_credentials_are_classified_by_their_owning_provider() {
        assert_eq!(
            ProviderCredentialEvidence::Local.readiness(),
            ProviderCredentialReadiness::Ready
        );
        for (value, expected) in [
            (" token ", ProviderCredentialReadiness::Ready),
            (" ", ProviderCredentialReadiness::Required),
        ] {
            assert_eq!(
                ProviderCredentialEvidence::Github(&StoredGithubPat::Token(value.to_owned()))
                    .readiness(),
                expected
            );
            assert_eq!(
                ProviderCredentialEvidence::OAuth(&StoredOAuthAccessCredential::AccessToken(
                    value.to_owned()
                ))
                .readiness(),
                expected
            );
            assert_eq!(
                ProviderCredentialEvidence::LocalFolder(&StoredLocalFolderHandle::HandleId(
                    value.to_owned()
                ))
                .readiness(),
                expected
            );
        }
        assert_eq!(
            ProviderCredentialEvidence::OAuth(&StoredOAuthAccessCredential::SignedOut).readiness(),
            ProviderCredentialReadiness::Required
        );
    }

    #[test]
    fn sync_provider_target_key_matches_duplicates_by_storage_identity() -> anyhow::Result<()> {
        let github_a = SyncProviderTarget::Github(GithubSyncTarget {
            repo: "My-Repo".to_owned(),
            pat: "github_pat_11AAAA".to_owned(),
        });
        let github_b = SyncProviderTarget::Github(GithubSyncTarget {
            repo: "my-repo".to_owned(),
            pat: "github_pat_11AAAA".to_owned(),
        });
        assert_eq!(github_a.stable_key(), github_b.stable_key());

        let drive_by_id = SyncProviderTarget::OauthFile(OauthFileSyncTarget {
            preset: OauthFilePreset::GoogleDrive,
            file_id: StoredOAuthRemoteFileId::FileId("file-123".to_owned()),
            folder_id: StoredGoogleDriveFolder::Root,
            file_name: StoredOAuthRemoteFileName::FileName("other-name.yaml".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("me@example.com".to_owned()),
            access_token: StoredOAuthAccessCredential::AccessToken("ya29.test".to_owned()),
        });
        let drive_by_name = SyncProviderTarget::OauthFile(OauthFileSyncTarget {
            preset: OauthFilePreset::GoogleDrive,
            file_id: StoredOAuthRemoteFileId::Unresolved,
            folder_id: StoredGoogleDriveFolder::Root,
            file_name: StoredOAuthRemoteFileName::FileName("other-name.yaml".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("me@example.com".to_owned()),
            access_token: StoredOAuthAccessCredential::AccessToken("ya29.test".to_owned()),
        });
        assert_ne!(drive_by_id.stable_key(), drive_by_name.stable_key());

        let folder = SyncProviderTarget::LocalFolder(LocalFolderSyncTarget {
            directory_name: StoredLocalFolderDirectory::DirectoryName("Nook Backup".to_owned()),
            handle_id: StoredLocalFolderHandle::HandleId("folder-1".to_owned()),
        });
        assert_eq!(
            folder.stable_key(),
            SyncProviderTargetIdentity::Configured("local-folder:folder-1".to_owned().into())
        );

        assert_eq!(
            SyncProviderTarget::Empty.stable_key(),
            SyncProviderTargetIdentity::Unconfigured
        );
        Ok(())
    }
}
