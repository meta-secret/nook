//! Complete response-boundary contract for classifier-produced workflow snapshots.

use super::{
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowSnapshot,
    AuthenticationWorkflowStage,
};

impl AuthenticationWorkflowSnapshot {
    /// Whether this snapshot is one of the complete tuples emitted by the classifier.
    #[must_use]
    pub const fn matches_classifier_contract(self) -> bool {
        if self.current_step == 0
            || self.total_steps == 0
            || self.current_step > self.total_steps
            || !self.approval_requirement_matches_action()
        {
            return false;
        }

        matches!(
            (
                self.kind,
                self.stage,
                self.action,
                self.current_step,
                self.total_steps,
            ),
            (
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::ContinueWithNook
                    | AuthenticationWorkflowAction::UsePasskey
                    | AuthenticationWorkflowAction::CreatePasskey,
                1,
                3,
            ) | (
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                1,
                3,
            ) | (
                AuthenticationWorkflowKind::Signup,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::GeneratePassword
                    | AuthenticationWorkflowAction::UsePasskey
                    | AuthenticationWorkflowAction::CreatePasskey,
                2,
                5,
            ) | (
                AuthenticationWorkflowKind::Signup,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                2,
                5,
            ) | (
                AuthenticationWorkflowKind::PasswordChange,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::GeneratePassword,
                2,
                4,
            ) | (
                AuthenticationWorkflowKind::PasswordChange,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                2,
                4,
            ) | (
                AuthenticationWorkflowKind::TotpChallenge,
                AuthenticationWorkflowStage::SecondFactor,
                AuthenticationWorkflowAction::FillTotp | AuthenticationWorkflowAction::TakeOver,
                2,
                3,
            ) | (
                AuthenticationWorkflowKind::TotpChallenge,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                2,
                3,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Setup,
                AuthenticationWorkflowAction::EnrollAuthenticator,
                2,
                5,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Verification,
                AuthenticationWorkflowAction::FillTotp,
                3,
                5,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Recovery,
                AuthenticationWorkflowAction::TakeOver,
                4,
                5,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                2..=4,
                5,
            ) | (
                AuthenticationWorkflowKind::Manual,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                1,
                1,
            )
        )
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        AuthenticationAdvanceControlEvidence, AuthenticationApprovalRequirement,
        AuthenticationEnrollmentEvidence, AuthenticationManualCheckpoint,
        AuthenticationOneTimeCodeProgressionEvidence, AuthenticationPageObservation,
        AuthenticationPasskeyEvidence, AuthenticationSavedLoginCapability,
        AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
        AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
        classify_authentication_workflow,
    };

    #[test]
    fn saved_login_capability_requires_a_complete_login_snapshot() {
        let valid = AuthenticationWorkflowSnapshot {
            kind: AuthenticationWorkflowKind::Login,
            stage: AuthenticationWorkflowStage::Credentials,
            action: AuthenticationWorkflowAction::ContinueWithNook,
            current_step: 1,
            total_steps: 3,
            approval_requirement: AuthenticationApprovalRequirement::ExplicitUserApproval,
            observation_index: 0,
        };
        assert_eq!(
            valid.saved_login_capability(),
            AuthenticationSavedLoginCapability::FillSavedLogin
        );

        let contradictory = AuthenticationWorkflowSnapshot {
            stage: AuthenticationWorkflowStage::Recovery,
            ..valid
        };
        assert_eq!(
            contradictory.saved_login_capability(),
            AuthenticationSavedLoginCapability::Unavailable
        );
    }

    #[test]
    fn every_classifier_snapshot_satisfies_the_wire_contract() {
        let enrollment_evidence = [
            AuthenticationEnrollmentEvidence::Absent,
            AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            AuthenticationEnrollmentEvidence::BackupCodes,
            AuthenticationEnrollmentEvidence::AuthenticatorSetupAndBackupCodes,
        ];
        let passkey_evidence = [
            AuthenticationPasskeyEvidence::Absent,
            AuthenticationPasskeyEvidence::Control,
            AuthenticationPasskeyEvidence::VaultAccounts { account_count: 0 },
            AuthenticationPasskeyEvidence::VaultAccounts { account_count: 1 },
            AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 0 },
            AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 1 },
        ];

        for username_field_count in [0, 1] {
            for current_password_field_count in [0, 1] {
                for new_password_field_count in [0, 1] {
                    for generic_password_field_count in [0, 1, 2] {
                        for one_time_code_field_count in [0, 1] {
                            for manual_checkpoint in [
                                AuthenticationManualCheckpoint::Absent,
                                AuthenticationManualCheckpoint::Present,
                            ] {
                                for enrollment_evidence in enrollment_evidence {
                                    for advance_control in [
                                        AuthenticationAdvanceControlEvidence::Absent,
                                        AuthenticationAdvanceControlEvidence::Present,
                                    ] {
                                        for one_time_code_progression in [
                                            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired,
                                            AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved,
                                        ] {
                                            for passkey in passkey_evidence {
                                                let observation = AuthenticationPageObservation {
                                                    username_field_count,
                                                    current_password_field_count,
                                                    new_password_field_count,
                                                    generic_password_field_count,
                                                    one_time_code_field_count,
                                                    one_time_code_progression,
                                                    manual_checkpoint,
                                                    enrollment_evidence,
                                                    advance_control,
                                                    passkey,
                                                };
                                                if let AuthenticationWorkflowMatch::Matched(
                                                    snapshot,
                                                ) = classify_authentication_workflow(observation)
                                                {
                                                    assert!(
                                                        snapshot.matches_classifier_contract(),
                                                        "classifier produced an invalid snapshot: {snapshot:?}",
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
