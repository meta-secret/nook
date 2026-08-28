use super::{
    AuthenticationPageObservation, AuthenticationPageObservations, AuthenticationWorkflowAction,
    AuthenticationWorkflowKind, AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot,
    authentication_page_observations_are_valid, classify_authentication_workflow,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize, Tsify,
)]
#[serde(transparent)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationFormObservationPriority(u8);

impl AuthenticationFormObservationPriority {
    const USERNAME_OR_PASSKEY_ONLY: Self = Self(1);
    const PASSWORD_FORM: Self = Self(2);
    const GENERIC_PASSWORD: Self = Self(3);
    const CURRENT_PASSWORD: Self = Self(4);
    const ONE_TIME_CODE: Self = Self(5);

    #[must_use]
    pub const fn value(self) -> u8 {
        self.0
    }
}

impl AuthenticationPageObservation {
    /// Rank one browser form observation before the host applies its bounded scan.
    #[must_use]
    pub const fn form_priority(self) -> AuthenticationFormObservationPriority {
        if self.one_time_code_field_count > 0 {
            AuthenticationFormObservationPriority::ONE_TIME_CODE
        } else if self.current_password_field_count > 0 {
            AuthenticationFormObservationPriority::CURRENT_PASSWORD
        } else if self.generic_password_field_count == 1 {
            AuthenticationFormObservationPriority::GENERIC_PASSWORD
        } else if self.password_field_count() > 0 {
            AuthenticationFormObservationPriority::PASSWORD_FORM
        } else {
            AuthenticationFormObservationPriority::USERNAME_OR_PASSKEY_ONLY
        }
    }
}

impl AuthenticationWorkflowSnapshot {
    const fn candidate_priority(self) -> AuthenticationWorkflowCandidatePriority {
        match (self.kind, self.action) {
            (AuthenticationWorkflowKind::TotpEnrollment, _) => {
                AuthenticationWorkflowCandidatePriority::Enrollment
            }
            (AuthenticationWorkflowKind::TotpChallenge, _)
            | (AuthenticationWorkflowKind::Login, AuthenticationWorkflowAction::UsePasskey) => {
                AuthenticationWorkflowCandidatePriority::SecondFactorOrPasskeyUse
            }
            (AuthenticationWorkflowKind::Login, AuthenticationWorkflowAction::ContinueWithNook) => {
                AuthenticationWorkflowCandidatePriority::SavedLogin
            }
            (AuthenticationWorkflowKind::Login, AuthenticationWorkflowAction::CreatePasskey)
            | (AuthenticationWorkflowKind::PasswordChange, _)
            | (AuthenticationWorkflowKind::Signup, AuthenticationWorkflowAction::UsePasskey) => {
                AuthenticationWorkflowCandidatePriority::CredentialChangeOrPasskeySetup
            }
            (AuthenticationWorkflowKind::Signup, _) => {
                AuthenticationWorkflowCandidatePriority::Signup
            }
            (AuthenticationWorkflowKind::Login, _) => {
                AuthenticationWorkflowCandidatePriority::Login
            }
            (AuthenticationWorkflowKind::Manual, _) => {
                AuthenticationWorkflowCandidatePriority::Manual
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum AuthenticationWorkflowCandidatePriority {
    Manual,
    Login,
    Signup,
    CredentialChangeOrPasskeySetup,
    SavedLogin,
    SecondFactorOrPasskeyUse,
    Enrollment,
}

impl AuthenticationPageObservations {
    #[must_use]
    pub fn classify(&self) -> AuthenticationWorkflowMatch {
        if !authentication_page_observations_are_valid(&self.observations) {
            return AuthenticationWorkflowMatch::Rejected;
        }

        let mut selected = AuthenticationWorkflowMatch::NoMatch;
        for (index, observation) in self.observations.iter().copied().enumerate() {
            let AuthenticationWorkflowMatch::Matched(mut candidate) =
                classify_authentication_workflow(observation)
            else {
                continue;
            };
            candidate.observation_index = u32::try_from(index).unwrap_or(u32::MAX);
            let replace = match selected {
                AuthenticationWorkflowMatch::NoMatch => true,
                AuthenticationWorkflowMatch::Rejected => false,
                AuthenticationWorkflowMatch::Matched(current) => {
                    candidate.candidate_priority() > current.candidate_priority()
                }
            };
            if replace {
                selected = AuthenticationWorkflowMatch::Matched(candidate);
            }
        }
        selected
    }
}
