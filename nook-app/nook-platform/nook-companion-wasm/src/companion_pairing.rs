use nook_companion_core::{
    CompanionExtensionPairingEndpoint, CompanionPairingAdmissionEvidence,
    CompanionPairingApprovalAttempt, CompanionPairingProviderManifestDigest,
    CompanionPairingRequest, CompanionPairingRequestObservation,
    CompanionPairingWebsiteAuthorization, CompanionPairingWebsiteAuthorizationOutcome,
    CompanionWebsitePairingEndpoint, ConsumedCompanionPairingAuthority,
    PrevalidatedCompanionPairingActivation,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
pub struct NookCompanionPairingExtensionProtocol {
    inner: CompanionExtensionPairingEndpoint,
}

#[wasm_bindgen]
impl NookCompanionPairingExtensionProtocol {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(request: CompanionPairingRequest) -> Result<Self, JsError> {
        Ok(Self {
            inner: CompanionExtensionPairingEndpoint::issue(request)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    pub fn request(&self) -> Result<CompanionPairingRequest, JsError> {
        self.inner
            .request()
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn take_authority(&mut self) -> Result<NookCompanionPairingApprovalAuthority, JsError> {
        Ok(NookCompanionPairingApprovalAuthority {
            inner: self
                .inner
                .take_authority()
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }
}

#[wasm_bindgen]
pub struct NookCompanionPairingApprovalAuthority {
    inner: ConsumedCompanionPairingAuthority,
}

#[wasm_bindgen]
impl NookCompanionPairingApprovalAuthority {
    #[allow(clippy::needless_pass_by_value)]
    pub fn prevalidate(
        self,
        attempt: CompanionPairingApprovalAttempt,
        evidence: CompanionPairingAdmissionEvidence,
    ) -> Result<NookPrevalidatedCompanionPairingActivation, JsError> {
        let authorized = self
            .inner
            .authorize_approval(attempt)
            .map_err(|failure| JsError::new(&format!("{failure:?}")))?;
        Ok(NookPrevalidatedCompanionPairingActivation {
            inner: authorized
                .prevalidate(evidence)
                .map_err(|failure| JsError::new(&format!("{failure:?}")))?,
        })
    }
}

/// Opaque proof consumed only by the future activation transaction.
#[wasm_bindgen]
pub struct NookPrevalidatedCompanionPairingActivation {
    #[allow(dead_code)]
    inner: PrevalidatedCompanionPairingActivation,
}

#[wasm_bindgen]
pub struct NookCompanionPairingWebsiteProtocol {
    inner: CompanionWebsitePairingEndpoint,
}

#[wasm_bindgen]
impl NookCompanionPairingWebsiteProtocol {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(observation: CompanionPairingRequestObservation) -> Result<Self, JsError> {
        Ok(Self {
            inner: CompanionWebsitePairingEndpoint::admit(observation)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    pub fn request(&self) -> Result<CompanionPairingRequest, JsError> {
        self.inner
            .request()
            .map_err(|error| JsError::new(&error.to_string()))
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn authorize(
        &mut self,
        authorization: CompanionPairingWebsiteAuthorization,
        provider_manifest_digest: CompanionPairingProviderManifestDigest,
    ) -> CompanionPairingWebsiteAuthorizationOutcome {
        match self.inner.authorize(authorization) {
            Ok(authorized) => CompanionPairingWebsiteAuthorizationOutcome::Approved {
                approval: Box::new(authorized.approve(provider_manifest_digest)),
            },
            Err(error) => CompanionPairingWebsiteAuthorizationOutcome::Rejected {
                failure: error.into(),
            },
        }
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionPairingApproval, CompanionPairingEpochMilliseconds, CompanionPairingInstallation,
        ExtensionConnectScope, ExtensionEventCount, ExtensionPairingVaultType,
        ExtensionSyncProviderCount, ImportedExtensionEventLog,
    };

    fn epoch(value: &str) -> Result<CompanionPairingEpochMilliseconds, wasm_bindgen::JsValue> {
        serde_json::from_str(value)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
    }

    fn request() -> Result<CompanionPairingRequest, wasm_bindgen::JsValue> {
        Ok(CompanionPairingRequest {
            request_id: "request-1".to_owned(),
            nonce: "nonce-1".to_owned(),
            issued_at: epoch("100")?,
            expires_at: epoch("200")?,
            vault_type: ExtensionPairingVaultType::Simple,
            installation: CompanionPairingInstallation {
                extension_runtime_id: "runtime-1".to_owned(),
                app_id: "app-1".to_owned(),
                encryption_public_key: "age1extension".to_owned(),
                signing_public_key: "signing-1".to_owned(),
                installation_label: "Nook Extension".to_owned(),
            },
            scopes: vec![ExtensionConnectScope::VaultAccess],
        })
    }

    fn approval() -> Result<CompanionPairingApproval, wasm_bindgen::JsValue> {
        Ok(CompanionPairingApproval {
            request: request()?,
            vault_store_id: "store-1".to_owned(),
            vault_name: "Personal".to_owned(),
            approved_at: "2026-09-07T00:00:00Z".to_owned(),
            provider_manifest_digest: CompanionPairingProviderManifestDigest::parse(
                &"a".repeat(64),
            )
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?,
        })
    }

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn generated_pairing_endpoint_rejects_an_expired_request() -> Result<(), wasm_bindgen::JsValue>
    {
        let mut request = request()?;
        request.expires_at = epoch("100")?;
        assert!(NookCompanionPairingExtensionProtocol::new(request).is_err());
        Ok(())
    }

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn generated_authority_is_one_use_and_returns_opaque_admission()
    -> Result<(), wasm_bindgen::JsValue> {
        let mut protocol = NookCompanionPairingExtensionProtocol::new(request()?)?;
        let authority = protocol.take_authority()?;
        assert!(protocol.take_authority().is_err());
        let admission = authority.prevalidate(
            CompanionPairingApprovalAttempt {
                approval: approval()?,
                observed_at: epoch("150")?,
            },
            CompanionPairingAdmissionEvidence {
                imported: ImportedExtensionEventLog {
                    vault_store_id: "store-1".to_owned(),
                    event_count: ExtensionEventCount::from(1),
                    heads: vec!["head-1".to_owned()],
                    access_granted: true,
                },
                sync_provider_count: ExtensionSyncProviderCount::from(0),
                observed_at: "2026-09-07T00:00:01Z".to_owned(),
            },
        )?;
        drop(admission);
        Ok(())
    }
}
