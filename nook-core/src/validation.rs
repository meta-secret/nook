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
        }
    }

    /// Parse a tag string (typically arriving from the JS layer) into the
    /// enum. Unknown values are rejected at the boundary so no caller has
    /// to defend against typos downstream.
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "local" => Ok(Self::Local),
            "github" => Ok(Self::Github),
            "google-drive" => Ok(Self::GoogleDrive),
            other => Err(format!("errors.validation.unknown_storage_mode:{}", other)),
        }
    }
}

impl std::fmt::Display for StorageMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
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

/// Boundary helper: confirms a raw string is a known storage mode. Prefer
/// `StorageMode::parse` when you also want the parsed value.
pub fn validate_storage_mode(mode: &str) -> Result<(), String> {
    StorageMode::parse(mode).map(|_| ())
}

pub fn validate_github_pat(pat: &str) -> Result<String, String> {
    let trimmed = pat.trim();
    if trimmed.is_empty() {
        return Err("errors.validation.github_pat_empty".to_owned());
    }
    Ok(trimmed.to_owned())
}

/// Validates a GitHub repository name (not `owner/name`). Empty uses [`DEFAULT_GITHUB_REPO_NAME`].
pub fn validate_github_repo_name(name: &str) -> Result<String, String> {
    let repo = if name.trim().is_empty() {
        DEFAULT_GITHUB_REPO_NAME.to_owned()
    } else {
        name.trim().to_owned()
    };
    if repo.len() > 100 {
        return Err("errors.validation.github_repo_length".to_owned());
    }
    if repo == "." || repo == ".." {
        return Err("errors.validation.github_repo_invalid".to_owned());
    }
    if !repo
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err("errors.validation.github_repo_chars".to_owned());
    }
    Ok(repo)
}

/// Validates a Google Drive app-data vault file name. Empty uses
/// [`DEFAULT_DRIVE_VAULT_FILE_NAME`].
pub fn validate_drive_vault_file_name(name: &str) -> Result<String, String> {
    let file_name = if name.trim().is_empty() {
        DEFAULT_DRIVE_VAULT_FILE_NAME.to_owned()
    } else {
        name.trim().to_owned()
    };
    if file_name.len() > 100 {
        return Err("errors.validation.drive_file_name_length".to_owned());
    }
    if file_name == "." || file_name == ".." {
        return Err("errors.validation.drive_file_name_invalid".to_owned());
    }
    if !file_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err("errors.validation.drive_file_name_chars".to_owned());
    }
    Ok(file_name)
}

/// Parses the Drive storage reference from the web layer: `fileId\\tfileName`
/// or `fileName` alone when no cached file id exists yet.
#[must_use]
pub fn parse_drive_storage_ref(value: &str) -> (String, String) {
    if let Some((file_id, file_name)) = value.split_once(DRIVE_STORAGE_REF_SEP) {
        (file_id.trim().to_owned(), file_name.trim().to_owned())
    } else {
        (String::new(), value.trim().to_owned())
    }
}

#[must_use]
pub fn format_drive_storage_ref(file_id: &str, file_name: &str) -> String {
    let id = file_id.trim();
    let name = file_name.trim();
    if id.is_empty() {
        name.to_owned()
    } else {
        format!("{id}{DRIVE_STORAGE_REF_SEP}{name}")
    }
}

pub fn validate_oauth_access_token(token: &str) -> Result<String, String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("errors.validation.oauth_access_token_empty".to_owned());
    }
    Ok(trimmed.to_owned())
}

