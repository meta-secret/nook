//! Display and search helpers for vault secrets — shared by WASM, mobile, and CLI.

use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::vault_wire::SecretPayloadYaml;
use crate::{
    AuthenticatorSecret, CreditCardSecret, SecretId, SecretRecord, SecretType, SecretValue,
};
use url::Url;

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
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
        }
    }
}

/// Normalize a website URL or origin to a comparable host (no leading `www.`).
#[must_use]
pub fn hostname_from_url(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        return String::new();
    }

    Url::parse(value)
        .or_else(|error| {
            if value.contains("://") {
                Err(error)
            } else {
                Url::parse(&format!("https://{value}"))
            }
        })
        .ok()
        .and_then(|url| url.host_str().map(ToOwned::to_owned))
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_owned()
}

/// True when a stored login website URL targets the same host as a page origin.
///
/// Matching is host equality after URL normalization (credentials, path, query,
/// fragment, and a leading `www.` are ignored). Substring traps such as
/// `evil-example.com` vs `example.com` do not match.
#[must_use]
pub fn login_host_matches_origin(website_url: &str, origin: &str) -> bool {
    let secret_host = hostname_from_url(website_url);
    let origin_host = hostname_from_url(origin);
    !secret_host.is_empty()
        && !origin_host.is_empty()
        && secret_host.eq_ignore_ascii_case(&origin_host)
}

/// Intrinsic list clustering key for an authenticator.
///
/// Prefer an explicit website URL, then a domain-like issuer, then the bundled
/// popular-issuer host map. Unmapped brand labels stay as trimmed issuer text
/// until [`resolve_entity_group_keys`] can attach them to a co-present site host.
#[must_use]
pub fn authenticator_group_key(website_url: &str, issuer: &str) -> String {
    if let Some(host) =
        crate::secrets::authenticator_issuer_hosts::resolve_authenticator_website_host(
            website_url,
            issuer,
        )
    {
        return host;
    }
    issuer.trim().to_owned()
}

fn normalize_brand_label(raw: &str) -> String {
    crate::secrets::authenticator_issuer_hosts::normalize_issuer_lookup_key(raw)
}

fn titled_group_key(title: &str, unnamed: &str) -> String {
    let title = title.trim();
    if title.is_empty() {
        unnamed.to_owned()
    } else {
        title.to_owned()
    }
}

fn brand_matches_host(brand: &str, host: &str) -> bool {
    if brand.is_empty() || brand.len() < 2 || brand.contains('.') {
        return false;
    }
    let host = host.to_ascii_lowercase();
    if host == brand {
        return true;
    }
    if host.starts_with(&format!("{brand}.")) {
        return true;
    }
    host.split('.').any(|label| label == brand)
}

fn site_anchor_account(item: &SecretListItem) -> &str {
    match &item.data {
        SecretListItemData::Login { username, .. } => username.trim(),
        SecretListItemData::Passkey { user_name, .. } => user_name.trim(),
        SecretListItemData::Authenticator { account, .. } => account.trim(),
        _ => "",
    }
}

fn is_site_anchor(item: &SecretListItem) -> bool {
    matches!(
        item.data,
        SecretListItemData::Login { .. }
            | SecretListItemData::ApiKey { .. }
            | SecretListItemData::Passkey { .. }
    )
}

