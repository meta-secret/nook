//! Portable authentication-workflow classification for browser companions.
//!
//! Browser adapters report only structural, non-secret observations. This
//! module owns the product decision about which workflow is present, where the
//! user is in it, and which action Nook may offer next.

mod candidate_selection;
mod compatibility;
mod observation_facts;
mod observation_validation;
mod vocabulary;

pub use candidate_selection::AuthenticationFormObservationPriority;
pub use compatibility::{
    AUTHENTICATION_WORKFLOW_COMPATIBILITY_TYPESCRIPT, AuthenticationPageObservationCompatibility,
    AuthenticationPageObservationsCompatibility,
};
pub use observation_facts::{
    AuthenticationAuthenticatorObservationFacts, AuthenticationAuthenticatorSetupObservation,
    AuthenticationBackupCodesObservation, AuthenticationCeremonyObservationFacts,
    AuthenticationDetailedAdvanceControlObservation, AuthenticationFieldObservationFacts,
    AuthenticationPageObservationFacts, AuthenticationPageObservationFactsBatch,
    AuthenticationPasskeyControlObservation,
};
pub use observation_validation::{
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    authentication_page_observations_are_valid,
};
pub use vocabulary::{
    AuthenticationSavedLoginCapability, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowStage,
};

use crate::website_passkey_proposal::{WebsitePasskeyProposal, propose_website_passkey};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationPageProgression {
    Blocked,
    AdvanceControl,
    PasskeyControl,
    AutoSubmitOneTimeCode,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticationPageObservation {
    pub username_field_count: u32,
    pub current_password_field_count: u32,
    pub new_password_field_count: u32,
    pub generic_password_field_count: u32,
    pub one_time_code_field_count: u32,
    /// Whether the browser has direct evidence that entering a code submits it.
    pub one_time_code_progression: AuthenticationOneTimeCodeProgressionEvidence,
    /// CAPTCHA, legal acceptance, email verification, or similar human gate.
    pub manual_checkpoint: AuthenticationManualCheckpoint,
    /// Visible authenticator setup or recovery material.
    pub enrollment_evidence: AuthenticationEnrollmentEvidence,
    /// Visible, enabled ordinary control that can advance authentication.
    pub advance_control: AuthenticationAdvanceControlEvidence,
    /// Actionable passkey control and unlocked matching-account evidence.
    pub passkey: AuthenticationPasskeyEvidence,
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
            || !matches!(
                self.enrollment_evidence,
                AuthenticationEnrollmentEvidence::Absent
            )
            || !matches!(self.passkey, AuthenticationPasskeyEvidence::Absent)
    }

    #[must_use]
    pub const fn manual_checkpoint_present(self) -> bool {
        matches!(
            self.manual_checkpoint,
            AuthenticationManualCheckpoint::Present
        )
    }

    #[must_use]
    pub const fn authenticator_setup_hint(self) -> bool {
        matches!(
            self.enrollment_evidence,
            AuthenticationEnrollmentEvidence::AuthenticatorSetup
                | AuthenticationEnrollmentEvidence::AuthenticatorSetupAndBackupCodes
        )
    }

    #[must_use]
    pub const fn backup_codes_hint(self) -> bool {
        matches!(
            self.enrollment_evidence,
            AuthenticationEnrollmentEvidence::BackupCodes
                | AuthenticationEnrollmentEvidence::AuthenticatorSetupAndBackupCodes
        )
    }

    #[must_use]
    pub const fn passkey_control_present(self) -> bool {
        matches!(
            self.passkey,
            AuthenticationPasskeyEvidence::Control
                | AuthenticationPasskeyEvidence::VaultAccounts { .. }
                | AuthenticationPasskeyEvidence::ControlAndVaultAccounts { .. }
        )
    }

    #[must_use]
    pub const fn matching_passkey_account_count(self) -> u32 {
        match self.passkey {
            AuthenticationPasskeyEvidence::VaultAccounts { account_count }
            | AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count } => {
                account_count
            }
            AuthenticationPasskeyEvidence::Absent | AuthenticationPasskeyEvidence::Control => 0,
        }
    }

    const fn credential_workflow_kind(self) -> AuthenticationWorkflowKind {
        if self.current_password_field_count > 0 && self.new_password_field_count > 0 {
            AuthenticationWorkflowKind::PasswordChange
        } else if self.new_password_field_count > 0 {
            AuthenticationWorkflowKind::Signup
        } else if self.one_time_code_field_count > 0 {
            AuthenticationWorkflowKind::TotpChallenge
        } else if (self.current_password_field_count > 0 && self.generic_password_field_count > 0)
            || self.generic_password_field_count > 1
        {
            AuthenticationWorkflowKind::Manual
        } else if self.password_field_count() > 0
            || self.username_field_count > 0
            || !matches!(self.passkey, AuthenticationPasskeyEvidence::Absent)
        {
            AuthenticationWorkflowKind::Login
        } else {
            AuthenticationWorkflowKind::Manual
        }
    }

    #[must_use]
    pub const fn progression(self) -> AuthenticationPageProgression {
        if self.one_time_code_field_count > 0
            && matches!(
                self.one_time_code_progression,
                AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved
            )
        {
            AuthenticationPageProgression::AutoSubmitOneTimeCode
        } else if matches!(
            self.advance_control,
            AuthenticationAdvanceControlEvidence::Present
        ) {
            AuthenticationPageProgression::AdvanceControl
        } else if self.passkey_control_present()
            && matches!(
                self.credential_workflow_kind(),
                AuthenticationWorkflowKind::Login | AuthenticationWorkflowKind::Signup
            )
        {
            AuthenticationPageProgression::PasskeyControl
        } else {
            AuthenticationPageProgression::Blocked
        }
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
            observation_index: 0,
        }
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

    /// Whether this snapshot is one of the complete tuples emitted by the classifier.
    #[must_use]
    pub const fn matches_classifier_contract(self) -> bool {
        if self.current_step == 0
            || self.total_steps == 0
            || self.current_step > self.total_steps
            || !self.approval_requirement_matches_action()
        {
            return false;
        }

        matches!(
            (
                self.kind,
                self.stage,
                self.action,
                self.current_step,
                self.total_steps,
            ),
            (
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::ContinueWithNook
                    | AuthenticationWorkflowAction::UsePasskey
                    | AuthenticationWorkflowAction::CreatePasskey,
                1,
                3,
            ) | (
                AuthenticationWorkflowKind::Login,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                1,
                3,
            ) | (
                AuthenticationWorkflowKind::Signup,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::GeneratePassword
                    | AuthenticationWorkflowAction::UsePasskey
                    | AuthenticationWorkflowAction::CreatePasskey,
                2,
                5,
            ) | (
                AuthenticationWorkflowKind::Signup,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                2,
                5,
            ) | (
                AuthenticationWorkflowKind::PasswordChange,
                AuthenticationWorkflowStage::Credentials,
                AuthenticationWorkflowAction::GeneratePassword,
                2,
                4,
            ) | (
                AuthenticationWorkflowKind::PasswordChange,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                2,
                4,
            ) | (
                AuthenticationWorkflowKind::TotpChallenge,
                AuthenticationWorkflowStage::SecondFactor,
                AuthenticationWorkflowAction::FillTotp | AuthenticationWorkflowAction::TakeOver,
                2,
                3,
            ) | (
                AuthenticationWorkflowKind::TotpChallenge,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                2,
                3,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Setup,
                AuthenticationWorkflowAction::EnrollAuthenticator,
                2,
                5,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Verification,
                AuthenticationWorkflowAction::FillTotp,
                3,
                5,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Recovery,
                AuthenticationWorkflowAction::TakeOver,
                4,
                5,
            ) | (
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                2..=4,
                5,
            ) | (
                AuthenticationWorkflowKind::Manual,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                1,
                1,
            )
        )
    }

    #[must_use]
    pub const fn saved_login_capability(self) -> AuthenticationSavedLoginCapability {
        if self.approval_requirement_matches_action()
            && matches!(self.kind, AuthenticationWorkflowKind::Login)
            && matches!(self.action, AuthenticationWorkflowAction::ContinueWithNook)
        {
            AuthenticationSavedLoginCapability::FillSavedLogin
        } else {
            AuthenticationSavedLoginCapability::Unavailable
        }
    }
}

