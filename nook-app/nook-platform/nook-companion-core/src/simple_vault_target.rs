//! The one Simple vault an extension build pairs with.
//!
//! A build names a known Simple vault deployment, or supplies an explicit
//! absolute URL for PR previews and local test servers. Both resolve to one
//! normalized Simple vault base URL.

use std::fmt;
use std::str::FromStr;

use thiserror::Error;
use url::Url;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::vault_host_policy::{SentinelVaultMatch, VaultHostPolicy, VaultHostPolicyError};

mod extension_package;
pub use extension_package::{
    ExtensionIdentityDisplayQualifier, ExtensionIdentityScope, ExtensionIdentitySeedQualifier,
    ExtensionMetadataFileName, ExtensionPackageHost, ProductionSimpleVaultTargetError,
    SimpleVaultHost,
};

/// Production Sentinel vault that serves every named production Simple vault.
const NOKEY_SENTINEL_VAULT_URL: &str = "https://sentinel.nokey.sh/";

/// How a build's extension package reaches users.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionPackageDistribution {
    /// Chrome Web Store on the production channel; a manual ZIP elsewhere.
    StoreOnProductionChannel,
    /// A manual ZIP download on every channel.
    ManualZip,
}

/// Simple vault deployment a build can select by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KnownSimpleVault {
    /// Production Simple vault on `simple.nokey.sh`.
    Nokey,
    /// Production Simple vault on `simple.meta-secret.io`, for organizations
    /// that block `.sh` domains.
    MetaSecret,
    /// Local HTTPS development server.
    Localhost,
}

impl KnownSimpleVault {
    /// Target a build pairs with when it names none.
    pub const DEFAULT: Self = Self::Nokey;

    /// Every named target, in the order diagnostics list them.
    pub const ALL: [Self; 3] = [Self::Nokey, Self::MetaSecret, Self::Localhost];

    /// Name a build uses to select this target.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Nokey => "nokey",
            Self::MetaSecret => "meta-secret",
            Self::Localhost => "localhost",
        }
    }

    /// Normalized Simple vault base URL of this target.
    #[must_use]
    pub const fn base_url(self) -> &'static str {
        match self {
            Self::Nokey => "https://simple.nokey.sh/",
            Self::MetaSecret => "https://simple.meta-secret.io/",
            Self::Localhost => "https://localhost:5173/",
        }
    }

    /// Sentinel vault deployed beside this Simple vault.
    ///
    /// `meta-secret.io` has no Sentinel deployment; its Simple vault shares the
    /// production Sentinel on `sentinel.nokey.sh`.
    pub(crate) fn sentinel_vault_match(self) -> SentinelVaultMatch {
        match self {
            Self::Nokey | Self::MetaSecret => {
                SentinelVaultMatch::MatchingBaseUrl(NOKEY_SENTINEL_VAULT_URL.to_owned())
            }
            Self::Localhost => SentinelVaultMatch::UnsupportedHost,
        }
    }

    /// Suffix after `nook-passwords` / `extension` in this target's download
    /// file names. Only a non-default production target is suffixed, so its
    /// package sits beside the default package; local packages keep their names.
    #[must_use]
    pub const fn downloads_suffix(self) -> &'static str {
        match self {
            Self::Nokey | Self::Localhost => "",
            Self::MetaSecret => "-meta-secret",
        }
    }

    /// The store listing belongs to the default production target alone.
    #[must_use]
    pub const fn package_distribution(self) -> ExtensionPackageDistribution {
        match self {
            Self::Nokey | Self::Localhost => ExtensionPackageDistribution::StoreOnProductionChannel,
            Self::MetaSecret => ExtensionPackageDistribution::ManualZip,
        }
    }

    fn name_list() -> String {
        Self::ALL.map(Self::name).join(", ")
    }
}

/// Normalized Simple vault base URL: absolute, trailing slash, no query,
/// fragment, or userinfo, HTTPS except for loopback development.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimpleVaultBaseUrl {
    normalized: String,
}

impl SimpleVaultBaseUrl {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.normalized
    }
}

