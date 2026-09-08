//! Thin WASM exports for portable auth-companion heuristics and host policy.

use crate::{NookAuthenticationPageObservation, NookAuthenticationPageObservations};
use nook_core::{OAuthOriginSupport, OAuthOriginUnsupportedReason, PageInputType};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
pub fn page_has_backup_code_hint(text: &str) -> bool {
    nook_core::page_has_backup_code_hint(text)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn extract_backup_code_candidates(text: String) -> Vec<String> {
    nook_core::extract_backup_code_candidates(&text)
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookPageInputFieldObservation {
    inner: nook_core::PageInputFieldObservation,
}

#[wasm_bindgen]
impl NookPageInputFieldObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
    pub fn new(
        input_type: nook_core::PageInputType,
        disabled: bool,
        read_only: bool,
        autocomplete_tokens: Vec<String>,
        identity_text: String,
        login_context: bool,
    ) -> Self {
        Self {
            inner: nook_core::PageInputFieldObservation {
                input_type,
                disabled,
                read_only,
                autocomplete_tokens,
                identity_text,
                login_context,
            },
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn expand_identity_text(value: &str) -> String {
    nook_core::expand_identity_text(value)
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookLoginContextObservation {
    inner: nook_core::LoginContextObservation,
}

#[wasm_bindgen]
impl NookLoginContextObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        form_identity: String,
        ancestor_identities: Vec<String>,
        advance_control_label: String,
        path_context: String,
    ) -> Self {
        Self {
            inner: nook_core::LoginContextObservation {
                form_identity,
                ancestor_identities,
                advance_control_label,
                path_context,
            },
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn has_login_context(observation: &NookLoginContextObservation) -> bool {
    nook_core::has_login_context(&observation.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_username_field(field: &NookPageInputFieldObservation) -> bool {
    nook_core::looks_like_username_field(&field.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_one_time_code_field(field: &NookPageInputFieldObservation) -> bool {
    nook_core::looks_like_one_time_code_field(&field.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_passkey_control_label(label: &str) -> bool {
    nook_core::looks_like_passkey_control_label(label)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_manual_checkpoint_label(label: &str) -> bool {
    nook_core::looks_like_manual_checkpoint_label(label)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_email_verification_body(body: &str) -> bool {
    nook_core::looks_like_email_verification_body(body)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_login_advance_control_label(label: &str) -> bool {
    nook_core::looks_like_login_advance_control_label(label)
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the authentication-form ranking as a JavaScript Number scalar"
    )
)]
pub fn authentication_form_observation_priority(
    observation: &NookAuthenticationPageObservation,
) -> u8 {
    nook_core::authentication_form_observation_priority(observation.to_core()).into()
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_page_observations_are_valid(
    observations: &NookAuthenticationPageObservations,
) -> bool {
    nook_core::authentication_page_observations_are_valid(observations.as_core())
}

#[wasm_bindgen]
#[must_use]
pub fn parse_page_input_type(value: &str) -> nook_core::PageInputType {
    PageInputType::parse(value)
}

#[wasm_bindgen]
#[must_use]
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
pub fn resolve_oauth_origin_support(
    provider: nook_core::BrowserOAuthProvider,
    origin: &str,
    hostname: &str,
) -> NookOAuthOriginSupport {
    let (origin, hostname) = if origin.is_empty() || hostname.is_empty() {
        (None, None)
    } else {
        (Some(origin), Some(hostname))
    };
    NookOAuthOriginSupport {
        inner: provider.origin_support(origin, hostname),
    }
}

#[wasm_bindgen]
#[must_use]
pub fn default_simple_vault_url() -> String {
    nook_core::DEFAULT_SIMPLE_VAULT_URL.to_owned()
}

#[wasm_bindgen]
pub fn normalize_simple_vault_base_url(value: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::normalize_simple_vault_base_url(value)?)
}

#[wasm_bindgen]
pub fn simple_vault_url(base_url: &str, path: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::simple_vault_url(base_url, path)?)
}

#[wasm_bindgen]
pub fn simple_vault_match_pattern(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::simple_vault_match_pattern(base_url)?)
}

/// Matching Sentinel base URL for `base_url`, or an empty string when none matches.
#[wasm_bindgen]
pub fn matching_sentinel_vault_base_url(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::matching_sentinel_vault_base_url(base_url)?.unwrap_or_default())
}

#[wasm_bindgen]
pub fn sentinel_vault_match_patterns(base_url: &str) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(nook_core::sentinel_vault_match_patterns(base_url)?)
}

#[wasm_bindgen]
#[must_use]
pub fn is_simple_vault_hostname(hostname: &str) -> bool {
    nook_core::is_simple_vault_hostname(hostname)
}

#[wasm_bindgen]
#[must_use]
pub fn is_sentinel_vault_hostname(hostname: &str) -> bool {
    nook_core::is_sentinel_vault_hostname(hostname)
}

#[wasm_bindgen]
pub fn nook_vault_app_exclude_match_patterns(
    base_url: &str,
) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(nook_core::nook_vault_app_exclude_match_patterns(base_url)?)
}

/// `base_url` may be empty when no configured vault base is available.
#[wasm_bindgen]
pub fn is_nook_vault_app_url(
    candidate_url: &str,
    base_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    let base_url = if base_url.is_empty() {
        None
    } else {
        Some(base_url)
    };
    Ok(nook_core::is_nook_vault_app_url(candidate_url, base_url)?)
}

#[wasm_bindgen]
pub fn belongs_to_simple_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(nook_core::belongs_to_simple_vault(base_url, candidate_url)?)
}

#[wasm_bindgen]
pub fn belongs_to_sentinel_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(nook_core::belongs_to_sentinel_vault(
        base_url,
        candidate_url,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::BrowserOAuthProvider;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn backup_code_wasm_exports_match_core_policy() {
        let text = [
            "Save your backup codes",
            "A1B2-C3D4-E5F6",
            "This sentence should not become a code.",
        ]
        .join("\n");
        assert!(page_has_backup_code_hint(&text));
        assert_eq!(
            extract_backup_code_candidates(text),
            vec!["A1B2-C3D4-E5F6".to_owned()]
        );
    }

    #[wasm_bindgen_test]
    fn oauth_origin_wasm_projection_preserves_missing_and_rejected_locations() {
        for (origin, hostname) in [("", "simple.nokey.sh"), ("https://simple.nokey.sh", "")] {
            let report =
                resolve_oauth_origin_support(BrowserOAuthProvider::GoogleDrive, origin, hostname);
            assert!(report.is_supported());
            assert!(!report.is_unsupported());
            assert_eq!(report.origin(), String::new());
            assert_eq!(
                report.unsupported_reason(),
                OAuthOriginUnsupportedReason::UnregisteredOrigin
            );
        }
        let origin = "https://pr-7.nokey-simple.pages.dev";
        let report = resolve_oauth_origin_support(
            BrowserOAuthProvider::ICloud,
            origin,
            "PR-7.NOKEY-SIMPLE.PAGES.DEV",
        );
        assert!(!report.is_supported());
        assert!(report.is_unsupported());
        assert_eq!(report.origin(), origin);
        assert_eq!(
            report.unsupported_reason(),
            OAuthOriginUnsupportedReason::CloudflarePrPreview
        );
        assert!(is_cloudflare_pr_preview_host("PR-7.NOKEY-SIMPLE.PAGES.DEV"));
        assert!(!is_cloudflare_pr_preview_host(
            "pr-7.nokey-simple.pages.dev.evil.test"
        ));
    }

    #[wasm_bindgen_test]
    fn oauth_origin_and_vault_host_wasm_exports_match_core_policy() {
        let supported = resolve_oauth_origin_support(
            BrowserOAuthProvider::GoogleDrive,
            "https://simple.nokey.sh",
            "simple.nokey.sh",
        );
        assert!(supported.is_supported());
        assert!(!supported.is_unsupported());

        assert!(is_simple_vault_hostname("simple.dev.nokey.sh"));
        assert!(is_sentinel_vault_hostname("sentinel.nokey.sh"));
        match normalize_simple_vault_base_url("https://simple.nokey.sh") {
            Ok(normalized) => assert_eq!(normalized, "https://simple.nokey.sh/"),
            Err(error) => panic!("normalize failed: {error:?}"),
        }
    }

    #[wasm_bindgen_test]
    fn page_form_wasm_exports_match_core_policy() {
        let otp = NookPageInputFieldObservation::new(
            PageInputType::Text,
            false,
            false,
            Vec::new(),
            "Enter OTP Code".to_owned(),
            false,
        );
        assert!(looks_like_one_time_code_field(&otp));

        let username = NookPageInputFieldObservation::new(
            PageInputType::Text,
            false,
            false,
            Vec::new(),
            "loginfmt".to_owned(),
            false,
        );
        assert!(looks_like_username_field(&username));
        assert!(looks_like_login_advance_control_label("signin"));

        let login =
            NookAuthenticationPageObservation::new(1, 1, 0, 0, 0, false, false, false, false, 0);
        assert_eq!(authentication_form_observation_priority(&login), 4);
        let mut observations = NookAuthenticationPageObservations::new();
        observations.add(&login);
        assert!(authentication_page_observations_are_valid(&observations));
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::BrowserOAuthProvider;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn companion_heuristic_exports_cover_policy_and_url_paths_in_wasm() {
        assert!(page_has_backup_code_hint("backup code"));
        assert!(!page_has_backup_code_hint("nothing useful"));
        let candidates =
            extract_backup_code_candidates("Save your backup codes\nA1B2-C3D4-E5F6\nignore".into());
        assert!(!candidates.is_empty());
        assert_eq!(expand_identity_text("  Login  "), "login");

        for field in [
            NookPageInputFieldObservation::new(
                PageInputType::Email,
                false,
                false,
                vec!["username".into()],
                "Email address".into(),
                true,
            ),
            NookPageInputFieldObservation::new(
                PageInputType::Text,
                false,
                false,
                vec!["one-time-code".into()],
                "verification code".into(),
                false,
            ),
            NookPageInputFieldObservation::new(
                PageInputType::Password,
                true,
                true,
                Vec::new(),
                String::new(),
                false,
            ),
        ] {
            let _ = looks_like_username_field(&field);
            let _ = looks_like_one_time_code_field(&field);
        }
        let context = NookLoginContextObservation::new(
            "login-form".into(),
            vec!["account".into()],
            "Continue".into(),
            "/login".into(),
        );
        assert!(has_login_context(&context));
        for label in ["Use a passkey", "Continue", "Verify manually", "Sign in"] {
            let _ = looks_like_passkey_control_label(label);
            let _ = looks_like_manual_checkpoint_label(label);
            let _ = looks_like_login_advance_control_label(label);
        }
        let _ = looks_like_email_verification_body("check your email for a code");
        for input_type in ["text", "email", "password", "unknown"] {
            let _ = parse_page_input_type(input_type);
        }

        let observation =
            NookAuthenticationPageObservation::new(1, 1, 1, 0, 0, true, false, false, false, 0);
        assert!(authentication_form_observation_priority(&observation) > 0);
        let mut observations = NookAuthenticationPageObservations::new();
        observations.add(&observation);
        let _ = authentication_page_observations_are_valid(&observations);

        for (provider, origin, host) in [
            (
                BrowserOAuthProvider::GoogleDrive,
                "https://simple.nokey.sh",
                "simple.nokey.sh",
            ),
            (
                BrowserOAuthProvider::ICloud,
                "https://pr-7.nokey-simple.pages.dev",
                "pr-7.nokey-simple.pages.dev",
            ),
        ] {
            let support = resolve_oauth_origin_support(provider, origin, host);
            let _ = support.is_supported();
            let _ = support.is_unsupported();
            let _ = support.origin();
            let _ = support.unsupported_reason();
        }
        assert!(is_cloudflare_pr_preview_host("pr-7.nokey-simple.pages.dev"));
        assert_eq!(
            default_simple_vault_url(),
            nook_core::DEFAULT_SIMPLE_VAULT_URL
        );
        let base = "https://simple.nokey.sh/";
        let _ = normalize_simple_vault_base_url(base).unwrap();
        let _ = simple_vault_url(base, "events.json").unwrap();
        let _ = simple_vault_match_pattern(base).unwrap();
        let _ = matching_sentinel_vault_base_url(base).unwrap();
        let _ = sentinel_vault_match_patterns(base).unwrap();
        let _ = nook_vault_app_exclude_match_patterns(base).unwrap();
        let _ = is_nook_vault_app_url("https://simple.nokey.sh/", base).unwrap();
        let _ = belongs_to_simple_vault(base, "https://simple.nokey.sh/events.json").unwrap();
        let _ = belongs_to_sentinel_vault(base, "https://simple.nokey.sh/events.json").unwrap();
    }
}
