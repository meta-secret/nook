//! Product policy for browser OAuth authorized origins.
//!
//! Host adapters pass the current origin/hostname; this module decides whether
//! Google Drive or iCloud OAuth may run on that origin.

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
    Supported { origin: String },
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

/// True for Cloudflare Pages PR preview hostnames used by Nook deployments.
#[must_use]
pub fn is_cloudflare_pr_preview_host(hostname: &str) -> bool {
    let host = hostname.to_ascii_lowercase();
    let Some(rest) = host.strip_prefix("pr-") else {
        return false;
    };
    let Some((digits, suffix)) = rest.split_once('.') else {
        return false;
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    matches!(
        suffix,
        "nook-1n8.pages.dev"
            | "nokey-sh.pages.dev"
            | "nokey-simple.pages.dev"
            | "nokey-sentinel.pages.dev"
    )
}

/// Resolve whether browser OAuth for `provider` may run at `origin`/`hostname`.
#[must_use]
pub fn resolve_oauth_origin_support(
    provider: BrowserOAuthProvider,
    origin: Option<&str>,
    hostname: Option<&str>,
) -> OAuthOriginSupport {
    let (Some(origin), Some(hostname)) = (origin, hostname) else {
        return OAuthOriginSupport::LocationUnavailable;
    };
    if is_authorized_origin(provider, origin) {
        return OAuthOriginSupport::Supported {
            origin: origin.to_owned(),
        };
    }
    OAuthOriginSupport::Unsupported {
        origin: origin.to_owned(),
        reason: if is_cloudflare_pr_preview_host(hostname) {
            OAuthOriginUnsupportedReason::CloudflarePrPreview
        } else {
            OAuthOriginUnsupportedReason::UnregisteredOrigin
        },
    }
}

fn is_authorized_origin(provider: BrowserOAuthProvider, origin: &str) -> bool {
    let origins = match provider {
        BrowserOAuthProvider::ICloud => ICLOUD_AUTHORIZED_ORIGINS,
        BrowserOAuthProvider::GoogleDrive => GOOGLE_AUTHORIZED_ORIGINS,
    };
    origins.contains(&origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_registered_origins_and_rejects_preview_hosts() -> anyhow::Result<()> {
        assert!(matches!(
            resolve_oauth_origin_support(
                BrowserOAuthProvider::GoogleDrive,
                Some("https://simple.nokey.sh"),
                Some("simple.nokey.sh"),
            ),
            OAuthOriginSupport::Supported { .. }
        ));
        assert!(matches!(
            resolve_oauth_origin_support(
                BrowserOAuthProvider::ICloud,
                Some("http://localhost:5173"),
                Some("localhost"),
            ),
            OAuthOriginSupport::Unsupported {
                reason: OAuthOriginUnsupportedReason::UnregisteredOrigin,
                ..
            }
        ));
        let preview = resolve_oauth_origin_support(
            BrowserOAuthProvider::GoogleDrive,
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
        assert!(is_cloudflare_pr_preview_host("pr-99.nook-1n8.pages.dev"));
        assert!(!is_cloudflare_pr_preview_host("simple.nokey.sh"));
        Ok(())
    }
}
