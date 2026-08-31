//! Enrollment and recovery precedence for authenticator workflows.

use super::{
    AuthenticationPageObservation, AuthenticationPilotPresentationCapability,
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
    AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
    classify_authentication_backup_codes_observation,
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

/// Project page-level enrollment evidence through the same classifier and Pilot gate.
#[must_use]
pub fn authentication_enrollment_workflow_match(
    authenticator_setup_hint: bool,
    backup_codes_copy: &str,
    manual_checkpoint_present: bool,
) -> AuthenticationWorkflowMatch {
    if backup_codes_copy.len() > crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES {
        return AuthenticationWorkflowMatch::Rejected;
    }
    let backup_codes_hint = matches!(
        classify_authentication_backup_codes_observation(backup_codes_copy, false),
        super::AuthenticationBackupCodesObservation::Present
    );
    super::classify_authentication_workflow(AuthenticationPageObservation {
        manual_checkpoint_present,
        authenticator_setup_hint,
        backup_codes_hint,
        ..AuthenticationPageObservation::default()
    })
}

/// Project page-level enrollment evidence through the same classifier and Pilot gate.
#[must_use]
pub fn authentication_enrollment_pilot_presentation_capability(
    authenticator_setup_hint: bool,
    backup_codes_copy: &str,
    manual_checkpoint_present: bool,
) -> AuthenticationPilotPresentationCapability {
    match authentication_enrollment_workflow_match(
        authenticator_setup_hint,
        backup_codes_copy,
        manual_checkpoint_present,
    ) {
        AuthenticationWorkflowMatch::Matched(snapshot) => snapshot.pilot_presentation_capability(),
        AuthenticationWorkflowMatch::NoMatch | AuthenticationWorkflowMatch::Rejected => {
            AuthenticationPilotPresentationCapability::Hidden
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enrollment_fast_path_hides_checkpointed_surfaces() {
        assert_eq!(
            authentication_enrollment_pilot_presentation_capability(true, "", true),
            AuthenticationPilotPresentationCapability::Hidden
        );
        assert_eq!(
            authentication_enrollment_pilot_presentation_capability(
                false,
                "Save your recovery codes",
                false,
            ),
            AuthenticationPilotPresentationCapability::ProposeAction
        );
    }

    #[test]
    fn enrollment_fast_path_preserves_recovery_precedence() {
        let AuthenticationWorkflowMatch::Matched(snapshot) =
            authentication_enrollment_workflow_match(true, "Save your recovery codes", false)
        else {
            panic!("expected a selected enrollment workflow");
        };
        assert_eq!(
            snapshot.action,
            AuthenticationWorkflowAction::SaveBackupCodes
        );
    }
}
