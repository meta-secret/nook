//! Portable auth-companion heuristics and vault host/OAuth origin policy.
//!
//! Kept free of vault crypto and sync so a tiny companion WASM package can link
//! this crate without the full `nook-core` graph.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

mod backup_code_candidates;
mod oauth_origin_policy;
mod page_field_classification;
mod vault_host_policy;

pub use backup_code_candidates::{extract_backup_code_candidates, page_has_backup_code_hint};
pub use oauth_origin_policy::{
    BrowserOAuthProvider, OAuthOriginSupport, OAuthOriginUnsupportedReason,
    is_cloudflare_pr_preview_host, resolve_oauth_origin_support,
};
pub use page_field_classification::{
    LoginContextObservation, PageInputFieldObservation, PageInputType, expand_identity_text,
    has_login_context, looks_like_email_verification_body, looks_like_manual_checkpoint_label,
    looks_like_one_time_code_field, looks_like_passkey_control_label, looks_like_username_field,
};
pub use vault_host_policy::{
    DEFAULT_SIMPLE_VAULT_URL, VaultHostPolicyError, belongs_to_sentinel_vault,
    belongs_to_simple_vault, is_nook_vault_app_url, is_sentinel_vault_hostname,
    is_simple_vault_hostname, matching_sentinel_vault_base_url,
    nook_vault_app_exclude_match_patterns, normalize_simple_vault_base_url,
    sentinel_vault_match_patterns, simple_vault_match_pattern, simple_vault_url,
};
