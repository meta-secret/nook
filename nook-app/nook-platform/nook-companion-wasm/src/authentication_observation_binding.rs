use wasm_bindgen::prelude::wasm_bindgen;

/// Bind the exact ordered browser facts through Rust's canonical representation.
#[wasm_bindgen]
pub fn bind_authentication_page_observation_facts(
    facts: nook_companion_core::AuthenticationPageObservationFactsBatch,
) -> Result<nook_companion_core::AuthenticationObservationBindingToken, wasm_bindgen::JsError> {
    nook_companion_core::bind_authentication_page_observation_facts(&facts)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

/// Require current browser facts to equal the exact Rust-issued binding.
#[wasm_bindgen]
#[must_use]
pub fn authentication_page_observation_facts_match_binding(
    binding: nook_companion_core::AuthenticationObservationBindingToken,
    facts: nook_companion_core::AuthenticationPageObservationFactsBatch,
) -> bool {
    nook_companion_core::authentication_page_observation_facts_match_binding(&binding, &facts)
}

/// Decode the complete ephemeral authenticator-code response contract.
#[wasm_bindgen]
pub fn decode_authenticator_code_response(
    response: nook_companion_core::AuthenticatorCodeResponseWire,
) -> Result<nook_companion_core::AuthenticatorCodeResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authenticator_code_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}
