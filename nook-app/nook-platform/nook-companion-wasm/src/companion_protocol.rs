use nook_companion_core::{
    CompanionEpochMilliseconds, CompanionExtensionPresence, CompanionExtensionProtocol,
    CompanionHandoffResponseAdmission, CompanionIdentityDiscoveryObservation,
    CompanionIdentityHandoffAuthorization, CompanionIdentityHandoffRequest,
    CompanionIdentityHandoffResponse, CompanionIdentityStatus, CompanionIdentityStatusAdmission,
    CompanionIdentityStatusAdmissionRequest, CompanionIdentityUnlockRequest,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionIdentityDiscoveryAdmission(CompanionIdentityDiscoveryObservation);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionExtensionPresenceAdmission(CompanionExtensionPresence);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionIdentityStatusRequestAdmission(CompanionIdentityStatusAdmissionRequest);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionHandoffResponseValueAdmission(CompanionIdentityHandoffResponse);

#[derive(Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[tsify(type = "unknown")]
pub struct CompanionIdentityHandoffStatusAdmission {
    request: CompanionIdentityHandoffRequest,
    observed_at: CompanionEpochMilliseconds,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, tag = "type", content = "payload")]
pub enum CompanionIdentityDiscoverySessionTransportRequest {
    #[serde(rename = "nook:extension-session-discover-companion-identity")]
    DiscoverCompanionIdentity {
        presence: CompanionExtensionPresence,
        discovery: CompanionIdentityDiscoveryObservation,
    },
}

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionIdentityDiscoverySessionTransportAdmission(
    CompanionIdentityDiscoverySessionTransportRequest,
);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, tag = "type", content = "payload")]
pub enum CompanionIdentityHandoffSessionTransportRequest {
    #[serde(rename = "nook:extension-session-authorize-companion-identity-handoff")]
    AuthorizeCompanionIdentityHandoff {
        authorization: CompanionIdentityHandoffAuthorization,
    },
}

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionIdentityHandoffSessionTransportAdmission(
    CompanionIdentityHandoffSessionTransportRequest,
);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionIdentityUnlockRequestAdmission(CompanionIdentityUnlockRequest);

impl CompanionIdentityUnlockRequestAdmission {
    fn decode(
        &self,
    ) -> Result<CompanionIdentityUnlockRequest, nook_companion_core::CompanionProtocolError> {
        self.0.validate()?;
        Ok(self.0.clone())
    }
}

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionIdentityHandoffRequestAdmission(CompanionIdentityHandoffRequestPayload);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct CompanionIdentityHandoffRequestPayload(CompanionIdentityHandoffRequest);

impl CompanionIdentityHandoffRequestPayload {
    fn request_mut(&mut self) -> &mut CompanionIdentityHandoffRequest {
        &mut self.0
    }
}

impl CompanionIdentityHandoffRequestAdmission {
    fn decode(
        &self,
    ) -> Result<CompanionIdentityHandoffRequestPayload, nook_companion_core::CompanionProtocolError>
    {
        self.0.0.validate()?;
        Ok(self.0.clone())
    }
}

impl Drop for CompanionIdentityHandoffRequestPayload {
    fn drop(&mut self) {
        self.request_mut().zeroize_sensitive_material();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, tag = "type", content = "payload")]
pub enum ExtensionPairedVaultUnlockRequestMessage {
    #[serde(rename = "nook:extension-paired-vault-unlock-request")]
    Unlock(CompanionIdentityUnlockRequest),
}

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct ExtensionPairedVaultUnlockRequestMessageAdmission(
    ExtensionPairedVaultUnlockRequestMessage,
);

impl ExtensionPairedVaultUnlockRequestMessageAdmission {
    fn decode(
        &self,
    ) -> Result<ExtensionPairedVaultUnlockRequestMessage, nook_companion_core::CompanionProtocolError>
    {
        let ExtensionPairedVaultUnlockRequestMessage::Unlock(request) = &self.0;
        request.validate()?;
        Ok(self.0.clone())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields, tag = "type", content = "payload")]
pub enum ExtensionPairedVaultIdentityHandoffRequestMessage {
    #[serde(rename = "nook:extension-paired-vault-identity-handoff-request")]
    IdentityHandoff(CompanionIdentityHandoffRequestPayload),
}

