//! Rust-owned vault architecture mode taxonomy and compatibility matrix.
//!
//! The grouped model deliberately keeps local device protection, vault key
//! access, sync-provider replication trust, onboarding ceremony, and provider
//! capability as separate concerns. UI and WASM callers should ask this module
//! for decisions instead of re-encoding the matrix in TypeScript.

use crate::errors::{ValidationError, ValidationResult};
use crate::{StoredSecretRecord, is_sentinel_share_stored_record};
use serde::{Deserialize, Deserializer, Serialize, de::Error as DeError};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::wasm_bindgen;

mod application;
mod device_mode;
mod provider_replication;
mod shared_storage_grant;

pub use application::{VaultApplication, VaultConnectIntent};
pub use device_mode::DeviceMode;
pub use provider_replication::{
    ProviderJoinerIdentity, ProviderOauthPreset, ProviderReplicationCapability,
    SharedJoinerIdentityKind, provider_replication_capability, validate_architecture_for_provider,
    validate_provider_replication,
};
pub use shared_storage_grant::{
    SharedStorageGrantCredential, SharedStorageGrantOutcome, SharedStorageGrantRequest,
    SharedStorageGrantTarget, SharedStorageTargetHint, SharedStorageTargetSelection,
    prepare_shared_storage_grant,
};

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum VaultType {
    /// Existing per-device full vault-key envelope model.
    #[default]
    Simple,
    /// Threshold-share vault access; one device alone is insufficient.
    Sentinel,
}

impl VaultType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Simple => "simple",
            Self::Sentinel => "sentinel",
        }
    }

    pub fn parse(value: &str) -> ValidationResult<Self> {
        match value {
            "" | "simple" => Ok(Self::Simple),
            "sentinel" => Ok(Self::Sentinel),
            other => Err(ValidationError::UnknownVaultType {
                vault_type: other.to_owned(),
            }),
        }
    }
}

impl<'de> Deserialize<'de> for VaultType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(D::Error::custom)
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ReplicationType {
    /// Same owner / highly trusted devices may reuse sync-provider credentials.
    #[default]
    Personal,
    /// Joiners use their own provider account and require a provider grant.
    Shared,
}

impl<'de> Deserialize<'de> for ReplicationType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(D::Error::custom)
    }
}

impl ReplicationType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Personal => "personal",
            Self::Shared => "shared",
        }
    }

    pub fn parse(value: &str) -> ValidationResult<Self> {
        match value {
            "" | "personal" => Ok(Self::Personal),
            "shared" => Ok(Self::Shared),
            other => Err(ValidationError::UnknownReplicationType {
                replication_type: other.to_owned(),
            }),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnboardingType {
    /// Send vault access plus allowed same-owner provider credentials.
    PersonalCredentialTransfer,
    /// Collect joiner provider identity, then grant shared provider storage.
    SharedProviderGrant,
}

impl OnboardingType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PersonalCredentialTransfer => "personal-credential-transfer",
            Self::SharedProviderGrant => "shared-provider-grant",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SentinelPolicy {
    pub threshold: u8,
    pub required_participants: u8,
    pub ready_participants: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "state", content = "policy", rename_all = "snake_case")]
pub enum SentinelConfiguration {
    #[default]
    Disabled,
    Enabled(SentinelPolicy),
}

impl SentinelConfiguration {
    #[must_use]
    pub const fn policy_or_default(self) -> SentinelPolicy {
        match self {
            Self::Disabled => SentinelPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 0,
            },
            Self::Enabled(policy) => policy,
        }
    }

    pub fn policy(self) -> ValidationResult<SentinelPolicy> {
        match self {
            Self::Enabled(policy) => Ok(policy),
            Self::Disabled => Err(ValidationError::InvalidSentinelPolicy),
        }
    }
}

impl Default for SentinelPolicy {
    fn default() -> Self {
        Self {
            threshold: 2,
            required_participants: 3,
            ready_participants: 0,
        }
    }
}

impl SentinelPolicy {
    #[must_use]
    pub fn is_ready(self) -> bool {
        self.threshold > 1
            && self.threshold <= self.required_participants
            && self.ready_participants >= self.required_participants
    }

