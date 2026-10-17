//! Rust-selected presentation of a sign-in attempt for the Nook Pilot HUD.
//!
//! The content script renders these values and executes the follow-up; it
//! does not choose keys, actions, or states. The login checklist rows are the
//! existing `AuthenticationLoginChecklistState` projection of the attempt.

use serde::Serialize;
use tsify::Tsify;

use super::conclusion::{
    SignInAttemptChallenge, SignInAttemptFailure, SignInAttemptSiteMessage,
    SignInAttemptSiteMessageEvidence,
};
use super::failure_reason::SignInFailureReason;
use super::page_evidence::SignInPageLinkIndex;
use super::request::SignInAttemptLoginReference;
use crate::{
    AuthenticationLoginChecklistActivity, AuthenticationLoginChecklistPresentation,
    AuthenticationLoginChecklistResult, AuthenticationLoginChecklistState,
};

/// Chrome i18n message names selected by Rust. Chrome i18n is the fixed
/// external key boundary, so variants serialize to the extension's message
/// names (`widgetSignInFailed`, …); catalogs own the localized text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum SignInAttemptMessageKey {
    WidgetSignInSigningIn,
    WidgetSignInSigningInDescription,
    WidgetSignInSignedIn,
    WidgetSignInSignedInDescription,
    WidgetSignInFailed,
    WidgetSignInFailedDescription,
    WidgetSignInReasonWrongCredentials,
    WidgetSignInReasonAccountLocked,
    WidgetSignInReasonRateLimited,
    WidgetSignInReasonChallengeRequired,
    WidgetSignInReasonUnknown,
    WidgetSignInChallenge,
    WidgetSignInChallengeOneTimeCodeDescription,
    WidgetSignInChallengeVerificationDescription,
    WidgetSignInTimedOut,
    WidgetSignInTimedOutDescription,
    WidgetSignInTryAgain,
    WidgetSignInChooseAnotherLogin,
    WidgetSignInResetPassword,
    WidgetSignInDismiss,
    /// Existing: "Fill 2FA code".
    WidgetFillAuthenticator,
    /// Existing: "Take over".
    WidgetTakeOver,
    /// Existing: "You are in control".
    WidgetChecklistInactive,
    /// Existing: manual take-over guidance.
    WidgetManualDescription,
    /// Existing fresh Pilot title and description.
    WidgetLoginTitle,
    WidgetLoginDescription,
    /// Existing checklist step details reused as in-flight descriptions.
    WidgetChecklistFillWorking,
    WidgetChecklistSubmitWorking,
    WidgetChecklistSubmitManual,
    WidgetChecklistFillFailed,
    WidgetChecklistSubmitRejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
pub enum SignInAttemptStatus {
    SigningIn,
    SignedIn,
    Failed,
    ChallengeRequired,
    TimedOut,
    Dismissed,
    /// An email-first step was accepted and the site shows the next step.
    StepAdvanced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
pub enum SignInAttemptActionKind {
    TryAgain,
    ChooseAnotherLogin,
    ResetPassword,
    FillAuthenticator,
    Dismiss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
pub struct SignInAttemptActionOffer {
    pub action: SignInAttemptActionKind,
    pub label_key: SignInAttemptMessageKey,
}

/// `Wanted`: collect bounded page evidence and send `PageObserved`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
pub enum SignInAttemptEvidenceDemand {
    Wanted,
    NotWanted,
}

/// What the actuator does after rendering a resolution (Rust-selected).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SignInAttemptFollowUp {
    None,
    /// The old record is closed; the content script reruns the existing fill
    /// path for this login, which begins a new attempt.
    RestartWithSameLogin {
        login: SignInAttemptLoginReference,
    },
    OpenLoginPicker,
    /// Activate the page's own reset link (revalidated by Rust).
    ActivateResetLink {
        link: SignInPageLinkIndex,
    },
    OpenAuthenticatorPicker,
}

/// The frozen TypeScript contract fixes `reasonKey`, `siteMessage`, and
/// `resetLink` as optional fields; Rust fills them only from the named scene
/// states below, at this DTO edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SignInAttemptPresentation {
    pub status: SignInAttemptStatus,
    pub title_key: SignInAttemptMessageKey,
    pub description_key: SignInAttemptMessageKey,
    pub reason_key: Option<SignInAttemptMessageKey>,
    pub site_message: Option<SignInAttemptSiteMessage>,
    pub checklist: AuthenticationLoginChecklistPresentation,
    pub actions: Vec<SignInAttemptActionOffer>,
    pub reset_link: Option<SignInPageLinkIndex>,
    pub page_evidence: SignInAttemptEvidenceDemand,
    pub follow_up: SignInAttemptFollowUp,
}

