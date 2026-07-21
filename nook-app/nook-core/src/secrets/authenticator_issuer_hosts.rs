//! Bundled issuer → website host mapping for authenticator clustering.

use std::collections::HashMap;
use std::sync::OnceLock;
use url::Url;

const ISSUER_HOSTS_JSON: &str = include_str!("../../data/authenticator_issuer_hosts.json");

fn issuer_host_map() -> &'static HashMap<String, String> {
    static MAP: OnceLock<HashMap<String, String>> = OnceLock::new();
    MAP.get_or_init(|| {
        let raw: HashMap<String, String> = serde_json::from_str(ISSUER_HOSTS_JSON)
            .expect("authenticator_issuer_hosts.json must be valid JSON");
        raw.into_iter()
            .map(|(issuer, host)| (normalize_issuer_lookup_key(&issuer), host))
            .filter(|(issuer, host)| !issuer.is_empty() && !host.trim().is_empty())
            .collect()
    })
}

fn hostname_from_raw(raw: &str) -> String {
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

fn issuer_looks_like_host(issuer: &str) -> bool {
    issuer.contains("://") || issuer.contains('.')
}

/// Normalize an authenticator issuer for table lookup (`OpenAI` → `openai`).
#[must_use]
pub fn normalize_issuer_lookup_key(raw: &str) -> String {
    raw.chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .flat_map(char::to_lowercase)
        .collect()
}

/// Look up a popular-service host for a brand issuer label.
#[must_use]
pub fn mapped_host_for_issuer(issuer: &str) -> Option<&'static str> {
    let key = normalize_issuer_lookup_key(issuer);
    if key.is_empty() {
        return None;
    }
    issuer_host_map().get(&key).map(String::as_str)
}

/// Resolve a website host for authenticator clustering / optional URL inference.
///
/// Order: explicit `website_url`, domain-like issuer text, then bundled map.
#[must_use]
pub fn resolve_authenticator_website_host(website_url: &str, issuer: &str) -> Option<String> {
    let from_url = hostname_from_raw(website_url);
    if !from_url.is_empty() {
        return Some(from_url);
    }

    let issuer = issuer.trim();
    if issuer.is_empty() {
        return None;
    }
    if issuer_looks_like_host(issuer) {
        let host = hostname_from_raw(issuer);
        if !host.is_empty() {
            return Some(host);
        }
    }
    mapped_host_for_issuer(issuer).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_popular_brand_issuers() {
        assert_eq!(mapped_host_for_issuer("OpenAI"), Some("openai.com"));
        assert_eq!(mapped_host_for_issuer("GitHub"), Some("github.com"));
        assert_eq!(mapped_host_for_issuer("Namecheap"), Some("namecheap.com"));
        assert_eq!(mapped_host_for_issuer("Epic Games"), Some("epicgames.com"));
    }

    #[test]
    fn unknown_issuer_has_no_mapping() {
        assert_eq!(mapped_host_for_issuer("Totally Unknown Service"), None);
    }

    #[test]
    fn resolve_prefers_explicit_website_url() {
        assert_eq!(
            resolve_authenticator_website_host("https://www.openai.com/account", "GitHub"),
            Some("openai.com".to_owned())
        );
    }

    #[test]
    fn resolve_uses_domain_like_issuer_then_map() {
        assert_eq!(
            resolve_authenticator_website_host("", "https://github.com"),
            Some("github.com".to_owned())
        );
        assert_eq!(
            resolve_authenticator_website_host("", "OpenAI"),
            Some("openai.com".to_owned())
        );
    }
}
