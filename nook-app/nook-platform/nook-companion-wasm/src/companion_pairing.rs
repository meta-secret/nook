use nook_companion_core::{
    CompanionExtensionPairingEndpoint, CompanionPairingAcknowledgementAdmission,
    CompanionPairingAcknowledgementAdmissionRequest, CompanionPairingApprovalAttempt,
    CompanionPairingFinalizationEvidence, CompanionPairingFinalizationOutcome,
    CompanionPairingProviderManifestDigest, CompanionPairingRequest,
    CompanionPairingRequestObservation, CompanionPairingWebsiteAuthorization,
    CompanionPairingWebsiteAuthorizationOutcome, CompanionWebsitePairingEndpoint,
    ConsumedCompanionPairingAuthority,
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
    pub fn finalize(
        self,
        attempt: CompanionPairingApprovalAttempt,
        evidence: CompanionPairingFinalizationEvidence,
    ) -> CompanionPairingFinalizationOutcome {
        match self.inner.authorize_approval(attempt) {
            Ok(authorized) => match authorized.finalize(evidence) {
                Ok(finalization) => CompanionPairingFinalizationOutcome::Accepted {
                    finalization: Box::new(finalization),
                },
                Err(acknowledgement) => {
                    CompanionPairingFinalizationOutcome::Rejected { acknowledgement }
                }
            },
            Err(acknowledgement) => {
                CompanionPairingFinalizationOutcome::Rejected { acknowledgement }
            }
        }
    }
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

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn admit_companion_pairing_acknowledgement(
    request: CompanionPairingAcknowledgementAdmissionRequest,
) -> CompanionPairingAcknowledgementAdmission {
    CompanionPairingAcknowledgementAdmission::admit(request)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionPairingAcknowledgement, CompanionPairingApproval, CompanionPairingCorrelation,
        CompanionPairingEpochMilliseconds, CompanionPairingFailure, CompanionPairingInstallation,
        ExtensionConnectScope, ExtensionPairingVaultType,
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
    fn generated_acknowledgement_admission_preserves_semantic_outcomes()
    -> Result<(), wasm_bindgen::JsValue> {
        let approval = approval()?;
        let correlation = CompanionPairingCorrelation {
            request_id: "request-1".to_owned(),
            nonce: "nonce-1".to_owned(),
        };
        let accepted = admit_companion_pairing_acknowledgement(
            CompanionPairingAcknowledgementAdmissionRequest {
                approval: approval.clone(),
                acknowledgement: CompanionPairingAcknowledgement::Accepted {
                    correlation: correlation.clone(),
                    vault_store_id: "store-1".to_owned(),
                },
            },
        );
        assert!(matches!(
            accepted,
            CompanionPairingAcknowledgementAdmission::PairingAccepted { .. }
        ));

        let rejected = admit_companion_pairing_acknowledgement(
            CompanionPairingAcknowledgementAdmissionRequest {
                approval: approval.clone(),
                acknowledgement: CompanionPairingAcknowledgement::Rejected {
                    correlation,
                    failure: CompanionPairingFailure::EffectFailed,
                },
            },
        );
        assert_eq!(
            rejected,
            CompanionPairingAcknowledgementAdmission::PairingRejected {
                failure: CompanionPairingFailure::EffectFailed,
            }
        );

        let mismatched = admit_companion_pairing_acknowledgement(
            CompanionPairingAcknowledgementAdmissionRequest {
                approval,
                acknowledgement: CompanionPairingAcknowledgement::Accepted {
                    correlation: CompanionPairingCorrelation {
                        request_id: "request-other".to_owned(),
                        nonce: "nonce-1".to_owned(),
                    },
                    vault_store_id: "store-1".to_owned(),
                },
            },
        );
        assert_eq!(
            mismatched,
            CompanionPairingAcknowledgementAdmission::InvalidAcknowledgement {
                failure: CompanionPairingFailure::RequestMismatch,
            }
        );
        Ok(())
    }
}
