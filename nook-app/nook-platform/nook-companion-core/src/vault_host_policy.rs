//! Product identity for Simple/Sentinel vault app hosts and URL matching.
//!
//! Extension Manifest wiring stays in the host. Hostname classification,
//! base-URL normalization, and exclude-match construction live here.

/// Configured vault base URL used for host and manifest policy.
pub struct VaultHostPolicy<'a> {
    base_url: &'a str,
}
impl<'a> VaultHostPolicy<'a> {
    pub fn new(base_url: &'a str) -> Self {
        Self { base_url }
    }
    fn as_str(&self) -> &'a str {
        self.base_url
    }
}
/// Browser URL or hostname evidence classified without retaining browser capabilities.
pub struct VaultHostObservation<'a> {
    value: &'a str,
}
impl<'a> VaultHostObservation<'a> {
    pub fn new(value: &'a str) -> Self {
        Self { value }
    }
    fn as_str(&self) -> &'a str {
        self.value
    }
}
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
impl VaultHostPolicy<'_> {
    pub fn normalize_simple_vault_base_url(&self) -> Result<String, VaultHostPolicyError> {
        let value = self.as_str();
        let mut url = Url::parse(value)
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
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
}

/// Join a path onto a normalized Simple Vault base URL.
impl VaultHostPolicy<'_> {
    pub fn simple_vault_url(&self, path: &str) -> Result<String, VaultHostPolicyError> {
        let base_url = self.as_str();
        let normalized = VaultHostPolicy::new(base_url).normalize_simple_vault_base_url()?;
        let base = Url::parse(&normalized)
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
        let trimmed = path.trim_start_matches('/');
        Ok(base
            .join(trimmed)
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?
            .to_string())
    }
}

/// Manifest-style match pattern for a Simple Vault base URL.
impl VaultHostPolicy<'_> {
    pub fn simple_vault_match_pattern(&self) -> Result<String, VaultHostPolicyError> {
        let base_url = self.as_str();
        let normalized = VaultHostPolicy::new(base_url).normalize_simple_vault_base_url()?;
        let url = Url::parse(&normalized)
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
        Ok(format!(
            "{}{}*",
            url.origin().ascii_serialization(),
            url.path()
        ))
    }
}

/// Matching Sentinel base URL for a Simple Vault URL, when one can be derived.
impl VaultHostPolicy<'_> {
    pub fn matching_sentinel_vault_base_url(&self) -> Result<Option<String>, VaultHostPolicyError> {
        let base_url = self.as_str();
        let normalized = VaultHostPolicy::new(base_url).normalize_simple_vault_base_url()?;
        let url = Url::parse(&normalized)
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
        let host = url.host_str().unwrap_or_default();
        if let Some(rest) = host.strip_prefix("simple.") {
            return Ok(Some(format!("{}://sentinel.{}/", url.scheme(), rest)));
        }
        if host.contains(".nokey-simple.pages.dev") {
            let sentinel_host =
                host.replace(".nokey-simple.pages.dev", ".nokey-sentinel.pages.dev");
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
}

/// Sentinel match patterns for a configured Simple Vault base URL.
impl VaultHostPolicy<'_> {
    pub fn sentinel_vault_match_patterns(&self) -> Result<Vec<String>, VaultHostPolicyError> {
        let base_url = self.as_str();
        let mut matches = vec!["https://sentinel.nokey.sh/*".to_owned()];
        if let Some(matching) = VaultHostPolicy::new(base_url).matching_sentinel_vault_base_url()? {
            matches.push(format!("{matching}*"));
        }
        matches.sort();
        matches.dedup();
        Ok(matches)
    }
}

/// True for Simple Vault hostnames (production, env, and Pages).
impl VaultHostObservation<'_> {
    #[must_use]
    pub fn is_simple_vault_hostname(&self) -> bool {
        let hostname = self.as_str();
        let host = hostname.to_ascii_lowercase();
        if host == "simple.nokey.sh" {
            return true;
        }
        if host.starts_with("simple.") && host.ends_with(".nokey.sh") {
            return true;
        }
        host.ends_with(".nokey-simple.pages.dev")
    }
}