const fn classify_enrollment_workflow(
    observation: AuthenticationPageObservation,
) -> AuthenticationWorkflowMatch {
    if observation.manual_checkpoint_present()
        && (observation.authenticator_setup_hint() || observation.backup_codes_hint())
    {
        let current_step =
            if observation.backup_codes_hint() && observation.one_time_code_field_count == 0 {
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
    if observation.authenticator_setup_hint() {
        if observation.one_time_code_field_count > 0 {
            if matches!(
                observation.progression(),
                AuthenticationPageProgression::Blocked
                    | AuthenticationPageProgression::PasskeyControl
            ) {
                return AuthenticationWorkflowMatch::NoMatch;
            }
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
    if observation.backup_codes_hint() && observation.one_time_code_field_count == 0 {
        return AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
            AuthenticationWorkflowKind::TotpEnrollment,
            AuthenticationWorkflowStage::Recovery,
            AuthenticationWorkflowAction::TakeOver,
            4,
            5,
        ));
    }
    AuthenticationWorkflowMatch::NoMatch
}

const fn generate_or_takeover(
    manual_checkpoint: AuthenticationManualCheckpoint,
) -> AuthenticationWorkflowAction {
    if matches!(manual_checkpoint, AuthenticationManualCheckpoint::Present) {
        AuthenticationWorkflowAction::TakeOver
    } else {
        AuthenticationWorkflowAction::GeneratePassword
    }
}

const fn credentials_or_manual(
    manual_checkpoint: AuthenticationManualCheckpoint,
) -> AuthenticationWorkflowStage {
    if matches!(manual_checkpoint, AuthenticationManualCheckpoint::Present) {
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
        observation.manual_checkpoint,
        observation.passkey,
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
    if matches!(
        observation.progression(),
        AuthenticationPageProgression::Blocked
    ) && !observation.manual_checkpoint_present()
    {
        return AuthenticationWorkflowMatch::NoMatch;
    }

    match observation.credential_workflow_kind() {
        AuthenticationWorkflowKind::PasswordChange => {
            AuthenticationWorkflowMatch::Matched(apply_passkey_proposal(
                observation,
                AuthenticationWorkflowSnapshot::new(
                    AuthenticationWorkflowKind::PasswordChange,
                    credentials_or_manual(observation.manual_checkpoint),
                    generate_or_takeover(observation.manual_checkpoint),
                    2,
                    4,
                ),
            ))
        }
        AuthenticationWorkflowKind::Signup => {
            AuthenticationWorkflowMatch::Matched(apply_passkey_proposal(
                observation,
                AuthenticationWorkflowSnapshot::new(
                    AuthenticationWorkflowKind::Signup,
                    credentials_or_manual(observation.manual_checkpoint),
                    generate_or_takeover(observation.manual_checkpoint),
                    2,
                    5,
                ),
            ))
        }
        AuthenticationWorkflowKind::TotpChallenge => {
            let action = if observation.manual_checkpoint_present()
                || observation.password_field_count() > 0
            {
                AuthenticationWorkflowAction::TakeOver
            } else {
                AuthenticationWorkflowAction::FillTotp
            };
            AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::TotpChallenge,
                if observation.manual_checkpoint_present() {
                    AuthenticationWorkflowStage::Manual
                } else {
                    AuthenticationWorkflowStage::SecondFactor
                },
                action,
                2,
                3,
            ))
        }
        AuthenticationWorkflowKind::Manual => {
            AuthenticationWorkflowMatch::Matched(AuthenticationWorkflowSnapshot::new(
                AuthenticationWorkflowKind::Manual,
                AuthenticationWorkflowStage::Manual,
                AuthenticationWorkflowAction::TakeOver,
                1,
                1,
            ))
        }
        AuthenticationWorkflowKind::Login => {
            AuthenticationWorkflowMatch::Matched(apply_passkey_proposal(
                observation,
                AuthenticationWorkflowSnapshot::new(
                    AuthenticationWorkflowKind::Login,
                    credentials_or_manual(observation.manual_checkpoint),
                    if observation.manual_checkpoint_present() {
                        AuthenticationWorkflowAction::TakeOver
                    } else {
                        AuthenticationWorkflowAction::ContinueWithNook
                    },
                    1,
                    3,
                ),
            ))
        }
        AuthenticationWorkflowKind::TotpEnrollment => AuthenticationWorkflowMatch::NoMatch,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation() -> AuthenticationPageObservation {
        AuthenticationPageObservation {
            advance_control: AuthenticationAdvanceControlEvidence::Present,
            ..Default::default()
        }
    }

    #[test]
    fn every_classifier_snapshot_satisfies_the_wire_contract() {
        let enrollment_evidence = [
            AuthenticationEnrollmentEvidence::Absent,
            AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            AuthenticationEnrollmentEvidence::BackupCodes,
            AuthenticationEnrollmentEvidence::AuthenticatorSetupAndBackupCodes,
        ];
        let passkey_evidence = [
            AuthenticationPasskeyEvidence::Absent,
            AuthenticationPasskeyEvidence::Control,
            AuthenticationPasskeyEvidence::VaultAccounts { account_count: 0 },
            AuthenticationPasskeyEvidence::VaultAccounts { account_count: 1 },
            AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 0 },
            AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 1 },
        ];

        for username_field_count in [0, 1] {
            for current_password_field_count in [0, 1] {
                for new_password_field_count in [0, 1] {
                    for generic_password_field_count in [0, 1, 2] {
                        for one_time_code_field_count in [0, 1] {
                            for manual_checkpoint in [
                                AuthenticationManualCheckpoint::Absent,
                                AuthenticationManualCheckpoint::Present,
                            ] {
                                for enrollment_evidence in enrollment_evidence {
                                    for advance_control in [
                                        AuthenticationAdvanceControlEvidence::Absent,
                                        AuthenticationAdvanceControlEvidence::Present,
                                    ] {
                                        for one_time_code_progression in [
                                            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired,
                                            AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved,
                                        ] {
                                            for passkey in passkey_evidence {
                                                let observation = AuthenticationPageObservation {
                                                    username_field_count,
                                                    current_password_field_count,
                                                    new_password_field_count,
                                                    generic_password_field_count,
                                                    one_time_code_field_count,
                                                    one_time_code_progression,
                                                    manual_checkpoint,
                                                    enrollment_evidence,
                                                    advance_control,
                                                    passkey,
                                                };
                                                if let AuthenticationWorkflowMatch::Matched(
                                                    snapshot,
                                                ) = classify_authentication_workflow(observation)
                                                {
                                                    assert!(
                                                        snapshot.matches_classifier_contract(),
                                                        "classifier produced an invalid snapshot: {snapshot:?}",
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn passkey_control_only_advances_eligible_credential_workflows() -> anyhow::Result<()> {
        let blocked_password_change = AuthenticationPageObservation {
            current_password_field_count: 1,
            new_password_field_count: 2,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            passkey: AuthenticationPasskeyEvidence::Control,
            ..observation()
        };
        assert_eq!(
            classify_authentication_workflow(blocked_password_change),
            AuthenticationWorkflowMatch::NoMatch
        );

        let signup = AuthenticationPageObservation {
            new_password_field_count: 2,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            passkey: AuthenticationPasskeyEvidence::Control,
            ..observation()
        };
        assert_eq!(
            classify_authentication_workflow(signup).snapshot()?.action,
            AuthenticationWorkflowAction::CreatePasskey
        );
        Ok(())
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
        assert_eq!(
            login.approval_requirement,
            AuthenticationApprovalRequirement::ExplicitUserApproval
        );
        assert_eq!(
            login.saved_login_capability(),
            AuthenticationSavedLoginCapability::FillSavedLogin
        );
        assert_eq!((login.current_step, login.total_steps), (1, 3));

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
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            manual_checkpoint: AuthenticationManualCheckpoint::Present,
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
        assert_eq!(
            snapshot.saved_login_capability(),
            AuthenticationSavedLoginCapability::Unavailable
        );
        Ok(())
    }

    #[test]
    fn blocked_login_with_manual_checkpoint_yields_to_takeover() -> anyhow::Result<()> {
        let login = AuthenticationPageObservation {
            username_field_count: 1,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            manual_checkpoint: AuthenticationManualCheckpoint::Present,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(login).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(snapshot.stage, AuthenticationWorkflowStage::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);
        assert_eq!(
            snapshot.approval_requirement,
            AuthenticationApprovalRequirement::TakeoverRequired
        );
        assert_eq!(
            snapshot.saved_login_capability(),
            AuthenticationSavedLoginCapability::Unavailable
        );
        Ok(())
    }

    #[test]
    fn gates_authenticator_enrollment_verification_on_progression() -> anyhow::Result<()> {
        let setup = AuthenticationPageObservation {
            enrollment_evidence: AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            ..observation()
        };
        let setup = classify_authentication_workflow(setup).snapshot()?;
        assert_eq!(setup.kind, AuthenticationWorkflowKind::TotpEnrollment);
        assert_eq!(setup.stage, AuthenticationWorkflowStage::Setup);
        assert_eq!(
            setup.action,
            AuthenticationWorkflowAction::EnrollAuthenticator
        );

        let blocked_verify = AuthenticationPageObservation {
            enrollment_evidence: AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            one_time_code_field_count: 1,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            ..observation()
        };
        assert_eq!(
            classify_authentication_workflow(blocked_verify),
            AuthenticationWorkflowMatch::NoMatch
        );

        let controlled_verify = AuthenticationPageObservation {
            enrollment_evidence: AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            one_time_code_field_count: 1,
            ..observation()
        };
        let controlled_verify = classify_authentication_workflow(controlled_verify).snapshot()?;
        assert_eq!(
            controlled_verify.kind,
            AuthenticationWorkflowKind::TotpEnrollment
        );
        assert_eq!(
            controlled_verify.stage,
            AuthenticationWorkflowStage::Verification
        );
        assert_eq!(
            controlled_verify.action,
            AuthenticationWorkflowAction::FillTotp
        );

        let auto_submit_verify = AuthenticationPageObservation {
            enrollment_evidence: AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            one_time_code_field_count: 1,
            one_time_code_progression:
                AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            ..observation()
        };
        let auto_submit_verify = classify_authentication_workflow(auto_submit_verify).snapshot()?;
        assert_eq!(
            auto_submit_verify.kind,
            AuthenticationWorkflowKind::TotpEnrollment
        );
        assert_eq!(
            auto_submit_verify.stage,
            AuthenticationWorkflowStage::Verification
        );
        assert_eq!(
            auto_submit_verify.action,
            AuthenticationWorkflowAction::FillTotp
        );
        Ok(())
    }

    #[test]
    fn classifies_auto_submit_one_time_code_as_second_factor() -> anyhow::Result<()> {
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            one_time_code_progression:
                AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
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
    fn rejects_one_time_code_without_progression_evidence() {
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            ..observation()
        };
        assert_eq!(
            classify_authentication_workflow(code),
            AuthenticationWorkflowMatch::NoMatch
        );
    }

    #[test]
    fn backup_code_link_does_not_hide_an_active_totp_challenge() -> anyhow::Result<()> {
        let code = AuthenticationPageObservation {
            one_time_code_field_count: 1,
            enrollment_evidence: AuthenticationEnrollmentEvidence::BackupCodes,
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
    fn ambiguous_password_forms_never_offer_login_fill() -> anyhow::Result<()> {
        let ambiguous_change = AuthenticationPageObservation {
            current_password_field_count: 1,
            generic_password_field_count: 1,
            ..observation()
        };
        let snapshot = classify_authentication_workflow(ambiguous_change).snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Manual);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::TakeOver);

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

        let snapshot = AuthenticationPageObservations {
            observations: vec![signup, login],
        }
        .classify()
        .snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::Login);
        assert_eq!(
            snapshot.action,
            AuthenticationWorkflowAction::ContinueWithNook
        );
        assert_eq!(snapshot.observation_index, 1);
        Ok(())
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

        let snapshot = AuthenticationPageObservations {
            observations: vec![signup, code],
        }
        .classify()
        .snapshot()?;
        assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpChallenge);
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::FillTotp);
        assert_eq!(snapshot.observation_index, 1);
        Ok(())
    }

    #[test]
    fn vault_accounts_advance_login_and_signup_to_use_passkey() -> anyhow::Result<()> {
        let login = AuthenticationPageObservation {
            current_password_field_count: 1,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            passkey: AuthenticationPasskeyEvidence::VaultAccounts { account_count: 2 },
            ..observation()
        };
        let signup = AuthenticationPageObservation {
            new_password_field_count: 1,
            advance_control: AuthenticationAdvanceControlEvidence::Absent,
            passkey: AuthenticationPasskeyEvidence::VaultAccounts { account_count: 1 },
            ..observation()
        };
        for (observation, kind) in [
            (login, AuthenticationWorkflowKind::Login),
            (signup, AuthenticationWorkflowKind::Signup),
        ] {
            let snapshot = classify_authentication_workflow(observation).snapshot()?;
            assert_eq!(snapshot.kind, kind);
            assert_eq!(snapshot.action, AuthenticationWorkflowAction::UsePasskey);
            assert_eq!(
                snapshot.approval_requirement,
                AuthenticationApprovalRequirement::ExplicitUserApproval
            );
        }
        Ok(())
    }

    #[test]
    fn matching_passkeys_prefer_use_over_password_continue_candidate() -> anyhow::Result<()> {
        let password_login = AuthenticationPageObservation {
            current_password_field_count: 1,
            ..observation()
        };
        let passkey_login = AuthenticationPageObservation {
            passkey: AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 1 },
            ..observation()
        };
        let snapshot = AuthenticationPageObservations {
            observations: vec![password_login, passkey_login],
        }
        .classify()
        .snapshot()?;
        assert_eq!(snapshot.action, AuthenticationWorkflowAction::UsePasskey);
        assert_eq!(snapshot.observation_index, 1);
        Ok(())
    }
}