impl TryFrom<&str> for SimpleVaultBaseUrl {
    type Error = VaultHostPolicyError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Ok(Self {
            normalized: VaultHostPolicy::new(value).normalize_simple_vault_base_url()?,
        })
    }
}

impl From<KnownSimpleVault> for SimpleVaultBaseUrl {
    fn from(known: KnownSimpleVault) -> Self {
        Self {
            normalized: known.base_url().to_owned(),
        }
    }
}

impl From<SimpleVaultBaseUrl> for String {
    fn from(base_url: SimpleVaultBaseUrl) -> Self {
        base_url.normalized
    }
}

impl fmt::Display for SimpleVaultBaseUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.normalized)
    }
}

/// Simple vault a build pairs with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SimpleVaultTarget {
    Known(KnownSimpleVault),
    /// Any other Simple vault deployment, such as a PR preview or test server.
    ExplicitUrl(SimpleVaultBaseUrl),
}

impl SimpleVaultTarget {
    /// Normalized Simple vault base URL the build pairs with.
    #[must_use]
    pub fn base_url(self) -> SimpleVaultBaseUrl {
        match self {
            Self::Known(known) => SimpleVaultBaseUrl::from(known),
            Self::ExplicitUrl(base_url) => base_url,
        }
    }

    /// Download file-name suffix; an explicit URL keeps the unsuffixed names.
    #[must_use]
    pub fn downloads_suffix(&self) -> &'static str {
        match self {
            Self::Known(known) => known.downloads_suffix(),
            Self::ExplicitUrl(_) => "",
        }
    }

    /// Distribution of this build's package; an explicit URL keeps the channel rule.
    #[must_use]
    pub fn package_distribution(&self) -> ExtensionPackageDistribution {
        match self {
            Self::Known(known) => known.package_distribution(),
            Self::ExplicitUrl(_) => ExtensionPackageDistribution::StoreOnProductionChannel,
        }
    }

    fn from_explicit_url(input: &str) -> Result<Self, SimpleVaultTargetError> {
        match Url::parse(input) {
            Ok(_) => SimpleVaultBaseUrl::try_from(input)
                .map(Self::from)
                .map_err(|reason| SimpleVaultTargetError::rejected_url(input, reason)),
            Err(_) => Err(SimpleVaultTargetError::UnknownTarget {
                input: SimpleVaultTargetInput::from(input),
            }),
        }
    }
}

/// A base URL equal to a known target's base names that target.
impl From<SimpleVaultBaseUrl> for SimpleVaultTarget {
    fn from(base_url: SimpleVaultBaseUrl) -> Self {
        match KnownSimpleVault::ALL
            .into_iter()
            .find(|known| known.base_url() == base_url.as_str())
        {
            Some(known) => Self::Known(known),
            None => Self::ExplicitUrl(base_url),
        }
    }
}

/// Parse a build's vault target: an exact known name or an absolute URL.
impl FromStr for SimpleVaultTarget {
    type Err = SimpleVaultTargetError;

    fn from_str(input: &str) -> Result<Self, Self::Err> {
        match KnownSimpleVault::ALL
            .into_iter()
            .find(|known| known.name() == input)
        {
            Some(known) => Ok(Self::Known(known)),
            None => Self::from_explicit_url(input),
        }
    }
}

/// Rejected vault target text, echoed in diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimpleVaultTargetInput {
    text: String,
}

impl From<&str> for SimpleVaultTargetInput {
    fn from(text: &str) -> Self {
        Self {
            text: text.to_owned(),
        }
    }
}

impl fmt::Display for SimpleVaultTargetInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.text)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SimpleVaultTargetError {
    #[error(
        "Unknown Simple vault target \"{input}\": use one of {known}, or an absolute Simple vault URL.",
        known = KnownSimpleVault::name_list()
    )]
    UnknownTarget { input: SimpleVaultTargetInput },
    #[error(
        "Simple vault target \"{input}\" is not a usable Simple vault URL ({reason}): use one of {known}, or an absolute Simple vault URL.",
        known = KnownSimpleVault::name_list()
    )]
    RejectedUrl {
        input: SimpleVaultTargetInput,
        #[source]
        reason: VaultHostPolicyError,
    },
    /// The input is not echoed, so build diagnostics never print the credentials.
    #[error(
        "The Simple vault target URL must not contain a username or password: use one of {known}, or an absolute Simple vault URL.",
        known = KnownSimpleVault::name_list()
    )]
    EmbeddedCredentials,
}

