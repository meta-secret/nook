#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{
    AuthenticationAdvanceControlObservation, CheckedAuthenticationControl, PageControlOwnership,
    PageControlSemantics,
};
use crate::page_field_classification::control_identity::AuthenticationControlIdentity;
use crate::page_field_classification::form_identity::{
    AuthenticationRouteIdentity, CredentialDestination, DestinationPolicy, OAuthAuthorization,
    OneTimeCodeContext,
};
use crate::page_field_classification::{
    AuthenticationUsernameEvidence, contains_any_word, expand_identity_text,
    looks_like_login_advance_control_label, looks_like_supported_localized_login_control_label,
};

impl AuthenticationAdvanceControlObservation {
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
        let primary_oauth_login = matches!(observation.ownership, PageControlOwnership::OwnedForm)
            && matches!(observation.semantics, PageControlSemantics::SemanticSubmit)
            && matches!(
                observation.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
            && observation.password_field_count.raw() > 0
            && AuthenticationControlIdentity::new(&observation.label).is_explicit_advance()
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
