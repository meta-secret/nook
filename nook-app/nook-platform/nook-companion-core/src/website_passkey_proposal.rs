//! Policy for Pilot-gated website passkey proposals.
//!
//! Browser companions may propose Create/Use passkey only from non-secret
//! observations plus an unlocked vault match count. Proposals never perform
//! `WebAuthn` create/assert; the existing page ceremony owns consent and crypto.

use crate::{
    AuthenticationManualCheckpoint, AuthenticationPasskeyAccountCount,
    AuthenticationPasskeyControlObservation, authentication_workflow::AuthenticationWorkflowKind,
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

/// Named values required by `WebsitePasskeyProposal::propose_website_passkey`.
#[derive(Clone, Copy)]
pub struct WebsitePasskeyEvidence {
    pub workflow_kind: AuthenticationWorkflowKind,
    pub manual_checkpoint_present: AuthenticationManualCheckpoint,
    pub passkey_control_present: AuthenticationPasskeyControlObservation,
    pub matching_passkey_account_count: AuthenticationPasskeyAccountCount,
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
impl WebsitePasskeyProposal {
    #[must_use]
    pub const fn propose_website_passkey(
        request: WebsitePasskeyEvidence,
    ) -> WebsitePasskeyProposal {
        let WebsitePasskeyEvidence {
            workflow_kind,
            manual_checkpoint_present,
            passkey_control_present,
            matching_passkey_account_count,
        } = request;
        if matches!(
            manual_checkpoint_present,
            AuthenticationManualCheckpoint::Present
        ) {
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
        if matching_passkey_account_count.is_nonzero() {
            return WebsitePasskeyProposal::UsePasskey {
                account_count: matching_passkey_account_count,
            };
        }
        if matches!(
            passkey_control_present,
            AuthenticationPasskeyControlObservation::Present
        ) {
            return WebsitePasskeyProposal::CreatePasskey;
        }
        WebsitePasskeyProposal::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AuthenticationWorkflowKind::{
        Login, PasswordChange, Signup, TotpChallenge, TotpEnrollment,
    };
    use WebsitePasskeyProposal::{CreatePasskey, None, UsePasskey};

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
            let actual = WebsitePasskeyProposal::propose_website_passkey(WebsitePasskeyEvidence {
                workflow_kind: workflow,
                manual_checkpoint_present: manual.into(),
                passkey_control_present: control.into(),
                matching_passkey_account_count: count.into(),
            });
            assert_eq!(actual, expected);
        }
    }
}
