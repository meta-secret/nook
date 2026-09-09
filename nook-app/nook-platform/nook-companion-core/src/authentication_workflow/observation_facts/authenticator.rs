use super::{
    AuthenticationDetailedPasskeyControlObservation, AuthenticationFieldObservationFacts,
    AuthenticationPasskeyControlObservation,
};
use crate::AuthenticationPasskeyAccountCount;
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
    pub candidate_present: bool,
}

impl AuthenticationBackupCodesObservation {
    #[must_use]
    pub fn classify_authentication_backup_codes_observation(
        request: AuthenticationBackupCodesEvidence<'_>,
    ) -> AuthenticationBackupCodesObservation {
        let AuthenticationBackupCodesEvidence {
            text,
            candidate_present,
        } = request;
        let normalized = text.to_ascii_lowercase();
        let recovery_subject = ["backup codes", "recovery codes", "emergency codes"]
            .iter()
            .any(|phrase| normalized.contains(phrase));
        let preservation_instruction = [
            "save",
            "store",
            "keep",
            "download",
            "print",
            "copy",
            "generated",
        ]
        .iter()
        .any(|word| {
            normalized
                .split(|c: char| !c.is_ascii_alphanumeric())
                .any(|token| token == *word)
        });
        if recovery_subject && (preservation_instruction || candidate_present) {
            AuthenticationBackupCodesObservation::Present
        } else {
            AuthenticationBackupCodesObservation::Absent
        }
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
                    candidate_present: false
                }
            ),
            AuthenticationBackupCodesObservation::Present
        )
    }

    pub(super) fn is_bounded(&self) -> bool {
        self.backup_codes_copy.len() <= crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.matching_passkey_account_count.raw()
                <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
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
            .is_safe_for_fields(Some(fields))
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
                    candidate_present: false
                }
            ),
            AuthenticationBackupCodesObservation::Absent
        );
        assert_eq!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: "Save your backup codes in a secure place",
                    candidate_present: false
                }
            ),
            AuthenticationBackupCodesObservation::Present
        );
        assert_eq!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: "Backup codes",
                    candidate_present: true
                }
            ),
            AuthenticationBackupCodesObservation::Present
        );
        for ordinary_otp in ["Authenticator code\n123456", "One-time code\n123456"] {
            assert_eq!(
                AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(AuthenticationBackupCodesEvidence { text: ordinary_otp, candidate_present: false }),
                AuthenticationBackupCodesObservation::Absent
            );
        }
    }
}
