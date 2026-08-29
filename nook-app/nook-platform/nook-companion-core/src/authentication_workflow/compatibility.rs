//! Transitional current-main WASM inputs retained while hosts adopt detailed facts.

use super::{
    AuthenticationAdvanceControlEvidence, AuthenticationEnrollmentEvidence,
    AuthenticationManualCheckpoint, AuthenticationOneTimeCodeProgressionEvidence,
    AuthenticationPageObservation, AuthenticationPageObservations, AuthenticationPasskeyEvidence,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

pub const AUTHENTICATION_WORKFLOW_COMPATIBILITY_TYPESCRIPT: &str = r"
export interface AuthenticationPageObservation {
    usernameFieldCount: number;
    currentPasswordFieldCount: number;
    newPasswordFieldCount: number;
    genericPasswordFieldCount: number;
    oneTimeCodeFieldCount: number;
    manualCheckpointPresent: boolean;
    authenticatorSetupHint: boolean;
    backupCodesHint: boolean;
    passkeyControlPresent: boolean;
    matchingPasskeyAccountCount: number;
}

export interface AuthenticationPageObservations {
    observations: AuthenticationPageObservation[];
}
";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(type = "AuthenticationPageObservation", from_wasm_abi)]
// The boolean fields are the immutable current-main wire contract retained for compatibility.
#[allow(clippy::struct_excessive_bools)]
pub struct AuthenticationPageObservationCompatibility {
    pub username_field_count: u32,
    pub current_password_field_count: u32,
    pub new_password_field_count: u32,
    pub generic_password_field_count: u32,
    pub one_time_code_field_count: u32,
    pub manual_checkpoint_present: bool,
    pub authenticator_setup_hint: bool,
    pub backup_codes_hint: bool,
    pub passkey_control_present: bool,
    pub matching_passkey_account_count: u32,
}

impl AuthenticationPageObservationCompatibility {
    #[must_use]
    pub const fn into_observation(self) -> AuthenticationPageObservation {
        let enrollment_evidence = match (self.authenticator_setup_hint, self.backup_codes_hint) {
            (false, false) => AuthenticationEnrollmentEvidence::Absent,
            (true, false) => AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            (false, true) => AuthenticationEnrollmentEvidence::BackupCodes,
            (true, true) => AuthenticationEnrollmentEvidence::AuthenticatorSetupAndBackupCodes,
        };
        let passkey = match (
            self.passkey_control_present,
            self.matching_passkey_account_count,
        ) {
            (false, 0) => AuthenticationPasskeyEvidence::Absent,
            (true, 0) => AuthenticationPasskeyEvidence::Control,
            (false, account_count) => {
                AuthenticationPasskeyEvidence::VaultAccounts { account_count }
            }
            (true, account_count) => {
                AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count }
            }
        };
        AuthenticationPageObservation {
            username_field_count: self.username_field_count,
            current_password_field_count: self.current_password_field_count,
            new_password_field_count: self.new_password_field_count,
            generic_password_field_count: self.generic_password_field_count,
            one_time_code_field_count: self.one_time_code_field_count,
            one_time_code_progression:
                AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired,
            manual_checkpoint: if self.manual_checkpoint_present {
                AuthenticationManualCheckpoint::Present
            } else {
                AuthenticationManualCheckpoint::Absent
            },
            enrollment_evidence,
            // Legacy observations cannot prove which control will submit the form.
            // Actionable workflow matching therefore requires the detailed-facts export.
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            passkey,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_password_form_never_synthesizes_an_advance_control() {
        let observation = AuthenticationPageObservationCompatibility {
            username_field_count: 1,
            current_password_field_count: 1,
            new_password_field_count: 0,
            generic_password_field_count: 0,
            one_time_code_field_count: 0,
            manual_checkpoint_present: false,
            authenticator_setup_hint: false,
            backup_codes_hint: false,
            passkey_control_present: false,
            matching_passkey_account_count: 0,
        };
        assert_eq!(
            observation.into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
        assert_eq!(
            AuthenticationPageObservationsCompatibility {
                observations: vec![observation],
            }
            .into_observations()
            .classify(),
            crate::AuthenticationWorkflowMatch::NoMatch
        );
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(type = "AuthenticationPageObservations", from_wasm_abi)]
pub struct AuthenticationPageObservationsCompatibility {
    pub observations: Vec<AuthenticationPageObservationCompatibility>,
}

impl AuthenticationPageObservationsCompatibility {
    #[must_use]
    pub fn into_observations(self) -> AuthenticationPageObservations {
        AuthenticationPageObservations {
            observations: self
                .observations
                .into_iter()
                .map(AuthenticationPageObservationCompatibility::into_observation)
                .collect(),
        }
    }
}
