#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{
    AuthenticationAdvanceControlObservation, CheckedAuthenticationControl,
    PageControlActionability, PageControlOwnership, PageControlSemantics,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
use crate::page_field_classification::control_identity::AuthenticationControlIdentity;
use crate::page_field_classification::form_identity::{
    AuthenticationRouteIdentity, CredentialDestination, DestinationPolicy, OAuthAuthorization,
    OneTimeCodeContext,
};
use crate::page_field_classification::{
    AuthenticationUsernameEvidence, canonicalize_control_destination, contains_any_word,
    expand_identity_text, looks_like_login_advance_control_label,
    looks_like_supported_localized_login_control_label,
};

impl AuthenticationAdvanceControlObservation {
    /// Whether an inert control supplies narrow page-planning evidence only.
    #[must_use]
    pub(crate) fn is_inert_webauthn_email_planning_advance(&self) -> bool {
        if !matches!(self.actionability, PageControlActionability::Inert)
            || !matches!(self.ownership, PageControlOwnership::OwnedForm)
            || !matches!(self.semantics, PageControlSemantics::SemanticSubmit)
            || !matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::WebAuthnEmail
            )
            || !matches!(self.submission_method, PageControlSubmissionMethod::Get)
            || !matches!(
                self.submission_destination_source,
                PageControlSubmissionDestinationSource::Omitted
            )
        {
            return false;
        }
        let Some(destination) =
            canonicalize_control_destination(&self.source_origin, &self.destination_identity)
        else {
            return false;
        };
        if !AuthenticationRouteIdentity::new(&destination.route_identity)
            .indicates_oauth_authorization()
        {
            return false;
        }
        let mut actionable = self.clone();
        actionable.actionability = PageControlActionability::Actionable;
        crate::authentication_advance_control_is_safe(&actionable)
    }

    pub(super) fn is_identifier_only_get_advance(&self) -> bool {
        matches!(self.actionability, PageControlActionability::Actionable)
            && matches!(
                self.ownership,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
            )
            && matches!(self.semantics, PageControlSemantics::SemanticSubmit)
            && match self.submission_destination_source {
                PageControlSubmissionDestinationSource::Authored => matches!(
                    self.authentication_username,
                    AuthenticationUsernameEvidence::Strong
                        | AuthenticationUsernameEvidence::Explicit
                ),
                PageControlSubmissionDestinationSource::Omitted => {
                    self.form_identity.is_empty()
                        && matches!(
                            self.authentication_username,
                            AuthenticationUsernameEvidence::WebAuthnEmail
                                | AuthenticationUsernameEvidence::Explicit
                        )
                }
            }
            && self.password_field_count.raw() == 0
            && self.new_password_field_count.raw() == 0
            && self.one_time_code_field_count.raw() == 0
            && self.semantic_submit_control_count.raw() == 1
    }

    pub(super) fn has_ambiguous_identifier_only_submit(&self) -> bool {
        matches!(self.semantics, PageControlSemantics::SemanticSubmit)
            && !matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Absent
            )
            && self.password_field_count.raw() == 0
            && self.new_password_field_count.raw() == 0
            && self.one_time_code_field_count.raw() == 0
            && self.semantic_submit_control_count.raw() > 1
    }
}

