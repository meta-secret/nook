//! Display and search helpers for vault secrets — shared by WASM, mobile, and CLI.

use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::vault_wire::SecretPayloadYaml;
use crate::{
    ApiKeySecret, AuthenticatorSecret, CreditCardSecret, FileAttachmentByteCount, LoginSecret,
    SecretId, SecretRecord, SecretType, SecretValue, SecureNoteSecret, SeedPhraseSecret,
};
use crate::{CreditCardFields, ValidationError};
use serde::{Deserialize, Serialize};
use url::Url;

mod secret_presentation;
pub use super::login_site_hosts::LoginSiteHostsError;
pub use secret_presentation::{
    AuthenticatorGroupKeyRequest, LoginHostMatchRequest, SecretGroupKey, WebsiteHost,
};
mod secret_record_presentation;

/// Number of words exposed by a seed-phrase list projection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct SeedPhraseWordCount(usize);

impl From<usize> for SeedPhraseWordCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<SeedPhraseWordCount> for usize {
    fn from(value: SeedPhraseWordCount) -> Self {
        value.0
    }
}

/// Number of backup codes exposed by an authenticator list projection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct AuthenticatorBackupCodeCount(usize);

impl From<usize> for AuthenticatorBackupCodeCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<AuthenticatorBackupCodeCount> for usize {
    fn from(value: AuthenticatorBackupCodeCount) -> Self {
        value.0
    }
}

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
        word_count: SeedPhraseWordCount,
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
        backup_code_count: AuthenticatorBackupCodeCount,
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
        size_bytes: FileAttachmentByteCount,
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
    pub size_bytes: FileAttachmentByteCount,
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

