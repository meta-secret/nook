//! Complete response-boundary contract for classifier-produced workflow snapshots.

use super::{
    AuthenticationSavedLoginCapability, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
};

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
    const fn action_matches_workflow_stage(self) -> bool {
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
            || super::AuthenticationWorkflowProgress::admit(self).is_err()
        {
            return false;
        }

        (self).action_matches_workflow_stage()
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        AuthenticationApprovalRequirement, AuthenticationPageObservation,
        AuthenticationSavedLoginCapability, AuthenticationWorkflowAction,
        AuthenticationWorkflowKind, AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot,
        AuthenticationWorkflowStage, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    };
    use super::MAX_AUTHENTICATION_WORKFLOW_OBSERVATION_INDEX_EXCLUSIVE;
    use crate::{
        AuthenticationPilotPresentationCapability, MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    };
    use proptest::prelude::*;
    use proptest::test_runner::{TestCaseError, TestCaseResult};

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

    #[derive(Clone, Debug)]
    struct WorkflowObservationCase {
        observation: AuthenticationPageObservation,
    }

    impl WorkflowObservationCase {
        fn bounded_strategy() -> BoxedStrategy<Self> {
            let count = prop_oneof![
                6 => 0_u32..=2,
                1 => Just(MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT),
            ]
            .boxed();
            // Generate valid totals independently of the admission code under test.
            let passwords = prop_oneof![
                6 => (0_u32..=2, 0_u32..=2, 0_u32..=2),
                1 => (
                    0_u32..=MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT / 3,
                    0_u32..=MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT / 3,
                    0_u32..=MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT / 3,
                ),
                1 => Just((MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, 0, 0)),
                1 => Just((0, MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, 0)),
                1 => Just((0, 0, MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT)),
            ];
            (
                count.clone(),
                passwords,
                count.clone(),
                count,
                (any::<bool>(), any::<bool>(), any::<bool>(), any::<bool>()),
            )
                .prop_map(
                    |(
                        username,
                        (current, new, generic),
                        otp,
                        accounts,
                        (manual, setup, backup, passkey),
                    )| {
                        Self {
                            observation: AuthenticationPageObservation {
                                username_field_count: username.into(),
                                current_password_field_count: current.into(),
                                new_password_field_count: new.into(),
                                generic_password_field_count: generic.into(),
                                one_time_code_field_count: otp.into(),
                                matching_passkey_account_count: accounts.into(),
                                manual_checkpoint_present: manual,
                                authenticator_setup_hint: setup,
                                backup_codes_hint: backup,
                                passkey_control_present: passkey,
                            },
                        }
                    },
                )
                .boxed()
        }
    }

    #[derive(Clone, Debug)]
    struct WorkflowBatchCase {
        observations: Vec<AuthenticationPageObservation>,
    }

    impl WorkflowBatchCase {
        fn strategy(lengths: std::ops::Range<usize>) -> BoxedStrategy<Self> {
            proptest::collection::vec(WorkflowObservationCase::bounded_strategy(), lengths)
                .prop_map(|cases| Self {
                    observations: cases.into_iter().map(|case| case.observation).collect(),
                })
                .boxed()
        }

        fn classify(&self) -> AuthenticationWorkflowMatch {
            AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(
                &self.observations,
            )
        }

        fn admit_wire(
            snapshot: AuthenticationWorkflowSnapshot,
        ) -> Result<AuthenticationWorkflowSnapshot, String> {
            let serialized = serde_json::to_value(snapshot).map_err(|error| error.to_string())?;
            let wire: crate::AuthenticationWorkflowSnapshotWire =
                serde_json::from_value(serialized).map_err(|error| error.to_string())?;
            AuthenticationWorkflowSnapshot::try_from(wire).map_err(|error| error.to_string())
        }

        fn assert_emitted_invariants(&self) -> TestCaseResult {
            let selected = self.classify();
            prop_assert!(!matches!(selected, AuthenticationWorkflowMatch::Rejected));
            let AuthenticationWorkflowMatch::Matched(snapshot) = selected else {
                return Ok(());
            };
            let index = u32::from(snapshot.observation_index) as usize;
            prop_assert!(index < self.observations.len());
            let mut source = self.observations[index]
                .classify_authentication_workflow()
                .snapshot()
                .map_err(|error| TestCaseError::fail(error.to_string()))?;
            source.observation_index = snapshot.observation_index;
            prop_assert_eq!(snapshot, source);
            let current = u8::from(snapshot.current_step);
            let total = u8::from(snapshot.total_steps);
            prop_assert!(current > 0 && current <= total);
            match snapshot.action {
                AuthenticationWorkflowAction::TakeOver => prop_assert_eq!(
                    snapshot.approval_requirement,
                    AuthenticationApprovalRequirement::TakeoverRequired
                ),
                _ => prop_assert_eq!(
                    snapshot.approval_requirement,
                    AuthenticationApprovalRequirement::ExplicitUserApproval
                ),
            }
            let admitted = Self::admit_wire(snapshot).map_err(TestCaseError::fail)?;
            prop_assert_eq!(admitted, snapshot);
            Ok(())
        }

        fn assert_append_stability(&self) -> TestCaseResult {
            let original = self.classify();
            prop_assert!(!matches!(original, AuthenticationWorkflowMatch::Rejected));
            let mut with_empty = self.clone();
            with_empty
                .observations
                .push(AuthenticationPageObservation::default());
            prop_assert_eq!(with_empty.classify(), original);
            if let AuthenticationWorkflowMatch::Matched(snapshot) = original {
                let index = u32::from(snapshot.observation_index) as usize;
                prop_assert!(index < self.observations.len());
                let mut with_duplicate = self.clone();
                with_duplicate.observations.push(self.observations[index]);
                prop_assert_eq!(with_duplicate.classify(), original);
            }
            Ok(())
        }

        fn assert_invalid_mutations(&self, invalid_index: u32) -> TestCaseResult {
            let selected = self.classify();
            prop_assert!(!matches!(selected, AuthenticationWorkflowMatch::Rejected));
            let AuthenticationWorkflowMatch::Matched(snapshot) = selected else {
                return Ok(());
            };
            // Establish a valid baseline before introducing independently invalid values.
            prop_assert_eq!(
                Self::admit_wire(snapshot).map_err(TestCaseError::fail)?,
                snapshot
            );
            let mut zero_current = snapshot;
            zero_current.current_step = 0.into();
            let mut zero_total = snapshot;
            zero_total.total_steps = 0.into();
            let mut outside_batch = snapshot;
            outside_batch.observation_index = invalid_index.into();
            let mut opposite_approval = snapshot;
            opposite_approval.approval_requirement = match snapshot.approval_requirement {
                AuthenticationApprovalRequirement::ExplicitUserApproval => {
                    AuthenticationApprovalRequirement::TakeoverRequired
                }
                AuthenticationApprovalRequirement::TakeoverRequired => {
                    AuthenticationApprovalRequirement::ExplicitUserApproval
                }
            };
            for invalid in [zero_current, zero_total, outside_batch, opposite_approval] {
                prop_assert!(Self::admit_wire(invalid).is_err());
                prop_assert_eq!(
                    invalid.saved_login_capability(),
                    AuthenticationSavedLoginCapability::Unavailable
                );
                prop_assert_eq!(
                    invalid.pilot_presentation_capability(),
                    AuthenticationPilotPresentationCapability::Hidden
                );
            }
            Ok(())
        }

        fn overflowing_password_total(current: u32) -> Self {
            Self {
                observations: vec![AuthenticationPageObservation {
                    current_password_field_count: current.into(),
                    new_password_field_count: (MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT - current
                        + 1)
                    .into(),
                    ..Default::default()
                }],
            }
        }

        fn assert_rejected(&self) -> TestCaseResult {
            prop_assert_eq!(self.classify(), AuthenticationWorkflowMatch::Rejected);
            Ok(())
        }
    }

    #[derive(Clone, Copy, Debug)]
    enum OversizedObservationField {
        Username,
        CurrentPassword,
        NewPassword,
        GenericPassword,
        OneTimeCode,
        PasskeyAccounts,
    }

    impl OversizedObservationField {
        fn strategy() -> impl Strategy<Value = Self> {
            prop_oneof![
                Just(Self::Username),
                Just(Self::CurrentPassword),
                Just(Self::NewPassword),
                Just(Self::GenericPassword),
                Just(Self::OneTimeCode),
                Just(Self::PasskeyAccounts)
            ]
        }
        fn assert_rejected(self, count: u32) -> TestCaseResult {
            let mut observation = AuthenticationPageObservation::default();
            match self {
                Self::Username => observation.username_field_count = count.into(),
                Self::CurrentPassword => observation.current_password_field_count = count.into(),
                Self::NewPassword => observation.new_password_field_count = count.into(),
                Self::GenericPassword => observation.generic_password_field_count = count.into(),
                Self::OneTimeCode => observation.one_time_code_field_count = count.into(),
                Self::PasskeyAccounts => observation.matching_passkey_account_count = count.into(),
            }
            WorkflowBatchCase {
                observations: vec![observation],
            }
            .assert_rejected()
        }
    }

    proptest! {
        #[test]
        fn selected_workflows_preserve_source_progress_approval_and_wire_admission(
            case in WorkflowBatchCase::strategy(1..MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 1),
        ) {
            case.assert_emitted_invariants()?;
        }

        #[test]
        fn irrelevant_or_equal_candidates_do_not_displace_the_first_selection(
            case in WorkflowBatchCase::strategy(1..MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS),
        ) {
            case.assert_append_stability()?;
        }

        #[test]
        fn malformed_progress_index_and_approval_cannot_retain_capabilities(
            case in WorkflowBatchCase::strategy(1..MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 1),
            invalid_index in MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS as u32..=u32::MAX,
        ) {
            case.assert_invalid_mutations(invalid_index)?;
        }

        #[test]
        fn individually_oversized_observations_are_rejected(
            field in OversizedObservationField::strategy(),
            count in MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1..=u32::MAX,
        ) {
            field.assert_rejected(count)?;
        }

        #[test]
        fn independently_bounded_password_fields_cannot_overflow_the_combined_limit(
            current in 1_u32..=MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
        ) {
            WorkflowBatchCase::overflowing_password_total(current).assert_rejected()?;
        }
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
