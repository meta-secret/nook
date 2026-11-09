#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use std::fmt;

use crate::errors::{ValidationError, ValidationResult};
use nook_app_common::i18n_keys;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod provider_configuration;
pub use provider_configuration::*;

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
    /// Shareable Google Drive folder (authenticated with OAuth access token).
    GoogleDrive,
    /// Shared `CloudKit` record zone (authenticated with `CloudKit` web auth token).
    ICloud,
    /// S3-compatible bucket (each request signed with this device's own key).
    S3,
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
            Self::S3 => "s3",
        }
    }
}

impl fmt::Display for StorageMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

pub const DEFAULT_GITHUB_REPO_NAME: &str = "nook";

/// Which provider a row, a draft, or the picker's choice is. It is derived
/// from a row or a draft and never stored beside one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "type",
    content = "preset",
    rename_all = "kebab-case",
    deny_unknown_fields
)]
pub enum ProviderKind {
    Local,
    LocalFolder,
    Github,
    OauthFile(OAuthFilePreset),
    /// S3-compatible storage: endpoint, region, bucket, key prefix, and this
    /// device's own access key.
    S3,
}

impl ProviderKind {
    #[must_use]
    pub const fn storage_mode(self) -> StorageMode {
        match self {
            Self::Local | Self::LocalFolder => StorageMode::Local,
            Self::Github => StorageMode::Github,
            Self::OauthFile(OAuthFilePreset::GoogleDrive) => StorageMode::GoogleDrive,
            Self::OauthFile(OAuthFilePreset::ICloud) => StorageMode::ICloud,
            Self::S3 => StorageMode::S3,
        }
    }

    /// The name logs and the replication error use.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::LocalFolder => "local-folder",
            Self::Github => "github",
            Self::OauthFile(preset) => preset.as_str(),
            Self::S3 => "s3",
        }
    }

    /// The toast a successful connect shows. Both OAuth presets keep the
    /// Google Drive wording they show today.
    #[must_use]
    pub const fn connected_toast_key(self) -> &'static str {
        match self {
            Self::Local => i18n_keys::TOASTS_LOCAL_LOADED,
            Self::LocalFolder => i18n_keys::TOASTS_LOCAL_FOLDER_CONNECTED,
            Self::Github => i18n_keys::TOASTS_GITHUB_CONNECTED,
            Self::OauthFile(_) => i18n_keys::TOASTS_GOOGLE_DRIVE_CONNECTED,
            Self::S3 => i18n_keys::TOASTS_S3_CONNECTED,
        }
    }

    /// The name a setup heading gives this provider; this browser's own
    /// store takes the host's words for it.
    #[must_use]
    pub const fn setup_name_key(self, this_browser: &str) -> &str {
        match self {
            Self::Local => this_browser,
            Self::LocalFolder => i18n_keys::PROVIDER_PICKER_LOCAL_FOLDER,
            Self::Github => i18n_keys::AUTH_STORAGE_GITHUB,
            Self::OauthFile(OAuthFilePreset::GoogleDrive) => {
                i18n_keys::PROVIDER_PICKER_GOOGLE_DRIVE
            }
            Self::OauthFile(OAuthFilePreset::ICloud) => i18n_keys::PROVIDER_PICKER_ICLOUD,
            Self::S3 => i18n_keys::PROVIDER_PICKER_S3,
        }
    }
}

/// The provider a setup heading names and the host's words for keeping the
/// vault in this browser only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderSetupNameRequest {
    pub kind: ProviderKind,
    pub this_browser_key: String,
}

