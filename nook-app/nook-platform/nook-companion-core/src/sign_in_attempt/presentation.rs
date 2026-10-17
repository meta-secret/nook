//! Rust-selected presentation of a sign-in attempt for the Nook Pilot HUD.
//!
//! The content script renders these values and executes the follow-up; it
//! does not choose keys, actions, or states. The login checklist rows are the
//! existing `AuthenticationLoginChecklistState` projection of the attempt.

use serde::Serialize;
use tsify::Tsify;

use super::end_state::{
    SignInAttemptChallenge, SignInAttemptFailure, SignInAttemptLoginForm, SignInAttemptSiteMessage,
    SignInAttemptSiteMessageEvidence,
};
use super::failure_reason::SignInFailureReason;
use super::page_evidence::SignInPageLinkIndex;
use super::request::SignInAttemptLoginReference;
use super::site::{SignInAttemptOrigin, SignInAttemptOriginRelation};
use crate::{
    AuthenticationDisplayProgress, AuthenticationLoginChecklistActivity,
    AuthenticationLoginChecklistPresentation, AuthenticationLoginChecklistResult,
    AuthenticationLoginChecklistState, AuthenticationWorkflowActivity,
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
    /// A concluded attempt's page left the login workflow; no outcome is claimed.
    WorkflowLeft,
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

/// The TypeScript contract fixes `site_message` and `reset_link` as optional
/// fields; Rust fills them only from named scene states (`SignInAttemptScene`),
/// at this DTO edge. A site failure's reason is its `description_key`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SignInAttemptPresentation {
    pub status: SignInAttemptStatus,
    pub title_key: SignInAttemptMessageKey,
    pub description_key: SignInAttemptMessageKey,
    pub site_message: Option<SignInAttemptSiteMessage>,
    pub checklist: AuthenticationLoginChecklistPresentation,
    /// The Pilot header step counter, consistent with the checklist rows.
    pub progress: AuthenticationDisplayProgress,
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
    /// A retained challenge; `evidence` asks whether the page still shows
    /// the login workflow.
    ChallengeRequired {
        challenge: SignInAttemptChallenge,
        evidence: SignInAttemptEvidenceDemand,
        form: SignInAttemptLoginForm,
    },
    TimedOut {
        evidence: SignInAttemptEvidenceDemand,
        form: SignInAttemptLoginForm,
    },
    Dismissed(SignInAttemptDismissal),
    /// The submitted email-first step was accepted; the next step starts fresh.
    StepAdvanced,
    /// A concluded attempt's page no longer shows the login workflow: the
    /// record closes without any outcome claim.
    WorkflowLeft,
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
    pub(crate) form: SignInAttemptLoginForm,
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
    /// The exact origin of the page the presentation is delivered to.
    pub(crate) viewer: SignInAttemptOrigin,
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
            viewer,
        } = request;
        let site_message = scene.site_message(&viewer);
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
            site_message,
            checklist: scene.checklist_state().presentation(),
            progress: scene.activity().progress(),
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
            Self::ChallengeRequired { .. } => SignInAttemptStatus::ChallengeRequired,
            Self::TimedOut { .. } => SignInAttemptStatus::TimedOut,
            Self::Dismissed(_) => SignInAttemptStatus::Dismissed,
            Self::StepAdvanced => SignInAttemptStatus::StepAdvanced,
            Self::WorkflowLeft => SignInAttemptStatus::WorkflowLeft,
        }
    }

    fn title_key(&self) -> SignInAttemptMessageKey {
        match self {
            Self::SigningIn(_) => SignInAttemptMessageKey::WidgetSignInSigningIn,
            Self::SignedIn => SignInAttemptMessageKey::WidgetSignInSignedIn,
            Self::Failed(_) => SignInAttemptMessageKey::WidgetSignInFailed,
            Self::ChallengeRequired { .. } => SignInAttemptMessageKey::WidgetSignInChallenge,
            Self::TimedOut { .. } => SignInAttemptMessageKey::WidgetSignInTimedOut,
            Self::Dismissed(SignInAttemptDismissal::TakenOver) => {
                SignInAttemptMessageKey::WidgetChecklistInactive
            }
            Self::Dismissed(SignInAttemptDismissal::Concluded)
            | Self::StepAdvanced
            | Self::WorkflowLeft => SignInAttemptMessageKey::WidgetLoginTitle,
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
            Self::ChallengeRequired {
                challenge: SignInAttemptChallenge::OneTimeCode,
                ..
            } => SignInAttemptMessageKey::WidgetSignInChallengeOneTimeCodeDescription,
            Self::ChallengeRequired {
                challenge: SignInAttemptChallenge::Verification,
                ..
            } => SignInAttemptMessageKey::WidgetSignInChallengeVerificationDescription,
            Self::TimedOut { .. } => SignInAttemptMessageKey::WidgetSignInTimedOutDescription,
            Self::Dismissed(SignInAttemptDismissal::TakenOver) => {
                SignInAttemptMessageKey::WidgetManualDescription
            }
            Self::Dismissed(SignInAttemptDismissal::Concluded)
            | Self::StepAdvanced
            | Self::WorkflowLeft => SignInAttemptMessageKey::WidgetLoginDescription,
        }
    }

    /// The site message is shown only to the exact origin it was captured on;
    /// other same-site origins see the failure without it.
    fn site_message(&self, viewer: &SignInAttemptOrigin) -> Option<SignInAttemptSiteMessage> {
        match self {
            Self::Failed(SignInAttemptFailedScene {
                failure:
                    SignInAttemptFailure::SiteRejected {
                        message: SignInAttemptSiteMessageEvidence::Captured { text, origin },
                        ..
                    },
                ..
            }) => match origin.relation(viewer) {
                SignInAttemptOriginRelation::SameOrigin => Some(text.clone()),
                SignInAttemptOriginRelation::OtherOrigin => None,
            },
            Self::Failed(_)
            | Self::SigningIn(_)
            | Self::SignedIn
            | Self::ChallengeRequired { .. }
            | Self::TimedOut { .. }
            | Self::Dismissed(_)
            | Self::StepAdvanced
            | Self::WorkflowLeft => None,
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
            | Self::ChallengeRequired { .. }
            | Self::TimedOut { .. }
            | Self::Dismissed(_)
            | Self::StepAdvanced
            | Self::WorkflowLeft => None,
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
            })
            | Self::ChallengeRequired { evidence, .. }
            | Self::TimedOut { evidence, .. } => *evidence,
            Self::Failed(SignInAttemptFailedScene {
                failure:
                    SignInAttemptFailure::FillFailed {} | SignInAttemptFailure::SubmissionRejected {},
                ..
            })
            | Self::SigningIn(
                SignInAttemptSigningIn::Filling
                | SignInAttemptSigningIn::Filled
                | SignInAttemptSigningIn::ManualSubmit
                | SignInAttemptSigningIn::Restarting,
            )
            | Self::SignedIn
            | Self::Dismissed(_)
            | Self::StepAdvanced
            | Self::WorkflowLeft => SignInAttemptEvidenceDemand::NotWanted,
        }
    }

    fn actions(&self) -> Vec<SignInAttemptActionOffer> {
        match self {
            Self::SigningIn(_) => vec![SignInAttemptActionOffer::TAKE_OVER],
            Self::Failed(scene) => scene.actions(),
            Self::ChallengeRequired {
                challenge: SignInAttemptChallenge::OneTimeCode,
                form,
                ..
            } => [
                form.offer(SignInAttemptActionOffer::FILL_AUTHENTICATOR),
                vec![SignInAttemptActionOffer::TAKE_OVER],
            ]
            .concat(),
            Self::ChallengeRequired {
                challenge: SignInAttemptChallenge::Verification,
                form,
                ..
            } => [
                form.offer(SignInAttemptActionOffer::TRY_AGAIN),
                vec![SignInAttemptActionOffer::TAKE_OVER],
            ]
            .concat(),
            Self::TimedOut { form, .. } => [
                form.offer(SignInAttemptActionOffer::TRY_AGAIN),
                vec![SignInAttemptActionOffer::DISMISS],
            ]
            .concat(),
            Self::SignedIn | Self::Dismissed(_) | Self::StepAdvanced | Self::WorkflowLeft => {
                Vec::new()
            }
        }
    }

    /// The existing Pilot flight activity whose step counter matches the
    /// checklist rows: fresh states count 1, Nook's own fill and submit 2,
    /// and every state that reached the site's response 3.
    fn activity(&self) -> AuthenticationWorkflowActivity {
        match self {
            Self::SigningIn(
                SignInAttemptSigningIn::Filling
                | SignInAttemptSigningIn::Filled
                | SignInAttemptSigningIn::ManualSubmit
                | SignInAttemptSigningIn::Restarting,
            )
            | Self::Failed(SignInAttemptFailedScene {
                failure:
                    SignInAttemptFailure::FillFailed {} | SignInAttemptFailure::SubmissionRejected {},
                ..
            }) => AuthenticationWorkflowActivity::FillingLogin,
            Self::SigningIn(SignInAttemptSigningIn::AwaitingOutcome)
            | Self::SignedIn
            | Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::SiteRejected { .. },
                ..
            })
            | Self::ChallengeRequired { .. }
            | Self::TimedOut { .. } => AuthenticationWorkflowActivity::VerifyingLogin,
            Self::Dismissed(_) | Self::StepAdvanced | Self::WorkflowLeft => {
                AuthenticationWorkflowActivity::ReadyLogin
            }
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
                failure: SignInAttemptFailure::FillFailed {},
                ..
            }) => AuthenticationLoginChecklistActivity::FillFailed,
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::SubmissionRejected {},
                ..
            }) => AuthenticationLoginChecklistActivity::SubmissionRejected,
            Self::Dismissed(SignInAttemptDismissal::TakenOver) => {
                AuthenticationLoginChecklistActivity::TakenOver
            }
            Self::Dismissed(SignInAttemptDismissal::Concluded)
            | Self::StepAdvanced
            | Self::WorkflowLeft => AuthenticationLoginChecklistActivity::Ready,
            Self::SignedIn => {
                return AuthenticationLoginChecklistState::Outcome {
                    result: AuthenticationLoginChecklistResult::Confirmed,
                };
            }
            Self::Failed(SignInAttemptFailedScene {
                failure: SignInAttemptFailure::SiteRejected { .. },
                ..
            }) => {
                return AuthenticationLoginChecklistState::Outcome {
                    result: AuthenticationLoginChecklistResult::Failed,
                };
            }
            Self::ChallengeRequired { .. } => {
                return AuthenticationLoginChecklistState::Outcome {
                    result: AuthenticationLoginChecklistResult::ChallengeRequired,
                };
            }
            Self::TimedOut { .. } => {
                return AuthenticationLoginChecklistState::Outcome {
                    result: AuthenticationLoginChecklistResult::Attention,
                };
            }
        };
        AuthenticationLoginChecklistState::Activity { activity }
    }
}

