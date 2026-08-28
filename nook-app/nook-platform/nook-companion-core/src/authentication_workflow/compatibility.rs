//! Transitional current-main WASM inputs retained while hosts adopt detailed facts.

use super::{
    AuthenticationAdvanceControlEvidence, AuthenticationEnrollmentEvidence,
    AuthenticationManualCheckpoint, AuthenticationOneTimeCodeProgressionEvidence,
    AuthenticationPageObservation, AuthenticationPageObservations, AuthenticationPasskeyEvidence,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

pub const AUTHENTICATION_WORKFLOW_COMPATIBILITY_TYPESCRIPT: &str = r#"
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
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(type = "AuthenticationPageObservation", from_wasm_abi)]
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
            // Current-main observations predate detailed control evidence. Preserve that
            // transitional API's behavior here; the detailed-facts path ignores reduced flags.
            advance_control: AuthenticationAdvanceControlEvidence::Present,
            passkey,
        }
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
