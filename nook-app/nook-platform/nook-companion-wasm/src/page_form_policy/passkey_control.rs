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

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::{
        AuthenticationDetailedPasskeyControlCandidateObservation,
        AuthenticationDetailedPasskeyControlObservation, AuthenticationUsernameEvidence,
        PageControlActionability, PageControlOwnership, PageControlSemantics,
        PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    };
    use tsify::{Ts, Tsify};
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    fn passkey_exports_admit_assertion_control_without_admitting_management() -> Result<(), JsError>
    {
        let mut control = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::LocallyScoped,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            password_field_count: 0.into(),
            new_password_field_count: 0.into(),
            one_time_code_field_count: 0.into(),
            semantic_submit_control_count: 0.into(),
            source_origin: "https://login.example.test".into(),
            form_identity: "login-form".into(),
            destination_identity: "https://login.example.test/auth/login".into(),
            label: "Use passkey".into(),
            machine_identity: String::new(),
            submission_method: PageControlSubmissionMethod::Absent,
            submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
        };
        let candidate =
            AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(control.clone());
        assert!(authentication_passkey_control_candidate_is_safe(
            &candidate.into_ts()?
        )?);
        assert!(authentication_passkey_control_evidence_is_safe(
            &AuthenticationDetailedPasskeyControlObservation::Observed(control.clone())
                .into_ts()?
        )?);
        control.label = "Delete passkey".into();
        assert!(!authentication_passkey_control_candidate_is_safe(
            &AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(control)
                .into_ts()?
        )?);
        assert!(looks_like_passkey_control_label("Use passkey"));
        assert!(looks_like_passkey_enrollment_or_management_label(
            "Create passkey"
        ));
        assert!(!looks_like_passkey_control_label("Sign in"));
        Ok(())
    }
    #[wasm_bindgen_test]
    fn malformed_passkey_evidence_is_rejected_before_admission() {
        assert!(
            authentication_passkey_control_candidate_is_safe(&Ts::new_unchecked(JsValue::NULL))
                .is_err()
        );
        assert!(
            authentication_passkey_control_evidence_is_safe(&Ts::new_unchecked(JsValue::TRUE))
                .is_err()
        );
    }
}