    pub fn validate(self) -> ValidationResult<()> {
        if self.threshold <= 1 || self.threshold > self.required_participants {
            return Err(ValidationError::InvalidSentinelPolicy);
        }
        if self.required_participants > 16 {
            return Err(ValidationError::InvalidSentinelPolicy);
        }
        if self.ready_participants > self.required_participants {
            return Err(ValidationError::InvalidSentinelPolicy);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct VaultArchitecture {
    #[serde(default)]
    pub device_mode: DeviceMode,
    #[serde(default)]
    pub vault_type: VaultType,
    /// New vault genesis does not select or derive behavior from replication;
    /// providers are configured after creation.
    #[serde(default, skip_serializing_if = "replication_is_default")]
    pub replication_type: ReplicationType,
    /// Sentinel quorum policy.
    #[serde(default)]
    pub sentinel: SentinelConfiguration,
}

#[allow(clippy::trivially_copy_pass_by_ref)] // serde skip_serializing_if requires &T.
fn replication_is_default(value: &ReplicationType) -> bool {
    *value == ReplicationType::Personal
}

impl Default for VaultArchitecture {
    fn default() -> Self {
        Self {
            device_mode: DeviceMode::Standard,
            vault_type: VaultType::Simple,
            replication_type: ReplicationType::Personal,
            sentinel: SentinelConfiguration::Disabled,
        }
    }
}

impl VaultArchitecture {
    pub fn draft(
        device_mode: DeviceMode,
        vault_type: VaultType,
        replication_type: ReplicationType,
    ) -> ValidationResult<Self> {
        let architecture = Self {
            device_mode,
            vault_type,
            replication_type,
            sentinel: match vault_type {
                VaultType::Simple => SentinelConfiguration::Disabled,
                VaultType::Sentinel => SentinelConfiguration::Enabled(SentinelPolicy {
                    threshold: 2,
                    required_participants: 2,
                    ready_participants: 0,
                }),
            },
        };
        architecture.validate()?;
        Ok(architecture)
    }

    #[must_use]
    pub fn simple_personal(device_mode: DeviceMode) -> Self {
        Self {
            device_mode,
            vault_type: VaultType::Simple,
            replication_type: ReplicationType::Personal,
            sentinel: SentinelConfiguration::Disabled,
        }
    }

    #[must_use]
    pub fn sentinel_personal(device_mode: DeviceMode, policy: SentinelPolicy) -> Self {
        Self {
            device_mode,
            vault_type: VaultType::Sentinel,
            replication_type: ReplicationType::Personal,
            sentinel: SentinelConfiguration::Enabled(policy),
        }
    }

    pub fn validate(&self) -> ValidationResult<()> {
        match self.vault_type {
            VaultType::Simple => {
                if !matches!(self.sentinel, SentinelConfiguration::Disabled) {
                    return Err(ValidationError::SimpleVaultHasSentinelPolicy);
                }
            }
            VaultType::Sentinel => {
                let policy = self.sentinel.policy()?;
                policy.validate()?;
            }
        }
        Ok(())
    }

    /// Validate architecture invariants that depend on persisted vault records.
    ///
    /// A sentinel vault must never carry a full per-device vault-key envelope. Once
    /// shares have been issued they form one complete, internally consistent set
    /// matching the persisted policy; partial or mixed generations fail closed.
    pub fn validate_records(&self, records: &[StoredSecretRecord]) -> ValidationResult<()> {
        self.validate()?;
        let mut share_devices = BTreeSet::new();
        let mut share_indexes = BTreeSet::new();
        let mut shares = Vec::new();
        let mut has_auth = false;

        for record in records {
            let classified = crate::VaultMetaRecord::classify(record);
            if record
                .key
                .as_str()
                .starts_with(crate::SENTINEL_SHARE_RECORD_PREFIX)
                && !matches!(&classified, crate::VaultMetaRecord::SentinelShare(..))
            {
                return Err(ValidationError::InvalidSentinelShareSet);
            }
            match classified {
                crate::VaultMetaRecord::Auth(..) => has_auth = true,
                crate::VaultMetaRecord::SentinelShare(device_id, share) => {
                    if !share_devices.insert(device_id) || !share_indexes.insert(share.share_index)
                    {
                        return Err(ValidationError::InvalidSentinelShareSet);
                    }
                    shares.push(share);
                }
                _ => {}
            }
        }

        match self.vault_type {
            VaultType::Simple => {
                if shares.is_empty() {
                    Ok(())
                } else {
                    Err(ValidationError::SimpleVaultHasSentinelShares)
                }
            }
            VaultType::Sentinel => {
                if has_auth {
                    return Err(ValidationError::SentinelVaultHasFullKeyEnvelopes);
                }
                if shares.is_empty() {
                    return if self.sentinel.policy()?.ready_participants == 0 {
                        Ok(())
                    } else {
                        Err(ValidationError::InvalidSentinelShareSet)
                    };
                }

                let policy = self.sentinel.policy()?;
                if shares.len() != usize::from(policy.required_participants)
                    || policy.ready_participants != policy.required_participants
                    || shares.iter().any(|share| {
                        !matches!(share.version, 1 | 2)
                            || share.threshold != policy.threshold
                            || share.required_participants != policy.required_participants
                            || share.share_index == 0
                            || share.share_index > policy.required_participants
                    })
                {
                    return Err(ValidationError::InvalidSentinelShareSet);
                }
                Ok(())
            }
        }
    }

    #[must_use]
    pub fn onboarding_type(&self) -> OnboardingType {
        match self.replication_type {
            ReplicationType::Personal => OnboardingType::PersonalCredentialTransfer,
            ReplicationType::Shared => OnboardingType::SharedProviderGrant,
        }
    }

    #[must_use]
    pub fn can_create_secret(&self) -> bool {
        match self.vault_type {
            VaultType::Simple => true,
            VaultType::Sentinel => self.sentinel.policy_or_default().is_ready(),
        }
    }

    #[must_use]
    pub fn can_create_secret_with_records(&self, records: &[StoredSecretRecord]) -> bool {
        match self.vault_type {
            VaultType::Simple => true,
            VaultType::Sentinel => {
                records.iter().any(is_sentinel_share_stored_record)
                    && self.validate_records(records).is_ok()
            }
        }
    }

    #[must_use]
    pub fn is_sentinel_ready(&self) -> bool {
        self.vault_type == VaultType::Sentinel && self.sentinel.policy_or_default().is_ready()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn architecture_omits_default_personal_replication() -> anyhow::Result<()> {
        let architecture = VaultArchitecture::simple_personal(DeviceMode::Standard);
        let encoded = serde_json::to_value(&architecture)?;
        assert!(encoded.get("replication_type").is_none());
        let decoded: VaultArchitecture = serde_json::from_value(serde_json::json!({
            "device_mode": "standard",
            "vault_type": "simple",
            "replication_type": "personal"
        }))?;
        assert_eq!(decoded, architecture);
        Ok(())
    }

    #[test]
    fn draft_builds_the_vault_type_specific_policy() -> anyhow::Result<()> {
        let simple = VaultArchitecture::draft(
            DeviceMode::AntiHacker,
            VaultType::Simple,
            ReplicationType::Shared,
        )?;
        assert_eq!(simple.device_mode, DeviceMode::AntiHacker);
        assert_eq!(simple.replication_type, ReplicationType::Shared);
        assert_eq!(simple.sentinel, SentinelConfiguration::Disabled);

        let sentinel = VaultArchitecture::draft(
            DeviceMode::Standard,
            VaultType::Sentinel,
            ReplicationType::Personal,
        )?;
        assert_eq!(
            sentinel.sentinel,
            SentinelConfiguration::Enabled(SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 0,
            })
        );
        Ok(())
    }

    #[test]
    fn sentinel_architecture_uses_only_sentinel_wire_names() -> anyhow::Result<()> {
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 0,
            },
        );

        let encoded = serde_json::to_value(&architecture)?;
        assert!(encoded.get("vault_type").is_some());
        assert!(encoded.get("sentinel").is_some());

        let decoded: VaultArchitecture = serde_json::from_value(encoded)?;
        assert_eq!(decoded, architecture);
        Ok(())
    }

    #[test]
    fn defaults_match_current_vault_behavior() -> anyhow::Result<()> {
        let architecture = VaultArchitecture::default();
        assert_eq!(architecture.device_mode, DeviceMode::Standard);
        assert_eq!(architecture.vault_type, VaultType::Simple);
        assert_eq!(architecture.replication_type, ReplicationType::Personal);
        assert!(architecture.can_create_secret());
        assert_eq!(
            architecture.onboarding_type(),
            OnboardingType::PersonalCredentialTransfer
        );
        architecture.validate()?;
        Ok(())
    }

    #[test]
    fn onboarding_type_is_derived_from_replication_type() {
        let personal = VaultArchitecture::simple_personal(DeviceMode::Standard);
        assert_eq!(
            personal.onboarding_type(),
            OnboardingType::PersonalCredentialTransfer
        );

        let shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        assert_eq!(
            shared.onboarding_type(),
            OnboardingType::SharedProviderGrant
        );
    }

    #[test]
    fn sentinel_requires_valid_threshold_and_all_participants_before_secret_creation()
    -> anyhow::Result<()> {
        let not_ready = VaultArchitecture::sentinel_personal(
            DeviceMode::AntiHacker,
            SentinelPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 2,
            },
        );
        not_ready.validate()?;
        assert!(!not_ready.can_create_secret());

        let ready = VaultArchitecture::sentinel_personal(
            DeviceMode::AntiHacker,
            SentinelPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 3,
            },
        );
        ready.validate()?;
        assert!(ready.can_create_secret());

