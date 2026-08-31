//! Typed WASM bindings for portable page-field and password-form policy.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookPageInputFieldObservation {
    inner: nook_companion_core::PageInputFieldObservation,
}

impl NookPageInputFieldObservation {
    pub(crate) const fn as_core(&self) -> &nook_companion_core::PageInputFieldObservation {
        &self.inner
    }
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
pub fn looks_like_passkey_enrollment_or_management_label(label: &str) -> bool {
    nook_companion_core::looks_like_passkey_enrollment_or_management_label(label)
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
pub fn looks_like_login_advance_control_label(label: &str) -> bool {
    nook_companion_core::looks_like_login_advance_control_label(label)
}

#[wasm_bindgen]
#[must_use]
pub fn has_safe_authentication_route_identity(
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
) -> bool {
    nook_companion_core::has_safe_authentication_route_identity(
        source_origin,
        form_identity,
        destination_identity,
    )
}

#[wasm_bindgen]
#[must_use]
#[expect(
    clippy::too_many_arguments,
    clippy::fn_params_excessive_bools,
    reason = "typed WASM policy boundary"
)]
pub fn can_activate_authentication_route_control(
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
    control_label: &str,
    control_machine_identity: &str,
    has_concrete_control: bool,
    has_authentication_username: bool,
    has_local_authentication_scope: bool,
    has_authentication_password: bool,
) -> bool {
    nook_companion_core::can_activate_authentication_route_control(
        source_origin,
        form_identity,
        destination_identity,
        control_label,
        control_machine_identity,
        has_concrete_control,
        has_authentication_username,
        has_local_authentication_scope,
        has_authentication_password,
    )
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn authentication_advance_control_is_safe(
    observation: nook_companion_core::AuthenticationAdvanceControlObservation,
) -> bool {
    nook_companion_core::authentication_advance_control_is_safe(&observation)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn authentication_passkey_control_candidate_is_safe(
    candidate: nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation,
) -> bool {
    nook_companion_core::authentication_passkey_control_candidate_is_safe(&candidate)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn authentication_passkey_control_evidence_is_safe(
    evidence: nook_companion_core::AuthenticationDetailedPasskeyControlObservation,
) -> bool {
    nook_companion_core::authentication_passkey_control_evidence_is_safe(&evidence)
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_form_observation_priority(
    observation: nook_companion_core::AuthenticationPageObservation,
) -> u8 {
    nook_companion_core::authentication_form_observation_priority(observation)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn authentication_page_observation_facts_priority(
    facts: nook_companion_core::AuthenticationPageObservationFacts,
) -> u8 {
    nook_companion_core::authentication_page_observation_facts_priority(facts)
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
        assert!(looks_like_one_time_code_auto_submit_signal(
            "oninput=this.form.submit()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=validate_requestSubmit()"
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
        assert!(looks_like_login_advance_control_label("Entrar Entrar"));
        assert!(has_safe_authentication_route_identity(
            "https://example.test",
            "login-form",
            "https://example.test/auth/login?x=1",
        ));
        assert!(!has_safe_authentication_route_identity(
            "https://example.test",
            "login-form",
            "https://example.test/login?provider",
        ));
        assert!(!can_activate_authentication_route_control(
            "https://example.test",
            "login-form",
            "https://example.test/auth/login",
            "Continue",
            "reset-password",
            true,
            true,
            true,
            false,
        ));
        for has_concrete_control in [false, true] {
            assert_eq!(
                can_activate_authentication_route_control(
                    "https://example.test",
                    "login-form",
                    "https://example.test/auth/login",
                    "",
                    "",
                    has_concrete_control,
                    true,
                    true,
                    false,
                ),
                !has_concrete_control,
            );
        }
        assert!(can_activate_authentication_route_control(
            "https://example.test",
            "login-form",
            "https://example.test/session",
            "",
            "",
            false,
            false,
            true,
            true,
        ));
        assert!(!can_activate_authentication_route_control(
            "https://example.test",
            "login-form",
            "https://example.test/auth/login",
            "Continue",
            "",
            true,
            false,
            true,
            true,
        ));
        let login = nook_companion_core::AuthenticationPageObservation {
            current_password_field_count: 1,
            ..Default::default()
        };
        assert_eq!(authentication_form_observation_priority(login), 4);
        assert_eq!(
            authentication_page_observation_facts_priority(
                nook_companion_core::AuthenticationPageObservationFacts::default()
            ),
            1
        );
        let login_facts = nook_companion_core::AuthenticationPageObservationFacts {
            fields: nook_companion_core::AuthenticationFieldObservationFacts {
                username_field_count: 1,
                current_password_field_count: 1,
                actionable_password_field_count: 1,
                ..Default::default()
            },
            detailed_advance_control:
                nook_companion_core::AuthenticationDetailedAdvanceControlObservation::observed(
                    login_advance_observation("https://login.example.test/auth/login", "Sign in"),
                ),
            ..Default::default()
        };
        assert_eq!(
            authentication_page_observation_facts_priority(login_facts),
            4
        );
    }

    fn login_advance_observation(
        destination: &str,
        label: &str,
    ) -> nook_companion_core::AuthenticationAdvanceControlObservation {
        nook_companion_core::AuthenticationAdvanceControlObservation {
            actionability: nook_companion_core::PageControlActionability::Actionable,
            ownership: nook_companion_core::PageControlOwnership::OwnedForm,
            semantics: nook_companion_core::PageControlSemantics::SemanticSubmit,
            authentication_username: nook_companion_core::AuthenticationUsernameEvidence::Explicit,
            password_field_count: 1,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: "https://login.example.test".to_owned(),
            form_identity: "login-form".to_owned(),
            destination_identity: destination.to_owned(),
            label: label.to_owned(),
            machine_identity: String::new(),
            submission_method: nook_companion_core::PageControlSubmissionMethod::Absent,
        }
    }

    #[test]
    fn authentication_advance_control_wasm_export_accepts_and_rejects_observations() {
        assert!(authentication_advance_control_is_safe(
            login_advance_observation("https://login.example.test/auth/login", "Sign in",)
        ));
        assert!(!authentication_advance_control_is_safe(
            login_advance_observation("https://login.example.test/register", "Sign in",)
        ));
    }

    #[test]
    fn authentication_passkey_control_wasm_export_accepts_and_rejects_candidates() {
        let accepted =
            nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                login_advance_observation("https://login.example.test/auth/passkey", "Use passkey"),
            );
        assert!(authentication_passkey_control_candidate_is_safe(accepted));

        let rejected =
            nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                login_advance_observation(
                    "https://login.example.test/auth/passkey/enroll",
                    "Use passkey",
                ),
            );
        assert!(!authentication_passkey_control_candidate_is_safe(rejected));

        let security_key_enrollment =
            nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                login_advance_observation(
                    "https://login.example.test/auth/security-key/create",
                    "Use security key",
                ),
            );
        assert!(!authentication_passkey_control_candidate_is_safe(
            security_key_enrollment
        ));

        let mut signup =
            login_advance_observation("https://login.example.test/auth/passkey", "Use passkey");
        signup.new_password_field_count = 1;
        let signup_candidate =
            nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                signup,
            );
        assert!(!authentication_passkey_control_candidate_is_safe(
            signup_candidate
        ));
    }
}
