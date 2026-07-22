use crate::errors::{ValidationError, ValidationResult};
use crate::{is_auth_key_id, is_device_id};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StorageProviderType {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum OAuthFilePreset {
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
        "" | "private" => Ok(private),
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

/// Validated GitHub personal access token.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GithubPat(String);

impl GithubPat {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        validate_github_pat(raw)
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

impl std::fmt::Display for GithubPat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for GithubPat {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Safe display form of a stored GitHub PAT for provider lists.
///
/// Two real states, named rather than smuggled through `Option`/empty strings:
/// there is either no usable token, or a token truncated to a prefix hint that
/// never reveals the full secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubPatMask {
    /// No token is saved (or it is blank). UI supplies the localized copy.
    NoToken,
    /// The token, truncated to a leading hint (e.g. `github_pat_11A…`).
    Hint(String),
}

/// Fully hidden fallback used when even the prefix would leak too much.
const GITHUB_PAT_FULLY_HIDDEN: &str = "••••";

/// Number of leading characters kept as a recognizability hint. Fine-grained
/// (`github_pat_`) tokens keep a longer prefix than classic (`ghp_…`) ones so
/// the token family is still distinguishable without exposing the secret.
const GITHUB_PAT_FINE_GRAINED_HINT_LEN: usize = 14;
const GITHUB_PAT_CLASSIC_HINT_LEN: usize = 10;

/// Mask a stored GitHub PAT for display. Returns a named two-state result so
/// callers pattern-match on "no token" vs "hint" instead of guessing from a
/// sentinel string.
#[must_use]
pub fn mask_github_pat(pat: &str) -> GithubPatMask {
    let trimmed = pat.trim();
    if trimmed.is_empty() {
        return GithubPatMask::NoToken;
    }
    let prefix_len = if trimmed.starts_with("github_pat_") {
        GITHUB_PAT_FINE_GRAINED_HINT_LEN
    } else {
        GITHUB_PAT_CLASSIC_HINT_LEN
    };
    if trimmed.chars().count() <= prefix_len {
        return GithubPatMask::Hint(GITHUB_PAT_FULLY_HIDDEN.to_owned());
    }
    let hint: String = trimmed.chars().take(prefix_len).collect();
    GithubPatMask::Hint(format!("{hint}…"))
}

/// Validated GitHub repository name (not `owner/name`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GithubRepoName(String);

impl GithubRepoName {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        validate_github_repo_name(raw)
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

impl std::fmt::Display for GithubRepoName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for GithubRepoName {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Validated Google Drive app-data vault file name.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DriveBackupName(String);

impl DriveBackupName {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        validate_drive_backup_name(raw)
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
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl std::fmt::Display for DriveBackupName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
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
        validate_oauth_access_token(raw)
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

impl std::fmt::Display for OauthAccessToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for OauthAccessToken {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Boundary helper: confirms a raw string is a known storage mode. Prefer
/// `StorageMode::parse` when you also want the parsed value.
pub fn validate_storage_mode(mode: &str) -> ValidationResult<()> {
    StorageMode::parse(mode).map(|_| ())
}

pub fn validate_github_pat(pat: &str) -> ValidationResult<GithubPat> {
    let trimmed = pat.trim();
    if trimmed.is_empty() {
        return Err(ValidationError::GithubPatEmpty);
    }
    Ok(GithubPat(trimmed.to_owned()))
}

/// Validates a GitHub repository name (not `owner/name`). Empty uses [`DEFAULT_GITHUB_REPO_NAME`].
pub fn validate_github_repo_name(name: &str) -> ValidationResult<GithubRepoName> {
    let repo = if name.trim().is_empty() {
        DEFAULT_GITHUB_REPO_NAME.to_owned()
    } else {
        name.trim().to_owned()
    };
    if repo.len() > 100 {
        return Err(ValidationError::GithubRepoLength);
    }
    if repo == "." || repo == ".." {
        return Err(ValidationError::GithubRepoInvalid);
    }
    if !repo
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err(ValidationError::GithubRepoChars);
    }
    Ok(GithubRepoName(repo))
}

/// Validates a Google Drive app-data vault file name. Empty uses
/// [`DEFAULT_DRIVE_BACKUP_NAME`].
pub fn validate_drive_backup_name(name: &str) -> ValidationResult<DriveBackupName> {
    let file_name = if name.trim().is_empty() {
        DEFAULT_DRIVE_BACKUP_NAME.to_owned()
    } else {
        name.trim().to_owned()
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
    Ok(DriveBackupName(file_name))
}

/// Normalize either an opaque Drive folder id or a standard Drive folder URL.
/// Query parameters (including resource keys) are intentionally excluded from
/// the persisted provider identity; the folder id is the stable event parent.
pub fn normalize_google_drive_folder_ref(raw: &str) -> ValidationResult<GoogleDriveFolderId> {
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
        || !candidate
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(ValidationError::SharedStorageTargetInvalid);
    }
    Ok(GoogleDriveFolderId(candidate.to_owned()))
}

/// Parses the Drive storage reference from the web layer: `fileId\\tfileName`
/// or `fileName` alone when no cached file id exists yet.
///
/// Shared Google Drive provider folder ids are encoded as `shared:<folderId>` in the
/// `fileId` slot so connect args stay a 3-tuple.
pub fn parse_drive_storage_ref(value: &str) -> ValidationResult<(String, DriveBackupName)> {
    if let Some((file_id, file_name)) = value.split_once(DRIVE_STORAGE_REF_SEP) {
        Ok((
            file_id.trim().to_owned(),
            validate_drive_backup_name(file_name)?,
        ))
    } else {
        Ok((String::new(), validate_drive_backup_name(value)?))
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
    /// Parse the storage-id slot from [`parse_drive_storage_ref`].
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

#[must_use]
pub fn format_drive_storage_ref(file_id: &str, file_name: &DriveBackupName) -> String {
    format_drive_storage_ref_raw(file_id, file_name.as_str())
}

#[must_use]
pub fn format_drive_storage_ref_raw(file_id: &str, file_name: &str) -> String {
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

#[must_use]
pub fn storage_mode_for_provider(
    provider_type: StorageProviderType,
    oauth_preset: Option<OauthFilePreset>,
) -> StorageMode {
    match provider_type {
        StorageProviderType::Local | StorageProviderType::LocalFolder => StorageMode::Local,
        StorageProviderType::Github => StorageMode::Github,
        StorageProviderType::OauthFile => {
            match oauth_preset.unwrap_or(OauthFilePreset::GoogleDrive) {
                OauthFilePreset::GoogleDrive => StorageMode::GoogleDrive,
                OauthFilePreset::ICloud => StorageMode::ICloud,
            }
        }
    }
}

#[must_use]
pub fn sync_provider_default_label(
    provider_type: StorageProviderType,
    detail: Option<&str>,
    oauth_preset: Option<OauthFilePreset>,
) -> String {
    match provider_type {
        StorageProviderType::Local => "This device".to_owned(),
        StorageProviderType::LocalFolder => {
            let directory = detail.map(str::trim).filter(|value| !value.is_empty());
            directory.map_or_else(
                || "Local backup".to_owned(),
                |directory| format!("Local backup · {directory}"),
            )
        }
        StorageProviderType::Github => {
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
        StorageProviderType::OauthFile => {
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
pub fn staged_provider_default_label(
    provider_type: StorageProviderType,
    github_repo: Option<&str>,
    oauth_file_name: Option<&str>,
    oauth_file_preset: Option<OauthFilePreset>,
    oauth_setup_preset: Option<OauthFilePreset>,
) -> String {
    match provider_type {
        StorageProviderType::Github => {
            let detail = github_repo
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(DEFAULT_GITHUB_REPO_NAME);
            sync_provider_default_label(StorageProviderType::Github, Some(detail), None)
        }
        StorageProviderType::OauthFile => {
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
            sync_provider_default_label(StorageProviderType::OauthFile, Some(detail), Some(preset))
        }
        other => sync_provider_default_label(other, None, None),
    }
}

#[must_use]
pub fn has_provider_credentials(
    provider_type: StorageProviderType,
    github_pat: Option<&str>,
    oauth_access_token: Option<&str>,
    local_folder_handle_id: Option<&str>,
) -> bool {
    match provider_type {
        StorageProviderType::Github => github_pat
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()),
        StorageProviderType::OauthFile => oauth_access_token
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()),
        StorageProviderType::LocalFolder => local_folder_handle_id
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()),
        StorageProviderType::Local => true,
    }
}

#[must_use]
pub fn sync_provider_target_key(target: &SyncProviderTarget) -> Option<String> {
    fn non_empty(value: Option<&String>) -> Option<&str> {
        value
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
    }

    match target {
        SyncProviderTarget::Empty => None,
        SyncProviderTarget::Local => Some("local".to_owned()),
        SyncProviderTarget::LocalFolder(folder) => {
            let key = non_empty(folder.handle_id.as_ref())
                .or_else(|| non_empty(folder.directory_name.as_ref()))
                .unwrap_or("unselected");
            Some(format!("local-folder:{key}"))
        }
        SyncProviderTarget::Github(github) => {
            let repo = github.repo.trim().to_lowercase();
            let pat = github.pat.trim();
            Some(format!("github:{repo}:{pat}"))
        }
        SyncProviderTarget::OauthFile(oauth) => {
            let file_key = non_empty(oauth.folder_id.as_ref())
                .map(|folder_id| format!("shared:{folder_id}"))
                .or_else(|| non_empty(oauth.file_id.as_ref()).map(str::to_owned))
                .or_else(|| non_empty(oauth.file_name.as_ref()).map(str::to_owned))
                .unwrap_or_else(|| DEFAULT_DRIVE_BACKUP_NAME.to_owned());
            let account_key = non_empty(oauth.account_email.as_ref())
                .or_else(|| non_empty(oauth.access_token.as_ref()))
                .unwrap_or_default();
            Some(format!(
                "oauth-file:{}:{file_key}:{account_key}",
                oauth.preset.as_str()
            ))
        }
    }
}

pub fn validate_oauth_access_token(token: &str) -> ValidationResult<OauthAccessToken> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err(ValidationError::OauthAccessTokenEmpty);
    }
    Ok(OauthAccessToken(trimmed.to_owned()))
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

/// Compact random id (`generate_id` — 11 chars, base64url).
#[must_use]
#[allow(dead_code)]
pub fn is_compact_id(key: &str) -> bool {
    crate::is_compact_token(key)
}

#[must_use]
pub fn filter_secrets(records: &[crate::SecretRecord], query: &str) -> Vec<crate::SecretRecord> {
    let user_records: Vec<crate::SecretRecord> = records
        .iter()
        .filter(|record| !is_device_id(record.id.as_str()) && !is_auth_key_id(record.id.as_str()))
        .cloned()
        .collect();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return user_records;
    }

    user_records
        .into_iter()
        .filter(|record| record.id.as_str().to_lowercase().contains(&needle))
        .collect()
}

pub fn validate_secret_data(data: &str) -> ValidationResult<()> {
    if data.is_empty() {
        return Err(ValidationError::SecretDataRequired);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ApiKeySecret, SecretRecord, SecretType, SecretValue, validate_secret_id, validate_store_id,
    };

    fn value(key: &str) -> SecretValue {
        SecretValue::ApiKey(ApiKeySecret {
            website_url: "https://example.com".to_owned(),
            key: key.to_owned(),
            expires_at: String::new(),
        })
    }

    fn sample_records() -> Vec<SecretRecord> {
        vec![
            SecretRecord {
                id: validate_secret_id("github.com").unwrap(),
                secret_type: SecretType::ApiKey,
                data: value("a"),
            },
            SecretRecord {
                id: validate_secret_id("work-vpn").unwrap(),
                secret_type: SecretType::ApiKey,
                data: value("b"),
            },
        ]
    }

    #[test]
    fn validate_github_repo_name_defaults_and_rejects_invalid() {
        assert_eq!(
            validate_github_repo_name("  ").unwrap().as_str(),
            DEFAULT_GITHUB_REPO_NAME
        );
        assert_eq!(
            validate_github_repo_name("work-vault").unwrap().as_str(),
            "work-vault"
        );
        assert!(validate_github_repo_name(".").is_err());
        assert!(validate_github_repo_name("bad name").is_err());
    }

    #[test]
    fn validate_connect_github_requires_pat() {
        assert!(validate_connect(STORAGE_MODE_GITHUB, "  ").is_err());
        assert_eq!(
            validate_connect(STORAGE_MODE_GITHUB, " ghp_test ")
                .unwrap()
                .unwrap()
                .as_str(),
            "ghp_test"
        );
    }

    #[test]
    fn validate_connect_local_ok() {
        assert_eq!(validate_connect(STORAGE_MODE_LOCAL, "").unwrap(), None);
    }

    #[test]
    fn storage_mode_for_provider_maps_oauth_presets() {
        assert_eq!(
            storage_mode_for_provider(StorageProviderType::Local, None),
            StorageMode::Local
        );
        assert_eq!(
            storage_mode_for_provider(StorageProviderType::LocalFolder, None),
            StorageMode::Local
        );
        assert_eq!(
            storage_mode_for_provider(StorageProviderType::Github, None),
            StorageMode::Github
        );
        assert_eq!(
            storage_mode_for_provider(StorageProviderType::OauthFile, None),
            StorageMode::GoogleDrive
        );
        assert_eq!(
            storage_mode_for_provider(
                StorageProviderType::OauthFile,
                Some(OauthFilePreset::ICloud)
            ),
            StorageMode::ICloud
        );
    }

    #[test]
    fn provider_default_labels_match_sync_provider_ui() {
        assert_eq!(
            sync_provider_default_label(StorageProviderType::Local, None, None),
            "This device"
        );
        assert_eq!(
            sync_provider_default_label(
                StorageProviderType::LocalFolder,
                Some("Nook Backup"),
                None,
            ),
            "Local backup · Nook Backup"
        );
        assert_eq!(
            sync_provider_default_label(StorageProviderType::Github, Some("team-vault"), None),
            "GitHub · team-vault"
        );
        assert_eq!(
            sync_provider_default_label(StorageProviderType::OauthFile, None, None),
            "Google Drive"
        );
        assert_eq!(
            sync_provider_default_label(
                StorageProviderType::OauthFile,
                Some("work.yaml"),
                Some(OauthFilePreset::ICloud),
            ),
            "iCloud · work.yaml"
        );
    }

    #[test]
    fn staged_provider_labels_match_login_setup_draft_fields() {
        assert_eq!(
            staged_provider_default_label(
                StorageProviderType::Github,
                Some("  team-vault  "),
                None,
                None,
                None,
            ),
            "GitHub · team-vault"
        );
        assert_eq!(
            staged_provider_default_label(
                StorageProviderType::Github,
                Some("  "),
                None,
                None,
                None
            ),
            "GitHub"
        );
        assert_eq!(
            staged_provider_default_label(
                StorageProviderType::OauthFile,
                Some("drive-vault"),
                Some("ignored-file"),
                None,
                Some(OauthFilePreset::ICloud),
            ),
            "iCloud · drive-vault"
        );
        assert_eq!(
            staged_provider_default_label(
                StorageProviderType::OauthFile,
                Some("  "),
                Some(" personal-events "),
                Some(OauthFilePreset::GoogleDrive),
                Some(OauthFilePreset::ICloud),
            ),
            "Google Drive · personal-events"
        );
        assert_eq!(
            staged_provider_default_label(
                StorageProviderType::LocalFolder,
                Some("ignored"),
                Some("ignored"),
                None,
                None,
            ),
            "Local backup"
        );
    }

    #[test]
    fn provider_credentials_match_provider_requirements() {
        assert!(has_provider_credentials(
            StorageProviderType::Local,
            None,
            None,
            None,
        ));
        assert!(has_provider_credentials(
            StorageProviderType::Github,
            Some(" ghp_test "),
            None,
            None,
        ));
        assert!(!has_provider_credentials(
            StorageProviderType::Github,
            Some(" "),
            None,
            None,
        ));
        assert!(has_provider_credentials(
            StorageProviderType::OauthFile,
            None,
            Some(" token "),
            None,
        ));
        assert!(!has_provider_credentials(
            StorageProviderType::OauthFile,
            None,
            None,
            None,
        ));
        assert!(has_provider_credentials(
            StorageProviderType::LocalFolder,
            None,
            None,
            Some(" folder-1 "),
        ));
        assert!(!has_provider_credentials(
            StorageProviderType::LocalFolder,
            None,
            None,
            Some(" "),
        ));
    }

    #[test]
    fn mask_github_pat_named_states() {
        assert_eq!(mask_github_pat("   "), GithubPatMask::NoToken);
        assert_eq!(mask_github_pat(""), GithubPatMask::NoToken);
        assert_eq!(
            mask_github_pat("github_pat_11AAAAAAAAAA"),
            GithubPatMask::Hint("github_pat_11A…".to_owned())
        );
        assert_eq!(
            mask_github_pat("ghp_1234567890ABCDEF"),
            GithubPatMask::Hint("ghp_123456…".to_owned())
        );
        assert_eq!(
            mask_github_pat("ghp_short"),
            GithubPatMask::Hint("••••".to_owned())
        );
    }

    #[test]
    fn sync_provider_target_key_matches_duplicates_by_storage_identity() {
        let github_a = SyncProviderTarget::Github(GithubSyncTarget {
            repo: "My-Repo".to_owned(),
            pat: "github_pat_11AAAA".to_owned(),
        });
        let github_b = SyncProviderTarget::Github(GithubSyncTarget {
            repo: "my-repo".to_owned(),
            pat: "github_pat_11AAAA".to_owned(),
        });
        assert_eq!(
            sync_provider_target_key(&github_a),
            sync_provider_target_key(&github_b)
        );

        let drive_by_id = SyncProviderTarget::OauthFile(OauthFileSyncTarget {
            preset: OauthFilePreset::GoogleDrive,
            file_id: Some("file-123".to_owned()),
            folder_id: None,
            file_name: Some("other-name.yaml".to_owned()),
            account_email: Some("me@example.com".to_owned()),
            access_token: Some("ya29.test".to_owned()),
        });
        let drive_by_name = SyncProviderTarget::OauthFile(OauthFileSyncTarget {
            preset: OauthFilePreset::GoogleDrive,
            file_id: None,
            folder_id: None,
            file_name: Some("other-name.yaml".to_owned()),
            account_email: Some("me@example.com".to_owned()),
            access_token: Some("ya29.test".to_owned()),
        });
        assert_ne!(
            sync_provider_target_key(&drive_by_id),
            sync_provider_target_key(&drive_by_name)
        );

        let folder = SyncProviderTarget::LocalFolder(LocalFolderSyncTarget {
            directory_name: Some("Nook Backup".to_owned()),
            handle_id: Some("folder-1".to_owned()),
        });
        assert_eq!(
            sync_provider_target_key(&folder),
            Some("local-folder:folder-1".to_owned())
        );

        assert_eq!(sync_provider_target_key(&SyncProviderTarget::Empty), None);
    }

    #[test]
    fn validate_secret_fields() {
        assert!(validate_secret_id("  ").is_err());
        assert_eq!(validate_secret_id(" github ").unwrap().as_str(), "github");
        assert!(validate_secret_data("").is_err());
        assert!(validate_secret_data("x").is_ok());
        assert!(validate_secret_id("abc123def4567890").is_err());
        assert!(validate_secret_id(&"a".repeat(64)).is_err());
        assert_eq!(
            validate_store_id("store_SMypl8K0w9Y").unwrap().as_str(),
            "store_SMypl8K0w9Y"
        );
        assert_eq!(
            validate_store_id("SMypl8K0w9Y").unwrap().as_str(),
            "store_SMypl8K0w9Y"
        );
        assert!(validate_store_id("short").is_err());
        assert_eq!(
            validate_secret_id("secret_SMypl8K0w9Y").unwrap().as_str(),
            "secret_SMypl8K0w9Y"
        );
    }

    #[test]
    fn filter_secrets_case_insensitive() {
        let filtered = filter_secrets(&sample_records(), "GIT");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id.as_str(), "github.com");
    }

    #[test]
    fn filter_secrets_empty_query_returns_all() {
        assert_eq!(filter_secrets(&sample_records(), "  ").len(), 2);
    }

    #[test]
    fn validate_storage_mode_rejects_unknown() {
        assert!(validate_storage_mode("s3").is_err());
    }

    #[test]
    fn storage_mode_roundtrips_through_string_tag() {
        assert_eq!(StorageMode::Local.as_str(), "local");
        assert_eq!(StorageMode::Github.as_str(), "github");
        assert_eq!(StorageMode::GoogleDrive.as_str(), "google-drive");
        assert_eq!(StorageMode::ICloud.as_str(), "icloud");
        assert_eq!(StorageMode::parse("local").unwrap(), StorageMode::Local);
        assert_eq!(StorageMode::parse("github").unwrap(), StorageMode::Github);
        assert_eq!(
            StorageMode::parse("google-drive").unwrap(),
            StorageMode::GoogleDrive
        );
        assert_eq!(StorageMode::parse("icloud").unwrap(), StorageMode::ICloud);
        assert!(StorageMode::parse("s3").is_err());
        assert_eq!(format!("{}", StorageMode::Local), "local");
    }

    #[test]
    fn storage_mode_consts_match_enum() {
        assert_eq!(STORAGE_MODE_LOCAL, StorageMode::Local.as_str());
        assert_eq!(STORAGE_MODE_GITHUB, StorageMode::Github.as_str());
    }

    #[test]
    fn validate_connect_icloud_requires_access_token() {
        assert!(validate_connect("icloud", "  ").is_err());
        assert_eq!(validate_connect("icloud", " ck-web-token ").unwrap(), None);
    }

    #[test]
    fn validate_connect_google_drive_requires_access_token() {
        assert!(validate_connect("google-drive", "  ").is_err());
        assert_eq!(
            validate_connect("google-drive", " ya29.test ").unwrap(),
            None
        );
    }

    #[test]
    fn validate_drive_backup_name_defaults_and_rejects_invalid() {
        assert_eq!(
            validate_drive_backup_name("  ").unwrap().as_str(),
            DEFAULT_DRIVE_BACKUP_NAME
        );
        assert_eq!(
            validate_drive_backup_name("work-vault.yaml")
                .unwrap()
                .as_str(),
            "work-vault.yaml"
        );
        assert!(validate_drive_backup_name(".").is_err());
        assert!(validate_drive_backup_name("bad name").is_err());
    }

    #[test]
    fn parse_drive_storage_ref_splits_file_id_and_name() {
        assert_eq!(
            parse_drive_storage_ref("abc123\twork-vault.yaml").unwrap(),
            (
                "abc123".to_owned(),
                validate_drive_backup_name("work-vault.yaml").unwrap()
            )
        );
        assert_eq!(
            parse_drive_storage_ref("nook-events").unwrap(),
            (
                String::new(),
                validate_drive_backup_name("nook-events").unwrap()
            )
        );
    }

    #[test]
    fn format_drive_storage_ref_omits_empty_file_id() {
        assert_eq!(
            format_drive_storage_ref("", &validate_drive_backup_name("nook-events").unwrap()),
            "nook-events"
        );
        assert_eq!(
            format_drive_storage_ref("abc", &validate_drive_backup_name("work.yaml").unwrap()),
            "abc\twork.yaml"
        );
    }

    #[test]
    fn format_drive_storage_ref_raw_does_not_validate_file_name() {
        assert_eq!(
            format_drive_storage_ref_raw(" abc ", " work vault.yaml "),
            "abc\twork vault.yaml"
        );
    }

    #[test]
    fn validate_oauth_access_token_rejects_empty() {
        assert!(validate_oauth_access_token(" ").is_err());
        assert_eq!(
            validate_oauth_access_token(" token ").unwrap().as_str(),
            "token"
        );
    }

    #[test]
    fn filter_secrets_no_match_returns_empty() {
        assert!(filter_secrets(&sample_records(), "aws").is_empty());
    }

    #[test]
    fn filter_secrets_matches_substring_in_label() {
        let filtered = filter_secrets(&sample_records(), ".com");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id.as_str(), "github.com");
    }

    #[test]
    fn validate_secret_data_allows_whitespace() {
        assert!(validate_secret_data("   ").is_ok());
    }

    #[test]
    fn filter_secrets_does_not_search_values() {
        let records = vec![SecretRecord {
            id: validate_secret_id("label").unwrap(),
            secret_type: SecretType::ApiKey,
            data: value("find-me"),
        }];
        assert!(filter_secrets(&records, "find-me").is_empty());
    }

    #[test]
    fn sync_provider_cache_ref_is_stable() {
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
    }

    #[test]
    fn drive_event_parent_parses_shared_folder_prefix() {
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
    }

    #[test]
    fn google_drive_mode_is_explicit_and_backward_compatible() {
        assert_eq!(
            GoogleDriveMode::parse("").unwrap(),
            GoogleDriveMode::Private
        );
        assert_eq!(
            GoogleDriveMode::parse("shared").unwrap(),
            GoogleDriveMode::Shared
        );
        assert!(GoogleDriveMode::parse("public").is_err());
    }

    #[test]
    fn icloud_shared_target_roundtrips_without_credentials() {
        let owner = ICloudSharedTarget::new(
            ICloudShareRole::Owner,
            "nook-zone",
            "owner-record",
            "root-record",
            "short-guid",
        )
        .unwrap();
        let storage_id = owner.to_storage_id().unwrap();
        assert!(storage_id.starts_with("icloud-share-v1:"));
        assert_eq!(
            ICloudSharedTarget::from_storage_id(&storage_id).unwrap(),
            owner
        );
        assert_eq!(
            ICloudEventTarget::from_storage_id("").unwrap(),
            ICloudEventTarget::Private
        );
        assert_eq!(
            ICloudEventTarget::from_storage_id("nook-events").unwrap(),
            ICloudEventTarget::Private
        );
        assert_eq!(
            ICloudEventTarget::from_storage_id("legacy-private-record-ref").unwrap(),
            ICloudEventTarget::Private
        );
        assert_eq!(
            ICloudEventTarget::from_storage_id(&storage_id).unwrap(),
            ICloudEventTarget::Shared(owner)
        );
        assert!(ICloudEventTarget::from_storage_id("icloud-share-v1:{}").is_err());
        assert!(ICloudSharedTarget::from_storage_id("icloud-share-v1:{}").is_err());
    }

    #[test]
    fn icloud_mode_is_explicit_and_backward_compatible() {
        assert_eq!(ICloudMode::parse("").unwrap(), ICloudMode::Private);
        assert_eq!(ICloudMode::parse("shared").unwrap(), ICloudMode::Shared);
        assert!(ICloudMode::parse("public").is_err());
    }

    #[test]
    fn normalize_google_drive_folder_ref_accepts_id_and_folder_url() {
        assert_eq!(
            normalize_google_drive_folder_ref(" folder_ABC-123 ")
                .unwrap()
                .as_str(),
            "folder_ABC-123"
        );
        assert_eq!(
            normalize_google_drive_folder_ref(
                "https://drive.google.com/drive/u/1/folders/folder_ABC-123?resourcekey=key"
            )
            .unwrap()
            .as_str(),
            "folder_ABC-123"
        );
        assert!(normalize_google_drive_folder_ref("https://example.com/not-a-folder").is_err());
    }
}
