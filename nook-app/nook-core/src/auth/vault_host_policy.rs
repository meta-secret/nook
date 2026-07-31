//! Product identity for Simple/Sentinel vault app hosts and URL matching.
//!
//! Extension Manifest wiring stays in the host. Hostname classification,
//! base-URL normalization, and exclude-match construction live here.

use thiserror::Error;
use url::Url;

/// Default production Simple Vault base URL.
pub const DEFAULT_SIMPLE_VAULT_URL: &str = "https://simple.nokey.sh/";

/// Channel-agnostic match patterns for every Simple/Sentinel Nook host.
const NOOK_VAULT_APP_EXCLUDE_MATCH_PATTERNS: &[&str] = &[
    "https://simple.nokey.sh/*",
    "https://simple.dev.nokey.sh/*",
    "https://sentinel.nokey.sh/*",
    "https://sentinel.dev.nokey.sh/*",
    "https://*.nokey-simple.pages.dev/*",
    "https://*.nokey-sentinel.pages.dev/*",
];

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum VaultHostPolicyError {
    #[error("The Simple Vault URL must use HTTPS, except for localhost development.")]
    InsecureNonLocalhost,
    #[error("invalid vault URL: {0}")]
    InvalidUrl(String),
}

/// Normalize a Simple Vault base URL (trailing slash, no hash/query).
pub fn normalize_simple_vault_base_url(value: &str) -> Result<String, VaultHostPolicyError> {
    let mut url =
        Url::parse(value).map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
    let local_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "https" && !local_http {
        return Err(VaultHostPolicyError::InsecureNonLocalhost);
    }
    url.set_fragment(None);
    url.set_query(None);
    let mut path = url.path().trim_end_matches('/').to_owned();
    path.push('/');
    url.set_path(&path);
    Ok(url.to_string())
}

/// Join a path onto a normalized Simple Vault base URL.
pub fn simple_vault_url(base_url: &str, path: &str) -> Result<String, VaultHostPolicyError> {
    let normalized = normalize_simple_vault_base_url(base_url)?;
    let base = Url::parse(&normalized)
        .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
    let trimmed = path.trim_start_matches('/');
    Ok(base
        .join(trimmed)
        .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?
        .to_string())
}

/// Manifest-style match pattern for a Simple Vault base URL.
pub fn simple_vault_match_pattern(base_url: &str) -> Result<String, VaultHostPolicyError> {
    let normalized = normalize_simple_vault_base_url(base_url)?;
    let url = Url::parse(&normalized)
        .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
    Ok(format!(
        "{}{}*",
        url.origin().ascii_serialization(),
        url.path()
    ))
}

/// Matching Sentinel base URL for a Simple Vault URL, when one can be derived.
pub fn matching_sentinel_vault_base_url(
    base_url: &str,
) -> Result<Option<String>, VaultHostPolicyError> {
    let normalized = normalize_simple_vault_base_url(base_url)?;
    let url = Url::parse(&normalized)
        .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
    let host = url.host_str().unwrap_or_default();
    if let Some(rest) = host.strip_prefix("simple.") {
        return Ok(Some(format!("{}://sentinel.{}/", url.scheme(), rest)));
    }
    if host.contains(".nokey-simple.pages.dev") {
        let sentinel_host = host.replace(".nokey-simple.pages.dev", ".nokey-sentinel.pages.dev");
        return Ok(Some(format!("{}://{}/", url.scheme(), sentinel_host)));
    }
    if let Some(prefix) = url.path().strip_suffix("/simple/") {
        let sentinel_path = format!("{prefix}/sentinel/");
        return Ok(Some(format!(
            "{}{}",
            url.origin().ascii_serialization(),
            sentinel_path
        )));
    }
    Ok(None)
}

/// Sentinel match patterns for a configured Simple Vault base URL.
pub fn sentinel_vault_match_patterns(base_url: &str) -> Result<Vec<String>, VaultHostPolicyError> {
    let mut matches = vec!["https://sentinel.nokey.sh/*".to_owned()];
    if let Some(matching) = matching_sentinel_vault_base_url(base_url)? {
        matches.push(format!("{matching}*"));
    }
    matches.sort();
    matches.dedup();
    Ok(matches)
}