        let invalid = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 1,
                required_participants: 1,
                ready_participants: 1,
            },
        );
        assert!(invalid.validate().is_err());
        Ok(())
    }

    #[test]
    fn sentinel_secret_creation_requires_actual_share_records() -> anyhow::Result<()> {
        let keys = crate::generate_vault_keys()?;
        let first = crate::DeviceIdentity::generate()?;
        let second = crate::DeviceIdentity::generate()?;
        let shares = crate::create_sentinel_share_records(&keys, &[first, second], 2)?;
        let ready = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            },
        );

        assert!(ready.can_create_secret());
        assert!(!ready.can_create_secret_with_records(&[]));
        assert!(!ready.can_create_secret_with_records(&shares[..1]));
        assert!(ready.can_create_secret_with_records(&shares));
        Ok(())
    }

    #[test]
    fn sentinel_record_validation_rejects_full_key_envelopes_and_mixed_share_sets()
    -> anyhow::Result<()> {
        let keys = crate::generate_vault_keys()?;
        let first = crate::DeviceIdentity::generate()?;
        let second = crate::DeviceIdentity::generate()?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            },
        );
        let shares =
            crate::create_sentinel_share_records(&keys, &[first.clone(), second.clone()], 2)?;
        architecture.validate_records(&shares)?;

        let auth = crate::genesis_auth_record(&first, &keys.secrets_key, &keys.members_key)?;
        let mut shares_with_auth = shares.clone();
        shares_with_auth.push(auth);
        assert_eq!(
            architecture.validate_records(&shares_with_auth),
            Err(ValidationError::SentinelVaultHasFullKeyEnvelopes)
        );

        assert_eq!(
            architecture.validate_records(&shares[..1]),
            Err(ValidationError::InvalidSentinelShareSet)
        );

        let stale_readiness = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 1,
            },
        );
        assert_eq!(
            stale_readiness.validate_records(&shares),
            Err(ValidationError::InvalidSentinelShareSet)
        );

        let mut duplicate_index = shares;
        let first_envelope =
            crate::parse_sentinel_share_envelope(duplicate_index[0].value.as_str())?;
        let mut second_envelope =
            crate::parse_sentinel_share_envelope(duplicate_index[1].value.as_str())?;
        second_envelope.share_index = first_envelope.share_index;
        duplicate_index[1].value =
            crate::StoredRecordPayload::from_trusted(serde_json::to_string(&second_envelope)?);
        assert_eq!(
            architecture.validate_records(&duplicate_index),
            Err(ValidationError::InvalidSentinelShareSet)
        );
        Ok(())
    }

    #[test]
    fn simple_record_validation_rejects_sentinel_shares() -> anyhow::Result<()> {
        let keys = crate::generate_vault_keys()?;
        let first = crate::DeviceIdentity::generate()?;
        let second = crate::DeviceIdentity::generate()?;
        let shares = crate::create_sentinel_share_records(&keys, &[first, second], 2)?;
        assert_eq!(
            VaultArchitecture::default().validate_records(&shares),
            Err(ValidationError::SimpleVaultHasSentinelShares)
        );
        Ok(())
    }

    #[test]
    fn malformed_sentinel_share_prefix_fails_closed_for_every_vault_type() {
        let malformed = StoredSecretRecord {
            key: crate::SecretId::from_vault_record("sentinel_share:0123456789abcdef"),
            secret_type: None,
            value: crate::StoredRecordPayload::from_trusted("not-a-share-envelope".to_owned()),
        };
        let sentinel = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 0,
            },
        );

        assert_eq!(
            sentinel.validate_records(std::slice::from_ref(&malformed)),
            Err(ValidationError::InvalidSentinelShareSet)
        );
        assert_eq!(
            VaultArchitecture::default().validate_records(&[malformed]),
            Err(ValidationError::InvalidSentinelShareSet)
        );
    }

    #[test]
    fn production_applications_accept_only_their_vault_type() {
        assert!(
            VaultApplication::Simple
                .validate_session_access(VaultType::Simple)
                .is_ok()
        );
        assert!(
            VaultApplication::Sentinel
                .validate_session_access(VaultType::Sentinel)
                .is_ok()
        );
        assert!(
            VaultApplication::Extension
                .validate_session_access(VaultType::Simple)
                .is_ok()
        );
        assert_eq!(
            VaultApplication::Simple.validate_session_access(VaultType::Sentinel),
            Err(ValidationError::VaultApplicationTypeMismatch {
                application: "simple".to_owned(),
                vault_type: "sentinel".to_owned(),
            })
        );
        assert_eq!(
            VaultApplication::Sentinel.validate_session_access(VaultType::Simple),
            Err(ValidationError::VaultApplicationTypeMismatch {
                application: "sentinel".to_owned(),
                vault_type: "simple".to_owned(),
            })
        );
        assert_eq!(
            VaultApplication::Extension.validate_session_access(VaultType::Sentinel),
            Err(ValidationError::VaultApplicationTypeMismatch {
                application: "extension".to_owned(),
                vault_type: "sentinel".to_owned(),
            })
        );
    }

    #[test]
    fn application_capabilities_are_owned_by_the_application_enum() {
        assert!(VaultApplication::Simple.is_simple());
        assert!(!VaultApplication::Simple.is_sentinel());
        assert!(VaultApplication::Simple.supports_extension());

        assert!(!VaultApplication::Sentinel.is_simple());
        assert!(VaultApplication::Sentinel.is_sentinel());
        assert!(!VaultApplication::Sentinel.supports_extension());

        assert!(VaultApplication::UnifiedDevelopment.supports_extension());
        assert!(VaultApplication::Extension.supports_extension());
    }

    #[test]
    fn existing_vault_intent_rejects_empty_remote_genesis() {
        assert!(VaultConnectIntent::CreateNew.permits_empty_remote_genesis());
        assert!(VaultConnectIntent::AddSyncProvider.permits_empty_remote_genesis());
        assert!(!VaultConnectIntent::OpenExisting.permits_empty_remote_genesis());
        assert_eq!(
            VaultConnectIntent::parse("open-existing"),
            Ok(VaultConnectIntent::OpenExisting)
        );
    }

    #[test]
    fn legacy_migration_application_is_not_supported() {
        assert_eq!(
            VaultApplication::parse("legacy-migration"),
            Err(ValidationError::UnknownVaultApplication {
                application: "legacy-migration".to_owned(),
            })
        );
    }

    #[test]
    fn extension_approval_is_forbidden_for_sentinel() {
        assert!(
            VaultApplication::Simple
                .validate_extension_approval(VaultType::Simple)
                .is_ok()
        );
        assert_eq!(
            VaultApplication::Sentinel.validate_extension_approval(VaultType::Sentinel),
            Err(ValidationError::SentinelExtensionForbidden)
        );
        assert_eq!(
            VaultApplication::Extension.validate_extension_approval(VaultType::Simple),
            Err(ValidationError::ExtensionApprovalApplicationForbidden {
                application: "extension".to_owned(),
            })
        );
    }
}
