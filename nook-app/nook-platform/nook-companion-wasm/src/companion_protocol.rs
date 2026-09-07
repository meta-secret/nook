//! Stateful WASM objects for the browser-independent companion protocol.

use nook_companion_core::{
    AuthorizedCompanionIdentityHandoff, CompanionEventLogUpdate, CompanionExtensionPresence,
    CompanionExtensionProtocol, CompanionIdentityDiscoveryObservation,
    CompanionIdentityHandoffRequest, CompanionIdentityStatus, CompanionIdentityUnlockRequest,
    CompanionPairingApproval, CompanionWebsiteHandoffPreparation, CompanionWebsiteProtocol,
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

    #[allow(clippy::needless_pass_by_value)]
    pub fn authorize_handoff(
        &mut self,
        request: CompanionIdentityHandoffRequest,
    ) -> Result<CompanionIdentityHandoffRequest, JsError> {
        self.inner
            .authorize_handoff(request)
            .map(AuthorizedCompanionIdentityHandoff::into_request)
            .map_err(|error| JsError::new(&error.to_string()))
    }
}

#[wasm_bindgen]
pub struct NookCompanionWebsiteProtocol {
    inner: CompanionWebsiteProtocol,
}

#[wasm_bindgen]
impl NookCompanionWebsiteProtocol {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        discovery: nook_companion_core::CompanionIdentityDiscoveryRequest,
    ) -> Result<NookCompanionWebsiteProtocol, JsError> {
        Ok(Self {
            inner: CompanionWebsiteProtocol::new(discovery)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn prepare_handoff(
        &self,
        preparation: CompanionWebsiteHandoffPreparation,
    ) -> Result<CompanionIdentityHandoffRequest, JsError> {
        self.inner
            .prepare_handoff(preparation)
            .map_err(|error| JsError::new(&error.to_string()))
    }
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn validate_companion_pairing_approval(
    approval: CompanionPairingApproval,
) -> Result<(), JsError> {
    approval
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn validate_companion_event_log_update(update: CompanionEventLogUpdate) -> Result<(), JsError> {
    update
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionDeviceIdentity, CompanionEpochMilliseconds, CompanionIdentityDiscoveryRequest,
        CompanionUnlockedIdentity, ExtensionConnectScope, ExtensionPairingVaultType,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    struct Scenario {
        website: NookCompanionWebsiteProtocol,
        extension: NookCompanionExtensionProtocol,
        discovery: CompanionIdentityDiscoveryRequest,
    }

    impl Scenario {
        fn new() -> Result<Self, JsError> {
            let discovery = CompanionIdentityDiscoveryRequest {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                expires_at: 200_u32.into(),
            };
            Ok(Self {
                website: NookCompanionWebsiteProtocol::new(discovery.clone())?,
                extension: NookCompanionExtensionProtocol::new(
                    CompanionExtensionPresence::Unlocked {
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
                    },
                )?,
                discovery,
            })
        }
    }

    #[wasm_bindgen_test]
    fn generated_objects_call_each_other_without_browser_transport() -> Result<(), JsError> {
        let mut scenario = Scenario::new()?;
        let status = scenario
            .extension
            .discover(CompanionIdentityDiscoveryObservation {
                request: scenario.discovery,
                observed_at: 100_u32.into(),
            })?;
        let request = scenario
            .website
            .prepare_handoff(CompanionWebsiteHandoffPreparation {
                status,
                recipient_public_key: "age1recipient".to_owned(),
            })?;
        let replay = request.clone();
        scenario.extension.authorize_handoff(request)?;
        assert!(scenario.extension.authorize_handoff(replay).is_err());
        Ok(())
    }
}
