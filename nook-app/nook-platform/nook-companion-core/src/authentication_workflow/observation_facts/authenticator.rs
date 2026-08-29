use super::{
    AuthenticationDetailedPasskeyControlObservation, AuthenticationPasskeyControlObservation,
};
use crate::authentication_workflow::{
    AuthenticationEnrollmentEvidence, AuthenticationPasskeyEvidence,
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
    Present,
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
    pub(super) const fn enrollment_evidence(&self) -> AuthenticationEnrollmentEvidence {
        match (self.authenticator_setup, self.backup_codes) {
            (
                AuthenticationAuthenticatorSetupObservation::Present,
                AuthenticationBackupCodesObservation::Present,
            ) => AuthenticationEnrollmentEvidence::AuthenticatorSetupAndBackupCodes,
            (
                AuthenticationAuthenticatorSetupObservation::Present,
                AuthenticationBackupCodesObservation::Absent,
            ) => AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            (
                AuthenticationAuthenticatorSetupObservation::Absent,
                AuthenticationBackupCodesObservation::Present,
            ) => AuthenticationEnrollmentEvidence::BackupCodes,
            (
                AuthenticationAuthenticatorSetupObservation::Absent,
                AuthenticationBackupCodesObservation::Absent,
            ) => AuthenticationEnrollmentEvidence::Absent,
        }
    }

    pub(super) fn passkey_evidence(&self) -> AuthenticationPasskeyEvidence {
        self.detailed_passkey_control
            .evidence(self.matching_passkey_account_count)
    }
}
