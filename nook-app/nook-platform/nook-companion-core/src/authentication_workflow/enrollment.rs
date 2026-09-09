use super::{
    AuthenticationAuthenticatorSetupObservation, AuthenticationManualCheckpoint,
    AuthenticationWorkflowAction, AuthenticationWorkflowEvidence, AuthenticationWorkflowKind,
    AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
};
use crate::AuthenticationBackupCodesEvidence;
use crate::AuthenticationBackupCodesObservation;
use crate::BackupCodeCandidatePresence;

impl AuthenticationWorkflowEvidence {
    pub(super) const fn classify_enrollment_workflow(self) -> AuthenticationWorkflowMatch {
        let observation = self;
        if matches!(
            observation.manual_checkpoint_present,
            AuthenticationManualCheckpoint::Present
        ) && (matches!(
            observation.authenticator_setup_hint,
            AuthenticationAuthenticatorSetupObservation::Present
        ) || matches!(
            observation.backup_codes_hint,
            AuthenticationBackupCodesObservation::Present
        )) {
            let current_step = if matches!(
                observation.backup_codes_hint,
                AuthenticationBackupCodesObservation::Present
            ) && observation.one_time_code_field_count.raw() == 0
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
        if matches!(
            observation.backup_codes_hint,
            AuthenticationBackupCodesObservation::Present
        ) && observation.one_time_code_field_count.raw() == 0
        {
            return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Recovery,
                AuthenticationWorkflowAction::SaveBackupCodes,
                4,
                5,
            ));
        }
        if matches!(
            observation.authenticator_setup_hint,
            AuthenticationAuthenticatorSetupObservation::Present
        ) {
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
    pub authenticator_setup_hint: AuthenticationAuthenticatorSetupObservation,
    pub backup_codes_copy: &'a str,
    pub manual_checkpoint_present: AuthenticationManualCheckpoint,
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
        let backup_codes_hint =
            AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
                AuthenticationBackupCodesEvidence {
                    text: backup_codes_copy,
                    candidate_presence: BackupCodeCandidatePresence::Absent,
                },
            );
        (AuthenticationWorkflowEvidence {
            manual_checkpoint_present,
            authenticator_setup_hint,
            backup_codes_hint,
            ..AuthenticationWorkflowEvidence::default()
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
                    authenticator_setup_hint: true.into(),
                    backup_codes_copy: "Save your recovery codes",
                    manual_checkpoint_present: false.into(),
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
