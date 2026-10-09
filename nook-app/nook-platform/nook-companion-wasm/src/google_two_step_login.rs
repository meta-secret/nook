//! Same-document Google continuation over generated structural observations.

use nook_companion_core::credential_fill;
use tsify::Ts;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

pub use credential_fill::{
    GoogleLoginContinuationDecision, GoogleLoginIdentifierIntegrity, GoogleLoginPasswordOccupancy,
    GoogleLoginSelectionAuthority, GoogleLoginUserIntent,
};

#[wasm_bindgen]
pub struct GoogleTwoStepLoginContinuation {
    inner: credential_fill::GoogleTwoStepLoginContinuation,
}

#[wasm_bindgen]
impl GoogleTwoStepLoginContinuation {
    /// Borrowed inspection never reveals credentials or authorizes submission.
    pub fn inspect(
        &self,
        observation: &Ts<credential_fill::GoogleLoginPageObservation>,
    ) -> Result<GoogleLoginContinuationDecision, JsError> {
        Ok(self.inner.inspect(&observation.to_rust()?))
    }

    /// Consumes the owner on success and failure. JavaScript must not free it afterward.
    pub fn admit_password(
        self,
        observation: &Ts<credential_fill::GoogleLoginPageObservation>,
    ) -> Result<credential_fill::CredentialKind, JsError> {
        Ok(self.inner.admit_password(&observation.to_rust()?)?)
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: wasm-bindgen Google selected-login continuation export"
    )
)]
pub fn begin_google_two_step_login(
    request: &Ts<credential_fill::GoogleLoginStartRequest>,
) -> Result<GoogleTwoStepLoginContinuation, JsError> {
    let inner = {
        use credential_fill::GoogleTwoStepLoginContinuation;
        GoogleTwoStepLoginContinuation::begin(request.to_rust()?)?
    };
    Ok(GoogleTwoStepLoginContinuation { inner })
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use credential_fill::CredentialKind;
    use nook_companion_core::{
        AuthenticationAdvanceControlObservation, AuthenticationDetailedAdvanceControlObservation,
        AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts,
        AuthenticationPageObservationFactsBatch, AuthenticationUsernameEvidence,
        AuthenticationWorkflowMatch, PageControlActionability, PageControlOwnership,
        PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    };
    use tsify::Tsify;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct GoogleLoginFixture;

    impl GoogleLoginFixture {
        fn identifier() -> Result<credential_fill::GoogleLoginPageObservation, JsError> {
            Ok(credential_fill::GoogleLoginPageObservation {
                page_url: "https://accounts.google.com/v3/signin/identifier"
                    .to_owned()
                    .try_into()?,
                authorization_generation: "generation".to_owned().try_into()?,
                elapsed_milliseconds: 0.into(),
                identifier_integrity: GoogleLoginIdentifierIntegrity::Unchanged,
                user_intent: GoogleLoginUserIntent::Continuing,
                password_occupancy: GoogleLoginPasswordOccupancy::Empty,
                facts: AuthenticationPageObservationFacts {
                    fields: AuthenticationFieldObservationFacts {
                        username_field_count: 1.into(),
                        ..Default::default()
                    },
                    detailed_advance_control:
                        AuthenticationDetailedAdvanceControlObservation::observed(
                            AuthenticationAdvanceControlObservation {
                                actionability: PageControlActionability::Actionable,
                                ownership: PageControlOwnership::LocallyScoped,
                                semantics: PageControlSemantics::Activation,
                                authentication_username: AuthenticationUsernameEvidence::Explicit,
                                password_field_count: 0.into(),
                                new_password_field_count: 0.into(),
                                one_time_code_field_count: 0.into(),
                                semantic_submit_control_count: 0.into(),
                                source_origin: "https://accounts.google.com".into(),
                                form_identity: "signin-view".into(),
                                destination_identity:
                                    "https://accounts.google.com/v3/signin/identifier".into(),
                                label: "Next".into(),
                                machine_identity: "identifierNext =".into(),
                                submission_method: PageControlSubmissionMethod::Absent,
                                submission_destination_source:
                                    PageControlSubmissionDestinationSource::Omitted,
                            },
                        ),
                    ..Default::default()
                },
            })
        }

        fn password() -> Result<credential_fill::GoogleLoginPageObservation, JsError> {
            Ok(credential_fill::GoogleLoginPageObservation {
                page_url: "https://accounts.google.com/v3/signin/challenge/pwd"
                    .to_owned()
                    .try_into()?,
                authorization_generation: "generation".to_owned().try_into()?,
                elapsed_milliseconds: 1_000.into(),
                identifier_integrity: GoogleLoginIdentifierIntegrity::Unchanged,
                user_intent: GoogleLoginUserIntent::Continuing,
                password_occupancy: GoogleLoginPasswordOccupancy::Empty,
                facts: AuthenticationPageObservationFacts {
                    fields: AuthenticationFieldObservationFacts {
                        current_password_field_count: 1.into(),
                        actionable_password_field_count: 1.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            })
        }
    }

    #[wasm_bindgen_test]
    fn structural_facts_begin_and_admit_formless_password_once() -> Result<(), JsError> {
        let request = credential_fill::GoogleLoginStartRequest {
            observation: GoogleLoginFixture::identifier()?,
            selection_authority: GoogleLoginSelectionAuthority::DetectedLogin,
        }
        .into_ts()?;
        let owner = begin_google_two_step_login(&request)?;
        let challenge = GoogleLoginFixture::password()?;
        assert_eq!(
            (AuthenticationPageObservationFactsBatch {
                observations: vec![challenge.facts.clone()],
            })
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );
        let challenge = challenge.into_ts()?;
        assert_eq!(
            owner.inspect(&challenge)?,
            GoogleLoginContinuationDecision::FillPassword
        );
        assert_eq!(
            owner.admit_password(&challenge)?,
            CredentialKind::CurrentPassword
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn structural_start_rejects_focused_selection_as_js_error() -> Result<(), JsError> {
        let observation = credential_fill::GoogleLoginPageObservation {
            page_url: "https://accounts.google.com/v3/signin/identifier"
                .to_owned()
                .try_into()?,
            authorization_generation: "generation".to_owned().try_into()?,
            elapsed_milliseconds: 0.into(),
            identifier_integrity: GoogleLoginIdentifierIntegrity::Unchanged,
            user_intent: GoogleLoginUserIntent::Continuing,
            password_occupancy: GoogleLoginPasswordOccupancy::Empty,
            facts: AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    username_field_count: 1.into(),
                    ..Default::default()
                },
                ..Default::default()
            },
        };
        let request = credential_fill::GoogleLoginStartRequest {
            observation,
            selection_authority: GoogleLoginSelectionAuthority::FocusedField,
        }
        .into_ts()?;
        assert!(begin_google_two_step_login(&request).is_err());
        assert_eq!(
            request.to_rust()?.selection_authority,
            GoogleLoginSelectionAuthority::FocusedField
        );
        Ok(())
    }
}
