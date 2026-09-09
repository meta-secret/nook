//! Exhaustive authentication workflow classification policy.

use super::{
    AuthenticationManualCheckpoint, AuthenticationPageObservation,
    AuthenticationPasskeyControlObservation, AuthenticationWorkflowAction,
    AuthenticationWorkflowEvidence, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
    AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
};

impl AuthenticationWorkflowAction {
    const fn generate_or_takeover(
        manual_checkpoint_present: AuthenticationManualCheckpoint,
    ) -> AuthenticationWorkflowAction {
        if matches!(
            manual_checkpoint_present,
            AuthenticationManualCheckpoint::Present
        ) {
            AuthenticationWorkflowAction::TakeOver
        } else {
            AuthenticationWorkflowAction::GeneratePassword
        }
    }
}

impl AuthenticationWorkflowStage {
    const fn credentials_or_manual(
        manual_checkpoint_present: AuthenticationManualCheckpoint,
    ) -> AuthenticationWorkflowStage {
        if matches!(
            manual_checkpoint_present,
            AuthenticationManualCheckpoint::Present
        ) {
            AuthenticationWorkflowStage::Manual
        } else {
            AuthenticationWorkflowStage::Credentials
        }
    }
}

impl AuthenticationWorkflowAction {
    const fn continue_or_takeover(
        manual_checkpoint_present: AuthenticationManualCheckpoint,
    ) -> AuthenticationWorkflowAction {
        if matches!(
            manual_checkpoint_present,
            AuthenticationManualCheckpoint::Present
        ) {
            AuthenticationWorkflowAction::TakeOver
        } else {
            AuthenticationWorkflowAction::ContinueWithNook
        }
    }
}

impl AuthenticationWorkflowEvidence {
    #[must_use]
    #[allow(clippy::too_many_lines)] // One exhaustive decision table keeps workflow precedence visible.
    pub(super) const fn classify_authentication_workflow(self) -> AuthenticationWorkflowMatch {
        let observation = self;
        if !observation.has_authentication_fields() {
            return AuthenticationWorkflowMatch::NoMatch;
        }
        if let AuthenticationWorkflowMatch::Matched(enrollment) =
            (observation).classify_enrollment_workflow()
        {
            return AuthenticationWorkflowMatch::Matched(enrollment);
        }

        if observation.current_password_field_count.raw() > 0
            && observation.new_password_field_count.raw() > 0
        {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(
                    AuthenticationWorkflowKind::PasswordChange,
                    AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    AuthenticationWorkflowAction::generate_or_takeover(
                        observation.manual_checkpoint_present,
                    ),
                    2,
                    4,
                )
                .with_passkey_proposal(observation),
            );
        }

        if observation.new_password_field_count.raw() > 0 {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(
                    AuthenticationWorkflowKind::Signup,
                    AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    AuthenticationWorkflowAction::generate_or_takeover(
                        observation.manual_checkpoint_present,
                    ),
                    2,
                    5,
                )
                .with_passkey_proposal(observation),
            );
        }

        if observation.one_time_code_field_count.raw() > 0 {
            let (stage, action) = if matches!(
                observation.manual_checkpoint_present,
                AuthenticationManualCheckpoint::Present
            ) {
                (
                    AuthenticationWorkflowStage::Manual,
                    AuthenticationWorkflowAction::TakeOver,
                )
            } else if observation.password_field_count().raw() == 0 {
                (
                    AuthenticationWorkflowStage::SecondFactor,
                    AuthenticationWorkflowAction::FillTotp,
                )
            } else {
                (
                    AuthenticationWorkflowStage::SecondFactor,
                    AuthenticationWorkflowAction::TakeOver,
                )
            };
            return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::TotpChallenge,
                stage,
                action,
                2,
                3,
            ));
        }

        if (observation.current_password_field_count.raw() > 0
            && observation.generic_password_field_count.raw() > 0)
            || observation.generic_password_field_count.raw() > 1
        {
            return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Manual,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                1,
                1,
            ));
        }

        if observation.password_field_count().raw() > 0 {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(
                    AuthenticationWorkflowKind::Login,
                    AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    AuthenticationWorkflowAction::continue_or_takeover(
                        observation.manual_checkpoint_present,
                    ),
                    1,
                    3,
                )
                .with_saved_login_capability()
                .with_passkey_proposal(observation),
            );
        }

        if observation.username_field_count.raw() > 0 {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(
                    AuthenticationWorkflowKind::Login,
                    AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    AuthenticationWorkflowAction::continue_or_takeover(
                        observation.manual_checkpoint_present,
                    ),
                    1,
                    3,
                )
                .with_saved_login_capability()
                .with_passkey_proposal(observation),
            );
        }

        if matches!(
            observation.passkey_control_present,
            AuthenticationPasskeyControlObservation::Present
        ) || observation.matching_passkey_account_count.raw() > 0
        {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(
                    AuthenticationWorkflowKind::Login,
                    AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    if matches!(
                        observation.manual_checkpoint_present,
                        AuthenticationManualCheckpoint::Present
                    ) {
                        AuthenticationWorkflowAction::TakeOver
                    } else {
                        AuthenticationWorkflowAction::ContinueWithNook
                    },
                    1,
                    3,
                )
                .with_passkey_proposal(observation),
            );
        }

        AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::Manual,
            AuthenticationWorkflowStage::Manual,
            AuthenticationWorkflowAction::TakeOver,
            1,
            1,
        ))
    }
}

impl AuthenticationPageObservation {
    pub fn classify_authentication_workflow(self) -> AuthenticationWorkflowMatch {
        AuthenticationWorkflowEvidence::from(self).classify_authentication_workflow()
    }
}
