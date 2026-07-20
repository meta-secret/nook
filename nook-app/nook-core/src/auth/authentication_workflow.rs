//! Portable authentication-workflow classification for browser companions.
//!
//! Browser adapters report only structural, non-secret observations. This
//! module owns the product decision about which workflow is present, where the
//! user is in it, and which action Nook may offer next.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthenticationWorkflowKind {
    Login,
    Signup,
    PasswordChange,
    TotpChallenge,
    Manual,
}

impl AuthenticationWorkflowKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::Signup => "signup",
            Self::PasswordChange => "password-change",
            Self::TotpChallenge => "totp-challenge",
            Self::Manual => "manual",
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthenticationWorkflowStage {
    Credentials,
    SecondFactor,
    Verification,
    Manual,
}

impl AuthenticationWorkflowStage {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Credentials => "credentials",
            Self::SecondFactor => "second-factor",
            Self::Verification => "verification",
            Self::Manual => "manual",
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthenticationWorkflowAction {
    ContinueWithNook,
    GeneratePassword,
    FillTotp,
    TakeOver,
}

impl AuthenticationWorkflowAction {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ContinueWithNook => "continue-with-nook",
            Self::GeneratePassword => "generate-password",
            Self::FillTotp => "fill-totp",
            Self::TakeOver => "take-over",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AuthenticationPageObservation {
    pub username_field_count: u32,
    pub current_password_field_count: u32,
    pub new_password_field_count: u32,
    pub generic_password_field_count: u32,
    pub one_time_code_field_count: u32,
}

impl AuthenticationPageObservation {
    #[must_use]
    pub const fn password_field_count(self) -> u32 {
        self.current_password_field_count
            .saturating_add(self.new_password_field_count)
            .saturating_add(self.generic_password_field_count)
    }

    #[must_use]
    pub const fn has_authentication_fields(self) -> bool {
        self.username_field_count > 0
            || self.password_field_count() > 0
            || self.one_time_code_field_count > 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthenticationWorkflowSnapshot {
    pub kind: AuthenticationWorkflowKind,
    pub stage: AuthenticationWorkflowStage,
    pub action: AuthenticationWorkflowAction,
    pub current_step: u8,
    pub total_steps: u8,
    pub requires_human_approval: bool,
}

impl AuthenticationWorkflowSnapshot {
    const fn new(
        kind: AuthenticationWorkflowKind,
        stage: AuthenticationWorkflowStage,
        action: AuthenticationWorkflowAction,
        current_step: u8,
        total_steps: u8,
    ) -> Self {
        Self {
            kind,
            stage,
            action,
            current_step,
            total_steps,
            requires_human_approval: true,
        }
    }
}

#[must_use]
pub const fn classify_authentication_workflow(
    observation: AuthenticationPageObservation,
) -> Option<AuthenticationWorkflowSnapshot> {
    if !observation.has_authentication_fields() {
        return None;
    }

    if observation.current_password_field_count > 0 && observation.new_password_field_count > 0 {
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::PasswordChange,
            AuthenticationWorkflowStage::Credentials,
            AuthenticationWorkflowAction::GeneratePassword,
            2,
            4,
        ));
    }

    if observation.new_password_field_count > 0 {
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::Signup,
            AuthenticationWorkflowStage::Credentials,
            AuthenticationWorkflowAction::GeneratePassword,
            2,
            5,
        ));
    }

    if observation.one_time_code_field_count > 0 && observation.password_field_count() == 0 {
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::TotpChallenge,
            AuthenticationWorkflowStage::SecondFactor,
            AuthenticationWorkflowAction::FillTotp,
            2,
            3,
        ));
    }

    if observation.password_field_count() > 0 {
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::Login,
            AuthenticationWorkflowStage::Credentials,
            AuthenticationWorkflowAction::ContinueWithNook,
            1,
            3,
        ));
    }

    if observation.username_field_count > 0 {
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::Login,
            AuthenticationWorkflowStage::Credentials,
            AuthenticationWorkflowAction::TakeOver,
            1,
            3,
        ));
    }

    Some(AuthenticationWorkflowSnapshot::new(
        AuthenticationWorkflowKind::Manual,
        AuthenticationWorkflowStage::Manual,
        AuthenticationWorkflowAction::TakeOver,
        1,
        1,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation() -> AuthenticationPageObservation {
        AuthenticationPageObservation::default()
    }

    #[test]
    fn ignores_pages_without_authentication_fields() {
        assert_eq!(classify_authentication_workflow(observation()), None);
    }

    #[test]
    fn classifies_single_and_multi_page_logins() {
        let username_only = AuthenticationPageObservation {
            username_field_count: 1,
            ..observation()
        };
        let login = classify_authentication_workflow(username_only).unwrap();
        assert_eq!(login.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(login.action, AuthenticationWorkflowAction::TakeOver);
        assert_eq!((login.current_step, login.total_steps), (1, 3));
        assert!(login.requires_human_approval);

        let password_login = AuthenticationPageObservation {
            current_password_field_count: 1,
            ..observation()
        };
        assert_eq!(
            classify_authentication_workflow(password_login).unwrap(),
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::ContinueWithNook,
                1,
                3,
            )
        );
    }

    #[test]
    fn distinguishes_signup_from_password_change() {
        let signup = AuthenticationPageObservation {
            username_field_count: 1,
            new_password_field_count: 2,
            ..observation()
        };
        let signup = classify_authentication_workflow(signup).unwrap();
        assert_eq!(signup.kind, AuthenticationWorkflowKind::Signup);
        assert_eq!(signup.action, AuthenticationWorkflowAction::GeneratePassword);
        assert_eq!((signup.current_step, signup.total_steps), (2, 5));

        let password_change = AuthenticationPageObservation {
            current_password_field_count: 1,
            new_password_field_count: 2,
            ..observation()
        };
        let password_change = classify_authentication_workflow(password_change).unwrap();
        assert_eq!(
            password_change.kind,
            AuthenticationWorkflowKind::PasswordChange
        );
        assert_eq!((password_change.current_step, password_change.total_steps), (2, 4));
    }

    #[test]
    fn classifies_standalone_one_time_code_as_second_factor() {
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            ..observation()
        };
        let code = classify_authentication_workflow(code).unwrap();
        assert_eq!(code.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(code.stage, AuthenticationWorkflowStage::SecondFactor);
        assert_eq!(code.action, AuthenticationWorkflowAction::FillTotp);
        assert_eq!((code.current_step, code.total_steps), (2, 3));
    }

    #[test]
    fn password_fields_take_precedence_over_a_colocated_code_field() {
        let combined = AuthenticationPageObservation {
            current_password_field_count: 1,
            one_time_code_field_count: 1,
            ..observation()
        };
        assert_eq!(
            classify_authentication_workflow(combined).unwrap().kind,
            AuthenticationWorkflowKind::Login
        );
    }
}
