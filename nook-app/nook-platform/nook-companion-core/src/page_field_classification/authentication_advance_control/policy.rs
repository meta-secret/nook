#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{CheckedAuthenticationControl, PageControlOwnership, PageControlSemantics};
use crate::page_field_classification::control_identity::AuthenticationControlIdentity;
use crate::page_field_classification::form_identity::{
    AuthenticationRouteIdentity, CredentialDestination, DestinationPolicy, OAuthAuthorization,
    OneTimeCodeContext,
};
use crate::page_field_classification::{
    AuthenticationUsernameEvidence, contains_any_word, expand_identity_text,
    looks_like_login_advance_control_label, looks_like_supported_localized_login_control_label,
};

impl CheckedAuthenticationControl<'_> {
    pub(super) fn has_positive_login_identity(&self) -> bool {
        let authentication_scope_owns_control = matches!(
            self.observation.ownership,
            PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
        );
        let observation = self.observation;
        let owned_semantic_submit = authentication_scope_owns_control
            && matches!(observation.semantics, PageControlSemantics::SemanticSubmit);
        let owned_explicit_activation = authentication_scope_owns_control
            && matches!(observation.semantics, PageControlSemantics::Activation)
            && AuthenticationControlIdentity::new(&observation.label).is_explicit_advance()
            && AuthenticationRouteIdentity::new(&self.destination.path_identity)
                .has_safe_login_identity();
        AuthenticationRouteIdentity::new(&observation.form_identity).indicates_login()
            || owned_explicit_activation
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
