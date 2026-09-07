use crate::{ExtensionConnectScope, ExtensionPairingVaultType};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CompanionProtocolError {
    #[error("companion protocol value is empty or malformed")]
    InvalidValue,
    #[error("companion discovery request has expired")]
    DiscoveryExpired,
    #[error("companion response does not match the active request")]
    RequestMismatch,
    #[error("companion installation app key is not unlocked for this vault")]
    AppKeyUnavailable,
    #[error("companion app-key handoff does not match the discovered installation")]
    HandoffBindingMismatch,
    #[error("companion app-key handoff nonce is unavailable or already consumed")]
    NonceUnavailable,
    #[error("companion handoff context does not match the requested vault")]
    ContextMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum CompanionProtocolFailure {
    InvalidValue,
    DiscoveryExpired,
    RequestMismatch,
    AppKeyUnavailable,
    HandoffBindingMismatch,
    NonceUnavailable,
    ContextMismatch,
}

impl From<CompanionProtocolError> for CompanionProtocolFailure {
    fn from(error: CompanionProtocolError) -> Self {
        match error {
            CompanionProtocolError::InvalidValue => Self::InvalidValue,
            CompanionProtocolError::DiscoveryExpired => Self::DiscoveryExpired,
            CompanionProtocolError::RequestMismatch => Self::RequestMismatch,
            CompanionProtocolError::AppKeyUnavailable => Self::AppKeyUnavailable,
            CompanionProtocolError::HandoffBindingMismatch => Self::HandoffBindingMismatch,
            CompanionProtocolError::NonceUnavailable => Self::NonceUnavailable,
            CompanionProtocolError::ContextMismatch => Self::ContextMismatch,
        }
    }
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionInstallationAppKey {
    pub app_id: String,
    pub encryption_public_key: String,
    pub signing_public_key: String,
    pub installation_label: String,
}

impl CompanionInstallationAppKey {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        if [
            &self.app_id,
            &self.encryption_public_key,
            &self.signing_public_key,
            &self.installation_label,
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
    fn validate(
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
    fn validate(&self) -> Result<(), CompanionProtocolError> {
        if self.request_id.trim().is_empty() || self.vault_store_id.trim().is_empty() {
            return Err(CompanionProtocolError::InvalidValue);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionUnlockedAppKey {
    pub extension_runtime_id: String,
    pub app_key: CompanionInstallationAppKey,
    pub nonce: String,
    pub scopes: Vec<ExtensionConnectScope>,
}

impl CompanionUnlockedAppKey {
    fn validate(&self) -> Result<(), CompanionProtocolError> {
        self.app_key.validate()?;
        if self.extension_runtime_id.trim().is_empty()
            || self.nonce.trim().is_empty()
            || self.nonce.len() > 128
            || self.nonce.chars().any(char::is_whitespace)
            || !self.scopes.contains(&ExtensionConnectScope::VaultAccess)
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
        app_key: CompanionUnlockedAppKey,
    },
}

struct CompanionCorrelationRef<'a> {
    request_id: &'a str,
    vault_store_id: &'a str,
}

impl CompanionIdentityStatus {
    fn correlation(&self) -> CompanionCorrelationRef<'_> {
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
            } => CompanionCorrelationRef {
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
            Self::Unlocked { app_key, .. } => app_key.validate(),
            Self::Unavailable { .. } | Self::Locked { .. } | Self::DifferentVault { .. } => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields, rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum CompanionIdentityHandoffContext {
    VaultCreation { vault_store_id: String },
    PairedVault { vault_store_id: String },
    ExistingVaultImport { vault_store_id: String },
}

impl CompanionIdentityHandoffContext {
    fn vault_store_id(&self) -> &str {
        match self {
            Self::VaultCreation { vault_store_id }
            | Self::PairedVault { vault_store_id }
            | Self::ExistingVaultImport { vault_store_id } => vault_store_id,
        }
    }

    pub fn validate_for_store(&self, vault_store_id: &str) -> Result<(), CompanionProtocolError> {
        if vault_store_id.trim().is_empty() || self.vault_store_id() != vault_store_id {
            return Err(CompanionProtocolError::ContextMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionWebsiteHandoffBegin {
    pub discovery: CompanionIdentityDiscoveryObservation,
    pub status: CompanionIdentityStatus,
    pub context: CompanionIdentityHandoffContext,
}

impl CompanionWebsiteHandoffBegin {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        self.discovery
            .request
            .validate(self.discovery.observed_at)?;
        self.status.validate()?;
        let correlation = self.status.correlation();
        if correlation.request_id != self.discovery.request.request_id.as_str()
            || correlation.vault_store_id != self.discovery.request.vault_store_id.as_str()
        {
            return Err(CompanionProtocolError::RequestMismatch);
        }
        let CompanionIdentityStatus::Unlocked { vault_store_id, .. } = &self.status else {
            return Err(CompanionProtocolError::AppKeyUnavailable);
        };
        self.context.validate_for_store(vault_store_id)
    }

    pub fn prepare(
        self,
        recipient_public_key: String,
    ) -> Result<CompanionIdentityHandoffRequest, CompanionProtocolError> {
        self.validate()?;
        let CompanionIdentityStatus::Unlocked {
            request_id,
            vault_store_id,
            app_key,
        } = self.status
        else {
            return Err(CompanionProtocolError::AppKeyUnavailable);
        };
        let request = CompanionIdentityHandoffRequest {
            request_id,
            vault_store_id,
            recipient_public_key,
            nonce: app_key.nonce,
            expected_app_key: app_key.app_key,
        };
        request.validate()?;
        Ok(request)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionIdentityHandoffRequest {
    pub request_id: String,
    pub vault_store_id: String,
    pub recipient_public_key: String,
    pub nonce: String,
    pub expected_app_key: CompanionInstallationAppKey,
}

impl CompanionIdentityHandoffRequest {
    pub fn validate(&self) -> Result<(), CompanionProtocolError> {
        self.expected_app_key.validate()?;
        if self.request_id.trim().is_empty()
            || self.vault_store_id.trim().is_empty()
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
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi)]
pub enum CompanionIdentityStatusAdmission {
    Accepted {
        status: Box<CompanionIdentityStatus>,
    },
    Rejected {
        failure: CompanionProtocolFailure,
    },
}

impl CompanionIdentityStatusAdmission {
    #[must_use]
    pub fn admit(status: CompanionIdentityStatus) -> Self {
        match status.validate() {
            Ok(()) => Self::Accepted {
                status: Box::new(status),
            },
            Err(error) => Self::Rejected {
                failure: error.into(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi)]
pub enum CompanionHandoffResponseAdmission {
    Accepted {
        response: Box<CompanionIdentityHandoffResponse>,
    },
    Rejected {
        failure: CompanionProtocolFailure,
    },
}

impl CompanionHandoffResponseAdmission {
    #[must_use]
    pub fn admit(response: CompanionIdentityHandoffResponse) -> Self {
        match response.validate() {
            Ok(()) => Self::Accepted {
                response: Box::new(response),
            },
            Err(error) => Self::Rejected {
                failure: error.into(),
            },
        }
    }
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
        app_key: CompanionUnlockedAppKey,
    },
}

impl CompanionExtensionPresence {
    fn validate(&self) -> Result<(), CompanionProtocolError> {
        match self {
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
            Self::Unlocked { app_key, .. } => app_key.validate(),
            Self::Unavailable | Self::Locked { .. } => Ok(()),
        }
    }
}

#[derive(Debug)]
pub struct CompanionExtensionProtocol {
    presence: CompanionExtensionPresence,
    nonce: CompanionNonceState,
}

#[derive(Debug)]
enum CompanionNonceState {
    Unavailable,
    Available(String),
    Consumed,
}

struct CompanionCorrelation {
    request_id: String,
    vault_store_id: String,
}

impl CompanionExtensionProtocol {
    pub fn new(presence: CompanionExtensionPresence) -> Result<Self, CompanionProtocolError> {
        presence.validate()?;
        let nonce = match &presence {
            CompanionExtensionPresence::Unlocked { app_key, .. } => {
                CompanionNonceState::Available(app_key.nonce.clone())
            }
            CompanionExtensionPresence::Unavailable | CompanionExtensionPresence::Locked { .. } => {
                CompanionNonceState::Unavailable
            }
        };
        Ok(Self { presence, nonce })
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
        Ok(self.status(CompanionCorrelation {
            request_id: request.request_id,
            vault_store_id: request.vault_store_id,
        }))
    }

    pub fn unlock(
        &self,
        request: CompanionIdentityUnlockRequest,
    ) -> Result<CompanionIdentityStatus, CompanionProtocolError> {
        request.validate()?;
        Ok(self.status(CompanionCorrelation {
            request_id: request.request_id,
            vault_store_id: request.vault_store_id,
        }))
    }

    fn status(&self, correlation: CompanionCorrelation) -> CompanionIdentityStatus {
        let CompanionCorrelation {
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
            CompanionExtensionPresence::Unlocked { app_key, .. } => {
                CompanionIdentityStatus::Unlocked {
                    request_id,
                    vault_store_id,
                    app_key: app_key.clone(),
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
            app_key,
            ..
        } = &self.presence
        else {
            return Err(CompanionProtocolError::AppKeyUnavailable);
        };
        let CompanionNonceState::Available(nonce) = &self.nonce else {
            return Err(CompanionProtocolError::NonceUnavailable);
        };
        if vault_store_id != &request.vault_store_id
            || nonce != &request.nonce
            || app_key.app_key != request.expected_app_key
        {
            return Err(CompanionProtocolError::HandoffBindingMismatch);
        }
        self.nonce = CompanionNonceState::Consumed;
        Ok(AuthorizedCompanionIdentityHandoff(request))
    }
}

pub trait CompanionIdentityHandoffSealer {
    type Error;

    fn seal_companion_handoff(
        &mut self,
        request: &CompanionIdentityHandoffRequest,
    ) -> Result<String, Self::Error>;
}

pub struct AuthorizedCompanionIdentityHandoff(CompanionIdentityHandoffRequest);

impl AuthorizedCompanionIdentityHandoff {
    pub fn seal<S>(self, sealer: &mut S) -> Result<CompanionIdentityHandoffResponse, S::Error>
    where
        S: CompanionIdentityHandoffSealer,
    {
        let encrypted_envelope = sealer.seal_companion_handoff(&self.0)?;
        Ok(CompanionIdentityHandoffResponse {
            request: self.0,
            encrypted_envelope,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scenario {
        extension: CompanionExtensionProtocol,
        status: CompanionIdentityStatus,
    }

    impl Scenario {
        fn new() -> anyhow::Result<Self> {
            let app_key = CompanionUnlockedAppKey {
                extension_runtime_id: "runtime-1".to_owned(),
                app_key: CompanionInstallationAppKey {
                    app_id: "app-1".to_owned(),
                    encryption_public_key: "age1public".to_owned(),
                    signing_public_key: "signing-public".to_owned(),
                    installation_label: "Nook Extension".to_owned(),
                },
                nonce: "nonce-1".to_owned(),
                scopes: vec![ExtensionConnectScope::VaultAccess],
            };
            let extension =
                CompanionExtensionProtocol::new(CompanionExtensionPresence::Unlocked {
                    vault_type: ExtensionPairingVaultType::Simple,
                    vault_store_id: "store-1".to_owned(),
                    vault_name: "Personal".to_owned(),
                    app_key: app_key.clone(),
                })?;
            Ok(Self {
                extension,
                status: CompanionIdentityStatus::Unlocked {
                    request_id: "request-1".to_owned(),
                    vault_store_id: "store-1".to_owned(),
                    app_key,
                },
            })
        }

        fn begin(&self) -> CompanionWebsiteHandoffBegin {
            CompanionWebsiteHandoffBegin {
                discovery: CompanionIdentityDiscoveryObservation {
                    request: CompanionIdentityDiscoveryRequest {
                        request_id: "request-1".to_owned(),
                        vault_store_id: "store-1".to_owned(),
                        expires_at: CompanionEpochMilliseconds(200.0),
                    },
                    observed_at: CompanionEpochMilliseconds(100.0),
                },
                status: self.status.clone(),
                context: CompanionIdentityHandoffContext::PairedVault {
                    vault_store_id: "store-1".to_owned(),
                },
            }
        }

        fn request(&self) -> anyhow::Result<CompanionIdentityHandoffRequest> {
            Ok(self.begin().prepare("age1recipient".to_owned())?)
        }
    }

    #[test]
    fn direct_protocol_consumes_exact_app_key_authorization_once() -> anyhow::Result<()> {
        let mut scenario = Scenario::new()?;
        let request = scenario.request()?;
        scenario.extension.authorize_handoff(request.clone())?;
        assert!(matches!(
            scenario.extension.authorize_handoff(request),
            Err(CompanionProtocolError::NonceUnavailable)
        ));
        Ok(())
    }

    #[test]
    fn context_and_discovery_correlation_fail_closed() -> anyhow::Result<()> {
        let scenario = Scenario::new()?;
        let mismatched = CompanionWebsiteHandoffBegin {
            status: scenario.status.clone(),
            context: CompanionIdentityHandoffContext::PairedVault {
                vault_store_id: "store-other".to_owned(),
            },
            ..scenario.begin()
        };
        assert!(matches!(
            mismatched.prepare("age1recipient".to_owned()),
            Err(CompanionProtocolError::ContextMismatch)
        ));
        assert!(matches!(
            scenario
                .extension
                .discover(CompanionIdentityDiscoveryObservation {
                    request: CompanionIdentityDiscoveryRequest {
                        request_id: "request-1".to_owned(),
                        vault_store_id: "store-1".to_owned(),
                        expires_at: CompanionEpochMilliseconds(100.0),
                    },
                    observed_at: CompanionEpochMilliseconds(100.0),
                }),
            Err(CompanionProtocolError::DiscoveryExpired)
        ));
        Ok(())
    }

    #[test]
    fn website_rejects_mismatched_discovery_request_id() -> anyhow::Result<()> {
        let scenario = Scenario::new()?;
        let mut begin = scenario.begin();
        begin.discovery.request.request_id = "request-other".to_owned();
        assert!(matches!(
            begin.validate(),
            Err(CompanionProtocolError::RequestMismatch)
        ));
        Ok(())
    }

    #[test]
    fn website_rejects_mismatched_discovery_vault_store() -> anyhow::Result<()> {
        let scenario = Scenario::new()?;
        let mut begin = scenario.begin();
        begin.discovery.request.vault_store_id = "store-other".to_owned();
        assert!(matches!(
            begin.validate(),
            Err(CompanionProtocolError::RequestMismatch)
        ));
        Ok(())
    }

    #[test]
    fn website_rejects_a_response_observed_after_discovery_expiry() -> anyhow::Result<()> {
        let scenario = Scenario::new()?;
        let mut begin = scenario.begin();
        begin.discovery.observed_at = CompanionEpochMilliseconds(200.0);
        assert!(matches!(
            begin.validate(),
            Err(CompanionProtocolError::DiscoveryExpired)
        ));
        Ok(())
    }
}
