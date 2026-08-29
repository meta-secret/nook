use super::{
    AuthenticationDetailedPasskeyControlObservation, AuthenticationFieldObservationFacts,
    AuthenticationPasskeyControlObservation,
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
    /// Visible recovery material with at least one Rust-extracted backup-code candidate.
    Present,
}

/// Require both recovery copy and an extracted candidate before exposing a save action.
#[must_use]
pub fn classify_authentication_backup_codes_observation(
    text: &str,
) -> AuthenticationBackupCodesObservation {
    if crate::page_has_backup_code_hint(text)
        && !crate::extract_backup_code_candidates(text).is_empty()
    {
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
    pub backup_codes: AuthenticationBackupCodesObservation,
    pub passkey_control: AuthenticationPasskeyControlObservation,
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

    pub(super) const fn backup_codes_hint(&self) -> bool {
        matches!(
            self.backup_codes,
            AuthenticationBackupCodesObservation::Present
        )
    }

    pub(super) fn passkey_control_present(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        self.detailed_passkey_control
            .is_safe_for_fields(Some(fields))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_code_observation_requires_an_extracted_candidate() {
        assert_eq!(
            classify_authentication_backup_codes_observation("Use a backup code instead"),
            AuthenticationBackupCodesObservation::Absent
        );
        assert_eq!(
            classify_authentication_backup_codes_observation(
                "Save your backup codes\nA1B2-C3D4-E5F6"
            ),
            AuthenticationBackupCodesObservation::Present
        );
    }
}