/// Build a validated YAML payload from variant-specific form input.
impl SecretFormFields {
    pub fn build_secret_yaml_from_form(
        fields: &SecretFormFields,
    ) -> SecretPayloadResult<SecretPayloadYaml> {
        let value = match fields {
            SecretFormFields::Login(fields) => SecretValue::Login(LoginSecret {
                website_url: fields.website_url.clone(),
                username: fields.username.clone(),
                password: fields.password.clone(),
                notes: fields.notes.clone(),
            }),
            SecretFormFields::ApiKey(fields) => SecretValue::ApiKey(ApiKeySecret {
                website_url: fields.website_url.clone(),
                key: fields.key.clone(),
                expires_at: fields.expires_at.clone(),
            }),
            SecretFormFields::SeedPhrase(fields) => SecretValue::SeedPhrase(SeedPhraseSecret {
                name: fields.name.clone(),
                seed: fields.seed.clone(),
            }),
            SecretFormFields::SecureNote(fields) => {
                if fields.note.trim().is_empty() {
                    return Err(ValidationError::SecretDataRequired.into());
                }
                SecretValue::SecureNote(SecureNoteSecret {
                    title: fields.title.clone(),
                    note: fields.note.clone(),
                })
            }
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
                let value = CreditCardSecret::from_fields(CreditCardFields {
                    title: &fields.title,
                    cardholder_name: &fields.cardholder_name,
                    number: &fields.number,
                    expiration_month: &fields.expiration_month,
                    expiration_year: &fields.expiration_year,
                    cvv: &fields.cvv,
                    notes: &fields.notes,
                })?;
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
        let yaml = value.to_yaml()?;
        SecretPayloadYaml::parse(fields.secret_type(), &yaml)
    }
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use crate::ValidationError;
    use base64::Engine as Base64Engine;

    use super::*;
    use crate::SecretId;
    use base64::engine::general_purpose;

    #[test]
    fn build_secret_yaml_from_credit_card_form_validates_number() -> anyhow::Result<()> {
        let yaml = SecretFormFields::build_secret_yaml_from_form(&SecretFormFields::CreditCard(
            CreditCardSecretForm {
                title: "Debit".to_owned(),
                cardholder_name: String::new(),
                number: "4111111111111111".to_owned(),
                expiration_month: String::new(),
                expiration_year: String::new(),
                cvv: String::new(),
                notes: String::new(),
            },
        ))?;
        let value = SecretValue::from_yaml(SecretType::CreditCard, &yaml)?;
        let SecretValue::CreditCard(card) = value else {
            panic!("expected credit card");
        };
        assert_eq!(card.number, "4111111111111111");

        let err = SecretFormFields::build_secret_yaml_from_form(&SecretFormFields::CreditCard(
            CreditCardSecretForm {
                title: "Bad".to_owned(),
                cardholder_name: String::new(),
                number: "4111111111111112".to_owned(),
                expiration_month: String::new(),
                expiration_year: String::new(),
                cvv: String::new(),
                notes: String::new(),
            },
        ));
        assert!(err.is_err());
        Ok(())
    }

    #[test]
    fn build_secret_yaml_from_secure_note_form_requires_content() {
        let result = SecretFormFields::build_secret_yaml_from_form(&SecretFormFields::SecureNote(
            SecureNoteSecretForm {
                title: "Empty note".to_owned(),
                note: " \n\t ".to_owned(),
            },
        ));

        assert!(matches!(
            result,
            Err(SecretPayloadError::Validation(
                ValidationError::SecretDataRequired
            ))
        ));
    }

    #[test]
    fn build_secret_yaml_round_trips_login_fields() -> anyhow::Result<()> {
        let fields = SecretFormFields::Login(LoginSecretForm {
            website_url: "https://example.com".to_owned(),
            username: "bob".to_owned(),
            password: "pw".to_owned(),
            notes: "note".to_owned(),
        });
        let yaml = SecretFormFields::build_secret_yaml_from_form(&fields)?;
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
        let fields = SecretFormFields::ApiKey(ApiKeySecretForm {
            website_url: "https://api.example.com".to_owned(),
            key: "tok123".to_owned(),
            expires_at: "2030-01-01".to_owned(),
        });
        let yaml = SecretFormFields::build_secret_yaml_from_form(&fields)?;
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
        let fields = SecretFormFields::SeedPhrase(SeedPhraseSecretForm {
            name: "Main".to_owned(),
            seed: "invalid phrase".to_owned(),
        });
        assert!(SecretFormFields::build_secret_yaml_from_form(&fields).is_err());
    }

    #[test]
    fn build_secret_yaml_accepts_authenticator_uri() -> anyhow::Result<()> {
        let fields = SecretFormFields::Authenticator(AuthenticatorSecretForm {
            issuer: "".to_owned(),
            account: "".to_owned(),
            website_url: "".to_owned(),
            totp_secret: "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example"
                .to_owned(),
            algorithm: "".to_owned(),
            digits: "".to_owned(),
            period: "".to_owned(),
            backup_codes: "one\ntwo".to_owned(),
        });
        let yaml = SecretFormFields::build_secret_yaml_from_form(&fields)?;
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
        let content = Base64Engine::encode(&general_purpose::STANDARD, b"secret-bytes");
        let fields = SecretFormFields::FileAttachment(FileAttachmentSecretForm {
            title: "".to_owned(),
            file_name: "notes.txt".to_owned(),
            mime_type: "text/plain".to_owned(),
            size_bytes: 12_u64.into(),
            content_base64: content,
        });
        let yaml = SecretFormFields::build_secret_yaml_from_form(&fields)?;
        let parsed = SecretValue::from_yaml(SecretType::FileAttachment, &yaml)?;
        let SecretValue::FileAttachment(value) = parsed else {
            panic!("expected file attachment");
        };
        assert_eq!(value.title, "notes.txt");
        assert_eq!(value.file_name, "notes.txt");
        assert_eq!(u64::from(value.size_bytes), 12);

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
                size_bytes: 12_u64.into(),
            }
        );
        assert!(!format!("{item:?}").contains("secret-bytes"));
        Ok(())
    }
}
