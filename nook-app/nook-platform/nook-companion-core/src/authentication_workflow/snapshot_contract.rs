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
            || !self.requires_human_approval
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
                    | AuthenticationWorkflowAction::CreatePasskey
                    | AuthenticationWorkflowAction::TakeOver,
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
        AuthenticationPageObservation, AuthenticationWorkflowMatch,
        classify_authentication_workflow,
    };

    #[test]
    fn every_classifier_snapshot_satisfies_the_wire_contract() {
        for username_field_count in [0, 1] {
            for current_password_field_count in [0, 1] {
                for new_password_field_count in [0, 1] {
                    for generic_password_field_count in [0, 1, 2] {
                        for one_time_code_field_count in [0, 1] {
                            for manual_checkpoint_present in [false, true] {
                                for authenticator_setup_hint in [false, true] {
                                    for backup_codes_hint in [false, true] {
                                        for passkey_control_present in [false, true] {
                                            for matching_passkey_account_count in [0, 1] {
                                                let observation = AuthenticationPageObservation {
                                                    username_field_count,
                                                    current_password_field_count,
                                                    new_password_field_count,
                                                    generic_password_field_count,
                                                    one_time_code_field_count,
                                                    manual_checkpoint_present,
                                                    authenticator_setup_hint,
                                                    backup_codes_hint,
                                                    passkey_control_present,
                                                    matching_passkey_account_count,
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
