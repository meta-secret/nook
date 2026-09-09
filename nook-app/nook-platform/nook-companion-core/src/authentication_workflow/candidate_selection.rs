//! Selection policy for bounded browser authentication observations.

use super::{
    AuthenticationPageObservation, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowMatch, AuthenticationWorkflowObservationIndex,
    AuthenticationWorkflowSnapshot,
};
use serde::{Deserialize, Serialize, de::Error as _};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Tsify)]
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
    pub(crate) const fn value(self) -> u8 {
        self.0
    }
}

impl From<AuthenticationFormObservationPriority> for u8 {
    fn from(value: AuthenticationFormObservationPriority) -> Self {
        value.value()
    }
}

impl Default for AuthenticationFormObservationPriority {
    fn default() -> Self {
        Self::USERNAME_OR_PASSKEY_ONLY
    }
}

impl<'de> Deserialize<'de> for AuthenticationFormObservationPriority {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        match u8::deserialize(deserializer)? {
            1 => Ok(Self::USERNAME_OR_PASSKEY_ONLY),
            2 => Ok(Self::PASSWORD_FORM),
            3 => Ok(Self::GENERIC_PASSWORD),
            4 => Ok(Self::CURRENT_PASSWORD),
            5 => Ok(Self::ONE_TIME_CODE),
            value => Err(D::Error::custom(format!(
                "invalid authentication form observation priority: {value}"
            ))),
        }
    }
}

impl AuthenticationPageObservation {
    /// Rank one browser form observation before the host applies its bounded scan.
    #[must_use]
    pub const fn form_priority(self) -> AuthenticationFormObservationPriority {
        if self.one_time_code_field_count.is_nonzero() {
            AuthenticationFormObservationPriority::ONE_TIME_CODE
        } else if self.current_password_field_count.is_nonzero() {
            AuthenticationFormObservationPriority::CURRENT_PASSWORD
        } else if self.generic_password_field_count.is_single() {
            AuthenticationFormObservationPriority::GENERIC_PASSWORD
        } else if self.password_field_count().is_nonzero() {
            AuthenticationFormObservationPriority::PASSWORD_FORM
        } else {
            AuthenticationFormObservationPriority::USERNAME_OR_PASSKEY_ONLY
        }
    }
}

