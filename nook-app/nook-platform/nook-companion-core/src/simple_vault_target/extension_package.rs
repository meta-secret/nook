//! Extension package identity and downloads chosen by the Simple vault target.
//!
//! A build and the Simple vault page that offers its package both read the
//! downloads rule here, so the vault on each host offers that host's package.

use serde::Serialize;
use tsify::Tsify;

use super::{KnownSimpleVault, SimpleVaultTarget};

/// Identity a build derives its extension key, ID, and name from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExtensionIdentityScope {
    /// The release channel's identity alone.
    ChannelIdentity,
    /// The channel identity qualified by the Simple vault, so the package has
    /// its own extension storage and installs beside the channel's package.
    VaultIdentity {
        seed_qualifier: ExtensionIdentitySeedQualifier,
        display_qualifier: ExtensionIdentityDisplayQualifier,
    },
}

/// Stable token appended to the channel's identity seed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(transparent)]
pub struct ExtensionIdentitySeedQualifier {
    #[tsify(type = "string")]
    token: &'static str,
}

impl ExtensionIdentitySeedQualifier {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        self.token
    }
}

/// Text that distinguishes the package's display name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(transparent)]
pub struct ExtensionIdentityDisplayQualifier {
    #[tsify(type = "string")]
    text: &'static str,
}

impl ExtensionIdentityDisplayQualifier {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        self.text
    }
}

/// Deployment metadata file under a site's `downloads/` path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionMetadataFileName {
    file_name: String,
}

impl ExtensionMetadataFileName {
    fn for_downloads_suffix(suffix: &str) -> Self {
        Self {
            file_name: format!("extension{suffix}.json"),
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.file_name
    }
}

impl From<ExtensionMetadataFileName> for String {
    fn from(file_name: ExtensionMetadataFileName) -> Self {
        file_name.file_name
    }
}

/// Simple vault deployment named by the hostname that serves a vault page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimpleVaultHost {
    Known(KnownSimpleVault),
    /// Development, PR preview, and other hosts outside the named targets.
    Other,
}

impl SimpleVaultHost {
    /// Exact, case-insensitive hostname; a trailing DNS root dot names the same host.
    pub(crate) fn for_hostname(hostname: &str) -> Self {
        let hostname = hostname.trim_end_matches('.');
        match KnownSimpleVault::ALL
            .into_iter()
            .find(|known| known.hostname().eq_ignore_ascii_case(hostname))
        {
            Some(known) => Self::Known(known),
            None => Self::Other,
        }
    }

    /// Metadata file of the extension package this host's vault offers.
    #[must_use]
    pub fn extension_metadata_file_name(self) -> ExtensionMetadataFileName {
        ExtensionMetadataFileName::for_downloads_suffix(match self {
            Self::Known(known) => known.downloads_suffix(),
            Self::Other => "",
        })
    }
}

impl KnownSimpleVault {
    /// Hostname of this target's Simple vault.
    #[must_use]
    pub const fn hostname(self) -> &'static str {
        match self {
            Self::Nokey => "simple.nokey.sh",
            Self::MetaSecret => "simple.meta-secret.io",
            Self::Localhost => "localhost",
        }
    }

    /// Only a non-default production target needs its own extension identity.
    #[must_use]
    pub const fn extension_identity_scope(self) -> ExtensionIdentityScope {
        match self {
            Self::Nokey | Self::Localhost => ExtensionIdentityScope::ChannelIdentity,
            Self::MetaSecret => ExtensionIdentityScope::VaultIdentity {
                seed_qualifier: ExtensionIdentitySeedQualifier {
                    token: "meta-secret",
                },
                display_qualifier: ExtensionIdentityDisplayQualifier {
                    text: "meta-secret.io",
                },
            },
        }
    }
}

impl SimpleVaultTarget {
    /// Extension identity of this build; an explicit URL keeps the channel identity.
    #[must_use]
    pub fn extension_identity_scope(&self) -> ExtensionIdentityScope {
        match self {
            Self::Known(known) => known.extension_identity_scope(),
            Self::ExplicitUrl(_) => ExtensionIdentityScope::ChannelIdentity,
        }
    }

