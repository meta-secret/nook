//! Retained end states of a sign-in attempt and the user's resolutions.
//!
//! A concluded attempt never expires and never reverts on its own; it stays
//! visible across reloads until the user resolves it or the tab closes.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::failure_reason::SignInFailureReason;
use super::lifecycle::{
    SignInAttemptBinding, SignInAttemptEventContext, SignInAttemptNext, SignInAttemptStep,
};
use super::page_evidence::{SignInPageLink, SignInPageMessageText};
use super::presentation::{
    SignInAttemptDismissal, SignInAttemptFailedScene, SignInAttemptResetOffer, SignInAttemptScene,
};
use super::request::{SignInAttemptEvent, SignInAttemptRequestError, SignInAttemptUserAction};
use super::reset_link::SignInAttemptResetLink;
use crate::{SignInAttemptEvidenceDemand, SignInAttemptFollowUp};

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum SignInAttemptConclusion {
    Failed { failure: SignInAttemptFailure },
    ChallengeRequired { challenge: SignInAttemptChallenge },
    TimedOut,
}

impl SignInAttemptConclusion {
    /// Applies one event to a retained end state. Only an offered user action
    /// changes it; every other event re-presents the same end state.
    pub(crate) fn advance(self, context: SignInAttemptEventContext<'_>) -> SignInAttemptStep {
        let SignInAttemptEventContext { binding, event, .. } = context;
        match event {
            SignInAttemptEvent::UserAction { action } => {
                self.resolve(SignInAttemptResolution { action, binding })
            }
            SignInAttemptEvent::PageObserved { page } => self.presented(
                SignInAttemptResetOffer::from(page.links.reset_link(binding.site)),
            ),
            SignInAttemptEvent::Resumed | SignInAttemptEvent::Activity { .. } => self.unobserved(),
        }
    }

    /// Re-presents this end state from page evidence: the reset offer
    /// reflects the links of that page.
    pub(crate) fn presented(self, reset: SignInAttemptResetOffer) -> SignInAttemptStep {
        self.represented(SignInAttemptRepresentation {
            reset,
            evidence: SignInAttemptEvidenceDemand::NotWanted,
        })
    }

    /// Re-presents this end state without page evidence: fresh links are requested.
    pub(crate) fn unobserved(self) -> SignInAttemptStep {
        self.represented(SignInAttemptRepresentation::REFRESH_LINKS)
    }

    fn resolve(self, resolution: SignInAttemptResolution<'_>) -> SignInAttemptStep {
        match self {
            Self::Failed { failure } => failure.resolve(resolution),
            Self::ChallengeRequired { challenge } => challenge.resolve(resolution),
            Self::TimedOut => match resolution.action {
                SignInAttemptUserAction::TryAgain => {
                    SignInAttemptStep::restarting(resolution.binding.login)
                }
                SignInAttemptUserAction::Dismiss => {
                    SignInAttemptStep::closing(SignInAttemptClosing::CONCLUDED_DISMISSAL)
                }
                SignInAttemptUserAction::ChooseAnotherLogin
                | SignInAttemptUserAction::ResetPassword { .. }
                | SignInAttemptUserAction::FillAuthenticator => Self::TimedOut.unobserved(),
            },
        }
    }

    /// Revalidates the clicked link against the attempt's site before activation.
    fn reset_password(self, request: SignInAttemptResetRequest<'_>) -> SignInAttemptStep {
        let SignInAttemptResetRequest { link, binding } = request;
        match link.reset_link(binding.site) {
            SignInAttemptResetLink::Reset(index) => {
                SignInAttemptStep::closing(SignInAttemptClosing {
                    scene: SignInAttemptScene::Dismissed(SignInAttemptDismissal::Concluded),
                    follow_up: SignInAttemptFollowUp::ActivateResetLink { link: index },
                })
            }
            SignInAttemptResetLink::NotReset => self.unobserved(),
        }
    }

    fn represented(self, representation: SignInAttemptRepresentation) -> SignInAttemptStep {
        let scene = match &self {
            Self::Failed { failure } => SignInAttemptScene::Failed(SignInAttemptFailedScene {
                failure: failure.clone(),
                reset: representation.reset,
                evidence: representation.evidence,
            }),
            Self::ChallengeRequired { challenge } => {
                SignInAttemptScene::ChallengeRequired(*challenge)
            }
            Self::TimedOut => SignInAttemptScene::TimedOut,
        };
        SignInAttemptStep {
            next: SignInAttemptNext::Concluded(self),
            scene,
            follow_up: SignInAttemptFollowUp::None,
        }
    }
}

