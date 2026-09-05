//! Policy for Pilot-gated website passkey proposals.
//!
//! Browser companions may propose Create/Use passkey only from non-secret
//! observations plus an unlocked vault match count. Proposals never perform
//! `WebAuthn` create/assert; the existing page ceremony owns consent and crypto.

use crate::{
    AuthenticationPasskeyAccountCount, authentication_workflow::AuthenticationWorkflowKind,
};

/// Eligibility outcome for a Pilot passkey CTA.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebsitePasskeyProposal {
    /// No passkey CTA; keep the base workflow action.
    None,
    /// Vault has confident RP matches; propose Use passkey.
    UsePasskey {
        account_count: AuthenticationPasskeyAccountCount,
    },
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
    matching_passkey_account_count: AuthenticationPasskeyAccountCount,
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
    if matching_passkey_account_count.raw() > 0 {
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
    use {AuthenticationWorkflowKind::*, WebsitePasskeyProposal::*};

    #[test]
    fn proposes_passkeys_for_the_supported_workflow_cases() {
        let use_passkey = |count: u32| UsePasskey {
            account_count: count.into(),
        };
        let cases = [
            (Login, false, false, 2, use_passkey(2)),
            (Signup, false, true, 1, use_passkey(1)),
            (Login, false, true, 0, CreatePasskey),
            (Signup, false, true, 0, CreatePasskey),
            (Login, true, true, 3, None),
            (TotpChallenge, false, true, 2, None),
            (PasswordChange, false, true, 0, None),
            (TotpEnrollment, false, true, 1, None),
            (Login, false, false, 0, None),
            (Login, false, false, 0, None),
            (Login, false, true, 0, CreatePasskey),
        ];

        for (workflow, manual, control, count, expected) in cases {
            let actual = propose_website_passkey(workflow, manual, control, count.into());
            assert_eq!(actual, expected);
        }
    }
}
