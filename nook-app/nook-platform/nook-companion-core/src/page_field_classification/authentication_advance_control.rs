//! Authentication advance-control classification from browser-observed facts.

use super::control_identity::{
    looks_like_alternate_authentication_route_control_label,
    looks_like_auxiliary_authentication_control_label,
    looks_like_one_time_code_resend_control_label,
    looks_like_password_recovery_route_control_label, looks_like_registration_route_control_label,
};
use super::destination_identity::canonicalize_control_destination;
use super::form_identity::{
    control_destination_indicates_non_authentication_route,
    control_destination_indicates_password_recovery_route,
    control_destination_indicates_password_update_route,
    control_destination_indicates_registration_route,
    form_identity_indicates_non_authentication_account_management,
    identity_indicates_explicit_authentication_route,
};
use super::{
    AuthenticationUsernameEvidence, contains_any_word, expand_identity_text,
    looks_like_non_authentication_submit_control_label,
    looks_like_password_update_submit_control_label,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod policy;
use policy::{
    accepts_authentication_advance, has_positive_login_identity, has_semantic_submit_ceremony,
    has_unconditional_veto_identity, one_time_code_control_lacks_authentication_context,
};

/// Whether a browser-observed control can currently receive user activation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PageControlActionability {
    Inert,
    Actionable,
}

/// The authentication scope that owns a browser-observed control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PageControlOwnership {
    Unowned,
    OwnedForm,
    LocallyScoped,
}

/// The browser activation semantics exposed by a control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PageControlSemantics {
    Activation,
    SemanticSubmit,
}

/// Browser-collected structure for one possible authentication advance control.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationAdvanceControlObservation {
    pub actionability: PageControlActionability,
    pub ownership: PageControlOwnership,
    pub semantics: PageControlSemantics,
    pub authentication_username: AuthenticationUsernameEvidence,
    pub password_field_count: u32,
    pub new_password_field_count: u32,
    pub one_time_code_field_count: u32,
    pub semantic_submit_control_count: u32,
    pub source_origin: String,
    pub form_identity: String,
    pub destination_identity: String,
    pub label: String,
}

/// Portable outcome for one observed authentication advance control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationAdvanceControlDecision {
    AdvancesAuthentication,
    DoesNotAdvanceAuthentication,
}

impl AuthenticationAdvanceControlObservation {
    fn credential_update_destination(&self) -> bool {
        self.new_password_field_count > 0
            && (control_destination_indicates_registration_route(&self.destination_identity)
                || control_destination_indicates_password_recovery_route(
                    &self.destination_identity,
                )
                || control_destination_indicates_password_update_route(&self.destination_identity))
    }

    fn is_primary_sso_submit(&self, authentication_scope_owns_control: bool) -> bool {
        let expanded_control_label = expand_identity_text(&self.label);
        authentication_scope_owns_control
            && matches!(self.semantics, PageControlSemantics::SemanticSubmit)
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
            && contains_any_word(&expanded_control_label, &["sso"])
            && contains_any_word(
                &expanded_control_label,
                &["sign in", "signin", "continue", "next"],
            )
    }

    /// Whether DOM-controlled text and bounded field counts fit the observation envelope.
    #[must_use]
    pub fn is_bounded(&self) -> bool {
        self.source_origin.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.form_identity.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.destination_identity.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.label.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && [
                self.password_field_count,
                self.new_password_field_count,
                self.one_time_code_field_count,
                self.semantic_submit_control_count,
            ]
            .into_iter()
            .all(|count| count <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT)
    }

