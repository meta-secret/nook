//! Display and search helpers for vault secrets — shared by WASM, mobile, and CLI.

use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::vault_wire::SecretPayloadYaml;
use crate::{SecretId, SecretRecord, SecretType, SecretValue};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretListItemData {
    Login {
        website_url: String,
        username: String,
    },
    ApiKey {
        website_url: String,
        expires_at: String,
    },
    SeedPhrase {
        name: String,
        word_count: usize,
    },
    SecureNote {
        title: String,
    },
    Passkey {
        rp_id: String,
        user_name: String,
        user_display_name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretListItem {
    pub id: SecretId,
    pub data: SecretListItemData,
}

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
    /// Build the secret-free list representation that may cross into UI state.
    ///
    /// Credentials, login notes, seed words, and secure-note bodies are
    /// intentionally absent. Callers must request the full record separately
    /// for an explicit reveal, secret copy, or edit action.
    #[must_use]
    pub fn list_item(&self) -> SecretListItem {
        let data = match &self.data {
            SecretValue::Login(value) => SecretListItemData::Login {
                website_url: value.website_url.clone(),
                username: value.username.clone(),
            },
            SecretValue::ApiKey(value) => SecretListItemData::ApiKey {
                website_url: value.website_url.clone(),
                expires_at: value.expires_at.clone(),
            },
            SecretValue::SeedPhrase(value) => SecretListItemData::SeedPhrase {
                name: value.name.clone(),
                word_count: value.seed.split_whitespace().count(),
            },
            SecretValue::SecureNote(value) => SecretListItemData::SecureNote {
                title: value.title.clone(),
            },
            SecretValue::Passkey(value) => SecretListItemData::Passkey {
                rp_id: value.rp_id.clone(),
                user_name: value.user_name.clone(),
                user_display_name: value.user_display_name.clone(),
            },
        };
        SecretListItem {
            id: self.id.clone(),
            data,
        }
    }

    /// Primary label for list rows (website URL, account name, note title, …).
    #[must_use]
    pub fn display_title(&self) -> String {
        match &self.data {
            SecretValue::Login(value) => value.website_url.clone(),
            SecretValue::ApiKey(value) => value.website_url.clone(),
            SecretValue::SeedPhrase(value) => value.name.clone(),
            SecretValue::SecureNote(value) => value.title.clone(),
            SecretValue::Passkey(value) => value.rp_id.clone(),
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
            SecretValue::Passkey(_) => "",
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
            SecretValue::Passkey(value) => value.rp_id.clone(),
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
            SecretValue::Passkey(value) => {
                if value.user_display_name.trim().is_empty() {
                    value.user_name.trim().to_owned()
                } else {
                    value.user_display_name.trim().to_owned()
                }
            }
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
            SecretValue::Passkey(value) => {
                fields.push(value.rp_id.clone());
                fields.push(value.rp_name.clone());
                fields.push(value.user_name.clone());
                fields.push(value.user_display_name.clone());
            }
        }

        fields
            .iter()
            .any(|field| field.to_lowercase().contains(&needle))
    }
}

impl SecretListItem {
    #[must_use]
    pub fn secret_type(&self) -> SecretType {
        match &self.data {
            SecretListItemData::Login { .. } => SecretType::Login,
            SecretListItemData::ApiKey { .. } => SecretType::ApiKey,
            SecretListItemData::SeedPhrase { .. } => SecretType::SeedPhrase,
            SecretListItemData::SecureNote { .. } => SecretType::SecureNote,
            SecretListItemData::Passkey { .. } => SecretType::Passkey,
        }
    }

    #[must_use]
    pub fn display_title(&self) -> String {
        match &self.data {
            SecretListItemData::Login { website_url, .. }
            | SecretListItemData::ApiKey { website_url, .. } => website_url.clone(),
            SecretListItemData::SeedPhrase { name, .. } => name.clone(),
            SecretListItemData::SecureNote { title } => title.clone(),
            SecretListItemData::Passkey { rp_id, .. } => rp_id.clone(),
        }
    }

    #[must_use]
    pub fn group_key(&self) -> String {
        match &self.data {
            SecretListItemData::Login { website_url, .. }
            | SecretListItemData::ApiKey { website_url, .. } => {
                let host = hostname_from_url(website_url);
                if host.is_empty() {
                    "No Website".to_owned()
                } else {
                    host
                }
            }
            SecretListItemData::SeedPhrase { name, .. } => {
                let name = name.trim();
                if name.is_empty() {
                    "Unnamed Seed Phrase".to_owned()
                } else {
                    name.to_owned()
                }
            }
            SecretListItemData::SecureNote { title } => {
                let title = title.trim();
                if title.is_empty() {
                    "Unnamed Note".to_owned()
                } else {
                    title.to_owned()
                }
            }
            SecretListItemData::Passkey { rp_id, .. } => rp_id.clone(),
        }
    }

    #[must_use]
    pub fn summary(&self) -> String {
        match &self.data {
            SecretListItemData::Login {
                website_url,
                username,
            } => {
                if !username.trim().is_empty() {
                    username.trim().to_owned()
                } else if !website_url.trim().is_empty() {
                    website_url.trim().to_owned()
                } else {
                    "login".to_owned()
                }
            }
            SecretListItemData::ApiKey { website_url, .. } => {
                if website_url.trim().is_empty() {
                    "api-key".to_owned()
                } else {
                    website_url.trim().to_owned()
                }
            }
            SecretListItemData::SeedPhrase { name, .. } => name.trim().to_owned(),
            SecretListItemData::SecureNote { title } => title.trim().to_owned(),
            SecretListItemData::Passkey {
                user_name,
                user_display_name,
                ..
            } => {
                if user_display_name.trim().is_empty() {
                    user_name.trim().to_owned()
                } else {
                    user_display_name.trim().to_owned()
                }
            }
        }
    }
}

/// Build a validated YAML payload for `add_secret` / `replace_secret` from form fields.
pub fn build_secret_yaml(
    secret_type: SecretType,
    fields: &serde_json::Value,
) -> SecretPayloadResult<SecretPayloadYaml> {
    let filtered = match secret_type {
        SecretType::Login => serde_json::json!({
            "websiteUrl": fields.get("websiteUrl").and_then(|v| v.as_str()).unwrap_or_default(),
            "username": fields.get("username").and_then(|v| v.as_str()).unwrap_or_default(),
            "password": fields.get("password").and_then(|v| v.as_str()).unwrap_or_default(),
            "notes": fields.get("notes").and_then(|v| v.as_str()).unwrap_or_default(),
        }),
        SecretType::ApiKey => serde_json::json!({
            "websiteUrl": fields.get("websiteUrl").and_then(|v| v.as_str()).unwrap_or_default(),
            "key": fields.get("key").and_then(|v| v.as_str()).unwrap_or_default(),
            "expiresAt": fields.get("expiresAt").and_then(|v| v.as_str()).unwrap_or_default(),
        }),
        SecretType::SeedPhrase => serde_json::json!({
            "name": fields.get("name").and_then(|v| v.as_str()).unwrap_or_default(),
            "seed": fields.get("seed").and_then(|v| v.as_str()).unwrap_or_default(),
        }),
        SecretType::SecureNote => serde_json::json!({
            "title": fields.get("title").and_then(|v| v.as_str()).unwrap_or_default(),
            "note": fields.get("note").and_then(|v| v.as_str()).unwrap_or_default(),
        }),
        SecretType::Passkey => {
            return Err(SecretPayloadError::PasskeyCreationRequiresAuthenticator);
        }
    };
    let yaml = serde_yaml::to_string(&filtered).map_err(SecretPayloadError::Serialize)?;
    SecretPayloadYaml::parse(secret_type, &yaml)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        LoginSecret, PASSKEY_SECRET_VERSION, PasskeyCredentialKey, PasskeyPrivateKeyPkcs8,
        PasskeyPublicKeyCose, PasskeySecret, SecretId,
    };
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};

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
    fn list_item_keeps_login_metadata_and_drops_sensitive_fields() {
        let item = login_record().list_item();

        assert_eq!(item.secret_type(), SecretType::Login);
        assert_eq!(item.group_key(), "github.com");
        assert_eq!(item.summary(), "alice");
        assert_eq!(
            item.data,
            SecretListItemData::Login {
                website_url: "https://www.github.com/login".to_owned(),
                username: "alice".to_owned(),
            }
        );
        assert!(!format!("{item:?}").contains("correct horse battery staple"));
    }

    #[test]
    fn list_item_exposes_only_derived_seed_word_count() {
        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_seed"),
            secret_type: SecretType::SeedPhrase,
            data: SecretValue::SeedPhrase(crate::SeedPhraseSecret {
                name: "wallet".to_owned(),
                seed: "abandon ability able about above absent absorb abstract absurd abuse access accident".to_owned(),
            }),
        };

        let item = record.list_item();

        assert_eq!(
            item.data,
            SecretListItemData::SeedPhrase {
                name: "wallet".to_owned(),
                word_count: 12,
            }
        );
        assert!(!format!("{item:?}").contains("abandon"));
    }

    #[test]
    fn passkey_list_item_exposes_account_metadata_without_key_material() {
        let private_key = URL_SAFE_NO_PAD.encode([7_u8; 96]);
        let credential_id = URL_SAFE_NO_PAD.encode([8_u8; 32]);
        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_passkey"),
            secret_type: SecretType::Passkey,
            data: SecretValue::Passkey(PasskeySecret {
                version: PASSKEY_SECRET_VERSION,
                rp_id: "login.example.com".to_owned(),
                rp_name: "Example".to_owned(),
                credential_id: credential_id.clone(),
                user_handle: URL_SAFE_NO_PAD.encode([9_u8; 32]),
                user_name: "alice@example.com".to_owned(),
                user_display_name: "Alice".to_owned(),
                key: PasskeyCredentialKey::Es256 {
                    private_key_pkcs8: PasskeyPrivateKeyPkcs8::parse(private_key.clone()).unwrap(),
                    public_key_cose: PasskeyPublicKeyCose::parse(
                        URL_SAFE_NO_PAD.encode([10_u8; 77]),
                    )
                    .unwrap(),
                },
                signature_count: 0,
                discoverable: true,
                backup_eligible: true,
                backup_state: false,
            }),
        };

        let item = record.list_item();

        assert_eq!(item.secret_type(), SecretType::Passkey);
        assert_eq!(item.group_key(), "login.example.com");
        assert_eq!(item.summary(), "Alice");
        assert!(item.display_title().contains("example.com"));
        assert!(!format!("{item:?}").contains(&private_key));
        assert!(!format!("{item:?}").contains(&credential_id));
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
    fn build_secret_yaml_round_trips_api_key_from_flat_form() {
        let fields = serde_json::json!({
            "websiteUrl": "https://api.example.com",
            "username": "",
            "password": "",
            "notes": "",
            "key": "tok123",
            "expiresAt": "2030-01-01",
            "name": "",
            "seed": "",
            "title": "",
            "note": ""
        });
        let yaml = build_secret_yaml(SecretType::ApiKey, &fields).unwrap();
        let parsed = SecretValue::from_yaml(SecretType::ApiKey, &yaml).unwrap();
        match parsed {
            SecretValue::ApiKey(value) => {
                assert_eq!(value.website_url, "https://api.example.com");
                assert_eq!(value.key, "tok123");
                assert_eq!(value.expires_at, "2030-01-01");
            }
            _ => panic!("expected api key"),
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

    #[test]
    fn build_secret_yaml_rejects_manual_passkey_creation() {
        let error = build_secret_yaml(SecretType::Passkey, &serde_json::json!({})).unwrap_err();
        assert!(matches!(
            error,
            SecretPayloadError::PasskeyCreationRequiresAuthenticator
        ));
    }
}
