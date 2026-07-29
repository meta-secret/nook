use super::*;

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
