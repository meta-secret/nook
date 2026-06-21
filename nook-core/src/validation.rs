use crate::is_auth_id;
use crate::is_device_id;
use crate::SecretRecord;

pub const STORAGE_MODE_LOCAL: &str = "local";
pub const STORAGE_MODE_GITHUB: &str = "github";

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

/// Validates connect inputs. Returns trimmed GitHub PAT when mode is `github`.
pub fn validate_connect(storage_mode: &str, github_pat: &str) -> Result<Option<String>, String> {
    validate_storage_mode(storage_mode)?;
    if storage_mode == STORAGE_MODE_GITHUB {
        Ok(Some(validate_github_pat(github_pat)?))
    } else {
        Ok(None)
    }
}

pub fn validate_secret_label(key: &str) -> Result<String, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Secret label is required.".to_owned());
    }
    if is_device_id(trimmed) || is_auth_id(trimmed) {
        return Err("Secret label cannot use a reserved device id.".to_owned());
    }
    Ok(trimmed.to_owned())
}

pub fn validate_secret_value(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err("Secret value is required.".to_owned());
    }
    Ok(())
}

pub fn filter_secrets(records: &[SecretRecord], query: &str) -> Vec<SecretRecord> {
    let user_records: Vec<SecretRecord> = records
        .iter()
        .filter(|record| !is_device_id(&record.key) && !is_auth_id(&record.key))
        .cloned()
        .collect();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return user_records;
    }

    user_records
        .into_iter()
        .filter(|record| record.key.to_lowercase().contains(&needle))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_records() -> Vec<SecretRecord> {
        vec![
            SecretRecord {
                key: "github.com".to_owned(),
                value: "a".to_owned(),
            },
            SecretRecord {
                key: "work-vpn".to_owned(),
                value: "b".to_owned(),
            },
        ]
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
        assert!(validate_secret_label("  ").is_err());
        assert_eq!(validate_secret_label(" github ").unwrap(), "github");
        assert!(validate_secret_value("").is_err());
        assert!(validate_secret_value("x").is_ok());
        assert!(validate_secret_label("abc123def4567890").is_err());
        assert!(validate_secret_label(&"a".repeat(64)).is_err());
    }

    #[test]
    fn filter_secrets_case_insensitive() {
        let filtered = filter_secrets(&sample_records(), "GIT");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].key, "github.com");
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
        assert_eq!(filtered[0].key, "github.com");
    }

    #[test]
    fn validate_secret_value_allows_whitespace() {
        assert!(validate_secret_value("   ").is_ok());
    }

    #[test]
    fn filter_secrets_does_not_search_values() {
        let records = vec![SecretRecord {
            key: "label".to_owned(),
            value: "find-me".to_owned(),
        }];
        assert!(filter_secrets(&records, "find-me").is_empty());
    }
}
