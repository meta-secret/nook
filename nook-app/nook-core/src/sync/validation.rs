use crate::errors::{ValidationError, ValidationResult};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod provider_configuration;
pub use provider_configuration::*;
use wasm_bindgen::prelude::wasm_bindgen;

/// Backend that persists the encrypted vault file.
///
/// New backends (S3, IPFS, …) plug in as new variants — the rest of the
/// pipeline pattern-matches on the enum rather than threading raw strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StorageMode {
    /// `IndexedDB` on this device only.
    Local,
    /// GitHub repository (authenticated with a PAT).
    Github,
    /// Google Drive app-data folder (authenticated with OAuth access token).
    GoogleDrive,
    /// iCloud private `CloudKit` database (authenticated with `CloudKit` web auth token).
    ICloud,
}

impl StorageMode {
    /// Canonical short tag used at every cross-language boundary (wasm-bindgen
    /// arguments, `IndexedDB` JSON, GitHub PR descriptions, log lines).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Github => "github",
            Self::GoogleDrive => "google-drive",
            Self::ICloud => "icloud",
        }
    }

    /// Parse a tag string (typically arriving from the JS layer) into the
    /// enum. Unknown values are rejected at the boundary so no caller has
    /// to defend against typos downstream.
    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        match value {
            "local" => Ok(Self::Local),
            "github" => Ok(Self::Github),
            "google-drive" => Ok(Self::GoogleDrive),
            "icloud" => Ok(Self::ICloud),
            other => Err(ValidationError::UnknownStorageMode {
                mode: other.to_owned(),
            }),
        }
    }
}

impl std::fmt::Display for StorageMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Stable provider-scoped key for local vault caches and event-log outboxes.
#[must_use]
pub fn format_sync_provider_cache_ref(mode: StorageMode, remote_ref: &str, path: &str) -> String {
    match mode {
        StorageMode::Local => "local".to_owned(),
        StorageMode::Github => format!("github:{remote_ref}:{path}"),
        StorageMode::GoogleDrive => format!("drive:{remote_ref}"),
        StorageMode::ICloud => format!("icloud:{remote_ref}"),
    }
}

/// String tags retained for places where a `&'static str` is more
/// convenient than the enum (test fixtures, JSON keys). New code should
/// prefer `StorageMode::Local.as_str()` / `StorageMode::Github.as_str()`.
pub const STORAGE_MODE_LOCAL: &str = StorageMode::Local.as_str();
pub const STORAGE_MODE_GITHUB: &str = StorageMode::Github.as_str();
pub const DEFAULT_GITHUB_REPO_NAME: &str = "nook";
pub const DEFAULT_DRIVE_BACKUP_NAME: &str = "nook-events";

/// Separator between optional known Drive file id and vault file name in the
/// wasm connect `github_repo` argument for `google-drive` mode.
pub const DRIVE_STORAGE_REF_SEP: char = '\t';

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StorageProviderType {
    #[default]
    Local,
    LocalFolder,
    Github,
    OauthFile,
}

impl StorageProviderType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::LocalFolder => "local-folder",
            Self::Github => "github",
            Self::OauthFile => "oauth-file",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        match value {
            "local" => Ok(Self::Local),
            "local-folder" => Ok(Self::LocalFolder),
            "github" => Ok(Self::Github),
            "oauth-file" => Ok(Self::OauthFile),
            other => Err(ValidationError::UnknownStorageMode {
                mode: other.to_owned(),
            }),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum OAuthFilePreset {
    #[default]
    GoogleDrive,
    #[serde(rename = "icloud")]
    ICloud,
}

pub type OauthFilePreset = OAuthFilePreset;

/// Google Drive storage visibility selected for one provider connection.
///
/// This is intentionally independent from vault membership/replication policy:
/// a Simple or Sentinel vault may use either a private app-data replica or a
/// folder shared through Google Drive ACLs.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum GoogleDriveMode {
    #[default]
    Private,
    Shared,
}

impl GoogleDriveMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Shared => "shared",
        }
    }

    pub fn parse(value: &str) -> ValidationResult<Self> {
        parse_provider_visibility(value, "google-drive", Self::Private, Self::Shared)
    }
}

/// iCloud storage visibility selected for one provider connection.
///
/// Private providers continue to use the current user's default private
/// `CloudKit` zone. Shared providers use a custom record hierarchy: owners write
/// through their private database while participants write through their
/// shared database with their own `CloudKit` web-auth token.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ICloudMode {
    #[default]
    Private,
    Shared,
}

impl ICloudMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Shared => "shared",
        }
    }

    pub fn parse(value: &str) -> ValidationResult<Self> {
        parse_provider_visibility(value, "icloud", Self::Private, Self::Shared)
    }
}