impl CheckedAuthenticationControl<'_> {
    fn has_webauthn_email_oauth_identifier_advance(&self) -> bool {
        matches!(
            self.observation.authentication_username,
            AuthenticationUsernameEvidence::WebAuthnEmail
        ) && self.observation.is_identifier_only_get_advance()
            && AuthenticationRouteIdentity::new(&self.destination.route_identity)
                .indicates_oauth_authorization()
    }

    pub(super) fn has_positive_login_identity(&self) -> bool {
        let authentication_scope_owns_control = matches!(
            self.observation.ownership,
            PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
        );
        let observation = self.observation;
        let owned_semantic_submit = authentication_scope_owns_control
            && matches!(observation.semantics, PageControlSemantics::SemanticSubmit);
        let locally_scoped_explicit_activation =
            matches!(observation.ownership, PageControlOwnership::LocallyScoped)
                && matches!(observation.semantics, PageControlSemantics::Activation)
                && AuthenticationControlIdentity::new(&observation.label).is_explicit_advance()
                && AuthenticationRouteIdentity::new(&self.destination.path_identity)
                    .has_safe_login_identity();
        AuthenticationRouteIdentity::new(&observation.form_identity).indicates_login()
            || locally_scoped_explicit_activation
            || (owned_semantic_submit
                && (AuthenticationControlIdentity::new(&observation.label).is_explicit_advance()
                    || looks_like_supported_localized_login_control_label(&observation.label)
                    || AuthenticationRouteIdentity::new(&self.destination.path_identity)
                        .has_safe_login_identity()))
    }

    pub(super) fn has_unconditional_veto_identity(&self) -> bool {
        let credential_update_destination = self.credential_update_destination();
        let observation = self.observation;
        let expanded_label = expand_identity_text(&observation.label);
        let webauthn_identifier_advance = self.has_webauthn_email_oauth_identifier_advance();
        let primary_oauth_login_label = AuthenticationControlIdentity::new(&observation.label)
            .is_explicit_advance()
            || (webauthn_identifier_advance && expanded_label == "next");
        let primary_oauth_login = matches!(observation.ownership, PageControlOwnership::OwnedForm)
            && matches!(observation.semantics, PageControlSemantics::SemanticSubmit)
            && matches!(
                observation.authentication_username,
                AuthenticationUsernameEvidence::Strong
                    | AuthenticationUsernameEvidence::WebAuthnEmail
                    | AuthenticationUsernameEvidence::Explicit
            )
            && (observation.password_field_count.raw() > 0 || webauthn_identifier_advance)
            && primary_oauth_login_label
            && !AuthenticationControlIdentity::new(&observation.label).label_names_provider()
            && AuthenticationRouteIdentity::new(&self.destination.route_identity)
                .indicates_oauth_authorization();
        AuthenticationRouteIdentity::new(&observation.form_identity).indicates_destructive_action()
            || AuthenticationControlIdentity::new(&observation.form_identity)
                .is_alternate_authentication_route()
            || AuthenticationRouteIdentity::new(&self.destination.route_identity)
                .indicates_destructive_action()
            || AuthenticationRouteIdentity::new(&observation.label).indicates_destructive_action()
            || AuthenticationRouteIdentity::new(&observation.machine_identity).has_control_veto()
            || contains_any_word(&expanded_label, &["cancel"])
            || contains_any_word(
                &expanded_label,
                &["keep me signed in", "stay signed in", "remember me"],
            )
            || AuthenticationRouteIdentity::new(&self.destination.route_identity)
                .has_disallowed_action_or_provider(DestinationPolicy {
                    credential: if credential_update_destination {
                        CredentialDestination::PasswordUpdate
                    } else {
                        CredentialDestination::Authentication
                    },
                    provider: if primary_oauth_login {
                        OAuthAuthorization::Allowed
                    } else {
                        OAuthAuthorization::Disallowed
                    },
                })
    }

    fn has_semantic_submit_ceremony(&self) -> bool {
        let authentication_scope_owns_control = matches!(
            self.observation.ownership,
            PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
        );
        let observation = self.observation;
        if observation.has_empty_microsoft_consumer_login_root() {
            return observation.is_microsoft_consumer_root_identifier_advance();
        }
        let standards_email_semantic_submit = authentication_scope_owns_control
            && matches!(observation.semantics, PageControlSemantics::SemanticSubmit)
            && matches!(
                observation.authentication_username,
                AuthenticationUsernameEvidence::StandardsBasedEmail
                    | AuthenticationUsernameEvidence::WebAuthnEmail
            );
        let username_only_authentication_context =
            AuthenticationRouteIdentity::new(&observation.form_identity).indicates_authentication()
                || AuthenticationRouteIdentity::new(&self.destination.path_identity)
                    .indicates_authentication();
        observation.password_field_count.raw() > 0
            || observation.new_password_field_count.raw() > 0
            || observation.one_time_code_field_count.raw() > 0
            || ((matches!(
                observation.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            ) || standards_email_semantic_submit)
                && username_only_authentication_context)
            || self.has_webauthn_email_oauth_identifier_advance()
            || (authentication_scope_owns_control
                && AuthenticationRouteIdentity::new(&observation.form_identity)
                    .indicates_authentication())
    }

    pub(super) fn accepts_authentication_advance(&self) -> bool {
        let semantic_submit_ceremony_present = self.has_semantic_submit_ceremony();
        let authentication_scope_owns_control = matches!(
            self.observation.ownership,
            PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
        );
        let observation = self.observation;
        let accepted_semantic_submit = authentication_scope_owns_control
            && matches!(observation.semantics, PageControlSemantics::SemanticSubmit)
            && semantic_submit_ceremony_present
            && (observation.semantic_submit_control_count.raw() == 1
                || looks_like_login_advance_control_label(&observation.label)
                || AuthenticationControlIdentity::new(&observation.label).is_explicit_advance());
        let accepted_scoped_activation = authentication_scope_owns_control
            && matches!(observation.semantics, PageControlSemantics::Activation)
            && semantic_submit_ceremony_present
            && looks_like_login_advance_control_label(&observation.label);
        let accepted_login_label = authentication_scope_owns_control
            && looks_like_login_advance_control_label(&observation.label)
            && (semantic_submit_ceremony_present
                || AuthenticationControlIdentity::new(&observation.label).is_explicit_advance());
        accepted_semantic_submit || accepted_scoped_activation || accepted_login_label
    }

    pub(super) fn one_time_code_control_lacks_authentication_context(&self) -> bool {
        let observation = self.observation;
        observation.one_time_code_field_count.raw() > 0
            && !OneTimeCodeContext {
                authentication_username: observation.authentication_username,
                form_identity: &observation.form_identity,
                destination_identity: &self.destination.path_identity,
                label: &observation.label,
            }
            .has_authentication_context()
    }
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::authentication_advance_control_is_safe;

    struct BookingDefaultGetScenario;

    struct TeslaDefaultGetScenario;

    impl TeslaDefaultGetScenario {
        fn observation() -> AuthenticationAdvanceControlObservation {
            AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Actionable,
                ownership: PageControlOwnership::OwnedForm,
                semantics: PageControlSemantics::SemanticSubmit,
                authentication_username: AuthenticationUsernameEvidence::WebAuthnEmail,
                password_field_count: 0.into(),
                new_password_field_count: 0.into(),
                one_time_code_field_count: 0.into(),
                semantic_submit_control_count: 1.into(),
                source_origin: "https://auth.tesla.com".to_owned(),
                form_identity: String::new(),
                destination_identity: "https://auth.tesla.com/oauth2/v1/authorize".to_owned(),
                label: "Next".to_owned(),
                machine_identity: String::new(),
                submission_method: PageControlSubmissionMethod::Get,
                submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
            }
        }

        fn assert_hostile_variants_fail_closed() {
            for destination in [
                "https://attacker.example/",
                "https://auth.tesla.com/signup",
                "https://auth.tesla.com/recover",
                "https://auth.tesla.com/?provider=google",
                "https://auth.tesla.com/account/delete",
                "https://auth.tesla.com/oauth2/v/authorize",
                "https://auth.tesla.com/oauth2/v1beta/authorize",
                "https://auth.tesla.com/oauth2/v1234/authorize",
                "https://auth.tesla.com/oauth2/v1/token",
                "https://auth.tesla.com/oauth2/v1/authorize/continue",
            ] {
                let mut rejected = Self::observation();
                rejected.destination_identity = destination.to_owned();
                assert!(
                    !authentication_advance_control_is_safe(&rejected),
                    "{destination}"
                );
            }

            for label in "Continue|Trouble Signing In|Create Account|Continue with Google|Use passkey|Delete account".split('|') {
                let mut rejected = Self::observation();
                rejected.label = label.to_owned();
                assert!(
                    !authentication_advance_control_is_safe(&rejected),
                    "{label}"
                );
            }

            let mut ambiguous = Self::observation();
            ambiguous.semantic_submit_control_count = 2.into();
            assert!(!authentication_advance_control_is_safe(&ambiguous));

            let mut unowned = Self::observation();
            unowned.ownership = PageControlOwnership::Unowned;
            assert!(!authentication_advance_control_is_safe(&unowned));

            let mut inert = Self::observation();
            inert.actionability = PageControlActionability::Inert;
            assert!(!authentication_advance_control_is_safe(&inert));

            let mut activation = Self::observation();
            activation.semantics = PageControlSemantics::Activation;
            assert!(!authentication_advance_control_is_safe(&activation));

            let mut identified_form = Self::observation();
            identified_form.form_identity = "sign-in-form".to_owned();
            assert!(!authentication_advance_control_is_safe(&identified_form));

            let mut authored_destination = Self::observation();
            authored_destination.submission_destination_source =
                PageControlSubmissionDestinationSource::Authored;
            assert!(!authentication_advance_control_is_safe(
                &authored_destination
            ));

            for evidence in [
                AuthenticationUsernameEvidence::Absent,
                AuthenticationUsernameEvidence::Generic,
                AuthenticationUsernameEvidence::StandardsBasedEmail,
                AuthenticationUsernameEvidence::Strong,
            ] {
                let mut rejected = Self::observation();
                rejected.authentication_username = evidence;
                assert!(!authentication_advance_control_is_safe(&rejected));
            }
        }
    }

    impl BookingDefaultGetScenario {
        fn observation() -> AuthenticationAdvanceControlObservation {
            AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Actionable,
                ownership: PageControlOwnership::OwnedForm,
                semantics: PageControlSemantics::SemanticSubmit,
                authentication_username: AuthenticationUsernameEvidence::Explicit,
                password_field_count: 0.into(),
                new_password_field_count: 0.into(),
                one_time_code_field_count: 0.into(),
                semantic_submit_control_count: 1.into(),
                source_origin: "https://account.booking.com".to_owned(),
                form_identity: String::new(),
                destination_identity: "https://account.booking.com/sign-in".to_owned(),
                label: "Continue with email".to_owned(),
                machine_identity: String::new(),
                submission_method: PageControlSubmissionMethod::Get,
                submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
            }
        }

        fn assert_hostile_variants_fail_closed() {
            for destination in [
                "https://attacker.example/sign-in",
                "https://account.booking.com/sign-up",
                "https://account.booking.com/sign-in?provider=google",
                "https://account.booking.com/account/delete",
            ] {
                let mut rejected = Self::observation();
                rejected.destination_identity = destination.to_owned();
                assert!(
                    !authentication_advance_control_is_safe(&rejected),
                    "{destination}"
                );
            }

            for label in ["Continue with Google", "Create account", "Delete account"] {
                let mut rejected = Self::observation();
                rejected.label = label.to_owned();
                assert!(
                    !authentication_advance_control_is_safe(&rejected),
                    "{label}"
                );
            }

            let mut recovery_submit = Self::observation();
            recovery_submit.destination_identity = "https://account.booking.com/recover".to_owned();
            recovery_submit.label = "Recover your account".to_owned();
            assert!(!authentication_advance_control_is_safe(&recovery_submit));

            let mut ambiguous = Self::observation();
            ambiguous.semantic_submit_control_count = 2.into();
            assert!(!authentication_advance_control_is_safe(&ambiguous));

            let mut unowned = Self::observation();
            unowned.ownership = PageControlOwnership::Unowned;
            assert!(!authentication_advance_control_is_safe(&unowned));

            let mut inert = Self::observation();
            inert.actionability = PageControlActionability::Inert;
            assert!(!authentication_advance_control_is_safe(&inert));

            let mut activation = Self::observation();
            activation.semantics = PageControlSemantics::Activation;
            assert!(!authentication_advance_control_is_safe(&activation));

            let mut implicit_email = Self::observation();
            implicit_email.authentication_username = AuthenticationUsernameEvidence::Strong;
            assert!(!authentication_advance_control_is_safe(&implicit_email));
        }
    }

    #[test]
    fn booking_owned_identifier_default_get_is_narrowly_admitted() {
        assert!(authentication_advance_control_is_safe(
            &BookingDefaultGetScenario::observation()
        ));
        BookingDefaultGetScenario::assert_hostile_variants_fail_closed();
    }

    #[test]
    fn tesla_owned_webauthn_email_default_get_is_narrowly_admitted() {
        assert!(authentication_advance_control_is_safe(
            &TeslaDefaultGetScenario::observation()
        ));
        TeslaDefaultGetScenario::assert_hostile_variants_fail_closed();
    }

    #[test]
    fn claude_owned_email_post_uses_existing_identifier_advance_policy() -> anyhow::Result<()> {
        let claude = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::StandardsBasedEmail,
            password_field_count: 0.into(),
            new_password_field_count: 0.into(),
            one_time_code_field_count: 0.into(),
            semantic_submit_control_count: 1.into(),
            source_origin: "https://claude.ai".to_owned(),
            form_identity: String::new(),
            destination_identity: "https://claude.ai/login".to_owned(),
            label: "Continue with email".to_owned(),
            machine_identity: String::new(),
            submission_method: PageControlSubmissionMethod::Post,
            submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
        };
        assert!(authentication_advance_control_is_safe(&claude));

        let mut generic_email_get = claude.clone();
        generic_email_get.submission_method = PageControlSubmissionMethod::Get;
        assert!(!authentication_advance_control_is_safe(&generic_email_get));

        for label in [
            "Continue with Google",
            "Continue with SSO",
            "Forgot password",
            "Delete account",
        ] {
            let mut rejected = claude.clone();
            rejected.label = label.to_owned();
            assert!(
                !authentication_advance_control_is_safe(&rejected),
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
                !authentication_advance_control_is_safe(&rejected),
                "{destination}"
            );
        }

        let mut inert = claude.clone();
        inert.actionability = PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(&inert));

        let mut unowned = claude.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!authentication_advance_control_is_safe(&unowned));

        let mut ambiguous = claude.clone();
        ambiguous.authentication_username = AuthenticationUsernameEvidence::Strong;
        ambiguous.semantic_submit_control_count = 2.into();
        assert!(!authentication_advance_control_is_safe(&ambiguous));

        let serialized = serde_json::to_value(&claude)?;
        assert_eq!(
            serde_json::from_value::<AuthenticationAdvanceControlObservation>(serialized.clone())?,
            claude
        );
        let mut missing_source = serialized;
        let serde_json::Value::Object(fields) = &mut missing_source else {
            anyhow::bail!("advance observation must serialize as an object");
        };
        assert!(fields.remove("submissionDestinationSource").is_some());
        assert!(
            serde_json::from_value::<AuthenticationAdvanceControlObservation>(missing_source)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn netflix_owned_post_login_uses_existing_combined_credential_policy() {
        let netflix = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::Strong,
            password_field_count: 1.into(),
            new_password_field_count: 0.into(),
            one_time_code_field_count: 0.into(),
            semantic_submit_control_count: 1.into(),
            source_origin: "https://www.netflix.com".to_owned(),
            form_identity: String::new(),
            destination_identity: "https://www.netflix.com/login".to_owned(),
            label: "Continue".to_owned(),
            machine_identity: String::new(),
            submission_method: PageControlSubmissionMethod::Post,
            submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
        };
        assert!(authentication_advance_control_is_safe(&netflix));

        for method in [
            PageControlSubmissionMethod::Get,
            PageControlSubmissionMethod::Dialog,
        ] {
            let mut rejected = netflix.clone();
            rejected.submission_method = method;
            assert!(!authentication_advance_control_is_safe(&rejected));
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
                !authentication_advance_control_is_safe(&rejected),
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
                !authentication_advance_control_is_safe(&rejected),
                "{destination}"
            );
        }

        let mut unowned = netflix.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!authentication_advance_control_is_safe(&unowned));

        let mut inert_help = netflix.clone();
        inert_help.actionability = PageControlActionability::Inert;
        inert_help.semantics = PageControlSemantics::Activation;
        inert_help.label = "Get Help".to_owned();
        assert!(!authentication_advance_control_is_safe(&inert_help));

        let mut ambiguous = netflix;
        ambiguous.semantic_submit_control_count = 2.into();
        ambiguous.label = "Primary action".to_owned();
        assert!(!authentication_advance_control_is_safe(&ambiguous));
    }
}
