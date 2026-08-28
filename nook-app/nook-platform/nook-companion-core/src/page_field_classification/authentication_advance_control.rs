//! Authentication advance-control classification from browser-observed facts.

use super::control_identity::{
    looks_like_alternate_authentication_route_control_label,
    looks_like_auxiliary_authentication_control_label,
    looks_like_explicit_authentication_advance_control_label,
    looks_like_one_time_code_resend_control_label,
    looks_like_password_recovery_route_control_label, looks_like_registration_route_control_label,
};
use super::form_identity::{
    control_destination_indicates_non_authentication_route,
    control_destination_indicates_password_recovery_route,
    control_destination_indicates_registration_route, form_identity_indicates_destructive_action,
    form_identity_indicates_non_authentication_account_management,
    identity_indicates_explicit_authentication_route,
};
use super::{
    AuthenticationUsernameEvidence, contains_any_word, expand_identity_text,
    looks_like_login_advance_control_label, looks_like_non_authentication_submit_control_label,
    looks_like_password_update_submit_control_label,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

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

fn form_has_authentication_identity(form_identity: &str) -> bool {
    identity_indicates_explicit_authentication_route(form_identity)
}

fn destination_indicates_alternate_provider(destination_identity: &str) -> bool {
    looks_like_alternate_authentication_route_control_label(destination_identity)
        || contains_any_word(
            &expand_identity_text(destination_identity),
            &[
                "oauth",
                "google",
                "apple",
                "microsoft",
                "facebook",
                "github",
                "gitlab",
                "linkedin",
                "twitter",
                "okta",
            ],
        )
}

fn destination_has_disallowed_action_or_provider(destination_identity: &str) -> bool {
    looks_like_non_authentication_submit_control_label(destination_identity)
        || destination_indicates_alternate_provider(destination_identity)
}

fn destination_has_safe_login_identity(destination_identity: &str) -> bool {
    identity_indicates_explicit_authentication_route(destination_identity)
        && !control_destination_indicates_non_authentication_route(destination_identity)
        && !destination_has_disallowed_action_or_provider(destination_identity)
        && !looks_like_registration_route_control_label(destination_identity)
        && !looks_like_password_recovery_route_control_label(destination_identity)
        && !looks_like_auxiliary_authentication_control_label(destination_identity)
}

fn has_positive_login_identity(
    observation: &AuthenticationAdvanceControlObservation,
    authentication_scope_owns_control: bool,
) -> bool {
    let owned_semantic_submit = authentication_scope_owns_control
        && matches!(observation.semantics, PageControlSemantics::SemanticSubmit);
    matches!(
        observation.authentication_username,
        AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
    ) || form_has_authentication_identity(&observation.form_identity)
        || (owned_semantic_submit
            && matches!(
                observation.authentication_username,
                AuthenticationUsernameEvidence::StandardsBasedEmail
            ))
        || (owned_semantic_submit
            && (looks_like_explicit_authentication_advance_control_label(&observation.label)
                || destination_has_safe_login_identity(&observation.destination_identity)))
}

fn has_unconditional_veto_identity(observation: &AuthenticationAdvanceControlObservation) -> bool {
    form_identity_indicates_destructive_action(&observation.form_identity)
        || form_identity_indicates_destructive_action(&observation.destination_identity)
        || form_identity_indicates_destructive_action(&observation.label)
        || contains_any_word(&expand_identity_text(&observation.label), &["cancel"])
        || destination_has_disallowed_action_or_provider(&observation.destination_identity)
}

fn accepts_authentication_advance(
    observation: &AuthenticationAdvanceControlObservation,
    authentication_scope_owns_control: bool,
    semantic_submit_ceremony_present: bool,
) -> bool {
    let accepted_semantic_submit = authentication_scope_owns_control
        && matches!(observation.semantics, PageControlSemantics::SemanticSubmit)
        && semantic_submit_ceremony_present;
    let accepted_scoped_activation = authentication_scope_owns_control
        && matches!(observation.semantics, PageControlSemantics::Activation)
        && semantic_submit_ceremony_present
        && (observation.semantic_submit_control_count == 0
            || looks_like_explicit_authentication_advance_control_label(&observation.label));
    let accepted_login_label = authentication_scope_owns_control
        && looks_like_login_advance_control_label(&observation.label)
        && (semantic_submit_ceremony_present
            || looks_like_explicit_authentication_advance_control_label(&observation.label));
    accepted_semantic_submit || accepted_scoped_activation || accepted_login_label
}

impl AuthenticationAdvanceControlObservation {
    /// Whether DOM-controlled text and bounded field counts fit the observation envelope.
    #[must_use]
    pub fn is_bounded(&self) -> bool {
        self.form_identity.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
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
        if matches!(self.actionability, PageControlActionability::Inert) {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let authentication_scope_owns_control = matches!(
            self.ownership,
            PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
        );
        let positively_scoped_authentication_control = authentication_scope_owns_control
            && form_has_authentication_identity(&self.form_identity);
        let semantic_submit_ceremony_present = self.password_field_count > 0
            || self.new_password_field_count > 0
            || self.one_time_code_field_count > 0
            || matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
            || positively_scoped_authentication_control;
        let non_authentication_label =
            looks_like_non_authentication_submit_control_label(&self.label);
        let contextual_password_update = self.new_password_field_count > 0
            && looks_like_password_update_submit_control_label(&self.label);
        if has_unconditional_veto_identity(self) {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.new_password_field_count == 0
            && self.one_time_code_field_count == 0
            && form_identity_indicates_non_authentication_account_management(&self.form_identity)
            && !form_has_authentication_identity(&self.form_identity)
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if non_authentication_label && !contextual_password_update {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let current_password_only = self.password_field_count == 1
            && self.new_password_field_count == 0
            && self.one_time_code_field_count == 0;
        if current_password_only
            && !has_positive_login_identity(self, authentication_scope_owns_control)
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
            && looks_like_registration_route_control_label(&self.label)
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
        let credential_update_destination = self.new_password_field_count > 0
            && (control_destination_indicates_registration_route(&self.destination_identity)
                || control_destination_indicates_password_recovery_route(
                    &self.destination_identity,
                ));
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

    fn advances_authentication(observation: &AuthenticationAdvanceControlObservation) -> bool {
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
    fn standards_email_is_positive_evidence_for_owned_semantic_password_login() {
        let standards_email_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::StandardsBasedEmail,
            password_field_count: 1,
            form_identity: String::new(),
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

        let non_submit_email_control = AuthenticationAdvanceControlObservation {
            semantics: PageControlSemantics::Activation,
            ..standards_email_submit
        };
        assert!(!advances_authentication(&non_submit_email_control));
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

        let destination_only_submit = AuthenticationAdvanceControlObservation {
            ownership: PageControlOwnership::LocallyScoped,
            destination_identity: "/login".to_owned(),
            label: "Siguiente".to_owned(),
            ..password_only_submit.clone()
        };
        assert!(advances_authentication(&destination_only_submit));

        for rejected in [
            AuthenticationAdvanceControlObservation {
                destination_identity: "/profile".to_owned(),
                label: "Siguiente".to_owned(),
                ..password_only_submit.clone()
            },
            AuthenticationAdvanceControlObservation {
                destination_identity: "/profile".to_owned(),
                ..password_only_submit.clone()
            },
            AuthenticationAdvanceControlObservation {
                destination_identity: "/login/cancel".to_owned(),
                label: "Siguiente".to_owned(),
                ..password_only_submit.clone()
            },
            AuthenticationAdvanceControlObservation {
                destination_identity: "/login/cancel".to_owned(),
                ..password_only_submit.clone()
            },
            AuthenticationAdvanceControlObservation {
                destination_identity: "/login/google".to_owned(),
                label: "Siguiente".to_owned(),
                ..password_only_submit.clone()
            },
            AuthenticationAdvanceControlObservation {
                destination_identity: "/login/google".to_owned(),
                ..password_only_submit.clone()
            },
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
    fn cancellation_and_destructive_labels_veto_password_update_exemptions() {
        let password_update = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            new_password_field_count: 1,
            form_identity: "account-settings".to_owned(),
            ..localized_identity_submit()
        };
        for label in ["Reset password", "Change password"] {
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
            "Delete password reset",
            "Destroy password change",
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

        let account_email_submit = AuthenticationAdvanceControlObservation {
            form_identity: "account-settings".to_owned(),
            label: "Apply".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&account_email_submit));

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
            form_identity: "account-settings /auth/account/delete".to_owned(),
            label: "Eliminar cuenta".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(&destructive_confirmation));

        let destructive_login_fallback = AuthenticationAdvanceControlObservation {
            label: "Continue to delete account".to_owned(),
            ..destructive_confirmation.clone()
        };
        assert!(!advances_authentication(&destructive_login_fallback));

        let localized_destructive_password_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            form_identity: "auth".to_owned(),
            destination_identity: "/account/eliminar".to_owned(),
            password_field_count: 1,
            label: "Continuar".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(!advances_authentication(
            &localized_destructive_password_submit
        ));

        let positively_identified_password_submit = AuthenticationAdvanceControlObservation {
            authentication_username: AuthenticationUsernameEvidence::Strong,
            form_identity: String::new(),
            password_field_count: 1,
            label: "Continuar".to_owned(),
            ..localized_identity_submit.clone()
        };
        assert!(advances_authentication(
            &positively_identified_password_submit
        ));

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
