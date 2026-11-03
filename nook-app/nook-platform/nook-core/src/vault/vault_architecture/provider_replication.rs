//! Storage-provider capability policy for personal and shared replication.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{ReplicationType, VaultArchitecture};
use crate::errors::{ValidationError, ValidationResult};
use crate::{OAuthFilePreset, ProviderKind, i18n_keys};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "snake_case")]
pub enum SharedJoinerIdentityKind {
    Email,
}

impl SharedJoinerIdentityKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Email => "email",
        }
    }
}

/// Whom a shared invite names: an authorized account of a given kind, or no
/// one, because the provider's own sharing list admits the joiner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "kind", rename_all = "snake_case")]
pub enum ProviderJoinerIdentity {
    NotRequired,
    Required(SharedJoinerIdentityKind),
}

/// Whether a provider supports one replication.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplicationSupport {
    Supported,
    Unsupported,
}

/// Whether a provider replicates shared vaults, and whom their invites name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SharedReplication {
    Unsupported,
    Supported(ProviderJoinerIdentity),
}

/// What one provider kind can replicate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderReplicationCapability {
    pub kind: ProviderKind,
    pub personal: ReplicationSupport,
    pub shared: SharedReplication,
}

impl ProviderKind {
    /// Local, local-folder, GitHub, and S3 rows replicate personal vaults
    /// only: an invite either carries their one credential or the joiner sets
    /// one up. Google Drive and iCloud replicate both; a Drive invite names
    /// the joiner's Google account.
    #[must_use]
    pub const fn replication_capability(self) -> ProviderReplicationCapability {
        let shared = match self {
            Self::Local | Self::LocalFolder | Self::Github | Self::S3 => {
                SharedReplication::Unsupported
            }
            Self::OauthFile(OAuthFilePreset::GoogleDrive) => SharedReplication::Supported(
                ProviderJoinerIdentity::Required(SharedJoinerIdentityKind::Email),
            ),
            Self::OauthFile(OAuthFilePreset::ICloud) => {
                SharedReplication::Supported(ProviderJoinerIdentity::NotRequired)
            }
        };
        ProviderReplicationCapability {
            kind: self,
            personal: ReplicationSupport::Supported,
            shared,
        }
    }
}

impl ProviderReplicationCapability {
    /// The translation key of the label a provider picker shows for this
    /// capability: personal and shared replication, or personal only.
    #[must_use]
    pub const fn label_translation_key(&self) -> &'static str {
        match self.shared {
            SharedReplication::Supported(_) => {
                i18n_keys::PROVIDER_PICKER_CAPABILITY_PERSONAL_SHARED
            }
            SharedReplication::Unsupported => i18n_keys::PROVIDER_PICKER_CAPABILITY_PERSONAL_ONLY,
        }
    }

    #[must_use]
    pub const fn supports(&self, replication: ReplicationType) -> ReplicationSupport {
        match (replication, self.shared) {
            (ReplicationType::Personal, _) => self.personal,
            (ReplicationType::Shared, SharedReplication::Supported(_)) => {
                ReplicationSupport::Supported
            }
            (ReplicationType::Shared, SharedReplication::Unsupported) => {
                ReplicationSupport::Unsupported
            }
        }
    }

    /// The capability when it supports `replication`, else the error naming
    /// the provider and the replication.
    pub fn validate(self, replication: ReplicationType) -> ValidationResult<Self> {
        match self.supports(replication) {
            ReplicationSupport::Supported => Ok(self),
            ReplicationSupport::Unsupported => {
                Err(ValidationError::UnsupportedProviderReplication {
                    provider: self.kind.label().to_owned(),
                    replication_type: replication.as_str().to_owned(),
                })
            }
        }
    }
}

