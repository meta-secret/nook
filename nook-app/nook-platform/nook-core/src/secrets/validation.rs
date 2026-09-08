#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::{AppId, AuthKeyId, SecretRecord};

/// A borrowed search over user-owned secret records.
#[derive(Clone, Copy)]
pub struct SecretRecordSearch<'a> {
    pub records: &'a [SecretRecord],
    pub query: &'a str,
}

impl SecretRecordSearch<'_> {
    #[must_use]
    pub fn filter(self) -> Vec<SecretRecord> {
        let user_records: Vec<SecretRecord> = self
            .records
            .iter()
            .filter(|record| {
                !AppId::is_valid(record.id.as_str()) && !AuthKeyId::is_valid(record.id.as_str())
            })
            .cloned()
            .collect();
        let needle = self.query.trim().to_lowercase();
        if needle.is_empty() {
            return user_records;
        }

        user_records
            .into_iter()
            .filter(|record| record.id.as_str().to_lowercase().contains(&needle))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::{ApiKeySecret, SecretId, SecretRecord, SecretType, SecretValue, StoreId};

    use super::SecretRecordSearch;
    use crate::{SecretPayloadValidationRequest, SecretPayloadYaml};

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
        assert!(
            SecretPayloadYaml::validate(SecretPayloadValidationRequest {
                secret_type: SecretType::Login,
                raw: "",
            })
            .is_err()
        );
        assert!(
            SecretPayloadYaml::validate(SecretPayloadValidationRequest {
                secret_type: SecretType::Login,
                raw: "x",
            })
            .is_err()
        );
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
        let records = sample_records()?;
        let filtered = SecretRecordSearch {
            records: &records,
            query: "W9Y",
        }
        .filter();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id.as_str(), "secret_SMypl8K0w9Y");
        Ok(())
    }

    #[test]
    fn empty_query_returns_all() -> anyhow::Result<()> {
        let records = sample_records()?;
        assert_eq!(
            SecretRecordSearch {
                records: &records,
                query: "  ",
            }
            .filter()
            .len(),
            2
        );
        Ok(())
    }

    #[test]
    fn no_match_returns_empty() -> anyhow::Result<()> {
        let records = sample_records()?;
        assert!(
            SecretRecordSearch {
                records: &records,
                query: "aws",
            }
            .filter()
            .is_empty()
        );
        Ok(())
    }

    #[test]
    fn matches_substring_in_id() -> anyhow::Result<()> {
        let records = sample_records()?;
        let filtered = SecretRecordSearch {
            records: &records,
            query: "K0w9Y",
        }
        .filter();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id.as_str(), "secret_SMypl8K0w9Y");
        Ok(())
    }

    #[test]
    fn allows_whitespace_secret_data() {
        assert!(
            SecretPayloadYaml::validate(SecretPayloadValidationRequest {
                secret_type: SecretType::Login,
                raw: "   ",
            })
            .is_err()
        );
    }

    #[test]
    fn does_not_search_values() -> anyhow::Result<()> {
        let records = vec![SecretRecord {
            id: SecretId::parse("secret_SMypl8K0w9X")?,
            secret_type: SecretType::ApiKey,
            data: value("find-me"),
        }];
        assert!(
            SecretRecordSearch {
                records: &records,
                query: "find-me",
            }
            .filter()
            .is_empty()
        );
        Ok(())
    }
}
