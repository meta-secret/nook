//! Storage-provider capability policy for personal and shared replication.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{ReplicationType, VaultArchitecture};
use crate::errors::{ValidationError, ValidationResult};
use crate::{OauthFilePreset, StorageProviderType};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "snake_case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "preset", rename_all = "snake_case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderOauthPreset {
    NotApplicable,
    Preset(OauthFilePreset),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "kind", rename_all = "snake_case")]
pub enum ProviderJoinerIdentity {
    NotRequired,
    Required(SharedJoinerIdentityKind),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReplicationCapability {
    pub provider_type: String,
    pub oauth_preset: ProviderOauthPreset,
    pub supports_personal: bool,
    pub supports_shared: bool,
    pub shared_joiner_identity: ProviderJoinerIdentity,
}

impl ProviderReplicationCapability {
    #[must_use]
    pub fn for_provider(
        provider_type: StorageProviderType,
        oauth_preset: ProviderOauthPreset,
    ) -> Self {
        match provider_type {
            StorageProviderType::Local
            | StorageProviderType::LocalFolder
            | StorageProviderType::Github => Self {
                provider_type: provider_type.as_str().to_owned(),
                oauth_preset: ProviderOauthPreset::NotApplicable,
                supports_personal: true,
                supports_shared: false,
                shared_joiner_identity: ProviderJoinerIdentity::NotRequired,
            },
            StorageProviderType::OauthFile => {
                let ProviderOauthPreset::Preset(preset) = oauth_preset else {
                    return Self {
                        provider_type: provider_type.as_str().to_owned(),
                        oauth_preset: ProviderOauthPreset::NotApplicable,
                        supports_personal: false,
                        supports_shared: false,
                        shared_joiner_identity: ProviderJoinerIdentity::NotRequired,
                    };
                };
                match preset {
                    OauthFilePreset::GoogleDrive => Self {
                        provider_type: provider_type.as_str().to_owned(),
                        oauth_preset: ProviderOauthPreset::Preset(preset),
                        supports_personal: true,
                        supports_shared: true,
                        shared_joiner_identity: ProviderJoinerIdentity::Required(
                            SharedJoinerIdentityKind::Email,
                        ),
                    },
                    OauthFilePreset::ICloud => Self {
                        provider_type: provider_type.as_str().to_owned(),
                        oauth_preset: ProviderOauthPreset::Preset(preset),
                        supports_personal: true,
                        supports_shared: true,
                        shared_joiner_identity: ProviderJoinerIdentity::NotRequired,
                    },
                }
            }
        }
    }

    pub fn validate(
        provider_type: StorageProviderType,
        oauth_preset: ProviderOauthPreset,
        replication_type: ReplicationType,
    ) -> ValidationResult<Self> {
        let capability = Self::for_provider(provider_type, oauth_preset);
        if capability.supports(replication_type) {
            return Ok(capability);
        }
        Err(ValidationError::UnsupportedProviderReplication {
            provider_type: capability.provider_type,
            oauth_preset: match capability.oauth_preset {
                ProviderOauthPreset::NotApplicable => String::new(),
                ProviderOauthPreset::Preset(preset) => preset.as_str().to_owned(),
            },
            replication_type: replication_type.as_str().to_owned(),
        })
    }

    #[must_use]
    pub fn supports(&self, replication_type: ReplicationType) -> bool {
        match replication_type {
            ReplicationType::Personal => self.supports_personal,
            ReplicationType::Shared => self.supports_shared,
        }
    }
}

impl VaultArchitecture {
    pub fn validate_for_provider(
        &self,
        provider_type: StorageProviderType,
        oauth_preset: ProviderOauthPreset,
    ) -> ValidationResult<ProviderReplicationCapability> {
        self.validate()?;
        ProviderReplicationCapability::validate(provider_type, oauth_preset, self.replication_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::vault_architecture::{DeviceMode, SentinelPolicy};

    #[test]
    fn provider_capability_matrix_is_fail_closed() -> anyhow::Result<()> {
        ProviderReplicationCapability::validate(
            StorageProviderType::Github,
            ProviderOauthPreset::NotApplicable,
            ReplicationType::Personal,
        )?;
        assert!(
            ProviderReplicationCapability::validate(
                StorageProviderType::Github,
                ProviderOauthPreset::NotApplicable,
                ReplicationType::Shared,
            )
            .is_err()
        );

        let gdrive = ProviderReplicationCapability::validate(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
            ReplicationType::Shared,
        )?;
        assert_eq!(
            gdrive.shared_joiner_identity,
            ProviderJoinerIdentity::Required(SharedJoinerIdentityKind::Email)
        );

        let icloud = ProviderReplicationCapability::validate(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::ICloud),
            ReplicationType::Shared,
        )?;
        assert_eq!(
            icloud.shared_joiner_identity,
            ProviderJoinerIdentity::NotRequired
        );
        Ok(())
    }

    #[test]
    fn grouped_architecture_matrix_validates_provider_replication() -> anyhow::Result<()> {
        let simple_personal = VaultArchitecture::simple_personal(DeviceMode::Standard);
        simple_personal.validate_for_provider(
            StorageProviderType::Github,
            ProviderOauthPreset::NotApplicable,
        )?;
        simple_personal.validate_for_provider(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
        )?;

        let simple_shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        assert!(
            simple_shared
                .validate_for_provider(
                    StorageProviderType::Github,
                    ProviderOauthPreset::NotApplicable
                )
                .is_err()
        );
        simple_shared.validate_for_provider(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
        )?;

        let sentinel_ready = VaultArchitecture::sentinel_personal(
            DeviceMode::AntiHacker,
            SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 2.into(),
            },
        );
        sentinel_ready.validate_for_provider(
            StorageProviderType::Github,
            ProviderOauthPreset::NotApplicable,
        )?;

        let sentinel_shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..sentinel_ready
        };
        sentinel_shared.validate_for_provider(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
        )?;
        assert!(
            sentinel_shared
                .validate_for_provider(
                    StorageProviderType::Github,
                    ProviderOauthPreset::NotApplicable
                )
                .is_err()
        );
        sentinel_shared.validate_for_provider(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::ICloud),
        )?;
        Ok(())
    }
}