impl SignInAttemptLoginForm {
    /// Actions that act on the login form are offered only while it is shown.
    fn offer(self, action: SignInAttemptActionOffer) -> Vec<SignInAttemptActionOffer> {
        match self {
            Self::Shown => vec![action],
            Self::Gone | Self::Unobserved => Vec::new(),
        }
    }
}

impl SignInAttemptFailedScene {
    /// Actions in the order the reason calls for; the first is the primary
    /// button. Reset password is offered only for a site rejection whose
    /// current page shows a revalidated same-site reset link.
    fn actions(&self) -> Vec<SignInAttemptActionOffer> {
        let try_again = self.form.offer(SignInAttemptActionOffer::TRY_AGAIN);
        let choose = self
            .form
            .offer(SignInAttemptActionOffer::CHOOSE_ANOTHER_LOGIN);
        let reset = match self.reset {
            SignInAttemptResetOffer::Offered(_) => vec![SignInAttemptActionOffer::RESET_PASSWORD],
            SignInAttemptResetOffer::NotOffered => Vec::new(),
        };
        let dismiss = vec![SignInAttemptActionOffer::DISMISS];
        match &self.failure {
            SignInAttemptFailure::SiteRejected {
                reason: SignInFailureReason::AccountLocked,
                ..
            } => [reset, choose, try_again, dismiss].concat(),
            SignInAttemptFailure::SiteRejected {
                reason: SignInFailureReason::RateLimited,
                ..
            } => [dismiss, choose, reset, try_again].concat(),
            SignInAttemptFailure::SiteRejected {
                reason:
                    SignInFailureReason::WrongCredentials
                    | SignInFailureReason::ChallengeRequired
                    | SignInFailureReason::Unknown,
                ..
            } => [try_again, choose, reset, dismiss].concat(),
            SignInAttemptFailure::FillFailed {} | SignInAttemptFailure::SubmissionRejected {} => {
                [try_again, choose, dismiss].concat()
            }
        }
    }
}

