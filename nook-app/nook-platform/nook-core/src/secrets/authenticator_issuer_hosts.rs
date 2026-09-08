//! Bundled issuer → website host mapping for authenticator clustering.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::secret_view::SecretListItem;

use serde::Deserialize;
use serde::de::{self, Deserializer, MapAccess, Visitor};
use std::collections::HashMap;
use std::fmt;
use std::sync::LazyLock;

/// Popular authenticator issuer labels mapped to website hosts.
///
/// Deserialized once from the bundled JSON. Keys are normalized on deserialize
/// (`OpenAI` / `openai` → `openai`) so WASM and native share one lookup table.
#[derive(Debug)]
pub struct AuthenticatorIssuerHosts {
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
                    let key = AuthenticatorIssuerHosts::normalize_lookup_key(&issuer);
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

enum AuthenticatorIssuerHostsState {
    Ready(AuthenticatorIssuerHosts),
    InvalidBundledCatalog,
}

static ISSUER_HOSTS: LazyLock<AuthenticatorIssuerHostsState> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../data/authenticator_issuer_hosts.json")).map_or(
        AuthenticatorIssuerHostsState::InvalidBundledCatalog,
        AuthenticatorIssuerHostsState::Ready,
    )
});

impl AuthenticatorIssuerHosts {
    /// Select the bundled catalog when it is valid.
    #[must_use]
    pub fn bundled() -> Option<&'static Self> {
        match &*ISSUER_HOSTS {
            AuthenticatorIssuerHostsState::Ready(hosts) => Some(hosts),
            AuthenticatorIssuerHostsState::InvalidBundledCatalog => None,
        }
    }

    fn issuer_looks_like_host(issuer: &str) -> bool {
        issuer.contains("://") || issuer.contains('.')
    }

    /// Normalize an authenticator issuer for table lookup (`OpenAI` → `openai`).
    #[must_use]
    pub fn normalize_lookup_key(raw: &str) -> String {
        raw.chars()
            .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
            .flat_map(char::to_lowercase)
            .collect()
    }

    /// Look up a popular-service host for a brand issuer label.
    #[must_use]
    pub fn mapped_host(&self, issuer: &str) -> Option<&str> {
        let key = Self::normalize_lookup_key(issuer);
        if key.is_empty() {
            return None;
        }
        self.by_issuer.get(&key).map(String::as_str)
    }

    /// Resolve a website host for authenticator clustering / optional URL inference.
    ///
    /// Order: explicit `website_url`, domain-like issuer text, then bundled map.
    #[must_use]
    pub fn resolve_website_host(&self, website_url: &str, issuer: &str) -> Option<String> {
        let from_url = SecretListItem::hostname_from_url(website_url);
        if !from_url.is_empty() {
            return Some(from_url);
        }

        let issuer = issuer.trim();
        if issuer.is_empty() {
            return None;
        }
        if Self::issuer_looks_like_host(issuer) {
            let host = SecretListItem::hostname_from_url(issuer);
            if !host.is_empty() {
                return Some(host);
            }
        }
        self.mapped_host(issuer).map(str::to_owned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled() -> &'static AuthenticatorIssuerHosts {
        AuthenticatorIssuerHosts::bundled().expect("bundled issuer catalog")
    }

    #[test]
    fn deserializes_issuer_map_with_normalized_keys() -> anyhow::Result<()> {
        let hosts: AuthenticatorIssuerHosts =
            serde_json::from_str(r#"{ "OpenAI": "openai.com", "Epic Games": "epicgames.com" }"#)?;
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
        Ok(())
    }

    #[test]
    fn maps_popular_brand_issuers() {
        assert_eq!(bundled().mapped_host("OpenAI"), Some("openai.com"));
        assert_eq!(bundled().mapped_host("GitHub"), Some("github.com"));
        assert_eq!(bundled().mapped_host("Namecheap"), Some("namecheap.com"));
        assert_eq!(bundled().mapped_host("Epic Games"), Some("epicgames.com"));
    }

    #[test]
    fn unknown_issuer_has_no_mapping() {
        assert_eq!(bundled().mapped_host("Totally Unknown Service"), None);
    }

    #[test]
    fn resolve_prefers_explicit_website_url() {
        assert_eq!(
            bundled().resolve_website_host("https://www.openai.com/account", "GitHub"),
            Some("openai.com".to_owned())
        );
    }

    #[test]
    fn resolve_uses_domain_like_issuer_then_map() {
        assert_eq!(
            bundled().resolve_website_host("", "https://github.com"),
            Some("github.com".to_owned())
        );
        assert_eq!(
            bundled().resolve_website_host("", "OpenAI"),
            Some("openai.com".to_owned())
        );
    }
}
