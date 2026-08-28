use super::{
    AuthenticationAdvanceControlEvidence, AuthenticationEnrollmentEvidence,
    AuthenticationFormObservationPriority, AuthenticationManualCheckpoint,
    AuthenticationOneTimeCodeProgressionEvidence, AuthenticationPageObservation,
    AuthenticationPageObservations, AuthenticationPasskeyEvidence, AuthenticationWorkflowMatch,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

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

/// Raw, non-secret facts about how the current ceremony may progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationCeremonyObservationFacts {
    pub one_time_code_progression: AuthenticationOneTimeCodeProgressionEvidence,
    pub manual_checkpoint: AuthenticationManualCheckpoint,
    /// Legacy reduced evidence is retained for wire compatibility but is not
    /// trusted by workflow classification. Control ownership and semantics
    /// must be established by the detailed control classifier.
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationPageObservationFacts {
    pub fields: AuthenticationFieldObservationFacts,
    pub ceremony: AuthenticationCeremonyObservationFacts,
    pub authenticator: AuthenticationAuthenticatorObservationFacts,
}

impl AuthenticationPageObservationFacts {
    #[must_use]
    pub const fn into_observation(self) -> AuthenticationPageObservation {
        AuthenticationPageObservation {
            username_field_count: self.fields.username_field_count,
            current_password_field_count: self.fields.current_password_field_count,
            new_password_field_count: self.fields.new_password_field_count,
            generic_password_field_count: self.fields.generic_password_field_count,
            one_time_code_field_count: self.fields.one_time_code_field_count,
            one_time_code_progression: self.ceremony.one_time_code_progression,
            manual_checkpoint: self.ceremony.manual_checkpoint,
            enrollment_evidence: self.authenticator.enrollment_evidence(),
            // A reduced facts envelope cannot establish that a control belongs
            // to an authentication ceremony. Do not let callers forge
            // continuation evidence by setting `advanceControl` directly.
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            passkey: self.authenticator.passkey_evidence(),
        }
    }

    #[must_use]
    pub const fn form_priority(self) -> AuthenticationFormObservationPriority {
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
                .copied()
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
    fn classifies_combined_browser_facts_into_owned_evidence() {
        let observation = AuthenticationPageObservationFacts {
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_progression:
                    AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved,
                manual_checkpoint: AuthenticationManualCheckpoint::Present,
                advance_control: AuthenticationAdvanceControlEvidence::Present,
            },
            authenticator: AuthenticationAuthenticatorObservationFacts {
                authenticator_setup: AuthenticationAuthenticatorSetupObservation::Present,
                backup_codes: AuthenticationBackupCodesObservation::Present,
                passkey_control: AuthenticationPasskeyControlObservation::Present,
                matching_passkey_account_count: 2,
            },
            fields: AuthenticationFieldObservationFacts::default(),
        }
        .into_observation();

        assert_eq!(
            observation.one_time_code_progression,
            AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved
        );
        assert_eq!(
            observation.manual_checkpoint,
            AuthenticationManualCheckpoint::Present
        );
        assert_eq!(
            observation.enrollment_evidence,
            AuthenticationEnrollmentEvidence::AuthenticatorSetupAndBackupCodes
        );
        assert_eq!(
            observation.advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
        assert_eq!(
            observation.passkey,
            AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 2 }
        );
    }

    #[test]
    fn ignores_forged_reduced_advance_control_for_password_login() {
        let facts = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                current_password_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                advance_control: AuthenticationAdvanceControlEvidence::Present,
                ..Default::default()
            },
            ..Default::default()
        };

        assert_eq!(
            facts.into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );
    }

    #[test]
    fn classifies_each_passkey_fact_combination_consistently() {
        let passkey = |passkey_control, matching_passkey_account_count| {
            AuthenticationPageObservationFacts {
                authenticator: AuthenticationAuthenticatorObservationFacts {
                    passkey_control,
                    matching_passkey_account_count,
                    ..Default::default()
                },
                ..Default::default()
            }
            .into_observation()
            .passkey
        };

        assert_eq!(
            passkey(AuthenticationPasskeyControlObservation::Absent, 0),
            AuthenticationPasskeyEvidence::Absent
        );
        assert_eq!(
            passkey(AuthenticationPasskeyControlObservation::Present, 0),
            AuthenticationPasskeyEvidence::Control
        );
        assert_eq!(
            passkey(AuthenticationPasskeyControlObservation::Absent, 3),
            AuthenticationPasskeyEvidence::VaultAccounts { account_count: 3 }
        );
        assert_eq!(
            passkey(AuthenticationPasskeyControlObservation::Present, 3),
            AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 3 }
        );
    }
}
