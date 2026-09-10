use crate::SecretValue;
use crate::errors::{ValidationError, ValidationResult};
use crate::{AppId, AuthKeyId, SecretRecord};

/// Named values required by `SecretRecord::filter_secrets`.
#[derive(Clone, Copy)]
pub struct SecretRecordFilter<'a> {
    pub records: &'a [SecretRecord],
    pub query: &'a str,
}

impl SecretRecord {
    #[must_use]
    pub fn filter_secrets(request: SecretRecordFilter<'_>) -> Vec<SecretRecord> {
        let SecretRecordFilter { records, query } = request;
        let user_records: Vec<SecretRecord> = records
            .iter()
            .filter(|record| {
                !AppId::is_valid(record.id.as_str()) && !AuthKeyId::is_valid(record.id.as_str())
            })
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
}

impl SecretValue {
    pub fn validate_secret_data(data: &str) -> ValidationResult<()> {
        if data.is_empty() {
            return Err(ValidationError::SecretDataRequired);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ApiKeySecret, SecretId, SecretRecord, SecretRecordFilter, SecretType, SecretValue, StoreId,
    };

    fn value(key: &str) -> SecretValue {
        SecretValue::ApiKey(ApiKeySecret {
            website_url: "https://example.com".to_owned(),
            key: key.to_owned(),
            expires_at: String::new(),
        })
    }

    fn sample_records() -> anyhow::Result<Vec<SecretRecord>> {
        Ok(vec![
            SecretRecord {
                id: SecretId::parse("secret_SMypl8K0w9Y")?,
                secret_type: SecretType::ApiKey,
                data: value("a"),
            },
            SecretRecord {
                id: SecretId::parse("secret_SMypl8K0w9Z")?,
                secret_type: SecretType::ApiKey,
                data: value("b"),
            },
        ])
    }

    #[test]
    fn validates_secret_fields() -> anyhow::Result<()> {
        assert!(SecretId::parse("  ").is_err());
        assert_eq!(
            SecretId::parse(" secret_SMypl8K0w9Y ")?.as_str(),
            "secret_SMypl8K0w9Y"
        );
        assert!(SecretValue::validate_secret_data("").is_err());
        assert!(SecretValue::validate_secret_data("x").is_ok());
        assert!(SecretId::parse("abc123def4567890").is_err());
        assert!(SecretId::parse(&"a".repeat(64)).is_err());
        assert_eq!(
            StoreId::parse("store_SMypl8K0w9Y")?.as_str(),
            "store_SMypl8K0w9Y"
        );
        assert_eq!(StoreId::parse("SMypl8K0w9Y")?.as_str(), "store_SMypl8K0w9Y");
        assert!(StoreId::parse("short").is_err());
        assert_eq!(
            SecretId::parse("secret_SMypl8K0w9Y")?.as_str(),
            "secret_SMypl8K0w9Y"
        );
        Ok(())
    }

    #[test]
    fn filters_case_insensitively() -> anyhow::Result<()> {
        let filtered = SecretRecord::filter_secrets(SecretRecordFilter {
            records: &sample_records()?,
            query: "W9Y",
        });
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id.as_str(), "secret_SMypl8K0w9Y");
        Ok(())
    }

    #[test]
    fn empty_query_returns_all() -> anyhow::Result<()> {
        assert_eq!(
            SecretRecord::filter_secrets(SecretRecordFilter {
                records: &sample_records()?,
                query: "  "
            })
            .len(),
            2
        );
        Ok(())
    }

    #[test]
    fn no_match_returns_empty() -> anyhow::Result<()> {
        assert!(
            SecretRecord::filter_secrets(SecretRecordFilter {
                records: &sample_records()?,
                query: "aws"
            })
            .is_empty()
        );
        Ok(())
    }

    #[test]
    fn matches_substring_in_id() -> anyhow::Result<()> {
        let filtered = SecretRecord::filter_secrets(SecretRecordFilter {
            records: &sample_records()?,
            query: "K0w9Y",
        });
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id.as_str(), "secret_SMypl8K0w9Y");
        Ok(())
    }

    #[test]
    fn allows_whitespace_secret_data() {
        assert!(SecretValue::validate_secret_data("   ").is_ok());
    }

    #[test]
    fn does_not_search_values() -> anyhow::Result<()> {
        let records = vec![SecretRecord {
            id: SecretId::parse("secret_SMypl8K0w9X")?,
            secret_type: SecretType::ApiKey,
            data: value("find-me"),
        }];
        assert!(
            SecretRecord::filter_secrets(SecretRecordFilter {
                records: &records,
                query: "find-me"
            })
            .is_empty()
        );
        Ok(())
    }
}
