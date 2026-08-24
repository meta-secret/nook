//! Thin WASM exports for portable auth-companion heuristics and host policy.

use crate::{NookAuthenticationPageObservation, NookAuthenticationPageObservations};
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
pub fn authentication_form_observation_priority(
    observation: &NookAuthenticationPageObservation,
) -> u8 {
    observation.to_core().form_priority().value()
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
    nook_core::PageInputType::parse(value)
}

#[wasm_bindgen]
#[must_use]
pub fn is_cloudflare_pr_preview_host(hostname: &str) -> bool {
    nook_core::is_cloudflare_pr_preview_host(hostname)
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookOAuthOriginSupport {
    inner: nook_core::OAuthOriginSupport,
}

#[wasm_bindgen]
impl NookOAuthOriginSupport {
    #[wasm_bindgen]
    #[must_use]
    pub fn is_supported(&self) -> bool {
        matches!(
            self.inner,
            nook_core::OAuthOriginSupport::LocationUnavailable
                | nook_core::OAuthOriginSupport::Supported { .. }
        )
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn origin(&self) -> String {
        match &self.inner {
            nook_core::OAuthOriginSupport::LocationUnavailable => String::new(),
            nook_core::OAuthOriginSupport::Supported { origin }
            | nook_core::OAuthOriginSupport::Unsupported { origin, .. } => origin.clone(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_unsupported(&self) -> bool {
        matches!(
            self.inner,
            nook_core::OAuthOriginSupport::Unsupported { .. }
        )
    }

    /// Reason when [`Self::is_unsupported`] is true; otherwise `UnregisteredOrigin`.
    #[wasm_bindgen]
    #[must_use]
    pub fn unsupported_reason(&self) -> nook_core::OAuthOriginUnsupportedReason {
        match self.inner {
            nook_core::OAuthOriginSupport::Unsupported { reason, .. } => reason,
            _ => nook_core::OAuthOriginUnsupportedReason::UnregisteredOrigin,
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
        inner: nook_core::resolve_oauth_origin_support(provider, origin, hostname),
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

    #[test]
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

    #[test]
    fn oauth_origin_and_vault_host_wasm_exports_match_core_policy() {
        let supported = resolve_oauth_origin_support(
            nook_core::BrowserOAuthProvider::GoogleDrive,
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

    #[test]
    fn page_form_wasm_exports_match_core_policy() {
        let otp = NookPageInputFieldObservation::new(
            nook_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "Enter OTP Code".to_owned(),
            false,
        );
        assert!(looks_like_one_time_code_field(&otp));

        let username = NookPageInputFieldObservation::new(
            nook_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "loginfmt".to_owned(),
            false,
        );
        assert!(looks_like_username_field(&username));
        assert!(looks_like_login_advance_control_label("signin"));

        let login =
            NookAuthenticationPageObservation::new(nook_core::AuthenticationPageObservation {
                username_field_count: 1,
                current_password_field_count: 1,
                advance_control: nook_core::AuthenticationAdvanceControlEvidence::Present,
                ..Default::default()
            });
        assert_eq!(authentication_form_observation_priority(&login), 4);
        let mut observations = NookAuthenticationPageObservations::new();
        observations.add(&login);
        assert!(authentication_page_observations_are_valid(&observations));
    }
}
