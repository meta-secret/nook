//! Rust-owned vault architecture mode taxonomy and compatibility matrix.
//!
//! The grouped model deliberately keeps local device protection, vault key
//! access, sync-provider replication trust, onboarding ceremony, and provider
//! capability as separate concerns. UI and WASM callers should ask this module
//! for decisions instead of re-encoding the matrix in TypeScript.

use crate::errors::{ValidationError, ValidationResult};
use crate::{
    OauthFilePreset, StorageProviderType, StoredSecretRecord, is_sentinel_share_stored_record,
};
use serde::{Deserialize, Deserializer, Serialize, de::Error as DeError};
use std::collections::BTreeSet;
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
    ///
    /// Wire value is `"sentinel"`. Legacy vaults may still deserialize `"nexus"`.
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
            "sentinel" | "nexus" => Ok(Self::Sentinel),
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
pub struct SentinelPolicy {
    pub threshold: u8,
    pub required_participants: u8,
    #[serde(default)]
    pub ready_participants: u8,
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
    /// Legacy read compatibility. New vault genesis does not select or derive
    /// behavior from replication; providers are configured after creation.
    #[serde(default, skip_serializing_if = "replication_is_legacy_default")]
    pub replication_type: ReplicationType,
    /// Sentinel quorum policy. Wire key is `sentinel`; legacy YAML may use `nexus`.
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "nexus")]
    pub sentinel: Option<SentinelPolicy>,
}

#[allow(clippy::trivially_copy_pass_by_ref)] // serde skip_serializing_if requires &T.
fn replication_is_legacy_default(value: &ReplicationType) -> bool {
    *value == ReplicationType::Personal
}

impl Default for VaultArchitecture {
    fn default() -> Self {
        Self {
            device_mode: DeviceMode::Standard,
            vault_type: VaultType::Simple,
            replication_type: ReplicationType::Personal,
            sentinel: None,
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
            sentinel: None,
        }
    }

    #[must_use]
    pub fn sentinel_personal(device_mode: DeviceMode, policy: SentinelPolicy) -> Self {
        Self {
            device_mode,
            vault_type: VaultType::Sentinel,
            replication_type: ReplicationType::Personal,
            sentinel: Some(policy),
        }
    }

    pub fn validate(&self) -> ValidationResult<()> {
        match self.vault_type {
            VaultType::Simple => {
                if self.sentinel.is_some() {
                    return Err(ValidationError::SimpleVaultHasSentinelPolicy);
                }
            }
            VaultType::Sentinel => {
                let policy = self.sentinel.unwrap_or_default();
                policy.validate()?;
            }
        }
        Ok(())
    }

