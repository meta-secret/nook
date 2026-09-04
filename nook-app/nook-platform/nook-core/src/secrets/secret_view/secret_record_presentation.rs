use super::secret_presentation::{authenticator_group_key, hostname_from_url, titled_group_key};
use super::{SecretListItem, SecretListItemData, SecretRecord, SecretValue};

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
                rp_name: value.rp_name.clone(),
                user_name: value.user_name.clone(),
                user_display_name: value.user_display_name.clone(),
            },
            SecretValue::Authenticator(value) => SecretListItemData::Authenticator {
                issuer: value.issuer.clone(),
                account: value.account.clone(),
                website_url: value.website_url.clone(),
                backup_code_count: value.backup_codes.len(),
            },
            SecretValue::CreditCard(value) => SecretListItemData::CreditCard {
                title: value.title.clone(),
                cardholder_name: value.cardholder_name.clone(),
                last4: value.last4(),
                expiration_month: value.expiration_month.clone(),
                expiration_year: value.expiration_year.clone(),
            },
            SecretValue::FileAttachment(value) => SecretListItemData::FileAttachment {
                title: value.title.clone(),
                file_name: value.file_name.clone(),
                mime_type: value.mime_type.clone(),
                size_bytes: value.size_bytes,
            },
        };
        SecretListItem {
            id: self.id.clone(),
            data,
        }
    }

    /// Primary label for list rows (website URL, account name, note title, …).
    #[must_use]
    #[allow(clippy::match_same_arms)]
    pub fn display_title(&self) -> String {
        match &self.data {
            SecretValue::Login(value) => value.website_url.clone(),
            SecretValue::ApiKey(value) => value.website_url.clone(),
            SecretValue::SeedPhrase(value) => value.name.clone(),
            SecretValue::SecureNote(value) => value.title.clone(),
            SecretValue::Passkey(value) => value.rp_id.clone(),
            SecretValue::Authenticator(value) => value.issuer.clone(),
            SecretValue::CreditCard(value) => value.title.clone(),
            SecretValue::FileAttachment(value) => value.title.clone(),
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
            SecretValue::Passkey(_) | SecretValue::FileAttachment(_) => "",
            SecretValue::Authenticator(value) => value.secret.as_str(),
            SecretValue::CreditCard(value) => value.number.as_str(),
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
            SecretValue::SecureNote(value) => titled_group_key(&value.title, "Unnamed Note"),
            SecretValue::Passkey(value) => value.rp_id.clone(),
            SecretValue::Authenticator(value) => {
                authenticator_group_key(&value.website_url, &value.issuer)
            }
            SecretValue::CreditCard(value) => titled_group_key(&value.title, "Unnamed Card"),
            SecretValue::FileAttachment(value) => {
                let title = value.title.trim();
                if title.is_empty() {
                    let name = value.file_name.trim();
                    if name.is_empty() {
                        "Unnamed File".to_owned()
                    } else {
                        name.to_owned()
                    }
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
            SecretValue::Passkey(value) => {
                if value.user_display_name.trim().is_empty() {
                    value.user_name.trim().to_owned()
                } else {
                    value.user_display_name.trim().to_owned()
                }
            }
            SecretValue::Authenticator(value) => {
                if value.account.trim().is_empty() {
                    value.issuer.trim().to_owned()
                } else {
                    value.account.trim().to_owned()
                }
            }
            SecretValue::CreditCard(value) => value.masked_number(),
            SecretValue::FileAttachment(value) => value.file_name.trim().to_owned(),
        }
    }

    /// Case-insensitive search over non-secret metadata fields.
    #[must_use]
    pub fn matches_search(&self, query: &str) -> bool {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return true;
        }
        self.list_item().normalized_search_text().contains(&needle)
    }
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use crate::{AuthenticatorSecret, CreditCardSecret};

    use super::*;
    use crate::{
        LoginSecret, PASSKEY_SECRET_VERSION, PasskeyCredentialKey, PasskeyPrivateKeyPkcs8,
        PasskeyPublicKeyCose, PasskeySecret, SecretId, SecretType,
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
    fn list_item_keeps_login_metadata_and_drops_sensitive_fields() {
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
    fn credit_card_list_item_exposes_last4_without_pan_or_cvv() -> anyhow::Result<()> {
        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_card"),
            secret_type: SecretType::CreditCard,
            data: SecretValue::CreditCard(CreditCardSecret::from_fields(
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
    fn matches_search_uses_metadata_not_secrets() {
        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_test"),
            secret_type: SecretType::Login,
            data: SecretValue::Login(LoginSecret {
                website_url: "https://www.github.com/login".to_owned(),
                username: "alice".to_owned(),
                password: "credential-only-sentinel".to_owned(),
                notes: String::new(),
            }),
        };
        assert!(record.matches_search("alice"));
        assert!(!record.matches_search("credential-only-sentinel"));
    }
}
