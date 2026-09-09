use super::{
    AuthenticationPageObservation, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
};
use crate::AuthenticationBackupCodesEvidence;
use crate::AuthenticationBackupCodesObservation;
use crate::BackupCodeCandidatePresence;

impl AuthenticationPageObservation {
    pub(super) const fn classify_enrollment_workflow(self) -> AuthenticationWorkflowMatch {
        let observation = self;
        if observation.manual_checkpoint_present
            && (observation.authenticator_setup_hint || observation.backup_codes_hint)
        {
            let current_step = if observation.backup_codes_hint
                && observation.one_time_code_field_count.raw() == 0
            {
                4
            } else if observation.one_time_code_field_count.raw() > 0 {
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
        if observation.backup_codes_hint && observation.one_time_code_field_count.raw() == 0 {
            return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Recovery,
                AuthenticationWorkflowAction::SaveBackupCodes,
                4,
                5,
            ));
        }
        if observation.authenticator_setup_hint {
            if observation.one_time_code_field_count.raw() > 0 {
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
}

/// Named values required by AuthenticationWorkflowMatch::authentication_enrollment_workflow_match.
pub struct AuthenticationEnrollmentObservation<'a> {
    pub authenticator_setup_hint: bool,
    pub backup_codes_copy: &'a str,
    pub manual_checkpoint_present: bool,
}

impl AuthenticationWorkflowMatch {
    #[must_use]
    pub fn authentication_enrollment_workflow_match(
        request: AuthenticationEnrollmentObservation<'_>,
    ) -> AuthenticationWorkflowMatch {
        let AuthenticationEnrollmentObservation {
            authenticator_setup_hint,
            backup_codes_copy,
            manual_checkpoint_present,
        } = request;
        if backup_codes_copy.len() > crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES {
            return AuthenticationWorkflowMatch::Rejected;
        }
        let backup_codes_hint = matches!(
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: backup_codes_copy,
                    candidate_presence: BackupCodeCandidatePresence::Absent
                }
            ),
            super::AuthenticationBackupCodesObservation::Present
        );
        (AuthenticationPageObservation {
            manual_checkpoint_present,
            authenticator_setup_hint,
            backup_codes_hint,
            ..AuthenticationPageObservation::default()
        })
        .classify_authentication_workflow()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enrollment_fast_path_preserves_recovery_precedence() {
        let AuthenticationWorkflowMatch::Matched(snapshot) =
            AuthenticationWorkflowMatch::authentication_enrollment_workflow_match(
                AuthenticationEnrollmentObservation {
                    authenticator_setup_hint: true,
                    backup_codes_copy: "Save your recovery codes",
                    manual_checkpoint_present: false,
                },
            )
        else {
            panic!("expected a selected enrollment workflow");
        };
        assert_eq!(
            snapshot.action,
            AuthenticationWorkflowAction::SaveBackupCodes
        );
    }
}
