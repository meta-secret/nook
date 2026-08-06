//! Policy for Pilot-gated website passkey proposals.
//!
//! Browser companions may propose Create/Use passkey only from non-secret
//! observations plus an unlocked vault match count. Proposals never perform
//! `WebAuthn` create/assert; the existing page ceremony owns consent and crypto.

use crate::auth::authentication_workflow::AuthenticationWorkflowKind;

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
    manual_checkpoint_present: bool,
    passkey_control_present: bool,
    matching_passkey_account_count: u32,
) -> WebsitePasskeyProposal {
    if manual_checkpoint_present {
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
    if matching_passkey_account_count > 0 {
        return WebsitePasskeyProposal::UsePasskey {
            account_count: matching_passkey_account_count,
        };
    }
    if passkey_control_present {
        return WebsitePasskeyProposal::CreatePasskey;
    }
    WebsitePasskeyProposal::None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proposes_use_when_vault_has_confident_matches() {
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::Login, false, false, 2),
            WebsitePasskeyProposal::UsePasskey { account_count: 2 }
        );
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::Signup, false, true, 1),
            WebsitePasskeyProposal::UsePasskey { account_count: 1 }
        );
    }

    #[test]
    fn proposes_create_when_control_present_without_matches() {
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::Login, false, true, 0),
            WebsitePasskeyProposal::CreatePasskey
        );
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::Signup, false, true, 0),
            WebsitePasskeyProposal::CreatePasskey
        );
    }

    #[test]
    fn refuses_manual_checkpoint_and_non_credential_workflows() {
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::Login, true, true, 3),
            WebsitePasskeyProposal::None
        );
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::TotpChallenge, false, true, 2),
            WebsitePasskeyProposal::None
        );
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::PasswordChange, false, true, 0),
            WebsitePasskeyProposal::None
        );
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::TotpEnrollment, false, true, 1),
            WebsitePasskeyProposal::None
        );
    }

    #[test]
    fn refuses_when_no_control_and_no_matches() {
        assert_eq!(
            propose_website_passkey(AuthenticationWorkflowKind::Login, false, false, 0),
            WebsitePasskeyProposal::None
        );
    }
}