/// Validates connect inputs. Returns trimmed GitHub PAT when mode is `Github`.
///
/// Accepts a string-typed `storage_mode` purely as a boundary convenience
/// for callers crossing FFI; the canonical internal type is `StorageMode`.
pub fn validate_connect(storage_mode: &str, github_pat: &str) -> Result<Option<String>, String> {
    let mode = StorageMode::parse(storage_mode)?;
    match mode {
        StorageMode::Github => Ok(Some(validate_github_pat(github_pat)?)),
        StorageMode::GoogleDrive => {
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
        .filter(|record| !is_device_id(&record.id) && !is_auth_key_id(&record.id))
        .cloned()
        .collect();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return user_records;
    }

    user_records
        .into_iter()
        .filter(|record| record.id.to_lowercase().contains(&needle))
        .collect()
}

pub fn validate_secret_data(data: &str) -> Result<(), String> {
    if data.is_empty() {
        return Err("errors.validation.secret_data_required".to_owned());
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
                id: "github.com".to_owned(),
                secret_type: SecretType::ApiKey,
                data: value("a"),
            },
            SecretRecord {
                id: "work-vpn".to_owned(),
                secret_type: SecretType::ApiKey,
                data: value("b"),
            },
        ]
    }

    #[test]
    fn validate_github_repo_name_defaults_and_rejects_invalid() {
        assert_eq!(
            validate_github_repo_name("  ").unwrap(),
            DEFAULT_GITHUB_REPO_NAME
        );
        assert_eq!(
            validate_github_repo_name("work-vault").unwrap(),
            "work-vault"
        );
        assert!(validate_github_repo_name(".").is_err());
        assert!(validate_github_repo_name("bad name").is_err());
    }

    #[test]
    fn validate_connect_github_requires_pat() {
        assert!(validate_connect(STORAGE_MODE_GITHUB, "  ").is_err());
        assert_eq!(
            validate_connect(STORAGE_MODE_GITHUB, " ghp_test ").unwrap(),
            Some("ghp_test".to_owned())
        );
    }

    #[test]
    fn validate_connect_local_ok() {
        assert_eq!(validate_connect(STORAGE_MODE_LOCAL, "").unwrap(), None);
    }

    #[test]
    fn validate_secret_fields() {
        assert!(validate_secret_id("  ").is_err());
        assert_eq!(validate_secret_id(" github ").unwrap(), "github");
        assert!(validate_secret_data("").is_err());
        assert!(validate_secret_data("x").is_ok());
        assert!(validate_secret_id("abc123def4567890").is_err());
        assert!(validate_secret_id(&"a".repeat(64)).is_err());
        assert_eq!(
            validate_store_id("store_SMypl8K0w9Y").unwrap(),
            "store_SMypl8K0w9Y"
        );
        assert_eq!(
            validate_store_id("SMypl8K0w9Y").unwrap(),
            "store_SMypl8K0w9Y"
        );
        assert!(validate_store_id("short").is_err());
        assert_eq!(
            validate_secret_id("secret_SMypl8K0w9Y").unwrap(),
            "secret_SMypl8K0w9Y"
        );
    }

    #[test]
    fn filter_secrets_case_insensitive() {
        let filtered = filter_secrets(&sample_records(), "GIT");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "github.com");
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
        assert_eq!(StorageMode::parse("local").unwrap(), StorageMode::Local);
        assert_eq!(StorageMode::parse("github").unwrap(), StorageMode::Github);
        assert_eq!(
            StorageMode::parse("google-drive").unwrap(),
            StorageMode::GoogleDrive
        );
        assert!(StorageMode::parse("s3").is_err());
        assert_eq!(format!("{}", StorageMode::Local), "local");
    }

    #[test]
    fn storage_mode_consts_match_enum() {
        assert_eq!(STORAGE_MODE_LOCAL, StorageMode::Local.as_str());
        assert_eq!(STORAGE_MODE_GITHUB, StorageMode::Github.as_str());
    }

    #[test]
    fn validate_connect_rejects_unknown_mode() {
        assert!(validate_connect("icloud", "token").is_err());
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
            validate_drive_vault_file_name("  ").unwrap(),
            DEFAULT_DRIVE_VAULT_FILE_NAME
        );
        assert_eq!(
            validate_drive_vault_file_name("work-vault.yaml").unwrap(),
            "work-vault.yaml"
        );
        assert!(validate_drive_vault_file_name(".").is_err());
        assert!(validate_drive_vault_file_name("bad name").is_err());
    }

    #[test]
    fn parse_drive_storage_ref_splits_file_id_and_name() {
        assert_eq!(
            parse_drive_storage_ref("abc123\twork-vault.yaml"),
            ("abc123".to_owned(), "work-vault.yaml".to_owned())
        );
        assert_eq!(
            parse_drive_storage_ref("nook-vault.yaml"),
            (String::new(), "nook-vault.yaml".to_owned())
        );
    }

    #[test]
    fn format_drive_storage_ref_omits_empty_file_id() {
        assert_eq!(
            format_drive_storage_ref("", "nook-vault.yaml"),
            "nook-vault.yaml"
        );
        assert_eq!(
            format_drive_storage_ref("abc", "work.yaml"),
            "abc\twork.yaml"
        );
    }

    #[test]
    fn validate_oauth_access_token_rejects_empty() {
        assert!(validate_oauth_access_token(" ").is_err());
        assert_eq!(validate_oauth_access_token(" token ").unwrap(), "token");
    }

    #[test]
    fn filter_secrets_no_match_returns_empty() {
        assert!(filter_secrets(&sample_records(), "aws").is_empty());
    }

    #[test]
    fn filter_secrets_matches_substring_in_label() {
        let filtered = filter_secrets(&sample_records(), ".com");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "github.com");
    }

    #[test]
    fn validate_secret_data_allows_whitespace() {
        assert!(validate_secret_data("   ").is_ok());
    }

    #[test]
    fn filter_secrets_does_not_search_values() {
        let records = vec![SecretRecord {
            id: "label".to_owned(),
            secret_type: SecretType::ApiKey,
            data: value("find-me"),
        }];
        assert!(filter_secrets(&records, "find-me").is_empty());
    }
}
