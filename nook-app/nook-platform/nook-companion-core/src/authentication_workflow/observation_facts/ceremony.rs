use super::AuthenticationFieldObservationFacts;
use crate::authentication_workflow::{
    AuthenticationAdvanceControlEvidence, AuthenticationManualCheckpoint,
    AuthenticationOneTimeCodeProgressionEvidence,
};
use crate::page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    looks_like_one_time_code_auto_submit_signal,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Detailed browser evidence for the control selected to advance authentication.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "observation", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationDetailedAdvanceControlObservation {
    #[default]
    Absent,
    Observed(AuthenticationAdvanceControlObservation),
}

impl AuthenticationDetailedAdvanceControlObservation {
    pub(super) fn evidence(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> AuthenticationAdvanceControlEvidence {
        match self {
            Self::Observed(observation)
                if observation.is_bounded()
                    && fields.is_compatible_with_detailed_control(observation)
                    && matches!(
                        observation.classify(),
                        AuthenticationAdvanceControlDecision::AdvancesAuthentication
                    ) =>
            {
                AuthenticationAdvanceControlEvidence::Present
            }
            Self::Absent | Self::Observed(_) => AuthenticationAdvanceControlEvidence::Absent,
        }
    }

    pub(super) fn is_bounded(&self) -> bool {
        matches!(self, Self::Absent)
            || matches!(self, Self::Observed(observation) if observation.is_bounded())
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
    pub manual_checkpoint: AuthenticationManualCheckpoint,
    pub advance_control: AuthenticationAdvanceControlEvidence,
}

impl AuthenticationCeremonyObservationFacts {
    pub(super) fn is_bounded(&self) -> bool {
        self.one_time_code_handler_signal.len()
            <= crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
    }

    pub(super) fn derived_one_time_code_progression(
        &self,
        has_trusted_authentication_context: bool,
    ) -> AuthenticationOneTimeCodeProgressionEvidence {
        if !self.is_bounded() || !has_trusted_authentication_context {
            return AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired;
        }
        if looks_like_one_time_code_auto_submit_signal(&self.one_time_code_handler_signal) {
            AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved
        } else {
            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
        }
    }
}
