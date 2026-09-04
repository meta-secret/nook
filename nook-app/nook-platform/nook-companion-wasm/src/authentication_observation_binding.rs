use wasm_bindgen::prelude::wasm_bindgen;

/// Bind the exact ordered browser facts through Rust's canonical representation.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen owns the decoded ABI value.
pub fn bind_authentication_page_observation_facts(
    facts: nook_companion_core::AuthenticationPageObservationFactsBatch,
) -> Result<nook_companion_core::AuthenticationObservationBindingToken, wasm_bindgen::JsError> {
    nook_companion_core::bind_authentication_page_observation_facts(&facts)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

/// Require current browser facts to equal the exact Rust-issued binding.
#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen owns the decoded ABI values.
pub fn authentication_page_observation_facts_match_binding(
    binding: nook_companion_core::AuthenticationObservationBindingToken,
    facts: nook_companion_core::AuthenticationPageObservationFactsBatch,
) -> bool {
    nook_companion_core::authentication_page_observation_facts_match_binding(&binding, &facts)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use std::fmt;

    use nook_companion_core::{
        AuthenticationCredentialSubmissionFacts, AuthenticationCredentialSubmissionObservation,
        AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts,
        AuthenticationPageObservationFactsBatch, PageControlActionability,
        PageControlSubmissionMethod,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    fn js_error(error: impl fmt::Display) -> wasm_bindgen::JsError {
        wasm_bindgen::JsError::new(&error.to_string())
    }

    fn password_facts(
        method: PageControlSubmissionMethod,
    ) -> AuthenticationPageObservationFactsBatch {
        AuthenticationPageObservationFactsBatch {
            observations: vec![AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    current_password_field_count: 1,
                    actionable_password_field_count: 1,
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
        let approved = serde_wasm_bindgen::from_value(approved_js).map_err(js_error)?;
        let binding = super::bind_authentication_page_observation_facts(approved)?;
        let binding_js = serde_wasm_bindgen::to_value(&binding).map_err(js_error)?;
        let binding: nook_companion_core::AuthenticationObservationBindingToken =
            serde_wasm_bindgen::from_value(binding_js).map_err(js_error)?;

        let unchanged_js =
            serde_wasm_bindgen::to_value(&password_facts(PageControlSubmissionMethod::Post))
                .map_err(js_error)?;
        let unchanged = serde_wasm_bindgen::from_value(unchanged_js).map_err(js_error)?;
        assert!(super::authentication_page_observation_facts_match_binding(
            binding.clone(),
            unchanged,
        ));

        let get_js =
            serde_wasm_bindgen::to_value(&password_facts(PageControlSubmissionMethod::Get))
                .map_err(js_error)?;
        let get = serde_wasm_bindgen::from_value(get_js).map_err(js_error)?;
        assert!(!super::authentication_page_observation_facts_match_binding(
            binding, get,
        ));
        Ok(())
    }
}
