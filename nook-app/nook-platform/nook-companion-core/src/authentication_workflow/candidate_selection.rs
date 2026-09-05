//! Selection policy for bounded browser authentication observations.

use super::{
    AuthenticationPageObservation, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot,
    authentication_page_observations_are_valid, classify_authentication_workflow,
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
        if self.one_time_code_field_count.raw() > 0 {
            AuthenticationFormObservationPriority::ONE_TIME_CODE
        } else if self.current_password_field_count.raw() > 0 {
            AuthenticationFormObservationPriority::CURRENT_PASSWORD
        } else if self.generic_password_field_count.raw() == 1 {
            AuthenticationFormObservationPriority::GENERIC_PASSWORD
        } else if self.password_field_count().raw() > 0 {
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
#[must_use]
pub const fn authentication_form_observation_priority(
    observation: AuthenticationPageObservation,
) -> AuthenticationFormObservationPriority {
    observation.form_priority()
}

/// Select the highest-priority valid workflow candidate in observation order.
#[must_use]
pub fn classify_authentication_workflow_candidates(
    observations: &[AuthenticationPageObservation],
) -> AuthenticationWorkflowMatch {
    if !authentication_page_observations_are_valid(observations) {
        return AuthenticationWorkflowMatch::Rejected;
    }

    let mut selected = AuthenticationWorkflowMatch::NoMatch;
    for (index, observation) in observations.iter().copied().enumerate() {
        let AuthenticationWorkflowMatch::Matched(mut candidate) =
            classify_authentication_workflow(observation)
        else {
            continue;
        };
        candidate.observation_index = super::AuthenticationWorkflowObservationIndex::from_raw(
            u32::try_from(index).unwrap_or(u32::MAX),
        );
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

#[cfg(test)]
mod tests {
    use super::*;

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
            let snapshot = classify_authentication_workflow_candidates(&observations).snapshot()?;
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
        let snapshot = classify_authentication_workflow_candidates(&[recovery, otp]).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpEnrollment);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::FillTotp);
        assert_eq!(u32::from(snapshot.observation_index), 1);
        Ok(())
    }
}
