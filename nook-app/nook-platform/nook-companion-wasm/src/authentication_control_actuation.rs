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

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        AuthenticationAdvanceControlObservation, AuthenticationImplicitSubmitActuationObservation,
        AuthenticationUsernameEvidence, PageControlActionability, PageControlOwnership,
        PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    };
    use tsify::{Ts, Tsify};
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    fn owned_login_control_remains_actionable_and_inert_control_is_rejected() -> Result<(), JsError>
    {
        let mut control = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            password_field_count: 1.into(),
            new_password_field_count: 0.into(),
            one_time_code_field_count: 0.into(),
            semantic_submit_control_count: 1.into(),
            source_origin: "https://login.example.test".into(),
            form_identity: "login-form".into(),
            destination_identity: "https://login.example.test/auth/login".into(),
            label: "Sign in".into(),
            machine_identity: String::new(),
            submission_method: PageControlSubmissionMethod::Post,
            submission_destination_source: PageControlSubmissionDestinationSource::Authored,
        };
        assert!(authentication_advance_control_is_safe(&control.into_ts()?)?);
        assert!(
            !authentication_advance_control_allows_password_disclosure_planning(
                &control.into_ts()?
            )?
        );
        control.actionability = PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(
            &control.into_ts()?
        )?);
        let implicit = AuthenticationImplicitSubmitActuationObservation {
            fields: Default::default(),
            ceremony: Default::default(),
            control_label: String::new(),
            control_machine_identity: String::new(),
        };
        assert!(!authentication_implicit_submit_actuation_is_safe(
            &implicit.into_ts()?
        )?);
        Ok(())
    }
    #[wasm_bindgen_test]
    fn malformed_actuation_inputs_never_become_executable_controls() {
        assert!(authentication_advance_control_is_safe(&Ts::new_unchecked(JsValue::NULL)).is_err());
        assert!(
            authentication_advance_control_allows_password_disclosure_planning(&Ts::new_unchecked(
                JsValue::TRUE
            ))
            .is_err()
        );
        assert!(
            authentication_implicit_submit_actuation_is_safe(&Ts::new_unchecked(JsValue::NULL))
                .is_err()
        );
    }
}
