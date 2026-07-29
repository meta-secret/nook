//! Storage-provider capability policy for personal and shared replication.

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
    pub fn supports(&self, replication_type: ReplicationType) -> bool {
        match replication_type {
            ReplicationType::Personal => self.supports_personal,
            ReplicationType::Shared => self.supports_shared,
        }
    }
}

#[must_use]
pub fn provider_replication_capability(
    provider_type: StorageProviderType,
    oauth_preset: ProviderOauthPreset,
) -> ProviderReplicationCapability {
    match provider_type {
        StorageProviderType::Local | StorageProviderType::LocalFolder => {
            ProviderReplicationCapability {
                provider_type: provider_type.as_str().to_owned(),
                oauth_preset: ProviderOauthPreset::NotApplicable,
                supports_personal: true,
                supports_shared: false,
                shared_joiner_identity: ProviderJoinerIdentity::NotRequired,
            }
        }
        StorageProviderType::Github => ProviderReplicationCapability {
            provider_type: provider_type.as_str().to_owned(),
            oauth_preset: ProviderOauthPreset::NotApplicable,
            supports_personal: true,
            supports_shared: false,
            shared_joiner_identity: ProviderJoinerIdentity::NotRequired,
        },
        StorageProviderType::OauthFile => {
            let ProviderOauthPreset::Preset(preset) = oauth_preset else {
                return ProviderReplicationCapability {
                    provider_type: provider_type.as_str().to_owned(),
                    oauth_preset: ProviderOauthPreset::NotApplicable,
                    supports_personal: false,
                    supports_shared: false,
                    shared_joiner_identity: ProviderJoinerIdentity::NotRequired,
                };
            };
            match preset {
                OauthFilePreset::GoogleDrive => ProviderReplicationCapability {
                    provider_type: provider_type.as_str().to_owned(),
                    oauth_preset: ProviderOauthPreset::Preset(preset),
                    supports_personal: true,
                    supports_shared: true,
                    shared_joiner_identity: ProviderJoinerIdentity::Required(
                        SharedJoinerIdentityKind::Email,
                    ),
                },
                OauthFilePreset::ICloud => ProviderReplicationCapability {
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

pub fn validate_provider_replication(
    provider_type: StorageProviderType,
    oauth_preset: ProviderOauthPreset,
    replication_type: ReplicationType,
) -> ValidationResult<ProviderReplicationCapability> {
    let capability = provider_replication_capability(provider_type, oauth_preset);
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

pub fn validate_architecture_for_provider(
    architecture: &VaultArchitecture,
    provider_type: StorageProviderType,
    oauth_preset: ProviderOauthPreset,
) -> ValidationResult<ProviderReplicationCapability> {
    architecture.validate()?;
    validate_provider_replication(provider_type, oauth_preset, architecture.replication_type)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::vault_architecture::{DeviceMode, SentinelPolicy};

    #[test]
    fn provider_capability_matrix_is_fail_closed() -> anyhow::Result<()> {
        validate_provider_replication(
            StorageProviderType::Github,
            ProviderOauthPreset::NotApplicable,
            ReplicationType::Personal,
        )?;
        assert!(
            validate_provider_replication(
                StorageProviderType::Github,
                ProviderOauthPreset::NotApplicable,
                ReplicationType::Shared,
            )
            .is_err()
        );

        let gdrive = validate_provider_replication(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
            ReplicationType::Shared,
        )?;
        assert_eq!(
            gdrive.shared_joiner_identity,
            ProviderJoinerIdentity::Required(SharedJoinerIdentityKind::Email)
        );

        let icloud = validate_provider_replication(
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
        validate_architecture_for_provider(
            &simple_personal,
            StorageProviderType::Github,
            ProviderOauthPreset::NotApplicable,
        )?;
        validate_architecture_for_provider(
            &simple_personal,
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
        )?;

        let simple_shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        assert!(
            validate_architecture_for_provider(
                &simple_shared,
                StorageProviderType::Github,
                ProviderOauthPreset::NotApplicable
            )
            .is_err()
        );
        validate_architecture_for_provider(
            &simple_shared,
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
        )?;

        let sentinel_ready = VaultArchitecture::sentinel_personal(
            DeviceMode::AntiHacker,
            SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            },
        );
        validate_architecture_for_provider(
            &sentinel_ready,
            StorageProviderType::Github,
            ProviderOauthPreset::NotApplicable,
        )?;

        let sentinel_shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..sentinel_ready
        };
        validate_architecture_for_provider(
            &sentinel_shared,
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
        )?;
        assert!(
            validate_architecture_for_provider(
                &sentinel_shared,
                StorageProviderType::Github,
                ProviderOauthPreset::NotApplicable
            )
            .is_err()
        );
        validate_architecture_for_provider(
            &sentinel_shared,
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::ICloud),
        )?;
        Ok(())
    }
}