/// What the user sees for one transition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SignInAttemptScene {
    SigningIn(SignInAttemptSigningIn),
    SignedIn,
    Failed(SignInAttemptFailedScene),
    ChallengeRequired(SignInAttemptChallenge),
    TimedOut,
    Dismissed(SignInAttemptDismissal),
    /// The submitted email-first step was accepted; the next step starts fresh.
    StepAdvanced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptSigningIn {
    Filling,
    Filled,
    ManualSubmit,
    AwaitingOutcome,
    /// Try again closed the old attempt; the fill path begins a new one.
    Restarting,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignInAttemptFailedScene {
    pub(crate) failure: SignInAttemptFailure,
    pub(crate) reset: SignInAttemptResetOffer,
    pub(crate) evidence: SignInAttemptEvidenceDemand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptResetOffer {
    Offered(SignInPageLinkIndex),
    NotOffered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptDismissal {
    /// Dismissed while in flight or challenged: the user is in control.
    TakenOver,
    /// Dismissed after a concluded failure or timeout: the Pilot starts fresh.
    Concluded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptRecordLifetime {
    Retained,
    Closing,
}

pub(crate) struct SignInAttemptPresentationRequest {
    pub(crate) scene: SignInAttemptScene,
    pub(crate) lifetime: SignInAttemptRecordLifetime,
    pub(crate) follow_up: SignInAttemptFollowUp,
}

/// The interactive part of a presentation. A closing record offers nothing:
/// its actions would address a record the service worker has removed.
struct SignInAttemptInteraction {
    actions: Vec<SignInAttemptActionOffer>,
    reset_link: Option<SignInPageLinkIndex>,
    page_evidence: SignInAttemptEvidenceDemand,
}

impl From<SignInAttemptPresentationRequest> for SignInAttemptPresentation {
    fn from(request: SignInAttemptPresentationRequest) -> Self {
        let SignInAttemptPresentationRequest {
            scene,
            lifetime,
            follow_up,
        } = request;
        let SignInAttemptInteraction {
            actions,
            reset_link,
            page_evidence,
        } = match lifetime {
            SignInAttemptRecordLifetime::Retained => SignInAttemptInteraction {
                actions: scene.actions(),
                reset_link: scene.reset_link(),
                page_evidence: scene.evidence_demand(),
            },
            SignInAttemptRecordLifetime::Closing => SignInAttemptInteraction {
                actions: Vec::new(),
                reset_link: None,
                page_evidence: SignInAttemptEvidenceDemand::NotWanted,
            },
        };
        Self {
            status: scene.status(),
            title_key: scene.title_key(),
            description_key: scene.description_key(),
            reason_key: scene.reason_key(),
            site_message: scene.site_message(),
            checklist: scene.checklist_state().presentation(),
            actions,
            reset_link,
            page_evidence,
            follow_up,
        }
    }
}

impl SignInAttemptScene {
    fn status(&self) -> SignInAttemptStatus {
        match self {
            Self::SigningIn(_) => SignInAttemptStatus::SigningIn,
            Self::SignedIn => SignInAttemptStatus::SignedIn,
            Self::Failed(_) => SignInAttemptStatus::Failed,
            Self::ChallengeRequired(_) => SignInAttemptStatus::ChallengeRequired,
            Self::TimedOut => SignInAttemptStatus::TimedOut,
            Self::Dismissed(_) => SignInAttemptStatus::Dismissed,
            Self::StepAdvanced => SignInAttemptStatus::StepAdvanced,
        }
    }

    fn title_key(&self) -> SignInAttemptMessageKey {
        match self {
            Self::SigningIn(_) => SignInAttemptMessageKey::WidgetSignInSigningIn,
            Self::SignedIn => SignInAttemptMessageKey::WidgetSignInSignedIn,
            Self::Failed(_) => SignInAttemptMessageKey::WidgetSignInFailed,
            Self::ChallengeRequired(_) => SignInAttemptMessageKey::WidgetSignInChallenge,
            Self::TimedOut => SignInAttemptMessageKey::WidgetSignInTimedOut,
            Self::Dismissed(SignInAttemptDismissal::TakenOver) => {
                SignInAttemptMessageKey::WidgetChecklistInactive
            }
            Self::Dismissed(SignInAttemptDismissal::Concluded) | Self::StepAdvanced => {
                SignInAttemptMessageKey::WidgetLoginTitle
            }
        }
    }

    fn description_key(&self) -> SignInAttemptMessageKey {
        match self {
            Self::SigningIn(
                SignInAttemptSigningIn::Filling | SignInAttemptSigningIn::Restarting,
            ) => SignInAttemptMessageKey::WidgetChecklistFillWorking,
            Self::SigningIn(SignInAttemptSigningIn::Filled) => {
                SignInAttemptMessageKey::WidgetChecklistSubmitWorking
            }
            Self::SigningIn(SignInAttemptSigningIn::ManualSubmit) => {
                SignInAttemptMessageKey::WidgetChecklistSubmitManual
            }
            Self::SigningIn(SignInAttemptSigningIn::AwaitingOutcome) => {
                SignInAttemptMessageKey::WidgetSignInSigningInDescription
            }
            Self::SignedIn => SignInAttemptMessageKey::WidgetSignInSignedInDescription,
            Self::Failed(scene) => scene.failure.description_key(),
            Self::ChallengeRequired(SignInAttemptChallenge::OneTimeCode) => {
                SignInAttemptMessageKey::WidgetSignInChallengeOneTimeCodeDescription
            }
            Self::ChallengeRequired(SignInAttemptChallenge::Verification) => {
                SignInAttemptMessageKey::WidgetSignInChallengeVerificationDescription
            }
            Self::TimedOut => SignInAttemptMessageKey::WidgetSignInTimedOutDescription,
            Self::Dismissed(SignInAttemptDismissal::TakenOver) => {
                SignInAttemptMessageKey::WidgetManualDescription
            }
            Self::Dismissed(SignInAttemptDismissal::Concluded) | Self::StepAdvanced => {
                SignInAttemptMessageKey::WidgetLoginDescription
            }
        }
    }

    fn reason_key(&self) -> Option<SignInAttemptMessageKey> {
        match self {
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::SiteRejected { reason, .. },
                ..
            }) => Some(reason.message_key()),
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::FillFailed | SignInAttemptFailure::SubmissionRejected,
                ..
            })
            | Self::SigningIn(_)
            | Self::SignedIn
            | Self::ChallengeRequired(_)
            | Self::TimedOut
            | Self::Dismissed(_)
            | Self::StepAdvanced => None,
        }
    }

    fn site_message(&self) -> Option<SignInAttemptSiteMessage> {
        match self {
            Self::Failed(SignInAttemptFailedScene {
                failure:
                    SignInAttemptFailure::SiteRejected {
                        message: SignInAttemptSiteMessageEvidence::Captured { text },
                        ..
                    },
                ..
            }) => Some(text.clone()),
            Self::Failed(_)
            | Self::SigningIn(_)
            | Self::SignedIn
            | Self::ChallengeRequired(_)
            | Self::TimedOut
            | Self::Dismissed(_)
            | Self::StepAdvanced => None,
        }
    }

    fn reset_link(&self) -> Option<SignInPageLinkIndex> {
        match self {
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::SiteRejected { .. },
                reset: SignInAttemptResetOffer::Offered(index),
                ..
            }) => Some(*index),
            Self::Failed(_)
            | Self::SigningIn(_)
            | Self::SignedIn
            | Self::ChallengeRequired(_)
            | Self::TimedOut
            | Self::Dismissed(_)
            | Self::StepAdvanced => None,
        }
    }

    fn evidence_demand(&self) -> SignInAttemptEvidenceDemand {
        match self {
            Self::SigningIn(SignInAttemptSigningIn::AwaitingOutcome) => {
                SignInAttemptEvidenceDemand::Wanted
            }
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::SiteRejected { .. },
                evidence,
                ..
            }) => *evidence,
            Self::Failed(_)
            | Self::SigningIn(
                SignInAttemptSigningIn::Filling
                | SignInAttemptSigningIn::Filled
                | SignInAttemptSigningIn::ManualSubmit
                | SignInAttemptSigningIn::Restarting,
            )
            | Self::SignedIn
            | Self::ChallengeRequired(_)
            | Self::TimedOut
            | Self::Dismissed(_)
            | Self::StepAdvanced => SignInAttemptEvidenceDemand::NotWanted,
        }
    }

    fn actions(&self) -> Vec<SignInAttemptActionOffer> {
        match self {
            Self::SigningIn(_) => vec![SignInAttemptActionOffer::TAKE_OVER],
            Self::Failed(scene) => scene.actions(),
            Self::ChallengeRequired(SignInAttemptChallenge::OneTimeCode) => vec![
                SignInAttemptActionOffer::FILL_AUTHENTICATOR,
                SignInAttemptActionOffer::TAKE_OVER,
            ],
            Self::ChallengeRequired(SignInAttemptChallenge::Verification) => vec![
                SignInAttemptActionOffer::TRY_AGAIN,
                SignInAttemptActionOffer::TAKE_OVER,
            ],
            Self::TimedOut => vec![
                SignInAttemptActionOffer::TRY_AGAIN,
                SignInAttemptActionOffer::DISMISS,
            ],
            Self::SignedIn | Self::Dismissed(_) | Self::StepAdvanced => Vec::new(),
        }
    }

    /// The existing checklist projection of this scene.
    fn checklist_state(&self) -> AuthenticationLoginChecklistState {
        let activity = match self {
            Self::SigningIn(
                SignInAttemptSigningIn::Filling | SignInAttemptSigningIn::Restarting,
            ) => AuthenticationLoginChecklistActivity::Filling,
            Self::SigningIn(SignInAttemptSigningIn::Filled) => {
                AuthenticationLoginChecklistActivity::Filled
            }
            Self::SigningIn(SignInAttemptSigningIn::ManualSubmit) => {
                AuthenticationLoginChecklistActivity::SubmissionUnobserved
            }
            Self::SigningIn(SignInAttemptSigningIn::AwaitingOutcome) => {
                AuthenticationLoginChecklistActivity::Submitted
            }
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::FillFailed,
                ..
            }) => AuthenticationLoginChecklistActivity::FillFailed,
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::SubmissionRejected,
                ..
            }) => AuthenticationLoginChecklistActivity::SubmissionRejected,
            Self::Dismissed(SignInAttemptDismissal::TakenOver) => {
                AuthenticationLoginChecklistActivity::TakenOver
            }
            Self::Dismissed(SignInAttemptDismissal::Concluded) | Self::StepAdvanced => {
                AuthenticationLoginChecklistActivity::Ready
            }
            Self::SignedIn => {
                return AuthenticationLoginChecklistState::Outcome {
                    result: AuthenticationLoginChecklistResult::Confirmed,
                };
            }
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::SiteRejected { .. },
                ..
            })
            | Self::ChallengeRequired(_)
            | Self::TimedOut => {
                return AuthenticationLoginChecklistState::Outcome {
                    result: AuthenticationLoginChecklistResult::Attention,
                };
            }
        };
        AuthenticationLoginChecklistState::Activity { activity }
    }
}

