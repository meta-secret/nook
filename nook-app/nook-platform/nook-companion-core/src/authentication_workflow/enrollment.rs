//! Enrollment and recovery precedence for authenticator workflows.

use super::{
    AuthenticationPageObservation, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
};

pub(super) const fn classify_enrollment_workflow(
    observation: AuthenticationPageObservation,
) -> AuthenticationWorkflowMatch {
    if observation.manual_checkpoint_present
        && (observation.authenticator_setup_hint || observation.backup_codes_hint)
    {
        let current_step =
            if observation.backup_codes_hint && observation.one_time_code_field_count == 0 {
                4
            } else if observation.one_time_code_field_count > 0 {
                3
            } else {
                2
            };
        return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::TotpEnrollment,
            AuthenticationWorkflowStage::Manual,
            AuthenticationWorkflowAction::TakeOver,
            current_step,
            5,
        ));
    }
    if observation.backup_codes_hint && observation.one_time_code_field_count == 0 {
        return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::TotpEnrollment,
            AuthenticationWorkflowStage::Recovery,
            AuthenticationWorkflowAction::SaveBackupCodes,
            4,
            5,
        ));
    }
    if observation.authenticator_setup_hint {
        if observation.one_time_code_field_count > 0 {
            return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Verification,
                AuthenticationWorkflowAction::FillTotp,
                3,
                5,
            ));
        }
        return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::TotpEnrollment,
            AuthenticationWorkflowStage::Setup,
            AuthenticationWorkflowAction::EnrollAuthenticator,
            2,
            5,
        ));
    }
    AuthenticationWorkflowMatch::NoMatch
}
