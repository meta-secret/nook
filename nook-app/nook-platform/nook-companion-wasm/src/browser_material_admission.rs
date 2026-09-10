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
