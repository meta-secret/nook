use super::{AuthenticationAdvanceControlObservation, PageControlOwnership, PageControlSemantics};
use crate::page_field_classification::control_identity::{
    label_names_external_authentication_provider,
    looks_like_explicit_authentication_advance_control_label,
};
use crate::page_field_classification::form_identity::{
    control_destination_indicates_generic_oauth_authorization_route,
    destination_has_disallowed_action_or_provider, destination_has_safe_login_identity,
    form_identity_indicates_destructive_action, identity_indicates_explicit_authentication_route,
    identity_indicates_explicit_login_route, one_time_code_control_has_authentication_context,
};
use crate::page_field_classification::{
    AuthenticationUsernameEvidence, contains_any_word, expand_identity_text,
    looks_like_login_advance_control_label, looks_like_supported_localized_login_control_label,
};

pub(super) fn has_positive_login_identity(
    observation: &AuthenticationAdvanceControlObservation,
    authentication_scope_owns_control: bool,
    positive_destination_identity: &str,
) -> bool {
    let owned_semantic_submit = authentication_scope_owns_control
        && matches!(observation.semantics, PageControlSemantics::SemanticSubmit);
    identity_indicates_explicit_login_route(&observation.form_identity)
        || (owned_semantic_submit
            && (looks_like_explicit_authentication_advance_control_label(&observation.label)
                || looks_like_supported_localized_login_control_label(&observation.label)
                || destination_has_safe_login_identity(positive_destination_identity)))
}

pub(super) fn has_unconditional_veto_identity(
    observation: &AuthenticationAdvanceControlObservation,
    credential_update_destination: bool,
) -> bool {
    let primary_oauth_login = matches!(observation.ownership, PageControlOwnership::OwnedForm)
        && matches!(observation.semantics, PageControlSemantics::SemanticSubmit)
        && matches!(
            observation.authentication_username,
            AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
        )
        && observation.password_field_count > 0
        && looks_like_explicit_authentication_advance_control_label(&observation.label)
        && !label_names_external_authentication_provider(&observation.label)
        && control_destination_indicates_generic_oauth_authorization_route(
            &observation.destination_identity,
        );
    form_identity_indicates_destructive_action(&observation.form_identity)
        || form_identity_indicates_destructive_action(&observation.destination_identity)
        || form_identity_indicates_destructive_action(&observation.label)
        || contains_any_word(&expand_identity_text(&observation.label), &["cancel"])
        || destination_has_disallowed_action_or_provider(
            &observation.destination_identity,
            credential_update_destination,
            primary_oauth_login,
        )
}
pub(super) fn has_semantic_submit_ceremony(
    observation: &AuthenticationAdvanceControlObservation,
    authentication_scope_owns_control: bool,
    positive_destination_identity: &str,
) -> bool {
    let standards_email_semantic_submit = authentication_scope_owns_control
        && matches!(observation.semantics, PageControlSemantics::SemanticSubmit)
        && matches!(
            observation.authentication_username,
            AuthenticationUsernameEvidence::StandardsBasedEmail
        );
    let username_only_authentication_context =
        identity_indicates_explicit_authentication_route(&observation.form_identity)
            || identity_indicates_explicit_authentication_route(positive_destination_identity);
    observation.password_field_count > 0
        || observation.new_password_field_count > 0
        || observation.one_time_code_field_count > 0
        || ((matches!(
            observation.authentication_username,
            AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
        ) || standards_email_semantic_submit)
            && username_only_authentication_context)
        || (authentication_scope_owns_control
            && identity_indicates_explicit_authentication_route(&observation.form_identity))
}

pub(super) fn accepts_authentication_advance(
    observation: &AuthenticationAdvanceControlObservation,
    authentication_scope_owns_control: bool,
    semantic_submit_ceremony_present: bool,
) -> bool {
    let accepted_semantic_submit = authentication_scope_owns_control
        && matches!(observation.semantics, PageControlSemantics::SemanticSubmit)
        && semantic_submit_ceremony_present
        && (observation.semantic_submit_control_count == 1
            || looks_like_login_advance_control_label(&observation.label)
            || looks_like_explicit_authentication_advance_control_label(&observation.label));
    let accepted_scoped_activation = authentication_scope_owns_control
        && matches!(observation.semantics, PageControlSemantics::Activation)
        && semantic_submit_ceremony_present
        && looks_like_login_advance_control_label(&observation.label);
    let accepted_login_label = authentication_scope_owns_control
        && looks_like_login_advance_control_label(&observation.label)
        && (semantic_submit_ceremony_present
            || looks_like_explicit_authentication_advance_control_label(&observation.label));
    accepted_semantic_submit || accepted_scoped_activation || accepted_login_label
}

pub(super) fn one_time_code_control_lacks_authentication_context(
    observation: &AuthenticationAdvanceControlObservation,
    positive_destination_identity: &str,
) -> bool {
    observation.one_time_code_field_count > 0
        && !one_time_code_control_has_authentication_context(
            observation.authentication_username,
            &observation.form_identity,
            positive_destination_identity,
            &observation.label,
        )
}