fn parse_provider_visibility<T: Copy>(
    value: &str,
    provider: &str,
    private: T,
    shared: T,
) -> ValidationResult<T> {
    match value.trim() {
        "private" => Ok(private),
        "shared" => Ok(shared),
        other => Err(ValidationError::UnknownStorageMode {
            mode: format!("{provider}:{other}"),
        }),
    }
}

/// Which `CloudKit` database exposes a shared record hierarchy to this account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ICloudShareRole {
    Owner,
    Participant,
}

/// Stable, non-secret `CloudKit` location for one shared Nook event hierarchy.
///
/// This is persisted with the sync provider and copied through enrollment. It
/// deliberately contains no `CloudKit` web-auth token; every account signs in
/// independently. `short_guid` is the acceptance handle, while the zone/root
/// fields route `CloudKit` Web Services after the share has been accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ICloudSharedTarget {
    pub role: ICloudShareRole,
    pub zone_name: String,
    pub owner_record_name: String,
    pub root_record_name: String,
    pub short_guid: String,
}

impl ICloudSharedTarget {
    pub fn new(
        role: ICloudShareRole,
        zone_name: &str,
        owner_record_name: &str,
        root_record_name: &str,
        short_guid: &str,
    ) -> ValidationResult<Self> {
        fn required(value: &str) -> ValidationResult<String> {
            let value = value.trim();
            if value.is_empty() {
                return Err(ValidationError::SharedStorageTargetRequired);
            }
            Ok(value.to_owned())
        }

        Ok(Self {
            role,
            zone_name: required(zone_name)?,
            owner_record_name: required(owner_record_name)?,
            root_record_name: required(root_record_name)?,
            short_guid: required(short_guid)?,
        })
    }

    /// Serialize the target into the opaque provider/enrollment storage id.
    pub fn to_storage_id(&self) -> ValidationResult<String> {
        serde_json::to_string(self)
            .map(|target| format!("icloud-share-v1:{target}"))
            .map_err(|_| ValidationError::SharedStorageTargetRequired)
    }

    pub fn from_storage_id(value: &str) -> ValidationResult<Self> {
        let encoded = value
            .trim()
            .strip_prefix("icloud-share-v1:")
            .ok_or(ValidationError::SharedStorageTargetRequired)?;
        let target: Self = serde_json::from_str(encoded)
            .map_err(|_| ValidationError::SharedStorageTargetRequired)?;
        Self::new(
            target.role,
            &target.zone_name,
            &target.owner_record_name,
            &target.root_record_name,
            &target.short_guid,
        )
    }
}

/// `CloudKit` routing for immutable event records.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub enum ICloudEventTarget {
    #[default]
    Private,
    Shared(ICloudSharedTarget),
}

impl ICloudEventTarget {
    pub fn from_storage_id(value: &str) -> ValidationResult<Self> {
        if value.trim().starts_with("icloud-share-v1:") {
            ICloudSharedTarget::from_storage_id(value).map(Self::Shared)
        } else {
            // Private CloudKit providers historically persisted an ordinary
            // file/remote ref in this slot. Only the versioned share prefix
            // opts a provider into shared-database routing.
            Ok(Self::Private)
        }
    }
}

impl OAuthFilePreset {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::GoogleDrive => "google-drive",
            Self::ICloud => "icloud",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        match value {
            "" | "google-drive" => Ok(Self::GoogleDrive),
            "icloud" => Ok(Self::ICloud),
            other => Err(ValidationError::UnknownStorageMode {
                mode: other.to_owned(),
            }),
        }
    }
}

/// Configured GitHub sync target identity.
///
/// Missing credentials are not a GitHub target; represent that as
/// [`SyncProviderTarget::Empty`] instead of optional fields here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubSyncTarget {
    pub repo: String,
    pub pat: String,
}

/// OAuth-file (Google Drive / iCloud) sync target identity inputs.
///
/// `file_id` and `file_name` are independent raw form fields that may both be
/// present at once (identity prefers `file_id`, falling back to `file_name`);
/// collapsing them into one enum would drop that legal "both known" input state,
/// so they stay `Option<String>` per the boundary-DTO exemption. `preset` is a
/// real closed set and is therefore modeled as the `OauthFilePreset` enum.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OauthFileSyncTarget {
    pub preset: OauthFilePreset,
    pub file_id: Option<String>,
    pub folder_id: Option<String>,
    pub file_name: Option<String>,
    pub account_email: Option<String>,
    pub access_token: Option<String>,
}

/// Browser File System Access sync target identity.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalFolderSyncTarget {
    pub directory_name: Option<String>,
    pub handle_id: Option<String>,
}

/// Storage/sync provider identity, one variant per provider kind.
///
/// `Empty` models the absence of a usable provider target. It has no stable
/// identity and is used when a persisted/browser row has not captured the fields
/// required to become a configured provider variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncProviderTarget {
    Empty,
    Local,
    LocalFolder(LocalFolderSyncTarget),
    Github(GithubSyncTarget),
    OauthFile(OauthFileSyncTarget),
}

