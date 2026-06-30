//! Display and search helpers for vault secrets — shared by WASM, mobile, and CLI.

use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::{SecretRecord, SecretType, SecretValue};

fn hostname_from_url(raw: &str) -> String {
    let mut host = raw.trim();
    if host.is_empty() {
        return String::new();
    }
    if let Some(rest) = host.split("://").nth(1) {
        host = rest;
    }
    host = host.split('/').next().unwrap_or(host);
    host = host.split(':').next().unwrap_or(host);
    host.trim_start_matches("www.").to_owned()
}

impl SecretRecord {
    /// Primary label for list rows (website URL, account name, note title, …).
    #[must_use]
    pub fn display_title(&self) -> String {
        match &self.data {
            SecretValue::Login(value) => value.website_url.clone(),
            SecretValue::ApiKey(value) => value.website_url.clone(),
            SecretValue::SeedPhrase(value) => value.name.clone(),
            SecretValue::SecureNote(value) => value.title.clone(),
        }
    }

    /// Default copy target for the row reveal action (password, key, seed, note body).
    #[must_use]
    pub fn primary_credential(&self) -> &str {
        match &self.data {
            SecretValue::Login(value) => value.password.as_str(),
            SecretValue::ApiKey(value) => value.key.as_str(),
            SecretValue::SeedPhrase(value) => value.seed.as_str(),
            SecretValue::SecureNote(value) => value.note.as_str(),
        }
    }

    /// Group key for vault list clustering (hostname, name, title, …).
    #[must_use]
    pub fn group_key(&self) -> String {
        match &self.data {
            SecretValue::Login(value) => {
                let host = hostname_from_url(&value.website_url);
                if host.is_empty() {
                    "No Website".to_owned()
                } else {
                    host
                }
            }
            SecretValue::ApiKey(value) => {
                let host = hostname_from_url(&value.website_url);
                if host.is_empty() {
                    "No Website".to_owned()
                } else {
                    host
                }
            }
            SecretValue::SeedPhrase(value) => {
                let name = value.name.trim();
                if name.is_empty() {
                    "Unnamed Seed Phrase".to_owned()
                } else {
                    name.to_owned()
                }
            }
            SecretValue::SecureNote(value) => {
                let title = value.title.trim();
                if title.is_empty() {
                    "Unnamed Note".to_owned()
                } else {
                    title.to_owned()
                }
            }
        }
    }

    /// Collapsed-row summary shown beside the type badge.
    #[must_use]
    pub fn summary(&self) -> String {
        match &self.data {
            SecretValue::Login(value) => {
                if !value.username.trim().is_empty() {
                    return value.username.trim().to_owned();
                }
                if !value.website_url.trim().is_empty() {
                    return value.website_url.trim().to_owned();
                }
                "login".to_owned()
            }
            SecretValue::ApiKey(value) => {
                if !value.website_url.trim().is_empty() {
                    return value.website_url.trim().to_owned();
                }
                "api-key".to_owned()
            }
            SecretValue::SeedPhrase(value) => value.name.trim().to_owned(),
            SecretValue::SecureNote(value) => value.title.trim().to_owned(),
        }
    }

    /// Case-insensitive search over non-secret metadata fields.
    #[must_use]
    pub fn matches_search(&self, query: &str) -> bool {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return true;
        }

        let mut fields = vec![self.group_key(), self.summary(), self.id.to_string()];
        match &self.data {
            SecretValue::Login(value) => {
                fields.push(value.website_url.clone());
                fields.push(value.username.clone());
            }
            SecretValue::ApiKey(value) => {
                fields.push(value.website_url.clone());
                if !value.expires_at.is_empty() {
                    fields.push(value.expires_at.clone());
                }
            }
            SecretValue::SeedPhrase(value) => {
                fields.push(value.name.clone());
            }
            SecretValue::SecureNote(value) => {
                fields.push(value.title.clone());
            }
        }

        fields
            .iter()
            .any(|field| field.to_lowercase().contains(&needle))
    }
}

/// Build a validated YAML payload for `add_secret` / `replace_secret` from form fields.
pub fn build_secret_yaml(
    secret_type: SecretType,
    fields: &serde_json::Value,
) -> SecretPayloadResult<String> {
    let yaml = serde_yaml::to_string(fields).map_err(SecretPayloadError::Serialize)?;
    let value = SecretValue::from_yaml(secret_type, &yaml)?;
    value.to_yaml()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LoginSecret, SecretId};

    fn login_record() -> SecretRecord {
        SecretRecord {
            id: SecretId::from_vault_record("secret_test"),
            secret_type: SecretType::Login,
            data: SecretValue::Login(LoginSecret {
                website_url: "https://www.github.com/login".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: String::new(),
            }),
        }
    }

    #[test]
    fn group_key_strips_www_from_login_url() {
        assert_eq!(login_record().group_key(), "github.com");
    }

    #[test]
    fn matches_search_uses_metadata_not_secrets() {
        let record = login_record();
        assert!(record.matches_search("alice"));
        assert!(!record.matches_search("correct"));
    }

    #[test]
    fn build_secret_yaml_round_trips_login_fields() {
        let fields = serde_json::json!({
            "websiteUrl": "https://example.com",
            "username": "bob",
            "password": "pw",
            "notes": "note"
        });
        let yaml = build_secret_yaml(SecretType::Login, &fields).unwrap();
        let parsed = SecretValue::from_yaml(SecretType::Login, &yaml).unwrap();
        match parsed {
            SecretValue::Login(value) => {
                assert_eq!(value.username, "bob");
                assert_eq!(value.password, "pw");
            }
            _ => panic!("expected login"),
        }
    }

    #[test]
    fn build_secret_yaml_validates_seed_phrase() {
        let fields = serde_json::json!({
            "name": "Main",
            "seed": "invalid phrase"
        });
        assert!(build_secret_yaml(SecretType::SeedPhrase, &fields).is_err());
    }
}
