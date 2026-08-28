//! Typed WASM bindings for portable page-field and password-form policy.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookPageInputFieldObservation {
    inner: nook_companion_core::PageInputFieldObservation,
}

#[wasm_bindgen]
impl NookPageInputFieldObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
    pub fn new(
        input_type: nook_companion_core::PageInputType,
        disabled: bool,
        read_only: bool,
        autocomplete_tokens: Vec<String>,
        identity_text: String,
        login_context: bool,
    ) -> Self {
        Self {
            inner: nook_companion_core::PageInputFieldObservation {
                input_type,
                disabled,
                read_only,
                autocomplete_tokens,
                identity_text,
                login_context,
            },
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn expand_identity_text(value: &str) -> String {
    nook_companion_core::expand_identity_text(value)
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookLoginContextObservation {
    inner: nook_companion_core::LoginContextObservation,
}

#[wasm_bindgen]
impl NookLoginContextObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        form_identity: String,
        ancestor_identities: Vec<String>,
        advance_control_label: String,
        path_context: String,
    ) -> Self {
        Self {
            inner: nook_companion_core::LoginContextObservation {
                form_identity,
                ancestor_identities,
                advance_control_label,
                path_context,
            },
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn has_login_context(observation: &NookLoginContextObservation) -> bool {
    nook_companion_core::has_login_context(&observation.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_username_field(field: &NookPageInputFieldObservation) -> bool {
    nook_companion_core::looks_like_username_field(&field.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_username_evidence(
    field: &NookPageInputFieldObservation,
) -> nook_companion_core::AuthenticationUsernameEvidence {
    nook_companion_core::authentication_username_evidence(&field.inner)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn strongest_authentication_username_evidence(
    input: nook_companion_core::AuthenticationUsernameEvidenceBatch,
) -> nook_companion_core::AuthenticationUsernameEvidence {
    nook_companion_core::strongest_authentication_username_evidence(&input.evidence)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_one_time_code_field(field: &NookPageInputFieldObservation) -> bool {
    nook_companion_core::looks_like_one_time_code_field(&field.inner)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_one_time_code_auto_submit_signal(signal: &str) -> bool {
    nook_companion_core::looks_like_one_time_code_auto_submit_signal(signal)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_passkey_control_label(label: &str) -> bool {
    nook_companion_core::looks_like_passkey_control_label(label)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_manual_checkpoint_label(label: &str) -> bool {
    nook_companion_core::looks_like_manual_checkpoint_label(label)
}

#[wasm_bindgen]
#[must_use]
pub fn looks_like_email_verification_body(body: &str) -> bool {
    nook_companion_core::looks_like_email_verification_body(body)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_authentication_advance_control(
    observation: nook_companion_core::AuthenticationAdvanceControlObservation,
) -> nook_companion_core::AuthenticationAdvanceControlDecision {
    observation.classify()
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_form_observation_priority(
    observation: nook_companion_core::AuthenticationPageObservationFacts,
) -> nook_companion_core::AuthenticationFormObservationPriority {
    observation.form_priority()
}

#[wasm_bindgen]
#[must_use]
pub fn parse_page_input_type(value: &str) -> nook_companion_core::PageInputType {
    nook_companion_core::PageInputType::parse(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_form_wasm_exports_match_core_policy() {
        let otp = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "Enter OTP Code".to_owned(),
            false,
        );
        assert!(looks_like_one_time_code_field(&otp));
        assert!(looks_like_one_time_code_auto_submit_signal(
            "oninput=this.form.requestSubmit()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=validateCode()"
        ));

        let username = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "loginfmt".to_owned(),
            false,
        );
        assert!(looks_like_username_field(&username));

        let advance = nook_companion_core::AuthenticationAdvanceControlObservation {
            actionability: nook_companion_core::PageControlActionability::Actionable,
            ownership: nook_companion_core::PageControlOwnership::LocallyScoped,
            semantics: nook_companion_core::PageControlSemantics::Activation,
            authentication_username: nook_companion_core::AuthenticationUsernameEvidence::Explicit,
            password_field_count: 0,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 0,
            form_identity: String::new(),
            destination_identity: String::new(),
            label: "Continue".to_owned(),
        };
        assert_eq!(
            classify_authentication_advance_control(advance),
            nook_companion_core::AuthenticationAdvanceControlDecision::AdvancesAuthentication
        );

        let reset_password = nook_companion_core::AuthenticationAdvanceControlObservation {
            actionability: nook_companion_core::PageControlActionability::Actionable,
            ownership: nook_companion_core::PageControlOwnership::OwnedForm,
            semantics: nook_companion_core::PageControlSemantics::SemanticSubmit,
            authentication_username: nook_companion_core::AuthenticationUsernameEvidence::Absent,
            password_field_count: 1,
            new_password_field_count: 1,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            form_identity: "reset-password".to_owned(),
            destination_identity: String::new(),
            label: "Reset password".to_owned(),
        };
        assert_eq!(
            classify_authentication_advance_control(reset_password),
            nook_companion_core::AuthenticationAdvanceControlDecision::AdvancesAuthentication
        );

        let resend_code = nook_companion_core::AuthenticationAdvanceControlObservation {
            actionability: nook_companion_core::PageControlActionability::Actionable,
            ownership: nook_companion_core::PageControlOwnership::OwnedForm,
            semantics: nook_companion_core::PageControlSemantics::SemanticSubmit,
            authentication_username: nook_companion_core::AuthenticationUsernameEvidence::Absent,
            password_field_count: 0,
            new_password_field_count: 0,
            one_time_code_field_count: 1,
            semantic_submit_control_count: 1,
            form_identity: "otp-verification".to_owned(),
            destination_identity: String::new(),
            label: "Resend code".to_owned(),
        };
        assert_eq!(
            classify_authentication_advance_control(resend_code),
            nook_companion_core::AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        );

        let login = nook_companion_core::AuthenticationPageObservationFacts {
            fields: nook_companion_core::AuthenticationFieldObservationFacts {
                current_password_field_count: 1,
                ..Default::default()
            },
            ..Default::default()
        };
        assert_eq!(authentication_form_observation_priority(login).value(), 4);
    }
}
