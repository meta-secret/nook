use super::AuthenticationFieldObservationFacts;
use crate::authentication_workflow::{
    AuthenticationAdvanceControlEvidence, AuthenticationManualCheckpoint,
    AuthenticationOneTimeCodeProgressionEvidence,
};
use crate::page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    AuthenticationUsernameEvidence, looks_like_one_time_code_auto_submit_signal,
    one_time_code_ceremony_context_is_authenticated,
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
    /// Authentication-scope evidence used when the OTP handler replaces a separate control.
    #[serde(default)]
    pub authentication_context: AuthenticationCeremonyContextObservation,
    pub manual_checkpoint: AuthenticationManualCheckpoint,
    pub advance_control: AuthenticationAdvanceControlEvidence,
}

impl AuthenticationCeremonyObservationFacts {
    pub(super) fn is_bounded(&self) -> bool {
        self.one_time_code_handler_signal.len()
            <= crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.authentication_context.is_bounded()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn context(
        form_identity: &str,
        destination_identity: &str,
    ) -> AuthenticationCeremonyContextObservation {
        AuthenticationCeremonyContextObservation {
            authentication_username: AuthenticationUsernameEvidence::Absent,
            source_origin: "https://example.test".to_owned(),
            form_identity: form_identity.to_owned(),
            destination_identity: destination_identity.to_owned(),
        }
    }

    fn one_time_code_fields() -> AuthenticationFieldObservationFacts {
        AuthenticationFieldObservationFacts {
            one_time_code_field_count: 1,
            ..Default::default()
        }
    }

    #[test]
    fn authenticates_control_less_one_time_code_context_fail_closed() {
        let fields = one_time_code_fields();
        assert!(context("otp-challenge", "/verify").is_authenticated(fields));
        assert!(!context("account-confirmation", "/confirm?next=/otp").is_authenticated(fields));
        assert!(!context("transaction-confirmation", "/transfer").is_authenticated(fields));
        assert!(!context("otp-challenge", "https://evil.example/verify").is_authenticated(fields));
        assert!(!context("otp-challenge", "/verify#%ZZ").is_authenticated(fields));
    }
}
