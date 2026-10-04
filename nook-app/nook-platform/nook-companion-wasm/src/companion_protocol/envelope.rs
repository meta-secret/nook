//! Closed companion session and paired-vault transport envelopes.
use super::CompanionIdentityHandoffRequestPayload;
use nook_companion_core::{
    CompanionExtensionPresence, CompanionIdentityDiscoveryObservation,
    CompanionIdentityHandoffAuthorization, CompanionIdentityUnlockRequest,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
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

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionIdentityHandoffRequest, CompanionIdentityStatus, CompanionProtocolError,
    };
    use serde::de::DeserializeOwned;
    struct EnvelopeFixture;
    impl EnvelopeFixture {
        fn decode<Value: DeserializeOwned>(json: &str) -> Result<Value, String> {
            serde_json::from_str(json).map_err(|error| error.to_string())
        }
    }
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    fn paired_vault_unlock_message_decoder_returns_concrete_envelope() -> Result<(), String> {
        let admission = EnvelopeFixture::decode::<ExtensionPairedVaultUnlockRequestMessageAdmission>(
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
            EnvelopeFixture::decode::<ExtensionPairedVaultUnlockRequestMessageAdmission>(
                r#"{"type":"wrong","payload":{"requestId":"request","vaultStoreId":"vault"}}"#
            )
            .is_err()
        );
        assert!(EnvelopeFixture::decode::<ExtensionPairedVaultUnlockRequestMessageAdmission>(
            r#"{"type":"nook:extension-paired-vault-unlock-request","payload":{"requestId":"request"}}"#
        ).is_err());
        let empty = EnvelopeFixture::decode::<ExtensionPairedVaultUnlockRequestMessageAdmission>(
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
        let admission = EnvelopeFixture::decode::<
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
        let admission = EnvelopeFixture::decode::<
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
            EnvelopeFixture::decode(discovery)?;
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
            EnvelopeFixture::decode(handoff)?;
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
            EnvelopeFixture::decode::<CompanionIdentityDiscoverySessionTransportAdmission>(
                r#"{"type":"wrong","payload":{"presence":{"kind":"unavailable"}}}"#
            )
            .is_err()
        );
        assert!(
            EnvelopeFixture::decode::<CompanionIdentityDiscoverySessionTransportAdmission>(
                r#"{"type":"nook:extension-session-discover-companion-identity","payload":{"presence":{"kind":"unavailable"},"discovery":{"request":{"requestId":"request","vaultStoreId":"vault","expiresAt":200},"observedAt":100},"unexpected":true}}"#
            )
            .is_err()
        );
        assert!(EnvelopeFixture::decode::<CompanionIdentityHandoffSessionTransportAdmission>(
            r#"{"type":"nook:extension-session-authorize-companion-identity-handoff","payload":{}}"#
        ).is_err());
    }
}
