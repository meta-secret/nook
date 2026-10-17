//! End states a sign-in attempt can conclude in, and the evidence they keep.
//!
//! A concluded attempt never expires and never reverts on its own; its
//! handling of events and user resolutions lives in `conclusion.rs`.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::auth_step::SignInAttemptLoginWorkflow;
use super::failure_reason::SignInFailureReason;
use super::page_evidence::{SignInAttemptPageEvidence, SignInPageMessageText};
use super::request::SignInAttemptRequestError;

/// The one Rust-selected, bounded site message shown with a failure.
/// Rendered by the content script with `textContent` only; never logged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct SignInAttemptSiteMessage(String);

impl SignInAttemptSiteMessage {
    pub(crate) const MAX_CHARS: usize = SignInPageMessageText::MAX_CHARS;
}

impl TryFrom<String> for SignInAttemptSiteMessage {
    type Error = SignInAttemptRequestError;

    fn try_from(message: String) -> Result<Self, Self::Error> {
        match message.chars().count() {
            0..=Self::MAX_CHARS => Ok(Self(message)),
            _ => Err(SignInAttemptRequestError::PageTextTooLong),
        }
    }
}

impl From<SignInAttemptSiteMessage> for String {
    fn from(message: SignInAttemptSiteMessage) -> Self {
        let SignInAttemptSiteMessage(message) = message;
        message
    }
}

impl From<&SignInPageMessageText> for SignInAttemptSiteMessage {
    fn from(text: &SignInPageMessageText) -> Self {
        Self(text.text().to_owned())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum SignInAttemptSiteMessageEvidence {
    Captured { text: SignInAttemptSiteMessage },
    Absent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum SignInAttemptFailure {
    /// The site re-presented the login with an error, or its error marker.
    SiteRejected {
        reason: SignInFailureReason,
        message: SignInAttemptSiteMessageEvidence,
    },
    /// Nook could not fill the selected login.
    FillFailed,
    /// Nook's submit revalidation refused to submit the filled form.
    SubmissionRejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptChallenge {
    /// A one-time-code field appeared after submit.
    OneTimeCode,
    /// A CAPTCHA or manual verification checkpoint appeared after submit.
    Verification,
}

/// Who produced a concluded end state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptConclusionOrigin {
    /// Nook's own fill or submit failed before the site responded.
    Nook,
    /// The site's response (or its absence within the budget) concluded it.
    Site,
}

/// Whether the latest page evidence showed the login form. Try again, Choose
/// another login, and Fill 2FA code act on that form, so they are offered only
/// while it is shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptLoginForm {
    /// An authentication field was visible (or Nook was acting on the form).
    Shown,
    /// The same document no longer shows an authentication field.
    Gone,
    /// No page evidence since the end state was reached or reloaded.
    Unobserved,
}

impl From<&SignInAttemptPageEvidence> for SignInAttemptLoginForm {
    fn from(page: &SignInAttemptPageEvidence) -> Self {
        match SignInAttemptLoginWorkflow::from(&page.auth_fields) {
            SignInAttemptLoginWorkflow::Shown => Self::Shown,
            SignInAttemptLoginWorkflow::Left => Self::Gone,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum SignInAttemptConclusion {
    Failed { failure: SignInAttemptFailure },
    ChallengeRequired { challenge: SignInAttemptChallenge },
    TimedOut,
}

impl SignInAttemptConclusion {
    /// Whether the site produced this end state. Nook's own fill and submit
    /// failures happen before the site responds, often because the fields
    /// are not visible, so they never close as `WorkflowLeft`.
    pub(crate) const fn origin(&self) -> SignInAttemptConclusionOrigin {
        match self {
            Self::Failed {
                failure: SignInAttemptFailure::FillFailed | SignInAttemptFailure::SubmissionRejected,
            } => SignInAttemptConclusionOrigin::Nook,
            Self::Failed {
                failure: SignInAttemptFailure::SiteRejected { .. },
            }
            | Self::ChallengeRequired { .. }
            | Self::TimedOut => SignInAttemptConclusionOrigin::Site,
        }
    }
}
