//! Policy for Pilot-gated website passkey proposals.
//!
//! Browser companions may propose Create/Use passkey only from non-secret
//! observations plus an unlocked vault match count. Proposals never perform
//! `WebAuthn` create/assert; the existing page ceremony owns consent and crypto.

use crate::authentication_workflow::{
    AuthenticationManualCheckpoint, AuthenticationPasskeyEvidence, AuthenticationWorkflowKind,
};

/// Eligibility outcome for a Pilot passkey CTA.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebsitePasskeyProposal {
    /// No passkey CTA; keep the base workflow action.
    None,
    /// Vault has confident RP matches; propose Use passkey.
    UsePasskey { account_count: u32 },
    /// Page exposes a passkey control and no vault matches; propose Create.
    CreatePasskey,
}

impl WebsitePasskeyProposal {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::UsePasskey { .. } => "use-passkey",
            Self::CreatePasskey => "create-passkey",
        }
    }
}

/// Decide whether Pilot may propose a passkey create/use action.
///
/// Defaults remain explicit human approval. Manual checkpoints, second-factor,
/// enrollment, and password-change workflows never receive a passkey proposal.
#[must_use]
pub const fn propose_website_passkey(
    workflow_kind: AuthenticationWorkflowKind,
    manual_checkpoint: AuthenticationManualCheckpoint,
    passkey: AuthenticationPasskeyEvidence,
) -> WebsitePasskeyProposal {
    if matches!(manual_checkpoint, AuthenticationManualCheckpoint::Present) {
        return WebsitePasskeyProposal::None;
    }
    match workflow_kind {
        AuthenticationWorkflowKind::Login | AuthenticationWorkflowKind::Signup => {}
        AuthenticationWorkflowKind::PasswordChange
        | AuthenticationWorkflowKind::TotpChallenge
        | AuthenticationWorkflowKind::TotpEnrollment
        | AuthenticationWorkflowKind::Manual => {
            return WebsitePasskeyProposal::None;
        }
    }
    match passkey {
        AuthenticationPasskeyEvidence::VaultAccounts { account_count }
        | AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count }
            if account_count > 0 =>
        {
            WebsitePasskeyProposal::UsePasskey { account_count }
        }
        AuthenticationPasskeyEvidence::VaultAccounts { .. }
        | AuthenticationPasskeyEvidence::ControlAndVaultAccounts { .. } => {
            WebsitePasskeyProposal::None
        }
        AuthenticationPasskeyEvidence::Control => WebsitePasskeyProposal::CreatePasskey,
        AuthenticationPasskeyEvidence::Absent => WebsitePasskeyProposal::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proposes_use_when_vault_has_confident_matches() {
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::Login,
                AuthenticationManualCheckpoint::Absent,
                AuthenticationPasskeyEvidence::VaultAccounts { account_count: 2 },
            ),
            WebsitePasskeyProposal::UsePasskey { account_count: 2 }
        );
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::Signup,
                AuthenticationManualCheckpoint::Absent,
                AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 1 },
            ),
            WebsitePasskeyProposal::UsePasskey { account_count: 1 }
        );
    }

    #[test]
    fn proposes_create_when_control_present_without_matches() {
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::Login,
                AuthenticationManualCheckpoint::Absent,
                AuthenticationPasskeyEvidence::Control,
            ),
            WebsitePasskeyProposal::CreatePasskey
        );
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::Signup,
                AuthenticationManualCheckpoint::Absent,
                AuthenticationPasskeyEvidence::Control,
            ),
            WebsitePasskeyProposal::CreatePasskey
        );
    }

    #[test]
    fn refuses_manual_checkpoint_and_non_credential_workflows() {
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::Login,
                AuthenticationManualCheckpoint::Present,
                AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 3 },
            ),
            WebsitePasskeyProposal::None
        );
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::TotpChallenge,
                AuthenticationManualCheckpoint::Absent,
                AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 2 },
            ),
            WebsitePasskeyProposal::None
        );
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::PasswordChange,
                AuthenticationManualCheckpoint::Absent,
                AuthenticationPasskeyEvidence::Control,
            ),
            WebsitePasskeyProposal::None
        );
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::TotpEnrollment,
                AuthenticationManualCheckpoint::Absent,
                AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 1 },
            ),
            WebsitePasskeyProposal::None
        );
    }

    #[test]
    fn refuses_when_no_control_and_no_matches() {
        assert_eq!(
            propose_website_passkey(
                AuthenticationWorkflowKind::Login,
                AuthenticationManualCheckpoint::Absent,
                AuthenticationPasskeyEvidence::Absent,
            ),
            WebsitePasskeyProposal::None
        );
    }

    #[test]
    fn refuses_zero_count_vault_matches() {
        for evidence in [
            AuthenticationPasskeyEvidence::VaultAccounts { account_count: 0 },
            AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count: 0 },
        ] {
            assert_eq!(
                propose_website_passkey(
                    AuthenticationWorkflowKind::Login,
                    AuthenticationManualCheckpoint::Absent,
                    evidence,
                ),
                WebsitePasskeyProposal::None
            );
        }
    }
}
