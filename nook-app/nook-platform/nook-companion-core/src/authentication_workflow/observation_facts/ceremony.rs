use super::AuthenticationFieldObservationFacts;
use crate::authentication_workflow::{
    AuthenticationAdvanceControlEvidence, AuthenticationManualCheckpoint,
    AuthenticationOneTimeCodeProgressionEvidence,
};
use crate::page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    AuthenticationUsernameEvidence, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    PageControlSubmissionMethod, canonicalize_control_destination,
    has_safe_authentication_route_identity, has_safe_credential_update_route_identity,
    looks_like_one_time_code_auto_submit_signal, one_time_code_ceremony_context_is_authenticated,
};
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
                && matches!(
                    observation.classify(),
                    AuthenticationAdvanceControlDecision::AdvancesAuthentication
                )
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
        fields.one_time_code_field_count.raw() > 0
            && fields.current_password_field_count.raw() == 0
            && fields.new_password_field_count.raw() == 0
            && fields.generic_password_field_count.raw() == 0
            && (fields.username_field_count.raw() > 0)
                != matches!(
                    self.authentication_username,
                    AuthenticationUsernameEvidence::Absent
                )
            && self.is_bounded()
            && one_time_code_ceremony_context_is_authenticated(
                self.authentication_username,
                &self.source_origin,
                &self.form_identity,
                &self.destination_identity,
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

impl AuthenticationCeremonyObservationFacts {
    fn has_safe_identifier_only_login_mode_get(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        if !matches!(
            self.implicit_submission_method,
            PageControlSubmissionMethod::Get
        ) || fields.username_field_count.raw() != 1
            || fields.current_password_field_count.raw() != 0
            || fields.generic_password_field_count.raw() != 0
            || fields.new_password_field_count.raw() != 0
            || fields.one_time_code_field_count.raw() != 0
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
        let Some(destination) =
            canonicalize_control_destination(&context.source_origin, &context.destination_identity)
        else {
            return false;
        };
        if destination
            .route_identity
            .strip_prefix(&destination.path_identity)
            != Some("?mode=login")
        {
            return false;
        }
        has_safe_authentication_route_identity(
            &context.source_origin,
            &destination.route_identity,
            &context.destination_identity,
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
        has_trusted_authentication_context: bool,
    ) -> AuthenticationOneTimeCodeProgressionEvidence {
        if !self.is_bounded() || !has_trusted_authentication_context {
            return AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired;
        }
        if looks_like_one_time_code_auto_submit_signal(&self.one_time_code_handler_signal)
            || self
                .one_time_code_handler_signals
                .iter()
                .any(|signal| looks_like_one_time_code_auto_submit_signal(signal))
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
        ) && !password_implicit_submission_uses_get(self, fields)
            && fields.one_time_code_field_count.raw() == 0
            && [
                fields.current_password_field_count.raw(),
                fields.generic_password_field_count.raw(),
                fields.new_password_field_count.raw(),
                fields.username_field_count.raw(),
            ]
            .into_iter()
            .any(|count| count > 0)
            && (fields.username_field_count.raw() > 0)
                != matches!(
                    self.authentication_context.authentication_username,
                    AuthenticationUsernameEvidence::Absent
                )
            && self.authentication_context.is_bounded()
            && if fields.new_password_field_count.raw() > 0 {
                has_safe_credential_update_route_identity(
                    &self.authentication_context.source_origin,
                    &self.authentication_context.form_identity,
                    &self.authentication_context.destination_identity,
                )
            } else {
                has_safe_authentication_route_identity(
                    &self.authentication_context.source_origin,
                    &self.authentication_context.form_identity,
                    &self.authentication_context.destination_identity,
                ) || self.has_safe_identifier_only_login_mode_get(fields)
            }
    }
}

fn password_implicit_submission_uses_get(
    ceremony: &AuthenticationCeremonyObservationFacts,
    fields: AuthenticationFieldObservationFacts,
) -> bool {
    (fields.current_password_field_count.raw()
        + fields.generic_password_field_count.raw()
        + fields.new_password_field_count.raw())
        > 0
        && matches!(
            ceremony.implicit_submission_method,
            PageControlSubmissionMethod::Get | PageControlSubmissionMethod::Dialog
        )
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