    /// Validate architecture invariants that depend on persisted vault records.
    ///
    /// A nexus vault must never carry a full per-device vault-key envelope. Once
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
                .starts_with(crate::NEXUS_SHARE_RECORD_PREFIX)
                && !matches!(&classified, crate::VaultMetaRecord::NexusShare(..))
            {
                return Err(ValidationError::InvalidSentinelShareSet);
            }
            match classified {
                crate::VaultMetaRecord::Auth(..) => has_auth = true,
                crate::VaultMetaRecord::NexusShare(device_id, share) => {
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
                    Err(ValidationError::SimpleVaultHasNexusShares)
                }
            }
            VaultType::Sentinel => {
                if has_auth {
                    return Err(ValidationError::SentinelVaultHasFullKeyEnvelopes);
                }
                if shares.is_empty() {
                    return if self.sentinel.unwrap_or_default().ready_participants == 0 {
                        Ok(())
                    } else {
                        Err(ValidationError::InvalidSentinelShareSet)
                    };
                }

                let policy = self.sentinel.unwrap_or_default();
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
            VaultType::Sentinel => self.sentinel.unwrap_or_default().is_ready(),
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
        self.vault_type == VaultType::Sentinel && self.sentinel.unwrap_or_default().is_ready()
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
///
/// `access_token` is optional at the Rust validation boundary. The WASM layer
/// uses it to call Drive `files.create` + `permissions.create` and may upgrade
/// a validated request into [`SharedStorageGrantOutcome::Granted`].
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
    /// Owner OAuth access token (WASM Drive grant only; ignored by Rust).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
}

/// Outcome of preparing a shared storage grant.
///
/// Rust validation is ceremony-agnostic: Google Drive shared replication is
/// capable, so core returns [`SharedStorageGrantOutcome::ManualGrantRequired`]
/// when no shareable folder id is produced here. The WASM layer performs the
/// real `drive.file` folder create + `permissions.create` grant and returns
/// [`SharedStorageGrantOutcome::Granted`] with `storage_target_id` on success.
/// `ManualGrantRequired` remains the fallback when the Drive API fails or the
/// token lacks `drive.file`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SharedStorageGrantOutcome {
    #[serde(rename = "granted")]
    Granted {
        note: String,
        #[serde(rename = "storageTargetId")]
        storage_target_id: String,
        #[serde(
            rename = "storageTargetName",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        storage_target_name: Option<String>,
    },
    #[serde(rename = "manual-grant-required")]
    ManualGrantRequired {
        #[serde(rename = "instructionsKey")]
        instructions_key: String,
        #[serde(rename = "joinerIdentity")]
        joiner_identity: String,
        #[serde(
            rename = "storageTargetId",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        storage_target_id: Option<String>,
        #[serde(
            rename = "storageTargetName",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        storage_target_name: Option<String>,
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
///
/// Capability lookup is ceremony-agnostic: providers that cannot share return
/// [`SharedStorageGrantOutcome::Unsupported`] (typed soft failure for UI copy)
/// rather than [`ValidationError::UnsupportedProviderReplication`]. Identity
/// validation still fails closed with hard errors.
pub fn prepare_shared_storage_grant(
    request: &SharedStorageGrantRequest,
) -> ValidationResult<SharedStorageGrantOutcome> {
    let provider_type = StorageProviderType::parse(&request.provider_type)?;
    let oauth_preset = match request.oauth_preset.as_deref() {
        Some(preset) if !preset.trim().is_empty() => Some(OauthFilePreset::parse(preset)?),
        _ => None,
    };
    let capability = provider_replication_capability(provider_type, oauth_preset);
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
        storage_target_id: None,
        storage_target_name: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_architecture_omits_legacy_personal_replication_but_reads_it() {
        let architecture = VaultArchitecture::simple_personal(DeviceMode::Standard);
        let encoded = serde_json::to_value(&architecture).unwrap();
        assert!(encoded.get("replication_type").is_none());
        let decoded: VaultArchitecture = serde_json::from_value(serde_json::json!({
            "device_mode": "standard",
            "vault_type": "simple",
            "replication_type": "personal"
        }))
        .unwrap();
        assert_eq!(decoded, architecture);
    }

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

        let nexus_ready = VaultArchitecture::sentinel_personal(
            DeviceMode::AntiHacker,
            SentinelPolicy {
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
        let not_ready = VaultArchitecture::sentinel_personal(
            DeviceMode::AntiHacker,
            SentinelPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 2,
            },
        );
        not_ready.validate().unwrap();
        assert!(!not_ready.can_create_secret());

        let ready = VaultArchitecture::sentinel_personal(
            DeviceMode::AntiHacker,
            SentinelPolicy {
                threshold: 2,
                required_participants: 3,
                ready_participants: 3,
            },
        );
        ready.validate().unwrap();
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
    }

    #[test]
    fn nexus_secret_creation_requires_actual_share_records() {
        let keys = crate::generate_vault_keys().unwrap();
        let first = crate::DeviceIdentity::generate().unwrap();
        let second = crate::DeviceIdentity::generate().unwrap();
        let shares = crate::create_sentinel_share_records(&keys, &[first, second], 2).unwrap();
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
    }

    #[test]
    fn nexus_record_validation_rejects_full_key_envelopes_and_mixed_share_sets() {
        let keys = crate::generate_vault_keys().unwrap();
        let first = crate::DeviceIdentity::generate().unwrap();
        let second = crate::DeviceIdentity::generate().unwrap();
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            },
        );
        let shares =
            crate::create_sentinel_share_records(&keys, &[first.clone(), second.clone()], 2)
                .unwrap();
        architecture.validate_records(&shares).unwrap();

        let auth =
            crate::genesis_auth_record(&first, &keys.secrets_key, &keys.members_key).unwrap();
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
            crate::parse_sentinel_share_envelope(duplicate_index[0].value.as_str()).unwrap();
        let mut second_envelope =
            crate::parse_sentinel_share_envelope(duplicate_index[1].value.as_str()).unwrap();
        second_envelope.share_index = first_envelope.share_index;
        duplicate_index[1].value = crate::StoredRecordPayload::from_trusted(
            serde_json::to_string(&second_envelope).unwrap(),
        );
        assert_eq!(
            architecture.validate_records(&duplicate_index),
            Err(ValidationError::InvalidSentinelShareSet)
        );
    }

