//! Bundled login-host families for credential matching across SSO shells.
//!
//! Popular services often store a brand host (`microsoft.com`) while the live
//! sign-in page runs on a related host (`login.microsoftonline.com`). This map
//! is an explicit allowlist — never substring or public-suffix guessing.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::Deserialize;
use serde::de::{self, Deserializer, MapAccess, Visitor};
use std::collections::HashMap;
use std::fmt;
use std::sync::LazyLock;

/// Host → family id table for related-login matching.
#[derive(Debug)]
pub(crate) struct LoginSiteHosts {
    by_host: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LoginFamilyMatchRequest<'a> {
    pub(crate) left: &'a str,
    pub(crate) right: &'a str,
}

impl<'de> Deserialize<'de> for LoginSiteHosts {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct HostsVisitor;

        impl<'de> Visitor<'de> for HostsVisitor {
            type Value = LoginSiteHosts;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON object of login hosts to family ids")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut by_host = HashMap::with_capacity(map.size_hint().unwrap_or(0));
                while let Some((host, family)) = map.next_entry::<String, String>()? {
                    let host = LoginSiteHosts::normalize_host(&host);
                    let family = family.trim().to_ascii_lowercase();
                    if host.is_empty() {
                        return Err(de::Error::custom("login host must not be empty"));
                    }
                    if family.is_empty() {
                        return Err(de::Error::custom(format!(
                            "family for host `{host}` must not be empty"
                        )));
                    }
                    by_host.insert(host, family);
                }
                Ok(LoginSiteHosts { by_host })
            }
        }

        deserializer.deserialize_map(HostsVisitor)
    }
}

enum LoginSiteHostsState {
    Ready(LoginSiteHosts),
    InvalidBundledCatalog,
}

static LOGIN_SITE_HOSTS: LazyLock<LoginSiteHostsState> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../data/login_site_hosts.json")).map_or(
        LoginSiteHostsState::InvalidBundledCatalog,
        LoginSiteHostsState::Ready,
    )
});

impl LoginSiteHosts {
    /// Select the bundled catalog when it is valid.
    #[must_use]
    pub(crate) fn bundled() -> Option<&'static Self> {
        match &*LOGIN_SITE_HOSTS {
            LoginSiteHostsState::Ready(hosts) => Some(hosts),
            LoginSiteHostsState::InvalidBundledCatalog => None,
        }
    }

    /// Normalize a hostname the same way login matching strips `www.`.
    #[must_use]
    fn normalize_host(raw: &str) -> String {
        raw.trim().trim_start_matches("www.").to_ascii_lowercase()
    }

    /// Look up the bundled login family id for a normalized host, if any.
    #[must_use]
    pub(crate) fn family(&self, host: &str) -> Option<&str> {
        let host = Self::normalize_host(host);
        if host.is_empty() {
            return None;
        }
        self.by_host.get(&host).map(String::as_str)
    }

    /// True when two hosts share an explicit login family allowlist entry.
    #[must_use]
    pub(crate) fn share_family(&self, request: LoginFamilyMatchRequest<'_>) -> bool {
        match (self.family(request.left), self.family(request.right)) {
            (Some(left_family), Some(right_family)) => left_family == right_family,
            _ => false,
        }
    }

    pub(crate) fn legacy_normalize_host(raw: &str) -> String {
        Self::normalize_host(raw)
    }

    pub(crate) fn legacy_family(host: &str) -> Option<&'static str> {
        Self::bundled().and_then(|catalog| catalog.family(host))
    }

    pub(crate) fn legacy_share_family(left: &str, right: &str) -> bool {
        Self::bundled()
            .is_some_and(|catalog| catalog.share_family(LoginFamilyMatchRequest { left, right }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled() -> &'static LoginSiteHosts {
        match LoginSiteHosts::bundled() {
            Some(catalog) => catalog,
            None => panic!("bundled login-host catalog"),
        }
    }

    #[test]
    fn deserializes_host_family_map() -> anyhow::Result<()> {
        let hosts: LoginSiteHosts =
            serde_json::from_str(r#"{ "Login.MicrosoftOnline.com": "microsoft" }"#)?;
        assert_eq!(
            hosts
                .by_host
                .get("login.microsoftonline.com")
                .map(String::as_str),
            Some("microsoft")
        );
        assert!(serde_json::from_str::<LoginSiteHosts>(r#"{ "": "microsoft" }"#).is_err());
        assert!(serde_json::from_str::<LoginSiteHosts>(r#"{ "microsoft.com": "" }"#).is_err());
        Ok(())
    }

    #[test]
    fn maps_popular_sso_shells_to_brand_families() {
        assert_eq!(
            bundled().family("login.microsoftonline.com"),
            Some("microsoft")
        );
        assert_eq!(bundled().family("login.live.com"), Some("microsoft"));
        assert_eq!(bundled().family("www.microsoft.com"), Some("microsoft"));
        assert_eq!(bundled().family("app.slack.com"), Some("slack"));
        assert_eq!(bundled().family("accounts.google.com"), Some("google"));
        assert_eq!(bundled().family("github.com"), Some("github"));
        assert_eq!(bundled().family("m.facebook.com"), Some("facebook"));
        assert_eq!(bundled().family("amazon.com"), Some("amazon"));
    }

    #[test]
    fn unrelated_or_unknown_hosts_do_not_share_a_family() {
        assert!(!bundled().share_family(LoginFamilyMatchRequest {
            left: "example.com",
            right: "microsoft.com",
        }));
        assert!(!bundled().share_family(LoginFamilyMatchRequest {
            left: "evil-microsoft.com",
            right: "microsoft.com",
        }));
        assert!(!bundled().share_family(LoginFamilyMatchRequest {
            left: "slack.com",
            right: "microsoft.com",
        }));
        assert!(bundled().share_family(LoginFamilyMatchRequest {
            left: "login.microsoftonline.com",
            right: "microsoft.com",
        }));
        assert!(bundled().share_family(LoginFamilyMatchRequest {
            left: "app.slack.com",
            right: "slack.com",
        }));
    }
}
