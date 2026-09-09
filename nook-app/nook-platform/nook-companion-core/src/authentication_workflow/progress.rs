//! Workflow progress owns its stable numeric presentation encoding.
use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticatorEnrollmentProgress {
    Setup,
    Verification,
    Recovery,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationWorkflowProgress {
    LoginCredentials,
    SignupCredentials,
    PasswordChangeCredentials,
    Challenge,
    Enrollment(AuthenticatorEnrollmentProgress),
    Manual,
}
impl AuthenticationWorkflowProgress {
    pub const fn current_step(self) -> AuthenticationWorkflowCurrentStep {
        AuthenticationWorkflowCurrentStep(match self {
            Self::LoginCredentials | Self::Manual => 1,
            Self::SignupCredentials
            | Self::PasswordChangeCredentials
            | Self::Challenge
            | Self::Enrollment(AuthenticatorEnrollmentProgress::Setup) => 2,
            Self::Enrollment(AuthenticatorEnrollmentProgress::Verification) => 3,
            Self::Enrollment(AuthenticatorEnrollmentProgress::Recovery) => 4,
        })
    }
    pub const fn total_steps(self) -> AuthenticationWorkflowTotalSteps {
        AuthenticationWorkflowTotalSteps(match self {
            Self::LoginCredentials | Self::Challenge => 3,
            Self::SignupCredentials | Self::Enrollment(_) => 5,
            Self::PasswordChangeCredentials => 4,
            Self::Manual => 1,
        })
    }
    // Admission requires workflow context: several different activities encode 2/5.
    pub(super) const fn admit(snapshot: AuthenticationWorkflowSnapshot) -> Option<Self> {
        let progress = match snapshot.kind {
            AuthenticationWorkflowKind::Login => Self::LoginCredentials,
            AuthenticationWorkflowKind::Signup => Self::SignupCredentials,
            AuthenticationWorkflowKind::PasswordChange => Self::PasswordChangeCredentials,
            AuthenticationWorkflowKind::TotpChallenge => Self::Challenge,
            AuthenticationWorkflowKind::Manual => Self::Manual,
            AuthenticationWorkflowKind::TotpEnrollment => {
                let enrollment = match snapshot.stage {
                    AuthenticationWorkflowStage::Setup => AuthenticatorEnrollmentProgress::Setup,
                    AuthenticationWorkflowStage::Verification => {
                        AuthenticatorEnrollmentProgress::Verification
                    }
                    AuthenticationWorkflowStage::Recovery => {
                        AuthenticatorEnrollmentProgress::Recovery
                    }
                    AuthenticationWorkflowStage::Manual => match snapshot.current_step {
                        AuthenticationWorkflowCurrentStep(2) => {
                            AuthenticatorEnrollmentProgress::Setup
                        }
                        AuthenticationWorkflowCurrentStep(3) => {
                            AuthenticatorEnrollmentProgress::Verification
                        }
                        AuthenticationWorkflowCurrentStep(4) => {
                            AuthenticatorEnrollmentProgress::Recovery
                        }
                        _ => return None,
                    },
                    _ => return None,
                };
                Self::Enrollment(enrollment)
            }
        };
        if snapshot.current_step.raw() == progress.current_step().raw()
            && snapshot.total_steps.raw() == progress.total_steps().raw()
        {
            Some(progress)
        } else {
            None
        }
    }
}

pub(super) struct AuthenticationWorkflowSnapshotDraft {
    pub kind: AuthenticationWorkflowKind,
    pub stage: AuthenticationWorkflowStage,
    pub action: AuthenticationWorkflowAction,
    pub progress: AuthenticationWorkflowProgress,
}
