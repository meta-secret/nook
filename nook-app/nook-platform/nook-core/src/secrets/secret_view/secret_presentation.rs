use super::{SecretListItem, SecretListItemData, SecretType, Url};

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
/// fragment, and a leading `www.` are ignored), or an explicit related-login
/// family from the bundled allowlist (for example `microsoft.com` ↔
/// `login.microsoftonline.com`). Substring traps such as `evil-example.com` vs
/// `example.com` do not match.
#[must_use]
pub fn login_host_matches_origin(website_url: &str, origin: &str) -> bool {
    let secret_host = hostname_from_url(website_url);
    let origin_host = hostname_from_url(origin);
    if secret_host.is_empty() || origin_host.is_empty() {
        return false;
    }
    secret_host.eq_ignore_ascii_case(&origin_host)
        || crate::secrets::login_site_hosts::login_hosts_share_family(&secret_host, &origin_host)
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

pub(super) fn titled_group_key(title: &str, unnamed: &str) -> String {
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
            SecretListItemData::CreditCard { title, .. } => titled_group_key(title, "Unnamed Card"),
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

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
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
                return Err(std::io::Error::other("expected login item").into());
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
    fn list_item_reports_no_host_for_malformed_login_url() -> anyhow::Result<()> {
        let mut item = login_list_item();
        let SecretListItemData::Login { website_url, .. } = &mut item.data else {
            return Err(std::io::Error::other("expected login item").into());
        };
        *website_url = "https://".to_owned();
        assert!(item.website_host().is_empty());
        assert_eq!(item.group_key(), "No Website");
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
}
