//! Rust-owned vault architecture mode taxonomy and compatibility matrix.
//!
//! The grouped model deliberately keeps local device protection, vault key
//! access, sync-provider replication trust, onboarding ceremony, and provider
//! capability as separate concerns. UI and WASM callers should ask this module
//! for decisions instead of re-encoding the matrix in TypeScript.

use crate::errors::{ValidationError, ValidationResult};
use crate::{
    OauthFilePreset, StorageProviderType, StoredSecretRecord, is_nexus_share_stored_record,
};
use serde::{Deserialize, Deserializer, Serialize, de::Error as DeError};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceMode {
    /// Passkey PRF deterministically derives the local age/device identity.
    #[default]
    Standard,
    /// Passkey PRF unwraps a randomly generated age/device identity stored locally.
    AntiHacker,
}

impl DeviceMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::AntiHacker => "anti-hacker",
        }
    }

    pub fn parse(value: &str) -> ValidationResult<Self> {
        match value {
            "" | "standard" => Ok(Self::Standard),
            "anti-hacker" => Ok(Self::AntiHacker),
            other => Err(ValidationError::UnknownDeviceMode {
                mode: other.to_owned(),
            }),
        }
    }
}

impl<'de> Deserialize<'de> for DeviceMode {
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
pub enum VaultType {
    /// Existing per-device full vault-key envelope model.
    #[default]
    Simple,
    /// Threshold-share vault access; one device alone is insufficient.
    Nexus,
}

impl VaultType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Simple => "simple",
            Self::Nexus => "nexus",
        }
    }

    pub fn parse(value: &str) -> ValidationResult<Self> {
        match value {
            "" | "simple" => Ok(Self::Simple),
            "nexus" => Ok(Self::Nexus),
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReplicationCapability {
    pub provider_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_preset: Option<String>,
    pub supports_personal: bool,
    pub supports_shared: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_joiner_identity: Option<SharedJoinerIdentityKind>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct NexusPolicy {
    pub threshold: u8,
    pub required_participants: u8,
    #[serde(default)]
    pub ready_participants: u8,
}

impl Default for NexusPolicy {
    fn default() -> Self {
        Self {
            threshold: 2,
            required_participants: 3,
            ready_participants: 0,
        }
    }
}

impl NexusPolicy {
    #[must_use]
    pub fn is_ready(self) -> bool {
        self.threshold > 1
            && self.threshold <= self.required_participants
            && self.ready_participants >= self.required_participants
    }

    pub fn validate(self) -> ValidationResult<()> {
        if self.threshold <= 1 || self.threshold > self.required_participants {
            return Err(ValidationError::InvalidNexusPolicy);
        }
        if self.ready_participants > self.required_participants {
            return Err(ValidationError::InvalidNexusPolicy);
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
    #[serde(default)]
    pub replication_type: ReplicationType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nexus: Option<NexusPolicy>,
}

impl Default for VaultArchitecture {
    fn default() -> Self {
        Self {
            device_mode: DeviceMode::Standard,
            vault_type: VaultType::Simple,
            replication_type: ReplicationType::Personal,
            nexus: None,
        }
    }
}

impl VaultArchitecture {
    #[must_use]
    pub fn default_legacy() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn simple_personal(device_mode: DeviceMode) -> Self {
        Self {
            device_mode,
            vault_type: VaultType::Simple,
            replication_type: ReplicationType::Personal,
            nexus: None,
        }
    }

    #[must_use]
    pub fn nexus_personal(device_mode: DeviceMode, policy: NexusPolicy) -> Self {
        Self {
            device_mode,
            vault_type: VaultType::Nexus,
            replication_type: ReplicationType::Personal,
            nexus: Some(policy),
        }
    }

    pub fn validate(&self) -> ValidationResult<()> {
        match self.vault_type {
            VaultType::Simple => {
                if self.nexus.is_some() {
                    return Err(ValidationError::SimpleVaultHasNexusPolicy);
                }
            }
            VaultType::Nexus => {
                let policy = self.nexus.unwrap_or_default();
                policy.validate()?;
            }
        }
        Ok(())
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
            VaultType::Nexus => self.nexus.unwrap_or_default().is_ready(),
        }
    }

    #[must_use]
    pub fn can_create_secret_with_records(&self, records: &[StoredSecretRecord]) -> bool {
        match self.vault_type {
            VaultType::Simple => true,
            VaultType::Nexus => {
                let policy = self.nexus.unwrap_or_default();
                policy.validate().is_ok()
                    && records
                        .iter()
                        .filter(|record| is_nexus_share_stored_record(record))
                        .count()
                        >= usize::from(policy.required_participants)
            }
        }
    }

    #[must_use]
    pub fn is_nexus_ready(&self) -> bool {
        self.vault_type == VaultType::Nexus && self.nexus.unwrap_or_default().is_ready()
    }
}

#[must_use]
pub fn provider_replication_capability(
    provider_type: StorageProviderType,
    oauth_preset: Option<OauthFilePreset>,
) -> ProviderReplicationCapability {
    match provider_type {
        StorageProviderType::Local | StorageProviderType::LocalFolder => {
            ProviderReplicationCapability {
                provider_type: provider_type.as_str().to_owned(),
                oauth_preset: None,
                supports_personal: true,
                supports_shared: false,
                shared_joiner_identity: None,
            }
        }
        StorageProviderType::Github => ProviderReplicationCapability {
            provider_type: provider_type.as_str().to_owned(),
            oauth_preset: None,
            supports_personal: true,
            supports_shared: false,
            shared_joiner_identity: None,
        },
        StorageProviderType::OauthFile => {
            let preset = oauth_preset.unwrap_or(OauthFilePreset::GoogleDrive);
            match preset {
                OauthFilePreset::GoogleDrive => ProviderReplicationCapability {
                    provider_type: provider_type.as_str().to_owned(),
                    oauth_preset: Some(preset.as_str().to_owned()),
                    supports_personal: true,
                    supports_shared: true,
                    shared_joiner_identity: Some(SharedJoinerIdentityKind::Email),
                },
                OauthFilePreset::ICloud => ProviderReplicationCapability {
                    provider_type: provider_type.as_str().to_owned(),
                    oauth_preset: Some(preset.as_str().to_owned()),
                    supports_personal: true,
                    supports_shared: false,
                    shared_joiner_identity: None,
                },
            }
        }
    }
}

pub fn validate_provider_replication(
    provider_type: StorageProviderType,
    oauth_preset: Option<OauthFilePreset>,
    replication_type: ReplicationType,
) -> ValidationResult<ProviderReplicationCapability> {
    let capability = provider_replication_capability(provider_type, oauth_preset);
    if capability.supports(replication_type) {
        return Ok(capability);
    }
    Err(ValidationError::UnsupportedProviderReplication {
        provider_type: capability.provider_type,
        oauth_preset: capability.oauth_preset.unwrap_or_default(),
        replication_type: replication_type.as_str().to_owned(),
    })
}

pub fn validate_architecture_for_provider(
    architecture: &VaultArchitecture,
    provider_type: StorageProviderType,
    oauth_preset: Option<OauthFilePreset>,
) -> ValidationResult<ProviderReplicationCapability> {
    architecture.validate()?;
    validate_provider_replication(provider_type, oauth_preset, architecture.replication_type)
}

/// Request to grant shared provider storage to a joiner identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedStorageGrantRequest {
    pub provider_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_preset: Option<String>,
    pub joiner_identity_kind: SharedJoinerIdentityKind,
    pub joiner_identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_target_hint: Option<String>,
}

/// Outcome of preparing a shared storage grant.
///
/// Google Drive currently uses `drive.appdata`, which is not shareable via
/// Drive `permissions.create`. Until shareable storage targets exist, the
/// contract returns [`SharedStorageGrantOutcome::ManualGrantRequired`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SharedStorageGrantOutcome {
    #[serde(rename = "granted")]
    Granted {
        note: String,
    },
    #[serde(rename = "manual-grant-required")]
    ManualGrantRequired {
        #[serde(rename = "instructionsKey")]
        instructions_key: String,
        #[serde(rename = "joinerIdentity")]
        joiner_identity: String,
    },
    #[serde(rename = "unsupported")]
    Unsupported {
        #[serde(rename = "reasonKey")]
        reason_key: String,
    },
}

fn is_plausible_shared_email(value: &str) -> bool {
    let trimmed = value.trim();
    let Some((local, domain)) = trimmed.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !trimmed.chars().any(char::is_whitespace)
}

/// Validate a shared-grant request and return the grant ceremony outcome.
pub fn prepare_shared_storage_grant(
    request: &SharedStorageGrantRequest,
) -> ValidationResult<SharedStorageGrantOutcome> {
    let provider_type = StorageProviderType::parse(&request.provider_type)?;
    let oauth_preset = match request.oauth_preset.as_deref() {
        Some(preset) if !preset.trim().is_empty() => Some(OauthFilePreset::parse(preset)?),
        _ => None,
    };
    let capability =
        validate_provider_replication(provider_type, oauth_preset, ReplicationType::Shared)?;
    let identity = request.joiner_identity.trim();
    if identity.is_empty() {
        return Err(ValidationError::SharedJoinerIdentityRequired);
    }
    match request.joiner_identity_kind {
        SharedJoinerIdentityKind::Email => {
            if !is_plausible_shared_email(identity) {
                return Err(ValidationError::SharedJoinerIdentityInvalid);
            }
        }
    }
    if !capability.supports_shared {
        return Ok(SharedStorageGrantOutcome::Unsupported {
            reason_key: "architecture_modes.shared_grant_unsupported".to_owned(),
        });
    }
    Ok(SharedStorageGrantOutcome::ManualGrantRequired {
        instructions_key: "architecture_modes.shared_grant_manual_instructions".to_owned(),
        joiner_identity: identity.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_defaults_match_current_vault_behavior() {
        let architecture = VaultArchitecture::default_legacy();
        assert_eq!(architecture.device_mode, DeviceMode::Standard);
        assert_eq!(architecture.vault_type, VaultType::Simple);
        assert_eq!(architecture.replication_type, ReplicationType::Personal);
        assert!(architecture.can_create_secret());
        assert_eq!(
            architecture.onboarding_type(),
            OnboardingType::PersonalCredentialTransfer
        );
        architecture.validate().unwrap();
    }

    #[test]
    fn provider_capability_matrix_is_fail_closed() {
        validate_provider_replication(StorageProviderType::Github, None, ReplicationType::Personal)
            .unwrap();
        assert!(
            validate_provider_replication(
                StorageProviderType::Github,
                None,
                ReplicationType::Shared,
            )
            .is_err()
        );

        let gdrive = validate_provider_replication(
            StorageProviderType::OauthFile,
            Some(OauthFilePreset::GoogleDrive),
            ReplicationType::Shared,
        )
        .unwrap();
        assert_eq!(
            gdrive.shared_joiner_identity,
            Some(SharedJoinerIdentityKind::Email)
        );

        assert!(
            validate_provider_replication(
                StorageProviderType::OauthFile,
                Some(OauthFilePreset::ICloud),
                ReplicationType::Shared,
            )
            .is_err()
        );
    }

    #[test]
    fn grouped_architecture_matrix_validates_provider_replication() {
        let simple_personal = VaultArchitecture::simple_personal(DeviceMode::Standard);
        validate_architecture_for_provider(&simple_personal, StorageProviderType::Github, None)
            .unwrap();
        validate_architecture_for_provider(
            &simple_personal,
            StorageProviderType::OauthFile,
            Some(OauthFilePreset::GoogleDrive),
        )
        .unwrap();

        let simple_shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default_legacy()
        };
        assert!(
            validate_architecture_for_provider(&simple_shared, StorageProviderType::Github, None)
                .is_err()
        );
        validate_architecture_for_provider(
            &simple_shared,
            StorageProviderType::OauthFile,
            Some(OauthFilePreset::GoogleDrive),
        )
        .unwrap();

        let nexus_ready = VaultArchitecture::nexus_personal(
            DeviceMode::AntiHacker,
            NexusPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            },
        );
        validate_architecture_for_provider(&nexus_ready, StorageProviderType::Github, None)
            .unwrap();

        let nexus_shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..nexus_ready
        };
        validate_architecture_for_provider(
            &nexus_shared,
            StorageProviderType::OauthFile,
            Some(OauthFilePreset::GoogleDrive),
        )
        .unwrap();
        assert!(
            validate_architecture_for_provider(&nexus_shared, StorageProviderType::Github, None)
                .is_err()
        );
        assert!(
            validate_architecture_for_provider(
                &nexus_shared,
                StorageProviderType::OauthFile,
                Some(OauthFilePreset::ICloud),
            )
            .is_err()
        );
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
            ..VaultArchitecture::default_legacy()
        };
        assert_eq!(
            shared.onboarding_type(),
            OnboardingType::SharedProviderGrant
        );
    }

    #[test]
    fn nexus_requires_valid_threshold_and_all_participants_before_secret_creation() {
        let not_ready = VaultArchitecture::nexus_personal(
            DeviceMode::AntiHacker,
            NexusPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 2,
            },
        );
        not_ready.validate().unwrap();
        assert!(!not_ready.can_create_secret());

        let ready = VaultArchitecture::nexus_personal(
            DeviceMode::AntiHacker,
            NexusPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 3,
            },
        );
        ready.validate().unwrap();
        assert!(ready.can_create_secret());

        let invalid = VaultArchitecture::nexus_personal(
            DeviceMode::Standard,
            NexusPolicy {
                threshold: 1,
                required_participants: 1,
                ready_participants: 1,
            },
        );
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn nexus_secret_creation_requires_actual_share_records() {
        let keys = crate::generate_vault_keys().unwrap();
        let first = crate::DeviceIdentity::generate().unwrap();
        let second = crate::DeviceIdentity::generate().unwrap();
        let shares = crate::create_nexus_share_records(&keys, &[first, second], 2).unwrap();
        let ready = VaultArchitecture::nexus_personal(
            DeviceMode::Standard,
            NexusPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            },
        );

        assert!(ready.can_create_secret());
        assert!(!ready.can_create_secret_with_records(&[]));
        assert!(!ready.can_create_secret_with_records(&shares[..1]));
        assert!(ready.can_create_secret_with_records(&shares));
    }

    #[test]
    fn shared_storage_grant_requires_valid_email_and_returns_manual_ceremony() {
        let request = SharedStorageGrantRequest {
            provider_type: "oauth-file".to_owned(),
            oauth_preset: Some("google-drive".to_owned()),
            joiner_identity_kind: SharedJoinerIdentityKind::Email,
            joiner_identity: "joiner@example.com".to_owned(),
            storage_target_hint: None,
        };
        let outcome = prepare_shared_storage_grant(&request).unwrap();
        assert_eq!(
            outcome,
            SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key: "architecture_modes.shared_grant_manual_instructions"
                    .to_owned(),
                joiner_identity: "joiner@example.com".to_owned(),
            }
        );

        let missing = SharedStorageGrantRequest {
            joiner_identity: String::new(),
            ..request.clone()
        };
        assert!(matches!(
            prepare_shared_storage_grant(&missing),
            Err(ValidationError::SharedJoinerIdentityRequired)
        ));

        let github = SharedStorageGrantRequest {
            provider_type: "github".to_owned(),
            oauth_preset: None,
            ..request
        };
        assert!(prepare_shared_storage_grant(&github).is_err());
    }
}