impl SimpleVaultTargetError {
    fn rejected_url(input: &str, reason: VaultHostPolicyError) -> Self {
        match reason {
            VaultHostPolicyError::EmbeddedCredentials => Self::EmbeddedCredentials,
            VaultHostPolicyError::InsecureNonLocalhost | VaultHostPolicyError::InvalidUrl(_) => {
                Self::RejectedUrl {
                    input: SimpleVaultTargetInput::from(input),
                    reason,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct KnownTargetCase {
        name: &'static str,
        target: KnownSimpleVault,
        base_url: &'static str,
    }

    #[test]
    fn each_known_name_resolves_to_its_simple_vault() -> anyhow::Result<()> {
        for case in [
            KnownTargetCase {
                name: "nokey",
                target: KnownSimpleVault::Nokey,
                base_url: "https://simple.nokey.sh/",
            },
            KnownTargetCase {
                name: "meta-secret",
                target: KnownSimpleVault::MetaSecret,
                base_url: "https://simple.meta-secret.io/",
            },
            KnownTargetCase {
                name: "localhost",
                target: KnownSimpleVault::Localhost,
                base_url: "https://localhost:5173/",
            },
        ] {
            let target = case.name.parse::<SimpleVaultTarget>()?;
            assert_eq!(
                target,
                SimpleVaultTarget::Known(case.target),
                "{}",
                case.name
            );
            assert_eq!(target.base_url().as_str(), case.base_url, "{}", case.name);
            assert_eq!(case.target.name(), case.name);
        }
        Ok(())
    }

    #[test]
    fn known_base_urls_are_already_normalized() -> anyhow::Result<()> {
        for known in KnownSimpleVault::ALL {
            assert_eq!(
                SimpleVaultBaseUrl::try_from(known.base_url())?,
                SimpleVaultBaseUrl::from(known),
                "{}",
                known.name()
            );
        }
        Ok(())
    }

    #[test]
    fn absent_target_selects_the_nokey_production_vault() -> anyhow::Result<()> {
        assert_eq!(KnownSimpleVault::DEFAULT, KnownSimpleVault::Nokey);
        assert_eq!(
            KnownSimpleVault::DEFAULT
                .name()
                .parse::<SimpleVaultTarget>()?
                .base_url()
                .as_str(),
            crate::DEFAULT_SIMPLE_VAULT_URL
        );
        Ok(())
    }

    struct ExplicitUrlCase {
        input: &'static str,
        base_url: &'static str,
    }

    #[test]
    fn explicit_preview_and_loopback_urls_resolve_to_normalized_bases() -> anyhow::Result<()> {
        for case in [
            ExplicitUrlCase {
                input: "https://pr-12.nokey-simple.pages.dev/",
                base_url: "https://pr-12.nokey-simple.pages.dev/",
            },
            ExplicitUrlCase {
                input: "http://127.0.0.1:5174/",
                base_url: "http://127.0.0.1:5174/",
            },
            ExplicitUrlCase {
                input: "https://simple.dev.nokey.sh/vault?channel=dev#top",
                base_url: "https://simple.dev.nokey.sh/vault/",
            },
        ] {
            let target = case.input.parse::<SimpleVaultTarget>()?;
            assert!(
                matches!(target, SimpleVaultTarget::ExplicitUrl(_)),
                "{}",
                case.input
            );
            assert_eq!(target.base_url().as_str(), case.base_url, "{}", case.input);
        }
        Ok(())
    }

    #[test]
    fn explicit_url_of_a_known_vault_names_that_vault() -> anyhow::Result<()> {
        assert_eq!(
            "https://simple.meta-secret.io".parse::<SimpleVaultTarget>()?,
            SimpleVaultTarget::Known(KnownSimpleVault::MetaSecret)
        );
        Ok(())
    }

    #[test]
    fn unknown_names_and_relative_paths_are_rejected_with_the_known_names() {
        for input in [
            "Nokey",
            "meta_secret",
            "prod",
            "",
            "/simple/",
            "simple.nokey.sh",
        ] {
            assert_eq!(
                input.parse::<SimpleVaultTarget>(),
                Err(SimpleVaultTargetError::UnknownTarget {
                    input: SimpleVaultTargetInput::from(input),
                }),
                "{input}"
            );
        }
        assert_eq!(
            "prod"
                .parse::<SimpleVaultTarget>()
                .map_err(|error| error.to_string()),
            Err("Unknown Simple vault target \"prod\": use one of nokey, meta-secret, localhost, or an absolute Simple vault URL.".to_owned())
        );
    }

    #[test]
    fn insecure_non_loopback_urls_are_rejected() {
        for input in ["http://example.com/", "http://simple.meta-secret.io/"] {
            assert_eq!(
                input.parse::<SimpleVaultTarget>(),
                Err(SimpleVaultTargetError::RejectedUrl {
                    input: SimpleVaultTargetInput::from(input),
                    reason: VaultHostPolicyError::InsecureNonLocalhost,
                }),
                "{input}"
            );
        }
        assert_eq!(
            "http://example.com/"
                .parse::<SimpleVaultTarget>()
                .map_err(|error| error.to_string()),
            Err("Simple vault target \"http://example.com/\" is not a usable Simple vault URL (The Simple Vault URL must use HTTPS, except for localhost development.): use one of nokey, meta-secret, localhost, or an absolute Simple vault URL.".to_owned())
        );
    }

    #[test]
    fn urls_with_credentials_are_rejected_without_echoing_them() {
        for input in [
            "https://u:p@simple.meta-secret.io/",
            "https://u@pr-12.nokey-simple.pages.dev/",
        ] {
            let parsed = input.parse::<SimpleVaultTarget>();
            assert_eq!(
                parsed,
                Err(SimpleVaultTargetError::EmbeddedCredentials),
                "{input}"
            );
            let message = parsed.map_err(|error| error.to_string());
            assert!(
                matches!(&message, Err(text) if !text.contains("u:p") && !text.contains("u@")),
                "{message:?}"
            );
        }
    }

    struct DownloadsCase {
        input: &'static str,
        suffix: &'static str,
        distribution: ExtensionPackageDistribution,
    }

    #[test]
    fn only_the_meta_secret_target_names_its_downloads_and_skips_the_store() -> anyhow::Result<()> {
        for case in [
            DownloadsCase {
                input: "nokey",
                suffix: "",
                distribution: ExtensionPackageDistribution::StoreOnProductionChannel,
            },
            DownloadsCase {
                input: "https://simple.nokey.sh",
                suffix: "",
                distribution: ExtensionPackageDistribution::StoreOnProductionChannel,
            },
            DownloadsCase {
                input: "meta-secret",
                suffix: "-meta-secret",
                distribution: ExtensionPackageDistribution::ManualZip,
            },
            DownloadsCase {
                input: "https://simple.meta-secret.io/",
                suffix: "-meta-secret",
                distribution: ExtensionPackageDistribution::ManualZip,
            },
            DownloadsCase {
                input: "localhost",
                suffix: "",
                distribution: ExtensionPackageDistribution::StoreOnProductionChannel,
            },
            DownloadsCase {
                input: "https://pr-12.nokey-simple.pages.dev/",
                suffix: "",
                distribution: ExtensionPackageDistribution::StoreOnProductionChannel,
            },
            DownloadsCase {
                input: "http://127.0.0.1:5174/",
                suffix: "",
                distribution: ExtensionPackageDistribution::StoreOnProductionChannel,
            },
        ] {
            let target = case.input.parse::<SimpleVaultTarget>()?;
            assert_eq!(target.downloads_suffix(), case.suffix, "{}", case.input);
            assert_eq!(
                target.package_distribution(),
                case.distribution,
                "{}",
                case.input
            );
        }
        Ok(())
    }
}
