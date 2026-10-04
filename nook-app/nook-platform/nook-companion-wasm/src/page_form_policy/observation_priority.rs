//! Typed observation priority projections.

use nook_companion_core::{AuthenticationPageObservation, AuthenticationPageObservationFacts};
use tsify::Ts;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]

#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: exposes the authentication observation priority to JavaScript"
    )
)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_form_observation_priority(
    observation: &Ts<AuthenticationPageObservation>,
) -> Result<u8, JsError> {
    let observation = observation
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        (observation)
            .authentication_form_observation_priority()
            .into()
    };
    Ok(result)
}

#[wasm_bindgen]

#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: exposes the authentication facts priority to JavaScript"
    )
)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_page_observation_facts_priority(
    facts: &Ts<AuthenticationPageObservationFacts>,
) -> Result<u8, JsError> {
    let facts = facts
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        (facts)
            .authentication_page_observation_facts_priority()
            .into()
    };
    Ok(result)
}