    /// Metadata file this build publishes, the same one its vault host offers.
    #[must_use]
    pub fn extension_metadata_file_name(&self) -> ExtensionMetadataFileName {
        ExtensionMetadataFileName::for_downloads_suffix(self.downloads_suffix())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use url::Url;

    #[test]
    fn every_known_hostname_is_its_base_url_host() -> anyhow::Result<()> {
        for known in KnownSimpleVault::ALL {
            assert_eq!(
                Url::parse(known.base_url())?.host_str(),
                Some(known.hostname()),
                "{}",
                known.name()
            );
        }
        Ok(())
    }

    #[test]
    fn only_the_meta_secret_target_has_its_own_extension_identity() -> anyhow::Result<()> {
        for input in [
            "nokey",
            "https://simple.nokey.sh/",
            "localhost",
            "https://pr-12.nokey-simple.pages.dev/",
            "http://127.0.0.1:5174/",
        ] {
            assert_eq!(
                input
                    .parse::<SimpleVaultTarget>()?
                    .extension_identity_scope(),
                ExtensionIdentityScope::ChannelIdentity,
                "{input}"
            );
        }
        for input in ["meta-secret", "https://simple.meta-secret.io"] {
            let ExtensionIdentityScope::VaultIdentity {
                seed_qualifier,
                display_qualifier,
            } = input
                .parse::<SimpleVaultTarget>()?
                .extension_identity_scope()
            else {
                anyhow::bail!("{input} must have its own extension identity");
            };
            assert_eq!(seed_qualifier.as_str(), "meta-secret");
            assert_eq!(display_qualifier.as_str(), "meta-secret.io");
        }
        Ok(())
    }

    #[test]
    fn extension_identity_scope_serializes_as_a_tagged_union() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::to_value(KnownSimpleVault::Nokey.extension_identity_scope())?,
            serde_json::json!({ "kind": "channelIdentity" })
        );
        assert_eq!(
            serde_json::to_value(KnownSimpleVault::MetaSecret.extension_identity_scope())?,
            serde_json::json!({
                "kind": "vaultIdentity",
                "seedQualifier": "meta-secret",
                "displayQualifier": "meta-secret.io",
            })
        );
        Ok(())
    }

    struct HostDownloadsCase {
        hostname: &'static str,
        metadata: &'static str,
    }

    #[test]
    fn each_vault_host_offers_its_own_extension_package() {
        for case in [
            HostDownloadsCase {
                hostname: "simple.meta-secret.io",
                metadata: "extension-meta-secret.json",
            },
            HostDownloadsCase {
                hostname: "SIMPLE.META-SECRET.IO.",
                metadata: "extension-meta-secret.json",
            },
            HostDownloadsCase {
                hostname: "simple.nokey.sh",
                metadata: "extension.json",
            },
            HostDownloadsCase {
                hostname: "localhost",
                metadata: "extension.json",
            },
            HostDownloadsCase {
                hostname: "simple.dev.nokey.sh",
                metadata: "extension.json",
            },
            HostDownloadsCase {
                hostname: "pr-12.nokey-simple.pages.dev",
                metadata: "extension.json",
            },
            HostDownloadsCase {
                hostname: "simple.meta-secret.io.example.com",
                metadata: "extension.json",
            },
            HostDownloadsCase {
                hostname: "xsimple.meta-secret.io",
                metadata: "extension.json",
            },
            HostDownloadsCase {
                hostname: "",
                metadata: "extension.json",
            },
        ] {
            assert_eq!(
                SimpleVaultHost::for_hostname(case.hostname)
                    .extension_metadata_file_name()
                    .as_str(),
                case.metadata,
                "{}",
                case.hostname
            );
        }
    }

    #[test]
    fn a_build_publishes_the_metadata_file_its_vault_host_offers() -> anyhow::Result<()> {
        for known in KnownSimpleVault::ALL {
            for input in [known.name(), known.base_url()] {
                assert_eq!(
                    input
                        .parse::<SimpleVaultTarget>()?
                        .extension_metadata_file_name(),
                    SimpleVaultHost::for_hostname(known.hostname()).extension_metadata_file_name(),
                    "{input}"
                );
            }
        }
        assert_eq!(
            "https://pr-12.nokey-simple.pages.dev/"
                .parse::<SimpleVaultTarget>()?
                .extension_metadata_file_name()
                .as_str(),
            "extension.json"
        );
        Ok(())
    }
}
