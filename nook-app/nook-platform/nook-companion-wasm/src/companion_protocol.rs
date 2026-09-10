use nook_companion_core::{
    CompanionExtensionPresence, CompanionExtensionProtocol, CompanionHandoffResponseAdmission,
    CompanionIdentityDiscoveryObservation, CompanionIdentityHandoffResponse,
    CompanionIdentityStatus, CompanionIdentityStatusAdmission,
    CompanionIdentityStatusAdmissionRequest, CompanionIdentityUnlockRequest,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
pub struct NookCompanionExtensionProtocol {
    inner: CompanionExtensionProtocol,
}

#[wasm_bindgen]
impl NookCompanionExtensionProtocol {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(presence: CompanionExtensionPresence) -> Result<Self, JsError> {
        Ok(Self {
            inner: CompanionExtensionProtocol::new(presence)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn discover(
        &self,
        observation: CompanionIdentityDiscoveryObservation,
    ) -> Result<CompanionIdentityStatus, JsError> {
        self.inner
            .discover(observation)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn unlock(
        &self,
        request: CompanionIdentityUnlockRequest,
    ) -> Result<CompanionIdentityStatus, JsError> {
        self.inner
            .unlock(request)
            .map_err(|error| JsError::new(&error.to_string()))
    }
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn admit_companion_identity_status(
    request: CompanionIdentityStatusAdmissionRequest,
) -> CompanionIdentityStatusAdmission {
    CompanionIdentityStatusAdmission::admit(request)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn admit_companion_handoff_response(
    response: CompanionIdentityHandoffResponse,
) -> CompanionHandoffResponseAdmission {
    CompanionHandoffResponseAdmission::admit(response)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionEpochMilliseconds, CompanionIdentityDiscoveryRequest, CompanionInstallationAppKey,
        CompanionUnlockedAppKey, ExtensionConnectScope,
    };

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn generated_admission_rejects_incomplete_status_without_assertions()
    -> Result<(), wasm_bindgen::JsValue> {
        let observed_at: CompanionEpochMilliseconds = serde_json::from_str("100")
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let expires_at: CompanionEpochMilliseconds = serde_json::from_str("200")
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let result = admit_companion_identity_status(CompanionIdentityStatusAdmissionRequest {
            discovery: CompanionIdentityDiscoveryObservation {
                request: CompanionIdentityDiscoveryRequest {
                    request_id: "request-1".to_owned(),
                    vault_store_id: "store-1".to_owned(),
                    expires_at,
                },
                observed_at,
            },
            status: CompanionIdentityStatus::Unlocked {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                app_key: CompanionUnlockedAppKey {
                    extension_runtime_id: String::new(),
                    app_key: CompanionInstallationAppKey {
                        app_id: "app-1".to_owned(),
                        encryption_public_key: "age1public".to_owned(),
                        signing_public_key: "signing-public".to_owned(),
                        installation_label: "Nook Extension".to_owned(),
                    },
                    nonce: "nonce-1".to_owned(),
                    scopes: vec![ExtensionConnectScope::VaultAccess],
                },
            },
            observed_at,
        });
        assert!(matches!(
            result,
            CompanionIdentityStatusAdmission::Rejected { .. }
        ));
        Ok(())
    }
}
