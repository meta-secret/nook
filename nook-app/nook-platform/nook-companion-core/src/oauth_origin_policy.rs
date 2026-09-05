//! Product policy for browser OAuth authorized origins.
//!
//! Host adapters pass the current origin/hostname; this module decides whether
//! Google Drive or iCloud OAuth may run on that origin.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

/// Browser OAuth provider that registers fixed authorized origins.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BrowserOAuthProvider {
    GoogleDrive,
    ICloud,
}

/// Why an origin is rejected for browser OAuth.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OAuthOriginUnsupportedReason {
    CloudflarePrPreview,
    UnregisteredOrigin,
}

/// Resolved OAuth origin support for the current browser location.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OAuthOriginSupport {
    /// No browser location is available (SSR / missing window); treat as supported.
    LocationUnavailable,
    Supported {
        origin: String,
    },
    Unsupported {
        origin: String,
        reason: OAuthOriginUnsupportedReason,
    },
}

const GOOGLE_AUTHORIZED_ORIGINS: &[&str] = &[
    "https://localhost:5173",
    "https://localhost:5175",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://simple.nokey.sh",
    "https://sentinel.nokey.sh",
    "https://simple.dev.nokey.sh",
    "https://sentinel.dev.nokey.sh",
];

const ICLOUD_AUTHORIZED_ORIGINS: &[&str] = &[
    "https://localhost:5173",
    "https://localhost:5175",
    "https://simple.nokey.sh",
    "https://sentinel.nokey.sh",
    "https://simple.dev.nokey.sh",
    "https://sentinel.dev.nokey.sh",
];

impl OAuthOriginUnsupportedReason {
    /// Classify an unregistered origin's hostname; this diagnostic never authorizes it.
    #[must_use]
    pub fn for_unregistered_hostname(hostname: &str) -> Self {
        let host = hostname.to_ascii_lowercase();
        let Some(rest) = host.strip_prefix("pr-") else {
            return Self::UnregisteredOrigin;
        };
        let Some((digits, suffix)) = rest.split_once('.') else {
            return Self::UnregisteredOrigin;
        };
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return Self::UnregisteredOrigin;
        }
        match suffix {
            "nook-1n8.pages.dev"
            | "nokey-sh.pages.dev"
            | "nokey-simple.pages.dev"
            | "nokey-sentinel.pages.dev" => Self::CloudflarePrPreview,
            _ => Self::UnregisteredOrigin,
        }
    }
}

impl BrowserOAuthProvider {
    /// Resolve this provider's support for the reported browser location.
    #[must_use]
    pub fn origin_support(
        self,
        origin: Option<&str>,
        hostname: Option<&str>,
    ) -> OAuthOriginSupport {
        let (Some(origin), Some(hostname)) = (origin, hostname) else {
            return OAuthOriginSupport::LocationUnavailable;
        };
        if self.is_authorized_origin(origin) {
            return OAuthOriginSupport::Supported {
                origin: origin.to_owned(),
            };
        }
        OAuthOriginSupport::Unsupported {
            origin: origin.to_owned(),
            reason: OAuthOriginUnsupportedReason::for_unregistered_hostname(hostname),
        }
    }

