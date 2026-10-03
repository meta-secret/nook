use nook_companion_core::AuthenticationObservationBindingToken;
use tsify::Tsify;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

/// Bind the exact ordered browser facts through Rust's canonical representation.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen owns the decoded ABI value.
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn bind_authentication_page_observation_facts(
    facts: &tsify::Ts<nook_companion_core::AuthenticationPageObservationFactsBatch>,
) -> Result<
    tsify::Ts<nook_companion_core::AuthenticationObservationBindingToken>,
    wasm_bindgen::JsError,
> {
    let facts = facts
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result =
        AuthenticationObservationBindingToken::bind_authentication_page_observation_facts(&facts)
            .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

/// Require current browser facts to equal the exact Rust-issued binding.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen owns the decoded ABI values.
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_page_observation_facts_match_binding(
    binding: &tsify::Ts<nook_companion_core::AuthenticationObservationBindingToken>,
    facts: &tsify::Ts<nook_companion_core::AuthenticationPageObservationFactsBatch>,
) -> Result<bool, wasm_bindgen::JsError> {
    let binding = binding
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let facts = facts
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        AuthenticationObservationBindingToken::authentication_page_observation_facts_match_binding(
            &binding, &facts,
        )
    };
    Ok(result)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use std::fmt;
    use tsify::{Ts, Tsify};
    use wasm_bindgen::JsError;

    use nook_companion_core::{
        AuthenticationCredentialSubmissionFacts, AuthenticationCredentialSubmissionObservation,
        AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts,
        AuthenticationPageObservationFactsBatch, PageControlActionability,
        PageControlSubmissionMethod,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    fn js_error(error: impl fmt::Display) -> wasm_bindgen::JsError {
        JsError::new(&error.to_string())
    }

    fn password_facts(
        method: PageControlSubmissionMethod,
    ) -> AuthenticationPageObservationFactsBatch {
        AuthenticationPageObservationFactsBatch {
            observations: vec![AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    current_password_field_count: 1.into(),
                    actionable_password_field_count: 1.into(),
                    ..Default::default()
                },
                credential_submission: AuthenticationCredentialSubmissionObservation::Observed(
                    AuthenticationCredentialSubmissionFacts {
                        actionability: PageControlActionability::Actionable,
                        method,
                        source_origin: "https://example.test".to_owned(),
                        form_identity: "login".to_owned(),
                        destination_identity: "https://example.test/session".to_owned(),
                    },
                ),
                ..Default::default()
            }],
        }
    }

    #[wasm_bindgen_test]
    fn bridge_round_trips_js_facts_and_rejects_route_drift() -> Result<(), wasm_bindgen::JsError> {
        let approved_js =
            serde_wasm_bindgen::to_value(&password_facts(PageControlSubmissionMethod::Post))
                .map_err(js_error)?;
        let approved = Ts::new_unchecked(approved_js);
        let binding = super::bind_authentication_page_observation_facts(&approved)?;
        let binding_js = binding.js_value();
        let binding: Ts<nook_companion_core::AuthenticationObservationBindingToken> =
            Ts::new_unchecked(binding_js);

        let unchanged_js =
            serde_wasm_bindgen::to_value(&password_facts(PageControlSubmissionMethod::Post))
                .map_err(js_error)?;
        let unchanged = Ts::new_unchecked(unchanged_js);
        assert!(super::authentication_page_observation_facts_match_binding(
            &binding.clone(),
            &unchanged,
        )?);

        let get_js =
            serde_wasm_bindgen::to_value(&password_facts(PageControlSubmissionMethod::Get))
                .map_err(js_error)?;
        let get = Ts::new_unchecked(get_js);
        assert!(!super::authentication_page_observation_facts_match_binding(
            &binding, &get,
        )?);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn bridge_rejects_an_empty_observation_binding() -> Result<(), JsError> {
        assert!(
            super::bind_authentication_page_observation_facts(
                &AuthenticationPageObservationFactsBatch {
                    observations: Vec::new(),
                }
                .into_ts()
                .map_err(js_error)?
            )
            .is_err()
        );
        Ok(())
    }
}
