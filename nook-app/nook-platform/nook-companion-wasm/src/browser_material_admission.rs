//! Unknown browser objects are decoded once at this actual JS ingress boundary.
use nook_companion_core::{
    AuthenticationRecoveryCopyEvidence, AuthenticationRecoveryCopyRequest,
    AuthenticationWorkflowSnapshotTransport, AuthenticationWorkflowTransportAdmission,
};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn admit_authentication_workflow_snapshot_message(
    value: JsValue,
) -> AuthenticationWorkflowTransportAdmission {
    match serde_wasm_bindgen::from_value::<AuthenticationWorkflowSnapshotTransport>(value) {
        Ok(message) => message.admit(),
        Err(_) => AuthenticationWorkflowTransportAdmission::Rejected,
    }
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_recovery_copy_evidence(
    request: AuthenticationRecoveryCopyRequest,
) -> AuthenticationRecoveryCopyEvidence {
    request.project()
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        AuthenticationPageObservationFacts, AuthenticationWorkflowSnapshotTransport,
        AuthenticationWorkflowTransportAdmission, AuthenticationWorkflowTransportPayload,
        AuthenticationWorkflowTransportType,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn browser_material_is_admitted_and_recovery_codes_are_redacted() {
        let message = AuthenticationWorkflowSnapshotTransport {
            message_type: AuthenticationWorkflowTransportType::Snapshot,
            payload: AuthenticationWorkflowTransportPayload {
                origin: "https://example.test".to_owned(),
                observations: vec![AuthenticationPageObservationFacts::default()],
            },
        };
        let value = serde_wasm_bindgen::to_value(&message).expect("serialize transport fixture");
        assert!(matches!(
            admit_authentication_workflow_snapshot_message(value),
            AuthenticationWorkflowTransportAdmission::Accepted { .. }
        ));
        assert!(matches!(
            admit_authentication_workflow_snapshot_message(JsValue::from_str("invalid")),
            AuthenticationWorkflowTransportAdmission::Rejected
        ));
        let evidence = authentication_recovery_copy_evidence(AuthenticationRecoveryCopyRequest {
            texts: vec![
                "Save your recovery codes".to_owned(),
                "A1B2-C3D4-E5F6".to_owned(),
            ],
        });
        assert_eq!(evidence.copy, "Save your recovery codes");
    }
}
