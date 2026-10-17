//! Begin and advance transitions of the sign-in attempt lifecycle.
//!
//! `begin` admits the sender origin's site and starts in `Filling`. `advance`
//! strictly decodes the stored record (`RecordRejected` on any failure),
//! binds the sender to the record's site (`OtherSite` otherwise), applies one
//! event to the current phase, and returns the disposition plus presentation.
//! There is no automatic retry, replay, or reconciliation: every change of a
//! concluded attempt is an explicit user action.

use serde::Serialize;
use tsify::Tsify;

use super::conclusion::{SignInAttemptClosing, SignInAttemptConclusion, SignInAttemptFailure};
use super::outcome::{SignInAttemptOutcomeWait, SignInAttemptSubmission};
use super::page_evidence::SignInAttemptDocumentRelation;
use super::presentation::{
    SignInAttemptPresentation, SignInAttemptPresentationRequest, SignInAttemptRecordLifetime,
    SignInAttemptScene, SignInAttemptSigningIn,
};
use super::record::{
    SignInAttemptInstant, SignInAttemptPhase, SignInAttemptPreSubmitStep, SignInAttemptRecord,
    SignInAttemptRecordSchema, SignInAttemptStoredRecord,
};
use super::request::{
    SignInAttemptActivity, SignInAttemptAdvanceRequest, SignInAttemptBeginRequest,
    SignInAttemptEvent, SignInAttemptLoginReference, SignInAttemptRequestError,
    SignInAttemptUserAction,
};
use super::site::{SignInAttemptSite, SignInAttemptSiteRelation};
use crate::SignInAttemptFollowUp;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SignInAttemptTransition {
    pub disposition: SignInAttemptDisposition,
    pub presentation: SignInAttemptPresentation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SignInAttemptDisposition {
    Retain {
        record: SignInAttemptStoredRecord,
    },
    /// Remove the record (and its message text) after rendering.
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SignInAttemptAdvance {
    Advanced {
        transition: Box<SignInAttemptTransition>,
    },
    /// The record failed strict decode or is internally inconsistent: the
    /// service worker removes it and the Pilot starts fresh.
    RecordRejected,
    /// The record belongs to another site in this tab: leave it stored and
    /// render the normal fresh Pilot for this page.
    OtherSite,
}

/// The record's site and login, borrowed for one event.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SignInAttemptBinding<'a> {
    pub(crate) site: &'a SignInAttemptSite,
    pub(crate) login: &'a SignInAttemptLoginReference,
}

pub(crate) struct SignInAttemptEventContext<'a> {
    pub(crate) binding: SignInAttemptBinding<'a>,
    pub(crate) now: SignInAttemptInstant,
    pub(crate) event: SignInAttemptEvent,
}

/// The phase that follows one event, or the end of the record.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SignInAttemptNext {
    BeforeSubmit(SignInAttemptPreSubmitStep),
    AwaitingOutcome(SignInAttemptOutcomeWait),
    Concluded(SignInAttemptConclusion),
    Close,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SignInAttemptStep {
    pub(crate) next: SignInAttemptNext,
    pub(crate) scene: SignInAttemptScene,
    pub(crate) follow_up: SignInAttemptFollowUp,
}

impl SignInAttemptStep {
    pub(crate) fn closing(closing: SignInAttemptClosing) -> Self {
        let SignInAttemptClosing { scene, follow_up } = closing;
        Self {
            next: SignInAttemptNext::Close,
            scene,
            follow_up,
        }
    }

    /// Try again: close this attempt; the fill path begins a new one.
    pub(crate) fn restarting(login: &SignInAttemptLoginReference) -> Self {
        Self::closing(SignInAttemptClosing {
            scene: SignInAttemptScene::SigningIn(SignInAttemptSigningIn::Restarting),
            follow_up: SignInAttemptFollowUp::RestartWithSameLogin {
                login: login.clone(),
            },
        })
    }

    /// Signed in: closed right after this presentation is delivered.
    pub(crate) fn signed_in() -> Self {
        Self::closing(SignInAttemptClosing {
            scene: SignInAttemptScene::SignedIn,
            follow_up: SignInAttemptFollowUp::None,
        })
    }
}

/// Unchanged record fields carried from one revision of the record to the next.
struct SignInAttemptIdentity {
    site: SignInAttemptSite,
    login: SignInAttemptLoginReference,
    started_at: SignInAttemptInstant,
}

