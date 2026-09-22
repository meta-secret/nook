//! Typed WASM exports for authentication control actuation policy.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_implicit_submit_actuation_is_safe(
    observation: nook_companion_core::AuthenticationImplicitSubmitActuationObservation,
) -> bool {
    observation.is_safe()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_advance_control_is_safe(
    observation: nook_companion_core::AuthenticationAdvanceControlObservation,
) -> bool {
    observation.authentication_advance_control_is_safe()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_advance_control_allows_password_disclosure_planning(
    observation: nook_companion_core::AuthenticationAdvanceControlObservation,
) -> bool {
    observation.allows_tesla_password_disclosure_planning()
}
