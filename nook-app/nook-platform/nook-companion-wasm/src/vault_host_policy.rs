use nook_companion_core::{
    BrowserOAuthLocation, BrowserOAuthLocationEvidence, OAuthOriginSupport,
    OAuthOriginUnsupportedReason, SentinelVaultMatch, VaultAppBaseSelection, VaultHostObservation,
    VaultHostPolicy,
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_cloudflare_pr_preview_host(hostname: &str) -> bool {
    OAuthOriginUnsupportedReason::for_unregistered_hostname(hostname)
        == OAuthOriginUnsupportedReason::CloudflarePrPreview
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookOAuthOriginSupport {
    inner: OAuthOriginSupport,
}

#[wasm_bindgen]
impl NookOAuthOriginSupport {
    #[wasm_bindgen]
    #[must_use]
    pub fn is_supported(&self) -> bool {
        matches!(
            self.inner,
            OAuthOriginSupport::LocationUnavailable | OAuthOriginSupport::Supported { .. }
        )
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn origin(&self) -> String {
        match &self.inner {
            OAuthOriginSupport::LocationUnavailable => String::new(),
            OAuthOriginSupport::Supported { origin }
            | OAuthOriginSupport::Unsupported { origin, .. } => origin.clone(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_unsupported(&self) -> bool {
        matches!(self.inner, OAuthOriginSupport::Unsupported { .. })
    }

    /// Reason when [`Self::is_unsupported`] is true; otherwise `UnregisteredOrigin`.
    #[wasm_bindgen]
    #[must_use]
    pub fn unsupported_reason(&self) -> OAuthOriginUnsupportedReason {
        match self.inner {
            OAuthOriginSupport::Unsupported { reason, .. } => reason,
            _ => OAuthOriginUnsupportedReason::UnregisteredOrigin,
        }
    }
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn resolve_oauth_origin_support(
    provider: nook_companion_core::BrowserOAuthProvider,
    origin: &str,
    hostname: &str,
) -> NookOAuthOriginSupport {
    let location = if origin.is_empty() || hostname.is_empty() {
        BrowserOAuthLocation::Unavailable
    } else {
        BrowserOAuthLocation::Observed(BrowserOAuthLocationEvidence { origin, hostname })
    };
    NookOAuthOriginSupport {
        inner: provider.origin_support(location),
    }
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn default_simple_vault_url() -> String {
    nook_companion_core::DEFAULT_SIMPLE_VAULT_URL.to_owned()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn normalize_simple_vault_base_url(value: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(value).normalize_simple_vault_base_url()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn simple_vault_url(base_url: &str, path: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).simple_vault_url(path)?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn simple_vault_match_pattern(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).simple_vault_match_pattern()?)
}

/// Matching Sentinel base URL for `base_url`, or an empty string when none matches.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn matching_sentinel_vault_base_url(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(
        match VaultHostPolicy::new(base_url).matching_sentinel_vault_base_url()? {
            SentinelVaultMatch::UnsupportedHost => String::new(),
            SentinelVaultMatch::MatchingBaseUrl(url) => url,
        },
    )
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn sentinel_vault_match_patterns(base_url: &str) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).sentinel_vault_match_patterns()?)
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_simple_vault_hostname(hostname: &str) -> bool {
    VaultHostObservation::new(hostname).is_simple_vault_hostname()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_sentinel_vault_hostname(hostname: &str) -> bool {
    VaultHostObservation::new(hostname).is_sentinel_vault_hostname()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn nook_vault_app_exclude_match_patterns(
    base_url: &str,
) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).nook_vault_app_exclude_match_patterns()?)
}

/// `base_url` may be empty when no configured vault base is available.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_nook_vault_app_url(
    candidate_url: &str,
    base_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    let base_url = if base_url.is_empty() {
        VaultAppBaseSelection::KnownNookHosts
    } else {
        VaultAppBaseSelection::Configured(base_url)
    };
    Ok(VaultHostObservation::new(candidate_url).is_nook_vault_app_url(base_url)?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn belongs_to_simple_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).belongs_to_simple_vault(candidate_url)?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn belongs_to_sentinel_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).belongs_to_sentinel_vault(candidate_url)?)
}
