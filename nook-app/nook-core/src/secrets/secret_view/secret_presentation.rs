use super::*;

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