    fn is_authorized_origin(self, origin: &str) -> bool {
        let origins = match self {
            Self::ICloud => ICLOUD_AUTHORIZED_ORIGINS,
            Self::GoogleDrive => GOOGLE_AUTHORIZED_ORIGINS,
        };
        origins.contains(&origin)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_registered_origins_and_rejects_preview_hosts() {
        assert!(matches!(
            BrowserOAuthProvider::GoogleDrive
                .origin_support(Some("https://simple.nokey.sh"), Some("simple.nokey.sh"),),
            OAuthOriginSupport::Supported { .. }
        ));
        assert!(matches!(
            BrowserOAuthProvider::ICloud
                .origin_support(Some("http://localhost:5173"), Some("localhost"),),
            OAuthOriginSupport::Unsupported {
                reason: OAuthOriginUnsupportedReason::UnregisteredOrigin,
                ..
            }
        ));
        let preview = BrowserOAuthProvider::GoogleDrive.origin_support(
            Some("https://pr-12.nokey-simple.pages.dev"),
            Some("pr-12.nokey-simple.pages.dev"),
        );
        assert!(matches!(
            preview,
            OAuthOriginSupport::Unsupported {
                reason: OAuthOriginUnsupportedReason::CloudflarePrPreview,
                ..
            }
        ));
        assert_eq!(
            OAuthOriginUnsupportedReason::for_unregistered_hostname("pr-99.nook-1n8.pages.dev"),
            OAuthOriginUnsupportedReason::CloudflarePrPreview
        );
        assert_eq!(
            OAuthOriginUnsupportedReason::for_unregistered_hostname("simple.nokey.sh"),
            OAuthOriginUnsupportedReason::UnregisteredOrigin
        );
    }

    #[test]
    fn preserves_provider_location_and_exact_origin_rules() {
        for provider in [
            BrowserOAuthProvider::GoogleDrive,
            BrowserOAuthProvider::ICloud,
        ] {
            for location in [
                (None, None),
                (Some("https://simple.nokey.sh"), None),
                (None, Some("simple.nokey.sh")),
            ] {
                assert_eq!(
                    provider.origin_support(location.0, location.1),
                    OAuthOriginSupport::LocationUnavailable
                );
            }
            assert_eq!(
                provider.origin_support(
                    Some("https://simple.nokey.sh"),
                    Some("pr-7.nokey-simple.pages.dev")
                ),
                OAuthOriginSupport::Supported {
                    origin: "https://simple.nokey.sh".to_owned()
                }
            );
            for origin in [
                "",
                " https://simple.nokey.sh",
                "https://simple.nokey.sh/",
                "https://SIMPLE.nokey.sh",
                "https://simple.nokey.sh.evil.test",
                "https://nokey.sh",
            ] {
                assert_eq!(
                    provider.origin_support(Some(origin), Some("simple.nokey.sh")),
                    OAuthOriginSupport::Unsupported {
                        origin: origin.to_owned(),
                        reason: OAuthOriginUnsupportedReason::UnregisteredOrigin
                    }
                );
            }
        }
        for origin in ["http://localhost:5173", "http://127.0.0.1:5173"] {
            assert!(matches!(
                BrowserOAuthProvider::GoogleDrive.origin_support(Some(origin), Some("localhost")),
                OAuthOriginSupport::Supported { .. }
            ));
            assert!(matches!(
                BrowserOAuthProvider::ICloud.origin_support(Some(origin), Some("localhost")),
                OAuthOriginSupport::Unsupported {
                    reason: OAuthOriginUnsupportedReason::UnregisteredOrigin,
                    ..
                }
            ));
        }
    }

    #[test]
    fn preview_diagnostics_require_exact_nook_hosts_and_ascii_digits() {
        for host in [
            "pr-1.nook-1n8.pages.dev",
            "pr-02.nokey-sh.pages.dev",
            "PR-9.NOKEY-SIMPLE.PAGES.DEV",
            "pr-0.nokey-sentinel.pages.dev",
        ] {
            assert_eq!(
                OAuthOriginUnsupportedReason::for_unregistered_hostname(host),
                OAuthOriginUnsupportedReason::CloudflarePrPreview
            );
        }
        for host in [
            "pr-.nokey-simple.pages.dev",
            "pr-١.nokey-simple.pages.dev",
            "pr-1x.nokey-simple.pages.dev",
            "pr-1.nokey-simple.pages.dev.evil.test",
            "pr-1.nokey-simple.pages.dev.",
            " pr-1.nokey-simple.pages.dev",
            "pr-1.other.pages.dev",
        ] {
            assert_eq!(
                OAuthOriginUnsupportedReason::for_unregistered_hostname(host),
                OAuthOriginUnsupportedReason::UnregisteredOrigin
            );
        }
    }

    #[test]
    fn preserves_serialized_report_and_enum_values() -> anyhow::Result<()> {
        assert_eq!(BrowserOAuthProvider::GoogleDrive as u32, 0);
        assert_eq!(BrowserOAuthProvider::ICloud as u32, 1);
        assert_eq!(OAuthOriginUnsupportedReason::CloudflarePrPreview as u32, 0);
        assert_eq!(OAuthOriginUnsupportedReason::UnregisteredOrigin as u32, 1);
        assert_eq!(
            serde_json::to_string(&BrowserOAuthProvider::GoogleDrive)?,
            "\"google-drive\""
        );
        assert_eq!(
            serde_json::to_string(&BrowserOAuthProvider::ICloud)?,
            "\"i-cloud\""
        );
        let report = OAuthOriginSupport::Unsupported {
            origin: "https://example.test".to_owned(),
            reason: OAuthOriginUnsupportedReason::CloudflarePrPreview,
        };
        let serialized =
            r#"{"unsupported":{"origin":"https://example.test","reason":"cloudflare-pr-preview"}}"#;
        assert_eq!(serde_json::to_string(&report)?, serialized);
        assert_eq!(
            serde_json::from_str::<OAuthOriginSupport>(serialized)?,
            report
        );
        Ok(())
    }
}