impl SignInAttemptFailedScene {
    /// Reset password is offered only for a site rejection whose current page
    /// shows a revalidated same-site reset link.
    fn actions(&self) -> Vec<SignInAttemptActionOffer> {
        let reset = match (&self.failure, self.reset) {
            (SignInAttemptFailure::SiteRejected { .. }, SignInAttemptResetOffer::Offered(_)) => {
                vec![SignInAttemptActionOffer::RESET_PASSWORD]
            }
            (SignInAttemptFailure::SiteRejected { .. }, SignInAttemptResetOffer::NotOffered)
            | (
                SignInAttemptFailure::FillFailed | SignInAttemptFailure::SubmissionRejected,
                SignInAttemptResetOffer::Offered(_) | SignInAttemptResetOffer::NotOffered,
            ) => Vec::new(),
        };
        [
            SignInAttemptActionOffer::TRY_AGAIN,
            SignInAttemptActionOffer::CHOOSE_ANOTHER_LOGIN,
        ]
        .into_iter()
        .chain(reset)
        .chain([SignInAttemptActionOffer::DISMISS])
        .collect()
    }
}

impl SignInAttemptFailure {
    fn description_key(&self) -> SignInAttemptMessageKey {
        match self {
            Self::SiteRejected { .. } => SignInAttemptMessageKey::WidgetSignInFailedDescription,
            Self::FillFailed => SignInAttemptMessageKey::WidgetChecklistFillFailed,
            Self::SubmissionRejected => SignInAttemptMessageKey::WidgetChecklistSubmitRejected,
        }
    }
}

