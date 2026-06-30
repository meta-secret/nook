use crate::errors::{ValidationError, ValidationResult};
use crate::{is_auth_key_id, is_device_id};

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
pub const DEFAULT_DRIVE_VAULT_FILE_NAME: &str = "nook-vault.yaml";

/// Separator between optional known Drive file id and vault file name in the
/// wasm connect `github_repo` argument for `google-drive` mode.
pub const DRIVE_STORAGE_REF_SEP: char = '\t';

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
pub struct DriveVaultFileName(String);

impl DriveVaultFileName {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        validate_drive_vault_file_name(raw)
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

impl std::fmt::Display for DriveVaultFileName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for DriveVaultFileName {
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
/// [`DEFAULT_DRIVE_VAULT_FILE_NAME`].
pub fn validate_drive_vault_file_name(name: &str) -> ValidationResult<DriveVaultFileName> {
    let file_name = if name.trim().is_empty() {
        DEFAULT_DRIVE_VAULT_FILE_NAME.to_owned()
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
    Ok(DriveVaultFileName(file_name))
}

/// Parses the Drive storage reference from the web layer: `fileId\\tfileName`
/// or `fileName` alone when no cached file id exists yet.
pub fn parse_drive_storage_ref(value: &str) -> ValidationResult<(String, DriveVaultFileName)> {
    if let Some((file_id, file_name)) = value.split_once(DRIVE_STORAGE_REF_SEP) {
        Ok((
            file_id.trim().to_owned(),
            validate_drive_vault_file_name(file_name)?,
        ))
    } else {
        Ok((String::new(), validate_drive_vault_file_name(value)?))
    }
}

#[must_use]
pub fn format_drive_storage_ref(file_id: &str, file_name: &DriveVaultFileName) -> String {
    let id = file_id.trim();
    let name = file_name.as_str();
    if id.is_empty() {
        name.to_owned()
    } else {
        format!("{id}{DRIVE_STORAGE_REF_SEP}{name}")
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
    fn validate_drive_vault_file_name_defaults_and_rejects_invalid() {
        assert_eq!(
            validate_drive_vault_file_name("  ").unwrap().as_str(),
            DEFAULT_DRIVE_VAULT_FILE_NAME
        );
        assert_eq!(
            validate_drive_vault_file_name("work-vault.yaml")
                .unwrap()
                .as_str(),
            "work-vault.yaml"
        );
        assert!(validate_drive_vault_file_name(".").is_err());
        assert!(validate_drive_vault_file_name("bad name").is_err());
    }

    #[test]
    fn parse_drive_storage_ref_splits_file_id_and_name() {
        assert_eq!(
            parse_drive_storage_ref("abc123\twork-vault.yaml").unwrap(),
            (
                "abc123".to_owned(),
                validate_drive_vault_file_name("work-vault.yaml").unwrap()
            )
        );
        assert_eq!(
            parse_drive_storage_ref("nook-vault.yaml").unwrap(),
            (
                String::new(),
                validate_drive_vault_file_name("nook-vault.yaml").unwrap()
            )
        );
    }

    #[test]
    fn format_drive_storage_ref_omits_empty_file_id() {
        assert_eq!(
            format_drive_storage_ref(
                "",
                &validate_drive_vault_file_name("nook-vault.yaml").unwrap()
            ),
            "nook-vault.yaml"
        );
        assert_eq!(
            format_drive_storage_ref("abc", &validate_drive_vault_file_name("work.yaml").unwrap()),
            "abc\twork.yaml"
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
            format_sync_provider_cache_ref(StorageMode::Github, "user/repo", "nook-vault.yaml"),
            "github:user/repo:nook-vault.yaml"
        );
        assert_eq!(
            format_sync_provider_cache_ref(StorageMode::GoogleDrive, "file-id", ""),
            "drive:file-id"
        );
    }
}
