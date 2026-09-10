//! Portable activity presentation; these values do not authorize actions.
use super::{AuthenticationWorkflowKind, AuthenticationWorkflowProgress};
use crate::{
    AuthenticationFieldCount, AuthenticationWorkflowCurrentStep, AuthenticationWorkflowTotalSteps,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, Copy, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct AuthenticationDisplayProgress {
    pub current_step: AuthenticationWorkflowCurrentStep,
    pub total_steps: AuthenticationWorkflowTotalSteps,
}
impl From<AuthenticationWorkflowProgress> for AuthenticationDisplayProgress {
    fn from(progress: AuthenticationWorkflowProgress) -> Self {
        Self {
            current_step: progress.current_step(),
            total_steps: progress.total_steps(),
        }
    }
}
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub enum AuthenticationWorkflowActivity {
    ReadyLogin,
    FillingLogin,
    VerifyingLogin,
    FillingAuthenticator,
    SaveOffer,
}
impl AuthenticationWorkflowActivity {
    #[must_use]
    pub fn progress(self) -> AuthenticationDisplayProgress {
        AuthenticationDisplayProgress {
            current_step: match self {
                Self::ReadyLogin => 1,
                Self::FillingLogin | Self::FillingAuthenticator => 2,
                Self::VerifyingLogin => 3,
                Self::SaveOffer => 4,
            }
            .into(),
            total_steps: match self {
                Self::SaveOffer => {
                    AuthenticationWorkflowProgress::PasswordChangeCredentials.total_steps()
                }
                _ => AuthenticationWorkflowProgress::LoginCredentials.total_steps(),
            },
        }
    }
}
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct PasswordWorkflowActivityEvidence {
    pub current_password_field_count: AuthenticationFieldCount,
    pub new_password_field_count: AuthenticationFieldCount,
}
#[derive(Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct PasswordWorkflowActivityPresentation {
    pub kind: AuthenticationWorkflowKind,
    pub generation_progress: AuthenticationDisplayProgress,
}
/// One classification owns both title and progress; they cannot disagree.
enum PasswordActivityWorkflow {
    Login,
    Signup,
    PasswordChange,
}
impl From<PasswordWorkflowActivityEvidence> for PasswordActivityWorkflow {
    fn from(evidence: PasswordWorkflowActivityEvidence) -> Self {
        if evidence.new_password_field_count.is_nonzero() {
            if evidence.current_password_field_count.is_nonzero() {
                Self::PasswordChange
            } else {
                Self::Signup
            }
        } else {
            Self::Login
        }
    }
}
impl From<PasswordActivityWorkflow> for PasswordWorkflowActivityPresentation {
    fn from(workflow: PasswordActivityWorkflow) -> Self {
        let (kind, progress) = match workflow {
            PasswordActivityWorkflow::Login => (
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowProgress::LoginCredentials,
            ),
            PasswordActivityWorkflow::Signup => (
                AuthenticationWorkflowKind::Signup,
                AuthenticationWorkflowProgress::SignupCredentials,
            ),
            PasswordActivityWorkflow::PasswordChange => (
                AuthenticationWorkflowKind::PasswordChange,
                AuthenticationWorkflowProgress::PasswordChangeCredentials,
            ),
        };
        Self {
            kind,
            generation_progress: progress.into(),
        }
    }
}
impl PasswordWorkflowActivityEvidence {
    #[must_use]
    pub fn project(self) -> PasswordWorkflowActivityPresentation {
        PasswordActivityWorkflow::from(self).into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_field_evidence_keeps_kind_and_progress_coherent() {
        for current in [0, 1, 2] {
            for new in [0, 1, 2] {
                let presentation = PasswordWorkflowActivityEvidence {
                    current_password_field_count: current.into(),
                    new_password_field_count: new.into(),
                }
                .project();
                let (kind, progress) = match (current, new) {
                    (_, 0) => (
                        AuthenticationWorkflowKind::Login,
                        AuthenticationWorkflowProgress::LoginCredentials,
                    ),
                    (0, _) => (
                        AuthenticationWorkflowKind::Signup,
                        AuthenticationWorkflowProgress::SignupCredentials,
                    ),
                    _ => (
                        AuthenticationWorkflowKind::PasswordChange,
                        AuthenticationWorkflowProgress::PasswordChangeCredentials,
                    ),
                };
                assert_eq!(presentation.kind, kind);
                assert_eq!(
                    presentation.generation_progress.current_step,
                    progress.current_step()
                );
                assert_eq!(
                    presentation.generation_progress.total_steps,
                    progress.total_steps()
                );
            }
        }
    }
}
