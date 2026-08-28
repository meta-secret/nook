use super::{
    AuthenticationAdvanceControlEvidence, AuthenticationEnrollmentEvidence,
    AuthenticationFormObservationPriority, AuthenticationManualCheckpoint,
    AuthenticationOneTimeCodeProgressionEvidence, AuthenticationPageObservation,
    AuthenticationPageObservations, AuthenticationPasskeyEvidence, AuthenticationWorkflowMatch,
};
use crate::page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Detailed browser evidence for the control selected to advance authentication.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "observation", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationDetailedAdvanceControlObservation {
    #[default]
    Absent,
    Observed(AuthenticationAdvanceControlObservation),
}

impl AuthenticationDetailedAdvanceControlObservation {
    fn evidence(&self) -> AuthenticationAdvanceControlEvidence {
        match self {
            Self::Observed(observation)
                if matches!(
                    observation.classify(),
                    AuthenticationAdvanceControlDecision::AdvancesAuthentication
                ) =>
            {
                AuthenticationAdvanceControlEvidence::Present
            }
            Self::Absent | Self::Observed(_) => AuthenticationAdvanceControlEvidence::Absent,
        }
    }
}

/// Raw, non-secret field facts observed inside one authentication scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationFieldObservationFacts {
    pub username_field_count: u32,
    pub current_password_field_count: u32,
    pub new_password_field_count: u32,
    pub generic_password_field_count: u32,
    pub one_time_code_field_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationCeremonyObservationFacts {
    pub one_time_code_progression: AuthenticationOneTimeCodeProgressionEvidence,
    pub manual_checkpoint: AuthenticationManualCheckpoint,
    pub advance_control: AuthenticationAdvanceControlEvidence,
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationPasskeyControlObservation {
    #[default]
    Absent,
    Present,
}

/// Raw, non-secret authenticator and passkey facts for one authentication scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationAuthenticatorObservationFacts {
    pub authenticator_setup: AuthenticationAuthenticatorSetupObservation,
    pub backup_codes: AuthenticationBackupCodesObservation,
    pub passkey_control: AuthenticationPasskeyControlObservation,
    pub matching_passkey_account_count: u32,
}

impl AuthenticationAuthenticatorObservationFacts {
    const fn enrollment_evidence(self) -> AuthenticationEnrollmentEvidence {
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

    const fn passkey_evidence(self) -> AuthenticationPasskeyEvidence {
        match (self.passkey_control, self.matching_passkey_account_count) {
            (AuthenticationPasskeyControlObservation::Present, account_count)
                if account_count > 0 =>
            {
                AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count }
            }
            (AuthenticationPasskeyControlObservation::Present, _) => {
                AuthenticationPasskeyEvidence::Control
            }
            (AuthenticationPasskeyControlObservation::Absent, account_count)
                if account_count > 0 =>
            {
                AuthenticationPasskeyEvidence::VaultAccounts { account_count }
            }
            (AuthenticationPasskeyControlObservation::Absent, _) => {
                AuthenticationPasskeyEvidence::Absent
            }
        }
    }
}

/// Raw browser facts grouped by the authentication domains that own their conversion.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationPageObservationFacts {
    pub fields: AuthenticationFieldObservationFacts,
    pub ceremony: AuthenticationCeremonyObservationFacts,
    pub authenticator: AuthenticationAuthenticatorObservationFacts,
    /// Detailed control evidence is classified in Rust; the reduced ceremony flag stays fail-closed.
    #[serde(default)]
    pub detailed_advance_control: AuthenticationDetailedAdvanceControlObservation,
}

impl AuthenticationPageObservationFacts {
    #[must_use]
    pub fn into_observation(self) -> AuthenticationPageObservation {
        AuthenticationPageObservation {
            username_field_count: self.fields.username_field_count,
            current_password_field_count: self.fields.current_password_field_count,
            new_password_field_count: self.fields.new_password_field_count,
            generic_password_field_count: self.fields.generic_password_field_count,
            one_time_code_field_count: self.fields.one_time_code_field_count,
            one_time_code_progression: self.ceremony.one_time_code_progression,
            manual_checkpoint: self.ceremony.manual_checkpoint,
            enrollment_evidence: self.authenticator.enrollment_evidence(),
            advance_control: self.detailed_advance_control.evidence(),
            passkey: self.authenticator.passkey_evidence(),
        }
    }

    #[must_use]
    pub fn form_priority(self) -> AuthenticationFormObservationPriority {
        self.into_observation().form_priority()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationPageObservationFactsBatch {
    pub observations: Vec<AuthenticationPageObservationFacts>,
}

impl AuthenticationPageObservationFactsBatch {
    #[must_use]
    pub fn classify(&self) -> AuthenticationWorkflowMatch {
        let observations = AuthenticationPageObservations {
            observations: self
                .observations
                .iter()
                .cloned()
                .map(AuthenticationPageObservationFacts::into_observation)
                .collect(),
        };
        observations.classify()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_semantic_evidence_outside_rust_vocabulary() {
        let input = serde_json::json!({
            "fields": {
                "usernameFieldCount": 1,
                "currentPasswordFieldCount": 0,
                "newPasswordFieldCount": 0,
                "genericPasswordFieldCount": 0,
                "oneTimeCodeFieldCount": 0
            },
            "ceremony": {
                "oneTimeCodeProgression": "future-progression",
                "manualCheckpoint": "absent",
                "advanceControl": "present"
            },
            "authenticator": {
                "authenticatorSetup": "absent",
                "backupCodes": "absent",
                "passkeyControl": "absent",
                "matchingPasskeyAccountCount": 0
            }
        });

        assert!(serde_json::from_value::<AuthenticationPageObservationFacts>(input).is_err());
    }

    #[test]
    fn trusts_only_classified_detailed_advance_control_evidence() {
        let detailed = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                current_password_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                advance_control: AuthenticationAdvanceControlEvidence::Present,
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                AuthenticationAdvanceControlObservation {
                    actionability: crate::PageControlActionability::Actionable,
                    ownership: crate::PageControlOwnership::OwnedForm,
                    semantics: crate::PageControlSemantics::SemanticSubmit,
                    authentication_username: crate::AuthenticationUsernameEvidence::Strong,
                    password_field_count: 1,
                    new_password_field_count: 0,
                    one_time_code_field_count: 0,
                    semantic_submit_control_count: 1,
                    form_identity: String::new(),
                    destination_identity: String::new(),
                    label: "Continue".to_owned(),
                },
            ),
            ..Default::default()
        };
        let mut reduced_only = detailed.clone();
        reduced_only.detailed_advance_control =
            AuthenticationDetailedAdvanceControlObservation::Absent;

        assert_eq!(
            detailed.into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Present
        );
        assert_eq!(
            reduced_only.into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
    }
}
