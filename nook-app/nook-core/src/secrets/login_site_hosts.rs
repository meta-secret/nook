//! Bundled login-host families for credential matching across SSO shells.
//!
//! Popular services often store a brand host (`microsoft.com`) while the live
//! sign-in page runs on a related host (`login.microsoftonline.com`). This map
//! is an explicit allowlist — never substring or public-suffix guessing.

use serde::Deserialize;
use serde::de::{self, Deserializer, MapAccess, Visitor};
use std::collections::HashMap;
use std::fmt;
use std::sync::LazyLock;

/// Host → family id table for related-login matching.
#[derive(Debug)]
struct LoginSiteHosts {
    by_host: HashMap<String, String>,
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
                    let host = normalize_login_host(&host);
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

static LOGIN_SITE_HOSTS: LazyLock<LoginSiteHosts> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../data/login_site_hosts.json"))
        .expect("bundled login_site_hosts.json must deserialize")
});

/// Normalize a hostname the same way login matching strips `www.`.
#[must_use]
pub fn normalize_login_host(raw: &str) -> String {
    raw.trim().trim_start_matches("www.").to_ascii_lowercase()
}

/// Look up the bundled login family id for a normalized host, if any.
#[must_use]
pub fn login_host_family(host: &str) -> Option<&'static str> {
    let host = normalize_login_host(host);
    if host.is_empty() {
        return None;
    }
    LOGIN_SITE_HOSTS.by_host.get(&host).map(String::as_str)
}

/// True when two hosts share an explicit login family allowlist entry.
#[must_use]
pub fn login_hosts_share_family(left: &str, right: &str) -> bool {
    match (login_host_family(left), login_host_family(right)) {
        (Some(left_family), Some(right_family)) => left_family == right_family,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_host_family_map() {
        let hosts: LoginSiteHosts =
            serde_json::from_str(r#"{ "Login.MicrosoftOnline.com": "microsoft" }"#)
                .expect("valid hosts deserialize");
        assert_eq!(
            hosts
                .by_host
                .get("login.microsoftonline.com")
                .map(String::as_str),
            Some("microsoft")
        );
        assert!(serde_json::from_str::<LoginSiteHosts>(r#"{ "": "microsoft" }"#).is_err());
        assert!(serde_json::from_str::<LoginSiteHosts>(r#"{ "microsoft.com": "" }"#).is_err());
    }

    #[test]
    fn maps_popular_sso_shells_to_brand_families() {
        assert_eq!(
            login_host_family("login.microsoftonline.com"),
            Some("microsoft")
        );
        assert_eq!(login_host_family("login.live.com"), Some("microsoft"));
        assert_eq!(login_host_family("www.microsoft.com"), Some("microsoft"));
        assert_eq!(login_host_family("app.slack.com"), Some("slack"));
        assert_eq!(login_host_family("accounts.google.com"), Some("google"));
        assert_eq!(login_host_family("github.com"), Some("github"));
        assert_eq!(login_host_family("m.facebook.com"), Some("facebook"));
        assert_eq!(login_host_family("amazon.com"), Some("amazon"));
    }

    #[test]
    fn unrelated_or_unknown_hosts_do_not_share_a_family() {
        assert!(!login_hosts_share_family("example.com", "microsoft.com"));
        assert!(!login_hosts_share_family(
            "evil-microsoft.com",
            "microsoft.com"
        ));
        assert!(!login_hosts_share_family("slack.com", "microsoft.com"));
        assert!(login_hosts_share_family(
            "login.microsoftonline.com",
            "microsoft.com"
        ));
        assert!(login_hosts_share_family("app.slack.com", "slack.com"));
    }
}
