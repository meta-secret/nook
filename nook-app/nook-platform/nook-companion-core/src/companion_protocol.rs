//! Browser-independent website and extension companion protocol.

use crate::{
    ExtensionConnectScope, ExtensionPairingGrantApproval, ExtensionPairingVaultType,
    ExtensionVaultEventPayload,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CompanionProtocolError {
    #[error("companion protocol value is empty or malformed")]
    InvalidValue,
    #[error("companion discovery request has expired")]
    DiscoveryExpired,
    #[error("companion response does not match the active request")]
    RequestMismatch,
    #[error("companion identity is not unlocked for this vault")]
    IdentityUnavailable,
    #[error("companion identity handoff does not match the discovered device")]
    HandoffBindingMismatch,
    #[error("companion identity handoff nonce is unavailable or already consumed")]
    NonceUnavailable,
    #[error("companion event log is empty or malformed")]
    InvalidEventLog,
}

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct CompanionEpochMilliseconds(f64);

impl CompanionEpochMilliseconds {
    fn validate(self) -> Result<(), CompanionProtocolError> {
        if !self.0.is_finite()
            || self.0 <= 0.0
            || self.0.fract() != 0.0
            || self.0 > 9_007_199_254_740_991.0
        {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Ok(())
    }
}

impl From<u32> for CompanionEpochMilliseconds {
    fn from(value: u32) -> Self {
        Self(f64::from(value))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionDeviceIdentity {
    pub device_id: String,
    pub device_public_key: String,
    pub device_signing_public_key: String,
    pub device_label: String,
}

impl CompanionDeviceIdentity {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        if [
            &self.device_id,
            &self.device_public_key,
            &self.device_signing_public_key,
            &self.device_label,
        ]
        .into_iter()
        .any(|value| value.trim().is_empty())
        {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionIdentityDiscoveryRequest {
    pub request_id: String,
    pub vault_store_id: String,
    pub expires_at: CompanionEpochMilliseconds,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionIdentityDiscoveryObservation {
    pub request: CompanionIdentityDiscoveryRequest,
    pub observed_at: CompanionEpochMilliseconds,
}

impl CompanionIdentityDiscoveryRequest {
    pub fn validate(
        &self,
        observed_at: CompanionEpochMilliseconds,
    ) -> Result<(), CompanionProtocolError> {
        if self.request_id.trim().is_empty() || self.vault_store_id.trim().is_empty() {
            return Err(CompanionProtocolError::InvalidValue);
        }
        self.expires_at.validate()?;
        observed_at.validate()?;
        if self.expires_at <= observed_at {
            return Err(CompanionProtocolError::DiscoveryExpired);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionIdentityUnlockRequest {
    pub request_id: String,
    pub vault_store_id: String,
}

impl CompanionIdentityUnlockRequest {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        if self.request_id.trim().is_empty() || self.vault_store_id.trim().is_empty() {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionUnlockedIdentity {
    pub extension_runtime_id: String,
    pub identity: CompanionDeviceIdentity,
    pub nonce: String,
    pub scopes: Vec<ExtensionConnectScope>,
}

impl CompanionUnlockedIdentity {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        self.identity.validate()?;
        if self.extension_runtime_id.trim().is_empty()
            || self.nonce.trim().is_empty()
            || self.nonce.len() > 128
            || self.nonce.chars().any(char::is_whitespace)
            || self.scopes.is_empty()
        {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "status", deny_unknown_fields, rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum CompanionIdentityStatus {
    Unavailable {
        request_id: String,
        vault_store_id: String,
    },
    Locked {
        request_id: String,
        vault_store_id: String,
    },
    DifferentVault {
        request_id: String,
        vault_store_id: String,
        connected_vault_store_id: String,
        connected_vault_name: String,
    },
    Unlocked {
        request_id: String,
        vault_store_id: String,
        unlocked: CompanionUnlockedIdentity,
    },
}

impl CompanionIdentityStatus {
    fn correlation(&self) -> CompanionStatusCorrelationRef<'_> {
        match self {
            Self::Unavailable {
                request_id,
                vault_store_id,
            }
            | Self::Locked {
                request_id,
                vault_store_id,
            }
            | Self::DifferentVault {
                request_id,
                vault_store_id,
                ..
            }
            | Self::Unlocked {
                request_id,
                vault_store_id,
                ..
            } => CompanionStatusCorrelationRef {
                request_id,
                vault_store_id,
            },
        }
    }

    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        let correlation = self.correlation();
        if correlation.request_id.trim().is_empty() || correlation.vault_store_id.trim().is_empty()
        {
            return Err(CompanionProtocolError::InvalidValue);
        }
        match self {
            Self::DifferentVault {
                connected_vault_store_id,
                connected_vault_name,
                ..
            } if connected_vault_store_id.trim().is_empty()
                || connected_vault_name.trim().is_empty() =>
            {
                Err(CompanionProtocolError::InvalidValue)
            }
            Self::Unlocked { unlocked, .. } => unlocked.validate(),
            Self::Unavailable { .. } | Self::Locked { .. } | Self::DifferentVault { .. } => Ok(()),
        }
    }

    pub fn request_handoff(
        self,
        recipient_public_key: String,
    ) -> Result<CompanionIdentityHandoffRequest, CompanionProtocolError> {
        self.validate()?;
        CompanionWebsiteDiscovery(self).request_handoff(recipient_public_key)
    }

    pub fn unlocked_identity(&self) -> Result<&CompanionUnlockedIdentity, CompanionProtocolError> {
        self.validate()?;
        match self {
            Self::Unlocked { unlocked, .. } => Ok(unlocked),
            Self::Unavailable { .. } | Self::Locked { .. } | Self::DifferentVault { .. } => {
                Err(CompanionProtocolError::IdentityUnavailable)
            }
        }
    }
}

struct CompanionStatusCorrelationRef<'a> {
    request_id: &'a str,
    vault_store_id: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionIdentityHandoffRequest {
    pub vault_store_id: String,
    pub recipient_public_key: String,
    pub nonce: String,
    pub expected_identity: CompanionDeviceIdentity,
}

impl CompanionIdentityHandoffRequest {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        self.expected_identity.validate()?;
        if self.vault_store_id.trim().is_empty()
            || self.recipient_public_key.trim().is_empty()
            || self.nonce.trim().is_empty()
            || self.nonce.len() > 128
            || self.nonce.chars().any(char::is_whitespace)
        {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionIdentityHandoffResponse {
    pub request: CompanionIdentityHandoffRequest,
    pub encrypted_envelope: String,
}

impl CompanionIdentityHandoffResponse {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        self.request.validate()?;
        if self.encrypted_envelope.trim().is_empty() {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields, rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum CompanionIdentityHandoffContext {
    VaultCreation,
    PairedVault { vault_store_id: String },
    ExistingVaultImport { vault_store_id: String },
}

impl CompanionIdentityHandoffContext {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        match self {
            Self::VaultCreation => Ok(()),
            Self::PairedVault { vault_store_id } | Self::ExistingVaultImport { vault_store_id }
                if vault_store_id.trim().is_empty() =>
            {
                Err(CompanionProtocolError::InvalidValue)
            }
            Self::PairedVault { .. } | Self::ExistingVaultImport { .. } => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionIdentityHandoffFinishRequest {
    pub response: CompanionIdentityHandoffResponse,
    pub context: CompanionIdentityHandoffContext,
}

impl CompanionIdentityHandoffFinishRequest {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        self.response.validate()?;
        self.context.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum CompanionStorageProviderType {
    Local,
    LocalFolder,
    Github,
    OAuthFile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionStorageProvider {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: CompanionStorageProviderType,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct CompanionEventLogRecord {
    pub event_id: String,
    pub path: String,
    pub event: ExtensionVaultEventPayload,
}

impl CompanionEventLogRecord {
    fn validate(&self) -> Result<(), CompanionProtocolError> {
        if self.event_id.trim().is_empty() || self.path.trim().is_empty() {
            return Err(CompanionProtocolError::InvalidEventLog);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct CompanionPairingApproval {
    pub grant: ExtensionPairingGrantApproval,
    pub providers: Vec<CompanionStorageProvider>,
    pub event_log_records: Vec<CompanionEventLogRecord>,
}

impl CompanionPairingApproval {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        let mut provider_ids = HashSet::with_capacity(self.providers.len());
        if self.grant.device_id.trim().is_empty()
            || self.grant.device_public_key.trim().is_empty()
            || self.grant.device_signing_public_key.trim().is_empty()
            || self.grant.device_label.trim().is_empty()
            || self.grant.vault_store_id.trim().is_empty()
            || self.grant.vault_name.trim().is_empty()
            || self.grant.approved_at.trim().is_empty()
            || self.grant.scopes.is_empty()
            || self.providers.iter().any(|provider| {
                provider.id.trim().is_empty() || !provider_ids.insert(provider.id.as_str())
            })
            || u32::try_from(self.providers.len()).ok()
                != Some(self.grant.sync_provider_count.raw())
        {
            return Err(CompanionProtocolError::InvalidValue);
        }
        CompanionEventLogUpdate::validate_records(&self.event_log_records)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct CompanionEventLogUpdate {
    pub vault_store_id: String,
    pub event_log_records: Vec<CompanionEventLogRecord>,
}

impl CompanionEventLogUpdate {
    fn validate_records(records: &[CompanionEventLogRecord]) -> Result<(), CompanionProtocolError> {
        if records.is_empty() {
            return Err(CompanionProtocolError::InvalidEventLog);
        }
        let mut event_ids = HashSet::with_capacity(records.len());
        for record in records {
            record.validate()?;
            if !event_ids.insert(record.event_id.as_str()) {
                return Err(CompanionProtocolError::InvalidEventLog);
            }
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        if self.vault_store_id.trim().is_empty() {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Self::validate_records(&self.event_log_records)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum CompanionImportResult {
    Applied,
    Idempotent,
    EventLogAccessNotGranted,
    DeviceRevoked,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields, rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum CompanionExtensionPresence {
    Unavailable,
    Locked {
        vault_type: ExtensionPairingVaultType,
        vault_store_id: String,
        vault_name: String,
    },
    Unlocked {
        vault_type: ExtensionPairingVaultType,
        vault_store_id: String,
        vault_name: String,
        identity: CompanionUnlockedIdentity,
    },
}

impl CompanionExtensionPresence {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        match self {
            Self::Unavailable => Ok(()),
            Self::Locked {
                vault_store_id,
                vault_name,
                ..
            }
            | Self::Unlocked {
                vault_store_id,
                vault_name,
                ..
            } if vault_store_id.trim().is_empty() || vault_name.trim().is_empty() => {
                Err(CompanionProtocolError::InvalidValue)
            }
            Self::Unlocked { identity, .. } => identity.validate(),
            Self::Locked { .. } => Ok(()),
        }
    }
}

#[derive(Debug)]
pub struct CompanionExtensionProtocol {
    presence: CompanionExtensionPresence,
    nonce_state: CompanionNonceState,
}

struct CompanionStatusCorrelation {
    request_id: String,
    vault_store_id: String,
}

#[derive(Debug)]
enum CompanionNonceState {
    Unavailable,
    Available(String),
    Consumed,
}

impl CompanionExtensionProtocol {
    pub fn new(presence: CompanionExtensionPresence) -> Result<Self, CompanionProtocolError> {
        presence.validate()?;
        let nonce_state = match &presence {
            CompanionExtensionPresence::Unlocked { identity, .. } => {
                CompanionNonceState::Available(identity.nonce.clone())
            }
            CompanionExtensionPresence::Unavailable | CompanionExtensionPresence::Locked { .. } => {
                CompanionNonceState::Unavailable
            }
        };
        Ok(Self {
            presence,
            nonce_state,
        })
    }

    pub fn discover(
        &self,
        observation: CompanionIdentityDiscoveryObservation,
    ) -> Result<CompanionIdentityStatus, CompanionProtocolError> {
        let CompanionIdentityDiscoveryObservation {
            request,
            observed_at,
        } = observation;
        request.validate(observed_at)?;
        Ok(self.status(CompanionStatusCorrelation {
            request_id: request.request_id,
            vault_store_id: request.vault_store_id,
        }))
    }

    pub fn unlock(
        &self,
        request: CompanionIdentityUnlockRequest,
    ) -> Result<CompanionIdentityStatus, CompanionProtocolError> {
        request.validate()?;
        Ok(self.status(CompanionStatusCorrelation {
            request_id: request.request_id,
            vault_store_id: request.vault_store_id,
        }))
    }

    fn status(&self, correlation: CompanionStatusCorrelation) -> CompanionIdentityStatus {
        let CompanionStatusCorrelation {
            request_id,
            vault_store_id,
        } = correlation;
        match &self.presence {
            CompanionExtensionPresence::Unavailable => CompanionIdentityStatus::Unavailable {
                request_id,
                vault_store_id,
            },
            CompanionExtensionPresence::Locked {
                vault_store_id: connected,
                vault_name,
                ..
            }
            | CompanionExtensionPresence::Unlocked {
                vault_store_id: connected,
                vault_name,
                ..
            } if connected != &vault_store_id => CompanionIdentityStatus::DifferentVault {
                request_id,
                vault_store_id,
                connected_vault_store_id: connected.clone(),
                connected_vault_name: vault_name.clone(),
            },
            CompanionExtensionPresence::Locked { .. } => CompanionIdentityStatus::Locked {
                request_id,
                vault_store_id,
            },
            CompanionExtensionPresence::Unlocked { identity, .. } => {
                CompanionIdentityStatus::Unlocked {
                    request_id,
                    vault_store_id,
                    unlocked: identity.clone(),
                }
            }
        }
    }

    pub fn authorize_handoff(
        &mut self,
        request: CompanionIdentityHandoffRequest,
    ) -> Result<AuthorizedCompanionIdentityHandoff, CompanionProtocolError> {
        request.validate()?;
        let CompanionExtensionPresence::Unlocked {
            vault_store_id,
            identity,
            ..
        } = &self.presence
        else {
            return Err(CompanionProtocolError::IdentityUnavailable);
        };
        let CompanionNonceState::Available(nonce) = &self.nonce_state else {
            return Err(CompanionProtocolError::NonceUnavailable);
        };
        if vault_store_id != &request.vault_store_id
            || nonce != &request.nonce
            || identity.identity != request.expected_identity
        {
            return Err(CompanionProtocolError::HandoffBindingMismatch);
        }
        self.nonce_state = CompanionNonceState::Consumed;
        Ok(AuthorizedCompanionIdentityHandoff(request))
    }
}

#[derive(Debug)]
pub struct AuthorizedCompanionIdentityHandoff(CompanionIdentityHandoffRequest);

impl AuthorizedCompanionIdentityHandoff {
    #[must_use]
    pub fn request(&self) -> &CompanionIdentityHandoffRequest {
        &self.0
    }

    #[must_use]
    pub fn into_request(self) -> CompanionIdentityHandoffRequest {
        self.0
    }
}

#[derive(Debug)]
pub struct CompanionWebsiteProtocol {
    discovery: CompanionIdentityDiscoveryRequest,
}

impl CompanionWebsiteProtocol {
    pub fn new(
        discovery: CompanionIdentityDiscoveryRequest,
    ) -> Result<Self, CompanionProtocolError> {
        if discovery.request_id.trim().is_empty() || discovery.vault_store_id.trim().is_empty() {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Ok(Self { discovery })
    }

    pub fn accept(
        &self,
        status: CompanionIdentityStatus,
    ) -> Result<CompanionWebsiteDiscovery, CompanionProtocolError> {
        status.validate()?;
        let correlation = status.correlation();
        if correlation.request_id != self.discovery.request_id
            || correlation.vault_store_id != self.discovery.vault_store_id
        {
            return Err(CompanionProtocolError::RequestMismatch);
        }
        Ok(CompanionWebsiteDiscovery(status))
    }

    pub fn prepare_handoff(
        &self,
        preparation: CompanionWebsiteHandoffPreparation,
    ) -> Result<CompanionIdentityHandoffRequest, CompanionProtocolError> {
        self.accept(preparation.status)?
            .request_handoff(preparation.recipient_public_key)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionWebsiteHandoffPreparation {
    pub status: CompanionIdentityStatus,
    pub recipient_public_key: String,
}

#[derive(Debug)]
pub struct CompanionWebsiteDiscovery(CompanionIdentityStatus);

impl CompanionWebsiteDiscovery {
    pub fn request_handoff(
        self,
        recipient_public_key: String,
    ) -> Result<CompanionIdentityHandoffRequest, CompanionProtocolError> {
        let CompanionIdentityStatus::Unlocked {
            vault_store_id,
            unlocked,
            ..
        } = self.0
        else {
            return Err(CompanionProtocolError::IdentityUnavailable);
        };
        let request = CompanionIdentityHandoffRequest {
            vault_store_id,
            recipient_public_key,
            nonce: unlocked.nonce,
            expected_identity: unlocked.identity,
        };
        request.validate()?;
        Ok(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scenario {
        website: CompanionWebsiteProtocol,
        extension: CompanionExtensionProtocol,
        clock: CompanionEpochMilliseconds,
    }

    impl Scenario {
        fn unlocked() -> anyhow::Result<Self> {
            let request = CompanionIdentityDiscoveryRequest {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                expires_at: 200_u32.into(),
            };
            let website = CompanionWebsiteProtocol::new(request)?;
            let extension =
                CompanionExtensionProtocol::new(CompanionExtensionPresence::Unlocked {
                    vault_type: ExtensionPairingVaultType::Simple,
                    vault_store_id: "store-1".to_owned(),
                    vault_name: "Personal".to_owned(),
                    identity: CompanionUnlockedIdentity {
                        extension_runtime_id: "runtime-1".to_owned(),
                        identity: CompanionDeviceIdentity {
                            device_id: "device-1".to_owned(),
                            device_public_key: "age1public".to_owned(),
                            device_signing_public_key: "signing-public".to_owned(),
                            device_label: "Nook Extension".to_owned(),
                        },
                        nonce: "nonce-1".to_owned(),
                        scopes: vec![ExtensionConnectScope::VaultAccess],
                    },
                })?;
            Ok(Self {
                website,
                extension,
                clock: 100_u32.into(),
            })
        }

        fn handoff(&mut self) -> anyhow::Result<CompanionIdentityHandoffRequest> {
            let status = self
                .extension
                .discover(CompanionIdentityDiscoveryObservation {
                    request: self.website.discovery.clone(),
                    observed_at: self.clock,
                })?;
            let website = CompanionWebsiteProtocol::new(self.website.discovery.clone())?;
            let request = website
                .accept(status)?
                .request_handoff("age1recipient".to_owned())?;
            self.extension.authorize_handoff(request.clone())?;
            Ok(request)
        }
    }

    #[test]
    fn direct_protocol_composes_real_website_and_extension_objects() -> anyhow::Result<()> {
        let mut scenario = Scenario::unlocked()?;
        let request = scenario.handoff()?;
        assert_eq!(request.vault_store_id, "store-1");
        assert_eq!(request.expected_identity.device_id, "device-1");
        assert!(matches!(
            scenario.extension.authorize_handoff(request),
            Err(CompanionProtocolError::NonceUnavailable)
        ));
        Ok(())
    }

    #[test]
    fn discovery_is_correlated_expiring_and_vault_specific() -> anyhow::Result<()> {
        let mut scenario = Scenario::unlocked()?;
        let expired = CompanionIdentityDiscoveryRequest {
            request_id: "expired".to_owned(),
            vault_store_id: "store-1".to_owned(),
            expires_at: scenario.clock,
        };
        assert!(matches!(
            scenario
                .extension
                .discover(CompanionIdentityDiscoveryObservation {
                    request: expired,
                    observed_at: scenario.clock,
                }),
            Err(CompanionProtocolError::DiscoveryExpired)
        ));

        let different = CompanionIdentityUnlockRequest {
            request_id: "unlock".to_owned(),
            vault_store_id: "store-other".to_owned(),
        };
        assert!(matches!(
            scenario.extension.unlock(different)?,
            CompanionIdentityStatus::DifferentVault { .. }
        ));

        let status = scenario
            .extension
            .discover(CompanionIdentityDiscoveryObservation {
                request: scenario.website.discovery.clone(),
                observed_at: scenario.clock,
            })?;
        let unrelated = CompanionWebsiteProtocol::new(CompanionIdentityDiscoveryRequest {
            request_id: "other-request".to_owned(),
            vault_store_id: "store-1".to_owned(),
            expires_at: 200_u32.into(),
        })?;
        assert!(matches!(
            unrelated.accept(status),
            Err(CompanionProtocolError::RequestMismatch)
        ));
        Ok(())
    }

    #[test]
    fn handoff_fails_closed_for_identity_or_nonce_changes() -> anyhow::Result<()> {
        let scenario = Scenario::unlocked()?;
        let status = scenario
            .extension
            .discover(CompanionIdentityDiscoveryObservation {
                request: scenario.website.discovery.clone(),
                observed_at: scenario.clock,
            })?;
        let mut request = CompanionWebsiteProtocol::new(scenario.website.discovery.clone())?
            .accept(status)?
            .request_handoff("age1recipient".to_owned())?;
        request.expected_identity.device_id = "forged-device".to_owned();
        let mut extension = scenario.extension;
        assert!(matches!(
            extension.authorize_handoff(request),
            Err(CompanionProtocolError::HandoffBindingMismatch)
        ));
        Ok(())
    }

    #[test]
    fn generated_contract_names_every_protocol_relationship() {
        for (declaration, fields) in [
            (
                CompanionIdentityDiscoveryRequest::DECL,
                &["requestId", "vaultStoreId", "expiresAt"][..],
            ),
            (
                CompanionIdentityStatus::DECL,
                &["status", "different-vault", "unlocked"][..],
            ),
            (
                CompanionIdentityHandoffRequest::DECL,
                &["recipientPublicKey", "expectedIdentity", "nonce"][..],
            ),
            (
                CompanionIdentityHandoffResponse::DECL,
                &["request", "encryptedEnvelope"][..],
            ),
            (
                CompanionPairingApproval::DECL,
                &["grant", "providers", "eventLogRecords"][..],
            ),
            (
                CompanionEventLogUpdate::DECL,
                &["vaultStoreId", "eventLogRecords"][..],
            ),
        ] {
            for field in fields {
                assert!(declaration.contains(field));
            }
        }
    }

    #[test]
    fn structural_request_rejects_unknown_browser_fields() {
        let serialized = r#"{"requestId":"request-1","vaultStoreId":"store-1","expiresAt":200,"browserAuthority":true}"#;
        assert!(serde_json::from_str::<CompanionIdentityDiscoveryRequest>(serialized).is_err());
    }
}