impl SignInFailureReason {
    const fn message_key(self) -> SignInAttemptMessageKey {
        match self {
            Self::WrongCredentials => SignInAttemptMessageKey::WidgetSignInReasonWrongCredentials,
            Self::AccountLocked => SignInAttemptMessageKey::WidgetSignInReasonAccountLocked,
            Self::RateLimited => SignInAttemptMessageKey::WidgetSignInReasonRateLimited,
            Self::ChallengeRequired => SignInAttemptMessageKey::WidgetSignInReasonChallengeRequired,
            Self::Unknown => SignInAttemptMessageKey::WidgetSignInReasonUnknown,
        }
    }
}

impl SignInAttemptActionOffer {
    const TRY_AGAIN: Self = Self {
        action: SignInAttemptActionKind::TryAgain,
        label_key: SignInAttemptMessageKey::WidgetSignInTryAgain,
    };
    const CHOOSE_ANOTHER_LOGIN: Self = Self {
        action: SignInAttemptActionKind::ChooseAnotherLogin,
        label_key: SignInAttemptMessageKey::WidgetSignInChooseAnotherLogin,
    };
    const RESET_PASSWORD: Self = Self {
        action: SignInAttemptActionKind::ResetPassword,
        label_key: SignInAttemptMessageKey::WidgetSignInResetPassword,
    };
    const FILL_AUTHENTICATOR: Self = Self {
        action: SignInAttemptActionKind::FillAuthenticator,
        label_key: SignInAttemptMessageKey::WidgetFillAuthenticator,
    };
    const DISMISS: Self = Self {
        action: SignInAttemptActionKind::Dismiss,
        label_key: SignInAttemptMessageKey::WidgetSignInDismiss,
    };
    /// Dismiss while in flight or challenged hands control to the user.
    const TAKE_OVER: Self = Self {
        action: SignInAttemptActionKind::Dismiss,
        label_key: SignInAttemptMessageKey::WidgetTakeOver,
    };
}
