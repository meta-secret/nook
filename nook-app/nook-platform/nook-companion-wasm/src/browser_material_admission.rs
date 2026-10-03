//! Unknown browser objects are decoded once at this actual JS ingress boundary.
use nook_companion_core::{
    AuthenticationRecoveryCopyEvidence, AuthenticationRecoveryCopyRequest,
    AuthenticationWorkflowSnapshotTransport, AuthenticationWorkflowTransportAdmission,
};
use tsify::Tsify;
use wasm_bindgen::JsError;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_authentication_workflow_snapshot_message(
    value: JsValue,
) -> Result<tsify::Ts<AuthenticationWorkflowTransportAdmission>, wasm_bindgen::JsError> {
    let result = {
        match serde_wasm_bindgen::from_value::<AuthenticationWorkflowSnapshotTransport>(value) {
            Ok(message) => message.admit(),
            Err(_) => AuthenticationWorkflowTransportAdmission::Rejected,
        }
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_recovery_copy_evidence(
    request: &tsify::Ts<AuthenticationRecoveryCopyRequest>,
) -> Result<tsify::Ts<AuthenticationRecoveryCopyEvidence>, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { request.project() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        AuthenticationPageObservationFacts, AuthenticationWorkflowSnapshotTransport,
        AuthenticationWorkflowTransportAdmission, AuthenticationWorkflowTransportPayload,
        AuthenticationWorkflowTransportType,
    };
    use tsify::Tsify;
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn browser_material_is_admitted_and_recovery_codes_are_redacted() -> Result<(), JsError> {
        let message = AuthenticationWorkflowSnapshotTransport {
            message_type: AuthenticationWorkflowTransportType::Snapshot,
            payload: AuthenticationWorkflowTransportPayload {
                origin: "https://example.test".to_owned(),
                observations: vec![AuthenticationPageObservationFacts::default()],
            },
        };
        let value = serde_wasm_bindgen::to_value(&message).expect("serialize transport fixture");
        assert!(matches!(
            admit_authentication_workflow_snapshot_message(value)
                .map_err(|_| JsError::new("Typed test operation failed."))?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            AuthenticationWorkflowTransportAdmission::Accepted { .. }
        ));
        assert!(matches!(
            admit_authentication_workflow_snapshot_message(JsValue::from_str("invalid"))
                .map_err(|_| JsError::new("Typed test operation failed."))?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            AuthenticationWorkflowTransportAdmission::Rejected
        ));
        let evidence = authentication_recovery_copy_evidence(
            &(AuthenticationRecoveryCopyRequest {
                texts: vec![
                    "Save your recovery codes".to_owned(),
                    "A1B2-C3D4-E5F6".to_owned(),
                ],
            })
            .into_ts()
            .map_err(|_| JsError::new("Typed test input could not be encoded."))?,
        )
        .map_err(|_| JsError::new("Typed test operation failed."))?
        .to_rust()
        .map_err(|_| JsError::new("Typed test output could not be decoded."))?;
        assert_eq!(evidence.copy, "Save your recovery codes");

        Ok(())
    }
}
