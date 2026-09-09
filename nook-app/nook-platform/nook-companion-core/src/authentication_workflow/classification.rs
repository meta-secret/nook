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

        if observation.current_password_field_count.is_nonzero()
            && observation.new_password_field_count.is_nonzero()
        {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(super::AuthenticationWorkflowSnapshotDraft {
                    kind: AuthenticationWorkflowKind::PasswordChange,
                    stage: AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    action: AuthenticationWorkflowAction::generate_or_takeover(
                        observation.manual_checkpoint_present,
                    ),
                    progress: super::AuthenticationWorkflowProgress::PasswordChangeCredentials,
                })
                .with_passkey_proposal(observation),
            );
        }

        if observation.new_password_field_count.is_nonzero() {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(super::AuthenticationWorkflowSnapshotDraft {
                    kind: AuthenticationWorkflowKind::Signup,
                    stage: AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    action: AuthenticationWorkflowAction::generate_or_takeover(
                        observation.manual_checkpoint_present,
                    ),
                    progress: super::AuthenticationWorkflowProgress::SignupCredentials,
                })
                .with_passkey_proposal(observation),
            );
        }

        if observation.one_time_code_field_count.is_nonzero() {
            let (stage, action) = if matches!(
                observation.manual_checkpoint_present,
                AuthenticationManualCheckpoint::Present
            ) {
                (
                    AuthenticationWorkflowStage::Manual,
                    AuthenticationWorkflowAction::TakeOver,
                )
            } else if observation.password_field_count().is_zero() {
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
                super::AuthenticationWorkflowSnapshotDraft {
                    kind: AuthenticationWorkflowKind::TotpChallenge,
                    stage: stage,
                    action: action,
                    progress: super::AuthenticationWorkflowProgress::Challenge,
                },
            ));
        }

        if (observation.current_password_field_count.is_nonzero()
            && observation.generic_password_field_count.is_nonzero())
            || observation.generic_password_field_count.is_multiple()
        {
            return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
                super::AuthenticationWorkflowSnapshotDraft {
                    kind: AuthenticationWorkflowKind::Manual,
                    stage: AuthenticationWorkflowStage::Manual,
                    action: AuthenticationWorkflowAction::TakeOver,
                    progress: super::AuthenticationWorkflowProgress::Manual,
                },
            ));
        }

        if observation.password_field_count().is_nonzero() {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(super::AuthenticationWorkflowSnapshotDraft {
                    kind: AuthenticationWorkflowKind::Login,
                    stage: AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    action: AuthenticationWorkflowAction::continue_or_takeover(
                        observation.manual_checkpoint_present,
                    ),
                    progress: super::AuthenticationWorkflowProgress::LoginCredentials,
                })
                .with_saved_login_capability()
                .with_passkey_proposal(observation),
            );
        }

        if observation.username_field_count.is_nonzero() {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(super::AuthenticationWorkflowSnapshotDraft {
                    kind: AuthenticationWorkflowKind::Login,
                    stage: AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    action: AuthenticationWorkflowAction::continue_or_takeover(
                        observation.manual_checkpoint_present,
                    ),
                    progress: super::AuthenticationWorkflowProgress::LoginCredentials,
                })
                .with_saved_login_capability()
                .with_passkey_proposal(observation),
            );
        }

        if matches!(
            observation.passkey_control_present,
            AuthenticationPasskeyControlObservation::Present
        ) || observation.matching_passkey_account_count.is_nonzero()
        {
            return AuthenticationWorkflowMatch::Matched(
                AuthenticationWorkflowSnapshot::new(super::AuthenticationWorkflowSnapshotDraft {
                    kind: AuthenticationWorkflowKind::Login,
                    stage: AuthenticationWorkflowStage::credentials_or_manual(
                        observation.manual_checkpoint_present,
                    ),
                    action: if matches!(
                        observation.manual_checkpoint_present,
                        AuthenticationManualCheckpoint::Present
                    ) {
                        AuthenticationWorkflowAction::TakeOver
                    } else {
                        AuthenticationWorkflowAction::ContinueWithNook
                    },
                    progress: super::AuthenticationWorkflowProgress::LoginCredentials,
                })
                .with_passkey_proposal(observation),
            );
        }

        AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
            super::AuthenticationWorkflowSnapshotDraft {
                kind: AuthenticationWorkflowKind::Manual,
                stage: AuthenticationWorkflowStage::Manual,
                action: AuthenticationWorkflowAction::TakeOver,
                progress: super::AuthenticationWorkflowProgress::Manual,
            },
        ))
    }
}

impl AuthenticationPageObservation {
    pub fn classify_authentication_workflow(self) -> AuthenticationWorkflowMatch {
        AuthenticationWorkflowEvidence::from(self).classify_authentication_workflow()
    }
}
