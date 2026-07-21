//! Portable authentication-workflow classification for browser companions.
//!
//! Browser adapters report only structural, non-secret observations. This
//! module owns the product decision about which workflow is present, where the
//! user is in it, and which action Nook may offer next.

use crate::auth::website_passkey_proposal::{WebsitePasskeyProposal, propose_website_passkey};
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
    TotpEnrollment,
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
            Self::TotpEnrollment => "totp-enrollment",
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
    Setup,
    Recovery,
    Manual,
}

impl AuthenticationWorkflowStage {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Credentials => "credentials",
            Self::SecondFactor => "second-factor",
            Self::Verification => "verification",
            Self::Setup => "setup",
            Self::Recovery => "recovery",
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
    EnrollAuthenticator,
    UsePasskey,
    CreatePasskey,
    TakeOver,
}

impl AuthenticationWorkflowAction {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ContinueWithNook => "continue-with-nook",
            Self::GeneratePassword => "generate-password",
            Self::FillTotp => "fill-totp",
            Self::EnrollAuthenticator => "enroll-authenticator",
            Self::UsePasskey => "use-passkey",
            Self::CreatePasskey => "create-passkey",
            Self::TakeOver => "take-over",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[allow(clippy::struct_excessive_bools)]
pub struct AuthenticationPageObservation {
    pub username_field_count: u32,
    pub current_password_field_count: u32,
    pub new_password_field_count: u32,
    pub generic_password_field_count: u32,
    pub one_time_code_field_count: u32,
    /// CAPTCHA, legal acceptance, email verification, or similar human gate.
    pub manual_checkpoint_present: bool,
    /// Visible authenticator QR / otpauth setup material on the page.
    pub authenticator_setup_hint: bool,
    /// Visible recovery / backup-code material on the page.
    pub backup_codes_hint: bool,
    /// Page exposes a passkey / `WebAuthn` control the user can activate.
    pub passkey_control_present: bool,
    /// Unlocked vault match count for the requesting RP (0 when locked).
    pub matching_passkey_account_count: u32,
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
            || self.authenticator_setup_hint
            || self.backup_codes_hint
            || self.passkey_control_present
            || self.matching_passkey_account_count > 0
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
    pub observation_index: u32,
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
            observation_index: 0,
        }
    }
}

const fn workflow_candidate_priority(snapshot: AuthenticationWorkflowSnapshot) -> u8 {
    match (snapshot.kind, snapshot.action) {
        (AuthenticationWorkflowKind::TotpEnrollment, _) => 8,
        (AuthenticationWorkflowKind::TotpChallenge, _)
        | (AuthenticationWorkflowKind::Login, AuthenticationWorkflowAction::UsePasskey) => 7,
        (AuthenticationWorkflowKind::Login, AuthenticationWorkflowAction::ContinueWithNook) => 6,
        (AuthenticationWorkflowKind::Login, AuthenticationWorkflowAction::CreatePasskey)
        | (AuthenticationWorkflowKind::PasswordChange, _)
        | (AuthenticationWorkflowKind::Signup, AuthenticationWorkflowAction::UsePasskey) => 5,
        (AuthenticationWorkflowKind::Signup, _) => 4,
        (AuthenticationWorkflowKind::Login, _) => 2,
        (AuthenticationWorkflowKind::Manual, _) => 1,
    }
}

#[must_use]
pub fn classify_authentication_workflow_candidates(
    observations: &[AuthenticationPageObservation],
) -> Option<AuthenticationWorkflowSnapshot> {
    let mut selected: Option<AuthenticationWorkflowSnapshot> = None;
    for (index, observation) in observations.iter().copied().enumerate() {
        let Some(mut candidate) = classify_authentication_workflow(observation) else {
            continue;
        };
        candidate.observation_index = u32::try_from(index).unwrap_or(u32::MAX);
        if selected.is_none_or(|current| {
            workflow_candidate_priority(candidate) > workflow_candidate_priority(current)
        }) {
            selected = Some(candidate);
        }
    }
    selected
}

