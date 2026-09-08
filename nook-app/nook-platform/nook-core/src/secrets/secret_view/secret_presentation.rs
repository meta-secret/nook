#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{SecretListItem, SecretListItemData, SecretType, Url};
use crate::secrets::{
    authenticator_issuer_hosts::{AuthenticatorIssuerHosts, AuthenticatorWebsiteHostRequest},
    login_site_hosts::{LoginFamilyMatchRequest, LoginSiteHosts},
};
use crate::vault_session::SecretPage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WebsiteHost;

impl WebsiteHost {
    #[must_use]
    pub fn normalize(raw: &str) -> String {
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

    pub(crate) fn legacy_hostname_from_url(raw: &str) -> String {
        Self::normalize(raw)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SecretTitle;

impl SecretTitle {
    #[must_use]
    pub(crate) fn group_key(title: &str, unnamed: &str) -> String {
        let title = title.trim();
        if title.is_empty() {
            unnamed.to_owned()
        } else {
            title.to_owned()
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BrandHostMatchRequest<'a> {
    brand: &'a str,
    host: &'a str,
}

/// Named request for matching a stored login host to a requesting origin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoginHostMatchRequest<'a> {
    pub website_url: &'a str,
    pub origin: &'a str,
}

impl LoginHostMatchRequest<'_> {
    #[must_use]
    pub fn matches(&self) -> bool {
        let secret_host = WebsiteHost::normalize(self.website_url);
        let origin_host = WebsiteHost::normalize(self.origin);
        if secret_host.is_empty() || origin_host.is_empty() {
            return false;
        }
        secret_host.eq_ignore_ascii_case(&origin_host)
            || LoginSiteHosts::bundled().is_some_and(|catalog| {
                catalog.share_family(LoginFamilyMatchRequest {
                    left: &secret_host,
                    right: &origin_host,
                })
            })
    }

    pub(crate) fn legacy_matches(website_url: &str, origin: &str) -> bool {
        let secret_host = WebsiteHost::normalize(website_url);
        let origin_host = WebsiteHost::normalize(origin);
        if secret_host.is_empty() || origin_host.is_empty() {
            return false;
        }
        secret_host.eq_ignore_ascii_case(&origin_host)
            || LoginSiteHosts::bundled().is_some_and(|catalog| {
                catalog.share_family(LoginFamilyMatchRequest {
                    left: &secret_host,
                    right: &origin_host,
                })
            })
    }
}

/// Named request for deriving an authenticator's intrinsic grouping key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthenticatorGroupKeyRequest<'a> {
    pub website_url: &'a str,
    pub issuer: &'a str,
}

impl AuthenticatorGroupKeyRequest<'_> {
    #[must_use]
    pub fn resolve(&self) -> String {
        let request = AuthenticatorWebsiteHostRequest {
            website_url: self.website_url,
            issuer: self.issuer,
        };
        request
            .explicit_or_domain_host()
            .or_else(|| {
                AuthenticatorIssuerHosts::bundled()
                    .and_then(|catalog| catalog.resolve_website_host(request))
            })
            .unwrap_or_else(|| self.issuer.trim().to_owned())
    }

    pub(crate) fn legacy_resolve(website_url: &str, issuer: &str) -> String {
        let request = AuthenticatorWebsiteHostRequest {
            website_url,
            issuer,
        };
        request
            .explicit_or_domain_host()
            .or_else(|| {
                AuthenticatorIssuerHosts::bundled()
                    .and_then(|catalog| catalog.resolve_website_host(request))
            })
            .unwrap_or_else(|| issuer.trim().to_owned())
    }
}

impl SecretListItem {
    /// Lowercase search projection containing only the fields intentionally
    /// included in the unlocked in-memory list/search catalog.
    #[must_use]
    pub fn normalized_search_text(&self) -> String {
        let mut fields = vec![self.group_key(), self.summary(), self.id.to_string()];
        match &self.data {
            SecretListItemData::Login {
                website_url,
                username,
            } => {
                fields.push(website_url.clone());
                fields.push(username.clone());
            }
            SecretListItemData::ApiKey {
                website_url,
                expires_at,
            } => {
                fields.push(website_url.clone());
                if !expires_at.is_empty() {
                    fields.push(expires_at.clone());
                }
            }
            SecretListItemData::SeedPhrase { name, .. } => fields.push(name.clone()),
            SecretListItemData::SecureNote { title } => fields.push(title.clone()),
            SecretListItemData::Passkey {
                rp_id,
                rp_name,
                user_name,
                user_display_name,
            } => {
                fields.push(rp_id.clone());
                fields.push(rp_name.clone());
                fields.push(user_name.clone());
                fields.push(user_display_name.clone());
            }
            SecretListItemData::Authenticator {
                issuer,
                account,
                website_url,
                ..
            } => {
                fields.push(issuer.clone());
                fields.push(account.clone());
                fields.push(website_url.clone());
            }
            SecretListItemData::CreditCard {
                title,
                cardholder_name,
                last4,
                expiration_month,
                expiration_year,
            } => {
                fields.push(title.clone());
                fields.push(cardholder_name.clone());
                fields.push(last4.clone());
                fields.push(format!("{expiration_month}/{expiration_year}"));
            }
            SecretListItemData::FileAttachment {
                title,
                file_name,
                mime_type,
                ..
            } => {
                fields.push(title.clone());
                fields.push(file_name.clone());
                fields.push(mime_type.clone());
            }
        }
        fields
            .into_iter()
            .map(|field| field.to_lowercase())
            .collect::<Vec<_>>()
            .join("\n")
    }

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
            SecretListItemData::FileAttachment { .. } => SecretType::FileAttachment,
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
            | SecretListItemData::ApiKey { website_url, .. } => WebsiteHost::normalize(website_url),
            SecretListItemData::Authenticator {
                website_url,
                issuer,
                ..
            } => AuthenticatorGroupKeyRequest {
                website_url,
                issuer,
            }
            .resolve(),
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
            | SecretListItemData::CreditCard { title, .. }
            | SecretListItemData::FileAttachment { title, .. } => title.clone(),
            SecretListItemData::Passkey { rp_id, .. } => rp_id.clone(),
            SecretListItemData::Authenticator { issuer, .. } => issuer.clone(),
        }
    }

    #[must_use]
    pub fn group_key(&self) -> String {
        match &self.data {
            SecretListItemData::Login { website_url, .. }
            | SecretListItemData::ApiKey { website_url, .. } => {
                let host = WebsiteHost::normalize(website_url);
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
                SecretTitle::group_key(title, "Unnamed Note")
            }
            SecretListItemData::Passkey { rp_id, .. } => rp_id.clone(),
            SecretListItemData::Authenticator {
                website_url,
                issuer,
                ..
            } => AuthenticatorGroupKeyRequest {
                website_url,
                issuer,
            }
            .resolve(),
            SecretListItemData::CreditCard { title, .. } => {
                SecretTitle::group_key(title, "Unnamed Card")
            }
            SecretListItemData::FileAttachment {
                title, file_name, ..
            } => {
                let title = title.trim();
                if title.is_empty() {
                    let name = file_name.trim();
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
            SecretListItemData::FileAttachment { file_name, .. } => file_name.trim().to_owned(),
        }
    }
}

impl SecretPage {
    /// Resolve display group keys so brand authenticators cluster with site hosts.
    #[must_use]
    pub fn entity_group_keys(&self) -> Vec<String> {
        let intrinsic: Vec<String> = self.records.iter().map(SecretListItem::group_key).collect();
        let anchors: Vec<(usize, String)> = self
            .records
            .iter()
            .enumerate()
            .filter(|(_, item)| Self::is_site_anchor(item))
            .map(|(index, _)| (index, intrinsic[index].clone()))
            .filter(|(_, key)| key.contains('.') && key != "No Website")
            .collect();

        self.records
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

                let brand = AuthenticatorIssuerHosts::normalize_lookup_key(key);
                let account = account.trim();
                let mut best: Option<(bool, usize, String)> = None;
                for (anchor_index, host) in &anchors {
                    if !Self::brand_matches_host(BrandHostMatchRequest {
                        brand: &brand,
                        host,
                    }) {
                        continue;
                    }
                    let account_match = !account.is_empty()
                        && Self::site_anchor_account(&self.records[*anchor_index])
                            .eq_ignore_ascii_case(account);
                    let candidate = (account_match, host.len(), host.clone());
                    best = Some(match best {
                        None => candidate,
                        Some(current) => {
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

    pub(crate) fn legacy_entity_group_keys(items: &[SecretListItem]) -> Vec<String> {
        Self {
            records: items.to_vec(),
            total: items.len().into(),
            offset: 0.into(),
            limit: items.len().into(),
        }
        .entity_group_keys()
    }

    fn brand_matches_host(request: BrandHostMatchRequest<'_>) -> bool {
        let brand = request.brand;
        let host = request.host;
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
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use std::io;

    use super::*;
    use crate::SecretId;

    fn login_list_item() -> SecretListItem {
        SecretListItem {
            id: SecretId::from_vault_record("secret_test"),
            data: SecretListItemData::Login {
                website_url: "https://www.github.com/login".to_owned(),
                username: "alice".to_owned(),
            },
        }
    }

    fn entity_group_keys(items: &[SecretListItem]) -> Vec<String> {
        SecretPage {
            records: items.to_vec(),
            total: items.len().into(),
            offset: 0.into(),
            limit: items.len().into(),
        }
        .entity_group_keys()
    }

    #[test]
    fn website_host_strips_url_credentials_query_and_fragment() -> anyhow::Result<()> {
        for (url, expected) in [
            ("https://example.com?next=/vault", "example.com"),
            ("https://user@example.com/", "example.com"),
            ("https://example.com/#vault", "example.com"),
            ("example.com/login", "example.com"),
        ] {
            let mut item = login_list_item();
            let SecretListItemData::Login { website_url, .. } = &mut item.data else {
                return Err(io::Error::other("expected login item").into());
            };
            *website_url = url.to_owned();
            assert_eq!(item.website_host(), expected, "{url}");
        }
        Ok(())
    }

    #[test]
    fn login_host_matches_origin_uses_normalized_host_equality() {
        assert!(
            LoginHostMatchRequest {
                website_url: "https://www.example.com/login",
                origin: "https://example.com",
            }
            .matches()
        );
        assert!(
            !LoginHostMatchRequest {
                website_url: "example.com",
                origin: "http://127.0.0.1:4173/login",
            }
            .matches()
        );
        assert!(
            LoginHostMatchRequest {
                website_url: "http://127.0.0.1:4173/account",
                origin: "http://127.0.0.1:4199/login",
            }
            .matches()
        );
        assert!(
            !LoginHostMatchRequest {
                website_url: "https://example.com",
                origin: "https://evil-example.com",
            }
            .matches()
        );
        assert!(
            !LoginHostMatchRequest {
                website_url: "https://notexample.com",
                origin: "https://example.com",
            }
            .matches()
        );
        assert!(
            !LoginHostMatchRequest {
                website_url: "https://",
                origin: "https://example.com",
            }
            .matches()
        );
        assert!(
            LoginHostMatchRequest {
                website_url: "https://microsoft.com/account",
                origin: "https://login.microsoftonline.com",
            }
            .matches()
        );
        assert!(
            LoginHostMatchRequest {
                website_url: "https://slack.com",
                origin: "https://app.slack.com",
            }
            .matches()
        );
        assert!(
            !LoginHostMatchRequest {
                website_url: "https://microsoft.com",
                origin: "https://evil-microsoft.com",
            }
            .matches()
        );
    }

    #[test]
    fn list_item_reports_no_host_for_malformed_login_url() -> anyhow::Result<()> {
        let mut item = login_list_item();
        let SecretListItemData::Login { website_url, .. } = &mut item.data else {
            return Err(io::Error::other("expected login item").into());
        };
        *website_url = "https://".to_owned();
        assert!(item.website_host().is_empty());
        assert_eq!(item.group_key(), "No Website");
        Ok(())
    }

    #[test]
    fn authenticator_group_key_uses_url_issuer_host_and_popular_map() {
        assert_eq!(
            AuthenticatorGroupKeyRequest {
                website_url: "https://www.custom.example/login",
                issuer: "OpenAI",
            }
            .resolve(),
            "custom.example"
        );
        assert_eq!(
            AuthenticatorGroupKeyRequest {
                website_url: "",
                issuer: "https://www.namecheap.com",
            }
            .resolve(),
            "namecheap.com"
        );
        assert_eq!(
            AuthenticatorGroupKeyRequest {
                website_url: "",
                issuer: "namecheap.com",
            }
            .resolve(),
            "namecheap.com"
        );
        assert_eq!(
            AuthenticatorGroupKeyRequest {
                website_url: "",
                issuer: "OpenAI",
            }
            .resolve(),
            "openai.com"
        );
        assert_eq!(
            AuthenticatorGroupKeyRequest {
                website_url: "",
                issuer: "Namecheap",
            }
            .resolve(),
            "namecheap.com"
        );
        assert_eq!(
            AuthenticatorGroupKeyRequest {
                website_url: "",
                issuer: "Totally Unknown Service",
            }
            .resolve(),
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
                    backup_code_count: 0.into(),
                },
            },
        ];
        assert_eq!(
            entity_group_keys(&items),
            vec!["namecheap.com".to_owned(), "namecheap.com".to_owned()]
        );
    }

    #[test]
    fn resolve_entity_group_keys_prefers_account_matched_host() {
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
                    backup_code_count: 0.into(),
                },
            },
        ];
        assert_eq!(
            entity_group_keys(&items),
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
                backup_code_count: 0.into(),
            },
        }];
        assert_eq!(
            entity_group_keys(&items),
            vec!["Totally Unknown Service".to_owned()]
        );
    }
}
