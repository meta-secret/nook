use super::AuthenticationFieldObservationFacts;
use crate::AuthenticationControlText;
use crate::CanonicalControlDestination;
use crate::ControlDestinationEvidence;
use crate::authentication_workflow::{
    AuthenticationAdvanceControlEvidence, AuthenticationManualCheckpoint,
    AuthenticationOneTimeCodeProgressionEvidence,
};
use crate::page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    AuthenticationUsernameEvidence, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    OneTimeCodeRouteDecision, PageControlSubmissionMethod,
};
use crate::{AuthenticationRouteEvidence, CredentialUpdateRouteEvidence, OneTimeCodeRouteEvidence};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Detailed browser evidence for the control selected to advance authentication.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "observations", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationDetailedAdvanceControlObservation {
    #[default]
    Absent,
    Observed(Vec<AuthenticationAdvanceControlObservation>),
}

impl AuthenticationDetailedAdvanceControlObservation {
    #[must_use]
    pub fn observed(observation: AuthenticationAdvanceControlObservation) -> Self {
        Self::Observed(vec![observation])
    }

    pub(super) fn evidence(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> AuthenticationAdvanceControlEvidence {
        let advances = matches!(self, Self::Observed(observations) if observations.iter().any(
            |observation| fields.is_compatible_with_detailed_control(observation)
                && (matches!(
                        observation.classify(),
                        AuthenticationAdvanceControlDecision::AdvancesAuthentication
                    )
                    || observation.is_inert_webauthn_email_planning_advance())
        ));
        if advances {
            AuthenticationAdvanceControlEvidence::Present
        } else {
            AuthenticationAdvanceControlEvidence::Absent
        }
    }

    pub(super) fn is_bounded(&self) -> bool {
        matches!(self, Self::Absent)
            || matches!(self, Self::Observed(observations)
                if !observations.is_empty()
                    && observations.len() <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize
                    && observations.iter().all(AuthenticationAdvanceControlObservation::is_bounded))
    }
}

/// Authentication-scope evidence that remains available when an OTP auto-submits without a control.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationCeremonyContextObservation {
    pub authentication_username: AuthenticationUsernameEvidence,
    pub source_origin: String,
    pub form_identity: String,
    pub destination_identity: String,
}

impl Default for AuthenticationCeremonyContextObservation {
    fn default() -> Self {
        Self {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            source_origin: String::new(),
            form_identity: String::new(),
            destination_identity: String::new(),
        }
    }
}

impl AuthenticationCeremonyContextObservation {
    pub(super) fn approved_scope_compatibility(
        &self,
        approved: &Self,
    ) -> super::revalidation::ApprovedObservationCompatibility {
        use super::revalidation::ApprovedObservationCompatibility::{Changed, Unchanged};
        if self.source_origin == approved.source_origin
            && self.form_identity == approved.form_identity
            && self.destination_identity == approved.destination_identity
        {
            Unchanged
        } else {
            Changed
        }
    }

