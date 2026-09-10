#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

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
    pub fn storage_mode(self, oauth_preset: Option<OauthFilePreset>) -> StorageMode {
        match self {
            Self::Local | Self::LocalFolder => StorageMode::Local,
            Self::Github => StorageMode::Github,
            Self::OauthFile => match oauth_preset.unwrap_or(OauthFilePreset::GoogleDrive) {
                OauthFilePreset::GoogleDrive => StorageMode::GoogleDrive,
                OauthFilePreset::ICloud => StorageMode::ICloud,
            },
        }
    }

    #[must_use]
    pub fn default_label(
        self,
        detail: Option<&str>,
        oauth_preset: Option<OauthFilePreset>,
    ) -> String {
        match self {
            Self::Local => "This device".to_owned(),
            Self::LocalFolder => {
                let directory = detail.map(str::trim).filter(|value| !value.is_empty());
                directory.map_or_else(
                    || "Local backup".to_owned(),
                    |directory| format!("Local backup · {directory}"),
                )
            }
            Self::Github => {
                let repo = detail
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(DEFAULT_GITHUB_REPO_NAME);
                if repo == DEFAULT_GITHUB_REPO_NAME {
                    "GitHub".to_owned()
                } else {
                    format!("GitHub · {repo}")
                }
            }
            Self::OauthFile => {
                let file = detail
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(DEFAULT_DRIVE_BACKUP_NAME);
                let prefix = match oauth_preset.unwrap_or(OauthFilePreset::GoogleDrive) {
                    OauthFilePreset::GoogleDrive => "Google Drive",
                    OauthFilePreset::ICloud => "iCloud",
                };
                if file == DEFAULT_DRIVE_BACKUP_NAME {
                    prefix.to_owned()
                } else {
                    format!("{prefix} · {file}")
                }
            }
        }
    }

    #[must_use]
    pub fn staged_default_label(
        self,
        github_repo: Option<&str>,
        oauth_file_name: Option<&str>,
        oauth_file_preset: Option<OauthFilePreset>,
        oauth_setup_preset: Option<OauthFilePreset>,
    ) -> String {
        match self {
            Self::Github => {
                let detail = github_repo
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(DEFAULT_GITHUB_REPO_NAME);
                Self::Github.default_label(Some(detail), None)
            }
            Self::OauthFile => {
                let detail = github_repo
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .or_else(|| {
                        oauth_file_name
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                    })
                    .unwrap_or(DEFAULT_DRIVE_BACKUP_NAME);
                let preset = oauth_file_preset
                    .or(oauth_setup_preset)
                    .unwrap_or(OauthFilePreset::GoogleDrive);
                Self::OauthFile.default_label(Some(detail), Some(preset))
            }
            other => other.default_label(None, None),
        }
    }

    #[must_use]
    pub fn has_credentials(
        self,
        github_pat: Option<&str>,
        oauth_access_token: Option<&str>,
        local_folder_handle_id: Option<&str>,
    ) -> bool {
        match self {
            Self::Github => github_pat
                .map(str::trim)
                .is_some_and(|value| !value.is_empty()),
            Self::OauthFile => oauth_access_token
                .map(str::trim)
                .is_some_and(|value| !value.is_empty()),
            Self::LocalFolder => local_folder_handle_id
                .map(str::trim)
                .is_some_and(|value| !value.is_empty()),
            Self::Local => true,
        }
    }
}

mod target;
pub use target::{ProviderTargetKey, SyncProviderTargetIdentity};

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::super::{GithubSyncTarget, LocalFolderSyncTarget, OauthFileSyncTarget};
    use super::*;
    use crate::{
        StoredGoogleDriveFolder, StoredLocalFolderDirectory, StoredLocalFolderHandle,
        StoredOAuthAccessCredential, StoredOAuthAccountIdentity, StoredOAuthRemoteFileId,
        StoredOAuthRemoteFileName,
    };

    #[test]
    fn storage_mode_for_provider_maps_oauth_presets() -> anyhow::Result<()> {
        assert_eq!(
            StorageProviderType::Local.storage_mode(None),
            StorageMode::Local
        );
        assert_eq!(
            StorageProviderType::LocalFolder.storage_mode(None),
            StorageMode::Local
        );
        assert_eq!(
            StorageProviderType::Github.storage_mode(None),
            StorageMode::Github
        );
        assert_eq!(
            StorageProviderType::OauthFile.storage_mode(None),
            StorageMode::GoogleDrive
        );
        assert_eq!(
            StorageProviderType::OauthFile.storage_mode(Some(OauthFilePreset::ICloud)),
            StorageMode::ICloud
        );
        Ok(())
    }

    #[test]
    fn provider_default_labels_match_sync_provider_ui() -> anyhow::Result<()> {
        assert_eq!(
            StorageProviderType::Local.default_label(None, None),
            "This device"
        );
        assert_eq!(
            StorageProviderType::LocalFolder.default_label(Some("Nook Backup"), None),
            "Local backup · Nook Backup"
        );
        assert_eq!(
            StorageProviderType::Github.default_label(Some("team-vault"), None),
            "GitHub · team-vault"
        );
        assert_eq!(
            StorageProviderType::OauthFile.default_label(None, None),
            "Google Drive"
        );
        assert_eq!(
            StorageProviderType::OauthFile
                .default_label(Some("work.yaml"), Some(OauthFilePreset::ICloud),),
            "iCloud · work.yaml"
        );
        Ok(())
    }

    #[test]
    fn staged_provider_labels_match_login_setup_draft_fields() -> anyhow::Result<()> {
        assert_eq!(
            StorageProviderType::Github.staged_default_label(
                Some("  team-vault  "),
                None,
                None,
                None,
            ),
            "GitHub · team-vault"
        );
        assert_eq!(
            StorageProviderType::Github.staged_default_label(Some("  "), None, None, None),
            "GitHub"
        );
        assert_eq!(
            StorageProviderType::OauthFile.staged_default_label(
                Some("drive-vault"),
                Some("ignored-file"),
                None,
                Some(OauthFilePreset::ICloud),
            ),
            "iCloud · drive-vault"
        );
        assert_eq!(
            StorageProviderType::OauthFile.staged_default_label(
                Some("  "),
                Some(" personal-events "),
                Some(OauthFilePreset::GoogleDrive),
                Some(OauthFilePreset::ICloud),
            ),
            "Google Drive · personal-events"
        );
        assert_eq!(
            StorageProviderType::LocalFolder.staged_default_label(
                Some("ignored"),
                Some("ignored"),
                None,
                None,
            ),
            "Local backup"
        );
        Ok(())
    }

    #[test]
    fn provider_credentials_match_provider_requirements() -> anyhow::Result<()> {
        assert!(StorageProviderType::Local.has_credentials(None, None, None,));
        assert!(StorageProviderType::Github.has_credentials(Some(" ghp_test "), None, None,));
        assert!(!StorageProviderType::Github.has_credentials(Some(" "), None, None,));
        assert!(StorageProviderType::OauthFile.has_credentials(None, Some(" token "), None,));
        assert!(!StorageProviderType::OauthFile.has_credentials(None, None, None,));
        assert!(StorageProviderType::LocalFolder.has_credentials(None, None, Some(" folder-1 "),));
        assert!(!StorageProviderType::LocalFolder.has_credentials(None, None, Some(" "),));
        Ok(())
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
