//! Bundled issuer → website host mapping for authenticator clustering.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::secret_view::WebsiteHost;

use serde::Deserialize;
use serde::de::{self, Deserializer, MapAccess, Visitor};
use std::collections::HashMap;
use std::fmt;
use std::sync::LazyLock;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum AuthenticatorIssuerHostsError {
    #[error("bundled authenticator issuer catalog is invalid")]
    InvalidBundledCatalog,
}

/// Popular authenticator issuer labels mapped to website hosts.
///
/// Deserialized once from the bundled JSON. Keys are normalized on deserialize
/// (`OpenAI` / `openai` → `openai`) so WASM and native share one lookup table.
#[derive(Debug)]
pub struct AuthenticatorIssuerHosts {
    by_issuer: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthenticatorWebsiteHostRequest<'a> {
    pub website_url: &'a str,
    pub issuer: &'a str,
}

impl AuthenticatorWebsiteHostRequest<'_> {
    #[must_use]
    pub(crate) fn explicit_or_domain_host(&self) -> Option<String> {
        if let Some(from_url) = WebsiteHost::normalize(self.website_url) {
            return Some(from_url.into_string());
        }

        let issuer = self.issuer.trim();
        if issuer.is_empty() || !(issuer.contains("://") || issuer.contains('.')) {
            return None;
        }
        WebsiteHost::normalize(issuer).map(WebsiteHost::into_string)
    }
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

    pub fn require_bundled() -> Result<&'static Self, AuthenticatorIssuerHostsError> {
        Self::bundled().ok_or(AuthenticatorIssuerHostsError::InvalidBundledCatalog)
    }

    /// Normalize an authenticator issuer for table lookup (`OpenAI` → `openai`).
    #[must_use]
    pub(crate) fn normalize_lookup_key(raw: &str) -> String {
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
    pub fn resolve_website_host(
        &self,
        request: AuthenticatorWebsiteHostRequest<'_>,
    ) -> Option<String> {
        if let Some(host) = request.explicit_or_domain_host() {
            return Some(host);
        }

        self.mapped_host(request.issuer).map(str::to_owned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled() -> anyhow::Result<&'static AuthenticatorIssuerHosts> {
        AuthenticatorIssuerHosts::bundled().ok_or_else(|| anyhow::anyhow!("bundled issuer catalog"))
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
    fn maps_popular_brand_issuers() -> anyhow::Result<()> {
        let bundled = bundled()?;
        assert_eq!(bundled.mapped_host("OpenAI"), Some("openai.com"));
        assert_eq!(bundled.mapped_host("GitHub"), Some("github.com"));
        assert_eq!(bundled.mapped_host("Namecheap"), Some("namecheap.com"));
        assert_eq!(bundled.mapped_host("Epic Games"), Some("epicgames.com"));
        Ok(())
    }

    #[test]
    fn unknown_issuer_has_no_mapping() -> anyhow::Result<()> {
        assert_eq!(bundled()?.mapped_host("Totally Unknown Service"), None);
        Ok(())
    }

    #[test]
    fn resolve_prefers_explicit_website_url() -> anyhow::Result<()> {
        let bundled = bundled()?;
        assert_eq!(
            bundled.resolve_website_host(AuthenticatorWebsiteHostRequest {
                website_url: "https://www.openai.com/account",
                issuer: "GitHub",
            }),
            Some("openai.com".to_owned())
        );
        Ok(())
    }

    #[test]
    fn resolve_uses_domain_like_issuer_then_map() -> anyhow::Result<()> {
        let bundled = bundled()?;
        assert_eq!(
            bundled.resolve_website_host(AuthenticatorWebsiteHostRequest {
                website_url: "",
                issuer: "https://github.com",
            }),
            Some("github.com".to_owned())
        );
        assert_eq!(
            bundled.resolve_website_host(AuthenticatorWebsiteHostRequest {
                website_url: "",
                issuer: "OpenAI",
            }),
            Some("openai.com".to_owned())
        );
        Ok(())
    }
}
