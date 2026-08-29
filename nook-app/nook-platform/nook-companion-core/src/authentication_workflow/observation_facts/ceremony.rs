use super::AuthenticationFieldObservationFacts;
use crate::authentication_workflow::{
    AuthenticationAdvanceControlEvidence, AuthenticationManualCheckpoint,
    AuthenticationOneTimeCodeProgressionEvidence,
};
use crate::page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    AuthenticationUsernameEvidence, has_safe_authentication_route_identity,
    has_safe_credential_update_route_identity, looks_like_one_time_code_auto_submit_signal,
    one_time_code_ceremony_context_is_authenticated,
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
        .all(|value| {
            value.len() <= crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
        })
    }

    pub(super) fn is_authenticated(&self, fields: AuthenticationFieldObservationFacts) -> bool {
        fields.one_time_code_field_count > 0
            && fields.current_password_field_count == 0
            && fields.new_password_field_count == 0
            && fields.generic_password_field_count == 0
            && (fields.username_field_count > 0)
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
}

impl AuthenticationCeremonyObservationFacts {
    pub(super) fn is_bounded(&self) -> bool {
        self.one_time_code_handler_signal.len()
            <= crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.one_time_code_handler_signals.len()
                <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize
            && self.one_time_code_handler_signals.iter().all(|signal| {
                signal.len()
                    <= crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            })
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
        ) && fields.one_time_code_field_count == 0
            && [
                fields.current_password_field_count,
                fields.generic_password_field_count,
                fields.new_password_field_count,
                fields.username_field_count,
            ]
            .into_iter()
            .any(|count| count > 0)
            && (fields.username_field_count > 0)
                != matches!(
                    self.authentication_context.authentication_username,
                    AuthenticationUsernameEvidence::Absent
                )
            && self.authentication_context.is_bounded()
            && if fields.new_password_field_count > 0 {
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
                )
            }
    }
}
