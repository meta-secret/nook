//! Typed WASM bindings for portable page-field and password-form policy.

use nook_companion_core::AuthenticationAdvanceControlObservation;
use nook_companion_core::AuthenticationControlText;
use nook_companion_core::AuthenticationRouteActuation;
use nook_companion_core::AuthenticationRouteEvidence;
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
                login_context: login_context.into(),
            },
        }
    }
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn expand_identity_text(value: &str) -> String {
    AuthenticationControlText::new(value).expand_identity_text()
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn has_login_context(observation: &NookLoginContextObservation) -> bool {
    observation.inner.has_login_context()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_username_field(field: &NookPageInputFieldObservation) -> bool {
    field.inner.looks_like_username_field()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_one_time_code_field(field: &NookPageInputFieldObservation) -> bool {
    field.inner.looks_like_one_time_code_field()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_one_time_code_auto_submit_signal(signal: &str) -> bool {
    AuthenticationControlText::new(signal).looks_like_one_time_code_auto_submit_signal()
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

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_manual_checkpoint_label(label: &str) -> bool {
    AuthenticationAdvanceControlObservation::looks_like_manual_checkpoint_label(label)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_email_verification_body(body: &str) -> bool {
    AuthenticationAdvanceControlObservation::looks_like_email_verification_body(body)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_login_advance_control_label(label: &str) -> bool {
    AuthenticationAdvanceControlObservation::looks_like_login_advance_control_label(label)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn has_safe_authentication_route_identity(
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
) -> bool {
    AuthenticationAdvanceControlObservation::has_safe_authentication_route_identity(
        AuthenticationRouteEvidence {
            source_origin,
            form_identity,
            destination_identity,
        },
    )
}

#[wasm_bindgen]
#[must_use]
#[expect(
    clippy::too_many_arguments,
    clippy::fn_params_excessive_bools,
    reason = "typed WASM policy boundary"
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn can_activate_authentication_route_control(
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
    AuthenticationAdvanceControlObservation::can_activate_authentication_route_control(
        AuthenticationRouteActuation {
            source_origin,
            form_identity,
            destination_identity,
            control_label,
            control_machine_identity,
            has_concrete_control: (has_concrete_control).into(),
            has_authentication_username: (has_authentication_username).into(),
            has_local_authentication_scope: (has_local_authentication_scope).into(),
            has_authentication_password: (has_authentication_password).into(),
        },
    )
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_implicit_submit_actuation_is_safe(
    observation: nook_companion_core::AuthenticationImplicitSubmitActuationObservation,
) -> bool {
    observation.is_safe()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_advance_control_is_safe(
    observation: nook_companion_core::AuthenticationAdvanceControlObservation,
) -> bool {
    observation.authentication_advance_control_is_safe()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_passkey_control_candidate_is_safe(
    candidate: nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation,
) -> bool {
    candidate.authentication_passkey_control_candidate_is_safe()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_passkey_control_evidence_is_safe(
    evidence: nook_companion_core::AuthenticationDetailedPasskeyControlObservation,
) -> bool {
    evidence.authentication_passkey_control_evidence_is_safe()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: exposes the authentication observation priority to JavaScript"
    )
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_form_observation_priority(
    observation: nook_companion_core::AuthenticationPageObservation,
) -> u8 {
    (observation)
        .authentication_form_observation_priority()
        .into()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: exposes the authentication facts priority to JavaScript"
    )
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_page_observation_facts_priority(
    facts: nook_companion_core::AuthenticationPageObservationFacts,
) -> u8 {
    (facts)
        .authentication_page_observation_facts_priority()
        .into()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn parse_page_input_type(value: &str) -> nook_companion_core::PageInputType {
    nook_companion_core::PageInputType::parse(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
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
        assert!(
            AuthenticationControlText::new("oninput=this.form.requestSubmit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            AuthenticationControlText::new("oninput=this.form.submit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            !AuthenticationControlText::new("oninput=validate_requestSubmit()")
                .looks_like_one_time_code_auto_submit_signal()
        );

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
            current_password_field_count: 1.into(),
            ..Default::default()
        };
        assert_eq!(
            u8::from((login).authentication_form_observation_priority()),
            4
        );
        assert_eq!(
            u8::from(
                (nook_companion_core::AuthenticationPageObservationFacts::default())
                    .authentication_page_observation_facts_priority()
            ),
            1
        );
        let login_facts = nook_companion_core::AuthenticationPageObservationFacts {
            fields: nook_companion_core::AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                current_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..Default::default()
            },
            detailed_advance_control:
                nook_companion_core::AuthenticationDetailedAdvanceControlObservation::observed(
                    login_advance_observation("https://login.example.test/auth/login", "Sign in"),
                ),
            ..Default::default()
        };
        assert_eq!(
            u8::from((login_facts).authentication_page_observation_facts_priority()),
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
            password_field_count: 1.into(),
            new_password_field_count: 0.into(),
            one_time_code_field_count: 0.into(),
            semantic_submit_control_count: 1.into(),
            source_origin: "https://login.example.test".to_owned(),
            form_identity: "login-form".to_owned(),
            destination_identity: destination.to_owned(),
            label: label.to_owned(),
            machine_identity: String::new(),
            submission_method: nook_companion_core::PageControlSubmissionMethod::Absent,
            submission_destination_source:
                nook_companion_core::PageControlSubmissionDestinationSource::Authored,
        }
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_accepts_and_rejects_observations() {
        assert!(authentication_advance_control_is_safe(
            login_advance_observation("https://login.example.test/auth/login", "Sign in",)
        ));
        assert!(!authentication_advance_control_is_safe(
            login_advance_observation("https://login.example.test/register", "Sign in",)
        ));
        let mut identifier_get =
            login_advance_observation("https://login.example.test/auth/login", "Continue");
        identifier_get.password_field_count = 0.into();
        identifier_get.submission_method = nook_companion_core::PageControlSubmissionMethod::Get;
        identifier_get.submission_destination_source =
            nook_companion_core::PageControlSubmissionDestinationSource::Authored;
        assert!(authentication_advance_control_is_safe(
            identifier_get.clone()
        ));
        identifier_get.submission_destination_source =
            nook_companion_core::PageControlSubmissionDestinationSource::Omitted;
        identifier_get.form_identity.clear();
        assert!(authentication_advance_control_is_safe(identifier_get));

        let mut microsoft = login_advance_observation("https://login.live.com/", "Next");
        microsoft.authentication_username =
            nook_companion_core::AuthenticationUsernameEvidence::Explicit;
        microsoft.password_field_count = 0.into();
        microsoft.source_origin = "https://login.live.com".to_owned();
        microsoft.form_identity.clear();
        microsoft.submission_method = nook_companion_core::PageControlSubmissionMethod::Post;
        assert!(authentication_advance_control_is_safe(microsoft.clone()));

        let mut non_default_port = microsoft.clone();
        non_default_port.source_origin = "https://login.live.com:8443".to_owned();
        non_default_port.destination_identity = "https://login.live.com:8443/".to_owned();
        assert!(!authentication_advance_control_is_safe(non_default_port));

        for destination in [
            "https://live.com/",
            "https://login.microsoftonline.com/",
            "https://login.live.com/?mode=login",
            "https://login.live.com/#login",
        ] {
            let mut rejected = microsoft.clone();
            rejected.destination_identity = destination.to_owned();
            assert!(!authentication_advance_control_is_safe(rejected));
        }

        microsoft.form_identity = "signup".to_owned();
        assert!(!authentication_advance_control_is_safe(microsoft.clone()));
        microsoft.form_identity.clear();
        microsoft.password_field_count = 1.into();
        assert!(!authentication_advance_control_is_safe(microsoft.clone()));
        microsoft.password_field_count = 0.into();
        microsoft.submission_method = nook_companion_core::PageControlSubmissionMethod::Get;
        assert!(!authentication_advance_control_is_safe(microsoft));
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_amazon_identifier_policy() {
        let mut amazon = login_advance_observation("https://www.amazon.com/ax/claim", "Continue");
        amazon.authentication_username =
            nook_companion_core::AuthenticationUsernameEvidence::Generic;
        amazon.password_field_count = 0.into();
        amazon.source_origin = "https://www.amazon.com".to_owned();
        amazon.form_identity = "ap_login_form signIn".to_owned();
        amazon.submission_method = nook_companion_core::PageControlSubmissionMethod::Post;
        assert!(authentication_advance_control_is_safe(amazon.clone()));

        let mut cross_origin = amazon.clone();
        cross_origin.destination_identity = "https://attacker.example/ax/claim".to_owned();
        assert!(!authentication_advance_control_is_safe(cross_origin));

        amazon.submission_method = nook_companion_core::PageControlSubmissionMethod::Get;
        assert!(!authentication_advance_control_is_safe(amazon));
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_linkedin_button_login_policy() {
        let mut linkedin = login_advance_observation("https://www.linkedin.com/login/", "Sign in");
        linkedin.source_origin = "https://www.linkedin.com".to_owned();
        linkedin.form_identity.clear();
        linkedin.ownership = nook_companion_core::PageControlOwnership::LocallyScoped;
        linkedin.semantics = nook_companion_core::PageControlSemantics::Activation;
        linkedin.semantic_submit_control_count = 0.into();
        assert!(authentication_advance_control_is_safe(linkedin.clone()));

        let mut owned_form = linkedin.clone();
        owned_form.ownership = nook_companion_core::PageControlOwnership::OwnedForm;
        assert!(!authentication_advance_control_is_safe(owned_form.clone()));
        owned_form.form_identity = "login-form".to_owned();
        assert!(authentication_advance_control_is_safe(owned_form));

        for label in [
            "Show password",
            "Keep me signed in",
            "Forgot password",
            "Sign in with Apple",
            "Use passkey",
            "Continue with SAML",
            "Sign in with SSO",
            "Join now",
            "Terms of Service",
            "Privacy Policy",
            "Delete account",
        ] {
            let mut rejected = linkedin.clone();
            rejected.label = label.to_owned();
            assert!(!authentication_advance_control_is_safe(rejected), "{label}");
        }

        for destination in [
            "https://attacker.example/login/",
            "https://www.linkedin.com/signup",
            "https://www.linkedin.com/checkpoint/rp/request-password-reset",
            "https://www.linkedin.com/login?provider=apple",
        ] {
            let mut rejected = linkedin.clone();
            rejected.destination_identity = destination.to_owned();
            assert!(
                !authentication_advance_control_is_safe(rejected),
                "{destination}"
            );
        }

        for form_identity in ["signup", "passkey", "saml", "enterprise-sso"] {
            let mut rejected = linkedin.clone();
            rejected.form_identity = form_identity.to_owned();
            assert!(
                !authentication_advance_control_is_safe(rejected),
                "{form_identity}"
            );
        }

        for machine_identity in ["provider=apple", "reset-password", "delete-account"] {
            let mut rejected = linkedin.clone();
            rejected.machine_identity = machine_identity.to_owned();
            assert!(
                !authentication_advance_control_is_safe(rejected),
                "{machine_identity}"
            );
        }

        let mut unowned = linkedin.clone();
        unowned.ownership = nook_companion_core::PageControlOwnership::Unowned;
        assert!(!authentication_advance_control_is_safe(unowned));

        let mut inert = linkedin.clone();
        inert.actionability = nook_companion_core::PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(inert));

        linkedin.semantics = nook_companion_core::PageControlSemantics::SemanticSubmit;
        linkedin.semantic_submit_control_count = 2.into();
        linkedin.label = "Primary action".to_owned();
        assert!(!authentication_advance_control_is_safe(linkedin));
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_tesla_webauthn_email_policy() {
        let mut tesla =
            login_advance_observation("https://auth.tesla.com/oauth2/v1/authorize", "Next");
        tesla.authentication_username =
            nook_companion_core::AuthenticationUsernameEvidence::WebAuthnEmail;
        tesla.password_field_count = 0.into();
        tesla.source_origin = "https://auth.tesla.com".to_owned();
        tesla.form_identity.clear();
        tesla.submission_method = nook_companion_core::PageControlSubmissionMethod::Get;
        tesla.submission_destination_source =
            nook_companion_core::PageControlSubmissionDestinationSource::Omitted;
        assert!(authentication_advance_control_is_safe(tesla.clone()));

        let mut initial = tesla.clone();
        initial.actionability = nook_companion_core::PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(initial.clone()));
        let planning_facts = nook_companion_core::AuthenticationPageObservationFacts {
            fields: nook_companion_core::AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                ..Default::default()
            },
            detailed_advance_control:
                nook_companion_core::AuthenticationDetailedAdvanceControlObservation::observed(
                    initial,
                ),
            ..Default::default()
        };
        assert!(matches!(
            nook_companion_core::AuthenticationPageObservationFactsBatch {
                observations: vec![planning_facts.clone()],
            }
            .classify(),
            nook_companion_core::AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == nook_companion_core::AuthenticationWorkflowKind::Login
                    && snapshot.action
                        == nook_companion_core::AuthenticationWorkflowAction::ContinueWithNook
        ));
        let wasm_workflow = crate::classify_companion_authentication_workflow_facts(
            nook_companion_core::AuthenticationPageObservationFactsBatch {
                observations: vec![planning_facts],
            },
        );
        assert_eq!(
            crate::companion_authentication_workflow_match_kind(wasm_workflow),
            crate::CompanionAuthenticationWorkflowMatchKind::Matched
        );

        for evidence in [
            nook_companion_core::AuthenticationUsernameEvidence::Absent,
            nook_companion_core::AuthenticationUsernameEvidence::Generic,
            nook_companion_core::AuthenticationUsernameEvidence::StandardsBasedEmail,
            nook_companion_core::AuthenticationUsernameEvidence::Strong,
        ] {
            let mut rejected = tesla.clone();
            rejected.authentication_username = evidence;
            assert!(!authentication_advance_control_is_safe(rejected));
        }

        for destination in [
            "https://attacker.example/",
            "https://auth.tesla.com/signup",
            "https://auth.tesla.com/recover",
            "https://auth.tesla.com/?provider=google",
            "https://auth.tesla.com/account/delete",
            "https://auth.tesla.com/oauth2/v1beta/authorize",
            "https://auth.tesla.com/oauth2/v1/token",
        ] {
            let mut rejected = tesla.clone();
            rejected.destination_identity = destination.to_owned();
            assert!(
                !authentication_advance_control_is_safe(rejected),
                "{destination}"
            );
        }

        let mut ambiguous = tesla.clone();
        ambiguous.semantic_submit_control_count = 2.into();
        assert!(!authentication_advance_control_is_safe(ambiguous));

        let mut unowned = tesla.clone();
        unowned.ownership = nook_companion_core::PageControlOwnership::Unowned;
        assert!(!authentication_advance_control_is_safe(unowned));

        tesla.actionability = nook_companion_core::PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(tesla));
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_claude_email_policy() {
        let mut claude =
            login_advance_observation("https://claude.ai/login", "Continue with email");
        claude.authentication_username =
            nook_companion_core::AuthenticationUsernameEvidence::StandardsBasedEmail;
        claude.password_field_count = 0.into();
        claude.source_origin = "https://claude.ai".to_owned();
        claude.form_identity.clear();
        claude.submission_method = nook_companion_core::PageControlSubmissionMethod::Post;
        assert!(authentication_advance_control_is_safe(claude.clone()));

        let mut generic_email_get = claude.clone();
        generic_email_get.submission_method = nook_companion_core::PageControlSubmissionMethod::Get;
        assert!(!authentication_advance_control_is_safe(generic_email_get));

        for label in [
            "Continue with Google",
            "Continue with SSO",
            "Forgot password",
            "Delete account",
        ] {
            let mut rejected = claude.clone();
            rejected.label = label.to_owned();
            assert!(!authentication_advance_control_is_safe(rejected), "{label}");
        }

        for destination in [
            "https://attacker.example/login",
            "https://claude.ai/signup",
            "https://claude.ai/login?provider=google",
            "https://claude.ai/account/delete",
        ] {
            let mut rejected = claude.clone();
            rejected.destination_identity = destination.to_owned();
            assert!(
                !authentication_advance_control_is_safe(rejected),
                "{destination}"
            );
        }

        let mut inert = claude.clone();
        inert.actionability = nook_companion_core::PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(inert));

        let mut unowned = claude.clone();
        unowned.ownership = nook_companion_core::PageControlOwnership::Unowned;
        assert!(!authentication_advance_control_is_safe(unowned));

        claude.authentication_username =
            nook_companion_core::AuthenticationUsernameEvidence::Strong;
        claude.semantic_submit_control_count = 2.into();
        assert!(!authentication_advance_control_is_safe(claude));
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_netflix_post_login_policy() {
        let mut netflix = login_advance_observation("https://www.netflix.com/login", "Continue");
        netflix.authentication_username =
            nook_companion_core::AuthenticationUsernameEvidence::Strong;
        netflix.source_origin = "https://www.netflix.com".to_owned();
        netflix.form_identity.clear();
        netflix.submission_method = nook_companion_core::PageControlSubmissionMethod::Post;
        assert!(authentication_advance_control_is_safe(netflix.clone()));
        let generic_password_facts = nook_companion_core::AuthenticationPageObservationFacts {
            fields: nook_companion_core::AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                current_password_field_count: 0.into(),
                generic_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..Default::default()
            },
            detailed_advance_control:
                nook_companion_core::AuthenticationDetailedAdvanceControlObservation::observed(
                    netflix.clone(),
                ),
            ..Default::default()
        };
        assert_eq!(
            u8::from((generic_password_facts).authentication_page_observation_facts_priority()),
            3
        );

        for method in [
            nook_companion_core::PageControlSubmissionMethod::Get,
            nook_companion_core::PageControlSubmissionMethod::Dialog,
        ] {
            let mut rejected = netflix.clone();
            rejected.submission_method = method;
            assert!(!authentication_advance_control_is_safe(rejected));
        }

        for label in [
            "Get Help",
            "Forgot password",
            "Sign in with Google",
            "Use passkey",
            "Continue with SAML",
            "Sign in with SSO",
            "Create account",
            "Delete account",
        ] {
            let mut rejected = netflix.clone();
            rejected.label = label.to_owned();
            assert!(!authentication_advance_control_is_safe(rejected), "{label}");
        }

        for destination in [
            "/login",
            "https://attacker.example/login",
            "https://www.netflix.com/help",
            "https://www.netflix.com/login?provider=google",
            "https://www.netflix.com/login?action=delete",
        ] {
            let mut rejected = netflix.clone();
            rejected.destination_identity = destination.to_owned();
            assert!(
                !authentication_advance_control_is_safe(rejected),
                "{destination}"
            );
        }

        let mut unowned = netflix.clone();
        unowned.ownership = nook_companion_core::PageControlOwnership::Unowned;
        assert!(!authentication_advance_control_is_safe(unowned));

        let mut inert_help = netflix.clone();
        inert_help.actionability = nook_companion_core::PageControlActionability::Inert;
        inert_help.semantics = nook_companion_core::PageControlSemantics::Activation;
        inert_help.label = "Get Help".to_owned();
        assert!(!authentication_advance_control_is_safe(inert_help));

        netflix.semantic_submit_control_count = 2.into();
        netflix.label = "Primary action".to_owned();
        assert!(!authentication_advance_control_is_safe(netflix));
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_facts_wasm_export_accepts_exact_login_mode_get() {
        let facts = nook_companion_core::AuthenticationPageObservationFacts {
            fields: nook_companion_core::AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                ..Default::default()
            },
            ceremony: nook_companion_core::AuthenticationCeremonyObservationFacts {
                authentication_context:
                    nook_companion_core::AuthenticationCeremonyContextObservation {
                        authentication_username:
                            nook_companion_core::AuthenticationUsernameEvidence::Explicit,
                        source_origin: "https://x.com".to_owned(),
                        form_identity: String::new(),
                        destination_identity: "https://x.com/i/jf/onboarding/web?mode=login"
                            .to_owned(),
                    },
                advance_control:
                    nook_companion_core::AuthenticationAdvanceControlEvidence::ImplicitSubmission,
                implicit_submission_method: nook_companion_core::PageControlSubmissionMethod::Get,
                ..Default::default()
            },
            ..Default::default()
        };
        let workflow = crate::classify_companion_authentication_workflow_facts(
            nook_companion_core::AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            },
        );
        assert_eq!(
            crate::companion_authentication_workflow_match_kind(workflow),
            crate::CompanionAuthenticationWorkflowMatchKind::Matched
        );
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn implicit_submit_actuation_wasm_export_preserves_exact_policy() {
        let mut observation =
            nook_companion_core::AuthenticationImplicitSubmitActuationObservation {
                fields: nook_companion_core::AuthenticationFieldObservationFacts {
                    username_field_count: 1.into(),
                    ..Default::default()
                },
                ceremony: nook_companion_core::AuthenticationCeremonyObservationFacts {
                    authentication_context:
                        nook_companion_core::AuthenticationCeremonyContextObservation {
                            authentication_username:
                                nook_companion_core::AuthenticationUsernameEvidence::Explicit,
                            source_origin: "https://x.com".to_owned(),
                            form_identity: String::new(),
                            destination_identity:
                                "https://x.com/i/jf/onboarding/web?mode=login".to_owned(),
                        },
                    advance_control: nook_companion_core::AuthenticationAdvanceControlEvidence::ImplicitSubmission,
                    implicit_submission_method:
                        nook_companion_core::PageControlSubmissionMethod::Get,
                    ..Default::default()
                },
                control_label: String::new(),
                control_machine_identity: String::new(),
            };
        assert!(authentication_implicit_submit_actuation_is_safe(
            observation.clone()
        ));

        observation.ceremony.authentication_context.form_identity = "signup".to_owned();
        assert!(!authentication_implicit_submit_actuation_is_safe(
            observation.clone()
        ));
        observation
            .ceremony
            .authentication_context
            .form_identity
            .clear();
        observation.control_label = "Continue with Google".to_owned();
        assert!(!authentication_implicit_submit_actuation_is_safe(
            observation
        ));
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_passkey_control_wasm_export_accepts_and_rejects_candidates() {
        let accepted =
            nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                login_advance_observation("https://login.example.test/auth/passkey", "Use passkey"),
            );
        assert!((accepted).authentication_passkey_control_candidate_is_safe());

        let rejected =
            nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                login_advance_observation(
                    "https://login.example.test/auth/passkey/enroll",
                    "Use passkey",
                ),
            );
        assert!(!(rejected).authentication_passkey_control_candidate_is_safe());

        let security_key_enrollment =
            nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                login_advance_observation(
                    "https://login.example.test/auth/security-key/create",
                    "Use security key",
                ),
            );
        assert!(!(security_key_enrollment).authentication_passkey_control_candidate_is_safe());

        let mut signup =
            login_advance_observation("https://login.example.test/auth/passkey", "Use passkey");
        signup.new_password_field_count = 1.into();
        let signup_candidate =
            nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                signup,
            );
        assert!(!(signup_candidate).authentication_passkey_control_candidate_is_safe());
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn remaining_page_policy_wrappers_preserve_core_classification() {
        assert_eq!(expand_identity_text("SignInForm2"), "sign in form 2");

        let login_context = NookLoginContextObservation::new(
            "checkout".to_owned(),
            vec!["account-login".to_owned()],
            "Submit".to_owned(),
            "/cart".to_owned(),
        );
        assert!(has_login_context(&login_context));

        assert!(
            AuthenticationAdvanceControlObservation::looks_like_passkey_control_label(
                "Sign in with passkey"
            )
        );
        assert!(
            !AuthenticationAdvanceControlObservation::looks_like_passkey_control_label(
                "Remove passkey"
            )
        );
        assert!(AuthenticationAdvanceControlObservation::looks_like_passkey_enrollment_or_management_label(
            "Add passkey"
        ));
        assert!(looks_like_manual_checkpoint_label("Accept privacy policy"));
        assert!(looks_like_email_verification_body(
            "Check your email to continue"
        ));

        let safe_passkey =
            nook_companion_core::AuthenticationDetailedPasskeyControlObservation::ExplicitlyMarked(
                login_advance_observation("https://login.example.test/auth/passkey", "Use passkey"),
            );
        assert!((safe_passkey).authentication_passkey_control_evidence_is_safe());
        assert_eq!(
            parse_page_input_type(" PASSWORD "),
            nook_companion_core::PageInputType::Password
        );
    }
}
