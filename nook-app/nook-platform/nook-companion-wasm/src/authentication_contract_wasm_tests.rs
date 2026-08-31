use nook_companion_core::{
    AuthenticationCredentialSubmissionFacts, AuthenticationCredentialSubmissionObservation,
    AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts,
    AuthenticationPageObservationFactsBatch, PageControlActionability, PageControlSubmissionMethod,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen_test::wasm_bindgen_test;

fn js_error(error: impl std::fmt::Display) -> wasm_bindgen::JsError {
    wasm_bindgen::JsError::new(&error.to_string())
}

fn password_facts(method: PageControlSubmissionMethod) -> AuthenticationPageObservationFactsBatch {
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
fn observation_binding_bridge_round_trips_js_facts_and_rejects_route_drift()
-> Result<(), wasm_bindgen::JsError> {
    let approved_js =
        serde_wasm_bindgen::to_value(&password_facts(PageControlSubmissionMethod::Post))
            .map_err(js_error)?;
    let approved = serde_wasm_bindgen::from_value(approved_js).map_err(js_error)?;
    let binding = crate::bind_authentication_page_observation_facts(approved)?;
    let binding_js = serde_wasm_bindgen::to_value(&binding).map_err(js_error)?;
    let binding: nook_companion_core::AuthenticationObservationBindingToken =
        serde_wasm_bindgen::from_value(binding_js).map_err(js_error)?;

    let unchanged_js =
        serde_wasm_bindgen::to_value(&password_facts(PageControlSubmissionMethod::Post))
            .map_err(js_error)?;
    let unchanged = serde_wasm_bindgen::from_value(unchanged_js).map_err(js_error)?;
    assert!(crate::authentication_page_observation_facts_match_binding(
        binding.clone(),
        unchanged,
    ));

    let get_js = serde_wasm_bindgen::to_value(&password_facts(PageControlSubmissionMethod::Get))
        .map_err(js_error)?;
    let get = serde_wasm_bindgen::from_value(get_js).map_err(js_error)?;
    assert!(!crate::authentication_page_observation_facts_match_binding(
        binding, get,
    ));
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticatorCodeFixture {
    ok: bool,
    code: &'static str,
    expires_at: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticatorCodeResult {
    expires_at: f64,
}

#[wasm_bindgen_test]
fn authenticator_code_bridge_requires_and_returns_expiry() -> Result<(), wasm_bindgen::JsError> {
    let expires_at = 1_725_000_030_000.0;
    let input = serde_wasm_bindgen::to_value(&AuthenticatorCodeFixture {
        ok: true,
        code: "123456",
        expires_at,
    })
    .map_err(js_error)?;
    let wire = serde_wasm_bindgen::from_value(input).map_err(js_error)?;
    let response = crate::decode_authenticator_code_response(wire)?;
    let output = serde_wasm_bindgen::to_value(&response).map_err(js_error)?;
    let result: AuthenticatorCodeResult =
        serde_wasm_bindgen::from_value(output).map_err(js_error)?;
    assert_eq!(result.expires_at, expires_at);
    Ok(())
}
