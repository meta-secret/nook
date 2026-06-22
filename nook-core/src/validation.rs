use crate::SecretRecord;
use crate::is_auth_id;
use crate::is_device_id;

pub const STORAGE_MODE_LOCAL: &str = "local";
pub const STORAGE_MODE_GITHUB: &str = "github";
pub const DEFAULT_GITHUB_REPO_NAME: &str = "nook";

pub fn validate_storage_mode(mode: &str) -> Result<(), String> {
    match mode {
        STORAGE_MODE_LOCAL | STORAGE_MODE_GITHUB => Ok(()),
        _ => Err(format!("Unknown storage mode: {mode}")),
    }
}

pub fn validate_github_pat(pat: &str) -> Result<String, String> {
    let trimmed = pat.trim();
    if trimmed.is_empty() {
        return Err("Enter a GitHub personal access token to connect.".to_owned());
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
        return Err("GitHub repository name must be 100 characters or fewer.".to_owned());
    }
    if repo == "." || repo == ".." {
        return Err("Invalid GitHub repository name.".to_owned());
    }
    if !repo
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err(
            "Repository name may only contain letters, numbers, dots, hyphens, and underscores."
                .to_owned(),
        );
    }
    Ok(repo)
}

/// Validates connect inputs. Returns trimmed GitHub PAT when mode is `github`.
pub fn validate_connect(storage_mode: &str, github_pat: &str) -> Result<Option<String>, String> {
    validate_storage_mode(storage_mode)?;
    if storage_mode == STORAGE_MODE_GITHUB {
        Ok(Some(validate_github_pat(github_pat)?))
    } else {
        Ok(None)
    }
}

pub fn validate_secret_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("Secret id is required.".to_owned());
    }
    if is_device_id(trimmed) || is_auth_id(trimmed) {
        return Err("Secret id cannot use a reserved device id.".to_owned());
    }
    Ok(trimmed.to_owned())
}

pub fn validate_secret_data(data: &str) -> Result<(), String> {
    if data.is_empty() {
        return Err("Secret data is required.".to_owned());
    }
    Ok(())
}

#[must_use]
pub fn filter_secrets(records: &[SecretRecord], query: &str) -> Vec<SecretRecord> {
    let user_records: Vec<SecretRecord> = records
        .iter()
        .filter(|record| !is_device_id(&record.id) && !is_auth_id(&record.id))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ApiKeySecret, SecretType, SecretValue};

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
    fn validate_connect_rejects_unknown_mode() {
        assert!(validate_connect("icloud", "token").is_err());
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
