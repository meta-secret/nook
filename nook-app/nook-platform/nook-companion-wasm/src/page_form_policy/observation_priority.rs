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

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use tsify::Tsify;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    fn priority_exports_preserve_the_existing_numeric_browser_contract() -> Result<(), JsError> {
        let empty = AuthenticationPageObservation::default();
        assert_eq!(
            authentication_form_observation_priority(&empty.into_ts()?)?,
            1
        );
        let login = AuthenticationPageObservation {
            current_password_field_count: 1.into(),
            ..Default::default()
        };
        assert_eq!(
            authentication_form_observation_priority(&login.into_ts()?)?,
            4
        );
        let facts = AuthenticationPageObservationFacts::default();
        assert_eq!(
            authentication_page_observation_facts_priority(&facts.into_ts()?)?,
            1
        );
        Ok(())
    }
    #[wasm_bindgen_test]
    fn malformed_priorities_are_rejected_instead_of_ranked() {
        assert!(
            authentication_form_observation_priority(&Ts::new_unchecked(JsValue::NULL)).is_err()
        );
        assert!(
            authentication_page_observation_facts_priority(&Ts::new_unchecked(JsValue::TRUE))
                .is_err()
        );
    }
}
