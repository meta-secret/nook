//! Typed WASM exports for authentication control actuation policy.

use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_implicit_submit_actuation_is_safe(
    observation: &tsify::Ts<nook_companion_core::AuthenticationImplicitSubmitActuationObservation>,
) -> Result<bool, wasm_bindgen::JsError> {
    let observation = observation
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { observation.is_safe() };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_advance_control_is_safe(
    observation: &tsify::Ts<nook_companion_core::AuthenticationAdvanceControlObservation>,
) -> Result<bool, wasm_bindgen::JsError> {
    let observation = observation
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { observation.authentication_advance_control_is_safe() };
    Ok(result)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_advance_control_allows_password_disclosure_planning(
    observation: &tsify::Ts<nook_companion_core::AuthenticationAdvanceControlObservation>,
) -> Result<bool, wasm_bindgen::JsError> {
    let observation = observation
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { observation.allows_tesla_password_disclosure_planning() };
    Ok(result)
}
