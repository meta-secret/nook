//! Portable authentication-workflow classification for browser companions.
//!
//! Browser adapters report only structural, non-secret observations. This
//! module owns the product decision about which workflow is present, where the
//! user is in it, and which action Nook may offer next.

mod candidate_selection;
mod enrollment;
mod observation_binding;
mod observation_facts;
mod observation_validation;
mod snapshot_contract;
mod vocabulary;

pub use candidate_selection::{
    AuthenticationFormObservationPriority, authentication_form_observation_priority,
    classify_authentication_workflow_candidates,
};
pub use enrollment::{
    authentication_enrollment_pilot_presentation_capability,
    authentication_enrollment_workflow_match,
};
pub use observation_binding::{
    AuthenticationObservationBindingError, AuthenticationObservationBindingToken,
    authentication_page_observation_facts_match_binding,
    bind_authentication_page_observation_facts,
};
pub use observation_facts::{
    AuthenticationAuthenticatorObservationFacts, AuthenticationAuthenticatorSetupObservation,
    AuthenticationBackupCodesObservation, AuthenticationCeremonyContextObservation,
    AuthenticationCeremonyObservationFacts, AuthenticationCredentialSubmissionFacts,
    AuthenticationCredentialSubmissionObservation, AuthenticationDetailedAdvanceControlObservation,
    AuthenticationDetailedPasskeyControlCandidateObservation,
    AuthenticationDetailedPasskeyControlObservation, AuthenticationFieldObservationFacts,
    AuthenticationPageObservationFacts, AuthenticationPageObservationFactsBatch,
    AuthenticationPasskeyControlObservation, authentication_page_observation_facts_priority,
    authentication_passkey_control_candidate_is_safe,
    authentication_passkey_control_evidence_is_safe,
    classify_authentication_backup_codes_observation,
};
pub use observation_validation::{
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    authentication_page_observations_are_valid,
};
pub use vocabulary::{
    AuthenticationPilotPresentationCapability, AuthenticationSavedLoginCapability,
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowStage,
};