/// Validates connect inputs. Returns trimmed GitHub PAT when mode is `Github`.
///
/// Accepts a string-typed `storage_mode` purely as a boundary convenience
/// for callers crossing FFI; the canonical internal type is `StorageMode`.
pub fn validate_connect(
    storage_mode: &str,
    github_pat: &str,
) -> Result<Option<GithubPat>, ValidationError> {
    let mode = StorageMode::parse(storage_mode)?;
    match mode {
        StorageMode::Github => Ok(Some(validate_github_pat(github_pat)?)),
        StorageMode::GoogleDrive | StorageMode::ICloud => {
            validate_oauth_access_token(github_pat)?;
            Ok(None)
        }
        StorageMode::Local => Ok(None),
    }
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;

    #[test]
    fn validate_connect_github_requires_pat() -> anyhow::Result<()> {
        assert!(validate_connect(STORAGE_MODE_GITHUB, "  ").is_err());
        assert_eq!(
            validate_connect(STORAGE_MODE_GITHUB, " ghp_test ")?
                .ok_or_else(|| std::io::Error::other("GitHub credential must be returned"))?
                .as_str(),
            "ghp_test"
        );
        Ok(())
    }

    #[test]
    fn validate_connect_local_ok() -> anyhow::Result<()> {
        assert_eq!(validate_connect(STORAGE_MODE_LOCAL, "")?, None);
        Ok(())
    }

    #[test]
    fn validate_storage_mode_rejects_unknown() -> anyhow::Result<()> {
        assert!(validate_storage_mode("s3").is_err());
        Ok(())
    }

    #[test]
    fn storage_mode_roundtrips_through_string_tag() -> anyhow::Result<()> {
        assert_eq!(StorageMode::Local.as_str(), "local");
        assert_eq!(StorageMode::Github.as_str(), "github");
        assert_eq!(StorageMode::GoogleDrive.as_str(), "google-drive");
        assert_eq!(StorageMode::ICloud.as_str(), "icloud");
        assert_eq!(StorageMode::parse("local")?, StorageMode::Local);
        assert_eq!(StorageMode::parse("github")?, StorageMode::Github);
        assert_eq!(
            StorageMode::parse("google-drive")?,
            StorageMode::GoogleDrive
        );
        assert_eq!(StorageMode::parse("icloud")?, StorageMode::ICloud);
        assert!(StorageMode::parse("s3").is_err());
        assert_eq!(format!("{}", StorageMode::Local), "local");
        Ok(())
    }

    #[test]
    fn storage_mode_consts_match_enum() -> anyhow::Result<()> {
        assert_eq!(STORAGE_MODE_LOCAL, StorageMode::Local.as_str());
        assert_eq!(STORAGE_MODE_GITHUB, StorageMode::Github.as_str());
        Ok(())
    }

    #[test]
    fn validate_connect_icloud_requires_access_token() -> anyhow::Result<()> {
        assert!(validate_connect("icloud", "  ").is_err());
        assert_eq!(validate_connect("icloud", " ck-web-token ")?, None);
        Ok(())
    }

    #[test]
    fn validate_connect_google_drive_requires_access_token() -> anyhow::Result<()> {
        assert!(validate_connect("google-drive", "  ").is_err());
        assert_eq!(validate_connect("google-drive", " ya29.test ")?, None);
        Ok(())
    }

    #[test]
    fn validate_drive_backup_name_defaults_and_rejects_invalid() -> anyhow::Result<()> {
        assert_eq!(
            validate_drive_backup_name("  ")?.as_str(),
            DEFAULT_DRIVE_BACKUP_NAME
        );
        assert_eq!(
            validate_drive_backup_name("work-vault.yaml")?.as_str(),
            "work-vault.yaml"
        );
        assert!(validate_drive_backup_name(".").is_err());
        assert!(validate_drive_backup_name("bad name").is_err());
        Ok(())
    }

    #[test]
    fn parse_drive_storage_ref_splits_file_id_and_name() -> anyhow::Result<()> {
        assert_eq!(
            parse_drive_storage_ref("abc123\twork-vault.yaml")?,
            (
                "abc123".to_owned(),
                validate_drive_backup_name("work-vault.yaml")?
            )
        );
        assert_eq!(
            parse_drive_storage_ref("nook-events")?,
            (String::new(), validate_drive_backup_name("nook-events")?)
        );
        Ok(())
    }

    #[test]
    fn format_drive_storage_ref_omits_empty_file_id() -> anyhow::Result<()> {
        assert_eq!(
            format_drive_storage_ref("", &validate_drive_backup_name("nook-events")?),
            "nook-events"
        );
        assert_eq!(
            format_drive_storage_ref("abc", &validate_drive_backup_name("work.yaml")?),
            "abc\twork.yaml"
        );
        Ok(())
    }

    #[test]
    fn format_drive_storage_ref_raw_does_not_validate_file_name() -> anyhow::Result<()> {
        assert_eq!(
            format_drive_storage_ref_raw(" abc ", " work vault.yaml "),
            "abc\twork vault.yaml"
        );
        Ok(())
    }

    #[test]
    fn validate_oauth_access_token_rejects_empty() -> anyhow::Result<()> {
        assert!(validate_oauth_access_token(" ").is_err());
        assert_eq!(validate_oauth_access_token(" token ")?.as_str(), "token");
        Ok(())
    }

    #[test]
    fn sync_provider_cache_ref_is_stable() -> anyhow::Result<()> {
        assert_eq!(
            format_sync_provider_cache_ref(StorageMode::Local, "", ""),
            "local"
        );
        assert_eq!(
            format_sync_provider_cache_ref(StorageMode::Github, "user/repo", "nook-log/v1/events"),
            "github:user/repo:nook-log/v1/events"
        );
        assert_eq!(
            format_sync_provider_cache_ref(StorageMode::GoogleDrive, "file-id", ""),
            "drive:file-id"
        );
        Ok(())
    }

    #[test]
    fn drive_event_parent_parses_shared_folder_prefix() -> anyhow::Result<()> {
        assert_eq!(
            DriveEventParent::from_storage_id(""),
            DriveEventParent::AppDataFolder
        );
        assert_eq!(
            DriveEventParent::from_storage_id("legacy-file-id"),
            DriveEventParent::AppDataFolder
        );
        assert_eq!(
            DriveEventParent::from_storage_id("shared:folder-xyz"),
            DriveEventParent::SharedFolder {
                folder_id: "folder-xyz".to_owned(),
            }
        );
        assert_eq!(
            DriveEventParent::SharedFolder {
                folder_id: "folder-xyz".to_owned(),
            }
            .encode_storage_id(),
            "shared:folder-xyz"
        );
        Ok(())
    }

    #[test]
    fn google_drive_mode_requires_an_explicit_current_value() -> anyhow::Result<()> {
        assert_eq!(GoogleDriveMode::parse("private")?, GoogleDriveMode::Private);
        assert_eq!(GoogleDriveMode::parse("shared")?, GoogleDriveMode::Shared);
        assert!(GoogleDriveMode::parse("").is_err());
        assert!(GoogleDriveMode::parse("public").is_err());
        Ok(())
    }

    #[test]
    fn icloud_shared_target_roundtrips_without_credentials() -> anyhow::Result<()> {
        let owner = ICloudSharedTarget::new(
            ICloudShareRole::Owner,
            "nook-zone",
            "owner-record",
            "root-record",
            "short-guid",
        )?;
        let storage_id = owner.to_storage_id()?;
        assert!(storage_id.starts_with("icloud-share-v1:"));
        assert_eq!(ICloudSharedTarget::from_storage_id(&storage_id)?, owner);
        assert_eq!(
            ICloudEventTarget::from_storage_id("")?,
            ICloudEventTarget::Private
        );
        assert_eq!(
            ICloudEventTarget::from_storage_id("nook-events")?,
            ICloudEventTarget::Private
        );
        assert_eq!(
            ICloudEventTarget::from_storage_id("legacy-private-record-ref")?,
            ICloudEventTarget::Private
        );
        assert_eq!(
            ICloudEventTarget::from_storage_id(&storage_id)?,
            ICloudEventTarget::Shared(owner)
        );
        assert!(ICloudEventTarget::from_storage_id("icloud-share-v1:{}").is_err());
        assert!(ICloudSharedTarget::from_storage_id("icloud-share-v1:{}").is_err());
        Ok(())
    }

    #[test]
    fn icloud_mode_requires_an_explicit_current_value() -> anyhow::Result<()> {
        assert_eq!(ICloudMode::parse("private")?, ICloudMode::Private);
        assert_eq!(ICloudMode::parse("shared")?, ICloudMode::Shared);
        assert!(ICloudMode::parse("").is_err());
        assert!(ICloudMode::parse("public").is_err());
        Ok(())
    }

    #[test]
    fn normalize_google_drive_folder_ref_accepts_id_and_folder_url() -> anyhow::Result<()> {
        assert_eq!(
            normalize_google_drive_folder_ref(" folder_ABC-123 ")?.as_str(),
            "folder_ABC-123"
        );
        assert_eq!(
            normalize_google_drive_folder_ref(
                "https://drive.google.com/drive/u/1/folders/folder_ABC-123?resourcekey=key"
            )?
            .as_str(),
            "folder_ABC-123"
        );
        assert!(normalize_google_drive_folder_ref("https://example.com/not-a-folder").is_err());
        Ok(())
    }
}
