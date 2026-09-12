use nook_companion_core::{
    CompanionEpochMilliseconds, CompanionExtensionPresence, CompanionExtensionProtocol,
    CompanionHandoffResponseAdmission, CompanionIdentityDiscoveryObservation,
    CompanionIdentityHandoffRequest, CompanionIdentityHandoffResponse, CompanionIdentityStatus,
    CompanionIdentityStatusAdmission, CompanionIdentityStatusAdmissionRequest,
    CompanionIdentityUnlockRequest,
};
use serde::Deserialize;
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct CompanionIdentityDiscoveryAdmission(CompanionIdentityDiscoveryObservation);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct CompanionExtensionPresenceAdmission(CompanionExtensionPresence);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct CompanionIdentityStatusRequestAdmission(CompanionIdentityStatusAdmissionRequest);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct CompanionHandoffResponseValueAdmission(CompanionIdentityHandoffResponse);

#[derive(Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct CompanionIdentityHandoffStatusAdmission {
    request: CompanionIdentityHandoffRequest,
    observed_at: CompanionEpochMilliseconds,
}

#[wasm_bindgen]
pub struct NookCompanionExtensionProtocol {
    inner: CompanionExtensionProtocol,
}

#[wasm_bindgen]
impl NookCompanionExtensionProtocol {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(presence: CompanionExtensionPresenceAdmission) -> Result<Self, JsError> {
        let CompanionExtensionPresenceAdmission(presence) = presence;
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
    request: CompanionIdentityStatusRequestAdmission,
) -> CompanionIdentityStatusAdmission {
    let CompanionIdentityStatusRequestAdmission(request) = request;
    CompanionIdentityStatusAdmission::admit(request)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_companion_identity_discovery_observation(
    observation: CompanionIdentityDiscoveryAdmission,
) -> CompanionIdentityDiscoveryObservation {
    let CompanionIdentityDiscoveryAdmission(observation) = observation;
    observation
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn admit_companion_handoff_identity_status(
    admission: CompanionIdentityHandoffStatusAdmission,
) -> Result<CompanionIdentityStatusAdmission, JsError> {
    let CompanionIdentityHandoffStatusAdmission {
        request,
        observed_at,
    } = admission;
    request
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))?;
    let transaction = request.transaction;
    Ok(CompanionIdentityStatusAdmission::admit(
        CompanionIdentityStatusAdmissionRequest {
            discovery: transaction.discovery,
            status: transaction.status,
            observed_at,
        },
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn admit_companion_handoff_response(
    response: CompanionHandoffResponseValueAdmission,
) -> CompanionHandoffResponseAdmission {
    let CompanionHandoffResponseValueAdmission(response) = response;
    CompanionHandoffResponseAdmission::admit(response)
}

#[cfg(test)]
mod admission_tests {
    use super::*;

    #[test]
    fn chrome_identity_admissions_are_unknown_and_schema_checked() {
        assert!(CompanionIdentityDiscoveryAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionExtensionPresenceAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionIdentityStatusRequestAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionHandoffResponseValueAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionIdentityHandoffStatusAdmission::DECL.ends_with(" = unknown;"));
        assert!(serde_json::from_str::<CompanionIdentityDiscoveryAdmission>("null").is_err());
        assert!(serde_json::from_str::<CompanionExtensionPresenceAdmission>("null").is_err());
        assert!(serde_json::from_str::<CompanionIdentityStatusRequestAdmission>("null").is_err());
        assert!(serde_json::from_str::<CompanionHandoffResponseValueAdmission>("null").is_err());
        assert!(serde_json::from_str::<CompanionIdentityHandoffStatusAdmission>("null").is_err());
    }

    #[test]
    fn handoff_status_admission_validates_the_full_request() -> Result<(), serde_json::Error> {
        let admission = serde_json::from_str::<CompanionIdentityHandoffStatusAdmission>(
            r#"{
                "request": {
                    "transaction": {
                        "discovery": {
                            "request": {"requestId":"request","vaultStoreId":"vault","expiresAt":200},
                            "observedAt":100
                        },
                        "status": {
                            "status":"unlocked",
                            "request_id":"request",
                            "vault_store_id":"vault",
                            "app_key": {
                                "extensionRuntimeId":"runtime",
                                "appKey": {
                                    "appId":"app",
                                    "encryptionPublicKey":"age1public",
                                    "signingPublicKey":"signing",
                                    "installationLabel":"Extension"
                                },
                                "nonce":"nonce",
                                "scopes":["vault-access"]
                            }
                        },
                        "admittedAt":100
                    },
                    "recipientPublicKey":"age1recipient"
                },
                "observedAt":150
            }"#,
        )?;
        let Ok(admitted) = admit_companion_handoff_identity_status(admission) else {
            panic!("valid handoff request must be admitted");
        };
        assert!(matches!(
            admitted,
            CompanionIdentityStatusAdmission::Accepted { .. }
        ));
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionEpochMilliseconds, CompanionExtensionPresence, CompanionIdentityDiscoveryRequest,
        CompanionIdentityHandoffRequest, CompanionIdentityHandoffResponse, CompanionIdentityStatus,
        CompanionIdentityStatusAdmission, CompanionInstallationAppKey, CompanionUnlockedAppKey,
        ExtensionConnectScope, ExtensionPairingVaultType,
    };

    fn epoch(value: &str) -> Result<CompanionEpochMilliseconds, wasm_bindgen::JsValue> {
        serde_json::from_str(value)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
    }

    fn app_key() -> CompanionUnlockedAppKey {
        CompanionUnlockedAppKey {
            extension_runtime_id: "runtime-1".to_owned(),
            app_key: CompanionInstallationAppKey {
                app_id: "app-1".to_owned(),
                encryption_public_key: "age1public".to_owned(),
                signing_public_key: "signing-public".to_owned(),
                installation_label: "Nook Extension".to_owned(),
            },
            nonce: "nonce-1".to_owned(),
            scopes: vec![ExtensionConnectScope::VaultAccess],
        }
    }

    fn discovery() -> Result<CompanionIdentityDiscoveryObservation, wasm_bindgen::JsValue> {
        Ok(CompanionIdentityDiscoveryObservation {
            request: CompanionIdentityDiscoveryRequest {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                expires_at: epoch("200")?,
            },
            observed_at: epoch("100")?,
        })
    }

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn generated_admission_rejects_incomplete_status_without_assertions()
    -> Result<(), wasm_bindgen::JsValue> {
        let observed_at: CompanionEpochMilliseconds = serde_json::from_str("100")
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let expires_at: CompanionEpochMilliseconds = serde_json::from_str("200")
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let request = CompanionIdentityStatusAdmissionRequest {
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
        };
        let request = serde_json::from_value(
            serde_json::to_value(request)
                .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?,
        )
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let result = admit_companion_identity_status(request);
        assert!(matches!(
            result,
            CompanionIdentityStatusAdmission::Rejected { .. }
        ));
        Ok(())
    }

    #[wasm_bindgen_test::wasm_bindgen_test]
    fn generated_protocol_exports_preserve_discovery_unlock_and_handoff_admission()
    -> Result<(), wasm_bindgen::JsValue> {
        let key = app_key();
        assert!(
            NookCompanionExtensionProtocol::new(CompanionExtensionPresenceAdmission(
                CompanionExtensionPresence::Locked {
                    vault_type: ExtensionPairingVaultType::Simple,
                    vault_store_id: String::new(),
                    vault_name: String::new(),
                },
            ))
            .is_err()
        );
        let presence = CompanionExtensionPresence::Unlocked {
            vault_type: ExtensionPairingVaultType::Simple,
            vault_store_id: "store-1".to_owned(),
            vault_name: "Personal".to_owned(),
            app_key: key.clone(),
        };
        let presence_value = serde_wasm_bindgen::to_value(&presence)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let presence: CompanionExtensionPresenceAdmission =
            serde_wasm_bindgen::from_value(presence_value)
                .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let protocol = NookCompanionExtensionProtocol::new(presence)?;

        let discovery_observation = discovery()?;
        let discovery_value = serde_wasm_bindgen::to_value(&discovery_observation)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let discovery_admission: CompanionIdentityDiscoveryAdmission =
            serde_wasm_bindgen::from_value(discovery_value)
                .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        assert_eq!(
            decode_companion_identity_discovery_observation(discovery_admission),
            discovery_observation
        );
        assert!(matches!(
            protocol.discover(discovery_observation.clone())?,
            CompanionIdentityStatus::Unlocked { .. }
        ));
        assert!(matches!(
            protocol.unlock(nook_companion_core::CompanionIdentityUnlockRequest {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
            })?,
            CompanionIdentityStatus::Unlocked { .. }
        ));
        let mut invalid_discovery = discovery()?;
        invalid_discovery.request.request_id.clear();
        assert!(protocol.discover(invalid_discovery).is_err());
        assert!(
            protocol
                .unlock(nook_companion_core::CompanionIdentityUnlockRequest {
                    request_id: String::new(),
                    vault_store_id: "store-1".to_owned(),
                })
                .is_err()
        );

        let status = CompanionIdentityStatus::Unlocked {
            request_id: "request-1".to_owned(),
            vault_store_id: "store-1".to_owned(),
            app_key: key,
        };
        let status_request = CompanionIdentityStatusAdmissionRequest {
            discovery: discovery_observation,
            status,
            observed_at: epoch("100")?,
        };
        let status_value = serde_wasm_bindgen::to_value(&status_request)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let status_request: CompanionIdentityStatusRequestAdmission =
            serde_wasm_bindgen::from_value(status_value)
                .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        let transaction = match admit_companion_identity_status(status_request) {
            CompanionIdentityStatusAdmission::Accepted { transaction } => *transaction,
            CompanionIdentityStatusAdmission::Rejected { .. } => {
                return Err(wasm_bindgen::JsValue::from_str("status admission rejected"));
            }
        };
        let handoff_request = CompanionIdentityHandoffRequest {
            transaction,
            recipient_public_key: "age1recipient".to_owned(),
        };
        let handoff_admission = CompanionIdentityHandoffStatusAdmission {
            request: handoff_request.clone(),
            observed_at: epoch("150")?,
        };
        assert!(matches!(
            admit_companion_handoff_identity_status(handoff_admission)?,
            CompanionIdentityStatusAdmission::Accepted { .. }
        ));
        let response = CompanionIdentityHandoffResponse {
            request: handoff_request,
            encrypted_envelope: "sealed-envelope".to_owned(),
        };
        assert!(matches!(
            admit_companion_handoff_response(CompanionHandoffResponseValueAdmission(response)),
            CompanionHandoffResponseAdmission::Accepted { .. }
        ));
        Ok(())
    }
}