#[cfg(test)]
impl ExtensionPairedVaultIdentityHandoffRequestMessage {
    fn request_mut(&mut self) -> &mut CompanionIdentityHandoffRequest {
        let Self::IdentityHandoff(payload) = self;
        payload.request_mut()
    }
}

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct ExtensionPairedVaultIdentityHandoffRequestMessageAdmission(
    ExtensionPairedVaultIdentityHandoffRequestMessage,
);

impl ExtensionPairedVaultIdentityHandoffRequestMessageAdmission {
    fn decode(
        &self,
    ) -> Result<
        ExtensionPairedVaultIdentityHandoffRequestMessage,
        nook_companion_core::CompanionProtocolError,
    > {
        let ExtensionPairedVaultIdentityHandoffRequestMessage::IdentityHandoff(payload) = &self.0;
        payload.0.validate()?;
        Ok(self.0.clone())
    }
}

#[wasm_bindgen]
pub struct NookCompanionExtensionProtocol {
    inner: CompanionExtensionProtocol,
}

#[wasm_bindgen]
impl NookCompanionExtensionProtocol {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        presence: &tsify::Ts<CompanionExtensionPresenceAdmission>,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let presence = presence
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

        let CompanionExtensionPresenceAdmission(presence) = presence;
        Ok(Self {
            inner: CompanionExtensionProtocol::new(presence)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn discover(
        &self,
        observation: &tsify::Ts<CompanionIdentityDiscoveryObservation>,
    ) -> Result<tsify::Ts<CompanionIdentityStatus>, wasm_bindgen::JsError> {
        let observation = observation
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

        let result = self
            .inner
            .discover(observation)
            .map_err(|error| JsError::new(&error.to_string()))?;
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn unlock(
        &self,
        request: &tsify::Ts<CompanionIdentityUnlockRequest>,
    ) -> Result<tsify::Ts<CompanionIdentityStatus>, wasm_bindgen::JsError> {
        let request = request
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

        let result = self
            .inner
            .unlock(request)
            .map_err(|error| JsError::new(&error.to_string()))?;
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_companion_identity_status(
    request: &tsify::Ts<CompanionIdentityStatusRequestAdmission>,
) -> Result<tsify::Ts<CompanionIdentityStatusAdmission>, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let CompanionIdentityStatusRequestAdmission(request) = request;
        CompanionIdentityStatusAdmission::admit(request)
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_companion_identity_discovery_observation(
    observation: &tsify::Ts<CompanionIdentityDiscoveryAdmission>,
) -> Result<tsify::Ts<CompanionIdentityDiscoveryObservation>, wasm_bindgen::JsError> {
    let observation = observation
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let CompanionIdentityDiscoveryAdmission(observation) = observation;
        observation
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_companion_identity_discovery_session_transport_request(
    request: &tsify::Ts<CompanionIdentityDiscoverySessionTransportAdmission>,
) -> Result<tsify::Ts<CompanionIdentityDiscoverySessionTransportRequest>, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let CompanionIdentityDiscoverySessionTransportAdmission(request) = request;
        request
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_companion_identity_handoff_session_transport_request(
    request: &tsify::Ts<CompanionIdentityHandoffSessionTransportAdmission>,
) -> Result<tsify::Ts<CompanionIdentityHandoffSessionTransportRequest>, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let CompanionIdentityHandoffSessionTransportAdmission(request) = request;
        request
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_companion_identity_unlock_request(
    admission: &tsify::Ts<CompanionIdentityUnlockRequestAdmission>,
) -> Result<tsify::Ts<CompanionIdentityUnlockRequest>, wasm_bindgen::JsError> {
    let admission = admission
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result = admission
        .decode()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_companion_identity_handoff_request(
    admission: &tsify::Ts<CompanionIdentityHandoffRequestAdmission>,
) -> Result<tsify::Ts<CompanionIdentityHandoffRequestPayload>, wasm_bindgen::JsError> {
    let admission = admission
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result = admission
        .decode()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_paired_vault_unlock_request_message(
    admission: &tsify::Ts<ExtensionPairedVaultUnlockRequestMessageAdmission>,
) -> Result<tsify::Ts<ExtensionPairedVaultUnlockRequestMessage>, wasm_bindgen::JsError> {
    let admission = admission
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result = admission
        .decode()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_paired_vault_identity_handoff_request_message(
    admission: &tsify::Ts<ExtensionPairedVaultIdentityHandoffRequestMessageAdmission>,
) -> Result<tsify::Ts<ExtensionPairedVaultIdentityHandoffRequestMessage>, wasm_bindgen::JsError> {
    let admission = admission
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result = admission
        .decode()
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_companion_handoff_identity_status(
    admission: &tsify::Ts<CompanionIdentityHandoffStatusAdmission>,
) -> Result<tsify::Ts<CompanionIdentityStatusAdmission>, wasm_bindgen::JsError> {
    let admission = admission
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let CompanionIdentityHandoffStatusAdmission {
        request,
        observed_at,
    } = admission;
    request
        .validate()
        .map_err(|error| JsError::new(&error.to_string()))?;
    let transaction = request.transaction;
    let result = Ok::<_, wasm_bindgen::JsError>(CompanionIdentityStatusAdmission::admit(
        CompanionIdentityStatusAdmissionRequest {
            discovery: transaction.discovery,
            status: transaction.status,
            observed_at,
        },
    ))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_companion_handoff_response(
    response: &tsify::Ts<CompanionHandoffResponseValueAdmission>,
) -> Result<tsify::Ts<CompanionHandoffResponseAdmission>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let CompanionHandoffResponseValueAdmission(response) = response;
        CompanionHandoffResponseAdmission::admit(response)
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    use nook_companion_core::CompanionProtocolError;
    use serde::de::DeserializeOwned;

    struct AdmissionFixture;

    impl AdmissionFixture {
        fn decode<Value: DeserializeOwned>(json: &str) -> Result<Value, String> {
            serde_json::from_str(json).map_err(|error| error.to_string())
        }
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn chrome_identity_admissions_are_unknown_and_schema_checked() {
        assert!(CompanionIdentityDiscoveryAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionExtensionPresenceAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionIdentityStatusRequestAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionHandoffResponseValueAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionIdentityHandoffStatusAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionIdentityDiscoverySessionTransportAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionIdentityHandoffSessionTransportAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionIdentityUnlockRequestAdmission::DECL.ends_with(" = unknown;"));
        assert!(CompanionIdentityHandoffRequestAdmission::DECL.ends_with(" = unknown;"));
        assert!(ExtensionPairedVaultUnlockRequestMessageAdmission::DECL.ends_with(" = unknown;"));
        assert!(
            ExtensionPairedVaultIdentityHandoffRequestMessageAdmission::DECL
                .ends_with(" = unknown;")
        );
        assert!(
            CompanionIdentityDiscoverySessionTransportRequest::DECL
                .contains("nook:extension-session-discover-companion-identity")
        );
        assert!(
            CompanionIdentityHandoffSessionTransportRequest::DECL
                .contains("nook:extension-session-authorize-companion-identity-handoff")
        );
        assert!(AdmissionFixture::decode::<CompanionIdentityDiscoveryAdmission>("null").is_err());
        assert!(AdmissionFixture::decode::<CompanionExtensionPresenceAdmission>("null").is_err());
        assert!(
            AdmissionFixture::decode::<CompanionIdentityStatusRequestAdmission>("null").is_err()
        );
        assert!(
            AdmissionFixture::decode::<CompanionHandoffResponseValueAdmission>("null").is_err()
        );
        assert!(
            AdmissionFixture::decode::<CompanionIdentityHandoffStatusAdmission>("null").is_err()
        );
        assert!(
            AdmissionFixture::decode::<CompanionIdentityDiscoverySessionTransportAdmission>("null")
                .is_err()
        );
        assert!(
            AdmissionFixture::decode::<CompanionIdentityHandoffSessionTransportAdmission>("null")
                .is_err()
        );
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn paired_vault_unlock_message_decoder_returns_concrete_envelope() -> Result<(), String> {
        let admission = AdmissionFixture::decode::<
            ExtensionPairedVaultUnlockRequestMessageAdmission,
        >(
            r#"{"type":"nook:extension-paired-vault-unlock-request","payload":{"requestId":"request","vaultStoreId":"vault"}}"#,
        )?;
        assert!(matches!(
            (admission).decode(),
            Ok(ExtensionPairedVaultUnlockRequestMessage::Unlock(request))
                if request.request_id == "request" && request.vault_store_id == "vault"
        ));
        Ok(())
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn paired_vault_unlock_message_decoder_rejects_invalid_envelopes() -> Result<(), String> {
        assert!(
            AdmissionFixture::decode::<ExtensionPairedVaultUnlockRequestMessageAdmission>(
                r#"{"type":"wrong","payload":{"requestId":"request","vaultStoreId":"vault"}}"#
            )
            .is_err()
        );
        assert!(AdmissionFixture::decode::<ExtensionPairedVaultUnlockRequestMessageAdmission>(
            r#"{"type":"nook:extension-paired-vault-unlock-request","payload":{"requestId":"request"}}"#
        ).is_err());
        let empty = AdmissionFixture::decode::<ExtensionPairedVaultUnlockRequestMessageAdmission>(
            r#"{"type":"nook:extension-paired-vault-unlock-request","payload":{"requestId":"","vaultStoreId":"vault"}}"#,
        )?;
        #[cfg(target_arch = "wasm32")]
        assert!((empty).decode().is_err());
        #[cfg(not(target_arch = "wasm32"))]
        assert!(empty.decode().is_err());
        Ok(())
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn paired_vault_handoff_message_decoder_validates_and_cleans_decoded_material()
    -> Result<(), String> {
        let json = r#"{
            "type":"nook:extension-paired-vault-identity-handoff-request",
            "payload":{
                "transaction":{
                    "discovery":{"request":{"requestId":"request","vaultStoreId":"vault","expiresAt":200},"observedAt":100},
                    "status":{"status":"unlocked","request_id":"request","vault_store_id":"vault","app_key":{"extensionRuntimeId":"runtime","appKey":{"appId":"app","encryptionPublicKey":"age1public","signingPublicKey":"signing","installationLabel":"Extension"},"nonce":"nonce","scopes":["vault-access"]}},
                    "admittedAt":100
                },
                "recipientPublicKey":"age1recipient"
            }
        }"#;
        let admission = AdmissionFixture::decode::<
            ExtensionPairedVaultIdentityHandoffRequestMessageAdmission,
        >(json)?;
        let Ok(mut decoded) = (admission).decode() else {
            panic!("valid handoff envelope must decode");
        };
        let request = decoded.request_mut();
        assert_eq!(request.recipient_public_key, "age1recipient");
        request.zeroize_sensitive_material();
        assert!(request.recipient_public_key.is_empty());
        let CompanionIdentityStatus::Unlocked { app_key, .. } = &request.transaction.status else {
            panic!("handoff fixture must remain unlocked");
        };
        assert!(app_key.nonce.is_empty());

        Ok(())
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn paired_vault_handoff_message_decoder_rejects_invalid_material() -> Result<(), String> {
        let invalid = r#"{
            "type":"nook:extension-paired-vault-identity-handoff-request",
            "payload":{
                "transaction":{
                    "discovery":{"request":{"requestId":"request","vaultStoreId":"vault","expiresAt":200},"observedAt":100},
                    "status":{"status":"unlocked","request_id":"request","vault_store_id":"vault","app_key":{"extensionRuntimeId":"runtime","appKey":{"appId":"app","encryptionPublicKey":"age1public","signingPublicKey":"signing","installationLabel":"Extension"},"nonce":"nonce","scopes":["vault-access"]}},
                    "admittedAt":100
                },
                "recipientPublicKey":" "
            }
        }"#;
        let admission = AdmissionFixture::decode::<
            ExtensionPairedVaultIdentityHandoffRequestMessageAdmission,
        >(invalid)?;

        match admission.decode() {
            Err(CompanionProtocolError::InvalidValue) => Ok(()),
            Err(error) => panic!("invalid handoff must report invalid value, got {error}"),
            Ok(_) => panic!("invalid handoff must be rejected"),
        }
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn direct_identity_request_decoders_validate_payloads() -> Result<(), String> {
        let unlock = AdmissionFixture::decode::<CompanionIdentityUnlockRequestAdmission>(
            r#"{"requestId":"request","vaultStoreId":"vault"}"#,
        )?;
        let Ok(decoded) = (unlock).decode() else {
            panic!("valid unlock payload must decode");
        };
        assert_eq!(decoded.request_id, "request");

        let empty = AdmissionFixture::decode::<CompanionIdentityUnlockRequestAdmission>(
            r#"{"requestId":"","vaultStoreId":"vault"}"#,
        )?;
        #[cfg(target_arch = "wasm32")]
        assert!((empty).decode().is_err());
        #[cfg(not(target_arch = "wasm32"))]
        assert!(empty.decode().is_err());
        assert!(
            AdmissionFixture::decode::<CompanionIdentityHandoffRequestAdmission>(
                r#"{"recipientPublicKey":"age1recipient"}"#
            )
            .is_err()
        );
        Ok(())
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn handoff_status_admission_validates_the_full_request() -> Result<(), String> {
        let admission = AdmissionFixture::decode::<CompanionIdentityHandoffStatusAdmission>(
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
        admission
            .request
            .validate()
            .map_err(|error| error.to_string())?;
        let transaction = admission.request.transaction;
        let admitted =
            CompanionIdentityStatusAdmission::admit(CompanionIdentityStatusAdmissionRequest {
                discovery: transaction.discovery,
                status: transaction.status,
                observed_at: admission.observed_at,
            });
        assert!(matches!(
            admitted,
            CompanionIdentityStatusAdmission::Accepted { .. }
        ));
        Ok(())
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn session_transport_decoders_return_concrete_identity_variants() -> Result<(), String> {
        let discovery = r#"{
            "type":"nook:extension-session-discover-companion-identity",
            "payload":{
                "presence":{"kind":"unavailable"},
                "discovery":{
                    "request":{"requestId":"request","vaultStoreId":"vault","expiresAt":200},
                    "observedAt":100
                }
            }
        }"#;
        let discovery: CompanionIdentityDiscoverySessionTransportAdmission =
            AdmissionFixture::decode(discovery)?;
        assert!(matches!(
            discovery.0,
            CompanionIdentityDiscoverySessionTransportRequest::DiscoverCompanionIdentity { .. }
        ));

        let handoff = r#"{
            "type":"nook:extension-session-authorize-companion-identity-handoff",
            "payload":{"authorization":{
                "request":{
                    "transaction":{
                        "discovery":{
                            "request":{"requestId":"request","vaultStoreId":"vault","expiresAt":200},
                            "observedAt":100
                        },
                        "status":{"status":"unavailable","request_id":"request","vault_store_id":"vault"},
                        "admittedAt":100
                    },
                    "recipientPublicKey":"age1recipient"
                },
                "observedAt":150,
                "presence":{"kind":"unavailable"}
            }}
        }"#;
        let handoff: CompanionIdentityHandoffSessionTransportAdmission =
            AdmissionFixture::decode(handoff)?;
        assert!(matches!(
            handoff.0,
            CompanionIdentityHandoffSessionTransportRequest::AuthorizeCompanionIdentityHandoff { .. }
        ));
        Ok(())
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn session_transport_admissions_reject_wrong_tags_and_partial_payloads() {
        assert!(
            AdmissionFixture::decode::<CompanionIdentityDiscoverySessionTransportAdmission>(
                r#"{"type":"wrong","payload":{"presence":{"kind":"unavailable"}}}"#
            )
            .is_err()
        );
        assert!(
            AdmissionFixture::decode::<CompanionIdentityDiscoverySessionTransportAdmission>(
                r#"{"type":"nook:extension-session-discover-companion-identity","payload":{"presence":{"kind":"unavailable"},"discovery":{"request":{"requestId":"request","vaultStoreId":"vault","expiresAt":200},"observedAt":100},"unexpected":true}}"#
            )
            .is_err()
        );
        assert!(AdmissionFixture::decode::<CompanionIdentityHandoffSessionTransportAdmission>(
            r#"{"type":"nook:extension-session-authorize-companion-identity-handoff","payload":{}}"#
        ).is_err());
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionEpochMilliseconds, CompanionExtensionPresence, CompanionIdentityDiscoveryRequest,
        CompanionIdentityHandoffRequest, CompanionIdentityHandoffResponse, CompanionIdentityStatus,
        CompanionIdentityStatusAdmission, CompanionIdentityUnlockRequest,
        CompanionInstallationAppKey, CompanionUnlockedAppKey, ExtensionConnectScope,
        ExtensionPairingVaultType,
    };
    use serde_wasm_bindgen::Serializer;
    use tsify::{Ts, Tsify};
    use wasm_bindgen::{JsError, JsValue};
    use wasm_bindgen_test::wasm_bindgen_test;

    struct ProtocolFixture;

    impl ProtocolFixture {
        fn epoch(value: &str) -> Result<CompanionEpochMilliseconds, JsError> {
            Ok(serde_json::from_str(value)?)
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

        fn discovery() -> Result<CompanionIdentityDiscoveryObservation, JsError> {
            Ok(CompanionIdentityDiscoveryObservation {
                request: CompanionIdentityDiscoveryRequest {
                    request_id: "request-1".to_owned(),
                    vault_store_id: "store-1".to_owned(),
                    expires_at: Self::epoch("200")?,
                },
                observed_at: Self::epoch("100")?,
            })
        }
    }

    #[wasm_bindgen_test]
    fn generated_admission_rejects_incomplete_status_without_assertions() -> Result<(), JsError> {
        let observed_at = ProtocolFixture::epoch("100")?;
        let request = CompanionIdentityStatusAdmissionRequest {
            discovery: ProtocolFixture::discovery()?,
            status: CompanionIdentityStatus::Unlocked {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                app_key: CompanionUnlockedAppKey {
                    extension_runtime_id: String::new(),
                    ..ProtocolFixture::app_key()
                },
            },
            observed_at,
        };
        let request = Ts::new_unchecked(serde_wasm_bindgen::to_value(&request)?);
        assert!(matches!(
            admit_companion_identity_status(&request)?.to_rust()?,
            CompanionIdentityStatusAdmission::Rejected { .. }
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn generated_protocol_exports_preserve_discovery_unlock_and_handoff_admission()
    -> Result<(), JsError> {
        let key = ProtocolFixture::app_key();
        assert!(
            NookCompanionExtensionProtocol::new(&Ts::new_unchecked(serde_wasm_bindgen::to_value(
                &CompanionExtensionPresence::Locked {
                    vault_type: ExtensionPairingVaultType::Simple,
                    vault_store_id: String::new(),
                    vault_name: String::new(),
                }
            )?,))
            .is_err()
        );
        let presence = CompanionExtensionPresence::Unlocked {
            vault_type: ExtensionPairingVaultType::Simple,
            vault_store_id: "store-1".to_owned(),
            vault_name: "Personal".to_owned(),
            app_key: key.clone(),
        };
        let presence = Ts::new_unchecked(serde_wasm_bindgen::to_value(&presence)?);
        let protocol = NookCompanionExtensionProtocol::new(&presence)?;
        let discovery_observation = ProtocolFixture::discovery()?;
        let discovery_admission =
            Ts::new_unchecked(serde_wasm_bindgen::to_value(&discovery_observation)?);
        assert_eq!(
            decode_companion_identity_discovery_observation(&discovery_admission)?.to_rust()?,
            discovery_observation
        );
        assert!(matches!(
            protocol
                .discover(&discovery_observation.into_ts()?)?
                .to_rust()?,
            CompanionIdentityStatus::Unlocked { .. }
        ));
        assert!(matches!(
            protocol
                .unlock(
                    &CompanionIdentityUnlockRequest {
                        request_id: "request-1".to_owned(),
                        vault_store_id: "store-1".to_owned(),
                    }
                    .into_ts()?
                )?
                .to_rust()?,
            CompanionIdentityStatus::Unlocked { .. }
        ));
        let mut invalid_discovery = ProtocolFixture::discovery()?;
        invalid_discovery.request.request_id.clear();
        assert!(protocol.discover(&invalid_discovery.into_ts()?).is_err());
        assert!(
            protocol
                .unlock(
                    &CompanionIdentityUnlockRequest {
                        request_id: String::new(),
                        vault_store_id: "store-1".to_owned(),
                    }
                    .into_ts()?
                )
                .is_err()
        );
        let status_request = CompanionIdentityStatusAdmissionRequest {
            discovery: discovery_observation.clone(),
            status: CompanionIdentityStatus::Unlocked {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                app_key: key,
            },
            observed_at: ProtocolFixture::epoch("100")?,
        };
        let status_request = Ts::new_unchecked(serde_wasm_bindgen::to_value(&status_request)?);
        let transaction = match admit_companion_identity_status(&status_request)?.to_rust()? {
            CompanionIdentityStatusAdmission::Accepted { transaction } => *transaction,
            CompanionIdentityStatusAdmission::Rejected { .. } => {
                return Err(JsError::new("status admission rejected"));
            }
        };
        let handoff_request = CompanionIdentityHandoffRequest {
            transaction,
            recipient_public_key: "age1recipient".to_owned(),
        };
        let unlock = CompanionIdentityUnlockRequest {
            request_id: "request-1".to_owned(),
            vault_store_id: "store-1".to_owned(),
        };
        assert_eq!(
            decode_companion_identity_unlock_request(&Ts::new_unchecked(
                unlock.into_ts()?.js_value(),
            ))?
            .to_rust()?,
            unlock
        );
        let unlock_message = ExtensionPairedVaultUnlockRequestMessage::Unlock(unlock);
        assert_eq!(
            decode_extension_paired_vault_unlock_request_message(&Ts::new_unchecked(
                unlock_message.into_ts()?.js_value(),
            ))?
            .to_rust()?,
            unlock_message
        );
        let handoff_payload = CompanionIdentityHandoffRequestPayload(handoff_request.clone());
        assert_eq!(
            decode_companion_identity_handoff_request(&Ts::new_unchecked(
                handoff_payload.into_ts()?.js_value(),
            ))?
            .to_rust()?,
            handoff_payload
        );
        let handoff_message =
            ExtensionPairedVaultIdentityHandoffRequestMessage::IdentityHandoff(handoff_payload);
        assert_eq!(
            decode_extension_paired_vault_identity_handoff_request_message(&Ts::new_unchecked(
                handoff_message.into_ts()?.js_value()
            ),)?
            .to_rust()?,
            handoff_message
        );
        let CompanionExtensionPresenceAdmission(presence) = presence.to_rust()?;
        let session_discovery =
            CompanionIdentityDiscoverySessionTransportRequest::DiscoverCompanionIdentity {
                presence: presence.clone(),
                discovery: discovery_observation.clone(),
            };
        assert_eq!(
            decode_companion_identity_discovery_session_transport_request(&Ts::new_unchecked(
                session_discovery.into_ts()?.js_value()
            ),)?
            .to_rust()?,
            session_discovery
        );
        let session_handoff =
            CompanionIdentityHandoffSessionTransportRequest::AuthorizeCompanionIdentityHandoff {
                authorization: CompanionIdentityHandoffAuthorization {
                    request: handoff_request.clone(),
                    observed_at: ProtocolFixture::epoch("150")?,
                    presence,
                },
            };
        assert_eq!(
            decode_companion_identity_handoff_session_transport_request(&Ts::new_unchecked(
                session_handoff.into_ts()?.js_value()
            ),)?
            .to_rust()?,
            session_handoff
        );
        // Invalid JS ingress cannot alter the retained protocol's unlocked presence.
        assert!(
            decode_companion_identity_unlock_request(&Ts::new_unchecked(JsValue::from_str(
                "invalid"
            ),))
            .is_err()
        );
        assert!(
            decode_companion_identity_handoff_request(&Ts::new_unchecked(JsValue::from_str(
                "invalid"
            ),))
            .is_err()
        );
        assert!(
            decode_extension_paired_vault_unlock_request_message(&Ts::new_unchecked(
                JsValue::from_str("wrong-envelope"),
            ))
            .is_err()
        );
        assert!(
            decode_extension_paired_vault_identity_handoff_request_message(&Ts::new_unchecked(
                JsValue::from_str("wrong-envelope"),
            ))
            .is_err()
        );
        assert!(
            decode_companion_identity_discovery_session_transport_request(&Ts::new_unchecked(
                JsValue::from_str("wrong-session"),
            ))
            .is_err()
        );
        assert!(
            decode_companion_identity_handoff_session_transport_request(&Ts::new_unchecked(
                JsValue::from_str("wrong-session"),
            ))
            .is_err()
        );
        assert!(matches!(
            protocol
                .discover(&ProtocolFixture::discovery()?.into_ts()?)?
                .to_rust()?,
            CompanionIdentityStatus::Unlocked { .. }
        ));
        // The Deserialize-only admission accepts an unknown JS object at the export edge.
        let handoff_admission = Ts::new_unchecked(
            serde_json::json!({
                "request": handoff_request,
                "observedAt": ProtocolFixture::epoch("150")?,
            })
            .serialize(&Serializer::json_compatible())?,
        );
        assert!(matches!(
            admit_companion_handoff_identity_status(&handoff_admission)?.to_rust()?,
            CompanionIdentityStatusAdmission::Accepted { .. }
        ));
        let response = CompanionIdentityHandoffResponse {
            request: handoff_request,
            encrypted_envelope: "sealed-envelope".to_owned(),
        };
        assert!(matches!(
            admit_companion_handoff_response(&Ts::new_unchecked(serde_wasm_bindgen::to_value(
                &response
            )?,))?
            .to_rust()?,
            CompanionHandoffResponseAdmission::Accepted { .. }
        ));
        Ok(())
    }
}