impl VaultArchitecture {
    pub fn validate_for_provider(
        &self,
        kind: ProviderKind,
    ) -> ValidationResult<ProviderReplicationCapability> {
        self.validate()?;
        kind.replication_capability()
            .validate(self.replication_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::vault_architecture::{DeviceMode, SentinelPolicy};

    #[test]
    fn the_picker_label_names_shared_replication_only_where_supported() {
        for kind in [
            ProviderKind::Local,
            ProviderKind::LocalFolder,
            ProviderKind::Github,
            ProviderKind::S3,
        ] {
            assert_eq!(
                kind.replication_capability().label_translation_key(),
                i18n_keys::PROVIDER_PICKER_CAPABILITY_PERSONAL_ONLY
            );
        }
        for preset in [OAuthFilePreset::GoogleDrive, OAuthFilePreset::ICloud] {
            assert_eq!(
                ProviderKind::OauthFile(preset)
                    .replication_capability()
                    .label_translation_key(),
                i18n_keys::PROVIDER_PICKER_CAPABILITY_PERSONAL_SHARED
            );
        }
    }

    #[test]
    fn provider_capability_matrix_is_fail_closed() -> anyhow::Result<()> {
        let personal_only = [
            ProviderKind::Local,
            ProviderKind::LocalFolder,
            ProviderKind::Github,
            ProviderKind::S3,
        ];
        for kind in personal_only {
            let capability = kind
                .replication_capability()
                .validate(ReplicationType::Personal)?;
            assert_eq!(capability.shared, SharedReplication::Unsupported);
            assert_eq!(
                capability.supports(ReplicationType::Shared),
                ReplicationSupport::Unsupported
            );
        }
        assert_eq!(
            ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive)
                .replication_capability()
                .validate(ReplicationType::Shared)?
                .shared,
            SharedReplication::Supported(ProviderJoinerIdentity::Required(
                SharedJoinerIdentityKind::Email
            ))
        );
        let icloud = ProviderKind::OauthFile(OAuthFilePreset::ICloud).replication_capability();
        assert_eq!(
            icloud.shared,
            SharedReplication::Supported(ProviderJoinerIdentity::NotRequired)
        );
        assert_eq!(
            icloud.supports(ReplicationType::Personal),
            ReplicationSupport::Supported
        );
        // The error names the provider and the replication, nothing empty.
        for (kind, provider) in [(ProviderKind::S3, "s3"), (ProviderKind::Github, "github")] {
            assert_eq!(
                kind.replication_capability()
                    .validate(ReplicationType::Shared),
                Err(ValidationError::UnsupportedProviderReplication {
                    provider: provider.to_owned(),
                    replication_type: "shared".to_owned(),
                })
            );
        }
        assert_eq!(
            ProviderKind::Github
                .replication_capability()
                .validate(ReplicationType::Shared)
                .map_err(|error| error.to_string()),
            Err("errors.validation.unsupported_provider_replication:github:shared".to_owned())
        );
        Ok(())
    }

    #[test]
    fn grouped_architecture_matrix_validates_provider_replication() -> anyhow::Result<()> {
        let drive = ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive);
        let simple_personal = VaultArchitecture::simple_personal(DeviceMode::Standard);
        simple_personal.validate_for_provider(ProviderKind::Github)?;
        simple_personal.validate_for_provider(drive)?;

        let simple_shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        assert!(
            simple_shared
                .validate_for_provider(ProviderKind::Github)
                .is_err()
        );
        simple_shared.validate_for_provider(drive)?;

        let sentinel_ready = VaultArchitecture::sentinel_personal(
            DeviceMode::AntiHacker,
            SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 2.into(),
            },
        );
        sentinel_ready.validate_for_provider(ProviderKind::Github)?;

        let sentinel_shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..sentinel_ready
        };
        sentinel_shared.validate_for_provider(drive)?;
        assert!(
            sentinel_shared
                .validate_for_provider(ProviderKind::Github)
                .is_err()
        );
        sentinel_shared.validate_for_provider(ProviderKind::OauthFile(OAuthFilePreset::ICloud))?;
        Ok(())
    }
}