impl SignInAttemptFailure {
    fn description_key(&self) -> SignInAttemptMessageKey {
        match self {
            Self::SiteRejected { reason, .. } => reason.message_key(),
            Self::FillFailed {} => SignInAttemptMessageKey::WidgetChecklistFillFailed,
            Self::SubmissionRejected {} => SignInAttemptMessageKey::WidgetChecklistSubmitRejected,
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

#[cfg(test)]
mod tests {
    use super::{
        SignInAttemptChallenge, SignInAttemptDismissal, SignInAttemptEvidenceDemand,
        SignInAttemptFailedScene, SignInAttemptFailure, SignInAttemptLoginForm,
        SignInAttemptOrigin, SignInAttemptPresentation, SignInAttemptPresentationRequest,
        SignInAttemptRecordLifetime, SignInAttemptResetOffer, SignInAttemptScene,
        SignInAttemptSigningIn, SignInAttemptSiteMessageEvidence, SignInAttemptStatus,
        SignInFailureReason,
    };
    use crate::{AuthenticationWorkflowCurrentStep, SignInAttemptFollowUp};

    /// Expected header step and `Check result` row copy for one scene.
    struct SceneExpectation {
        scene: SignInAttemptScene,
        status: SignInAttemptStatus,
        step: u8,
        result_detail: &'static str,
    }

    impl SceneExpectation {
        fn assert_presentation(self) -> anyhow::Result<()> {
            let presentation = SignInAttemptPresentation::from(SignInAttemptPresentationRequest {
                scene: self.scene,
                lifetime: SignInAttemptRecordLifetime::Retained,
                follow_up: SignInAttemptFollowUp::None,
                viewer: SignInAttemptOrigin::try_from("https://www.namecheap.com".to_owned())?,
            });
            assert_eq!(presentation.status, self.status);
            assert_eq!(
                presentation.progress.current_step,
                AuthenticationWorkflowCurrentStep::from(self.step),
                "{:?}",
                self.status
            );
            let [_, _, result] = presentation.checklist.rows;
            assert_eq!(
                serde_json::to_string(&result.detail_key)?,
                serde_json::to_string(self.result_detail)?,
                "{:?}",
                self.status
            );
            Ok(())
        }
    }

    #[test]
    fn in_flight_and_fresh_statuses_have_a_consistent_step_counter_and_result_row()
    -> anyhow::Result<()> {
        for expectation in [
            SceneExpectation {
                scene: SignInAttemptScene::SigningIn(SignInAttemptSigningIn::Filling),
                status: SignInAttemptStatus::SigningIn,
                step: 2,
                result_detail: "widgetChecklistResultPending",
            },
            SceneExpectation {
                scene: SignInAttemptScene::SigningIn(SignInAttemptSigningIn::ManualSubmit),
                status: SignInAttemptStatus::SigningIn,
                step: 2,
                result_detail: "widgetChecklistResultPending",
            },
            SceneExpectation {
                scene: SignInAttemptScene::SigningIn(SignInAttemptSigningIn::AwaitingOutcome),
                status: SignInAttemptStatus::SigningIn,
                step: 3,
                result_detail: "widgetChecklistResultWaiting",
            },
            SceneExpectation {
                scene: SignInAttemptScene::SignedIn,
                status: SignInAttemptStatus::SignedIn,
                step: 3,
                result_detail: "widgetChecklistResultDone",
            },
            SceneExpectation {
                scene: SignInAttemptScene::Dismissed(SignInAttemptDismissal::TakenOver),
                status: SignInAttemptStatus::Dismissed,
                step: 1,
                result_detail: "widgetChecklistResultPending",
            },
            SceneExpectation {
                scene: SignInAttemptScene::Dismissed(SignInAttemptDismissal::Concluded),
                status: SignInAttemptStatus::Dismissed,
                step: 1,
                result_detail: "widgetChecklistResultPending",
            },
            SceneExpectation {
                scene: SignInAttemptScene::StepAdvanced,
                status: SignInAttemptStatus::StepAdvanced,
                step: 1,
                result_detail: "widgetChecklistResultPending",
            },
            SceneExpectation {
                scene: SignInAttemptScene::WorkflowLeft,
                status: SignInAttemptStatus::WorkflowLeft,
                step: 1,
                result_detail: "widgetChecklistResultPending",
            },
        ] {
            expectation.assert_presentation()?;
        }
        Ok(())
    }

    #[test]
    fn concluded_statuses_have_a_consistent_step_counter_and_result_row() -> anyhow::Result<()> {
        let site_failure = SignInAttemptFailedScene {
            failure: SignInAttemptFailure::SiteRejected {
                reason: SignInFailureReason::WrongCredentials,
                message: SignInAttemptSiteMessageEvidence::Absent {},
            },
            reset: SignInAttemptResetOffer::NotOffered,
            evidence: SignInAttemptEvidenceDemand::NotWanted,
            form: SignInAttemptLoginForm::Shown,
        };
        let unknown_failure = SignInAttemptFailedScene {
            failure: SignInAttemptFailure::SiteRejected {
                reason: SignInFailureReason::Unknown,
                message: SignInAttemptSiteMessageEvidence::Absent {},
            },
            ..site_failure.clone()
        };
        let fill_failure = SignInAttemptFailedScene {
            failure: SignInAttemptFailure::FillFailed {},
            ..site_failure.clone()
        };
        for expectation in [
            SceneExpectation {
                scene: SignInAttemptScene::Failed(site_failure),
                status: SignInAttemptStatus::Failed,
                step: 3,
                result_detail: "widgetChecklistResultFailed",
            },
            SceneExpectation {
                scene: SignInAttemptScene::Failed(unknown_failure),
                status: SignInAttemptStatus::Failed,
                step: 3,
                result_detail: "widgetChecklistResultFailed",
            },
            SceneExpectation {
                scene: SignInAttemptScene::Failed(fill_failure),
                status: SignInAttemptStatus::Failed,
                step: 2,
                result_detail: "widgetChecklistResultPending",
            },
            SceneExpectation {
                scene: SignInAttemptScene::ChallengeRequired {
                    challenge: SignInAttemptChallenge::OneTimeCode,
                    evidence: SignInAttemptEvidenceDemand::NotWanted,
                    form: SignInAttemptLoginForm::Shown,
                },
                status: SignInAttemptStatus::ChallengeRequired,
                step: 3,
                result_detail: "widgetChecklistResultChallenge",
            },
            SceneExpectation {
                scene: SignInAttemptScene::TimedOut {
                    evidence: SignInAttemptEvidenceDemand::NotWanted,
                    form: SignInAttemptLoginForm::Shown,
                },
                status: SignInAttemptStatus::TimedOut,
                step: 3,
                result_detail: "widgetChecklistResultAttention",
            },
        ] {
            expectation.assert_presentation()?;
        }
        Ok(())
    }
}
