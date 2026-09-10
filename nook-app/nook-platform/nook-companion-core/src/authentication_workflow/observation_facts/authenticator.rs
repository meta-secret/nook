use super::passkey::PasskeyFieldContext;
use super::{
    AuthenticationDetailedPasskeyControlObservation, AuthenticationFieldObservationFacts,
    AuthenticationPasskeyControlObservation,
};
use crate::AuthenticationPasskeyAccountCount;
use crate::BackupCodeCandidatePresence;
use crate::recovery_code_language::RecoveryCopyRecognition;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationAuthenticatorSetupObservation {
    #[default]
    Absent,
    Present,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationBackupCodesObservation {
    #[default]
    Absent,
    /// Visible recovery-code issuance or preservation copy.
    Present,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationPasskeyAccountAvailability {
    #[default]
    Unavailable,
    Ready,
}

/// Classify non-secret recovery copy before consent. Candidate extraction is deferred
/// until the user approves the save action.
/// Named values required by AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation.
pub struct AuthenticationBackupCodesEvidence<'a> {
    pub text: &'a str,
    pub candidate_presence: BackupCodeCandidatePresence,
}

impl AuthenticationBackupCodesObservation {
    #[must_use]
    pub fn classify_authentication_backup_codes_observation(
        request: AuthenticationBackupCodesEvidence<'_>,
    ) -> AuthenticationBackupCodesObservation {
        RecoveryCopyRecognition::from_text(request.text).classify(request.candidate_presence)
    }
}

/// Raw, non-secret authenticator and passkey facts for one authentication scope.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationAuthenticatorObservationFacts {
    pub authenticator_setup: AuthenticationAuthenticatorSetupObservation,
    /// Bounded, non-secret heading/action copy; recovery candidates are never transported here.
    pub backup_codes_copy: String,
    pub passkey_control: AuthenticationPasskeyControlObservation,
    pub passkey_account_availability: AuthenticationPasskeyAccountAvailability,
    pub matching_passkey_account_count: AuthenticationPasskeyAccountCount,
    /// Detailed evidence is classified in Rust; the legacy presence flag is ignored.
    #[serde(default)]
    pub detailed_passkey_control: AuthenticationDetailedPasskeyControlObservation,
}

impl AuthenticationAuthenticatorObservationFacts {
    pub(super) const fn authenticator_setup_hint(&self) -> bool {
        matches!(
            self.authenticator_setup,
            AuthenticationAuthenticatorSetupObservation::Present
        )
    }

    pub(super) fn backup_codes_hint(&self) -> bool {
        matches!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: &self.backup_codes_copy,
                    candidate_presence: BackupCodeCandidatePresence::Absent
                }
            ),
            AuthenticationBackupCodesObservation::Present
        )
    }

    pub(super) fn is_bounded(&self) -> bool {
        self.backup_codes_copy.len() <= crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self
                .matching_passkey_account_count
                .is_within_observation_limit()
            && self.detailed_passkey_control.is_bounded()
    }

    pub(super) fn passkey_control_present(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        matches!(
            self.passkey_account_availability,
            AuthenticationPasskeyAccountAvailability::Ready
        ) && self
            .detailed_passkey_control
            .is_safe_for_fields(PasskeyFieldContext::Observed(fields))
    }

    pub(super) const fn matching_passkey_account_count(&self) -> AuthenticationPasskeyAccountCount {
        if matches!(
            self.passkey_account_availability,
            AuthenticationPasskeyAccountAvailability::Ready
        ) {
            self.matching_passkey_account_count
        } else {
            AuthenticationPasskeyAccountCount::ZERO
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_code_observation_requires_recovery_preservation_copy() {
        assert_eq!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: "Use a backup code instead",
                    candidate_presence: BackupCodeCandidatePresence::Absent
                }
            ),
            AuthenticationBackupCodesObservation::Absent
        );
        assert_eq!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: "Save your backup codes in a secure place",
                    candidate_presence: BackupCodeCandidatePresence::Absent
                }
            ),
            AuthenticationBackupCodesObservation::Present
        );
        assert_eq!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: "Backup codes",
                    candidate_presence: BackupCodeCandidatePresence::Present
                }
            ),
            AuthenticationBackupCodesObservation::Present
        );
        for ordinary_otp in ["Authenticator code\n123456", "One-time code\n123456"] {
            assert_eq!(
                AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(AuthenticationBackupCodesEvidence { text: ordinary_otp, candidate_presence: BackupCodeCandidatePresence::Absent }),
                AuthenticationBackupCodesObservation::Absent
            );
        }
    }
}
