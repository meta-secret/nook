//! Product identity for Simple/Sentinel vault app hosts and URL matching.
//!
//! Extension Manifest wiring stays in the host. Hostname classification,
//! base-URL normalization, and exclude-match construction live here.

/// Configured vault base URL used for host and manifest policy.
pub struct VaultHostPolicy<'a> {
    base_url: &'a str,
}
impl<'a> VaultHostPolicy<'a> {
    #[must_use]
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
    #[must_use]
    pub fn new(value: &'a str) -> Self {
        Self { value }
    }
    fn as_str(&self) -> &'a str {
        self.value
    }
}
use thiserror::Error;
use url::Url;

use crate::simple_vault_target::{
    KnownSimpleVault, SimpleVaultBaseUrl, SimpleVaultHost, SimpleVaultTarget,
};

/// Default production Simple Vault base URL.
pub const DEFAULT_SIMPLE_VAULT_URL: &str = KnownSimpleVault::DEFAULT.base_url();

/// Channel-agnostic match patterns for every Simple/Sentinel Nook host.
const NOOK_VAULT_APP_EXCLUDE_MATCH_PATTERNS: &[&str] = &[
    "https://simple.nokey.sh/*",
    "https://simple.meta-secret.io/*",
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
    #[error("The Simple Vault URL must not contain a username or password.")]
    EmbeddedCredentials,
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
        match (url.username(), url.password()) {
            ("", None) => {}
            _ => return Err(VaultHostPolicyError::EmbeddedCredentials),
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SentinelVaultMatch {
    UnsupportedHost,
    MatchingBaseUrl(String),
}
#[derive(Clone, Copy)]
pub enum VaultAppBaseSelection<'a> {
    KnownNookHosts,
    Configured(&'a str),
}
/// Matching Sentinel base URL for a Simple Vault URL, when one can be derived.
///
/// A known Simple vault uses its own Sentinel; another base derives one from
/// its host or path.
impl VaultHostPolicy<'_> {
    pub fn matching_sentinel_vault_base_url(
        &self,
    ) -> Result<SentinelVaultMatch, VaultHostPolicyError> {
        match SimpleVaultTarget::from(SimpleVaultBaseUrl::try_from(self.as_str())?) {
            SimpleVaultTarget::Known(known) => Ok(known.sentinel_vault_match()),
            SimpleVaultTarget::ExplicitUrl(base_url) => base_url.derived_sentinel_vault_match(),
        }
    }
}

/// Sentinel base URL derived from a Simple host prefix, Pages project, or path.
impl SimpleVaultBaseUrl {
    fn derived_sentinel_vault_match(&self) -> Result<SentinelVaultMatch, VaultHostPolicyError> {
        let url = Url::parse(self.as_str())
            .map_err(|error| VaultHostPolicyError::InvalidUrl(error.to_string()))?;
        let host = url.host_str().unwrap_or_default();
        if let Some(rest) = host.strip_prefix("simple.") {
            return Ok(SentinelVaultMatch::MatchingBaseUrl(format!(
                "{}://sentinel.{}/",
                url.scheme(),
                rest
            )));
        }
        if host.contains(".nokey-simple.pages.dev") {
            let sentinel_host =
                host.replace(".nokey-simple.pages.dev", ".nokey-sentinel.pages.dev");
            return Ok(SentinelVaultMatch::MatchingBaseUrl(format!(
                "{}://{}/",
                url.scheme(),
                sentinel_host
            )));
        }
        if let Some(prefix) = url.path().strip_suffix("/simple/") {
            let sentinel_path = format!("{prefix}/sentinel/");
            return Ok(SentinelVaultMatch::MatchingBaseUrl(format!(
                "{}{}",
                url.origin().ascii_serialization(),
                sentinel_path
            )));
        }
        Ok(SentinelVaultMatch::UnsupportedHost)
    }
}

/// Sentinel match patterns for a configured Simple Vault base URL.
impl VaultHostPolicy<'_> {
    pub fn sentinel_vault_match_patterns(&self) -> Result<Vec<String>, VaultHostPolicyError> {
        let base_url = self.as_str();
        let mut matches = vec!["https://sentinel.nokey.sh/*".to_owned()];
        if let SentinelVaultMatch::MatchingBaseUrl(matching) =
            VaultHostPolicy::new(base_url).matching_sentinel_vault_base_url()?
        {
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
        if host == "simple.nokey.sh" || host == "simple.meta-secret.io" {
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

/// Nook vault application named by an observed hostname.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VaultAppHostname {
    Simple,
    Sentinel,
    Unrelated,
}

/// Named Simple vault deployment that serves this hostname.
impl VaultHostObservation<'_> {
    #[must_use]
    pub fn simple_vault_host(&self) -> SimpleVaultHost {
        SimpleVaultHost::for_hostname(self.as_str())
    }
}

/// Named outcome of the Simple and Sentinel hostname predicates.
impl VaultHostObservation<'_> {
    /// A trailing DNS root dot names the same host, as in Chrome match patterns.
    #[must_use]
    pub(crate) fn vault_app_hostname(&self) -> VaultAppHostname {
        let hostname = VaultHostObservation::new(self.as_str().trim_end_matches('.'));
        match (
            hostname.is_simple_vault_hostname(),
            hostname.is_sentinel_vault_hostname(),
        ) {
            (true, _) => VaultAppHostname::Simple,
            (false, true) => VaultAppHostname::Sentinel,
            (false, false) => VaultAppHostname::Unrelated,
        }
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
        base_url: VaultAppBaseSelection<'_>,
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
        let VaultAppBaseSelection::Configured(base_url) = base_url else {
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
            SentinelVaultMatch::MatchingBaseUrl("https://sentinel.nokey.sh/".to_owned())
        );
        assert!(
            VaultHostPolicy::new("https://simple.nokey.sh/")
                .belongs_to_simple_vault("https://simple.nokey.sh/app")?
        );
        assert!(
            VaultHostObservation::new("https://sentinel.dev.nokey.sh/").is_nook_vault_app_url(
                VaultAppBaseSelection::Configured("https://simple.dev.nokey.sh/")
            )?
        );
        assert!(matches!(
            VaultHostPolicy::new("http://example.com/").normalize_simple_vault_base_url(),
            Err(VaultHostPolicyError::InsecureNonLocalhost)
        ));
        Ok(())
    }

    #[test]
    fn simple_vault_base_urls_with_userinfo_are_rejected() {
        for base in [
            "https://u:p@simple.meta-secret.io/",
            "https://u@simple.nokey.sh/",
            "https://:p@simple.nokey.sh/",
            "http://u:p@127.0.0.1:5174/",
        ] {
            assert_eq!(
                VaultHostPolicy::new(base).normalize_simple_vault_base_url(),
                Err(VaultHostPolicyError::EmbeddedCredentials),
                "{base}"
            );
        }
    }

    struct VaultAppHostnameCase {
        hostname: &'static str,
        expected: VaultAppHostname,
    }

    #[test]
    fn vault_app_hostname_names_simple_sentinel_and_unrelated_hosts() {
        for case in [
            VaultAppHostnameCase {
                hostname: "simple.nokey.sh",
                expected: VaultAppHostname::Simple,
            },
            VaultAppHostnameCase {
                hostname: "SIMPLE.DEV.NOKEY.SH",
                expected: VaultAppHostname::Simple,
            },
            VaultAppHostnameCase {
                hostname: "pr-7.nokey-simple.pages.dev",
                expected: VaultAppHostname::Simple,
            },
            VaultAppHostnameCase {
                hostname: "sentinel.nokey.sh",
                expected: VaultAppHostname::Sentinel,
            },
            VaultAppHostnameCase {
                hostname: "sentinel.dev.nokey.sh",
                expected: VaultAppHostname::Sentinel,
            },
            VaultAppHostnameCase {
                hostname: "pr-7.nokey-sentinel.pages.dev",
                expected: VaultAppHostname::Sentinel,
            },
            VaultAppHostnameCase {
                hostname: "simple.nokey.sh.",
                expected: VaultAppHostname::Simple,
            },
            VaultAppHostnameCase {
                hostname: "pr-7.nokey-simple.pages.dev..",
                expected: VaultAppHostname::Simple,
            },
            VaultAppHostnameCase {
                hostname: "sentinel.dev.nokey.sh.",
                expected: VaultAppHostname::Sentinel,
            },
            VaultAppHostnameCase {
                hostname: "example.com.",
                expected: VaultAppHostname::Unrelated,
            },
            VaultAppHostnameCase {
                hostname: "example.com",
                expected: VaultAppHostname::Unrelated,
            },
            VaultAppHostnameCase {
                hostname: "simple.nokey.sh.example.com",
                expected: VaultAppHostname::Unrelated,
            },
            VaultAppHostnameCase {
                hostname: "nokey-simple.pages.dev",
                expected: VaultAppHostname::Unrelated,
            },
            VaultAppHostnameCase {
                hostname: "simple.meta-secret.io",
                expected: VaultAppHostname::Simple,
            },
            VaultAppHostnameCase {
                hostname: "SIMPLE.META-SECRET.IO.",
                expected: VaultAppHostname::Simple,
            },
            VaultAppHostnameCase {
                hostname: "simple.meta-secret.io.example.com",
                expected: VaultAppHostname::Unrelated,
            },
            VaultAppHostnameCase {
                hostname: "meta-secret.io",
                expected: VaultAppHostname::Unrelated,
            },
            VaultAppHostnameCase {
                hostname: "sentinel.meta-secret.io",
                expected: VaultAppHostname::Unrelated,
            },
            VaultAppHostnameCase {
                hostname: "xsimple.meta-secret.io",
                expected: VaultAppHostname::Unrelated,
            },
        ] {
            assert_eq!(
                VaultHostObservation::new(case.hostname).vault_app_hostname(),
                case.expected,
                "{}",
                case.hostname
            );
        }
    }

    #[test]
    fn meta_secret_alias_is_a_vault_app_but_never_an_extension_pairing_origin() -> anyhow::Result<()>
    {
        let base = "https://simple.nokey.sh/";
        let alias_url = "https://simple.meta-secret.io/vault";
        assert!(
            VaultHostPolicy::new(base)
                .nook_vault_app_exclude_match_patterns()?
                .contains(&"https://simple.meta-secret.io/*".to_owned())
        );
        assert!(
            VaultHostObservation::new(alias_url)
                .is_nook_vault_app_url(VaultAppBaseSelection::Configured(base))?
        );
        assert!(
            !VaultHostPolicy::new(base)
                .belongs_to_simple_vault("https://simple.meta-secret.io/extension-connect")?
        );
        assert_eq!(
            VaultHostPolicy::new(base).simple_vault_match_pattern()?,
            "https://simple.nokey.sh/*"
        );
        Ok(())
    }

    #[test]
    fn meta_secret_build_pairs_only_with_its_own_simple_origin() -> anyhow::Result<()> {
        let policy = VaultHostPolicy::new(KnownSimpleVault::MetaSecret.base_url());
        assert_eq!(
            policy.simple_vault_match_pattern()?,
            "https://simple.meta-secret.io/*"
        );
        assert!(policy.belongs_to_simple_vault("https://simple.meta-secret.io/extension-connect")?);
        for foreign in [
            "https://simple.nokey.sh/extension-connect",
            "https://simple.meta-secret.io.example.com/extension-connect",
            "http://simple.meta-secret.io/extension-connect",
        ] {
            assert!(!policy.belongs_to_simple_vault(foreign)?, "{foreign}");
        }
        Ok(())
    }

    #[test]
    fn meta_secret_build_excludes_every_nook_vault_host_and_no_meta_secret_sentinel()
    -> anyhow::Result<()> {
        let exclusions = VaultHostPolicy::new(KnownSimpleVault::MetaSecret.base_url())
            .nook_vault_app_exclude_match_patterns()?;
        for required in [
            "https://simple.nokey.sh/*",
            "https://simple.meta-secret.io/*",
            "https://simple.dev.nokey.sh/*",
            "https://sentinel.nokey.sh/*",
            "https://sentinel.dev.nokey.sh/*",
            "https://*.nokey-simple.pages.dev/*",
            "https://*.nokey-sentinel.pages.dev/*",
        ] {
            assert!(exclusions.contains(&required.to_owned()), "{required}");
        }
        assert!(
            !exclusions
                .iter()
                .any(|pattern| pattern.contains("sentinel.meta-secret.io")),
            "{exclusions:?}"
        );
        Ok(())
    }

    #[test]
    fn every_build_excludes_its_own_and_both_production_simple_vaults() -> anyhow::Result<()> {
        for build in KnownSimpleVault::ALL {
            let exclusions =
                VaultHostPolicy::new(build.base_url()).nook_vault_app_exclude_match_patterns()?;
            for excluded in [build, KnownSimpleVault::Nokey, KnownSimpleVault::MetaSecret] {
                let pattern =
                    VaultHostPolicy::new(excluded.base_url()).simple_vault_match_pattern()?;
                assert!(
                    exclusions.contains(&pattern),
                    "{} build must exclude {pattern}",
                    build.name()
                );
            }
        }
        Ok(())
    }

    struct KnownSentinelCase {
        target: KnownSimpleVault,
        sentinel: SentinelVaultMatch,
        sentinel_patterns: &'static [&'static str],
    }

    #[test]
    fn known_simple_vaults_use_their_deployed_sentinel() -> anyhow::Result<()> {
        for case in [
            KnownSentinelCase {
                target: KnownSimpleVault::Nokey,
                sentinel: SentinelVaultMatch::MatchingBaseUrl(
                    "https://sentinel.nokey.sh/".to_owned(),
                ),
                sentinel_patterns: &["https://sentinel.nokey.sh/*"],
            },
            KnownSentinelCase {
                target: KnownSimpleVault::MetaSecret,
                sentinel: SentinelVaultMatch::MatchingBaseUrl(
                    "https://sentinel.nokey.sh/".to_owned(),
                ),
                sentinel_patterns: &["https://sentinel.nokey.sh/*"],
            },
            KnownSentinelCase {
                target: KnownSimpleVault::Localhost,
                sentinel: SentinelVaultMatch::UnsupportedHost,
                sentinel_patterns: &["https://sentinel.nokey.sh/*"],
            },
        ] {
            let policy = VaultHostPolicy::new(case.target.base_url());
            assert_eq!(
                policy.matching_sentinel_vault_base_url()?,
                case.sentinel,
                "{}",
                case.target.name()
            );
            assert_eq!(
                policy.sentinel_vault_match_patterns()?,
                case.sentinel_patterns.to_vec(),
                "{}",
                case.target.name()
            );
        }
        assert!(
            !VaultHostPolicy::new(KnownSimpleVault::MetaSecret.base_url())
                .belongs_to_sentinel_vault("https://sentinel.meta-secret.io/")?
        );
        Ok(())
    }

    struct DerivedSentinelCase {
        simple: &'static str,
        sentinel: SentinelVaultMatch,
    }

    #[test]
    fn explicit_simple_vaults_derive_their_sentinel() -> anyhow::Result<()> {
        for case in [
            DerivedSentinelCase {
                simple: "https://simple.dev.nokey.sh/",
                sentinel: SentinelVaultMatch::MatchingBaseUrl(
                    "https://sentinel.dev.nokey.sh/".to_owned(),
                ),
            },
            DerivedSentinelCase {
                simple: "https://pr-12.nokey-simple.pages.dev/",
                sentinel: SentinelVaultMatch::MatchingBaseUrl(
                    "https://pr-12.nokey-sentinel.pages.dev/".to_owned(),
                ),
            },
            DerivedSentinelCase {
                simple: "https://localhost:5173/simple/",
                sentinel: SentinelVaultMatch::MatchingBaseUrl(
                    "https://localhost:5173/sentinel/".to_owned(),
                ),
            },
            DerivedSentinelCase {
                simple: "http://127.0.0.1:5174/",
                sentinel: SentinelVaultMatch::UnsupportedHost,
            },
        ] {
            assert_eq!(
                VaultHostPolicy::new(case.simple).matching_sentinel_vault_base_url()?,
                case.sentinel,
                "{}",
                case.simple
            );
        }
        Ok(())
    }
}
