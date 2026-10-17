//! Rust-owned classification of the browser tab an extension surface acts on.
//!
//! The extension service worker reads the active tab's URL and passes the
//! observation here unchanged; TypeScript never parses it or decides its kind.
//! Only an `http:` or `https:` URL with a host is a website target. The tab URL
//! is consumed by classification and never retained: a website target keeps only
//! its canonical origin and display host, never userinfo, path, query, or
//! fragment.
//!
//! - The origin is the WHATWG ASCII serialization (`scheme://host[:port]`, the
//!   default port omitted). It equals the browser's `URL.origin` for that page,
//!   which the website login routes compare with the content script's sender.
//! - The display host is the canonical lowercase host without a port, because
//!   website login matching ignores ports. It keeps `www` and every other label.
//!   Internationalized domains stay in their ASCII (punycode) form so a
//!   homograph host cannot render as another site's name. IPv6 hosts keep their
//!   brackets.

use crate::vault_host_policy::{VaultAppHostname, VaultHostObservation};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use url::Url;

/// Active-tab URL as reported by the browser, before Rust classifies it.
#[derive(Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum BrowserTabUrlObservation {
    /// The browser reported no URL for the tab, as for its own `chrome:` pages.
    Unavailable,
    /// The browser reported this URL for the tab's top-level document.
    Observed { url: BrowserTabUrl },
}

/// Unvalidated tab URL text. Every string is a valid observation; malformed
/// text classifies as a non-web tab. It has no `Debug`, so diagnostics cannot
/// format a tab URL.
#[derive(Serialize, Deserialize, Tsify, derive_more::From)]
#[serde(transparent)]
pub struct BrowserTabUrl(String);

/// Rust-owned decision about which kind of page a browser tab shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum BrowserTabTarget {
    /// A website outside the Nook vault apps.
    Web(WebTabTarget),
    /// A browser, extension, local-file, inline-data, or script page, or no URL.
    NonWeb,
    /// A Simple or Sentinel vault app on a production, development, or PR
    /// preview host, where no extension content script runs.
    NookVaultApp,
}

/// Non-secret identity of a website tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct WebTabTarget {
    origin: WebTabOrigin,
    display_host: WebTabDisplayHost,
}

/// Canonical serialized origin of a website tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(transparent)]
pub struct WebTabOrigin(String);

/// Host of a website tab for display, without port or any URL component.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(transparent)]
pub struct WebTabDisplayHost(String);

impl BrowserTabUrlObservation {
    /// Classifies the tab. An absent or malformed URL is never a website target.
    #[must_use]
    pub fn classify(self) -> BrowserTabTarget {
        match self {
            Self::Unavailable => BrowserTabTarget::NonWeb,
            Self::Observed { url } => url.classify(),
        }
    }
}

impl BrowserTabUrl {
    fn classify(self) -> BrowserTabTarget {
        let Self(text) = self;
        let Ok(url) = Url::parse(&text) else {
            return BrowserTabTarget::NonWeb;
        };
        match url.scheme() {
            "http" | "https" => WebTabTarget::admit(&url),
            _ => BrowserTabTarget::NonWeb,
        }
    }
}

impl WebTabTarget {
    /// Admits an `http:` or `https:` URL that is not a Nook vault app.
    fn admit(url: &Url) -> BrowserTabTarget {
        let Some(host) = url.host_str() else {
            return BrowserTabTarget::NonWeb;
        };
        match VaultHostObservation::new(host).vault_app_hostname() {
            VaultAppHostname::Simple | VaultAppHostname::Sentinel => BrowserTabTarget::NookVaultApp,
            VaultAppHostname::Unrelated => BrowserTabTarget::Web(Self {
                origin: WebTabOrigin(url.origin().ascii_serialization()),
                display_host: WebTabDisplayHost(host.to_owned()),
            }),
        }
    }

    #[must_use]
    pub fn origin(&self) -> &WebTabOrigin {
        &self.origin
    }

    #[must_use]
    pub fn display_host(&self) -> &WebTabDisplayHost {
        &self.display_host
    }
}

impl WebTabOrigin {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(origin) = self;
        origin
    }
}

impl WebTabDisplayHost {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(host) = self;
        host
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct WebTabCase {
        url: &'static str,
        origin: &'static str,
        display_host: &'static str,
    }

