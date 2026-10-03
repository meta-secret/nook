//! Typed boundary for portable passkey control admission.

use nook_companion_core::AuthenticationAdvanceControlObservation;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_passkey_control_candidate_is_safe(
    candidate: &tsify::Ts<
        nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation,
    >,
) -> Result<bool, wasm_bindgen::JsError> {
    let candidate = candidate
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { candidate.authentication_passkey_control_candidate_is_safe() };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_passkey_control_evidence_is_safe(
    evidence: &tsify::Ts<nook_companion_core::AuthenticationDetailedPasskeyControlObservation>,
) -> Result<bool, wasm_bindgen::JsError> {
    let evidence = evidence
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { evidence.authentication_passkey_control_evidence_is_safe() };
    Ok(result)
}
#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_passkey_control_label(label: &str) -> bool {
    AuthenticationAdvanceControlObservation::looks_like_passkey_control_label(label)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_passkey_enrollment_or_management_label(label: &str) -> bool {
    AuthenticationAdvanceControlObservation::looks_like_passkey_enrollment_or_management_label(
        label,
    )
}