/// Resolve display group keys so brand authenticators cluster with site hosts.
///
/// Login / API key / passkey hosts are anchors. Authenticator issuers that are
/// already hosts stay unchanged. Brand issuers such as `Namecheap` remap onto
/// `namecheap.com` when that host (or a subdomain) appears in the same item set.
/// Prefer an anchor whose username/account matches the authenticator account,
/// then the shortest matching host for a stable site card title.
#[must_use]
pub fn resolve_entity_group_keys(items: &[SecretListItem]) -> Vec<String> {
    let intrinsic: Vec<String> = items.iter().map(SecretListItem::group_key).collect();
    let anchors: Vec<(usize, String)> = items
        .iter()
        .enumerate()
        .filter(|(_, item)| is_site_anchor(item))
        .map(|(index, _)| (index, intrinsic[index].clone()))
        .filter(|(_, key)| key.contains('.') && key != "No Website")
        .collect();

    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let key = &intrinsic[index];
            let SecretListItemData::Authenticator { account, .. } = &item.data else {
                return key.clone();
            };
            if key.contains('.') || key.is_empty() {
                return key.clone();
            }

            let brand = normalize_brand_label(key);
            let account = account.trim();
            let mut best: Option<(bool, usize, String)> = None;
            for (anchor_index, host) in &anchors {
                if !brand_matches_host(&brand, host) {
                    continue;
                }
                let account_match = !account.is_empty()
                    && site_anchor_account(&items[*anchor_index]).eq_ignore_ascii_case(account);
                let candidate = (account_match, host.len(), host.clone());
                best = Some(match best {
                    None => candidate,
                    Some(current) => {
                        // Prefer account match, then shorter host, then lexical order.
                        let better = (candidate.0 && !current.0)
                            || (candidate.0 == current.0 && candidate.1 < current.1)
                            || (candidate.0 == current.0
                                && candidate.1 == current.1
                                && candidate.2 < current.2);
                        if better { candidate } else { current }
                    }
                });
            }
            best.map_or_else(|| key.clone(), |(_, _, host)| host)
        })
        .collect()
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
            SecretValue::Authenticator(value) => {
                fields.push(value.issuer.clone());
                fields.push(value.account.clone());
                fields.push(value.website_url.clone());
            }
            SecretValue::CreditCard(value) => {
                fields.push(value.title.clone());
                fields.push(value.cardholder_name.clone());
                fields.push(value.last4());
                fields.push(value.expiration_display());
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
            SecretListItemData::Authenticator { .. } => SecretType::Authenticator,
            SecretListItemData::CreditCard { .. } => SecretType::CreditCard,
        }
    }

    /// Normalized website host for URL-backed secrets.
    ///
    /// Returns an empty string when the item is not URL-backed or the stored
    /// value has no usable host.
    #[must_use]
    pub fn website_host(&self) -> String {
        match &self.data {
            SecretListItemData::Login { website_url, .. }
            | SecretListItemData::ApiKey { website_url, .. } => hostname_from_url(website_url),
            SecretListItemData::Authenticator {
                website_url,
                issuer,
                ..
            } => crate::secrets::authenticator_issuer_hosts::resolve_authenticator_website_host(
                website_url,
                issuer,
            )
            .unwrap_or_default(),
            _ => String::new(),
        }
    }

    #[must_use]
    pub fn display_title(&self) -> String {
        match &self.data {
            SecretListItemData::Login { website_url, .. }
            | SecretListItemData::ApiKey { website_url, .. } => website_url.clone(),
            SecretListItemData::SeedPhrase { name, .. } => name.clone(),
            SecretListItemData::SecureNote { title }
            | SecretListItemData::CreditCard { title, .. } => title.clone(),
            SecretListItemData::Passkey { rp_id, .. } => rp_id.clone(),
            SecretListItemData::Authenticator { issuer, .. } => issuer.clone(),
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
            SecretListItemData::SecureNote { title } => titled_group_key(title, "Unnamed Note"),
            SecretListItemData::Passkey { rp_id, .. } => rp_id.clone(),
            SecretListItemData::Authenticator {
                website_url,
                issuer,
                ..
            } => authenticator_group_key(website_url, issuer),
            SecretListItemData::CreditCard { title, .. } => {
                titled_group_key(title, "Unnamed Card")
            }
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
            SecretListItemData::Authenticator {
                issuer, account, ..
            } => {
                if account.trim().is_empty() {
                    issuer.trim().to_owned()
                } else {
                    account.trim().to_owned()
                }
            }
            SecretListItemData::CreditCard { last4, .. } => {
                if last4.is_empty() {
                    "credit-card".to_owned()
                } else {
                    format!("•••• {last4}")
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
    };
    let yaml = serde_yaml::to_string(&filtered).map_err(SecretPayloadError::Serialize)?;
    SecretPayloadYaml::parse(fields.secret_type(), &yaml)
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
    fn website_host_strips_url_credentials_query_and_fragment() {
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
    fn credit_card_list_item_exposes_last4_without_pan_or_cvv() {
        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_card"),
            secret_type: SecretType::CreditCard,
            data: SecretValue::CreditCard(
                crate::CreditCardSecret::from_fields(
                    "Personal Visa",
                    "Ada Lovelace",
                    "4111 1111 1111 1111",
                    "12",
                    "2030",
                    "123",
                    "work",
                )
                .unwrap(),
            ),
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
    }

    #[test]
    fn build_secret_yaml_from_credit_card_form_validates_number() {
        let yaml = build_secret_yaml_from_form(&SecretFormFields::CreditCard(
            CreditCardSecretForm {
                title: "Debit".to_owned(),
                cardholder_name: String::new(),
                number: "4111111111111111".to_owned(),
                expiration_month: String::new(),
                expiration_year: String::new(),
                cvv: String::new(),
                notes: String::new(),
            },
        ))
        .unwrap();
        let value = SecretValue::from_yaml(SecretType::CreditCard, &yaml).unwrap();
        let SecretValue::CreditCard(card) = value else {
            panic!("expected credit card");
        };
        assert_eq!(card.number, "4111111111111111");

        let err = build_secret_yaml_from_form(&SecretFormFields::CreditCard(
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

    #[test]
    fn authenticator_list_item_hides_shared_secret_and_backup_codes() {
        let value = AuthenticatorSecret::from_form_fields(
            "Example",
            "alice@example.com",
            "JBSWY3DPEHPK3PXP",
            "SHA1",
            "6",
            "30",
            "backup-one\nbackup-two",
            "",
        )
        .unwrap();
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
    fn build_secret_yaml_accepts_authenticator_uri() {
        let fields = serde_json::json!({
            "issuer": "",
            "account": "",
            "totpSecret": "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
            "algorithm": "",
            "digits": "",
            "period": "",
            "backupCodes": "one\ntwo"
        });
        let yaml = build_secret_yaml(SecretType::Authenticator, &fields).unwrap();
        let parsed = SecretValue::from_yaml(SecretType::Authenticator, &yaml).unwrap();
        match parsed {
            SecretValue::Authenticator(value) => {
                assert_eq!(value.issuer, "Example");
                assert_eq!(value.account, "alice");
                assert_eq!(value.backup_codes, ["one", "two"]);
            }
            _ => panic!("expected authenticator"),
        }
    }
}