use crate::website_passkey_proposal::{WebsitePasskeyProposal, propose_website_passkey};
use enrollment::classify_enrollment_workflow;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationManualCheckpoint {
    #[default]
    Absent,
    Present,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationEnrollmentEvidence {
    #[default]
    Absent,
    AuthenticatorSetup,
    BackupCodes,
    AuthenticatorSetupAndBackupCodes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationAdvanceControlEvidence {
    #[default]
    Absent,
    Present,
    /// The browser owns a form that supports submission without a control element.
    ImplicitSubmission,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationOneTimeCodeProgressionEvidence {
    #[default]
    AdvanceControlRequired,
    AutoSubmitObserved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationPasskeyEvidence {
    #[default]
    Absent,
    Control,
    VaultAccounts {
        account_count: u32,
    },
    ControlAndVaultAccounts {
        account_count: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationApprovalRequirement {
    ExplicitUserApproval,
    TakeoverRequired,
}

impl AuthenticationApprovalRequirement {
    #[must_use]
    pub const fn for_action(action: AuthenticationWorkflowAction) -> Self {
        if matches!(action, AuthenticationWorkflowAction::TakeOver) {
            Self::TakeoverRequired
        } else {
            Self::ExplicitUserApproval
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationWorkflowSnapshot {
    pub kind: AuthenticationWorkflowKind,
    pub stage: AuthenticationWorkflowStage,
    pub action: AuthenticationWorkflowAction,
    pub current_step: u8,
    pub total_steps: u8,
    pub approval_requirement: AuthenticationApprovalRequirement,
    pub saved_login_capability: AuthenticationSavedLoginCapability,
    pub observation_index: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "snapshot", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationWorkflowMatch {
    NoMatch,
    Rejected,
    Matched(AuthenticationWorkflowSnapshot),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationPageObservations {
    pub observations: Vec<AuthenticationPageObservation>,
}

impl AuthenticationWorkflowMatch {
    pub const fn snapshot(
        self,
    ) -> Result<AuthenticationWorkflowSnapshot, AuthenticationWorkflowSnapshotError> {
        match self {
            Self::NoMatch => Err(AuthenticationWorkflowSnapshotError::NotDetected),
            Self::Rejected => Err(AuthenticationWorkflowSnapshotError::Rejected),
            Self::Matched(snapshot) => Ok(snapshot),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AuthenticationWorkflowSnapshotError {
    #[error("authentication workflow was not detected")]
    NotDetected,
    #[error("authentication workflow observations were rejected")]
    Rejected,
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
            approval_requirement: AuthenticationApprovalRequirement::for_action(action),
            saved_login_capability: AuthenticationSavedLoginCapability::Unavailable,
            observation_index: 0,
        }
    }

    const fn with_saved_login_capability(mut self) -> Self {
        if matches!(self.kind, AuthenticationWorkflowKind::Login)
            && matches!(self.stage, AuthenticationWorkflowStage::Credentials)
        {
            self.saved_login_capability = AuthenticationSavedLoginCapability::FillSavedLogin;
        }
        self
    }

    #[must_use]
    pub const fn approval_requirement_matches_action(self) -> bool {
        matches!(
            (
                self.approval_requirement,
                AuthenticationApprovalRequirement::for_action(self.action)
            ),
            (
                AuthenticationApprovalRequirement::ExplicitUserApproval,
                AuthenticationApprovalRequirement::ExplicitUserApproval,
            ) | (
                AuthenticationApprovalRequirement::TakeoverRequired,
                AuthenticationApprovalRequirement::TakeoverRequired,
            )
        )
    }

    #[must_use]
    pub const fn saved_login_capability(self) -> AuthenticationSavedLoginCapability {
        if self.matches_classifier_contract() {
            self.saved_login_capability
        } else {
            AuthenticationSavedLoginCapability::Unavailable
        }
    }
    #[must_use]
    pub fn requires_login_match_availability(self) -> bool {
        self.saved_login_capability() == AuthenticationSavedLoginCapability::FillSavedLogin
            && matches!(
                self.action,
                AuthenticationWorkflowAction::UsePasskey
                    | AuthenticationWorkflowAction::CreatePasskey
            )
    }

    #[must_use]
    pub const fn pilot_presentation_capability(self) -> AuthenticationPilotPresentationCapability {
        if !self.matches_classifier_contract()
            || !matches!(
                self.approval_requirement,
                AuthenticationApprovalRequirement::ExplicitUserApproval
            )
        {
            return AuthenticationPilotPresentationCapability::Hidden;
        }
        match self.action {
            AuthenticationWorkflowAction::ContinueWithNook
            | AuthenticationWorkflowAction::GeneratePassword
            | AuthenticationWorkflowAction::FillTotp
            | AuthenticationWorkflowAction::EnrollAuthenticator
            | AuthenticationWorkflowAction::SaveBackupCodes
            | AuthenticationWorkflowAction::UsePasskey
            | AuthenticationWorkflowAction::CreatePasskey => {
                AuthenticationPilotPresentationCapability::ProposeAction
            }
            AuthenticationWorkflowAction::TakeOver => {
                AuthenticationPilotPresentationCapability::Hidden
            }
        }
    }
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

const fn continue_or_takeover(manual_checkpoint_present: bool) -> AuthenticationWorkflowAction {
    if manual_checkpoint_present {
        AuthenticationWorkflowAction::TakeOver
    } else {
        AuthenticationWorkflowAction::ContinueWithNook
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
            snapshot.approval_requirement =
                AuthenticationApprovalRequirement::for_action(snapshot.action);
            snapshot
        }
        WebsitePasskeyProposal::CreatePasskey => {
            snapshot.action = AuthenticationWorkflowAction::CreatePasskey;
            snapshot.approval_requirement =
                AuthenticationApprovalRequirement::for_action(snapshot.action);
            snapshot
        }
    }
}

#[must_use]
#[allow(clippy::too_many_lines)] // One exhaustive decision table keeps workflow precedence visible.
pub const fn classify_authentication_workflow(
    observation: AuthenticationPageObservation,
) -> AuthenticationWorkflowMatch {
    if !observation.has_authentication_fields() {
        return AuthenticationWorkflowMatch::NoMatch;
    }
    if let AuthenticationWorkflowMatch::Matched(enrollment) =
        classify_enrollment_workflow(observation)
    {
        return AuthenticationWorkflowMatch::Matched(enrollment);
    }

    if observation.current_password_field_count > 0 && observation.new_password_field_count > 0 {
        return AuthenticationWorkflowMatch::Matched(apply_passkey_proposal(
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
        return AuthenticationWorkflowMatch::Matched(apply_passkey_proposal(
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
        let (stage, action) = if observation.manual_checkpoint_present {
            (
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
            )
        } else if observation.password_field_count() == 0 {
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
            AuthenticationWorkflowKind::TotpChallenge,
            stage,
            action,
            2,
            3,
        ));
    }

    if (observation.current_password_field_count > 0
        && observation.generic_password_field_count > 0)
        || observation.generic_password_field_count > 1
    {
        return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::Manual,
            AuthenticationWorkflowStage::Manual,
            AuthenticationWorkflowAction::TakeOver,
            1,
            1,
        ));
    }

    if observation.password_field_count() > 0 {
        return AuthenticationWorkflowMatch::Matched(apply_passkey_proposal(
            observation,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Login,
                credentials_or_manual(observation.manual_checkpoint_present),
                continue_or_takeover(observation.manual_checkpoint_present),
                1,
                3,
            )
            .with_saved_login_capability(),
        ));
    }

    if observation.username_field_count > 0 {
        return AuthenticationWorkflowMatch::Matched(apply_passkey_proposal(
            observation,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Login,
                credentials_or_manual(observation.manual_checkpoint_present),
                continue_or_takeover(observation.manual_checkpoint_present),
                1,
                3,
            )
            .with_saved_login_capability(),
        ));
    }

    if observation.passkey_control_present || observation.matching_passkey_account_count > 0 {
        return AuthenticationWorkflowMatch::Matched(apply_passkey_proposal(
            observation,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Login,
                credentials_or_manual(observation.manual_checkpoint_present),
                if observation.manual_checkpoint_present {
                    AuthenticationWorkflowAction::TakeOver
                } else {
                    AuthenticationWorkflowAction::ContinueWithNook
                },
                1,
                3,
            ),
        ));
    }

    AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
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
    fn workflow_roundtrips_generated_numeric_enums() -> anyhow::Result<()> {
        let workflow = AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::Login,
            AuthenticationWorkflowStage::Credentials,
            AuthenticationWorkflowAction::ContinueWithNook,
            1,
            3,
        ));
        let serialized = serde_json::to_string(&workflow)?;
        let roundtrip: AuthenticationWorkflowMatch = serde_json::from_str(&serialized)?;
        assert_eq!(roundtrip, workflow);
        Ok(())
    }

    #[test]
    fn ignores_pages_without_authentication_fields() {
        assert_eq!(
            classify_authentication_workflow(observation()),
            AuthenticationWorkflowMatch::NoMatch
        );
    }

    #[test]
    fn classifies_single_and_multi_page_logins() -> anyhow::Result<()> {
        let username_only = AuthenticationPageObservation {
            username_field_count: 1,
            ..observation()
        };
        let login = classify_authentication_workflow(username_only).snapshot()?;
        assert_eq!(login.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(login.action, AuthenticationWorkflowAction::ContinueWithNook);
        assert_eq!((login.current_step, login.total_steps), (1, 3));
        assert_eq!(
            login.approval_requirement,
            AuthenticationApprovalRequirement::ExplicitUserApproval
        );

        let password_login = AuthenticationPageObservation {
            current_password_field_count: 1,
            ..observation()
        };
        assert_eq!(
            classify_authentication_workflow(password_login).snapshot()?,
            AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::ContinueWithNook,
                1,
                3,
            )
            .with_saved_login_capability()
        );
        Ok(())
    }

    #[test]
    fn distinguishes_signup_from_password_change() -> anyhow::Result<()> {
        let signup = AuthenticationPageObservation {
            username_field_count: 1,
            new_password_field_count: 2,
            ..observation()
        };
        let signup = classify_authentication_workflow(signup).snapshot()?;
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
        let password_change = classify_authentication_workflow(password_change).snapshot()?;
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
        Ok(())
    }

    #[test]
    fn signup_with_manual_checkpoint_yields_to_takeover() -> anyhow::Result<()> {
        let signup = AuthenticationPageObservation {
            username_field_count: 1,
            new_password_field_count: 1,
            manual_checkpoint_present: true,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(signup).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Signup);
        assert_eq!(snapshot.stage, AuthenticationWorkflowStage::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
        assert_eq!(
            snapshot.approval_requirement,
            AuthenticationApprovalRequirement::TakeoverRequired
        );
        Ok(())
    }

    #[test]
    fn classifies_authenticator_setup_and_verify_enrollment() -> anyhow::Result<()> {
        let setup = AuthenticationPageObservation {
            authenticator_setup_hint: true,
            ..observation()
        };
        let setup = classify_authentication_workflow(setup).snapshot()?;
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
        let verify = classify_authentication_workflow(verify).snapshot()?;
        assert_eq!(verify.kind, AuthenticationWorkflowKind::TotpEnrollment);
        assert_eq!(verify.stage, AuthenticationWorkflowStage::Verification);
        assert_eq!(verify.action, AuthenticationWorkflowAction::FillTotp);

        let recovery = AuthenticationPageObservation {
            authenticator_setup_hint: true,
            backup_codes_hint: true,
            ..observation()
        };
        let recovery = classify_authentication_workflow(recovery).snapshot()?;
        assert_eq!(recovery.stage, AuthenticationWorkflowStage::Recovery);
        assert_eq!(
            recovery.action,
            AuthenticationWorkflowAction::SaveBackupCodes
        );
        Ok(())
    }

    #[test]
    fn enrollment_checkpoints_fail_closed_at_the_observed_step() -> anyhow::Result<()> {
        for (observation, expected_step) in [
            (
                AuthenticationPageObservation {
                    authenticator_setup_hint: true,
                    manual_checkpoint_present: true,
                    ..observation()
                },
                2,
            ),
            (
                AuthenticationPageObservation {
                    authenticator_setup_hint: true,
                    one_time_code_field_count: 1,
                    manual_checkpoint_present: true,
                    ..observation()
                },
                3,
            ),
            (
                AuthenticationPageObservation {
                    backup_codes_hint: true,
                    manual_checkpoint_present: true,
                    ..observation()
                },
                4,
            ),
        ] {
            let snapshot = classify_authentication_workflow(observation).snapshot()?;
            assert_eq!(snapshot.stage, AuthenticationWorkflowStage::Manual);
            assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
            assert_eq!(snapshot.current_step, expected_step);
            assert_eq!(
                snapshot.pilot_presentation_capability(),
                AuthenticationPilotPresentationCapability::Hidden
            );
        }
        Ok(())
    }

    #[test]
    fn pilot_presentation_requires_a_complete_approved_snapshot() -> anyhow::Result<()> {
        let snapshot = classify_authentication_workflow(AuthenticationPageObservation {
            username_field_count: 1,
            ..observation()
        })
        .snapshot()?;
        assert_eq!(
            snapshot.pilot_presentation_capability(),
            AuthenticationPilotPresentationCapability::ProposeAction
        );
        assert_eq!(
            AuthenticationWorkflowSnapshot {
                stage: AuthenticationWorkflowStage::Recovery,
                ..snapshot
            }
            .pilot_presentation_capability(),
            AuthenticationPilotPresentationCapability::Hidden
        );
        Ok(())
    }

    #[test]
    fn classifies_standalone_one_time_code_as_second_factor() -> anyhow::Result<()> {
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            ..observation()
        };
        let code = classify_authentication_workflow(code).snapshot()?;
        assert_eq!(code.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(code.stage, AuthenticationWorkflowStage::SecondFactor);
        assert_eq!(code.action, AuthenticationWorkflowAction::FillTotp);
        assert_eq!((code.current_step, code.total_steps), (2, 3));
        Ok(())
    }

    #[test]
    fn checkpointed_standalone_one_time_code_requires_takeover() -> anyhow::Result<()> {
        let snapshot = classify_authentication_workflow(AuthenticationPageObservation {
            one_time_code_field_count: 1,
            manual_checkpoint_present: true,
            ..observation()
        })
        .snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(snapshot.stage, AuthenticationWorkflowStage::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
        assert_eq!(
            snapshot.saved_login_capability,
            AuthenticationSavedLoginCapability::Unavailable
        );
        assert_eq!(
            snapshot.pilot_presentation_capability(),
            AuthenticationPilotPresentationCapability::Hidden
        );
        Ok(())
    }

    #[test]
    fn checkpointed_login_requires_takeover_and_hides_pilot() -> anyhow::Result<()> {
        let snapshot = classify_authentication_workflow(AuthenticationPageObservation {
            current_password_field_count: 1,
            manual_checkpoint_present: true,
            ..observation()
        })
        .snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.stage, AuthenticationWorkflowStage::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
        assert_eq!(
            snapshot.pilot_presentation_capability(),
            AuthenticationPilotPresentationCapability::Hidden
        );
        Ok(())
    }

    #[test]
    fn backup_code_link_does_not_hide_an_active_totp_challenge() -> anyhow::Result<()> {
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            backup_codes_hint: true,
            ..observation()
        };
        let code = classify_authentication_workflow(code).snapshot()?;
        assert_eq!(code.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(code.stage, AuthenticationWorkflowStage::SecondFactor);
        assert_eq!(code.action, AuthenticationWorkflowAction::FillTotp);
        Ok(())
    }

    #[test]
    fn combined_password_and_code_fields_yield_to_manual_second_factor() -> anyhow::Result<()> {
        let combined = AuthenticationPageObservation {
            current_password_field_count: 1,
            one_time_code_field_count: 1,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(combined).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(snapshot.stage, AuthenticationWorkflowStage::SecondFactor);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
        Ok(())
    }

    #[test]
    fn generic_multi_password_forms_never_offer_login_fill() -> anyhow::Result<()> {
        let ambiguous = AuthenticationPageObservation {
            username_field_count: 1,
            generic_password_field_count: 2,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(ambiguous).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
        Ok(())
    }

    #[test]
    fn current_plus_generic_password_forms_never_offer_login_fill() -> anyhow::Result<()> {
        let ambiguous_change = AuthenticationPageObservation {
            current_password_field_count: 1,
            generic_password_field_count: 1,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(ambiguous_change).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
        Ok(())
    }

    #[test]
    fn separate_login_form_takes_precedence_over_signup_or_password_reset() -> anyhow::Result<()> {
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

        let snapshot = classify_authentication_workflow_candidates(&[signup, login]).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(
            snapshot.action,
            AuthenticationWorkflowAction::ContinueWithNook
        );
        assert_eq!(snapshot.observation_index, 1);
        Ok(())
    }

    #[test]
    fn ranks_form_observations_for_bounded_host_scans() {
        let username = AuthenticationPageObservation {
            username_field_count: 1,
            ..observation()
        };
        let signup = AuthenticationPageObservation {
            new_password_field_count: 1,
            ..observation()
        };
        let generic_login = AuthenticationPageObservation {
            generic_password_field_count: 1,
            ..observation()
        };
        let current_login = AuthenticationPageObservation {
            current_password_field_count: 1,
            ..observation()
        };
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            ..observation()
        };

        assert_eq!(authentication_form_observation_priority(username), 1);
        assert_eq!(authentication_form_observation_priority(signup), 2);
        assert_eq!(authentication_form_observation_priority(generic_login), 3);
        assert_eq!(authentication_form_observation_priority(current_login), 4);
        assert_eq!(authentication_form_observation_priority(code), 5);
    }

    #[test]
    fn active_totp_takes_precedence_over_unrelated_signup() -> anyhow::Result<()> {
        let signup = AuthenticationPageObservation {
            username_field_count: 1,
            new_password_field_count: 1,
            ..observation()
        };
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            ..observation()
        };

        let snapshot = classify_authentication_workflow_candidates(&[signup, code]).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::FillTotp);
        assert_eq!(snapshot.observation_index, 1);
        Ok(())
    }

    #[test]
    fn login_with_matching_passkeys_proposes_use() -> anyhow::Result<()> {
        let login = AuthenticationPageObservation {
            current_password_field_count: 1,
            matching_passkey_account_count: 2,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(login).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::UsePasskey);
        assert_eq!(
            snapshot.saved_login_capability,
            AuthenticationSavedLoginCapability::FillSavedLogin
        );
        assert_eq!(
            snapshot.approval_requirement,
            AuthenticationApprovalRequirement::ExplicitUserApproval
        );
        Ok(())
    }

    #[test]
    fn passkey_control_without_matches_proposes_create() -> anyhow::Result<()> {
        let login = AuthenticationPageObservation {
            username_field_count: 1,
            passkey_control_present: true,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(login).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::CreatePasskey);
        assert_eq!(
            snapshot.saved_login_capability,
            AuthenticationSavedLoginCapability::FillSavedLogin
        );
        Ok(())
    }

    #[test]
    fn passkey_only_control_classifies_as_login_create() -> anyhow::Result<()> {
        let passkey_only = AuthenticationPageObservation {
            passkey_control_present: true,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(passkey_only).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::CreatePasskey);
        assert_eq!(
            snapshot.saved_login_capability,
            AuthenticationSavedLoginCapability::Unavailable
        );
        Ok(())
    }

    #[test]
    fn manual_passkey_only_login_yields_to_manual_takeover() -> anyhow::Result<()> {
        let passkey_only = AuthenticationPageObservation {
            passkey_control_present: true,
            manual_checkpoint_present: true,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(passkey_only).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.stage, AuthenticationWorkflowStage::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
        Ok(())
    }

    #[test]
    fn matching_passkeys_prefer_use_over_password_continue_candidate() -> anyhow::Result<()> {
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
            classify_authentication_workflow_candidates(&[password_login, passkey_login])
                .snapshot()?;
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::UsePasskey);
        assert_eq!(snapshot.observation_index, 1);
        Ok(())
    }
}
