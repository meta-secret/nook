//! Typed WASM bindings for portable page-field and password-form policy.

use nook_companion_core::PageInputType;
mod observation_priority;
mod passkey_control;

pub use observation_priority::{
    authentication_form_observation_priority, authentication_page_observation_facts_priority,
};

pub use passkey_control::{
    authentication_passkey_control_candidate_is_safe,
    authentication_passkey_control_evidence_is_safe, looks_like_passkey_control_label,
    looks_like_passkey_enrollment_or_management_label,
};

use nook_companion_core::AuthenticationAdvanceControlObservation;
use nook_companion_core::AuthenticationContainerIdentity;
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen label predicate export"))] pub fn looks_like_authentication_container_identity(identity: &str) -> bool {
    matches!(
        AuthenticationControlText::new(identity).authentication_container_identity(),
        AuthenticationContainerIdentity::Authentication
    )
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn parse_page_input_type(value: &str) -> nook_companion_core::PageInputType {
    PageInputType::parse(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationAdvanceControlEvidence;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationDetailedAdvanceControlObservation;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationDetailedPasskeyControlCandidateObservation;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationDetailedPasskeyControlObservation;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationPageObservationFacts;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationUsernameEvidence;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationWorkflowAction;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationWorkflowKind;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::AuthenticationWorkflowMatch;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::PageControlActionability;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::PageControlOwnership;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::PageControlSemantics;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::PageControlSubmissionDestinationSource;
    #[cfg(test)]
    #[cfg(test)]
    use nook_companion_core::PageControlSubmissionMethod;
    use nook_companion_core::PageInputType;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn page_form_wasm_exports_match_one_time_code_policy() {
        let otp = NookPageInputFieldObservation::new(
            PageInputType::Text,
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
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn page_form_wasm_exports_match_authentication_route_policy() {
        assert!(looks_like_authentication_container_identity("signIn"));
        assert!(looks_like_authentication_container_identity(
            "reset-password"
        ));
        assert!(!looks_like_authentication_container_identity(
            "reset_base__abc knox-reset"
        ));
        let username = NookPageInputFieldObservation::new(
            PageInputType::Text,
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
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn page_form_wasm_exports_match_observation_priority_policy() {
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
                (AuthenticationPageObservationFacts::default())
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
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
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
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            password_field_count: 1.into(),
            new_password_field_count: 0.into(),
            one_time_code_field_count: 0.into(),
            semantic_submit_control_count: 1.into(),
            source_origin: "https://login.example.test".to_owned(),
            form_identity: "login-form".to_owned(),
            destination_identity: destination.to_owned(),
            label: label.to_owned(),
            machine_identity: String::new(),
            submission_method: PageControlSubmissionMethod::Absent,
            submission_destination_source: PageControlSubmissionDestinationSource::Authored,
        }
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_accepts_and_rejects_observations() {
        assert!(
            (login_advance_observation("https://login.example.test/auth/login", "Sign in",))
                .authentication_advance_control_is_safe()
        );
        assert!(
            !(login_advance_observation("https://login.example.test/register", "Sign in",))
                .authentication_advance_control_is_safe()
        );
        let mut identifier_get =
            login_advance_observation("https://login.example.test/auth/login", "Continue");
        identifier_get.password_field_count = 0.into();
        identifier_get.submission_method = PageControlSubmissionMethod::Get;
        identifier_get.submission_destination_source =
            PageControlSubmissionDestinationSource::Authored;
        assert!((identifier_get.clone()).authentication_advance_control_is_safe());
        identifier_get.submission_destination_source =
            PageControlSubmissionDestinationSource::Omitted;
        identifier_get.form_identity.clear();
        assert!((identifier_get).authentication_advance_control_is_safe());

        let mut microsoft = login_advance_observation("https://login.live.com/", "Next");
        microsoft.authentication_username = AuthenticationUsernameEvidence::Explicit;
        microsoft.password_field_count = 0.into();
        microsoft.source_origin = "https://login.live.com".to_owned();
        microsoft.form_identity.clear();
        microsoft.submission_method = PageControlSubmissionMethod::Post;
        assert!((microsoft.clone()).authentication_advance_control_is_safe());

        let mut non_default_port = microsoft.clone();
        non_default_port.source_origin = "https://login.live.com:8443".to_owned();
        non_default_port.destination_identity = "https://login.live.com:8443/".to_owned();
        assert!(!(non_default_port).authentication_advance_control_is_safe());

        for destination in [
            "https://live.com/",
            "https://login.microsoftonline.com/",
            "https://login.live.com/?mode=login",
            "https://login.live.com/#login",
        ] {
            let mut rejected = microsoft.clone();
            rejected.destination_identity = destination.to_owned();
            assert!(!(rejected).authentication_advance_control_is_safe());
        }

        microsoft.form_identity = "signup".to_owned();
        assert!(!(microsoft.clone()).authentication_advance_control_is_safe());
        microsoft.form_identity.clear();
        microsoft.password_field_count = 1.into();
        assert!(!(microsoft.clone()).authentication_advance_control_is_safe());
        microsoft.password_field_count = 0.into();
        microsoft.submission_method = PageControlSubmissionMethod::Get;
        assert!(!(microsoft).authentication_advance_control_is_safe());
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_amazon_identifier_policy() {
        let mut amazon = login_advance_observation("https://www.amazon.com/ax/claim", "Continue");
        amazon.authentication_username = AuthenticationUsernameEvidence::Generic;
        amazon.password_field_count = 0.into();
        amazon.source_origin = "https://www.amazon.com".to_owned();
        amazon.form_identity = "ap_login_form signIn".to_owned();
        amazon.submission_method = PageControlSubmissionMethod::Post;
        assert!((amazon.clone()).authentication_advance_control_is_safe());

        let mut cross_origin = amazon.clone();
        cross_origin.destination_identity = "https://attacker.example/ax/claim".to_owned();
        assert!(!(cross_origin).authentication_advance_control_is_safe());

        amazon.submission_method = PageControlSubmissionMethod::Get;
        assert!(!(amazon).authentication_advance_control_is_safe());
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_linkedin_button_login_policy() {
        let mut linkedin = login_advance_observation("https://www.linkedin.com/login/", "Sign in");
        linkedin.source_origin = "https://www.linkedin.com".to_owned();
        linkedin.form_identity.clear();
        linkedin.ownership = PageControlOwnership::LocallyScoped;
        linkedin.semantics = PageControlSemantics::Activation;
        linkedin.semantic_submit_control_count = 0.into();
        assert!((linkedin.clone()).authentication_advance_control_is_safe());

        let mut owned_form = linkedin.clone();
        owned_form.ownership = PageControlOwnership::OwnedForm;
        assert!(!(owned_form.clone()).authentication_advance_control_is_safe());
        owned_form.form_identity = "login-form".to_owned();
        assert!((owned_form).authentication_advance_control_is_safe());

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
            assert!(
                !(rejected).authentication_advance_control_is_safe(),
                "{label}"
            );
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
                !(rejected).authentication_advance_control_is_safe(),
                "{destination}"
            );
        }

        for form_identity in ["signup", "passkey", "saml", "enterprise-sso"] {
            let mut rejected = linkedin.clone();
            rejected.form_identity = form_identity.to_owned();
            assert!(
                !(rejected).authentication_advance_control_is_safe(),
                "{form_identity}"
            );
        }

        for machine_identity in ["provider=apple", "reset-password", "delete-account"] {
            let mut rejected = linkedin.clone();
            rejected.machine_identity = machine_identity.to_owned();
            assert!(
                !(rejected).authentication_advance_control_is_safe(),
                "{machine_identity}"
            );
        }

        let mut unowned = linkedin.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!(unowned).authentication_advance_control_is_safe());

        let mut inert = linkedin.clone();
        inert.actionability = PageControlActionability::Inert;
        assert!(!(inert).authentication_advance_control_is_safe());

        linkedin.semantics = PageControlSemantics::SemanticSubmit;
        linkedin.semantic_submit_control_count = 2.into();
        linkedin.label = "Primary action".to_owned();
        assert!(!(linkedin).authentication_advance_control_is_safe());
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_tesla_webauthn_email_policy() {
        let mut tesla =
            login_advance_observation("https://auth.tesla.com/oauth2/v1/authorize", "Next");
        tesla.authentication_username = AuthenticationUsernameEvidence::WebAuthnEmail;
        tesla.password_field_count = 0.into();
        tesla.source_origin = "https://auth.tesla.com".to_owned();
        tesla.form_identity.clear();
        tesla.submission_method = PageControlSubmissionMethod::Get;
        tesla.submission_destination_source = PageControlSubmissionDestinationSource::Omitted;
        assert!((tesla.clone()).authentication_advance_control_is_safe());

        let mut initial = tesla.clone();
        initial.actionability = PageControlActionability::Inert;
        assert!(!(initial.clone()).authentication_advance_control_is_safe());
        let planning_facts = nook_companion_core::AuthenticationPageObservationFacts {
            fields: nook_companion_core::AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                initial,
            ),
            ..Default::default()
        };
        assert!(matches!(
            nook_companion_core::AuthenticationPageObservationFactsBatch {
                observations: vec![planning_facts.clone()],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::Login
                    && snapshot.action
                        == AuthenticationWorkflowAction::ContinueWithNook
        ));
        let wasm_workflow = (nook_companion_core::AuthenticationPageObservationFactsBatch {
            observations: vec![planning_facts],
        })
        .classify();
        assert!(matches!(
            wasm_workflow,
            AuthenticationWorkflowMatch::Matched(_)
        ));

        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
            AuthenticationUsernameEvidence::Strong,
        ] {
            let mut rejected = tesla.clone();
            rejected.authentication_username = evidence;
            assert!(!(rejected).authentication_advance_control_is_safe());
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
                !(rejected).authentication_advance_control_is_safe(),
                "{destination}"
            );
        }

        let mut ambiguous = tesla.clone();
        ambiguous.semantic_submit_control_count = 2.into();
        assert!(!(ambiguous).authentication_advance_control_is_safe());

        let mut unowned = tesla.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!(unowned).authentication_advance_control_is_safe());

        tesla.actionability = PageControlActionability::Inert;
        assert!(!(tesla).authentication_advance_control_is_safe());
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn password_disclosure_planning_export_preserves_exact_tesla_policy() {
        let mut tesla = login_advance_observation(
            "https://auth.tesla.com/oauth2/v1/authorize?response_type=code&client_id=accounts&redirect_uri=https%3A%2F%2Faccounts.tesla.com%2Foauth2%2Fcallback&scope=offline_access+user+profile+ou_code+email&locale=en-US",
            "Sign In",
        );
        tesla.actionability = PageControlActionability::Inert;
        tesla.authentication_username = AuthenticationUsernameEvidence::Absent;
        tesla.password_field_count = 1.into();
        tesla.source_origin = "https://auth.tesla.com".to_owned();
        tesla.form_identity.clear();
        tesla.machine_identity = "tds-btn".to_owned();
        tesla.submission_method = PageControlSubmissionMethod::Get;
        tesla.submission_destination_source = PageControlSubmissionDestinationSource::Omitted;
        assert!((tesla.clone()).allows_tesla_password_disclosure_planning());

        for mutate in [
            |control: &mut nook_companion_core::AuthenticationAdvanceControlObservation| {
                control.destination_identity =
                    "https://auth.tesla.com/oauth2/v1/authorize".to_owned();
            },
            |control: &mut nook_companion_core::AuthenticationAdvanceControlObservation| {
                control.label = "Continue".to_owned();
            },
            |control: &mut nook_companion_core::AuthenticationAdvanceControlObservation| {
                control.machine_identity = "primary".to_owned();
            },
        ] {
            let mut rejected = tesla.clone();
            mutate(&mut rejected);
            assert!(!(rejected).allows_tesla_password_disclosure_planning());
        }
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_claude_email_policy() {
        let mut claude =
            login_advance_observation("https://claude.ai/login", "Continue with email");
        claude.authentication_username = AuthenticationUsernameEvidence::StandardsBasedEmail;
        claude.password_field_count = 0.into();
        claude.source_origin = "https://claude.ai".to_owned();
        claude.form_identity.clear();
        claude.submission_method = PageControlSubmissionMethod::Post;
        assert!((claude.clone()).authentication_advance_control_is_safe());

        let mut generic_email_get = claude.clone();
        generic_email_get.submission_method = PageControlSubmissionMethod::Get;
        assert!(!(generic_email_get).authentication_advance_control_is_safe());

        for label in [
            "Continue with Google",
            "Continue with SSO",
            "Forgot password",
            "Delete account",
        ] {
            let mut rejected = claude.clone();
            rejected.label = label.to_owned();
            assert!(
                !(rejected).authentication_advance_control_is_safe(),
                "{label}"
            );
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
                !(rejected).authentication_advance_control_is_safe(),
                "{destination}"
            );
        }

        let mut inert = claude.clone();
        inert.actionability = PageControlActionability::Inert;
        assert!(!(inert).authentication_advance_control_is_safe());

        let mut unowned = claude.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!(unowned).authentication_advance_control_is_safe());

        claude.authentication_username = AuthenticationUsernameEvidence::Strong;
        claude.semantic_submit_control_count = 2.into();
        assert!(!(claude).authentication_advance_control_is_safe());
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_advance_control_wasm_export_preserves_netflix_post_login_policy() {
        let mut netflix = login_advance_observation("https://www.netflix.com/login", "Continue");
        netflix.authentication_username = AuthenticationUsernameEvidence::Strong;
        netflix.source_origin = "https://www.netflix.com".to_owned();
        netflix.form_identity.clear();
        netflix.submission_method = PageControlSubmissionMethod::Post;
        assert!((netflix.clone()).authentication_advance_control_is_safe());
        let generic_password_facts = nook_companion_core::AuthenticationPageObservationFacts {
            fields: nook_companion_core::AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                current_password_field_count: 0.into(),
                generic_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                netflix.clone(),
            ),
            ..Default::default()
        };
        assert_eq!(
            u8::from((generic_password_facts).authentication_page_observation_facts_priority()),
            3
        );

        for method in [
            PageControlSubmissionMethod::Get,
            PageControlSubmissionMethod::Dialog,
        ] {
            let mut rejected = netflix.clone();
            rejected.submission_method = method;
            assert!(!(rejected).authentication_advance_control_is_safe());
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
            assert!(
                !(rejected).authentication_advance_control_is_safe(),
                "{label}"
            );
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
                !(rejected).authentication_advance_control_is_safe(),
                "{destination}"
            );
        }

        let mut unowned = netflix.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!(unowned).authentication_advance_control_is_safe());

        let mut inert_help = netflix.clone();
        inert_help.actionability = PageControlActionability::Inert;
        inert_help.semantics = PageControlSemantics::Activation;
        inert_help.label = "Get Help".to_owned();
        assert!(!(inert_help).authentication_advance_control_is_safe());

        netflix.semantic_submit_control_count = 2.into();
        netflix.label = "Primary action".to_owned();
        assert!(!(netflix).authentication_advance_control_is_safe());
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
                        authentication_username: AuthenticationUsernameEvidence::Explicit,
                        source_origin: "https://x.com".to_owned(),
                        form_identity: String::new(),
                        destination_identity: "https://x.com/i/jf/onboarding/web?mode=login"
                            .to_owned(),
                    },
                advance_control: AuthenticationAdvanceControlEvidence::ImplicitSubmission,
                implicit_submission_method: PageControlSubmissionMethod::Get,
                ..Default::default()
            },
            ..Default::default()
        };
        let workflow = (nook_companion_core::AuthenticationPageObservationFactsBatch {
            observations: vec![facts],
        })
        .classify();
        assert!(matches!(workflow, AuthenticationWorkflowMatch::Matched(_)));
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
                            authentication_username: AuthenticationUsernameEvidence::Explicit,
                            source_origin: "https://x.com".to_owned(),
                            form_identity: String::new(),
                            destination_identity: "https://x.com/i/jf/onboarding/web?mode=login"
                                .to_owned(),
                        },
                    advance_control: AuthenticationAdvanceControlEvidence::ImplicitSubmission,
                    implicit_submission_method: PageControlSubmissionMethod::Get,
                    ..Default::default()
                },
                control_label: String::new(),
                control_machine_identity: String::new(),
            };
        assert!((observation.clone()).is_safe());

        observation.ceremony.authentication_context.form_identity = "signup".to_owned();
        assert!(!(observation.clone()).is_safe());
        observation
            .ceremony
            .authentication_context
            .form_identity
            .clear();
        observation.control_label = "Continue with Google".to_owned();
        assert!(!(observation).is_safe());
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn authentication_passkey_control_wasm_export_accepts_and_rejects_candidates() {
        let accepted = AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
            login_advance_observation("https://login.example.test/auth/passkey", "Use passkey"),
        );
        assert!((accepted).authentication_passkey_control_candidate_is_safe());

        let rejected = AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
            login_advance_observation(
                "https://login.example.test/auth/passkey/enroll",
                "Use passkey",
            ),
        );
        assert!(!(rejected).authentication_passkey_control_candidate_is_safe());

        let security_key_enrollment =
            AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
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
            AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(signup);
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

        let safe_passkey = AuthenticationDetailedPasskeyControlObservation::ExplicitlyMarked(
            login_advance_observation("https://login.example.test/auth/passkey", "Use passkey"),
        );
        assert!((safe_passkey).authentication_passkey_control_evidence_is_safe());
        assert_eq!(parse_page_input_type(" PASSWORD "), PageInputType::Password);
    }
}
