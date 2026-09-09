#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{ExtensionConnectScope, ExtensionPairingVaultType};
use serde::{Deserialize, Deserializer, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CompanionPairingError {
    #[error("companion pairing value is empty or malformed")]
    InvalidValue,
    #[error("companion pairing request has expired")]
    RequestExpired,
    #[error("companion pairing response does not match the active request")]
    RequestMismatch,
    #[error("companion pairing authority is unavailable or already consumed")]
    AuthorityUnavailable,
    #[error("companion pairing installation does not match the issued request")]
    InstallationMismatch,
    #[error("companion pairing vault does not match the approved request")]
    VaultMismatch,
    #[error("companion pairing scopes do not match the issued request")]
    ScopeMismatch,
    #[error("companion pairing provider manifest does not match the approval")]
    ProviderManifestMismatch,
    #[error("companion pairing provider credentials do not match the installation recipient")]
    ProviderRecipientMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum CompanionPairingFailure {
    InvalidValue,
    RequestExpired,
    RequestMismatch,
    AuthorityUnavailable,
    InstallationMismatch,
    VaultMismatch,
    ScopeMismatch,
    ProviderManifestMismatch,
    ProviderRecipientMismatch,
}

impl From<CompanionPairingError> for CompanionPairingFailure {
    fn from(error: CompanionPairingError) -> Self {
        match error {
            CompanionPairingError::InvalidValue => Self::InvalidValue,
            CompanionPairingError::RequestExpired => Self::RequestExpired,
            CompanionPairingError::RequestMismatch => Self::RequestMismatch,
            CompanionPairingError::AuthorityUnavailable => Self::AuthorityUnavailable,
            CompanionPairingError::InstallationMismatch => Self::InstallationMismatch,
            CompanionPairingError::VaultMismatch => Self::VaultMismatch,
            CompanionPairingError::ScopeMismatch => Self::ScopeMismatch,
            CompanionPairingError::ProviderManifestMismatch => Self::ProviderManifestMismatch,
            CompanionPairingError::ProviderRecipientMismatch => Self::ProviderRecipientMismatch,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number", into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingEpochMilliseconds(f64);

impl CompanionPairingEpochMilliseconds {
    fn validate(self) -> Result<(), CompanionPairingError> {
        if !self.0.is_finite()
            || self.0 <= 0.0
            || self.0.fract() != 0.0
            || self.0 > 9_007_199_254_740_991.0
        {
            return Err(CompanionPairingError::InvalidValue);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for CompanionPairingEpochMilliseconds {
    fn deserialize<DeserializerType>(
        deserializer: DeserializerType,
    ) -> Result<Self, DeserializerType::Error>
    where
        DeserializerType: Deserializer<'de>,
    {
        Ok(Self(f64::deserialize(deserializer)?))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingProviderManifestDigest(String);

impl CompanionPairingProviderManifestDigest {
    pub fn parse(value: &str) -> Result<Self, CompanionPairingError> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        {
            return Err(CompanionPairingError::InvalidValue);
        }
        Ok(Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingInstallation {
    pub extension_runtime_id: String,
    pub app_id: String,
    pub encryption_public_key: String,
    pub signing_public_key: String,
    pub installation_label: String,
}

impl CompanionPairingInstallation {
    fn validate(&self) -> Result<(), CompanionPairingError> {
        if [
            &self.extension_runtime_id,
            &self.app_id,
            &self.encryption_public_key,
            &self.signing_public_key,
            &self.installation_label,
        ]
        .into_iter()
        .any(|value| value.trim().is_empty())
        {
            return Err(CompanionPairingError::InvalidValue);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingRequest {
    pub request_id: String,
    pub nonce: String,
    pub issued_at: CompanionPairingEpochMilliseconds,
    pub expires_at: CompanionPairingEpochMilliseconds,
    pub vault_type: ExtensionPairingVaultType,
    pub installation: CompanionPairingInstallation,
    pub scopes: Vec<ExtensionConnectScope>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingIssue {
    pub request_id: String,
    pub nonce: String,
    pub issued_at: CompanionPairingEpochMilliseconds,
    pub expires_at: CompanionPairingEpochMilliseconds,
    pub vault_type: ExtensionPairingVaultType,
    pub extension_runtime_id: String,
    pub installation_label: String,
    pub scopes: Vec<ExtensionConnectScope>,
}

impl CompanionPairingIssue {
    pub fn validate(&self) -> Result<(), CompanionPairingError> {
        self.issued_at.validate()?;
        self.expires_at.validate()?;
        if self.request_id.trim().is_empty()
            || self.nonce.trim().is_empty()
            || self.nonce.len() > 128
            || self.nonce.chars().any(char::is_whitespace)
            || self.extension_runtime_id.trim().is_empty()
            || self.installation_label.trim().is_empty()
            || self.expires_at <= self.issued_at
        {
            return Err(CompanionPairingError::InvalidValue);
        }
        if !CompanionPairingRequest::scopes_are_valid(&self.scopes) {
            return Err(CompanionPairingError::ScopeMismatch);
        }
        Ok(())
    }

    #[must_use]
    pub fn bind(self, installation: CompanionPairingInstallation) -> CompanionPairingRequest {
        CompanionPairingRequest {
            request_id: self.request_id,
            nonce: self.nonce,
            issued_at: self.issued_at,
            expires_at: self.expires_at,
            vault_type: self.vault_type,
            installation: CompanionPairingInstallation {
                extension_runtime_id: self.extension_runtime_id,
                installation_label: self.installation_label,
                ..installation
            },
            scopes: self.scopes,
        }
    }
}

impl CompanionPairingRequest {
    fn scopes_are_valid(scopes: &[ExtensionConnectScope]) -> bool {
        !scopes.is_empty()
            && scopes.contains(&ExtensionConnectScope::VaultAccess)
            && !scopes
                .iter()
                .enumerate()
                .any(|(index, scope)| scopes[..index].contains(scope))
    }

    fn validate_at(
        &self,
        observed_at: CompanionPairingEpochMilliseconds,
    ) -> Result<(), CompanionPairingError> {
        self.issued_at.validate()?;
        self.expires_at.validate()?;
        observed_at.validate()?;
        self.installation.validate()?;
        if self.request_id.trim().is_empty()
            || self.nonce.trim().is_empty()
            || self.nonce.len() > 128
            || self.nonce.chars().any(char::is_whitespace)
            || self.issued_at > observed_at
        {
            return Err(CompanionPairingError::InvalidValue);
        }
        if self.expires_at <= observed_at {
            return Err(CompanionPairingError::RequestExpired);
        }
        if !Self::scopes_are_valid(&self.scopes) {
            return Err(CompanionPairingError::ScopeMismatch);
        }
        Ok(())
    }

    fn binding_error(&self, actual: &Self) -> Option<CompanionPairingError> {
        if self.request_id != actual.request_id
            || self.nonce != actual.nonce
            || self.issued_at != actual.issued_at
            || self.expires_at != actual.expires_at
            || self.vault_type != actual.vault_type
        {
            return Some(CompanionPairingError::RequestMismatch);
        }
        if self.installation != actual.installation {
            return Some(CompanionPairingError::InstallationMismatch);
        }
        if self.scopes != actual.scopes {
            return Some(CompanionPairingError::ScopeMismatch);
        }
        None
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingRequestObservation {
    pub request: CompanionPairingRequest,
    pub observed_at: CompanionPairingEpochMilliseconds,
}

impl CompanionPairingRequestObservation {
    fn validate(&self) -> Result<(), CompanionPairingError> {
        self.request.validate_at(self.observed_at)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingWebsiteAuthorization {
    pub request: CompanionPairingRequest,
    pub observed_at: CompanionPairingEpochMilliseconds,
    pub vault_store_id: String,
    pub vault_name: String,
    pub approved_at: String,
}

impl CompanionPairingWebsiteAuthorization {
    fn validate_for(
        &self,
        expected: &CompanionPairingRequest,
    ) -> Result<(), CompanionPairingError> {
        self.request.validate_at(self.observed_at)?;
        if let Some(error) = expected.binding_error(&self.request) {
            return Err(error);
        }
        if self.vault_store_id.trim().is_empty()
            || self.vault_name.trim().is_empty()
            || self.approved_at.trim().is_empty()
        {
            return Err(CompanionPairingError::InvalidValue);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingApproval {
    pub request: CompanionPairingRequest,
    pub vault_store_id: String,
    pub vault_name: String,
    pub approved_at: String,
    pub provider_manifest_digest: CompanionPairingProviderManifestDigest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi)]
pub enum CompanionPairingWebsiteAuthorizationOutcome {
    Approved {
        approval: Box<CompanionPairingApproval>,
    },
    Rejected {
        failure: CompanionPairingFailure,
    },
}

impl CompanionPairingApproval {
    fn validate_at(
        &self,
        observed_at: CompanionPairingEpochMilliseconds,
    ) -> Result<(), CompanionPairingError> {
        self.request.validate_at(observed_at)?;
        Self::validate_manifest_digest(&self.provider_manifest_digest)?;
        if self.vault_store_id.trim().is_empty()
            || self.vault_name.trim().is_empty()
            || self.approved_at.trim().is_empty()
        {
            return Err(CompanionPairingError::InvalidValue);
        }
        Ok(())
    }

    fn validate_manifest_digest(
        digest: &CompanionPairingProviderManifestDigest,
    ) -> Result<(), CompanionPairingError> {
        CompanionPairingProviderManifestDigest::parse(digest.as_str()).map(|_| ())
    }

    /// Revalidates approval freshness and structure at an effect boundary.
    pub fn revalidate_at(
        &self,
        observed_at: CompanionPairingEpochMilliseconds,
    ) -> Result<(), CompanionPairingError> {
        self.validate_at(observed_at)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CompanionPairingApprovalAttempt {
    pub approval: CompanionPairingApproval,
    pub observed_at: CompanionPairingEpochMilliseconds,
}

#[derive(Debug)]
pub struct CompanionWebsitePairingEndpoint {
    request: Box<CompanionPairingRequest>,
    admitted_at: CompanionPairingEpochMilliseconds,
}

impl CompanionWebsitePairingEndpoint {
    pub fn admit(
        observation: CompanionPairingRequestObservation,
    ) -> Result<Self, CompanionPairingError> {
        observation.validate()?;
        Ok(Self {
            request: Box::new(observation.request),
            admitted_at: observation.observed_at,
        })
    }

    pub fn request(&self) -> Result<CompanionPairingRequest, CompanionPairingError> {
        Ok(self.request.as_ref().clone())
    }

    pub fn authorize(
        self,
        authorization: CompanionPairingWebsiteAuthorization,
    ) -> Result<AuthorizedCompanionWebsitePairing, CompanionPairingError> {
        let expected = self.request;
        if authorization.observed_at < self.admitted_at {
            return Err(CompanionPairingError::InvalidValue);
        }
        authorization.validate_for(&expected)?;
        Ok(AuthorizedCompanionWebsitePairing(authorization))
    }
}

#[derive(Debug)]
pub struct AuthorizedCompanionWebsitePairing(CompanionPairingWebsiteAuthorization);

impl AuthorizedCompanionWebsitePairing {
    #[must_use]
    pub fn request(&self) -> &CompanionPairingRequest {
        &self.0.request
    }

    #[must_use]
    pub fn vault_store_id(&self) -> &str {
        &self.0.vault_store_id
    }

    #[must_use]
    pub fn vault_name(&self) -> &str {
        &self.0.vault_name
    }

    #[must_use]
    pub fn approve(
        self,
        provider_manifest_digest: CompanionPairingProviderManifestDigest,
    ) -> CompanionPairingApproval {
        CompanionPairingApproval {
            request: self.0.request,
            vault_store_id: self.0.vault_store_id,
            vault_name: self.0.vault_name,
            approved_at: self.0.approved_at,
            provider_manifest_digest,
        }
    }
}

/// Taking approval authority consumes this endpoint.
///
/// ```compile_fail,E0382
/// use nook_companion_core::CompanionExtensionPairingEndpoint;
/// let replay = |endpoint: CompanionExtensionPairingEndpoint| {
///     endpoint.take_authority();
///     endpoint.take_authority()
/// };
/// ```
#[derive(Debug)]
pub struct CompanionExtensionPairingEndpoint {
    request: Box<CompanionPairingRequest>,
}

impl CompanionExtensionPairingEndpoint {
    pub fn issue(request: CompanionPairingRequest) -> Result<Self, CompanionPairingError> {
        request.validate_at(request.issued_at)?;
        Ok(Self {
            request: Box::new(request),
        })
    }

    pub fn request(&self) -> Result<CompanionPairingRequest, CompanionPairingError> {
        Ok(self.request.as_ref().clone())
    }

    pub fn take_authority(
        self,
    ) -> Result<ConsumedCompanionPairingAuthority, CompanionPairingError> {
        Ok(ConsumedCompanionPairingAuthority(self.request))
    }
}

#[derive(Debug)]
pub struct ConsumedCompanionPairingAuthority(Box<CompanionPairingRequest>);

impl ConsumedCompanionPairingAuthority {
    pub fn authorize_approval(
        self,
        attempt: CompanionPairingApprovalAttempt,
    ) -> Result<AuthorizedCompanionPairingApproval, CompanionPairingFailure> {
        let expected = self.0;
        if let Err(error) = attempt.approval.validate_at(attempt.observed_at) {
            return Err(error.into());
        }
        if let Some(error) = expected.binding_error(&attempt.approval.request) {
            return Err(error.into());
        }
        Ok(AuthorizedCompanionPairingApproval(attempt.approval))
    }
}

#[derive(Debug)]
pub struct AuthorizedCompanionPairingApproval(CompanionPairingApproval);

impl AuthorizedCompanionPairingApproval {
    #[must_use]
    pub fn approval(&self) -> &CompanionPairingApproval {
        &self.0
    }

    #[must_use]
    pub fn admit(self) -> AdmittedCompanionPairingApproval {
        AdmittedCompanionPairingApproval { _approval: self.0 }
    }
}

/// Opaque proof that one exact pairing approval consumed its request authority.
#[derive(Debug)]
pub struct AdmittedCompanionPairingApproval {
    _approval: CompanionPairingApproval,
}

#[cfg(test)]
mod tests {
    use super::*;

    struct PairingFixture;

    impl PairingFixture {
        fn epoch(value: &str) -> anyhow::Result<CompanionPairingEpochMilliseconds> {
            Ok(serde_json::from_str(value)?)
        }

        fn provider_manifest_digest() -> anyhow::Result<CompanionPairingProviderManifestDigest> {
            Ok(CompanionPairingProviderManifestDigest::parse(
                &"a".repeat(64),
            )?)
        }

        fn request() -> anyhow::Result<CompanionPairingRequest> {
            Ok(CompanionPairingRequest {
                request_id: "request-1".to_owned(),
                nonce: "nonce-1".to_owned(),
                issued_at: Self::epoch("100")?,
                expires_at: Self::epoch("200")?,
                vault_type: ExtensionPairingVaultType::Simple,
                installation: CompanionPairingInstallation {
                    extension_runtime_id: "runtime-1".to_owned(),
                    app_id: "app-1".to_owned(),
                    encryption_public_key: "age1extension".to_owned(),
                    signing_public_key: "signing-1".to_owned(),
                    installation_label: "Nook Extension".to_owned(),
                },
                scopes: vec![
                    ExtensionConnectScope::VaultAccess,
                    ExtensionConnectScope::PasswordFilling,
                    ExtensionConnectScope::SyncProviderCredentials,
                ],
            })
        }

        fn authorization() -> anyhow::Result<CompanionPairingWebsiteAuthorization> {
            Ok(CompanionPairingWebsiteAuthorization {
                request: Self::request()?,
                observed_at: Self::epoch("150")?,
                vault_store_id: "store-1".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-09-07T00:00:00Z".to_owned(),
            })
        }

        fn approval() -> anyhow::Result<CompanionPairingApproval> {
            Ok(CompanionPairingApproval {
                request: Self::request()?,
                vault_store_id: "store-1".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-09-07T00:00:00Z".to_owned(),
                provider_manifest_digest: Self::provider_manifest_digest()?,
            })
        }

        fn assert_invalid_epoch_domains() -> anyhow::Result<()> {
            for invalid in ["0", "-1", "1.5", "9007199254740992"] {
                let wire = serde_json::to_string(&Self::request()?)?
                    .replace("\"issuedAt\":100.0", &format!("\"issuedAt\":{invalid}"));
                let request: CompanionPairingRequest = serde_json::from_str(&wire)?;
                let Err(error) = CompanionExtensionPairingEndpoint::issue(request) else {
                    return Err(anyhow::anyhow!("invalid epoch was admitted"));
                };
                assert_eq!(error, CompanionPairingError::InvalidValue);
                assert_eq!(
                    CompanionPairingFailure::from(error),
                    CompanionPairingFailure::InvalidValue
                );
            }
            let mut request = Self::request()?;
            request.issued_at = CompanionPairingEpochMilliseconds(f64::NAN);
            assert!(matches!(
                CompanionExtensionPairingEndpoint::issue(request),
                Err(CompanionPairingError::InvalidValue)
            ));
            Ok(())
        }

        fn assert_approval_revalidation() -> anyhow::Result<()> {
            let approval = Self::approval()?;
            approval.revalidate_at(Self::epoch("175")?)?;
            assert!(matches!(
                approval.revalidate_at(Self::epoch("200")?),
                Err(CompanionPairingError::RequestExpired)
            ));
            Ok(())
        }
    }

    #[test]
    fn epoch_wire_values_receive_typed_domain_rejection() -> anyhow::Result<()> {
        PairingFixture::assert_invalid_epoch_domains()
    }

    #[test]
    fn approval_revalidates_at_effect_time() -> anyhow::Result<()> {
        PairingFixture::assert_approval_revalidation()
    }

    #[test]
    fn real_endpoints_compose_without_transport() -> anyhow::Result<()> {
        let request = PairingFixture::request()?;
        let mut extension = CompanionExtensionPairingEndpoint::issue(request.clone())?;
        let website = CompanionWebsitePairingEndpoint::admit(CompanionPairingRequestObservation {
            request,
            observed_at: PairingFixture::epoch("125")?,
        })?;
        let approval = website
            .authorize(PairingFixture::authorization()?)?
            .approve(PairingFixture::provider_manifest_digest()?);
        let authority = extension.take_authority()?;
        let authorized = authority
            .authorize_approval(CompanionPairingApprovalAttempt {
                approval,
                observed_at: PairingFixture::epoch("175")?,
            })
            .map_err(|failure| anyhow::anyhow!("{failure:?}"))?;
        let _admitted = authorized.admit();
        Ok(())
    }

    #[test]
    fn invalid_request_admission_does_not_create_an_endpoint() -> anyhow::Result<()> {
        let mut malformed = PairingFixture::request()?;
        malformed.scopes.push(ExtensionConnectScope::VaultAccess);
        assert!(matches!(
            CompanionWebsitePairingEndpoint::admit(CompanionPairingRequestObservation {
                request: malformed,
                observed_at: PairingFixture::epoch("125")?,
            }),
            Err(CompanionPairingError::ScopeMismatch)
        ));
        let mut expired = PairingFixture::request()?;
        expired.expires_at = PairingFixture::epoch("125")?;
        assert!(matches!(
            CompanionWebsitePairingEndpoint::admit(CompanionPairingRequestObservation {
                request: expired,
                observed_at: PairingFixture::epoch("125")?,
            }),
            Err(CompanionPairingError::RequestExpired)
        ));
        Ok(())
    }

    #[test]
    fn every_terminal_attempt_consumes_extension_authority() -> anyhow::Result<()> {
        for failure in [
            CompanionPairingFailure::RequestMismatch,
            CompanionPairingFailure::RequestExpired,
            CompanionPairingFailure::InvalidValue,
            CompanionPairingFailure::InstallationMismatch,
            CompanionPairingFailure::ScopeMismatch,
        ] {
            let endpoint = CompanionExtensionPairingEndpoint::issue(PairingFixture::request()?)?;
            let authority = endpoint.take_authority()?;
            // Taking authority consumes the endpoint; replay is a compile-time error.
            let mut attempt = CompanionPairingApprovalAttempt {
                approval: PairingFixture::approval()?,
                observed_at: PairingFixture::epoch("175")?,
            };
            match failure {
                CompanionPairingFailure::RequestMismatch => {
                    attempt.approval.request.nonce = "nonce-other".to_owned();
                }
                CompanionPairingFailure::RequestExpired => {
                    attempt.observed_at = PairingFixture::epoch("200")?;
                }
                CompanionPairingFailure::InvalidValue => attempt.approval.vault_name.clear(),
                CompanionPairingFailure::InstallationMismatch => {
                    attempt.approval.request.installation.app_id = "app-other".to_owned();
                }
                CompanionPairingFailure::ScopeMismatch => {
                    attempt.approval.request.scopes.pop();
                }
                _ => anyhow::bail!("unsupported terminal failure fixture"),
            }
            let Err(rejected) = authority.authorize_approval(attempt) else {
                anyhow::bail!("terminal attempt was accepted");
            };
            assert_eq!(rejected, failure);
        }
        Ok(())
    }

    #[test]
    fn dropped_consumed_authority_cannot_be_recovered() -> anyhow::Result<()> {
        let endpoint = CompanionExtensionPairingEndpoint::issue(PairingFixture::request()?)?;
        drop(endpoint.take_authority()?);
        // Taking authority consumes the endpoint; replay is a compile-time error.
        Ok(())
    }

    #[test]
    fn website_authorization_consumes_the_endpoint_on_rejection() -> anyhow::Result<()> {
        let request = PairingFixture::request()?;
        let endpoint =
            CompanionWebsitePairingEndpoint::admit(CompanionPairingRequestObservation {
                request,
                observed_at: PairingFixture::epoch("125")?,
            })?;
        let mut mismatched = PairingFixture::authorization()?;
        mismatched.request.installation.extension_runtime_id = "runtime-other".to_owned();
        match endpoint.authorize(mismatched) {
            Err(CompanionPairingError::InstallationMismatch) => {}
            Err(other) => anyhow::bail!("unexpected authorization failure: {other:?}"),
            Ok(_) => anyhow::bail!("mismatched authorization was accepted"),
        }
        Ok(())
    }
}
