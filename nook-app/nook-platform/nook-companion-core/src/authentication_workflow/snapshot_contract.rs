//! Complete response-boundary contract for classifier-produced workflow snapshots.

use super::{
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowSnapshot,
    AuthenticationWorkflowStage,
};

const MAX_AUTHENTICATION_WORKFLOW_OBSERVATION_INDEX_EXCLUSIVE: u32 = 20;

impl AuthenticationWorkflowSnapshot {
    /// Whether this snapshot is one of the complete tuples emitted by the classifier.
    #[must_use]
    pub const fn matches_classifier_contract(self) -> bool {
        if self.current_step == 0
            || self.total_steps == 0
            || self.current_step > self.total_steps
            || !self.approval_requirement_matches_action()
            || self.observation_index >= MAX_AUTHENTICATION_WORKFLOW_OBSERVATION_INDEX_EXCLUSIVE
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
        AuthenticationApprovalRequirement, AuthenticationPageObservation,
        AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
        AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
        MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS, classify_authentication_workflow,
        classify_authentication_workflow_candidates,
    };
    use super::MAX_AUTHENTICATION_WORKFLOW_OBSERVATION_INDEX_EXCLUSIVE;

    fn classifier_outputs() -> Vec<(
        AuthenticationPageObservation,
        AuthenticationWorkflowSnapshot,
    )> {
        let mut outputs = Vec::new();
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
                                                    outputs.push((observation, snapshot));
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
        outputs
    }

    #[test]
    fn every_classifier_snapshot_satisfies_the_wire_contract() {
        for (_, snapshot) in classifier_outputs() {
            assert!(
                snapshot.matches_classifier_contract(),
                "classifier produced an invalid snapshot: {snapshot:?}",
            );
        }
    }

    #[test]
    fn every_accepted_workflow_tuple_is_classifier_producible() -> anyhow::Result<()> {
        let outputs = classifier_outputs();
        let kinds = [
            AuthenticationWorkflowKind::Login,
            AuthenticationWorkflowKind::Signup,
            AuthenticationWorkflowKind::PasswordChange,
            AuthenticationWorkflowKind::TotpChallenge,
            AuthenticationWorkflowKind::TotpEnrollment,
            AuthenticationWorkflowKind::Manual,
        ];
        let stages = [
            AuthenticationWorkflowStage::Credentials,
            AuthenticationWorkflowStage::SecondFactor,
            AuthenticationWorkflowStage::Verification,
            AuthenticationWorkflowStage::Setup,
            AuthenticationWorkflowStage::Recovery,
            AuthenticationWorkflowStage::Manual,
        ];
        let actions = [
            AuthenticationWorkflowAction::ContinueWithNook,
            AuthenticationWorkflowAction::GeneratePassword,
            AuthenticationWorkflowAction::FillTotp,
            AuthenticationWorkflowAction::EnrollAuthenticator,
            AuthenticationWorkflowAction::UsePasskey,
            AuthenticationWorkflowAction::CreatePasskey,
            AuthenticationWorkflowAction::TakeOver,
        ];

        for kind in kinds {
            for stage in stages {
                for action in actions {
                    for current_step in 1..=5 {
                        for total_steps in 1..=5 {
                            let accepted = AuthenticationWorkflowSnapshot {
                                kind,
                                stage,
                                action,
                                current_step,
                                total_steps,
                                approval_requirement: AuthenticationApprovalRequirement::for_action(
                                    action,
                                ),
                                observation_index: 0,
                            };
                            if !accepted.matches_classifier_contract() {
                                continue;
                            }

                            let Some((observation, _)) =
                                outputs.iter().find(|(_, produced)| *produced == accepted)
                            else {
                                anyhow::bail!(
                                    "wire contract accepted a tuple the classifier cannot produce: {accepted:?}"
                                );
                            };

                            for index in 0..MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS {
                                let mut observations =
                                    vec![AuthenticationPageObservation::default(); index];
                                observations.push(*observation);
                                let produced =
                                    classify_authentication_workflow_candidates(&observations)
                                        .snapshot()?;
                                let mut expected = accepted;
                                expected.observation_index = u32::try_from(index)?;
                                assert_eq!(produced, expected);
                                assert!(produced.matches_classifier_contract());
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    #[test]
    fn snapshot_observation_index_stays_within_the_bounded_batch() -> anyhow::Result<()> {
        let maximum_exclusive = u32::try_from(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)?;
        assert_eq!(
            maximum_exclusive,
            MAX_AUTHENTICATION_WORKFLOW_OBSERVATION_INDEX_EXCLUSIVE
        );
        let mut snapshot = AuthenticationWorkflowSnapshot {
            kind: AuthenticationWorkflowKind::Login,
            stage: AuthenticationWorkflowStage::Credentials,
            action: AuthenticationWorkflowAction::ContinueWithNook,
            current_step: 1,
            total_steps: 3,
            approval_requirement: AuthenticationApprovalRequirement::ExplicitUserApproval,
            observation_index: maximum_exclusive - 1,
        };
        assert!(snapshot.matches_classifier_contract());

        snapshot.observation_index = maximum_exclusive;
        assert!(!snapshot.matches_classifier_contract());
        Ok(())
    }
}
