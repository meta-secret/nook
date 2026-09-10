use nook_companion_core::{
    AdmittedCompanionPairingApproval, CompanionExtensionPairingEndpoint,
    CompanionPairingApprovalAttempt, CompanionPairingProviderManifestDigest,
    CompanionPairingRequest, CompanionPairingRequestObservation,
    CompanionPairingWebsiteAuthorization, CompanionPairingWebsiteAuthorizationOutcome,
    CompanionWebsitePairingEndpoint, ConsumedCompanionPairingAuthority,
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

    /// Request authority cannot be taken from a consumed protocol handle.
    /// ```compile_fail,E0382
    /// use nook_companion_wasm::NookCompanionPairingExtensionProtocol;
    /// fn consume_twice(protocol: NookCompanionPairingExtensionProtocol) {
    ///     let _ = protocol.take_authority();
    ///     let _ = protocol.take_authority();
    /// }
    /// ```
    pub fn take_authority(self) -> Result<NookCompanionPairingApprovalAuthority, JsError> {
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
    pub fn admit(
        self,
        attempt: CompanionPairingApprovalAttempt,
    ) -> Result<NookAdmittedCompanionPairingApproval, JsError> {
        let authorized = self
            .inner
            .authorize_approval(attempt)
            .map_err(|failure| JsError::new(&format!("{failure:?}")))?;
        Ok(NookAdmittedCompanionPairingApproval {
            inner: authorized.admit(),
        })
    }
}

/// Opaque proof that one exact approval consumed its request authority.
#[wasm_bindgen]
pub struct NookAdmittedCompanionPairingApproval {
    #[allow(dead_code)]
    inner: AdmittedCompanionPairingApproval,
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
        self,
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
        ExtensionConnectScope, ExtensionPairingVaultType,
    };

    struct PairingProtocolFixture;
    impl PairingProtocolFixture {
        fn epoch(value: &str) -> Result<CompanionPairingEpochMilliseconds, wasm_bindgen::JsValue> {
            serde_json::from_str(value)
                .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
        }

        fn request() -> Result<CompanionPairingRequest, wasm_bindgen::JsValue> {
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
                scopes: vec![ExtensionConnectScope::VaultAccess],
            })
        }

        fn approval() -> Result<CompanionPairingApproval, wasm_bindgen::JsValue> {
            Ok(CompanionPairingApproval {
                request: Self::request()?,
                vault_store_id: "store-1".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-09-07T00:00:00Z".to_owned(),
                provider_manifest_digest: CompanionPairingProviderManifestDigest::parse(
                    &"a".repeat(64),
                )
                .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?,
            })
        }
    }

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn generated_pairing_endpoint_rejects_an_expired_request() -> Result<(), wasm_bindgen::JsValue>
    {
        let mut request = PairingProtocolFixture::request()?;
        request.expires_at = PairingProtocolFixture::epoch("100")?;
        assert!(NookCompanionPairingExtensionProtocol::new(request).is_err());
        Ok(())
    }

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn generated_authority_is_one_use_and_returns_opaque_admission()
    -> Result<(), wasm_bindgen::JsValue> {
        let protocol =
            NookCompanionPairingExtensionProtocol::new(PairingProtocolFixture::request()?)?;
        let authority = protocol.take_authority()?;
        let admission = authority.admit(CompanionPairingApprovalAttempt {
            approval: PairingProtocolFixture::approval()?,
            observed_at: PairingProtocolFixture::epoch("150")?,
        })?;
        drop(admission);
        Ok(())
    }
}
