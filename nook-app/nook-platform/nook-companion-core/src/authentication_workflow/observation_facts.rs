use super::{
    AuthenticationAdvanceControlEvidence, AuthenticationEnrollmentEvidence,
    AuthenticationFormObservationPriority, AuthenticationManualCheckpoint,
    AuthenticationOneTimeCodeProgressionEvidence, AuthenticationPageObservation,
    AuthenticationPageObservations, AuthenticationPasskeyEvidence, AuthenticationWorkflowMatch,
};
use crate::page_field_classification::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    AuthenticationUsernameEvidence, PageControlOwnership,
    looks_like_one_time_code_auto_submit_signal,
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
    fn evidence(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> AuthenticationAdvanceControlEvidence {
        match self {
            Self::Observed(observation)
                if observation.is_bounded()
                    && fields.is_compatible_with_detailed_control(observation)
                    && matches!(
                        observation.classify(),
                        AuthenticationAdvanceControlDecision::AdvancesAuthentication
                    ) =>
            {
                AuthenticationAdvanceControlEvidence::Present
            }
            Self::Absent | Self::Observed(_) => AuthenticationAdvanceControlEvidence::Absent,
        }
    }

    fn is_bounded(&self) -> bool {
        matches!(self, Self::Absent)
            || matches!(self, Self::Observed(observation) if observation.is_bounded())
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

impl AuthenticationFieldObservationFacts {
    /// Validate that detailed control evidence describes these same fields and scope.
    #[must_use]
    pub fn is_compatible_with_detailed_control(
        self,
        observation: &AuthenticationAdvanceControlObservation,
    ) -> bool {
        self.current_password_field_count
            .saturating_add(self.generic_password_field_count)
            .saturating_add(self.new_password_field_count)
            == observation.password_field_count
            && self.new_password_field_count == observation.new_password_field_count
            && self.one_time_code_field_count == observation.one_time_code_field_count
            && (self.username_field_count > 0)
                != matches!(
                    observation.authentication_username,
                    AuthenticationUsernameEvidence::Absent
                )
            && matches!(
                observation.ownership,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
            )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationCeremonyObservationFacts {
    /// Legacy reduced evidence retained for wire compatibility; ignored during conversion.
    pub one_time_code_progression: AuthenticationOneTimeCodeProgressionEvidence,
    /// Raw executable input/change handler evidence, classified in Rust.
    #[serde(default)]
    pub one_time_code_handler_signal: String,
    pub manual_checkpoint: AuthenticationManualCheckpoint,
    pub advance_control: AuthenticationAdvanceControlEvidence,
}

impl AuthenticationCeremonyObservationFacts {
    fn is_bounded(&self) -> bool {
        self.one_time_code_handler_signal.len()
            <= crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
    }

    fn derived_one_time_code_progression(&self) -> AuthenticationOneTimeCodeProgressionEvidence {
        if !self.is_bounded() {
            return AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired;
        }
        if looks_like_one_time_code_auto_submit_signal(&self.one_time_code_handler_signal) {
            AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved
        } else {
            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
        }
    }
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
    fn is_bounded(&self) -> bool {
        self.ceremony.is_bounded() && self.detailed_advance_control.is_bounded()
    }

    #[must_use]
    pub fn into_observation(self) -> AuthenticationPageObservation {
        AuthenticationPageObservation {
            username_field_count: self.fields.username_field_count,
            current_password_field_count: self.fields.current_password_field_count,
            new_password_field_count: self.fields.new_password_field_count,
            generic_password_field_count: self.fields.generic_password_field_count,
            one_time_code_field_count: self.fields.one_time_code_field_count,
            one_time_code_progression: self.ceremony.derived_one_time_code_progression(),
            manual_checkpoint: self.ceremony.manual_checkpoint,
            enrollment_evidence: self.authenticator.enrollment_evidence(),
            advance_control: self.detailed_advance_control.evidence(self.fields),
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
        if self
            .observations
            .iter()
            .any(|observation| !observation.is_bounded())
        {
            return AuthenticationWorkflowMatch::Rejected;
        }
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

    #[test]
    fn rejects_mismatched_outer_and_nested_authentication_facts() {
        let signup_with_login_control = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                new_password_field_count: 1,
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
                    form_identity: "login-form".to_owned(),
                    destination_identity: String::new(),
                    label: "Continue".to_owned(),
                },
            ),
            ..Default::default()
        };

        assert_eq!(
            signup_with_login_control.into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
    }

    #[test]
    fn matches_detailed_total_password_count_across_field_kinds() {
        let control = AuthenticationAdvanceControlObservation {
            actionability: crate::PageControlActionability::Actionable,
            ownership: crate::PageControlOwnership::OwnedForm,
            semantics: crate::PageControlSemantics::SemanticSubmit,
            authentication_username: crate::AuthenticationUsernameEvidence::Absent,
            password_field_count: 1,
            new_password_field_count: 1,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            form_identity: String::new(),
            destination_identity: String::new(),
            label: "Continue".to_owned(),
        };
        let new_password = AuthenticationFieldObservationFacts {
            new_password_field_count: 1,
            ..Default::default()
        };
        assert!(new_password.is_compatible_with_detailed_control(&control));

        let current_password = AuthenticationFieldObservationFacts {
            current_password_field_count: 1,
            ..Default::default()
        };
        let current_control = AuthenticationAdvanceControlObservation {
            new_password_field_count: 0,
            ..control.clone()
        };
        assert!(current_password.is_compatible_with_detailed_control(&current_control));

        let generic_password = AuthenticationFieldObservationFacts {
            generic_password_field_count: 1,
            ..Default::default()
        };
        assert!(generic_password.is_compatible_with_detailed_control(&current_control));

        let mismatched_total = AuthenticationAdvanceControlObservation {
            password_field_count: 2,
            ..control
        };
        assert!(!new_password.is_compatible_with_detailed_control(&mismatched_total));
    }

    #[test]
    fn derives_one_time_code_progression_from_trusted_handler_signal() {
        let forged = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_progression:
                    AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved,
                ..Default::default()
            },
            ..Default::default()
        };
        assert_eq!(
            forged.into_observation().one_time_code_progression,
            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
        );

        let trusted = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_handler_signal: "oninput=this.form.requestSubmit()".to_owned(),
                ..Default::default()
            },
            ..Default::default()
        };
        assert_eq!(
            trusted.into_observation().one_time_code_progression,
            AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved
        );
    }

    #[test]
    fn rejects_oversized_one_time_code_handler_signal() {
        let facts = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_handler_signal: format!(
                    "oninput=this.form.submit(){}",
                    "x".repeat(
                        crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
                    )
                ),
                ..Default::default()
            },
            ..Default::default()
        };

        assert_eq!(
            facts.clone().into_observation().one_time_code_progression,
            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
        );
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );
    }

    #[test]
    fn rejects_missing_outer_username_for_strong_nested_username() {
        let login_control = AuthenticationAdvanceControlObservation {
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
        };
        let fields = AuthenticationFieldObservationFacts {
            current_password_field_count: 1,
            ..Default::default()
        };

        assert!(!fields.is_compatible_with_detailed_control(&login_control));
        assert_eq!(
            (AuthenticationPageObservationFacts {
                fields,
                detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                    login_control
                ),
                ..Default::default()
            })
            .into_observation()
            .advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
    }

    #[test]
    fn rejects_oversized_detailed_control_batch() {
        let facts = AuthenticationPageObservationFacts {
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                AuthenticationAdvanceControlObservation {
                    actionability: crate::PageControlActionability::Inert,
                    ownership: crate::PageControlOwnership::Unowned,
                    semantics: crate::PageControlSemantics::Activation,
                    authentication_username: crate::AuthenticationUsernameEvidence::Absent,
                    password_field_count: 0,
                    new_password_field_count: 0,
                    one_time_code_field_count: 0,
                    semantic_submit_control_count: 0,
                    form_identity: String::new(),
                    destination_identity: String::new(),
                    label: "x".repeat(
                        crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1,
                    ),
                },
            ),
            ..Default::default()
        };
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );
    }
}