impl SignInAttemptFailure {
    /// Failed offers Try again, Choose another login, Reset password (site
    /// rejections with a revalidated same-site reset link) and Dismiss.
    fn resolve(self, resolution: SignInAttemptResolution<'_>) -> SignInAttemptStep {
        let SignInAttemptResolution { action, binding } = resolution;
        match action {
            SignInAttemptUserAction::TryAgain => SignInAttemptStep::restarting(binding.login),
            SignInAttemptUserAction::ChooseAnotherLogin => {
                SignInAttemptStep::closing(SignInAttemptClosing {
                    scene: SignInAttemptScene::Dismissed(SignInAttemptDismissal::Concluded),
                    follow_up: SignInAttemptFollowUp::OpenLoginPicker,
                })
            }
            SignInAttemptUserAction::ResetPassword { link } => match self {
                Self::SiteRejected { .. } => SignInAttemptConclusion::Failed { failure: self }
                    .reset_password(SignInAttemptResetRequest { link, binding }),
                Self::FillFailed | Self::SubmissionRejected => {
                    SignInAttemptConclusion::Failed { failure: self }.unobserved()
                }
            },
            SignInAttemptUserAction::Dismiss => {
                SignInAttemptStep::closing(SignInAttemptClosing::CONCLUDED_DISMISSAL)
            }
            SignInAttemptUserAction::FillAuthenticator => {
                SignInAttemptConclusion::Failed { failure: self }.unobserved()
            }
        }
    }
}

impl SignInAttemptChallenge {
    /// A one-time-code challenge hands off to the existing authenticator
    /// picker; a verification checkpoint offers Try again after the user
    /// completes it. Dismiss is a take-over in both.
    fn resolve(self, resolution: SignInAttemptResolution<'_>) -> SignInAttemptStep {
        let SignInAttemptResolution { action, binding } = resolution;
        match (self, action) {
            (Self::OneTimeCode, SignInAttemptUserAction::FillAuthenticator) => {
                SignInAttemptStep::closing(SignInAttemptClosing {
                    scene: SignInAttemptScene::ChallengeRequired(Self::OneTimeCode),
                    follow_up: SignInAttemptFollowUp::OpenAuthenticatorPicker,
                })
            }
            (Self::Verification, SignInAttemptUserAction::TryAgain) => {
                SignInAttemptStep::restarting(binding.login)
            }
            (Self::OneTimeCode | Self::Verification, SignInAttemptUserAction::Dismiss) => {
                SignInAttemptStep::closing(SignInAttemptClosing::TAKEN_OVER)
            }
            (Self::OneTimeCode, SignInAttemptUserAction::TryAgain)
            | (Self::Verification, SignInAttemptUserAction::FillAuthenticator)
            | (
                Self::OneTimeCode | Self::Verification,
                SignInAttemptUserAction::ChooseAnotherLogin
                | SignInAttemptUserAction::ResetPassword { .. },
            ) => SignInAttemptConclusion::ChallengeRequired { challenge: self }.unobserved(),
        }
    }
}

/// How a retained failure is re-presented: its reset offer is valid only for
/// links collected on the current page, so events without page evidence ask
/// the content script for fresh links.
#[derive(Debug, Clone, Copy)]
struct SignInAttemptRepresentation {
    reset: SignInAttemptResetOffer,
    evidence: SignInAttemptEvidenceDemand,
}

impl SignInAttemptRepresentation {
    const REFRESH_LINKS: Self = Self {
        reset: SignInAttemptResetOffer::NotOffered,
        evidence: SignInAttemptEvidenceDemand::Wanted,
    };
}

struct SignInAttemptResolution<'a> {
    action: SignInAttemptUserAction,
    binding: SignInAttemptBinding<'a>,
}

struct SignInAttemptResetRequest<'a> {
    link: SignInPageLink,
    binding: SignInAttemptBinding<'a>,
}

/// A closing step: the record is removed after its presentation is delivered.
pub(crate) struct SignInAttemptClosing {
    pub(crate) scene: SignInAttemptScene,
    pub(crate) follow_up: SignInAttemptFollowUp,
}

impl SignInAttemptClosing {
    /// Dismiss of a concluded attempt: the Pilot returns to its fresh state.
    pub(crate) const CONCLUDED_DISMISSAL: Self = Self {
        scene: SignInAttemptScene::Dismissed(SignInAttemptDismissal::Concluded),
        follow_up: SignInAttemptFollowUp::None,
    };
    /// An email-first step advanced: the Pilot renders the next step fresh.
    pub(crate) const STEP_ADVANCED: Self = Self {
        scene: SignInAttemptScene::StepAdvanced,
        follow_up: SignInAttemptFollowUp::None,
    };
    /// The user takes over: the Pilot shows its inactive "You are in control" state.
    pub(crate) const TAKEN_OVER: Self = Self {
        scene: SignInAttemptScene::Dismissed(SignInAttemptDismissal::TakenOver),
        follow_up: SignInAttemptFollowUp::None,
    };
}

impl From<SignInAttemptResetLink> for SignInAttemptResetOffer {
    fn from(link: SignInAttemptResetLink) -> Self {
        match link {
            SignInAttemptResetLink::Reset(index) => Self::Offered(index),
            SignInAttemptResetLink::NotReset => Self::NotOffered,
        }
    }
}
