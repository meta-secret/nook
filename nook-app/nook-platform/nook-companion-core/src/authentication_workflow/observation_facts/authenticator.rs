use super::{
    AuthenticationDetailedPasskeyControlObservation, AuthenticationPasskeyControlObservation,
};
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
#[must_use]
pub fn classify_authentication_backup_codes_observation(
    text: &str,
) -> AuthenticationBackupCodesObservation {
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
    if recovery_subject && preservation_instruction {
        AuthenticationBackupCodesObservation::Present
    } else {
        AuthenticationBackupCodesObservation::Absent
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
    #[serde(default)]
    pub passkey_account_availability: AuthenticationPasskeyAccountAvailability,
    pub matching_passkey_account_count: u32,
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
            classify_authentication_backup_codes_observation(&self.backup_codes_copy),
            AuthenticationBackupCodesObservation::Present
        )
    }

    pub(super) fn is_bounded(&self) -> bool {
        self.backup_codes_copy.len() <= crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.matching_passkey_account_count <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
            && self.detailed_passkey_control.is_bounded()
    }

    pub(super) fn passkey_control_present(&self) -> bool {
        matches!(
            self.passkey_account_availability,
            AuthenticationPasskeyAccountAvailability::Ready
        ) && self.detailed_passkey_control.is_safe()
    }

    pub(super) const fn matching_passkey_account_count(&self) -> u32 {
        if matches!(
            self.passkey_account_availability,
            AuthenticationPasskeyAccountAvailability::Ready
        ) {
            self.matching_passkey_account_count
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_code_observation_requires_recovery_preservation_copy() {
        assert_eq!(
            classify_authentication_backup_codes_observation("Use a backup code instead"),
            AuthenticationBackupCodesObservation::Absent
        );
        assert_eq!(
            classify_authentication_backup_codes_observation(
                "Save your backup codes in a secure place"
            ),
            AuthenticationBackupCodesObservation::Present
        );
        for ordinary_otp in ["Authenticator code\n123456", "One-time code\n123456"] {
            assert_eq!(
                classify_authentication_backup_codes_observation(ordinary_otp),
                AuthenticationBackupCodesObservation::Absent
            );
        }
    }
}