impl ProviderSetupNameRequest {
    #[must_use]
    pub fn translation_key(&self) -> &str {
        self.kind.setup_name_key(&self.this_browser_key)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum OAuthFilePreset {
    GoogleDrive,
    #[serde(rename = "icloud")]
    ICloud,
}

/// Which `CloudKit` database exposes a shared record hierarchy to this account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
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
pub struct ICloudSharedTarget {
    pub role: ICloudShareRole,
    pub zone_name: String,
    pub owner_record_name: String,
    pub root_record_name: String,
    pub short_guid: String,
}

impl ICloudSharedTarget {
    fn required(value: &str) -> ValidationResult<String> {
        let value = value.trim();
        if value.is_empty() {
            return Err(ValidationError::SharedStorageTargetRequired);
        }
        Ok(value.to_owned())
    }

    pub fn new(
        role: ICloudShareRole,
        zone_name: &str,
        owner_record_name: &str,
        root_record_name: &str,
        short_guid: &str,
    ) -> ValidationResult<Self> {
        Ok(Self {
            role,
            zone_name: Self::required(zone_name)?,
            owner_record_name: Self::required(owner_record_name)?,
            root_record_name: Self::required(root_record_name)?,
            short_guid: Self::required(short_guid)?,
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

/// The storage id of one `CloudKit` share, `icloud-share-v1:{target}`, as a row,
/// a draft, and a connection hold it. It reads back only when it names a
/// complete [`ICloudSharedTarget`].
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct ICloudShareTargetId(String);

impl ICloudShareTargetId {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(id) = self;
        id
    }

    /// The share and zone the id names.
    pub fn target(&self) -> ValidationResult<ICloudSharedTarget> {
        ICloudSharedTarget::from_storage_id(self.as_str())
    }
}

/// Kept trimmed, as the share was created or accepted.
impl TryFrom<String> for ICloudShareTargetId {
    type Error = ValidationError;
    fn try_from(id: String) -> ValidationResult<Self> {
        ICloudSharedTarget::from_storage_id(&id)?;
        Ok(Self(id.trim().to_owned()))
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
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {

    use super::*;

    #[test]
    fn a_kind_is_tagged_by_its_type_and_names_its_mode_toast_and_heading() -> anyhow::Result<()> {
        let drive = ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive);
        let icloud = ProviderKind::OauthFile(OAuthFilePreset::ICloud);
        for (kind, wire, mode, label, toast, heading) in [
            (
                ProviderKind::Local,
                serde_json::json!({ "type": "local" }),
                StorageMode::Local,
                "local",
                i18n_keys::TOASTS_LOCAL_LOADED,
                i18n_keys::AUTH_STORAGE_THIS_DEVICE,
            ),
            (
                ProviderKind::LocalFolder,
                serde_json::json!({ "type": "local-folder" }),
                StorageMode::Local,
                "local-folder",
                i18n_keys::TOASTS_LOCAL_FOLDER_CONNECTED,
                i18n_keys::PROVIDER_PICKER_LOCAL_FOLDER,
            ),
            (
                ProviderKind::Github,
                serde_json::json!({ "type": "github" }),
                StorageMode::Github,
                "github",
                i18n_keys::TOASTS_GITHUB_CONNECTED,
                i18n_keys::AUTH_STORAGE_GITHUB,
            ),
            (
                drive,
                serde_json::json!({ "type": "oauth-file", "preset": "google-drive" }),
                StorageMode::GoogleDrive,
                "google-drive",
                i18n_keys::TOASTS_GOOGLE_DRIVE_CONNECTED,
                i18n_keys::PROVIDER_PICKER_GOOGLE_DRIVE,
            ),
            (
                icloud,
                serde_json::json!({ "type": "oauth-file", "preset": "icloud" }),
                StorageMode::ICloud,
                "icloud",
                i18n_keys::TOASTS_GOOGLE_DRIVE_CONNECTED,
                i18n_keys::PROVIDER_PICKER_ICLOUD,
            ),
            (
                ProviderKind::S3,
                serde_json::json!({ "type": "s3" }),
                StorageMode::S3,
                "s3",
                i18n_keys::TOASTS_S3_CONNECTED,
                i18n_keys::PROVIDER_PICKER_S3,
            ),
        ] {
            assert_eq!(serde_json::to_value(kind)?, wire);
            assert_eq!(serde_json::from_value::<ProviderKind>(wire)?, kind);
            assert_eq!(kind.storage_mode(), mode);
            assert_eq!(kind.label(), label);
            assert_eq!(kind.connected_toast_key(), toast);
            let heading_request = ProviderSetupNameRequest {
                kind,
                this_browser_key: i18n_keys::AUTH_STORAGE_THIS_DEVICE.to_owned(),
            };
            assert_eq!(heading_request.translation_key(), heading);
        }
        for damaged in [
            serde_json::json!({ "type": "oauth-file" }),
            serde_json::json!({ "type": "github", "preset": "google-drive" }),
            serde_json::json!({ "type": "oauth-file", "preset": "dropbox" }),
            serde_json::json!("github"),
        ] {
            assert!(
                serde_json::from_value::<ProviderKind>(damaged.clone()).is_err(),
                "{damaged}"
            );
        }
        Ok(())
    }

    #[test]
    fn an_icloud_share_id_reads_back_only_when_it_names_a_share() -> anyhow::Result<()> {
        let storage_id = ICloudSharedTarget::new(
            ICloudShareRole::Owner,
            "nook-zone",
            "owner-record",
            "root-record",
            "short-guid",
        )?
        .to_storage_id()?;
        let id = ICloudShareTargetId::try_from(format!(" {storage_id} "))?;
        assert_eq!(id.as_str(), storage_id);
        assert_eq!(id.target()?.zone_name, "nook-zone");
        assert_eq!(
            serde_json::from_value::<ICloudShareTargetId>(serde_json::json!(storage_id))?,
            id
        );
        for damaged in ["", "nook-events", "icloud-share-v1:{}"] {
            assert!(ICloudShareTargetId::try_from(damaged.to_owned()).is_err());
        }
        assert!(ICloudShareTargetId::DECL.ends_with("export type ICloudShareTargetId = string;"));
        Ok(())
    }

    #[test]
    fn storage_mode_has_its_string_tag() -> anyhow::Result<()> {
        assert_eq!(StorageMode::Local.as_str(), "local");
        assert_eq!(StorageMode::Github.as_str(), "github");
        assert_eq!(StorageMode::GoogleDrive.as_str(), "google-drive");
        assert_eq!(StorageMode::ICloud.as_str(), "icloud");
        assert_eq!(StorageMode::S3.as_str(), "s3");
        assert_eq!(format!("{}", StorageMode::Local), "local");
        Ok(())
    }

    #[test]
    fn validate_oauth_access_token_rejects_empty() -> anyhow::Result<()> {
        assert!(OauthAccessToken::parse(" ").is_err());
        assert_eq!(OauthAccessToken::parse(" token ")?.as_str(), "token");
        Ok(())
    }

    #[test]
    fn drive_connections_require_the_shared_folder() -> anyhow::Result<()> {
        assert_eq!(
            DriveEventParent::parse_folder_id(" my-drive-folder ")?,
            DriveEventParent::shared_folder_id("my-drive-folder")
        );
        // Every Drive provider is shared: no connection falls back to a hidden folder.
        for unnamed in ["", " \t "] {
            assert_eq!(
                DriveEventParent::parse_folder_id(unnamed),
                Err(ValidationError::SharedStorageTargetRequired)
            );
        }
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
        // Every iCloud provider is shared: a plain record ref is not a target.
        assert!(ICloudSharedTarget::from_storage_id("").is_err());
        assert!(ICloudSharedTarget::from_storage_id("nook-events").is_err());
        assert!(ICloudSharedTarget::from_storage_id("icloud-share-v1:{}").is_err());
        Ok(())
    }

    #[test]
    fn a_drive_folder_id_is_an_id_and_never_a_folder_url() -> anyhow::Result<()> {
        assert_eq!(
            GoogleDriveFolderId::parse(" folder_ABC-123 ")?.as_str(),
            "folder_ABC-123"
        );
        assert_eq!(
            GoogleDriveFolderId::parse(" "),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        for pasted in [
            "https://drive.google.com/drive/u/1/folders/folder_ABC-123?resourcekey=key",
            "https://drive.google.com/drive/folders/folder_ABC-123",
            "folders/folder_ABC-123",
            "folder ABC",
            &"a".repeat(257),
        ] {
            assert_eq!(
                GoogleDriveFolderId::parse(pasted),
                Err(ValidationError::SharedStorageTargetInvalid),
                "{pasted}"
            );
        }
        Ok(())
    }
}
