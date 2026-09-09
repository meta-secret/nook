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
impl PasswordWorkflowActivityEvidence {
    pub fn project(self) -> PasswordWorkflowActivityPresentation {
        let kind = if self.current_password_field_count.is_nonzero()
            && self.new_password_field_count.is_nonzero()
        {
            AuthenticationWorkflowKind::PasswordChange
        } else if self.new_password_field_count.is_nonzero() {
            AuthenticationWorkflowKind::Signup
        } else {
            AuthenticationWorkflowKind::Login
        };
        let generation = if self.current_password_field_count.is_nonzero() {
            AuthenticationWorkflowProgress::PasswordChangeCredentials
        } else {
            AuthenticationWorkflowProgress::SignupCredentials
        };
        PasswordWorkflowActivityPresentation {
            kind,
            generation_progress: generation.into(),
        }
    }
}