const fn classify_enrollment_workflow(
    observation: AuthenticationPageObservation,
) -> Option<AuthenticationWorkflowSnapshot> {
    if observation.authenticator_setup_hint {
        if observation.one_time_code_field_count > 0 {
            return Some(AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Verification,
                AuthenticationWorkflowAction::FillTotp,
                3,
                5,
            ));
        }
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::TotpEnrollment,
            AuthenticationWorkflowStage::Setup,
            AuthenticationWorkflowAction::EnrollAuthenticator,
            2,
            5,
        ));
    }
    if observation.backup_codes_hint {
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::TotpEnrollment,
            AuthenticationWorkflowStage::Recovery,
            AuthenticationWorkflowAction::TakeOver,
            4,
            5,
        ));
    }
    None
}

const fn generate_or_takeover(manual_checkpoint_present: bool) -> AuthenticationWorkflowAction {
    if manual_checkpoint_present {
        AuthenticationWorkflowAction::TakeOver
    } else {
        AuthenticationWorkflowAction::GeneratePassword
    }
}

const fn credentials_or_manual(manual_checkpoint_present: bool) -> AuthenticationWorkflowStage {
    if manual_checkpoint_present {
        AuthenticationWorkflowStage::Manual
    } else {
        AuthenticationWorkflowStage::Credentials
    }
}