/// True for Sentinel Vault hostnames (production, env, and Pages).
impl VaultHostObservation<'_> {
    #[must_use]
    pub fn is_sentinel_vault_hostname(&self) -> bool {
        let hostname = self.as_str();
        let host = hostname.to_ascii_lowercase();
        if host == "sentinel.nokey.sh" {
            return true;
        }
        if host.starts_with("sentinel.") && host.ends_with(".nokey.sh") {
            return true;
        }
        host.ends_with(".nokey-sentinel.pages.dev")
    }
}

/// Autofill / website-WebAuthn exclusions for Simple and Sentinel hosts.
impl VaultHostPolicy<'_> {
    pub fn nook_vault_app_exclude_match_patterns(
        &self,
    ) -> Result<Vec<String>, VaultHostPolicyError> {
        let base_url = self.as_str();
        let mut patterns: Vec<String> = NOOK_VAULT_APP_EXCLUDE_MATCH_PATTERNS
            .iter()
            .map(|pattern| (*pattern).to_owned())
            .collect();
        patterns.push(VaultHostPolicy::new(base_url).simple_vault_match_pattern()?);
        patterns.extend(VaultHostPolicy::new(base_url).sentinel_vault_match_patterns()?);
        patterns.sort();
        patterns.dedup();
        Ok(patterns)
    }
}

/// True when `candidate_url` is a Nook vault app URL.
impl VaultHostObservation<'_> {
    pub fn is_nook_vault_app_url(
        &self,
        base_url: Option<&str>,
    ) -> Result<bool, VaultHostPolicyError> {
        let candidate_url = self.as_str();
        let url = Url::parse(candidate_url)
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
        let host = url.host_str().unwrap_or_default();
        if VaultHostObservation::new(host).is_simple_vault_hostname()
            || VaultHostObservation::new(host).is_sentinel_vault_hostname()
        {
            return Ok(true);
        }
        let Some(base_url) = base_url else {
            return Ok(false);
        };
        Ok(
            VaultHostPolicy::new(base_url).belongs_to_simple_vault(candidate_url)?
                || VaultHostPolicy::new(base_url).belongs_to_sentinel_vault(candidate_url)?,
        )
    }
}

/// True when `candidate_url` is under the Simple Vault base.
impl VaultHostPolicy<'_> {
    pub fn belongs_to_simple_vault(
        &self,
        candidate_url: &str,
    ) -> Result<bool, VaultHostPolicyError> {
        let base_url = self.as_str();
        let base = Url::parse(&VaultHostPolicy::new(base_url).normalize_simple_vault_base_url()?)
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
        let candidate = Url::parse(candidate_url)
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
        Ok(candidate.origin() == base.origin() && candidate.path().starts_with(base.path()))
    }
}

/// True when `candidate_url` matches a Sentinel pattern for the Simple base.
impl VaultHostPolicy<'_> {
    pub fn belongs_to_sentinel_vault(
        &self,
        candidate_url: &str,
    ) -> Result<bool, VaultHostPolicyError> {
        let base_url = self.as_str();
        Ok(VaultHostPolicy::new(base_url)
            .sentinel_vault_match_patterns()?
            .into_iter()
            .any(|pattern| {
                let prefix = pattern.trim_end_matches('*');
                candidate_url.starts_with(prefix)
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_matches_simple_and_sentinel_hosts() -> anyhow::Result<()> {
        assert_eq!(
            VaultHostPolicy::new("https://simple.nokey.sh").normalize_simple_vault_base_url()?,
            "https://simple.nokey.sh/"
        );
        assert!(VaultHostObservation::new("simple.dev.nokey.sh").is_simple_vault_hostname());
        assert!(VaultHostObservation::new("sentinel.nokey.sh").is_sentinel_vault_hostname());
        assert_eq!(
            VaultHostPolicy::new("https://simple.nokey.sh/").matching_sentinel_vault_base_url()?,
            Some("https://sentinel.nokey.sh/".to_owned())
        );
        assert!(
            VaultHostPolicy::new("https://simple.nokey.sh/")
                .belongs_to_simple_vault("https://simple.nokey.sh/app")?
        );
        assert!(
            VaultHostObservation::new("https://sentinel.dev.nokey.sh/")
                .is_nook_vault_app_url(Some("https://simple.dev.nokey.sh/"))?
        );
        assert!(matches!(
            VaultHostPolicy::new("http://example.com/").normalize_simple_vault_base_url(),
            Err(VaultHostPolicyError::InsecureNonLocalhost)
        ));
        Ok(())
    }
}
