//! Complete response-boundary contract for classifier-produced workflow snapshots.

use super::{
    AuthenticationSavedLoginCapability, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
};
use crate::AuthenticationPageObservation;
use crate::AuthenticationWorkflowMatch;

#[cfg(test)]
const MAX_AUTHENTICATION_WORKFLOW_OBSERVATION_INDEX_EXCLUSIVE: u32 = 20;

impl AuthenticationWorkflowSnapshot {
    const fn saved_login_capability_matches_contract(self) -> bool {
        let snapshot = self;
        let is_login_credentials = matches!(
            (snapshot.kind, snapshot.stage),
            (
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials
            )
        );
        match snapshot.action {
            AuthenticationWorkflowAction::ContinueWithNook => {
                is_login_credentials
                    && matches!(
                        snapshot.saved_login_capability,
                        AuthenticationSavedLoginCapability::FillSavedLogin
                    )
            }
            AuthenticationWorkflowAction::UsePasskey
            | AuthenticationWorkflowAction::CreatePasskey
                if is_login_credentials =>
            {
                true
            }
            _ => matches!(
                snapshot.saved_login_capability,
                AuthenticationSavedLoginCapability::Unavailable
            ),
        }
    }
}

impl AuthenticationWorkflowSnapshot {
    const fn classifier_tuple_matches_contract(self) -> bool {
        let snapshot = self;
        matches!(
            (snapshot.kind, snapshot.stage, snapshot.action,),
            (
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::ContinueWithNook
                    | AuthenticationWorkflowAction::UsePasskey
                    | AuthenticationWorkflowAction::CreatePasskey,
            ) | (
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
            ) | (
                AuthenticationWorkflowKind::Signup,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::GeneratePassword
                    | AuthenticationWorkflowAction::UsePasskey
                    | AuthenticationWorkflowAction::CreatePasskey,
            ) | (
                AuthenticationWorkflowKind::Signup,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
            ) | (
                AuthenticationWorkflowKind::PasswordChange,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::GeneratePassword,
            ) | (
                AuthenticationWorkflowKind::PasswordChange,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
            ) | (
                AuthenticationWorkflowKind::TotpChallenge,
                AuthenticationWorkflowStage::SecondFactor,
                AuthenticationWorkflowAction::FillTotp | AuthenticationWorkflowAction::TakeOver,
            ) | (
                AuthenticationWorkflowKind::TotpChallenge,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Setup,
                AuthenticationWorkflowAction::EnrollAuthenticator,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Verification,
                AuthenticationWorkflowAction::FillTotp,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Recovery,
                AuthenticationWorkflowAction::SaveBackupCodes,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
            ) | (
                AuthenticationWorkflowKind::Manual,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
            )
        )
    }
}

impl AuthenticationWorkflowSnapshot {
    /// Whether this snapshot is one of the complete tuples emitted by the classifier.
    #[must_use]
    pub const fn matches_classifier_contract(self) -> bool {
        if !self.approval_requirement_matches_action()
            || !self.saved_login_capability_matches_contract()
            || !self.observation_index.is_within_classifier_batch()
            || super::AuthenticationWorkflowProgress::admit(self).is_none()
        {
            return false;
        }

        (self).classifier_tuple_matches_contract()
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        AuthenticationApprovalRequirement, AuthenticationPageObservation,
        AuthenticationSavedLoginCapability, AuthenticationWorkflowAction,
        AuthenticationWorkflowKind, AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot,
        AuthenticationWorkflowStage, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
        classify_authentication_workflow,
    };
    use super::MAX_AUTHENTICATION_WORKFLOW_OBSERVATION_INDEX_EXCLUSIVE;

    #[test]
    fn saved_login_capability_requires_a_complete_login_snapshot() {
        let valid = AuthenticationWorkflowSnapshot {
            kind: AuthenticationWorkflowKind::Login,
            stage: AuthenticationWorkflowStage::Credentials,
            action: AuthenticationWorkflowAction::ContinueWithNook,
            current_step: 1.into(),
            total_steps: 3.into(),
            approval_requirement: AuthenticationApprovalRequirement::ExplicitUserApproval,
            saved_login_capability: AuthenticationSavedLoginCapability::FillSavedLogin,
            observation_index: 0.into(),
        };
        assert_eq!(
            valid.saved_login_capability(),
            AuthenticationSavedLoginCapability::FillSavedLogin
        );
        assert_eq!(
            AuthenticationWorkflowSnapshot {
                stage: AuthenticationWorkflowStage::Recovery,
                ..valid
            }
            .saved_login_capability(),
            AuthenticationSavedLoginCapability::Unavailable
        );

        let continue_without_saved_login = AuthenticationWorkflowSnapshot {
            saved_login_capability: AuthenticationSavedLoginCapability::Unavailable,
            ..valid
        };
        assert!(!continue_without_saved_login.matches_classifier_contract());

        let passkey_without_saved_login = AuthenticationWorkflowSnapshot {
            action: AuthenticationWorkflowAction::UsePasskey,
            saved_login_capability: AuthenticationSavedLoginCapability::Unavailable,
            ..valid
        };
        assert!(passkey_without_saved_login.matches_classifier_contract());
        assert!(
            AuthenticationWorkflowSnapshot {
                saved_login_capability: AuthenticationSavedLoginCapability::FillSavedLogin,
                ..passkey_without_saved_login
            }
            .matches_classifier_contract()
        );
    }

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
                                                    username_field_count: username_field_count
                                                        .into(),
                                                    current_password_field_count:
                                                        current_password_field_count.into(),
                                                    new_password_field_count:
                                                        new_password_field_count.into(),
                                                    generic_password_field_count:
                                                        generic_password_field_count.into(),
                                                    one_time_code_field_count:
                                                        one_time_code_field_count.into(),
                                                    manual_checkpoint_present,
                                                    authenticator_setup_hint,
                                                    backup_codes_hint,
                                                    passkey_control_present,
                                                    matching_passkey_account_count:
                                                        matching_passkey_account_count.into(),
                                                };
                                                if let AuthenticationWorkflowMatch::Matched(
                                                    snapshot,
                                                ) =
                                                    (observation).classify_authentication_workflow()
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
            AuthenticationWorkflowAction::SaveBackupCodes,
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
                                current_step: current_step.into(),
                                total_steps: total_steps.into(),
                                approval_requirement: AuthenticationApprovalRequirement::for_action(
                                    action,
                                ),
                                saved_login_capability: if matches!(
                                    (kind, stage, action),
                                    (
                                        AuthenticationWorkflowKind::Login,
                                        AuthenticationWorkflowStage::Credentials,
                                        AuthenticationWorkflowAction::ContinueWithNook,
                                    )
                                ) {
                                    AuthenticationSavedLoginCapability::FillSavedLogin
                                } else {
                                    AuthenticationSavedLoginCapability::Unavailable
                                },
                                observation_index: 0.into(),
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
                                    AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(&observations)
                                        .snapshot()?;
                                let mut expected = accepted;
                                expected.observation_index = u32::try_from(index)?.into();
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
            current_step: 1.into(),
            total_steps: 3.into(),
            approval_requirement: AuthenticationApprovalRequirement::ExplicitUserApproval,
            saved_login_capability: AuthenticationSavedLoginCapability::FillSavedLogin,
            observation_index: (maximum_exclusive - 1).into(),
        };
        assert!(snapshot.matches_classifier_contract());

        snapshot.observation_index = maximum_exclusive.into();
        assert!(!snapshot.matches_classifier_contract());
        Ok(())
    }
}
