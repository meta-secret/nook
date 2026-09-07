use nook_companion_core::{
    CompanionExtensionPresence, CompanionExtensionProtocol, CompanionHandoffResponseAdmission,
    CompanionIdentityDiscoveryObservation, CompanionIdentityHandoffResponse,
    CompanionIdentityStatus, CompanionIdentityStatusAdmission, CompanionIdentityUnlockRequest,
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
pub fn admit_companion_identity_status(
    status: CompanionIdentityStatus,
) -> CompanionIdentityStatusAdmission {
    CompanionIdentityStatusAdmission::admit(status)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn admit_companion_handoff_response(
    response: CompanionIdentityHandoffResponse,
) -> CompanionHandoffResponseAdmission {
    CompanionHandoffResponseAdmission::admit(response)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionInstallationAppKey, CompanionUnlockedAppKey, ExtensionConnectScope,
    };

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn generated_admission_rejects_incomplete_status_without_assertions() {
        let result = admit_companion_identity_status(CompanionIdentityStatus::Unlocked {
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
        });
        assert!(matches!(
            result,
            CompanionIdentityStatusAdmission::Rejected { .. }
        ));
    }
}