/// True for Simple Vault hostnames (production, env, and Pages).
#[must_use]
pub fn is_simple_vault_hostname(hostname: &str) -> bool {
    let host = hostname.to_ascii_lowercase();
    if host == "simple.nokey.sh" {
        return true;
    }
    if host.starts_with("simple.") && host.ends_with(".nokey.sh") {
        return true;
    }
    host.ends_with(".nokey-simple.pages.dev")
}

/// True for Sentinel Vault hostnames (production, env, and Pages).
#[must_use]
pub fn is_sentinel_vault_hostname(hostname: &str) -> bool {
    let host = hostname.to_ascii_lowercase();
    if host == "sentinel.nokey.sh" {
        return true;
    }
    if host.starts_with("sentinel.") && host.ends_with(".nokey.sh") {
        return true;
    }
    host.ends_with(".nokey-sentinel.pages.dev")
}

/// Autofill / website-WebAuthn exclusions for Simple and Sentinel hosts.
pub fn nook_vault_app_exclude_match_patterns(
    base_url: &str,
) -> Result<Vec<String>, VaultHostPolicyError> {
    let mut patterns: Vec<String> = NOOK_VAULT_APP_EXCLUDE_MATCH_PATTERNS
        .iter()
        .map(|pattern| (*pattern).to_owned())
        .collect();
    patterns.push(simple_vault_match_pattern(base_url)?);
    patterns.extend(sentinel_vault_match_patterns(base_url)?);
    patterns.sort();
    patterns.dedup();
    Ok(patterns)
}

/// True when `candidate_url` is a Nook vault app URL.
pub fn is_nook_vault_app_url(
    candidate_url: &str,
    base_url: Option<&str>,
) -> Result<bool, VaultHostPolicyError> {
    let url = Url::parse(candidate_url)
        .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
    let host = url.host_str().unwrap_or_default();
    if is_simple_vault_hostname(host) || is_sentinel_vault_hostname(host) {
        return Ok(true);
    }
    let Some(base_url) = base_url else {
        return Ok(false);
    };
    Ok(belongs_to_simple_vault(base_url, candidate_url)?
        || belongs_to_sentinel_vault(base_url, candidate_url)?)
}

/// True when `candidate_url` is under the Simple Vault base.
pub fn belongs_to_simple_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, VaultHostPolicyError> {
    let base = Url::parse(&normalize_simple_vault_base_url(base_url)?)
        .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
    let candidate = Url::parse(candidate_url)
        .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
    Ok(candidate.origin() == base.origin() && candidate.path().starts_with(base.path()))
}

/// True when `candidate_url` matches a Sentinel pattern for the Simple base.
pub fn belongs_to_sentinel_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, VaultHostPolicyError> {
    Ok(sentinel_vault_match_patterns(base_url)?
        .into_iter()
        .any(|pattern| {
            let prefix = pattern.trim_end_matches('*');
            candidate_url.starts_with(prefix)
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_matches_simple_and_sentinel_hosts() -> anyhow::Result<()> {
        assert_eq!(
            normalize_simple_vault_base_url("https://simple.nokey.sh")?,
            "https://simple.nokey.sh/"
        );
        assert!(is_simple_vault_hostname("simple.dev.nokey.sh"));
        assert!(is_sentinel_vault_hostname("sentinel.nokey.sh"));
        assert_eq!(
            matching_sentinel_vault_base_url("https://simple.nokey.sh/")?,
            Some("https://sentinel.nokey.sh/".to_owned())
        );
        assert!(belongs_to_simple_vault(
            "https://simple.nokey.sh/",
            "https://simple.nokey.sh/app"
        )?);
        assert!(is_nook_vault_app_url(
            "https://sentinel.dev.nokey.sh/",
            Some("https://simple.dev.nokey.sh/")
        )?);
        assert!(matches!(
            normalize_simple_vault_base_url("http://example.com/"),
            Err(VaultHostPolicyError::InsecureNonLocalhost)
        ));
        Ok(())
    }
}