struct SignInAttemptCompletion {
    identity: SignInAttemptIdentity,
    step: SignInAttemptStep,
}

impl SignInAttemptCompletion {
    fn transition(self) -> Result<SignInAttemptTransition, SignInAttemptRequestError> {
        let Self { identity, step } = self;
        let SignInAttemptStep {
            next,
            scene,
            follow_up,
        } = step;
        let phase = match next {
            SignInAttemptNext::BeforeSubmit(step) => SignInAttemptPhase::BeforeSubmit { step },
            SignInAttemptNext::AwaitingOutcome(wait) => {
                SignInAttemptPhase::AwaitingOutcome { wait }
            }
            SignInAttemptNext::Concluded(conclusion) => {
                SignInAttemptPhase::Concluded { conclusion }
            }
            SignInAttemptNext::Close => {
                return Ok(SignInAttemptTransition {
                    disposition: SignInAttemptDisposition::Close,
                    presentation: SignInAttemptPresentation::from(
                        SignInAttemptPresentationRequest {
                            scene,
                            lifetime: SignInAttemptRecordLifetime::Closing,
                            follow_up,
                        },
                    ),
                });
            }
        };
        let SignInAttemptIdentity {
            site,
            login,
            started_at,
        } = identity;
        let record = SignInAttemptRecord {
            schema: SignInAttemptRecordSchema::CURRENT,
            site,
            login,
            started_at,
            phase,
        }
        .encode()?;
        Ok(SignInAttemptTransition {
            disposition: SignInAttemptDisposition::Retain { record },
            presentation: SignInAttemptPresentation::from(SignInAttemptPresentationRequest {
                scene,
                lifetime: SignInAttemptRecordLifetime::Retained,
                follow_up,
            }),
        })
    }
}

impl SignInAttemptBeginRequest {
    /// Starts one attempt bound to the sender's site. A sender origin that is
    /// not a canonical http(s) origin is a malformed request.
    pub fn begin(self) -> Result<SignInAttemptTransition, SignInAttemptRequestError> {
        let Self {
            sender_origin,
            login,
            now,
        } = self;
        let started_at = SignInAttemptInstant::try_from(now)?;
        let site = sender_origin
            .site()
            .map_err(|_| SignInAttemptRequestError::SenderOriginInvalid)?;
        SignInAttemptCompletion {
            identity: SignInAttemptIdentity {
                site,
                login,
                started_at,
            },
            step: SignInAttemptPreSubmitStep::Filling.unchanged(),
        }
        .transition()
    }
}

impl SignInAttemptAdvanceRequest {
    /// Applies one event to the tab's stored attempt.
    pub fn advance(self) -> Result<SignInAttemptAdvance, SignInAttemptRequestError> {
        let Self {
            record,
            sender_origin,
            now,
            event,
        } = self;
        let now = SignInAttemptInstant::try_from(now)?;
        let Ok(record) = record.decode() else {
            return Ok(SignInAttemptAdvance::RecordRejected);
        };
        let Ok(sender_site) = sender_origin.site() else {
            return Ok(SignInAttemptAdvance::OtherSite);
        };
        match record.site.relation(&sender_site) {
            SignInAttemptSiteRelation::SameSite => {}
            SignInAttemptSiteRelation::OtherSite => return Ok(SignInAttemptAdvance::OtherSite),
        }
        let transition = record.apply(SignInAttemptTimedEvent { now, event })?;
        Ok(SignInAttemptAdvance::Advanced {
            transition: Box::new(transition),
        })
    }
}

struct SignInAttemptTimedEvent {
    now: SignInAttemptInstant,
    event: SignInAttemptEvent,
}

impl SignInAttemptRecord {
    fn apply(
        self,
        timed: SignInAttemptTimedEvent,
    ) -> Result<SignInAttemptTransition, SignInAttemptRequestError> {
        let Self {
            schema: SignInAttemptRecordSchema::V1,
            site,
            login,
            started_at,
            phase,
        } = self;
        let SignInAttemptTimedEvent { now, event } = timed;
        let context = SignInAttemptEventContext {
            binding: SignInAttemptBinding {
                site: &site,
                login: &login,
            },
            now,
            event,
        };
        let step = match phase {
            SignInAttemptPhase::BeforeSubmit { step } => step.advance(context),
            SignInAttemptPhase::AwaitingOutcome { wait } => wait.advance(context),
            SignInAttemptPhase::Concluded { conclusion } => conclusion.advance(context),
        };
        SignInAttemptCompletion {
            identity: SignInAttemptIdentity {
                site,
                login,
                started_at,
            },
            step,
        }
        .transition()
    }
}