    impl WebTabCase {
        fn assert_classified(self) {
            assert_eq!(
                BrowserTabUrlObservation::Observed {
                    url: BrowserTabUrl::from(self.url.to_owned()),
                }
                .classify(),
                BrowserTabTarget::Web(WebTabTarget {
                    origin: WebTabOrigin(self.origin.to_owned()),
                    display_host: WebTabDisplayHost(self.display_host.to_owned()),
                }),
                "{}",
                self.url
            );
        }
    }

    struct TabKindCase {
        url: &'static str,
        expected: BrowserTabTarget,
    }

    impl TabKindCase {
        fn assert_classified(self) {
            assert_eq!(
                BrowserTabUrlObservation::Observed {
                    url: BrowserTabUrl::from(self.url.to_owned()),
                }
                .classify(),
                self.expected,
                "{}",
                self.url
            );
        }
    }

    #[test]
    fn http_and_https_pages_are_web_targets_with_origin_and_display_host() {
        for case in [
            WebTabCase {
                url: "https://www.example.com/login?next=/account#password",
                origin: "https://www.example.com",
                display_host: "www.example.com",
            },
            WebTabCase {
                url: "http://intranet.example.test/",
                origin: "http://intranet.example.test",
                display_host: "intranet.example.test",
            },
            WebTabCase {
                url: "HTTPS://Login.EXAMPLE.com/Path",
                origin: "https://login.example.com",
                display_host: "login.example.com",
            },
        ] {
            case.assert_classified();
        }
    }

    #[test]
    fn web_targets_strip_userinfo_path_query_and_fragment() -> anyhow::Result<()> {
        let target = BrowserTabUrlObservation::Observed {
            url: BrowserTabUrl::from(
                "https://alice:hunter2@example.com/reset?token=abc123#step".to_owned(),
            ),
        }
        .classify();
        assert_eq!(
            target,
            BrowserTabTarget::Web(WebTabTarget {
                origin: WebTabOrigin("https://example.com".to_owned()),
                display_host: WebTabDisplayHost("example.com".to_owned()),
            })
        );
        let wire = serde_json::to_string(&target)?;
        for fragment in ["alice", "hunter2", "reset", "token", "abc123", "step"] {
            assert!(!wire.contains(fragment), "{fragment}");
        }
        Ok(())
    }

    #[test]
    fn origin_keeps_non_default_ports_and_display_host_never_shows_a_port() {
        for case in [
            WebTabCase {
                url: "http://localhost:5173/app",
                origin: "http://localhost:5173",
                display_host: "localhost",
            },
            WebTabCase {
                url: "https://example.com:8443/",
                origin: "https://example.com:8443",
                display_host: "example.com",
            },
            WebTabCase {
                url: "https://example.com:443/",
                origin: "https://example.com",
                display_host: "example.com",
            },
            WebTabCase {
                url: "http://example.com:80/",
                origin: "http://example.com",
                display_host: "example.com",
            },
        ] {
            case.assert_classified();
        }
    }

    #[test]
    fn internationalized_and_ip_hosts_display_their_ascii_canonical_form() {
        for case in [
            WebTabCase {
                url: "https://bücher.example/kasse",
                origin: "https://xn--bcher-kva.example",
                display_host: "xn--bcher-kva.example",
            },
            WebTabCase {
                url: "https://xn--bcher-kva.example/",
                origin: "https://xn--bcher-kva.example",
                display_host: "xn--bcher-kva.example",
            },
            WebTabCase {
                url: "http://192.168.0.10:8080/admin",
                origin: "http://192.168.0.10:8080",
                display_host: "192.168.0.10",
            },
            WebTabCase {
                url: "http://[::1]:3000/",
                origin: "http://[::1]:3000",
                display_host: "[::1]",
            },
        ] {
            case.assert_classified();
        }
    }

    #[test]
    fn browser_extension_local_inline_and_script_pages_are_non_web() {
        for url in [
            "chrome://settings/passwords",
            "chrome://newtab/",
            "chrome-extension://abcdefghijklmnopabcdefghijklmnop/side-panel/index.html",
            "about:blank",
            "about:srcdoc",
            "data:text/html,<form><input type=password></form>",
            "file:///Users/someone/login.html",
            "view-source:https://example.com/login",
            "javascript:alert(document.cookie)",
            "blob:https://example.com/0b8c2d4e-1f3a-4b5c-9d6e-7f8a9b0c1d2e",
            "ftp://example.com/",
            "wss://example.com/socket",
        ] {
            TabKindCase {
                url,
                expected: BrowserTabTarget::NonWeb,
            }
            .assert_classified();
        }
    }