    #[test]
    fn simple_record_validation_rejects_nexus_shares() {
        let keys = crate::generate_vault_keys().unwrap();
        let first = crate::DeviceIdentity::generate().unwrap();
        let second = crate::DeviceIdentity::generate().unwrap();
        let shares = crate::create_sentinel_share_records(&keys, &[first, second], 2).unwrap();
        assert_eq!(
            VaultArchitecture::default_legacy().validate_records(&shares),
            Err(ValidationError::SimpleVaultHasNexusShares)
        );
    }

    #[test]
    fn malformed_nexus_share_prefix_fails_closed_for_every_vault_type() {
        let malformed = StoredSecretRecord {
            key: crate::SecretId::from_vault_record("nexus_share:0123456789abcdef"),
            secret_type: None,
            value: crate::StoredRecordPayload::from_trusted("not-a-share-envelope".to_owned()),
        };
        let nexus = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 0,
            },
        );

        assert_eq!(
            nexus.validate_records(std::slice::from_ref(&malformed)),
            Err(ValidationError::InvalidSentinelShareSet)
        );
        assert_eq!(
            VaultArchitecture::default_legacy().validate_records(&[malformed]),
            Err(ValidationError::InvalidSentinelShareSet)
        );
    }

    #[test]
    fn shared_storage_grant_requires_valid_email_and_returns_manual_ceremony() {
        // Core validates only; WASM upgrades ManualGrantRequired → Granted after
        // Drive folder create + permissions.create succeed.
        let request = SharedStorageGrantRequest {
            provider_type: "oauth-file".to_owned(),
            oauth_preset: Some("google-drive".to_owned()),
            joiner_identity_kind: SharedJoinerIdentityKind::Email,
            joiner_identity: "joiner@example.com".to_owned(),
            storage_target_hint: None,
            access_token: Some("ya29.owner-token".to_owned()),
        };
        let outcome = prepare_shared_storage_grant(&request).unwrap();
        assert_eq!(
            outcome,
            SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key: "architecture_modes.shared_grant_manual_instructions".to_owned(),
                joiner_identity: "joiner@example.com".to_owned(),
                storage_target_id: None,
                storage_target_name: None,
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
        assert_eq!(
            prepare_shared_storage_grant(&github).unwrap(),
            SharedStorageGrantOutcome::Unsupported {
                reason_key: "architecture_modes.shared_grant_unsupported".to_owned(),
            }
        );
    }

    #[test]
    fn shared_storage_grant_granted_outcome_carries_storage_target() {
        let granted = SharedStorageGrantOutcome::Granted {
            note: "Shared Drive folder ready.".to_owned(),
            storage_target_id: "folder-abc".to_owned(),
            storage_target_name: Some("Nook shared vault".to_owned()),
        };
        let json = serde_json::to_value(&granted).unwrap();
        assert_eq!(json["kind"], "granted");
        assert_eq!(json["storageTargetId"], "folder-abc");
        assert_eq!(json["storageTargetName"], "Nook shared vault");
        let roundtrip: SharedStorageGrantOutcome = serde_json::from_value(json).unwrap();
        assert_eq!(roundtrip, granted);
    }

    #[test]
    fn shared_storage_manual_grant_preserves_created_target() {
        let manual = SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key: "architecture_modes.shared_grant_manual_instructions".to_owned(),
            joiner_identity: "joiner@example.com".to_owned(),
            storage_target_id: Some("folder-created-before-permission-failed".to_owned()),
            storage_target_name: Some("Nook shared vault".to_owned()),
        };
        let json = serde_json::to_value(&manual).unwrap();
        assert_eq!(json["kind"], "manual-grant-required");
        assert_eq!(
            json["storageTargetId"],
            "folder-created-before-permission-failed"
        );
        assert_eq!(json["storageTargetName"], "Nook shared vault");
        let roundtrip: SharedStorageGrantOutcome = serde_json::from_value(json).unwrap();
        assert_eq!(roundtrip, manual);
    }
}
