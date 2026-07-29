//! Display and search helpers for vault secrets — shared by WASM, mobile, and CLI.

use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::vault_wire::SecretPayloadYaml;
use crate::{
    AuthenticatorSecret, CreditCardSecret, SecretId, SecretRecord, SecretType, SecretValue,
};
use serde::{Deserialize, Serialize};
use url::Url;

mod secret_presentation;
pub use secret_presentation::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
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
        rp_name: String,
        user_name: String,
        user_display_name: String,
    },
    Authenticator {
        issuer: String,
        account: String,
        website_url: String,
        backup_code_count: usize,
    },
    CreditCard {
        title: String,
        cardholder_name: String,
        last4: String,
        expiration_month: String,
        expiration_year: String,
    },
    FileAttachment {
        title: String,
        file_name: String,
        mime_type: String,
        size_bytes: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecretListItem {
    pub id: SecretId,
    pub data: SecretListItemData,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginSecretForm {
    pub website_url: String,
    pub username: String,
    pub password: String,
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKeySecretForm {
    pub website_url: String,
    pub key: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedPhraseSecretForm {
    pub name: String,
    pub seed: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecureNoteSecretForm {
    pub title: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatorSecretForm {
    pub issuer: String,
    pub account: String,
    pub website_url: String,
    pub totp_secret: String,
    pub algorithm: String,
    pub digits: String,
    pub period: String,
    pub backup_codes: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreditCardSecretForm {
    pub title: String,
    pub cardholder_name: String,
    pub number: String,
    pub expiration_month: String,
    pub expiration_year: String,
    pub cvv: String,
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileAttachmentSecretForm {
    pub title: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub content_base64: String,
}

/// Secret creation input with variant-specific fields.
///
/// A host must choose exactly one secret kind instead of populating a flat bag
/// containing fields for every supported secret type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretFormFields {
    Login(LoginSecretForm),
    ApiKey(ApiKeySecretForm),
    SeedPhrase(SeedPhraseSecretForm),
    SecureNote(SecureNoteSecretForm),
    Authenticator(AuthenticatorSecretForm),
    CreditCard(CreditCardSecretForm),
    FileAttachment(FileAttachmentSecretForm),
}

impl SecretFormFields {
    #[must_use]
    pub const fn secret_type(&self) -> SecretType {
        match self {
            Self::Login(_) => SecretType::Login,
            Self::ApiKey(_) => SecretType::ApiKey,
            Self::SeedPhrase(_) => SecretType::SeedPhrase,
            Self::SecureNote(_) => SecretType::SecureNote,
            Self::Authenticator(_) => SecretType::Authenticator,
            Self::CreditCard(_) => SecretType::CreditCard,
            Self::FileAttachment(_) => SecretType::FileAttachment,
        }
    }
}

/// Build a validated YAML payload for `add_secret` / `replace_secret` from form fields.
pub fn build_secret_yaml(
    secret_type: SecretType,
    fields: &serde_json::Value,
) -> SecretPayloadResult<SecretPayloadYaml> {
    let string_field = |name| {
        fields
            .get(name)
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_owned()
    };
    let fields = match secret_type {
        SecretType::Login => SecretFormFields::Login(LoginSecretForm {
            website_url: string_field("websiteUrl"),
            username: string_field("username"),
            password: string_field("password"),
            notes: string_field("notes"),
        }),
        SecretType::ApiKey => SecretFormFields::ApiKey(ApiKeySecretForm {
            website_url: string_field("websiteUrl"),
            key: string_field("key"),
            expires_at: string_field("expiresAt"),
        }),
        SecretType::SeedPhrase => SecretFormFields::SeedPhrase(SeedPhraseSecretForm {
            name: string_field("name"),
            seed: string_field("seed"),
        }),
        SecretType::SecureNote => SecretFormFields::SecureNote(SecureNoteSecretForm {
            title: string_field("title"),
            note: string_field("note"),
        }),
        SecretType::Passkey => {
            return Err(SecretPayloadError::PasskeyCreationRequiresAuthenticator);
        }
        SecretType::Authenticator => SecretFormFields::Authenticator(AuthenticatorSecretForm {
            issuer: string_field("issuer"),
            account: string_field("account"),
            website_url: string_field("websiteUrl"),
            totp_secret: string_field("totpSecret"),
            algorithm: string_field("algorithm"),
            digits: string_field("digits"),
            period: string_field("period"),
            backup_codes: string_field("backupCodes"),
        }),
        SecretType::CreditCard => SecretFormFields::CreditCard(CreditCardSecretForm {
            title: string_field("title"),
            cardholder_name: string_field("cardholderName"),
            number: string_field("number"),
            expiration_month: string_field("expirationMonth"),
            expiration_year: string_field("expirationYear"),
            cvv: string_field("cvv"),
            notes: string_field("notes"),
        }),
        SecretType::FileAttachment => {
            let size_bytes = fields
                .get("sizeBytes")
                .and_then(|value| {
                    value
                        .as_u64()
                        .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
                })
                .unwrap_or(0);
            SecretFormFields::FileAttachment(FileAttachmentSecretForm {
                title: string_field("title"),
                file_name: string_field("fileName"),
                mime_type: string_field("mimeType"),
                size_bytes,
                content_base64: string_field("contentBase64"),
            })
        }
    };
    build_secret_yaml_from_form(&fields)
}

/// Build a validated YAML payload from variant-specific form input.
pub fn build_secret_yaml_from_form(
    fields: &SecretFormFields,
) -> SecretPayloadResult<SecretPayloadYaml> {
    let filtered = match fields {
        SecretFormFields::Login(fields) => serde_json::json!({
            "websiteUrl": fields.website_url,
            "username": fields.username,
            "password": fields.password,
            "notes": fields.notes,
        }),
        SecretFormFields::ApiKey(fields) => serde_json::json!({
            "websiteUrl": fields.website_url,
            "key": fields.key,
            "expiresAt": fields.expires_at,
        }),
        SecretFormFields::SeedPhrase(fields) => serde_json::json!({
            "name": fields.name,
            "seed": fields.seed,
        }),
        SecretFormFields::SecureNote(fields) => serde_json::json!({
            "title": fields.title,
            "note": fields.note,
        }),
        SecretFormFields::Authenticator(fields) => {
            let value = AuthenticatorSecret::from_form_fields(
                &fields.issuer,
                &fields.account,
                &fields.totp_secret,
                &fields.algorithm,
                &fields.digits,
                &fields.period,
                &fields.backup_codes,
                &fields.website_url,
            )?;
            return SecretValue::Authenticator(value).to_yaml();
        }
        SecretFormFields::CreditCard(fields) => {
            let value = CreditCardSecret::from_fields(
                &fields.title,
                &fields.cardholder_name,
                &fields.number,
                &fields.expiration_month,
                &fields.expiration_year,
                &fields.cvv,
                &fields.notes,
            )?;
            return SecretValue::CreditCard(value).to_yaml();
        }
        SecretFormFields::FileAttachment(fields) => {
            let title = if fields.title.trim().is_empty() {
                fields.file_name.clone()
            } else {
                fields.title.clone()
            };
            let value = crate::FileAttachmentSecret {
                title,
                file_name: fields.file_name.clone(),
                mime_type: if fields.mime_type.trim().is_empty() {
                    "application/octet-stream".to_owned()
                } else {
                    fields.mime_type.clone()
                },
                size_bytes: fields.size_bytes,
                content_base64: fields.content_base64.clone(),
            };
            return SecretValue::FileAttachment(value).to_yaml();
        }
    };
    let yaml = serde_yaml::to_string(&filtered).map_err(SecretPayloadError::Serialize)?;
    SecretPayloadYaml::parse(fields.secret_type(), &yaml)
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
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
    fn website_host_strips_url_credentials_query_and_fragment() -> anyhow::Result<()> {
        for (url, expected) in [
            ("https://example.com?next=/vault", "example.com"),
            ("https://user@example.com/", "example.com"),
            ("https://example.com/#vault", "example.com"),
            ("example.com/login", "example.com"),
        ] {
            let mut item = login_record().list_item();
            let SecretListItemData::Login { website_url, .. } = &mut item.data else {
                panic!("expected login item");
            };
            *website_url = url.to_owned();

            assert_eq!(item.website_host(), expected, "{url}");
        }
        Ok(())
    }

    #[test]
    fn login_host_matches_origin_uses_normalized_host_equality() {
        assert!(login_host_matches_origin(
            "https://www.example.com/login",
            "https://example.com",
        ));
        assert!(!login_host_matches_origin(
            "example.com",
            "http://127.0.0.1:4173/login",
        ));
        assert!(login_host_matches_origin(
            "http://127.0.0.1:4173/account",
            "http://127.0.0.1:4199/login",
        ));
        assert!(!login_host_matches_origin(
            "https://example.com",
            "https://evil-example.com",
        ));
        assert!(!login_host_matches_origin(
            "https://notexample.com",
            "https://example.com",
        ));
        assert!(!login_host_matches_origin(
            "https://",
            "https://example.com"
        ));
        assert!(login_host_matches_origin(
            "https://microsoft.com/account",
            "https://login.microsoftonline.com",
        ));
        assert!(login_host_matches_origin(
            "https://slack.com",
            "https://app.slack.com",
        ));
        assert!(!login_host_matches_origin(
            "https://microsoft.com",
            "https://evil-microsoft.com",
        ));
    }

    #[test]
    fn matches_search_uses_metadata_not_secrets() {
        let record = login_record();
        assert!(record.matches_search("alice"));
        assert!(!record.matches_search("correct"));
    }

    #[test]
    fn list_item_keeps_login_metadata_and_drops_sensitive_fields() -> anyhow::Result<()> {
        let item = login_record().list_item();

        assert_eq!(item.secret_type(), SecretType::Login);
        assert_eq!(item.website_host(), "github.com");
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
        Ok(())
    }

    #[test]
    fn list_item_reports_no_host_for_malformed_login_url() {
        let mut item = login_record().list_item();
        let SecretListItemData::Login { website_url, .. } = &mut item.data else {
            panic!("expected login item");
        };
        *website_url = "https://".to_owned();

        assert!(item.website_host().is_empty());
        assert_eq!(item.group_key(), "No Website");
    }

    #[test]
    fn list_item_exposes_only_derived_seed_word_count() -> anyhow::Result<()> {
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
        Ok(())
    }

    #[test]
    fn credit_card_list_item_exposes_last4_without_pan_or_cvv() -> anyhow::Result<()> {
        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_card"),
            secret_type: SecretType::CreditCard,
            data: SecretValue::CreditCard(crate::CreditCardSecret::from_fields(
                "Personal Visa",
                "Ada Lovelace",
                "4111 1111 1111 1111",
                "12",
                "2030",
                "123",
                "work",
            )?),
        };

        let item = record.list_item();
        assert_eq!(item.secret_type(), SecretType::CreditCard);
        assert_eq!(item.group_key(), "Personal Visa");
        assert_eq!(item.summary(), "•••• 1111");
        assert_eq!(
            item.data,
            SecretListItemData::CreditCard {
                title: "Personal Visa".to_owned(),
                cardholder_name: "Ada Lovelace".to_owned(),
                last4: "1111".to_owned(),
                expiration_month: "12".to_owned(),
                expiration_year: "2030".to_owned(),
            }
        );
        let debug = format!("{item:?}");
        assert!(!debug.contains("4111111111111111"));
        assert!(!debug.contains("123"));
        assert_eq!(record.primary_credential(), "4111111111111111");
        assert!(record.matches_search("1111"));
        assert!(!record.matches_search("4111111111111111"));
        Ok(())
    }

    #[test]
    fn build_secret_yaml_from_credit_card_form_validates_number() -> anyhow::Result<()> {
        let yaml =
            build_secret_yaml_from_form(&SecretFormFields::CreditCard(CreditCardSecretForm {
                title: "Debit".to_owned(),
                cardholder_name: String::new(),
                number: "4111111111111111".to_owned(),
                expiration_month: String::new(),
                expiration_year: String::new(),
                cvv: String::new(),
                notes: String::new(),
            }))?;
        let value = SecretValue::from_yaml(SecretType::CreditCard, &yaml)?;
        let SecretValue::CreditCard(card) = value else {
            panic!("expected credit card");
        };
        assert_eq!(card.number, "4111111111111111");

        let err =
            build_secret_yaml_from_form(&SecretFormFields::CreditCard(CreditCardSecretForm {
                title: "Bad".to_owned(),
                cardholder_name: String::new(),
                number: "4111111111111112".to_owned(),
                expiration_month: String::new(),
                expiration_year: String::new(),
                cvv: String::new(),
                notes: String::new(),
            }));
        assert!(err.is_err());
        Ok(())
    }

    #[test]
    fn passkey_list_item_exposes_account_metadata_without_key_material() -> anyhow::Result<()> {
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
                    private_key_pkcs8: PasskeyPrivateKeyPkcs8::parse(private_key.clone())?,
                    public_key_cose: PasskeyPublicKeyCose::parse(
                        URL_SAFE_NO_PAD.encode([10_u8; 77]),
                    )?,
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
        Ok(())
    }

    #[test]
    fn build_secret_yaml_round_trips_login_fields() -> anyhow::Result<()> {
        let fields = serde_json::json!({
            "websiteUrl": "https://example.com",
            "username": "bob",
            "password": "pw",
            "notes": "note"
        });
        let yaml = build_secret_yaml(SecretType::Login, &fields)?;
        let parsed = SecretValue::from_yaml(SecretType::Login, &yaml)?;
        match parsed {
            SecretValue::Login(value) => {
                assert_eq!(value.username, "bob");
                assert_eq!(value.password, "pw");
            }
            _ => panic!("expected login"),
        }
        Ok(())
    }

    #[test]
    fn build_secret_yaml_round_trips_api_key_from_flat_form() -> anyhow::Result<()> {
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
        let yaml = build_secret_yaml(SecretType::ApiKey, &fields)?;
        let parsed = SecretValue::from_yaml(SecretType::ApiKey, &yaml)?;
        match parsed {
            SecretValue::ApiKey(value) => {
                assert_eq!(value.website_url, "https://api.example.com");
                assert_eq!(value.key, "tok123");
                assert_eq!(value.expires_at, "2030-01-01");
            }
            _ => panic!("expected api key"),
        }
        Ok(())
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
    fn build_secret_yaml_rejects_manual_passkey_creation() -> anyhow::Result<()> {
        let error = build_secret_yaml(SecretType::Passkey, &serde_json::json!({}))
            .err()
            .ok_or_else(|| anyhow::anyhow!("secret view test should reject invalid input"))?;
        assert!(matches!(
            error,
            SecretPayloadError::PasskeyCreationRequiresAuthenticator
        ));
        Ok(())
    }

    #[test]
    fn authenticator_list_item_hides_shared_secret_and_backup_codes() -> anyhow::Result<()> {
        let value = AuthenticatorSecret::from_form_fields(
            "Example",
            "alice@example.com",
            "JBSWY3DPEHPK3PXP",
            "SHA1",
            "6",
            "30",
            "backup-one\nbackup-two",
            "",
        )?;
        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_authenticator"),
            secret_type: SecretType::Authenticator,
            data: SecretValue::Authenticator(value),
        };

        let item = record.list_item();
        assert_eq!(item.secret_type(), SecretType::Authenticator);
        assert_eq!(item.group_key(), "Example");
        assert_eq!(item.summary(), "alice@example.com");
        assert_eq!(
            item.data,
            SecretListItemData::Authenticator {
                issuer: "Example".to_owned(),
                account: "alice@example.com".to_owned(),
                website_url: String::new(),
                backup_code_count: 2,
            }
        );
        let debug = format!("{item:?}");
        assert!(!debug.contains("JBSWY"));
        assert!(!debug.contains("backup-one"));
        assert!(record.matches_search("example"));
        assert!(record.matches_search("ALICE@EXAMPLE.COM"));
        assert!(!record.matches_search("JBSWY3DPEHPK3PXP"));
        assert!(!record.matches_search("backup-one"));
        Ok(())
    }

    #[test]
    fn authenticator_group_key_uses_url_issuer_host_and_popular_map() {
        assert_eq!(
            authenticator_group_key("https://www.custom.example/login", "OpenAI"),
            "custom.example"
        );
        assert_eq!(
            authenticator_group_key("", "https://www.namecheap.com"),
            "namecheap.com"
        );
        assert_eq!(
            authenticator_group_key("", "namecheap.com"),
            "namecheap.com"
        );
        assert_eq!(authenticator_group_key("", "OpenAI"), "openai.com");
        assert_eq!(authenticator_group_key("", "Namecheap"), "namecheap.com");
        assert_eq!(
            authenticator_group_key("", "Totally Unknown Service"),
            "Totally Unknown Service"
        );
    }

    #[test]
    fn resolve_entity_group_keys_clusters_brand_authenticator_with_site_host() {
        let items = vec![
            SecretListItem {
                id: SecretId::from_vault_record("secret_login"),
                data: SecretListItemData::Login {
                    website_url: "https://www.namecheap.com/".to_owned(),
                    username: "bynull".to_owned(),
                },
            },
            SecretListItem {
                id: SecretId::from_vault_record("secret_totp"),
                data: SecretListItemData::Authenticator {
                    issuer: "Namecheap".to_owned(),
                    account: "bynull".to_owned(),
                    website_url: String::new(),
                    backup_code_count: 0,
                },
            },
        ];

        assert_eq!(
            resolve_entity_group_keys(&items),
            vec!["namecheap.com".to_owned(), "namecheap.com".to_owned()]
        );
    }

    #[test]
    fn resolve_entity_group_keys_prefers_account_matched_host() {
        // Mapped issuer "Google" already resolves to google.com intrinsically;
        // page remapping still keeps that host when multiple Google hosts exist.
        let items = vec![
            SecretListItem {
                id: SecretId::from_vault_record("secret_login_a"),
                data: SecretListItemData::Login {
                    website_url: "https://accounts.google.com".to_owned(),
                    username: "other@example.com".to_owned(),
                },
            },
            SecretListItem {
                id: SecretId::from_vault_record("secret_login_b"),
                data: SecretListItemData::Login {
                    website_url: "https://google.com".to_owned(),
                    username: "alice@example.com".to_owned(),
                },
            },
            SecretListItem {
                id: SecretId::from_vault_record("secret_totp"),
                data: SecretListItemData::Authenticator {
                    issuer: "Google".to_owned(),
                    account: "alice@example.com".to_owned(),
                    website_url: String::new(),
                    backup_code_count: 0,
                },
            },
        ];

        assert_eq!(
            resolve_entity_group_keys(&items),
            vec![
                "accounts.google.com".to_owned(),
                "google.com".to_owned(),
                "google.com".to_owned(),
            ]
        );
    }

    #[test]
    fn resolve_entity_group_keys_leaves_unmatched_brand_authenticator() {
        let items = vec![SecretListItem {
            id: SecretId::from_vault_record("secret_totp"),
            data: SecretListItemData::Authenticator {
                issuer: "Totally Unknown Service".to_owned(),
                account: "bynull".to_owned(),
                website_url: String::new(),
                backup_code_count: 0,
            },
        }];

        assert_eq!(
            resolve_entity_group_keys(&items),
            vec!["Totally Unknown Service".to_owned()]
        );
    }

    #[test]
    fn build_secret_yaml_accepts_authenticator_uri() -> anyhow::Result<()> {
        let fields = serde_json::json!({
            "issuer": "",
            "account": "",
            "totpSecret": "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
            "algorithm": "",
            "digits": "",
            "period": "",
            "backupCodes": "one\ntwo"
        });
        let yaml = build_secret_yaml(SecretType::Authenticator, &fields)?;
        let parsed = SecretValue::from_yaml(SecretType::Authenticator, &yaml)?;
        match parsed {
            SecretValue::Authenticator(value) => {
                assert_eq!(value.issuer, "Example");
                assert_eq!(value.account, "alice");
                assert_eq!(value.backup_codes, ["one", "two"]);
            }
            _ => panic!("expected authenticator"),
        }
        Ok(())
    }
    #[test]
    fn build_secret_yaml_round_trips_file_attachment_and_hides_content_in_list()
    -> anyhow::Result<()> {
        let content =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, b"secret-bytes");
        let fields = serde_json::json!({
            "title": "",
            "fileName": "notes.txt",
            "mimeType": "text/plain",
            "sizeBytes": 12,
            "contentBase64": content,
        });
        let yaml = build_secret_yaml(SecretType::FileAttachment, &fields)?;
        let parsed = SecretValue::from_yaml(SecretType::FileAttachment, &yaml)?;
        let SecretValue::FileAttachment(value) = parsed else {
            panic!("expected file attachment");
        };
        assert_eq!(value.title, "notes.txt");
        assert_eq!(value.file_name, "notes.txt");
        assert_eq!(value.size_bytes, 12);

        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_file"),
            secret_type: SecretType::FileAttachment,
            data: SecretValue::FileAttachment(value),
        };
        let item = record.list_item();
        assert_eq!(item.secret_type(), SecretType::FileAttachment);
        assert_eq!(item.summary(), "notes.txt");
        assert_eq!(
            item.data,
            SecretListItemData::FileAttachment {
                title: "notes.txt".to_owned(),
                file_name: "notes.txt".to_owned(),
                mime_type: "text/plain".to_owned(),
                size_bytes: 12,
            }
        );
        assert!(!format!("{item:?}").contains("secret-bytes"));
        Ok(())
    }
}
