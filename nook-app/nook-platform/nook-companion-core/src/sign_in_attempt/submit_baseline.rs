//! Submit-time baseline of a sign-in attempt and the freshness it implies.
//!
//! The baseline is the only submit-time state the record keeps: whether an
//! error-looking message was visible, which auth fields were present, and
//! whether a sign-out style authenticated affordance was present. Submit-time
//! messages and control labels are classified once and dropped.

use serde::{Deserialize, Serialize};

use super::auth_step::SignInAttemptAuthStep;
use super::message_evidence::{SignInAttemptErrorMessageSelection, SignInAttemptMessageAdmission};
use super::page_evidence::{
    SignInAttemptDocumentRelation, SignInAttemptPageEvidence, SignInPageControls,
};
use super::request::SignInAttemptSubmitBaseline;
use crate::login_save::AuthenticatedControlEvidence;

/// Whether an error-looking message (same rule as after submit) was visible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptMessagePresence {
    Present,
    Absent,
}

impl From<SignInAttemptErrorMessageSelection> for SignInAttemptMessagePresence {
    fn from(selection: SignInAttemptErrorMessageSelection) -> Self {
        match selection {
            SignInAttemptErrorMessageSelection::Selected(_) => Self::Present,
            SignInAttemptErrorMessageSelection::NoneErrorLooking => Self::Absent,
        }
    }
}

/// Whether a sign-out style authenticated affordance was visible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptAffordancePresence {
    Present,
    Absent,
}

impl From<SignInPageControls> for SignInAttemptAffordancePresence {
    fn from(controls: SignInPageControls) -> Self {
        match controls.affordance() {
            AuthenticatedControlEvidence::Present => Self::Present,
            AuthenticatedControlEvidence::Absent => Self::Absent,
        }
    }
}

/// An authenticated affordance absent at submit and present now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SignInAttemptAffordanceChange {
    NewlyPresent,
    NotNew,
}

/// Minimal submit-time facts retained in the record: whether an error-looking
/// message was visible, which auth fields were present, and whether an
/// authenticated affordance was present. The submit-time messages are
/// classified once and dropped; no text, token, or colour is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SignInAttemptBaseline {
    pub(super) error_looking_message_at_submit: SignInAttemptMessagePresence,
    pub(super) authenticated_affordance_at_submit: SignInAttemptAffordancePresence,
    pub(super) fields: SignInAttemptAuthStep,
}

impl From<&SignInAttemptSubmitBaseline> for SignInAttemptBaseline {
    fn from(baseline: &SignInAttemptSubmitBaseline) -> Self {
        Self {
            error_looking_message_at_submit: SignInAttemptMessagePresence::from(
                baseline.messages.error_selection(),
            ),
            authenticated_affordance_at_submit: SignInAttemptAffordancePresence::from(
                baseline.controls,
            ),
            fields: SignInAttemptAuthStep::from(&baseline.auth_fields),
        }
    }
}

impl SignInAttemptBaseline {
    /// On a new document every message is fresh. On the same document a
    /// message is fresh when no error-looking message was visible at submit,
    /// or when it appeared or changed since the acting script's submit.
    pub(super) fn admission(
        self,
        document: SignInAttemptDocumentRelation,
    ) -> SignInAttemptMessageAdmission {
        match (document, self.error_looking_message_at_submit) {
            (
                SignInAttemptDocumentRelation::NewDocument,
                SignInAttemptMessagePresence::Present | SignInAttemptMessagePresence::Absent,
            )
            | (
                SignInAttemptDocumentRelation::SameDocumentSameRoute
                | SignInAttemptDocumentRelation::SameDocumentNewRoute,
                SignInAttemptMessagePresence::Absent,
            ) => SignInAttemptMessageAdmission::Every,
            (
                SignInAttemptDocumentRelation::SameDocumentSameRoute
                | SignInAttemptDocumentRelation::SameDocumentNewRoute,
                SignInAttemptMessagePresence::Present,
            ) => SignInAttemptMessageAdmission::ChangedSinceSubmit,
        }
    }

    pub(super) fn affordance_change(
        self,
        page: &SignInAttemptPageEvidence,
    ) -> SignInAttemptAffordanceChange {
        match (
            self.authenticated_affordance_at_submit,
            SignInAttemptAffordancePresence::from(page.controls),
        ) {
            (SignInAttemptAffordancePresence::Absent, SignInAttemptAffordancePresence::Present) => {
                SignInAttemptAffordanceChange::NewlyPresent
            }
            (SignInAttemptAffordancePresence::Absent, SignInAttemptAffordancePresence::Absent)
            | (
                SignInAttemptAffordancePresence::Present,
                SignInAttemptAffordancePresence::Present | SignInAttemptAffordancePresence::Absent,
            ) => SignInAttemptAffordanceChange::NotNew,
        }
    }
}
