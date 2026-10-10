//! Typed browser edges for submitted-login capture and save eligibility.
use crate::NookPageInputFieldObservation;
use nook_companion_core::{
    LoginPasswordFieldHistory, LoginSaveCaptureDecision, LoginSaveOutcomeDecision,
    LoginSaveOutcomeObservation, LoginSubmissionCapture, LoginSubmissionDecision,
    LoginSubmissionField, LoginSubmissionIntent, LoginSubmissionObservation,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
pub struct NookLoginSubmissionField {
    inner: LoginSubmissionField,
}

#[wasm_bindgen]
impl NookLoginSubmissionField {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(field: &NookPageInputFieldObservation) -> Self {
        Self {
            inner: LoginSubmissionField::from(field.as_core().clone()),
        }
    }
    #[must_use = "use the updated submission field"]
    pub fn with_password_history(
        mut self,
        history: &Ts<LoginPasswordFieldHistory>,
    ) -> Result<Self, JsError> {
        self.inner = self.inner.with_password_history(history.to_rust()?);
        Ok(self)
    }
}

#[wasm_bindgen]
pub struct NookLoginSubmissionObservation {
    inner: LoginSubmissionObservation,
}

#[wasm_bindgen]
impl NookLoginSubmissionObservation {
    #[wasm_bindgen(constructor)]
    pub fn new(intent: &Ts<LoginSubmissionIntent>) -> Result<Self, JsError> {
        Ok(Self {
            inner: LoginSubmissionObservation::try_from(intent.to_rust()?)?,
        })
    }
    #[must_use = "use the updated submission observation"]
    pub fn add_field(mut self, field: &NookLoginSubmissionField) -> Result<Self, JsError> {
        self.inner = self.inner.add_field(field.inner.clone())?;
        Ok(self)
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: wasm-bindgen login submission export"
    )
)]
pub fn classify_companion_login_submission(
    observation: &NookLoginSubmissionObservation,
) -> Result<Ts<LoginSubmissionDecision>, JsError> {
    Ok(observation.inner.classify().into_ts()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: wasm-bindgen login save eligibility export"
    )
)]
pub fn classify_companion_login_save_outcome(
    observation: &Ts<LoginSaveOutcomeObservation>,
) -> Result<Ts<LoginSaveOutcomeDecision>, JsError> {
    Ok(observation.to_rust()?.classify()?.into_ts()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: wasm-bindgen first-message login capture export"
    )
)]
pub fn classify_companion_login_save_capture(
    capture: &Ts<LoginSubmissionCapture>,
) -> Result<Ts<LoginSaveCaptureDecision>, JsError> {
    Ok(capture.to_rust()?.classify()?.into_ts()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: wasm-bindgen browser sender scope comparison export"
    )
)]
pub fn compare_login_save_sender_scope(
    request: &Ts<LoginSaveSenderScopeComparison>,
) -> Result<Ts<nook_companion_core::LoginSaveScopeMatch>, JsError> {
    let request = request.to_rust()?;
    Ok(request.expected.compare_scope(request.current).into_ts()?)
}

#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct LoginSaveSenderScopeComparison {
    expected: nook_companion_core::LoginSaveSenderContext,
    current: nook_companion_core::LoginSaveSenderContext,
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_companion_core::AuthenticationPageObservationFacts;
    use nook_companion_core::LoginExplicitCandidatePresence;
    use nook_companion_core::LoginSaveCaptureSource;
    use nook_companion_core::LoginSubmissionPageUrl;
    use nook_companion_core::{
        LoginControlLabel, LoginSubmissionEvent, LoginSubmissionTarget, LoginSubmissionTrust,
        PageInputType,
    };
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn typed_submission_bridge_preserves_indices_and_rejects_malformed_intent()
    -> Result<(), JsError> {
        let intent = LoginSubmissionIntent {
            event: LoginSubmissionEvent::FormSubmit,
            trust: LoginSubmissionTrust::Trusted,
            target: LoginSubmissionTarget::CredentialScope,
            control_label: LoginControlLabel::try_from("Sign in".to_owned())?,
            context: AuthenticationPageObservationFacts::default(),
        };
        let username = NookPageInputFieldObservation::new(
            PageInputType::Text,
            false,
            false,
            vec!["username".to_owned()],
            "User".to_owned(),
            true,
        );
        let password = NookPageInputFieldObservation::new(
            PageInputType::Text,
            false,
            false,
            vec!["current-password".to_owned()],
            "Password".to_owned(),
            true,
        );
        let request = NookLoginSubmissionObservation::new(&intent.into_ts()?)?
            .add_field(&NookLoginSubmissionField::new(&username))?
            .add_field(&NookLoginSubmissionField::new(&password))?;
        assert!(matches!(
            classify_companion_login_submission(&request)?.to_rust()?,
            LoginSubmissionDecision::Captured { .. }
        ));
        assert!(NookLoginSubmissionObservation::new(&Ts::new_unchecked(JsValue::NULL)).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn first_capture_bridge_derives_baseline_and_rejects_unbounded_metadata() -> Result<(), JsError>
    {
        let username = nook_companion_core::LoginSubmissionFieldMetadata {
            input_type: "text".to_owned(),
            disabled: false,
            read_only: false,
            autocomplete_tokens: vec!["username".to_owned()],
            identity_text: "Username".to_owned(),
            login_context: true,
            password_history: LoginPasswordFieldHistory::Unobserved,
        };
        let mut capture = LoginSubmissionCapture {
            intent: LoginSubmissionIntent {
                event: LoginSubmissionEvent::FormSubmit,
                trust: LoginSubmissionTrust::Trusted,
                target: LoginSubmissionTarget::CredentialScope,
                control_label: LoginControlLabel::try_from(String::new())?,
                context: AuthenticationPageObservationFacts::default(),
            },
            fields: vec![
                username.clone(),
                nook_companion_core::LoginSubmissionFieldMetadata {
                    input_type: "text".to_owned(),
                    autocomplete_tokens: vec!["current-password".to_owned()],
                    identity_text: "Password".to_owned(),
                    ..username
                },
            ],
            submitted_at: serde_json::from_str("1000")?,
            submitted_url: LoginSubmissionPageUrl::try_from(
                "https://example.test/login".to_owned(),
            )?,
            controls: Vec::new(),
            explicit_candidate: LoginExplicitCandidatePresence::Absent,
        };
        assert!(
            matches!(classify_companion_login_save_capture(&capture.clone().into_ts()?)?.to_rust()?,
            LoginSaveCaptureDecision::SubmittedLogin { baseline, .. }
            if baseline.source == LoginSaveCaptureSource::SubmittedLogin)
        );
        capture
            .fields
            .get_mut(1)
            .ok_or_else(|| JsError::new("password fixture"))?
            .identity_text = "x".repeat(513);
        assert!(classify_companion_login_save_capture(&capture.into_ts()?).is_err());
        Ok(())
    }
}