impl AuthenticationWorkflowSnapshot {
    const fn candidate_priority(self) -> AuthenticationWorkflowCandidatePriority {
        match (self.kind, self.action) {
            (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowAction::SaveBackupCodes,
            ) => AuthenticationWorkflowCandidatePriority::RecoveryEnrollment,
            (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowAction::EnrollAuthenticator,
            ) => AuthenticationWorkflowCandidatePriority::Enrollment,
            (AuthenticationWorkflowKind::TotpEnrollment, _) => {
                AuthenticationWorkflowCandidatePriority::VerificationOrChallenge
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
    RecoveryEnrollment,
    SecondFactorOrPasskeyUse,
    Enrollment,
    VerificationOrChallenge,
}

/// Rank a browser form observation for a bounded host scan.
impl AuthenticationPageObservation {
    #[must_use]
    pub const fn authentication_form_observation_priority(
        self,
    ) -> AuthenticationFormObservationPriority {
        let observation = self;
        observation.form_priority()
    }
}

/// Select the highest-priority valid workflow candidate in observation order.
impl AuthenticationWorkflowMatch {
    /// Keep the first candidate at the highest priority. Rejection of the
    /// selection is terminal; an individual rejected candidate is ignored.
    #[must_use]
    fn select_candidate(self, candidate: Self) -> Self {
        match (self, candidate) {
            (Self::Rejected, _) => Self::Rejected,
            (selected, Self::NoMatch | Self::Rejected) => selected,
            (Self::NoMatch, candidate @ Self::Matched(_)) => candidate,
            (Self::Matched(current), Self::Matched(candidate)) => {
                if candidate.candidate_priority() > current.candidate_priority() {
                    Self::Matched(candidate)
                } else {
                    Self::Matched(current)
                }
            }
        }
    }

    /// Attribute a detected workflow to its source without manufacturing a match.
    #[must_use]
    const fn with_observation_index(self, index: AuthenticationWorkflowObservationIndex) -> Self {
        match self {
            Self::Matched(mut snapshot) => {
                snapshot.observation_index = index;
                Self::Matched(snapshot)
            }
            Self::NoMatch => Self::NoMatch,
            Self::Rejected => Self::Rejected,
        }
    }

    #[must_use]
    pub fn classify_authentication_workflow_candidates(
        observations: &[AuthenticationPageObservation],
    ) -> AuthenticationWorkflowMatch {
        if !AuthenticationPageObservation::authentication_page_observations_are_valid(observations)
        {
            return AuthenticationWorkflowMatch::Rejected;
        }

        observations.iter().copied().enumerate().fold(
            Self::NoMatch,
            |selected, (index, observation)| {
                let candidate = observation
                    .classify_authentication_workflow()
                    .with_observation_index(AuthenticationWorkflowObservationIndex(
                        u32::try_from(index).unwrap_or(u32::MAX),
                    ));
                selected.select_candidate(candidate)
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct CandidateSelectionScenario {
        selected: AuthenticationWorkflowMatch,
        candidate: AuthenticationWorkflowMatch,
        expected: AuthenticationWorkflowMatch,
    }

    impl CandidateSelectionScenario {
        fn assert_selection(self) {
            assert_eq!(
                self.selected.select_candidate(self.candidate),
                self.expected
            );
        }
    }

    #[test]
    fn selection_retains_rejection_and_first_equal_priority_candidate() {
        let first = AuthenticationPageObservation {
            new_password_field_count: 1.into(),
            ..Default::default()
        }
        .classify_authentication_workflow()
        .with_observation_index(3.into());
        let tied = first.with_observation_index(7.into());
        let higher = AuthenticationPageObservation {
            one_time_code_field_count: 1.into(),
            ..Default::default()
        }
        .classify_authentication_workflow()
        .with_observation_index(9.into());
        for (selected, candidate, expected) in [
            (AuthenticationWorkflowMatch::NoMatch, first, first),
            (first, AuthenticationWorkflowMatch::NoMatch, first),
            (first, AuthenticationWorkflowMatch::Rejected, first),
            (
                AuthenticationWorkflowMatch::Rejected,
                first,
                AuthenticationWorkflowMatch::Rejected,
            ),
            (
                AuthenticationWorkflowMatch::NoMatch,
                AuthenticationWorkflowMatch::Rejected,
                AuthenticationWorkflowMatch::NoMatch,
            ),
            (
                AuthenticationWorkflowMatch::Rejected,
                AuthenticationWorkflowMatch::NoMatch,
                AuthenticationWorkflowMatch::Rejected,
            ),
            (
                AuthenticationWorkflowMatch::Rejected,
                AuthenticationWorkflowMatch::Rejected,
                AuthenticationWorkflowMatch::Rejected,
            ),
            (
                AuthenticationWorkflowMatch::NoMatch,
                AuthenticationWorkflowMatch::NoMatch,
                AuthenticationWorkflowMatch::NoMatch,
            ),
            (first, tied, first),
            (first, higher, higher),
            (higher, first, higher),
        ] {
            CandidateSelectionScenario {
                selected,
                candidate,
                expected,
            }
            .assert_selection();
        }
        assert_eq!(
            AuthenticationWorkflowMatch::NoMatch.with_observation_index(4.into()),
            AuthenticationWorkflowMatch::NoMatch
        );
        assert_eq!(
            AuthenticationWorkflowMatch::Rejected.with_observation_index(4.into()),
            AuthenticationWorkflowMatch::Rejected
        );
    }

    #[test]
    fn priority_default_and_deserialization_stay_within_the_closed_ranking() -> anyhow::Result<()> {
        assert_eq!(AuthenticationFormObservationPriority::default().value(), 1);

        for value in 1..=5 {
            let priority =
                serde_json::from_str::<AuthenticationFormObservationPriority>(&value.to_string())?;
            assert_eq!(priority.value(), value);
        }
        for unsupported in [0, 6, u8::MAX] {
            assert!(
                serde_json::from_str::<AuthenticationFormObservationPriority>(
                    &unsupported.to_string()
                )
                .is_err()
            );
        }
        Ok(())
    }

    #[test]
    fn signup_help_outranks_manual_passkey_login_takeover() -> anyhow::Result<()> {
        let signup = AuthenticationPageObservation {
            new_password_field_count: 1.into(),
            ..Default::default()
        };
        let manual_login = AuthenticationPageObservation {
            passkey_control_present: true,
            manual_checkpoint_present: true,
            ..Default::default()
        };

        for (observations, expected_index) in
            [([signup, manual_login], 0), ([manual_login, signup], 1)]
        {
            let snapshot =
                AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(
                    &observations,
                )
                .snapshot()?;
            assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Signup);
            assert_eq!(
                snapshot.action,
                AuthenticationWorkflowAction::GeneratePassword
            );
            assert_eq!(u32::from(snapshot.observation_index), expected_index);
        }
        Ok(())
    }

    #[test]
    fn active_otp_verification_outranks_page_wide_enrollment_copy() -> anyhow::Result<()> {
        let otp = AuthenticationPageObservation {
            one_time_code_field_count: 1.into(),
            authenticator_setup_hint: true,
            backup_codes_hint: true,
            ..Default::default()
        };
        let recovery = AuthenticationPageObservation {
            username_field_count: 1.into(),
            authenticator_setup_hint: true,
            backup_codes_hint: true,
            ..Default::default()
        };
        let snapshot = AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(&[
            recovery, otp,
        ])
        .snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpEnrollment);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::FillTotp);
        assert_eq!(u32::from(snapshot.observation_index), 1);
        Ok(())
    }
}