    #[test]
    fn empty_malformed_and_unavailable_urls_are_non_web() {
        for url in [
            "",
            "   ",
            "example.com",
            "not a url",
            "https://",
            "http:///",
        ] {
            TabKindCase {
                url,
                expected: BrowserTabTarget::NonWeb,
            }
            .assert_classified();
        }
        assert_eq!(
            BrowserTabUrlObservation::Unavailable.classify(),
            BrowserTabTarget::NonWeb
        );
    }

    #[test]
    fn simple_and_sentinel_production_development_and_preview_hosts_are_vault_apps() {
        for url in [
            "https://simple.nokey.sh/",
            "https://sentinel.nokey.sh/unlock",
            "https://simple.dev.nokey.sh/#/vault",
            "https://sentinel.dev.nokey.sh/",
            "https://pr-1733.nokey-simple.pages.dev/",
            "https://feat-toolbar.nokey-sentinel.pages.dev/app",
            "https://SIMPLE.NOKEY.SH/",
            "http://simple.nokey.sh/",
            "https://user:secret@sentinel.nokey.sh/",
        ] {
            TabKindCase {
                url,
                expected: BrowserTabTarget::NookVaultApp,
            }
            .assert_classified();
        }
    }

    #[test]
    fn hosts_that_only_resemble_vault_apps_stay_web_targets() {
        for case in [
            WebTabCase {
                url: "https://simple.nokey.sh.example.com/",
                origin: "https://simple.nokey.sh.example.com",
                display_host: "simple.nokey.sh.example.com",
            },
            WebTabCase {
                url: "https://nokey-simple.pages.dev/",
                origin: "https://nokey-simple.pages.dev",
                display_host: "nokey-simple.pages.dev",
            },
            WebTabCase {
                url: "https://nokey.sh/",
                origin: "https://nokey.sh",
                display_host: "nokey.sh",
            },
        ] {
            case.assert_classified();
        }
    }

    #[test]
    fn target_wire_names_the_kind_and_carries_only_origin_and_display_host() -> anyhow::Result<()> {
        let web = BrowserTabUrlObservation::Observed {
            url: BrowserTabUrl::from("https://example.com:8443/login".to_owned()),
        }
        .classify();
        assert_eq!(
            serde_json::to_value(&web)?,
            serde_json::json!({
                "kind": "Web",
                "origin": "https://example.com:8443",
                "display_host": "example.com",
            })
        );
        assert_eq!(
            serde_json::to_value(BrowserTabTarget::NonWeb)?,
            serde_json::json!({ "kind": "NonWeb" })
        );
        assert_eq!(
            serde_json::to_value(BrowserTabTarget::NookVaultApp)?,
            serde_json::json!({ "kind": "NookVaultApp" })
        );
        Ok(())
    }

    #[test]
    fn observation_wire_decodes_both_states_and_rejects_other_shapes() -> anyhow::Result<()> {
        let observed: BrowserTabUrlObservation = serde_json::from_value(serde_json::json!({
            "kind": "Observed",
            "url": "https://example.com/login",
        }))?;
        assert_eq!(
            observed.classify(),
            BrowserTabTarget::Web(WebTabTarget {
                origin: WebTabOrigin("https://example.com".to_owned()),
                display_host: WebTabDisplayHost("example.com".to_owned()),
            })
        );
        let unavailable: BrowserTabUrlObservation =
            serde_json::from_value(serde_json::json!({ "kind": "Unavailable" }))?;
        assert_eq!(unavailable.classify(), BrowserTabTarget::NonWeb);
        for rejected in [
            serde_json::json!({ "kind": "Observed" }),
            serde_json::json!({ "kind": "Observed", "url": 7 }),
            serde_json::json!({ "kind": "Observed", "url": "https://example.com", "tab_id": 3 }),
            serde_json::json!({ "kind": "Web", "origin": "https://example.com" }),
            serde_json::json!({ "url": "https://example.com" }),
            serde_json::json!("https://example.com"),
        ] {
            assert!(
                serde_json::from_value::<BrowserTabUrlObservation>(rejected.clone()).is_err(),
                "{rejected}"
            );
        }
        Ok(())
    }

    #[test]
    fn web_target_exposes_its_origin_and_display_host() -> anyhow::Result<()> {
        let BrowserTabTarget::Web(target) = BrowserTabUrlObservation::Observed {
            url: BrowserTabUrl::from("https://accounts.example.com/signin".to_owned()),
        }
        .classify() else {
            anyhow::bail!("expected a website target");
        };
        assert_eq!(target.origin().as_str(), "https://accounts.example.com");
        assert_eq!(target.display_host().as_str(), "accounts.example.com");
        Ok(())
    }
}
