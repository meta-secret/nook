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
        let semantic_submit_ceremony_present =
            has_semantic_submit_ceremony(self, authentication_scope_owns_control);
        let non_authentication_label =
            looks_like_non_authentication_submit_control_label(&self.label);
        let contextual_password_update = self.new_password_field_count > 0
            && looks_like_password_update_submit_control_label(&self.label);
        let password_update_destination = self.new_password_field_count > 0
            && control_destination_indicates_password_update_route(&self.destination_identity);
        let credential_update_destination = self.new_password_field_count > 0
            && (control_destination_indicates_registration_route(&self.destination_identity)
                || control_destination_indicates_password_recovery_route(
                    &self.destination_identity,
                )
                || password_update_destination);
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
        let primary_sso_submit = authentication_scope_owns_control
            && matches!(self.semantics, PageControlSemantics::SemanticSubmit)
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
            && contains_any_word(&expand_identity_text(&self.label), &["sso"]);
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
    use crate::page_field_classification::browser_resolved_test_destination;

    fn advances_authentication(observation: &AuthenticationAdvanceControlObservation) -> bool {
        let mut observation = observation.clone();
        observation.destination_identity = browser_resolved_test_destination(
            &observation.source_origin,
            &observation.destination_identity,
        );
        matches!(
            observation.classify(),
            AuthenticationAdvanceControlDecision::AdvancesAuthentication
        )
    }

    fn localized_identity_submit() -> AuthenticationAdvanceControlObservation {
        AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::Generic,
            password_field_count: 0,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: "https://example.test".to_owned(),
            form_identity: "identity-form".to_owned(),
            destination_identity: String::new(),
            label: "Siguiente".to_owned(),
        }
    }

    #[test]
    fn accepts_scoped_authentication_advance_controls() {
        let localized_identity_submit = localized_identity_submit();
        assert!(advances_authentication(&localized_identity_submit));

        let localized_identity_activation = AuthenticationAdvanceControlObservation {
            semantics: PageControlSemantics::Activation,
            semantic_submit_control_count: 0,
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(&localized_identity_activation));

        let localized_formless_identity_activation = AuthenticationAdvanceControlObservation {
            ownership: PageControlOwnership::LocallyScoped,
            ..localized_identity_activation.clone()
        };
        assert!(advances_authentication(
            &localized_formless_identity_activation
        ));

        let explicit_username_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            form_identity: String::new(),
            label: "Entrar".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(&explicit_username_submit));

        let strong_username_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Strong,
            form_identity: String::new(),
            label: "Weiter".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(&strong_username_submit));

        let primary_sso_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            label: "Continue with SSO".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(&primary_sso_submit));

        let password_update = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            password_field_count: 1,
            new_password_field_count: 1,
            form_identity: "account-settings".to_owned(),
            label: "Update".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(&password_update));

        let registration_submit = AuthenticationAdvanceControlObservation {
            label: "Create account".to_owned(),
            ..password_update
        };
        assert!(advances_authentication(&registration_submit));

        let localized_password_only_without_identity = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            password_field_count: 1,
            form_identity: String::new(),
            label: "Anmelden".to_owned(),
            ..localized_identity_submit
        };
        assert!(!advances_authentication(
            &localized_password_only_without_identity
        ));
    }

    #[test]
    fn standards_email_password_submit_requires_login_specific_identity() {
        let standards_email_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::StandardsBasedEmail,
            password_field_count: 1,
            form_identity: String::new(),
            label: "Siguiente".to_owned(),
            ..localized_identity_submit()
        };
        assert!(!advances_authentication(&standards_email_submit));
        let explicit_login = AuthenticationAdvanceControlObservation {
            form_identity: "login".to_owned(),
            ..standards_email_submit.clone()
        };
        for ownership in [
            PageControlOwnership::OwnedForm,
            PageControlOwnership::LocallyScoped,
        ] {
            assert!(advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    ownership,
                    ..explicit_login.clone()
                }
            ));
        }

        for authentication_username in [
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::Absent,
        ] {
            assert!(!advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    authentication_username,
                    ..standards_email_submit.clone()
                }
            ));
        }

        let non_submit_email_control = AuthenticationAdvanceControlObservation {
            semantics: PageControlSemantics::Activation,
            ..explicit_login
        };
        assert!(!advances_authentication(&non_submit_email_control));
    }

    #[test]
    fn standards_email_establishes_owned_passwordless_semantic_ceremony() {
        let standards_email_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::StandardsBasedEmail,
            form_identity: String::new(),
            destination_identity: String::new(),
            label: "Siguiente".to_owned(),
            ..localized_identity_submit()
        };
        for ownership in [
            PageControlOwnership::OwnedForm,
            PageControlOwnership::LocallyScoped,
        ] {
            assert!(advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    ownership,
                    ..standards_email_submit.clone()
                }
            ));
        }

        for authentication_username in [
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::Absent,
        ] {
            assert!(!advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    authentication_username,
                    ..standards_email_submit.clone()
                }
            ));
        }

        for rejected in [
            AuthenticationAdvanceControlObservation {
                ownership: PageControlOwnership::Unowned,
                ..standards_email_submit.clone()
            },
            AuthenticationAdvanceControlObservation {
                semantics: PageControlSemantics::Activation,
                ..standards_email_submit
            },
        ] {
            assert!(!advances_authentication(&rejected));
        }
    }

    #[test]
    fn explicit_login_label_or_destination_identifies_password_only_submit() {
        let password_only_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Generic,
            password_field_count: 1,
            form_identity: String::new(),
            destination_identity: String::new(),
            label: "Sign in".to_owned(),
            ..localized_identity_submit()
        };
        assert!(advances_authentication(&password_only_submit));
        let observes_destination =
            |destination_identity: &str, label: &str| AuthenticationAdvanceControlObservation {
                ownership: PageControlOwnership::LocallyScoped,
                destination_identity: destination_identity.to_owned(),
                label: label.to_owned(),
                ..password_only_submit.clone()
            };
        let advances_destination = |destination: &str, label: &str| {
            advances_authentication(&observes_destination(destination, label))
        };
        for destination in ["/login", "/auth/post-login", "/authentication/post-login"] {
            assert!(advances_destination(destination, "Siguiente"));
        }
        for (destination, label) in [
            ("/profile", "Siguiente"),
            ("/profile", "Sign in"),
            ("/login/cancel", "Siguiente"),
            ("/login/cancel", "Sign in"),
            ("/login/google", "Siguiente"),
            ("/login/google", "Sign in"),
            ("/auth/post", "Siguiente"),
            ("/auth/post-login/post", "Siguiente"),
            ("/auth/post-login/publish", "Siguiente"),
            ("/auth/post-login/content", "Siguiente"),
        ] {
            assert!(!advances_destination(destination, label));
        }
        for rejected in [
            AuthenticationAdvanceControlObservation {
                ownership: PageControlOwnership::Unowned,
                ..password_only_submit.clone()
            },
            AuthenticationAdvanceControlObservation {
                semantics: PageControlSemantics::Activation,
                ..password_only_submit.clone()
            },
        ] {
            assert!(!advances_authentication(&rejected));
        }
        for label in [
            "Create account",
            "Forgot password?",
            "Continue with Google",
            "Show password",
            "Cancel password reset",
        ] {
            assert!(!advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    destination_identity: "/login".to_owned(),
                    label: label.to_owned(),
                    ..password_only_submit.clone()
                }
            ));
        }
        let destructive_destination = AuthenticationAdvanceControlObservation {
            destination_identity: "/login/delete-account".to_owned(),
            ..password_only_submit
        };
        assert!(!advances_authentication(&destructive_destination));
    }

    #[test]
    fn generic_reauthentication_does_not_identify_a_password_login() {
        let reauthentication = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::Absent,
            password_field_count: 1,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: "https://example.test".to_owned(),
            form_identity: "reauthentication".to_owned(),
            destination_identity: "/auth/confirm".to_owned(),
            label: "Confirm".to_owned(),
        };

        assert!(!advances_authentication(&reauthentication));
        for authentication_username in [
            AuthenticationUsernameEvidence::Strong,
            AuthenticationUsernameEvidence::Explicit,
        ] {
            assert!(!advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    authentication_username,
                    ..reauthentication.clone()
                }
            ));
        }
        assert!(!advances_authentication(
            &AuthenticationAdvanceControlObservation {
                destination_identity: "/account/confirm?next=/login".to_owned(),
                ..reauthentication.clone()
            }
        ));
        assert!(!advances_authentication(
            &AuthenticationAdvanceControlObservation {
                destination_identity: "/account/confirm#account".to_owned(),
                ..reauthentication.clone()
            }
        ));
        assert!(!advances_authentication(
            &AuthenticationAdvanceControlObservation {
                password_field_count: 2,
                ..reauthentication
            }
        ));
    }

    #[test]
    fn oauth_form_post_response_metadata_does_not_veto_primary_login() {
        let primary_login = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::SemanticSubmit,
            authentication_username: AuthenticationUsernameEvidence::Strong,
            password_field_count: 1,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: "https://example.test".to_owned(),
            form_identity: String::new(),
            destination_identity: "/oauth2/authorize?response_mode=form_post&next=/dashboard"
                .to_owned(),
            label: "Sign in".to_owned(),
        };
        assert!(advances_authentication(&primary_login));
        assert!(!advances_authentication(
            &AuthenticationAdvanceControlObservation {
                destination_identity: "/oauth2/authorize?response_mode=form_post&next=/payment"
                    .to_owned(),
                ..primary_login
            }
        ));
    }

    #[test]
    fn cancellation_and_destructive_labels_veto_password_update_exemptions() {
        let password_update = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            new_password_field_count: 1,
            form_identity: "account-settings".to_owned(),
            ..localized_identity_submit()
        };
        for label in [
            "Reset password",
            "Change password",
            "Save and continue",
            "Update credentials",
        ] {
            assert!(advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    label: label.to_owned(),
                    ..password_update.clone()
                }
            ));
        }
        for label in [
            "Cancel password reset",
            "Cancel password change",
            "Cancel password update",
            "Delete password reset",
            "Destroy password change",
            "Delete password update",
            "Save profile and continue",
            "Update payment credentials",
        ] {
            assert!(!advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    label: label.to_owned(),
                    ..password_update.clone()
                }
            ));
        }
        for (form_identity, destination_identity) in [
            ("/auth/account/delete", ""),
            ("account-settings", "/password/reset/delete-account"),
        ] {
            assert!(!advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    form_identity: form_identity.to_owned(),
                    destination_identity: destination_identity.to_owned(),
                    label: "Reset password".to_owned(),
                    ..password_update.clone()
                }
            ));
        }
    }

    #[test]
    fn rejects_unowned_authentication_controls() {
        let localized_identity_submit = localized_identity_submit();
        let unrelated_formless_activation = AuthenticationAdvanceControlObservation {
            ownership: PageControlOwnership::Unowned,
            semantics: PageControlSemantics::Activation,
            form_identity: "profile-editor".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&unrelated_formless_activation));

        let unowned_login_labeled_activation = AuthenticationAdvanceControlObservation {
            ownership: PageControlOwnership::Unowned,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            password_field_count: 1,
            semantic_submit_control_count: 0,
            form_identity: "login".to_owned(),
            label: "Next".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&unowned_login_labeled_activation));
    }

    #[test]
    fn explicit_login_identity_outranks_incidental_account_management_tokens() {
        let localized_identity_submit = localized_identity_submit();

        let profile_login_form = AuthenticationAdvanceControlObservation {
            form_identity: "profile-login".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(&profile_login_form));
        let settings_login_destination = AuthenticationAdvanceControlObservation {
            destination_identity: "/account/settings/login".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(&settings_login_destination));
        let profile_only_destination = AuthenticationAdvanceControlObservation {
            destination_identity: "/account/settings/profile".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&profile_only_destination));
        let destructive_login_destination = AuthenticationAdvanceControlObservation {
            destination_identity: "/account/settings/login/delete".to_owned(),
            ..localized_identity_submit
        };
        assert!(!advances_authentication(&destructive_login_destination));
    }

    #[test]
    fn rejects_non_advance_authentication_controls() {
        let localized_identity_submit = localized_identity_submit();
        let transaction_code_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            one_time_code_field_count: 1,
            form_identity: "checkout".to_owned(),
            destination_identity: "/checkout/confirm".to_owned(),
            label: "Pay now".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&transaction_code_submit));
        let password_and_transaction_code_submit = AuthenticationAdvanceControlObservation {
            password_field_count: 1,
            form_identity: "verification".to_owned(),
            destination_identity: "/verify".to_owned(),
            label: "Confirm".to_owned(),
            ..transaction_code_submit.clone()
        };
        assert!(!advances_authentication(
            &password_and_transaction_code_submit
        ));
        let neutral_newsletter_submit = AuthenticationAdvanceControlObservation {
            form_identity: String::new(),
            label: "Continue".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&neutral_newsletter_submit));
        let standards_email_newsletter_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::StandardsBasedEmail,
            form_identity: String::new(),
            label: "Join".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&standards_email_newsletter_submit));
        let standards_email_login_submit = AuthenticationAdvanceControlObservation {
            label: "Sign in".to_owned(),
            ..standards_email_newsletter_submit
        };
        assert!(advances_authentication(&standards_email_login_submit));
        let alternate_provider_submit = AuthenticationAdvanceControlObservation {
            label: "Sign in with Google".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&alternate_provider_submit));

        let alternate_sso_activation = AuthenticationAdvanceControlObservation {
            semantics: PageControlSemantics::Activation,
            label: "Continue with SSO".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&alternate_sso_activation));

        let registration_route_submit = AuthenticationAdvanceControlObservation {
            label: "Create account".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&registration_route_submit));

        let localized_recovery_destination = AuthenticationAdvanceControlObservation {
            destination_identity: "/password/recover".to_owned(),
            label: "Continuar".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&localized_recovery_destination));

        let localized_recovery_form_action = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            form_identity: "/password/recover".to_owned(),
            destination_identity: String::new(),
            label: "Continuar".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&localized_recovery_form_action));

        let generic_activation_beside_disabled_submit = AuthenticationAdvanceControlObservation {
            semantics: PageControlSemantics::Activation,
            semantic_submit_control_count: 1,
            label: "Language".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(
            &generic_activation_beside_disabled_submit
        ));

        let login_labeled_activation_beside_rejected_submit =
            AuthenticationAdvanceControlObservation {
                label: "Next".to_owned(),
                ..generic_activation_beside_disabled_submit.clone()
            };
        assert!(advances_authentication(
            &login_labeled_activation_beside_rejected_submit
        ));

        let explicit_login_activation_beside_disabled_submit =
            AuthenticationAdvanceControlObservation {
                label: "Sign in".to_owned(),
                ..generic_activation_beside_disabled_submit
            };
        assert!(advances_authentication(
            &explicit_login_activation_beside_disabled_submit
        ));
    }

    #[test]
    fn registration_destination_requires_new_password_evidence() {
        let login = AuthenticationAdvanceControlObservation {
            destination_identity: "/auth?mode=register".to_owned(),
            label: "Continuar".to_owned(),
            ..localized_identity_submit()
        };
        assert!(!advances_authentication(&login));
        assert!(advances_authentication(
            &AuthenticationAdvanceControlObservation {
                new_password_field_count: 1,
                ..login
            }
        ));
    }

    #[test]
    fn password_recovery_destination_requires_new_password_evidence() {
        for destination in ["/password/recover", "/password/reset"] {
            let login = AuthenticationAdvanceControlObservation {
                destination_identity: destination.to_owned(),
                label: "Continuar".to_owned(),
                ..localized_identity_submit()
            };
            assert!(!advances_authentication(&login));
            assert!(advances_authentication(
                &AuthenticationAdvanceControlObservation {
                    new_password_field_count: 1,
                    ..login
                }
            ));
        }

        let unrelated_reset = AuthenticationAdvanceControlObservation {
            destination_identity: "/account/reset".to_owned(),
            new_password_field_count: 1,
            label: "Continuar".to_owned(),
            ..localized_identity_submit()
        };
        assert!(!advances_authentication(&unrelated_reset));
    }

    #[test]
    fn credential_update_routes_do_not_inherit_button_label_rejections() {
        let password_update = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            new_password_field_count: 1,
            form_identity: "account-settings".to_owned(),
            label: "Continuar".to_owned(),
            ..localized_identity_submit()
        };
        let observes_destination =
            |destination_identity: &str| AuthenticationAdvanceControlObservation {
                destination_identity: destination_identity.to_owned(),
                ..password_update.clone()
            };
        let advances_destination = |destination_identity: &str| {
            advances_authentication(&observes_destination(destination_identity))
        };
        assert!(advances_destination("/auth/update-password"));
        assert!(advances_destination("/auth/save-password"));
        assert!(advances_destination("/signup/save"));
        assert!(advances_destination("/recover/update"));
        assert!(advances_destination("/account/details/change-password"));
        assert!(advances_destination("/account/details/update-credentials"));
        for destination_identity in [
            "/auth/update-password/delete-account",
            "/auth/update-password/google",
        ] {
            assert!(!advances_destination(destination_identity));
        }
        for prefix in ["/auth/update-password", "/recover/update", "/signup/save"] {
            for suffix in ["cancel", "profile", "payment", "search"] {
                assert!(!advances_destination(&format!("{prefix}/{suffix}")));
            }
        }
        let mut missing_new_password = observes_destination("/auth/update-password");
        missing_new_password.new_password_field_count = 0;
        assert!(!advances_authentication(&missing_new_password));
    }

    #[test]
    fn destructive_password_reset_destination_is_an_unconditional_veto() {
        let ordinary_reset = AuthenticationAdvanceControlObservation {
            destination_identity: "/password/reset".to_owned(),
            new_password_field_count: 1,
            label: "Continuar".to_owned(),
            ..localized_identity_submit()
        };
        assert!(advances_authentication(&ordinary_reset));

        let destructive_reset = AuthenticationAdvanceControlObservation {
            destination_identity: "/password/reset/delete-account".to_owned(),
            ..ordinary_reset
        };
        assert!(!advances_authentication(&destructive_reset));
    }

    #[test]
    fn rejects_oversized_dom_control_text() {
        let oversized = "x".repeat(super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
        for field in ["form", "destination", "label"] {
            let mut observation = localized_identity_submit();
            match field {
                "form" => observation.form_identity = oversized.clone(),
                "destination" => observation.destination_identity = oversized.clone(),
                _ => observation.label = oversized.clone(),
            }
            assert!(!advances_authentication(&observation));
        }
    }

    #[test]
    fn rejects_recovery_destructive_and_inert_controls() {
        let localized_identity_submit = localized_identity_submit();

        let password_reveal_activation = AuthenticationAdvanceControlObservation {
            semantics: PageControlSemantics::Activation,
            label: "Show password".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&password_reveal_activation));

        let password_recovery_activation = AuthenticationAdvanceControlObservation {
            semantics: PageControlSemantics::Activation,
            label: "Forgot password?".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&password_recovery_activation));

        let password_recovery_submit = AuthenticationAdvanceControlObservation {
            semantics: PageControlSemantics::SemanticSubmit,
            ..password_recovery_activation
        };
        assert!(!advances_authentication(&password_recovery_submit));

        let resend_one_time_code_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            one_time_code_field_count: 1,
            label: "Resend code".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&resend_one_time_code_submit));

        let request_new_one_time_code_submit = AuthenticationAdvanceControlObservation {
            label: "Request new code".to_owned(),
            ..resend_one_time_code_submit
        };
        assert!(!advances_authentication(&request_new_one_time_code_submit));

        let destructive_confirmation = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            form_identity: "/auth/disable-account".to_owned(),
            password_field_count: 1,
            label: "Disable account".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&destructive_confirmation));

        let unlink_confirmation = AuthenticationAdvanceControlObservation {
            form_identity: "/auth/unlink-account".to_owned(),
            label: "Unlink account".to_owned(),
            ..destructive_confirmation.clone()
        };
        assert!(!advances_authentication(&unlink_confirmation));

        let destructive_login_fallback = AuthenticationAdvanceControlObservation {
            form_identity: "/auth/logout".to_owned(),
            label: "Sign out".to_owned(),
            ..destructive_confirmation.clone()
        };
        assert!(!advances_authentication(&destructive_login_fallback));

        let localized_destructive_password_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            form_identity: "/auth/change-email".to_owned(),
            destination_identity: String::new(),
            password_field_count: 1,
            label: "Change email".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(
            &localized_destructive_password_submit
        ));

        let login_specific_password_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Strong,
            form_identity: "login".to_owned(),
            password_field_count: 1,
            label: "Continuar".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(&login_specific_password_submit));

        let inert_next = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Inert,
            ownership: PageControlOwnership::Unowned,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            label: "Next".to_owned(),
            ..localized_identity_submit
        };
        assert!(!advances_authentication(&inert_next));
    }
}