    fn is_bounded(&self) -> bool {
        [
            &self.source_origin,
            &self.form_identity,
            &self.destination_identity,
        ]
        .into_iter()
        .all(|value| value.len() <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
    }

    pub(super) fn is_authenticated(&self, fields: AuthenticationFieldObservationFacts) -> bool {
        fields.one_time_code_field_count.is_nonzero()
            && fields.current_password_field_count.is_zero()
            && fields.new_password_field_count.is_zero()
            && fields.generic_password_field_count.is_zero()
            && (fields.username_field_count.is_nonzero())
                != matches!(
                    self.authentication_username,
                    AuthenticationUsernameEvidence::Absent
                )
            && self.is_bounded()
            && matches!(
                (OneTimeCodeRouteEvidence {
                    authentication_username: self.authentication_username,
                    source_origin: &self.source_origin,
                    form_identity: &self.form_identity,
                    destination_identity: &self.destination_identity
                })
                .classify(),
                OneTimeCodeRouteDecision::Authentication
            )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationCeremonyObservationFacts {
    /// Legacy reduced evidence retained for wire compatibility; ignored during conversion.
    pub one_time_code_progression: AuthenticationOneTimeCodeProgressionEvidence,
    /// Raw executable input/change handler evidence, classified in Rust.
    #[serde(default)]
    pub one_time_code_handler_signal: String,
    /// Independently classified handler attributes; the singular field remains compatible.
    #[serde(default)]
    pub one_time_code_handler_signals: Vec<String>,
    /// Authentication-scope evidence used when the OTP handler replaces a separate control.
    #[serde(default)]
    pub authentication_context: AuthenticationCeremonyContextObservation,
    pub manual_checkpoint: AuthenticationManualCheckpoint,
    /// Explicit `present` remains legacy-only; `implicit-submission` is validated with context.
    pub advance_control: AuthenticationAdvanceControlEvidence,
    /// Effective form method for implicit submission; GET must not admit password logins.
    #[serde(default)]
    pub implicit_submission_method: PageControlSubmissionMethod,
}

/// Final browser-actuation facts for an implicit authentication form submission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationImplicitSubmitActuationObservation {
    pub fields: AuthenticationFieldObservationFacts,
    pub ceremony: AuthenticationCeremonyObservationFacts,
    pub control_label: String,
    pub control_machine_identity: String,
}

impl AuthenticationImplicitSubmitActuationObservation {
    /// Whether final actuation may use the exact identifier-only login-mode GET exception.
    #[must_use]
    pub fn is_safe(&self) -> bool {
        self.fields.is_bounded()
            && self.ceremony.is_bounded()
            && matches!(
                self.ceremony.advance_control,
                AuthenticationAdvanceControlEvidence::ImplicitSubmission
            )
            && self.control_label.is_empty()
            && self.control_machine_identity.is_empty()
            && self
                .ceremony
                .has_safe_identifier_only_login_mode_get(self.fields)
    }
}

impl AuthenticationCeremonyObservationFacts {
    fn has_safe_identifier_only_login_mode_get(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        if !matches!(
            self.implicit_submission_method,
            PageControlSubmissionMethod::Get
        ) || !fields.username_field_count.is_single()
            || fields.current_password_field_count.is_nonzero()
            || fields.generic_password_field_count.is_nonzero()
            || fields.new_password_field_count.is_nonzero()
            || fields.one_time_code_field_count.is_nonzero()
            || !matches!(
                self.authentication_context.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
        {
            return false;
        }
        let context = &self.authentication_context;
        if !context.form_identity.is_empty() {
            return false;
        }
        let Ok(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: &context.source_origin,
                destination_identity: &context.destination_identity,
            },
        ) else {
            return false;
        };
        if destination
            .route_identity
            .strip_prefix(&destination.path_identity)
            != Some("?mode=login")
        {
            return false;
        }
        AuthenticationAdvanceControlObservation::has_safe_authentication_route_identity(
            AuthenticationRouteEvidence {
                source_origin: &context.source_origin,
                form_identity: &destination.route_identity,
                destination_identity: &context.destination_identity,
            },
        )
    }

    pub(super) fn is_bounded(&self) -> bool {
        self.one_time_code_handler_signal.len() <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.one_time_code_handler_signals.len()
                <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize
            && self
                .one_time_code_handler_signals
                .iter()
                .all(|signal| signal.len() <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
            && self.authentication_context.is_bounded()
    }

    pub(super) fn derived_one_time_code_progression(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> AuthenticationOneTimeCodeProgressionEvidence {
        if !self.is_bounded() || !self.authentication_context.is_authenticated(fields) {
            return AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired;
        }
        if AuthenticationControlText::new(&self.one_time_code_handler_signal)
            .looks_like_one_time_code_auto_submit_signal()
            || self.one_time_code_handler_signals.iter().any(|signal| {
                AuthenticationControlText::new(signal).looks_like_one_time_code_auto_submit_signal()
            })
        {
            AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved
        } else {
            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
        }
    }

    pub(super) fn has_safe_implicit_submission(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        matches!(
            self.advance_control,
            AuthenticationAdvanceControlEvidence::ImplicitSubmission
        ) && !(self).password_implicit_submission_uses_get(fields)
            && fields.one_time_code_field_count.is_zero()
            && [
                fields.current_password_field_count,
                fields.generic_password_field_count,
                fields.new_password_field_count,
                fields.username_field_count,
            ]
            .into_iter()
            .any(crate::AuthenticationFieldCount::is_nonzero)
            && (fields.username_field_count.is_nonzero())
                != matches!(
                    self.authentication_context.authentication_username,
                    AuthenticationUsernameEvidence::Absent
                )
            && self.authentication_context.is_bounded()
            && if fields.new_password_field_count.is_nonzero() {
                AuthenticationAdvanceControlObservation::has_safe_credential_update_route_identity(
                    CredentialUpdateRouteEvidence {
                        source_origin: &self.authentication_context.source_origin,
                        form_identity: &self.authentication_context.form_identity,
                        destination_identity: &self.authentication_context.destination_identity,
                    },
                )
            } else {
                AuthenticationAdvanceControlObservation::has_safe_authentication_route_identity(
                    AuthenticationRouteEvidence {
                        source_origin: &self.authentication_context.source_origin,
                        form_identity: &self.authentication_context.form_identity,
                        destination_identity: &self.authentication_context.destination_identity,
                    },
                ) || self.has_safe_identifier_only_login_mode_get(fields)
            }
    }
}

impl AuthenticationCeremonyObservationFacts {
    fn password_implicit_submission_uses_get(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        let ceremony = self;
        (fields.current_password_field_count.is_nonzero()
            || fields.generic_password_field_count.is_nonzero()
            || fields.new_password_field_count.is_nonzero())
            && matches!(
                ceremony.implicit_submission_method,
                PageControlSubmissionMethod::Get | PageControlSubmissionMethod::Dialog
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        PageControlActionability, PageControlOwnership, PageControlSemantics,
        PageControlSubmissionDestinationSource,
    };

    struct TeslaInertPlanningScenario;

    impl TeslaInertPlanningScenario {
        fn observation() -> AuthenticationAdvanceControlObservation {
            AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Inert,
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

        fn fields() -> AuthenticationFieldObservationFacts {
            AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                ..Default::default()
            }
        }

        fn evidence(
            observation: AuthenticationAdvanceControlObservation,
        ) -> AuthenticationAdvanceControlEvidence {
            AuthenticationDetailedAdvanceControlObservation::observed(observation)
                .evidence(Self::fields())
        }

        fn assert_rejected(observation: AuthenticationAdvanceControlObservation) {
            assert!(matches!(
                Self::evidence(observation),
                AuthenticationAdvanceControlEvidence::Absent
            ));
        }
    }

    impl AuthenticationCeremonyObservationFacts {
        fn x_identifier_get() -> Self {
            Self {
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Explicit,
                    source_origin: "https://x.com".to_owned(),
                    form_identity: String::new(),
                    destination_identity: "https://x.com/i/jf/onboarding/web?mode=login".to_owned(),
                },
                advance_control: AuthenticationAdvanceControlEvidence::ImplicitSubmission,
                implicit_submission_method: PageControlSubmissionMethod::Get,
                ..Default::default()
            }
        }
    }

    impl AuthenticationFieldObservationFacts {
        fn identifier_only() -> Self {
            Self {
                username_field_count: 1.into(),
                ..Default::default()
            }
        }
    }

    impl AuthenticationImplicitSubmitActuationObservation {
        fn x_identifier_get() -> Self {
            Self {
                fields: AuthenticationFieldObservationFacts::identifier_only(),
                ceremony: AuthenticationCeremonyObservationFacts::x_identifier_get(),
                control_label: String::new(),
                control_machine_identity: String::new(),
            }
        }
    }

    #[test]
    fn tesla_inert_next_is_planning_evidence_without_actuation_authority() {
        let inert = TeslaInertPlanningScenario::observation();
        assert!(!inert.authentication_advance_control_is_safe());
        assert!(inert.is_inert_webauthn_email_planning_advance());
        assert!(TeslaInertPlanningScenario::fields().is_compatible_with_detailed_control(&inert));
        assert!(matches!(
            TeslaInertPlanningScenario::evidence(inert.clone()),
            AuthenticationAdvanceControlEvidence::Present
        ));

        let mut refreshed = inert;
        refreshed.actionability = PageControlActionability::Actionable;
        assert!(refreshed.authentication_advance_control_is_safe());
        assert!(matches!(
            TeslaInertPlanningScenario::evidence(refreshed),
            AuthenticationAdvanceControlEvidence::Present
        ));
    }

    #[test]
    fn inert_planning_requires_the_exact_webauthn_email_oauth_shape() {
        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
            AuthenticationUsernameEvidence::Strong,
            AuthenticationUsernameEvidence::Explicit,
        ] {
            let mut rejected = TeslaInertPlanningScenario::observation();
            rejected.authentication_username = evidence;
            TeslaInertPlanningScenario::assert_rejected(rejected);
        }

        for destination in [
            "https://attacker.example/oauth2/v1/authorize",
            "https://auth.tesla.com/login",
            "https://auth.tesla.com/signup",
            "https://auth.tesla.com/recover",
            "https://auth.tesla.com/oauth2/v1/authorize?provider=google",
            "https://auth.tesla.com/account/delete",
        ] {
            let mut rejected = TeslaInertPlanningScenario::observation();
            rejected.destination_identity = destination.to_owned();
            TeslaInertPlanningScenario::assert_rejected(rejected);
        }

        for label in [
            "Continue",
            "Trouble Signing In",
            "Create Account",
            "Continue with Google",
            "Use passkey",
            "Delete account",
        ] {
            let mut rejected = TeslaInertPlanningScenario::observation();
            rejected.label = label.to_owned();
            TeslaInertPlanningScenario::assert_rejected(rejected);
        }

        let mutations: &[fn(&mut AuthenticationAdvanceControlObservation)] = &[
            |control| control.semantic_submit_control_count = 2.into(),
            |control| control.ownership = PageControlOwnership::Unowned,
            |control| control.ownership = PageControlOwnership::LocallyScoped,
            |control| {
                control.submission_destination_source =
                    PageControlSubmissionDestinationSource::Authored;
            },
            |control| control.form_identity = "sign-in-form".to_owned(),
            |control| control.semantics = PageControlSemantics::Activation,
            |control| control.submission_method = PageControlSubmissionMethod::Post,
            |control| control.password_field_count = 1.into(),
        ];
        for mutation in mutations {
            let mut rejected = TeslaInertPlanningScenario::observation();
            mutation(&mut rejected);
            TeslaInertPlanningScenario::assert_rejected(rejected);
        }

        for count in [0, 2] {
            let fields = AuthenticationFieldObservationFacts {
                username_field_count: count.into(),
                ..Default::default()
            };
            assert!(matches!(
                AuthenticationDetailedAdvanceControlObservation::observed(
                    TeslaInertPlanningScenario::observation()
                )
                .evidence(fields),
                AuthenticationAdvanceControlEvidence::Absent
            ));
        }
    }

    #[test]
    fn exact_login_mode_query_admits_identifier_only_implicit_get() {
        assert!(
            AuthenticationCeremonyObservationFacts::x_identifier_get()
                .has_safe_implicit_submission(
                    AuthenticationFieldObservationFacts::identifier_only()
                )
        );
    }

    #[test]
    fn login_mode_query_requires_exact_canonical_query_identity() {
        let fields = AuthenticationFieldObservationFacts::identifier_only();
        for destination in [
            "https://x.com/i/jf/onboarding/web",
            "https://x.com/i/jf/onboarding/web?mode",
            "https://x.com/i/jf/onboarding/web?mode=signin",
            "https://x.com/i/jf/onboarding/web?Mode=login",
            "https://x.com/i/jf/onboarding/web?login=mode",
            "https://x.com/i/jf/onboarding/web?next=mode=login",
            "https://x.com/i/jf/onboarding/web?mode=loginish",
            "https://x.com/i/jf/onboarding/web?mode=login&next=/home",
            "https://x.com/i/jf/onboarding/web?mode=login&mode=login",
            "https://x.com/i/jf/onboarding/web?mode=login&mode=signup",
            "https://x.com/i/jf/onboarding/web?mode=login#authentication",
            "https://other.example/i/jf/onboarding/web?mode=login",
        ] {
            let mut ceremony = AuthenticationCeremonyObservationFacts::x_identifier_get();
            ceremony.authentication_context.destination_identity = destination.to_owned();
            assert!(
                !ceremony.has_safe_implicit_submission(fields),
                "{destination}"
            );
        }
    }

    #[test]
    fn login_mode_query_preserves_route_and_credential_shape_vetoes() {
        let fields = AuthenticationFieldObservationFacts::identifier_only();
        for destination in [
            "https://x.com/search?mode=login",
            "https://x.com/account/delete?mode=login",
            "https://x.com/account/recover?mode=login",
            "https://x.com/i/jf/onboarding/web?mode=login&provider=google",
        ] {
            let mut ceremony = AuthenticationCeremonyObservationFacts::x_identifier_get();
            ceremony.authentication_context.destination_identity = destination.to_owned();
            assert!(
                !ceremony.has_safe_implicit_submission(fields),
                "{destination}"
            );
        }

        for rejected_fields in [
            AuthenticationFieldObservationFacts {
                username_field_count: 0.into(),
                ..fields
            },
            AuthenticationFieldObservationFacts {
                username_field_count: 2.into(),
                ..fields
            },
            AuthenticationFieldObservationFacts {
                current_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..fields
            },
            AuthenticationFieldObservationFacts {
                generic_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..fields
            },
            AuthenticationFieldObservationFacts {
                new_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..fields
            },
            AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1.into(),
                ..fields
            },
        ] {
            assert!(
                !AuthenticationCeremonyObservationFacts::x_identifier_get()
                    .has_safe_implicit_submission(rejected_fields)
            );
        }

        for method in [
            PageControlSubmissionMethod::Absent,
            PageControlSubmissionMethod::Post,
            PageControlSubmissionMethod::Dialog,
        ] {
            let mut ceremony = AuthenticationCeremonyObservationFacts::x_identifier_get();
            ceremony.implicit_submission_method = method;
            assert!(!ceremony.has_safe_implicit_submission(fields));
        }

        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
            AuthenticationUsernameEvidence::WebAuthnEmail,
        ] {
            let mut ceremony = AuthenticationCeremonyObservationFacts::x_identifier_get();
            ceremony.authentication_context.authentication_username = evidence;
            assert!(!ceremony.has_safe_implicit_submission(fields));
        }
    }

    #[test]
    fn login_mode_fallback_requires_an_empty_form_identity() {
        let fields = AuthenticationFieldObservationFacts::identifier_only();
        for form_identity in [
            "signup",
            "reset-password",
            "google-login",
            "continue-with-passkey",
            "forgot-password",
            "help",
            "delete-account",
            "account-settings",
            " ",
        ] {
            let mut ceremony = AuthenticationCeremonyObservationFacts::x_identifier_get();
            ceremony.authentication_context.form_identity = form_identity.to_owned();
            assert!(
                !ceremony.has_safe_implicit_submission(fields),
                "{form_identity}"
            );
        }
    }

    #[test]
    fn implicit_actuation_accepts_the_exact_bounded_login_mode_get() {
        assert!(AuthenticationImplicitSubmitActuationObservation::x_identifier_get().is_safe());
    }

    #[test]
    fn implicit_actuation_rejects_conflicting_form_and_control_identity() {
        for form_identity in [
            "signup",
            "reset-password",
            "google-login",
            "continue-with-passkey",
            "forgot-password",
            "help",
            "delete-account",
            "account-settings",
            " ",
        ] {
            let mut observation =
                AuthenticationImplicitSubmitActuationObservation::x_identifier_get();
            observation.ceremony.authentication_context.form_identity = form_identity.to_owned();
            assert!(!observation.is_safe(), "{form_identity}");
        }

        let mut concrete = AuthenticationImplicitSubmitActuationObservation::x_identifier_get();
        concrete.ceremony.advance_control = AuthenticationAdvanceControlEvidence::Present;
        assert!(!concrete.is_safe());

        let mut provider = AuthenticationImplicitSubmitActuationObservation::x_identifier_get();
        provider.control_label = "Continue with Google".to_owned();
        assert!(!provider.is_safe());

        let mut machine = AuthenticationImplicitSubmitActuationObservation::x_identifier_get();
        machine.control_machine_identity = "provider=google".to_owned();
        assert!(!machine.is_safe());
    }

    #[test]
    fn implicit_actuation_rejects_inexact_or_unsafe_destinations() {
        for destination in [
            "https://x.com/i/jf/onboarding/web",
            "https://x.com/i/jf/onboarding/web?mode=signin",
            "https://x.com/i/jf/onboarding/web?Mode=login",
            "https://x.com/i/jf/onboarding/web?next=mode=login",
            "https://x.com/i/jf/onboarding/web?mode=login&next=/home",
            "https://x.com/i/jf/onboarding/web?mode=login&mode=login",
            "https://x.com/i/jf/onboarding/web?mode=login&mode=signup",
            "https://x.com/i/jf/onboarding/web?mode=login#authentication",
            "https://other.example/i/jf/onboarding/web?mode=login",
            "https://x.com/search?mode=login",
            "https://x.com/account/delete?mode=login",
            "https://x.com/account/recover?mode=login",
            "https://x.com/i/jf/onboarding/web?mode=login&provider=google",
        ] {
            let mut observation =
                AuthenticationImplicitSubmitActuationObservation::x_identifier_get();
            observation
                .ceremony
                .authentication_context
                .destination_identity = destination.to_owned();
            assert!(!observation.is_safe(), "{destination}");
        }
    }

    #[test]
    fn implicit_actuation_rejects_unsafe_methods_and_field_shapes() {
        for fields in [
            AuthenticationFieldObservationFacts {
                username_field_count: 0.into(),
                ..AuthenticationFieldObservationFacts::identifier_only()
            },
            AuthenticationFieldObservationFacts {
                username_field_count: 2.into(),
                ..AuthenticationFieldObservationFacts::identifier_only()
            },
            AuthenticationFieldObservationFacts {
                current_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..AuthenticationFieldObservationFacts::identifier_only()
            },
            AuthenticationFieldObservationFacts {
                generic_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..AuthenticationFieldObservationFacts::identifier_only()
            },
            AuthenticationFieldObservationFacts {
                new_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..AuthenticationFieldObservationFacts::identifier_only()
            },
            AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1.into(),
                ..AuthenticationFieldObservationFacts::identifier_only()
            },
        ] {
            let mut observation =
                AuthenticationImplicitSubmitActuationObservation::x_identifier_get();
            observation.fields = fields;
            assert!(!observation.is_safe());
        }

        for method in [
            PageControlSubmissionMethod::Absent,
            PageControlSubmissionMethod::Post,
            PageControlSubmissionMethod::Dialog,
        ] {
            let mut observation =
                AuthenticationImplicitSubmitActuationObservation::x_identifier_get();
            observation.ceremony.implicit_submission_method = method;
            assert!(!observation.is_safe());
        }

        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
            AuthenticationUsernameEvidence::WebAuthnEmail,
        ] {
            let mut observation =
                AuthenticationImplicitSubmitActuationObservation::x_identifier_get();
            observation
                .ceremony
                .authentication_context
                .authentication_username = evidence;
            assert!(!observation.is_safe());
        }
    }
}
