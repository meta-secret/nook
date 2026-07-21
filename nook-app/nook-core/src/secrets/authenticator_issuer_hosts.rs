//! Bundled issuer → website host mapping for authenticator clustering.

use serde::Deserialize;
use serde::de::{self, Deserializer, MapAccess, Visitor};
use std::collections::HashMap;
use std::fmt;
use std::sync::LazyLock;
use url::Url;

/// Popular authenticator issuer labels mapped to website hosts.
///
/// Deserialized once from the bundled JSON. Keys are normalized on deserialize
/// (`OpenAI` / `openai` → `openai`) so WASM and native share one lookup table.
#[derive(Debug)]
struct AuthenticatorIssuerHosts {
    by_issuer: HashMap<String, String>,
}

impl<'de> Deserialize<'de> for AuthenticatorIssuerHosts {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct HostsVisitor;

        impl<'de> Visitor<'de> for HostsVisitor {
            type Value = AuthenticatorIssuerHosts;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON object of issuer labels to website hosts")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut by_issuer = HashMap::with_capacity(map.size_hint().unwrap_or(0));
                while let Some((issuer, host)) = map.next_entry::<String, String>()? {
                    let key = normalize_issuer_lookup_key(&issuer);
                    let host = host.trim().to_owned();
                    if key.is_empty() {
                        return Err(de::Error::custom("issuer key must not be empty"));
                    }
                    if host.is_empty() {
                        return Err(de::Error::custom(format!(
                            "host for issuer `{key}` must not be empty"
                        )));
                    }
                    by_issuer.insert(key, host);
                }
                Ok(AuthenticatorIssuerHosts { by_issuer })
            }
        }

        deserializer.deserialize_map(HostsVisitor)
    }
}

static ISSUER_HOSTS: LazyLock<AuthenticatorIssuerHosts> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../data/authenticator_issuer_hosts.json"))
        .expect("bundled authenticator_issuer_hosts.json must deserialize")
});

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
    ISSUER_HOSTS.by_issuer.get(&key).map(String::as_str)
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
    fn deserializes_issuer_map_with_normalized_keys() {
        let hosts: AuthenticatorIssuerHosts =
            serde_json::from_str(r#"{ "OpenAI": "openai.com", "Epic Games": "epicgames.com" }"#)
                .expect("valid issuers deserialize");
        assert_eq!(
            hosts.by_issuer.get("openai").map(String::as_str),
            Some("openai.com")
        );
        assert_eq!(
            hosts.by_issuer.get("epicgames").map(String::as_str),
            Some("epicgames.com")
        );

        assert!(
            serde_json::from_str::<AuthenticatorIssuerHosts>(r#"{ "": "openai.com" }"#).is_err()
        );
        assert!(serde_json::from_str::<AuthenticatorIssuerHosts>(r#"{ "openai": "" }"#).is_err());
    }

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
