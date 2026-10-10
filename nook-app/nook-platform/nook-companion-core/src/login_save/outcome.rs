//! Eligibility to offer an explicit save for an observed submitted login.
//!
//! This is evidence of a submitted flow leaving authentication, not proof of
//! server authentication. Browser binding, unlocked vault authority, and explicit
//! Save consent remain required at the write boundary.

use crate::AuthenticationWorkflowKind;
use crate::{
    AuthenticationControlText, AuthenticationOutcomeElapsedMilliseconds,
    AuthenticationOutcomeObservation, AuthenticationOutcomeTimeoutMilliseconds,
    DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LoginObservationError {
    #[error("login submission context is invalid")]
    InvalidSubmissionContext,
    #[error("login event target index is invalid")]
    InvalidTargetField,
    #[error("login control label exceeds the observation bound")]
    ControlLabelTooLong,
    #[error("login observation contains too many controls")]
    TooManyControls,
    #[error("login observation contains too many fields")]
    TooManyFields,
    #[error("login field metadata exceeds the observation bound")]
    FieldMetadataTooLong,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct LoginControlLabel(String);

impl TryFrom<String> for LoginControlLabel {
    type Error = LoginObservationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.len() {
            length if length > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES => {
                Err(LoginObservationError::ControlLabelTooLong)
            }
            _ => Ok(Self(value)),
        }
    }
}

impl From<LoginControlLabel> for String {
    fn from(label: LoginControlLabel) -> Self {
        let LoginControlLabel(value) = label;
        value
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LoginControlSemantics {
    SubmitLogin,
    SignOut,
    Other,
}

impl LoginControlLabel {
    pub(crate) fn semantics(&self) -> LoginControlSemantics {
        let Self(value) = self;
        let normalized = AuthenticationControlText::new(value).expand_identity_text();
        match normalized.as_str() {
            "sign in" | "signin" | "sign on" | "signon" | "log in" | "login" | "log on"
            | "logon" => LoginControlSemantics::SubmitLogin,
            "sign out" | "signout" | "sign off" | "log out" | "logout" | "log off" => {
                LoginControlSemantics::SignOut
            }
            _ => LoginControlSemantics::Other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginSubmissionPresence {
    Captured,
    Absent,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginAuthFieldPresence {
    Present,
    Absent,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginSubmissionOrigin {
    SameOrigin,
    ChangedOrigin,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginSubmissionTransition {
    None,
    SameDocumentMutation,
    SameDocumentNavigation,
    DocumentNavigation,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginManualCheckpoint {
    Clear,
    Pending,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginSaveEligibility {
    Eligible,
    Waiting,
    Rejected,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub struct LoginSaveOutcomeDecision {
    pub eligibility: LoginSaveEligibility,
}

/// Current-runtime non-secret contract. Every field is required; no persisted
/// credential or vault schema changes. Consumers must roll out with this export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct LoginSaveOutcomeObservation {
    pub observation: AuthenticationOutcomeObservation,
    pub captured_workflow: crate::AuthenticationWorkflowKind,
    pub submission: LoginSubmissionPresence,
    pub origin: LoginSubmissionOrigin,
    pub initial_auth_fields: LoginAuthFieldPresence,
    pub transition: LoginSubmissionTransition,
    pub checkpoint: LoginManualCheckpoint,
    pub no_auth_elapsed_ms: AuthenticationOutcomeElapsedMilliseconds,
    pub baseline_controls: Vec<LoginControlLabel>,
    pub current_controls: Vec<LoginControlLabel>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AuthenticatedControlEvidence {
    Present,
    Absent,
}

#[derive(Clone, Copy)]
struct LoginAuthenticatedControls {
    baseline: AuthenticatedControlEvidence,
    current: AuthenticatedControlEvidence,
}

impl AuthenticatedControlEvidence {
    fn from_controls(controls: &[LoginControlLabel]) -> Result<Self, LoginObservationError> {
        if let 65.. = controls.len() {
            return Err(LoginObservationError::TooManyControls);
        }
        let true = controls
            .iter()
            .any(|control| matches!(control.semantics(), LoginControlSemantics::SignOut))
        else {
            return Ok(Self::Absent);
        };
        Ok(Self::Present)
    }
}

#[derive(Clone, Copy)]
enum LoginObservedError {
    Present,
    Absent,
}
#[derive(Clone, Copy)]
enum LoginFrameContext {
    TopLevel,
    Embedded,
}

struct LoginSaveEligibilityInput {
    captured_workflow: AuthenticationWorkflowKind,
    submission: LoginSubmissionPresence,
    origin: LoginSubmissionOrigin,
    initial_auth_fields: LoginAuthFieldPresence,
    auth_fields: LoginAuthFieldPresence,
    checkpoint: LoginManualCheckpoint,
    error: LoginObservedError,
    frame: LoginFrameContext,
    elapsed_ms: AuthenticationOutcomeElapsedMilliseconds,
    no_auth_elapsed_ms: AuthenticationOutcomeElapsedMilliseconds,
    transition: LoginSubmissionTransition,
    controls: LoginAuthenticatedControls,
}

impl TryFrom<&LoginSaveOutcomeObservation> for LoginSaveEligibilityInput {
    type Error = LoginObservationError;
    #[expect(
        clippy::match_bool,
        reason = "Convert the established external outcome flags immediately into named eligibility states"
    )]
    fn try_from(wire: &LoginSaveOutcomeObservation) -> Result<Self, Self::Error> {
        Ok(Self {
            captured_workflow: wire.captured_workflow,
            submission: wire.submission,
            origin: wire.origin,
            initial_auth_fields: wire.initial_auth_fields,
            auth_fields: match wire.observation.auth_fields_present {
                true => LoginAuthFieldPresence::Present,
                false => LoginAuthFieldPresence::Absent,
            },
            checkpoint: wire.checkpoint,
            error: match wire.observation.error_marker_present {
                true => LoginObservedError::Present,
                false => LoginObservedError::Absent,
            },
            frame: match wire.observation.in_iframe {
                true => LoginFrameContext::Embedded,
                false => LoginFrameContext::TopLevel,
            },
            elapsed_ms: wire.observation.elapsed_ms,
            no_auth_elapsed_ms: wire.no_auth_elapsed_ms,
            transition: wire.transition,
            controls: LoginAuthenticatedControls {
                baseline: AuthenticatedControlEvidence::from_controls(&wire.baseline_controls)?,
                current: AuthenticatedControlEvidence::from_controls(&wire.current_controls)?,
            },
        })
    }
}

impl LoginSaveOutcomeObservation {
    pub const STABILITY_DELAY_MS: AuthenticationOutcomeTimeoutMilliseconds =
        AuthenticationOutcomeTimeoutMilliseconds::from_raw(750);

    pub fn classify(&self) -> Result<LoginSaveOutcomeDecision, LoginObservationError> {
        Ok(LoginSaveEligibilityInput::try_from(self)?.classify())
    }
}

impl LoginSaveEligibilityInput {
    fn classify(&self) -> LoginSaveOutcomeDecision {
        let eligibility = match self.eligibility() {
            LoginSaveEligibility::Waiting => self.waiting(),
            eligibility @ (LoginSaveEligibility::Eligible
            | LoginSaveEligibility::Rejected
            | LoginSaveEligibility::Expired) => eligibility,
        };
        LoginSaveOutcomeDecision { eligibility }
    }

    fn eligibility(&self) -> LoginSaveEligibility {
        match self.captured_workflow {
            AuthenticationWorkflowKind::Login => {}
            AuthenticationWorkflowKind::Signup
            | AuthenticationWorkflowKind::PasswordChange
            | AuthenticationWorkflowKind::TotpChallenge
            | AuthenticationWorkflowKind::TotpEnrollment
            | AuthenticationWorkflowKind::Manual => return LoginSaveEligibility::Rejected,
        }
        let false = self.no_auth_elapsed_ms > self.elapsed_ms else {
            return LoginSaveEligibility::Rejected;
        };
        match self.origin {
            LoginSubmissionOrigin::ChangedOrigin => return LoginSaveEligibility::Rejected,
            LoginSubmissionOrigin::SameOrigin => {}
        }
        match self.error {
            LoginObservedError::Present => return LoginSaveEligibility::Rejected,
            LoginObservedError::Absent => {}
        }
        match self.submission {
            LoginSubmissionPresence::Absent => return LoginSaveEligibility::Waiting,
            LoginSubmissionPresence::Captured => {}
        }
        match self.initial_auth_fields {
            LoginAuthFieldPresence::Absent => return LoginSaveEligibility::Waiting,
            LoginAuthFieldPresence::Present => {}
        }
        match self.checkpoint {
            LoginManualCheckpoint::Pending => return LoginSaveEligibility::Waiting,
            LoginManualCheckpoint::Clear => {}
        }
        match self.auth_fields {
            LoginAuthFieldPresence::Present => return LoginSaveEligibility::Waiting,
            LoginAuthFieldPresence::Absent => {}
        }
        let true = self
            .no_auth_elapsed_ms
            .has_reached(LoginSaveOutcomeObservation::STABILITY_DELAY_MS)
        else {
            return LoginSaveEligibility::Waiting;
        };
        match self.frame {
            LoginFrameContext::Embedded => return LoginSaveEligibility::Waiting,
            LoginFrameContext::TopLevel => {}
        }
        self.transition_eligibility()
    }

    fn transition_eligibility(&self) -> LoginSaveEligibility {
        match self.transition {
            LoginSubmissionTransition::None => LoginSaveEligibility::Waiting,
            LoginSubmissionTransition::DocumentNavigation
            | LoginSubmissionTransition::SameDocumentNavigation => LoginSaveEligibility::Eligible,
            LoginSubmissionTransition::SameDocumentMutation => {
                match (self.controls.baseline, self.controls.current) {
                    (
                        AuthenticatedControlEvidence::Absent,
                        AuthenticatedControlEvidence::Present,
                    ) => LoginSaveEligibility::Eligible,
                    (
                        AuthenticatedControlEvidence::Present,
                        AuthenticatedControlEvidence::Present
                        | AuthenticatedControlEvidence::Absent,
                    )
                    | (
                        AuthenticatedControlEvidence::Absent,
                        AuthenticatedControlEvidence::Absent,
                    ) => LoginSaveEligibility::Waiting,
                }
            }
        }
    }

    fn waiting(&self) -> LoginSaveEligibility {
        let true = self
            .elapsed_ms
            .has_reached(DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS)
        else {
            return LoginSaveEligibility::Waiting;
        };
        LoginSaveEligibility::Expired
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture;

    impl Fixture {
        fn successful_transition() -> Result<LoginSaveOutcomeObservation, LoginObservationError> {
            Ok(LoginSaveOutcomeObservation {
                observation: AuthenticationOutcomeObservation {
                    same_document_mutation: true,
                    elapsed_ms: 1_000.into(),
                    ..Default::default()
                },
                submission: LoginSubmissionPresence::Captured,
                captured_workflow: AuthenticationWorkflowKind::Login,
                origin: LoginSubmissionOrigin::SameOrigin,
                no_auth_elapsed_ms: 750.into(),
                initial_auth_fields: LoginAuthFieldPresence::Present,
                transition: LoginSubmissionTransition::SameDocumentMutation,
                checkpoint: LoginManualCheckpoint::Clear,
                baseline_controls: vec![LoginControlLabel::try_from("Sign in".to_owned())?],
                current_controls: vec![LoginControlLabel::try_from("Sign Out".to_owned())?],
            })
        }
    }

    #[test]
    fn admits_generic_submitted_spa_transition_without_custom_marker() -> anyhow::Result<()> {
        let observed = Fixture::successful_transition()?;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Eligible
        );
        Ok(())
    }

    #[test]
    fn navigation_requires_new_authenticated_ui_and_disappearing_authentication()
    -> anyhow::Result<()> {
        let mut observed = Fixture::successful_transition()?;
        observed.transition = LoginSubmissionTransition::DocumentNavigation;
        observed.observation.same_document_mutation = false;
        observed.observation.navigated_away_from_auth_path = true;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Eligible
        );
        observed.current_controls.clear();
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Eligible
        );
        Ok(())
    }

    #[test]
    fn baseline_authenticated_ui_cannot_be_reused_as_login_evidence() -> anyhow::Result<()> {
        let mut observed = Fixture::successful_transition()?;
        observed.baseline_controls = observed.current_controls.clone();
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        Ok(())
    }

    #[test]
    fn typing_fill_disabled_replaced_or_toggled_inputs_do_not_prove_a_login() -> anyhow::Result<()>
    {
        let mut observed = Fixture::successful_transition()?;
        observed.submission = LoginSubmissionPresence::Absent;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        observed.submission = LoginSubmissionPresence::Captured;
        observed.transition = LoginSubmissionTransition::None;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        observed.transition = LoginSubmissionTransition::SameDocumentMutation;
        observed.observation.auth_fields_present = true;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        observed.observation.auth_fields_present = false;
        observed.initial_auth_fields = LoginAuthFieldPresence::Absent;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        Ok(())
    }

    #[test]
    fn otp_captcha_manual_checkpoint_and_errors_veto_save() -> anyhow::Result<()> {
        let mut observed = Fixture::successful_transition()?;
        observed.checkpoint = LoginManualCheckpoint::Pending;
        observed.observation.success_marker_present = true;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        observed.checkpoint = LoginManualCheckpoint::Clear;
        observed.observation.error_marker_present = true;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Rejected
        );
        observed.observation.success_marker_present = false;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Rejected
        );
        observed.current_controls.clear();
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Rejected
        );
        Ok(())
    }

    #[test]
    fn late_evidence_and_generic_iframe_observations_remain_unavailable() -> anyhow::Result<()> {
        let mut observed = Fixture::successful_transition()?;
        observed.observation.elapsed_ms = 8_000.into();
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Eligible
        );
        observed.current_controls.clear();
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Expired
        );
        observed.observation.elapsed_ms = 1_000.into();
        observed.observation.in_iframe = true;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        for elapsed in [750, 1_000, 8_000] {
            observed.observation.elapsed_ms = elapsed.into();
            observed.no_auth_elapsed_ms = 750.into();
            for marker in [false, true] {
                observed.observation.success_marker_present = marker;
                assert_eq!(
                    observed.classify()?.eligibility,
                    match elapsed {
                        8_000 => LoginSaveEligibility::Expired,
                        _ => LoginSaveEligibility::Waiting,
                    }
                );
            }
        }
        observed.observation.elapsed_ms = 1_000.into();
        observed.observation.in_iframe = false;
        observed.observation.success_marker_present = true;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        Ok(())
    }

    #[test]
    fn already_present_marker_cannot_admit_pure_removal_or_uncorroborated_mutation()
    -> anyhow::Result<()> {
        let mut observed = Fixture::successful_transition()?;
        observed.observation.success_marker_present = true;
        observed.current_controls.clear();
        for transition in [
            LoginSubmissionTransition::None,
            LoginSubmissionTransition::SameDocumentMutation,
        ] {
            observed.transition = transition;
            for elapsed in [1_000, 8_000] {
                observed.observation.elapsed_ms = elapsed.into();
                assert_eq!(
                    observed.classify()?.eligibility,
                    match elapsed {
                        8_000 => LoginSaveEligibility::Expired,
                        _ => LoginSaveEligibility::Waiting,
                    }
                );
            }
        }
        observed.observation.elapsed_ms = 1_000.into();
        observed.current_controls = vec![LoginControlLabel::try_from("Sign out".to_owned())?];
        observed.baseline_controls = observed.current_controls.clone();
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        observed.current_controls.clear();
        observed.transition = LoginSubmissionTransition::SameDocumentNavigation;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Eligible
        );
        Ok(())
    }

    #[test]
    fn bounded_control_labels_require_semantic_actions() -> anyhow::Result<()> {
        let mut observed = Fixture::successful_transition()?;
        for label in [
            "Logged out",
            "Sign out information",
            "My account",
            "Account balance",
            "Do not log out",
        ] {
            observed.current_controls = vec![LoginControlLabel::try_from(label.to_owned())?];
            assert_eq!(
                observed.classify()?.eligibility,
                LoginSaveEligibility::Waiting
            );
        }
        observed.current_controls = vec![LoginControlLabel::try_from(" LOG-OFF ".to_owned())?];
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Eligible
        );
        observed.current_controls = vec![LoginControlLabel::try_from("Sign out".to_owned())?; 65];
        assert_eq!(
            observed.classify(),
            Err(LoginObservationError::TooManyControls)
        );
        assert_eq!(
            LoginControlLabel::try_from("x".repeat(513)),
            Err(LoginObservationError::ControlLabelTooLong)
        );
        Ok(())
    }

    #[test]
    fn stability_and_original_capture_timing_are_required() -> anyhow::Result<()> {
        let mut observed = Fixture::successful_transition()?;
        observed.no_auth_elapsed_ms = 749.into();
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Waiting
        );
        observed.no_auth_elapsed_ms = 1_001.into();
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Rejected
        );
        observed.no_auth_elapsed_ms = 750.into();
        observed.origin = LoginSubmissionOrigin::ChangedOrigin;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Rejected
        );
        observed.origin = LoginSubmissionOrigin::SameOrigin;
        observed.captured_workflow = AuthenticationWorkflowKind::Signup;
        assert_eq!(
            observed.classify()?.eligibility,
            LoginSaveEligibility::Rejected
        );
        Ok(())
    }
}