const fn apply_passkey_proposal(
    observation: AuthenticationPageObservation,
    mut snapshot: AuthenticationWorkflowSnapshot,
) -> AuthenticationWorkflowSnapshot {
    match propose_website_passkey(
        snapshot.kind,
        observation.manual_checkpoint_present,
        observation.passkey_control_present,
        observation.matching_passkey_account_count,
    ) {
        WebsitePasskeyProposal::None => snapshot,
        WebsitePasskeyProposal::UsePasskey { .. } => {
            snapshot.action = AuthenticationWorkflowAction::UsePasskey;
            snapshot
        }
        WebsitePasskeyProposal::CreatePasskey => {
            snapshot.action = AuthenticationWorkflowAction::CreatePasskey;
            snapshot
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
    if let Some(enrollment) = classify_enrollment_workflow(observation) {
        return Some(enrollment);
    }

    if observation.current_password_field_count > 0 && observation.new_password_field_count > 0 {
        return Some(apply_passkey_proposal(
            observation,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::PasswordChange,
                credentials_or_manual(observation.manual_checkpoint_present),
                generate_or_takeover(observation.manual_checkpoint_present),
                2,
                4,
            ),
        ));
    }

    if observation.new_password_field_count > 0 {
        return Some(apply_passkey_proposal(
            observation,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Signup,
                credentials_or_manual(observation.manual_checkpoint_present),
                generate_or_takeover(observation.manual_checkpoint_present),
                2,
                5,
            ),
        ));
    }

    if observation.one_time_code_field_count > 0 {
        let action = if observation.password_field_count() == 0 {
            AuthenticationWorkflowAction::FillTotp
        } else {
            AuthenticationWorkflowAction::TakeOver
        };
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::TotpChallenge,
            AuthenticationWorkflowStage::SecondFactor,
            action,
            2,
            3,
        ));
    }

    if (observation.current_password_field_count > 0
        && observation.generic_password_field_count > 0)
        || observation.generic_password_field_count > 1
    {
        return Some(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::Manual,
            AuthenticationWorkflowStage::Manual,
            AuthenticationWorkflowAction::TakeOver,
            1,
            1,
        ));
    }

    if observation.password_field_count() > 0 {
        return Some(apply_passkey_proposal(
            observation,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::ContinueWithNook,
                1,
                3,
            ),
        ));
    }

    if observation.username_field_count > 0 {
        return Some(apply_passkey_proposal(
            observation,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::ContinueWithNook,
                1,
                3,
            ),
        ));
    }

    if observation.passkey_control_present || observation.matching_passkey_account_count > 0 {
        return Some(apply_passkey_proposal(
            observation,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::TakeOver,
                1,
                3,
            ),
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
        assert_eq!(login.action, AuthenticationWorkflowAction::ContinueWithNook);
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
        assert_eq!(
            signup.action,
            AuthenticationWorkflowAction::GeneratePassword
        );
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
        assert_eq!(
            password_change.action,
            AuthenticationWorkflowAction::GeneratePassword
        );
        assert_eq!(
            (password_change.current_step, password_change.total_steps),
            (2, 4)
        );
    }

    #[test]
    fn signup_with_manual_checkpoint_yields_to_takeover() {
        let signup = AuthenticationPageObservation {
            username_field_count: 1,
            new_password_field_count: 1,
            manual_checkpoint_present: true,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(signup).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Signup);
        assert_eq!(snapshot.stage, AuthenticationWorkflowStage::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
    }

    #[test]
    fn classifies_authenticator_setup_and_verify_enrollment() {
        let setup = AuthenticationPageObservation {
            authenticator_setup_hint: true,
            ..observation()
        };
        let setup = classify_authentication_workflow(setup).unwrap();
        assert_eq!(setup.kind, AuthenticationWorkflowKind::TotpEnrollment);
        assert_eq!(setup.stage, AuthenticationWorkflowStage::Setup);
        assert_eq!(
            setup.action,
            AuthenticationWorkflowAction::EnrollAuthenticator
        );

        let verify = AuthenticationPageObservation {
            authenticator_setup_hint: true,
            one_time_code_field_count: 1,
            ..observation()
        };
        let verify = classify_authentication_workflow(verify).unwrap();
        assert_eq!(verify.kind, AuthenticationWorkflowKind::TotpEnrollment);
        assert_eq!(verify.stage, AuthenticationWorkflowStage::Verification);
        assert_eq!(verify.action, AuthenticationWorkflowAction::FillTotp);
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
    fn combined_password_and_code_fields_yield_to_manual_second_factor() {
        let combined = AuthenticationPageObservation {
            current_password_field_count: 1,
            one_time_code_field_count: 1,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(combined).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(snapshot.stage, AuthenticationWorkflowStage::SecondFactor);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
    }

    #[test]
    fn generic_multi_password_forms_never_offer_login_fill() {
        let ambiguous = AuthenticationPageObservation {
            username_field_count: 1,
            generic_password_field_count: 2,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(ambiguous).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
    }

    #[test]
    fn current_plus_generic_password_forms_never_offer_login_fill() {
        let ambiguous_change = AuthenticationPageObservation {
            current_password_field_count: 1,
            generic_password_field_count: 1,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(ambiguous_change).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
    }

    #[test]
    fn separate_login_form_takes_precedence_over_signup_or_password_reset() {
        let signup = AuthenticationPageObservation {
            username_field_count: 1,
            new_password_field_count: 1,
            ..observation()
        };
        let login = AuthenticationPageObservation {
            username_field_count: 1,
            current_password_field_count: 1,
            ..observation()
        };

        let snapshot = classify_authentication_workflow_candidates(&[signup, login]).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(
            snapshot.action,
            AuthenticationWorkflowAction::ContinueWithNook
        );
        assert_eq!(snapshot.observation_index, 1);
    }

    #[test]
    fn active_totp_takes_precedence_over_unrelated_signup() {
        let signup = AuthenticationPageObservation {
            username_field_count: 1,
            new_password_field_count: 1,
            ..observation()
        };
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            ..observation()
        };

        let snapshot = classify_authentication_workflow_candidates(&[signup, code]).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::FillTotp);
        assert_eq!(snapshot.observation_index, 1);
    }

    #[test]
    fn login_with_matching_passkeys_proposes_use() {
        let login = AuthenticationPageObservation {
            current_password_field_count: 1,
            matching_passkey_account_count: 2,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(login).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::UsePasskey);
        assert!(snapshot.requires_human_approval);
    }

    #[test]
    fn passkey_control_without_matches_proposes_create() {
        let login = AuthenticationPageObservation {
            username_field_count: 1,
            passkey_control_present: true,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(login).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::CreatePasskey);
    }

    #[test]
    fn passkey_only_control_classifies_as_login_create() {
        let passkey_only = AuthenticationPageObservation {
            passkey_control_present: true,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(passkey_only).unwrap();
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::CreatePasskey);
    }

    #[test]
    fn matching_passkeys_prefer_use_over_password_continue_candidate() {
        let password_login = AuthenticationPageObservation {
            current_password_field_count: 1,
            ..observation()
        };
        let passkey_login = AuthenticationPageObservation {
            passkey_control_present: true,
            matching_passkey_account_count: 1,
            ..observation()
        };
        let snapshot =
            classify_authentication_workflow_candidates(&[password_login, passkey_login]).unwrap();
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::UsePasskey);
        assert_eq!(snapshot.observation_index, 1);
    }
}
