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
mod tests {
    use super::*;
    use crate::{LoginSecret, SecretId, SecretType};

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