impl SignInAttemptPreSubmitStep {
    fn unchanged(self) -> SignInAttemptStep {
        let signing_in = match self {
            Self::Filling => SignInAttemptSigningIn::Filling,
            Self::Filled => SignInAttemptSigningIn::Filled,
            Self::ManualSubmit => SignInAttemptSigningIn::ManualSubmit,
        };
        SignInAttemptStep {
            next: SignInAttemptNext::BeforeSubmit(self),
            scene: SignInAttemptScene::SigningIn(signing_in),
            follow_up: SignInAttemptFollowUp::None,
        }
    }

    /// Before submit, only the acting document reports progress. A resumed or
    /// new document means that document went away before Nook recorded a
    /// submission, so the outcome cannot be confirmed: the attempt concludes
    /// visibly as `TimedOut` instead of guessing that a submit happened.
    fn advance(self, context: SignInAttemptEventContext<'_>) -> SignInAttemptStep {
        let SignInAttemptEventContext { now, event, .. } = context;
        match event {
            SignInAttemptEvent::Resumed => SignInAttemptConclusion::TimedOut.unobserved(),
            SignInAttemptEvent::PageObserved { page } => match page.document {
                SignInAttemptDocumentRelation::NewDocument => {
                    SignInAttemptConclusion::TimedOut.unobserved()
                }
                SignInAttemptDocumentRelation::SameDocument => self.unchanged(),
            },
            SignInAttemptEvent::Activity { activity } => {
                self.after_activity(SignInAttemptPreSubmitActivity { activity, now })
            }
            SignInAttemptEvent::UserAction {
                action: SignInAttemptUserAction::Dismiss,
            } => SignInAttemptStep::closing(SignInAttemptClosing::TAKEN_OVER),
            SignInAttemptEvent::UserAction {
                action:
                    SignInAttemptUserAction::TryAgain
                    | SignInAttemptUserAction::ChooseAnotherLogin
                    | SignInAttemptUserAction::ResetPassword { .. }
                    | SignInAttemptUserAction::FillAuthenticator,
            } => self.unchanged(),
        }
    }

    fn after_activity(self, report: SignInAttemptPreSubmitActivity) -> SignInAttemptStep {
        let SignInAttemptPreSubmitActivity { activity, now } = report;
        match (self, activity) {
            (
                Self::Filling | Self::Filled | Self::ManualSubmit,
                SignInAttemptActivity::Submitted { baseline },
            ) => SignInAttemptStep {
                next: SignInAttemptNext::AwaitingOutcome(SignInAttemptOutcomeWait::from(
                    SignInAttemptSubmission {
                        baseline: &baseline,
                        now,
                    },
                )),
                scene: SignInAttemptScene::SigningIn(SignInAttemptSigningIn::AwaitingOutcome),
                follow_up: SignInAttemptFollowUp::None,
            },
            (Self::Filling | Self::Filled, SignInAttemptActivity::Filled) => {
                Self::Filled.unchanged()
            }
            (Self::Filling | Self::Filled, SignInAttemptActivity::SubmissionUnobserved) => {
                Self::ManualSubmit.unchanged()
            }
            (Self::Filling | Self::Filled, SignInAttemptActivity::FillFailed) => {
                SignInAttemptConclusion::Failed {
                    failure: SignInAttemptFailure::FillFailed,
                }
                .unobserved()
            }
            (
                Self::Filling | Self::Filled | Self::ManualSubmit,
                SignInAttemptActivity::SubmissionRejected,
            ) => SignInAttemptConclusion::Failed {
                failure: SignInAttemptFailure::SubmissionRejected,
            }
            .unobserved(),
            (
                Self::ManualSubmit,
                SignInAttemptActivity::Filled
                | SignInAttemptActivity::FillFailed
                | SignInAttemptActivity::SubmissionUnobserved,
            ) => self.unchanged(),
        }
    }
}

struct SignInAttemptPreSubmitActivity {
    activity: SignInAttemptActivity,
    now: SignInAttemptInstant,
}