    /// Decide whether this DOM-extracted control can advance the observed ceremony.
    #[must_use]
    pub fn classify(&self) -> AuthenticationAdvanceControlDecision {
        if !self.is_bounded() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let Some(destination) =
            canonicalize_control_destination(&self.source_origin, &self.destination_identity)
        else {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        };
        if destination.has_provider_authority
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Generic
                    | AuthenticationUsernameEvidence::StandardsBasedEmail
            )
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let positive_destination_identity = destination.path_identity;
        let mut observation = self.clone();
        observation.destination_identity = destination.route_identity;
        observation.classify_canonical(&positive_destination_identity)
    }

    fn classify_canonical(
        &self,
        positive_destination_identity: &str,
    ) -> AuthenticationAdvanceControlDecision {
        if matches!(self.actionability, PageControlActionability::Inert) {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let authentication_scope_owns_control = matches!(
            self.ownership,
            PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
        );
        let semantic_submit_ceremony_present = has_semantic_submit_ceremony(
            self,
            authentication_scope_owns_control,
            positive_destination_identity,
        );
        let non_authentication_label =
            looks_like_non_authentication_submit_control_label(&self.label);
        let contextual_password_update = self.new_password_field_count > 0
            && looks_like_password_update_submit_control_label(&self.label);
        let credential_update_destination = self.credential_update_destination();
        if has_unconditional_veto_identity(self, credential_update_destination) {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if one_time_code_control_lacks_authentication_context(self, positive_destination_identity) {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.new_password_field_count == 0
            && self.one_time_code_field_count == 0
            && form_identity_indicates_non_authentication_account_management(&self.form_identity)
            && !identity_indicates_explicit_authentication_route(&self.form_identity)
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if non_authentication_label && !contextual_password_update {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let current_password_only = self.password_field_count > 0
            && self.new_password_field_count == 0
            && self.one_time_code_field_count == 0;
        if current_password_only
            && !has_positive_login_identity(
                self,
                authentication_scope_owns_control,
                positive_destination_identity,
            )
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let primary_sso_submit = self.is_primary_sso_submit(authentication_scope_owns_control);
        if looks_like_alternate_authentication_route_control_label(&self.label)
            && !primary_sso_submit
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.new_password_field_count == 0
            && (looks_like_registration_route_control_label(&self.label)
                || contains_any_word(&expand_identity_text(&self.label), &["join"]))
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if looks_like_auxiliary_authentication_control_label(&self.label) {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.one_time_code_field_count > 0
            && looks_like_one_time_code_resend_control_label(&self.label)
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.new_password_field_count == 0
            && looks_like_password_recovery_route_control_label(&self.label)
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if control_destination_indicates_non_authentication_route(&self.destination_identity)
            && !credential_update_destination
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.new_password_field_count == 0
            && control_destination_indicates_non_authentication_route(&self.form_identity)
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if accepts_authentication_advance(
            self,
            authentication_scope_owns_control,
            semantic_submit_ceremony_present,
        ) {
            AuthenticationAdvanceControlDecision::AdvancesAuthentication
        } else {
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authentication_advance_control_is_safe;

    fn login_control() -> AuthenticationAdvanceControlObservation {
        AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            password_field_count: 1,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: "https://login.example.test".to_owned(),
            form_identity: "login-form".to_owned(),
            destination_identity: "https://login.example.test/auth/login".to_owned(),
            label: "Sign in".to_owned(),
        }
    }

    #[test]
    fn exact_owned_login_submit_is_safe_but_inert_or_registration_controls_are_not() {
        let control = login_control();
        assert!(authentication_advance_control_is_safe(&control));

        let mut inert = control.clone();
        inert.actionability = PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(&inert));

        let mut registration = control;
        registration.destination_identity = "https://login.example.test/register".to_owned();
        assert!(!authentication_advance_control_is_safe(&registration));

        let mut account_settings = login_control();
        account_settings.destination_identity =
            "https://login.example.test/settings/profile".to_owned();
        assert!(!authentication_advance_control_is_safe(&account_settings));
    }

    #[test]
    fn username_only_submits_require_positive_authentication_identity() {
        let mut control = login_control();
        control.password_field_count = 0;
        control.form_identity = "security-form".to_owned();
        control.destination_identity = "https://login.example.test/account/security".to_owned();
        control.label = "Continue".to_owned();
        assert!(!authentication_advance_control_is_safe(&control));

        control.form_identity = "login-form".to_owned();
        control.destination_identity = "https://login.example.test/auth/login".to_owned();
        assert!(authentication_advance_control_is_safe(&control));
    }

    #[test]
    fn sso_management_and_unlabeled_activations_do_not_advance_authentication() {
        for label in ["Configure SSO", "Manage SSO", "Enroll SSO"] {
            let mut control = login_control();
            control.label = label.to_owned();
            assert!(!authentication_advance_control_is_safe(&control));
        }

        for label in ["Open settings", "Enable MFA"] {
            let mut control = login_control();
            control.semantics = PageControlSemantics::Activation;
            control.semantic_submit_control_count = 0;
            control.label = label.to_owned();
            assert!(!authentication_advance_control_is_safe(&control));
        }

        let mut continue_control = login_control();
        continue_control.semantics = PageControlSemantics::Activation;
        continue_control.semantic_submit_control_count = 0;
        continue_control.label = "Continue".to_owned();
        assert!(authentication_advance_control_is_safe(&continue_control));
    }

    #[test]
    fn credential_update_destinations_require_new_password_evidence() {
        for (destination, label) in [
            ("https://login.example.test/register", "Create account"),
            ("https://login.example.test/auth/recover", "Reset password"),
            (
                "https://login.example.test/account/update-password",
                "Update password",
            ),
        ] {
            let mut control = login_control();
            control.new_password_field_count = 1;
            control.destination_identity = destination.to_owned();
            control.label = label.to_owned();
            assert!(
                authentication_advance_control_is_safe(&control),
                "{destination}"
            );
        }

        let mut destructive = login_control();
        destructive.new_password_field_count = 1;
        destructive.destination_identity =
            "https://login.example.test/register/delete-account".to_owned();
        destructive.label = "Create account".to_owned();
        assert!(!authentication_advance_control_is_safe(&destructive));

        let mut provider = login_control();
        provider.new_password_field_count = 1;
        provider.destination_identity =
            "https://login.example.test/register?provider=google".to_owned();
        provider.label = "Create account".to_owned();
        assert!(!authentication_advance_control_is_safe(&provider));
    }

    #[test]
    fn nested_local_login_routes_are_accepted() {
        let mut control = login_control();
        control.source_origin = "https://gitlab.com".to_owned();
        control.destination_identity = "https://gitlab.com/users/sign_in".to_owned();
        assert!(authentication_advance_control_is_safe(&control));
    }

    #[test]
    fn ambiguous_semantic_submits_require_advance_label_evidence() {
        let mut verify = login_control();
        verify.password_field_count = 0;
        verify.one_time_code_field_count = 1;
        verify.form_identity = "otp-challenge-form".to_owned();
        verify.destination_identity = "https://login.example.test/auth/mfa/verify".to_owned();
        verify.semantic_submit_control_count = 2;
        verify.label = "Verify".to_owned();
        assert!(authentication_advance_control_is_safe(&verify));

        for label in ["Use recovery code", "Trust this device"] {
            let mut alternate = verify.clone();
            alternate.label = label.to_owned();
            assert!(
                !authentication_advance_control_is_safe(&alternate),
                "{label}"
            );
        }

        let mut unique_continue = verify;
        unique_continue.semantic_submit_control_count = 1;
        unique_continue.label = "Continue".to_owned();
        assert!(authentication_advance_control_is_safe(&unique_continue));
    }

    #[test]
    fn primary_oauth_authorization_routes_are_accepted() {
        for destination in [
            "https://login.example.test/oauth2/authorize",
            "https://login.example.test/oauth/authorize",
        ] {
            let mut control = login_control();
            control.destination_identity = destination.to_owned();
            assert!(
                authentication_advance_control_is_safe(&control),
                "{destination}"
            );
        }
    }
}
