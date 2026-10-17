//! Post-submit outcome classification, stability, and the outcome budget.
//!
//! Decisions, in order, for each page observation after submit:
//!
//! 1. The explicit error marker (alone or with a success marker) is a failure.
//! 2. A fresh error-looking message while the submitted step's username or
//!    password field is still present is a failure. A message is fresh on a
//!    `NewDocument`, or on the `SameDocument` only when the submit-time
//!    baseline had no message candidate.
//! 3. A manual checkpoint is a verification challenge; a one-time-code field
//!    absent at submit is a one-time-code challenge.
//! 4. The explicit success marker confirms sign-in.
//! 5. No auth fields and no error-looking message confirms sign-in once that
//!    evidence has been stable for the existing 750 ms interval.
//! 6. The same username/password step re-presented on a `NewDocument` with no
//!    error-looking message fails with reason `Unknown` once stable for 2 s.
//! 7. Otherwise the attempt keeps waiting until the 20 s outcome budget,
//!    measured from submit, expires visibly as `TimedOut`.

use serde::{Deserialize, Serialize};

use super::conclusion::{
    SignInAttemptChallenge, SignInAttemptClosing, SignInAttemptConclusion, SignInAttemptFailure,
    SignInAttemptSiteMessage, SignInAttemptSiteMessageEvidence,
};
use super::failure_reason::SignInFailureReason;
use super::lifecycle::{SignInAttemptEventContext, SignInAttemptNext, SignInAttemptStep};
use super::message_evidence::SignInAttemptErrorMessageSelection;
use super::page_evidence::{SignInAttemptDocumentRelation, SignInAttemptPageEvidence};
use super::presentation::{SignInAttemptResetOffer, SignInAttemptScene, SignInAttemptSigningIn};
use super::record::{SignInAttemptChronology, SignInAttemptInstant};
use super::request::{
    SignInAttemptActivity, SignInAttemptAuthFields, SignInAttemptEvent,
    SignInAttemptSubmitBaseline, SignInAttemptUserAction,
};
use super::site::SignInAttemptSite;
use crate::{
    AuthenticationOutcomeElapsedMilliseconds, AuthenticationOutcomeTimeoutMilliseconds,
    LoginSaveOutcomeObservation, SignInAttemptFollowUp,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptFieldPresence {
    Present,
    Absent,
}

impl From<bool> for SignInAttemptFieldPresence {
    #[expect(
        clippy::match_bool,
        reason = "the frozen sensor contract boolean is converted immediately into named presence"
    )]
    fn from(present: bool) -> Self {
        match present {
            true => Self::Present,
            false => Self::Absent,
        }
    }
}

/// Which credential fields of one login step are visible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SignInAttemptAuthStep {
    username: SignInAttemptFieldPresence,
    current_password: SignInAttemptFieldPresence,
    one_time_code: SignInAttemptFieldPresence,
}

impl From<&SignInAttemptAuthFields> for SignInAttemptAuthStep {
    fn from(fields: &SignInAttemptAuthFields) -> Self {
        Self {
            username: SignInAttemptFieldPresence::from(fields.username_present),
            current_password: SignInAttemptFieldPresence::from(fields.current_password_present),
            one_time_code: SignInAttemptFieldPresence::from(fields.one_time_code_present),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptStepRelation {
    /// Same username/password presence as the submitted step.
    SameStep,
    /// A username or password field of the submitted step is still visible.
    OverlappingStep,
    /// A different authentication step (for example a new code field).
    OtherStep,
    /// No authentication field is visible.
    NoAuthFields,
}

impl SignInAttemptAuthStep {
    fn relation(self, current: Self) -> SignInAttemptStepRelation {
        use SignInAttemptFieldPresence::{Absent, Present};
        let fields = (
            current.username,
            current.current_password,
            current.one_time_code,
        );
        if let (Absent, Absent, Absent) = fields {
            return SignInAttemptStepRelation::NoAuthFields;
        }
        match (
            self.username,
            current.username,
            self.current_password,
            current.current_password,
        ) {
            (Present, Present, Present, Present)
            | (Present, Present, Absent, Absent)
            | (Absent, Absent, Present, Present) => SignInAttemptStepRelation::SameStep,
            (Present, Present, Present | Absent, Present | Absent)
            | (Present | Absent, Present | Absent, Present, Present) => {
                SignInAttemptStepRelation::OverlappingStep
            }
            (Present | Absent, Present | Absent, Present | Absent, Present | Absent) => {
                SignInAttemptStepRelation::OtherStep
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptMessagePresence {
    Present,
    Absent,
}

impl From<bool> for SignInAttemptMessagePresence {
    #[expect(
        clippy::match_bool,
        reason = "the frozen sensor contract boolean is converted immediately into named presence"
    )]
    fn from(present: bool) -> Self {
        match present {
            true => Self::Present,
            false => Self::Absent,
        }
    }
}

/// Minimal submit-time facts retained in the record; never page text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SignInAttemptBaseline {
    messages: SignInAttemptMessagePresence,
    fields: SignInAttemptAuthStep,
}

impl From<&SignInAttemptSubmitBaseline> for SignInAttemptBaseline {
    fn from(baseline: &SignInAttemptSubmitBaseline) -> Self {
        Self {
            messages: SignInAttemptMessagePresence::from(baseline.error_message_present),
            fields: SignInAttemptAuthStep::from(&baseline.auth_fields),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptMessageFreshness {
    Fresh,
    Stale,
}

impl SignInAttemptBaseline {
    fn freshness(self, document: SignInAttemptDocumentRelation) -> SignInAttemptMessageFreshness {
        match (document, self.messages) {
            (SignInAttemptDocumentRelation::NewDocument, _)
            | (SignInAttemptDocumentRelation::SameDocument, SignInAttemptMessagePresence::Absent) => {
                SignInAttemptMessageFreshness::Fresh
            }
            (
                SignInAttemptDocumentRelation::SameDocument,
                SignInAttemptMessagePresence::Present,
            ) => SignInAttemptMessageFreshness::Stale,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptSettlingEvidence {
    /// No auth fields, no error-looking message, no challenge.
    SignedInLooking,
    /// The submitted step re-presented on a new document without a message.
    StepRepresented,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptSettledness {
    Settled,
    Settling,
}

impl SignInAttemptSettlingEvidence {
    fn window(self) -> AuthenticationOutcomeTimeoutMilliseconds {
        match self {
            Self::SignedInLooking => SignInAttemptOutcomeWait::CONFIRMATION_STABILITY,
            Self::StepRepresented => SignInAttemptOutcomeWait::REPRESENTATION_STABILITY,
        }
    }

    #[expect(
        clippy::match_bool,
        reason = "the elapsed-time comparison is converted immediately into named settledness"
    )]
    fn settledness(
        self,
        elapsed: AuthenticationOutcomeElapsedMilliseconds,
    ) -> SignInAttemptSettledness {
        match elapsed.has_reached(self.window()) {
            true => SignInAttemptSettledness::Settled,
            false => SignInAttemptSettledness::Settling,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum SignInAttemptStability {
    Unsettled,
    Settling {
        evidence: SignInAttemptSettlingEvidence,
        since: SignInAttemptInstant,
    },
}

/// The record's post-submit wait.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SignInAttemptOutcomeWait {
    submitted_at: SignInAttemptInstant,
    baseline: SignInAttemptBaseline,
    stability: SignInAttemptStability,
}

pub(crate) struct SignInAttemptSubmission<'a> {
    pub(crate) baseline: &'a SignInAttemptSubmitBaseline,
    pub(crate) now: SignInAttemptInstant,
}

impl From<SignInAttemptSubmission<'_>> for SignInAttemptOutcomeWait {
    fn from(submission: SignInAttemptSubmission<'_>) -> Self {
        Self {
            submitted_at: submission.now,
            baseline: SignInAttemptBaseline::from(submission.baseline),
            stability: SignInAttemptStability::Unsettled,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptBudget {
    Remaining,
    Exhausted,
}

/// What one page observation says about the submitted login.
#[derive(Debug, Clone, PartialEq, Eq)]
enum SignInAttemptPageReading {
    Failure {
        reason: SignInFailureReason,
        message: SignInAttemptSiteMessageEvidence,
    },
    Challenge(SignInAttemptChallenge),
    SignedIn,
    Settling(SignInAttemptSettlingEvidence),
    Undecided,
}

struct SignInAttemptObservation<'a> {
    page: SignInAttemptPageEvidence,
    site: &'a SignInAttemptSite,
    now: SignInAttemptInstant,
}

struct SignInAttemptSettlement<'a> {
    evidence: SignInAttemptSettlingEvidence,
    observation: SignInAttemptObservation<'a>,
}

impl SignInAttemptOutcomeWait {
    /// Budget from submit; it tolerates a full reload and a slow site response.
    pub(crate) const OUTCOME_BUDGET: AuthenticationOutcomeTimeoutMilliseconds =
        AuthenticationOutcomeTimeoutMilliseconds::from_raw(20_000);
    /// The existing submitted-login stability interval (750 ms).
    pub(crate) const CONFIRMATION_STABILITY: AuthenticationOutcomeTimeoutMilliseconds =
        LoginSaveOutcomeObservation::STABILITY_DELAY_MS;
    /// Time for late client-rendered error text before an unexplained re-presentation fails.
    pub(crate) const REPRESENTATION_STABILITY: AuthenticationOutcomeTimeoutMilliseconds =
        AuthenticationOutcomeTimeoutMilliseconds::from_raw(2_000);

    pub(crate) fn chronology_after(
        self,
        started_at: SignInAttemptInstant,
    ) -> SignInAttemptChronology {
        let settled_after_submit = match self.stability {
            SignInAttemptStability::Unsettled => SignInAttemptChronology::Ordered,
            SignInAttemptStability::Settling { since, .. } => {
                since.chronology_after(self.submitted_at)
            }
        };
        match (
            self.submitted_at.chronology_after(started_at),
            settled_after_submit,
        ) {
            (SignInAttemptChronology::Ordered, SignInAttemptChronology::Ordered) => {
                SignInAttemptChronology::Ordered
            }
            (SignInAttemptChronology::Reversed, _) | (_, SignInAttemptChronology::Reversed) => {
                SignInAttemptChronology::Reversed
            }
        }
    }

    pub(crate) fn advance(self, context: SignInAttemptEventContext<'_>) -> SignInAttemptStep {
        let SignInAttemptEventContext {
            binding,
            now,
            event,
        } = context;
        match event {
            SignInAttemptEvent::PageObserved { page } => self.observe(SignInAttemptObservation {
                page,
                site: binding.site,
                now,
            }),
            SignInAttemptEvent::Activity {
                activity: SignInAttemptActivity::Submitted { baseline },
            } => Self::from(SignInAttemptSubmission {
                baseline: &baseline,
                now,
            })
            .wait_or_expire(now),
            SignInAttemptEvent::UserAction {
                action: SignInAttemptUserAction::Dismiss,
            } => SignInAttemptStep::closing(SignInAttemptClosing::TAKEN_OVER),
            SignInAttemptEvent::Resumed
            | SignInAttemptEvent::Activity {
                activity:
                    SignInAttemptActivity::Filled
                    | SignInAttemptActivity::FillFailed
                    | SignInAttemptActivity::SubmissionRejected
                    | SignInAttemptActivity::SubmissionUnobserved,
            }
            | SignInAttemptEvent::UserAction {
                action:
                    SignInAttemptUserAction::TryAgain
                    | SignInAttemptUserAction::ChooseAnotherLogin
                    | SignInAttemptUserAction::ResetPassword { .. }
                    | SignInAttemptUserAction::FillAuthenticator,
            } => self.wait_or_expire(now),
        }
    }

    /// Decisive evidence is evaluated before the budget is applied.
    fn observe(self, observation: SignInAttemptObservation<'_>) -> SignInAttemptStep {
        match self.baseline.reading(&observation.page) {
            SignInAttemptPageReading::Failure { reason, message } => {
                SignInAttemptOutcomeWait::site_rejection(SignInAttemptRejection {
                    failure: SignInAttemptFailure::SiteRejected { reason, message },
                    observation,
                })
            }
            SignInAttemptPageReading::Challenge(challenge) => {
                SignInAttemptConclusion::ChallengeRequired { challenge }
                    .presented(SignInAttemptResetOffer::NotOffered)
            }
            SignInAttemptPageReading::SignedIn => SignInAttemptStep::signed_in(),
            SignInAttemptPageReading::Settling(evidence) => self.settle(SignInAttemptSettlement {
                evidence,
                observation,
            }),
            SignInAttemptPageReading::Undecided => Self {
                stability: SignInAttemptStability::Unsettled,
                ..self
            }
            .wait_or_expire(observation.now),
        }
    }

    fn settle(self, settlement: SignInAttemptSettlement<'_>) -> SignInAttemptStep {
        use SignInAttemptSettlingEvidence::{SignedInLooking, StepRepresented};
        let SignInAttemptSettlement {
            evidence,
            observation,
        } = settlement;
        let since = match (self.stability, evidence) {
            (
                SignInAttemptStability::Settling {
                    evidence: SignedInLooking,
                    since,
                },
                SignedInLooking,
            )
            | (
                SignInAttemptStability::Settling {
                    evidence: StepRepresented,
                    since,
                },
                StepRepresented,
            ) => since,
            (
                SignInAttemptStability::Settling {
                    evidence: SignedInLooking,
                    ..
                },
                StepRepresented,
            )
            | (
                SignInAttemptStability::Settling {
                    evidence: StepRepresented,
                    ..
                },
                SignedInLooking,
            )
            | (SignInAttemptStability::Unsettled, SignedInLooking | StepRepresented) => {
                observation.now
            }
        };
        let elapsed = observation.now.elapsed_since(since);
        match (evidence.settledness(elapsed), evidence) {
            (SignInAttemptSettledness::Settled, SignedInLooking) => SignInAttemptStep::signed_in(),
            (SignInAttemptSettledness::Settled, StepRepresented) => {
                SignInAttemptOutcomeWait::site_rejection(SignInAttemptRejection {
                    failure: SignInAttemptFailure::SiteRejected {
                        reason: SignInFailureReason::Unknown,
                        message: SignInAttemptSiteMessageEvidence::Absent,
                    },
                    observation,
                })
            }
            (SignInAttemptSettledness::Settling, SignedInLooking | StepRepresented) => Self {
                stability: SignInAttemptStability::Settling { evidence, since },
                ..self
            }
            .wait_or_expire(observation.now),
        }
    }

    fn site_rejection(rejection: SignInAttemptRejection<'_>) -> SignInAttemptStep {
        let SignInAttemptRejection {
            failure,
            observation,
        } = rejection;
        let reset =
            SignInAttemptResetOffer::from(observation.page.links.reset_link(observation.site));
        SignInAttemptConclusion::Failed { failure }.presented(reset)
    }

    #[expect(
        clippy::match_bool,
        reason = "the elapsed-time comparison is converted immediately into the named budget state"
    )]
    fn budget(self, now: SignInAttemptInstant) -> SignInAttemptBudget {
        match now
            .elapsed_since(self.submitted_at)
            .has_reached(Self::OUTCOME_BUDGET)
        {
            true => SignInAttemptBudget::Exhausted,
            false => SignInAttemptBudget::Remaining,
        }
    }

    fn wait_or_expire(self, now: SignInAttemptInstant) -> SignInAttemptStep {
        match self.budget(now) {
            SignInAttemptBudget::Exhausted => SignInAttemptConclusion::TimedOut.unobserved(),
            SignInAttemptBudget::Remaining => SignInAttemptStep {
                next: SignInAttemptNext::AwaitingOutcome(self),
                scene: SignInAttemptScene::SigningIn(SignInAttemptSigningIn::AwaitingOutcome),
                follow_up: SignInAttemptFollowUp::None,
            },
        }
    }
}

struct SignInAttemptRejection<'a> {
    failure: SignInAttemptFailure,
    observation: SignInAttemptObservation<'a>,
}

/// A fresh error-looking message, or none usable for a failure decision.
enum SignInAttemptFreshError {
    Fresh {
        reason: SignInFailureReason,
        message: SignInAttemptSiteMessage,
    },
    NotFresh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptOutcomeMarker {
    Error,
    Success,
    Absent,
}

impl From<&SignInAttemptPageEvidence> for SignInAttemptOutcomeMarker {
    /// The error marker dominates: success with error is never a sign-in.
    fn from(page: &SignInAttemptPageEvidence) -> Self {
        match (page.error_marker_present, page.success_marker_present) {
            (true, true | false) => Self::Error,
            (false, true) => Self::Success,
            (false, false) => Self::Absent,
        }
    }
}

impl SignInAttemptBaseline {
    fn fresh_error(self, page: &SignInAttemptPageEvidence) -> SignInAttemptFreshError {
        match (
            self.freshness(page.document),
            page.messages.error_selection(),
        ) {
            (
                SignInAttemptMessageFreshness::Fresh,
                SignInAttemptErrorMessageSelection::Selected(selected),
            ) => SignInAttemptFreshError::Fresh {
                reason: selected.reason,
                message: SignInAttemptSiteMessage::from(&selected.text),
            },
            (SignInAttemptMessageFreshness::Stale, _)
            | (
                SignInAttemptMessageFreshness::Fresh,
                SignInAttemptErrorMessageSelection::NoneErrorLooking,
            ) => SignInAttemptFreshError::NotFresh,
        }
    }

    fn reading(self, page: &SignInAttemptPageEvidence) -> SignInAttemptPageReading {
        let current = SignInAttemptAuthStep::from(&page.auth_fields);
        let relation = self.fields.relation(current);
        let marker = SignInAttemptOutcomeMarker::from(page);
        let failure = match (marker, self.fresh_error(page), relation) {
            (
                SignInAttemptOutcomeMarker::Error,
                SignInAttemptFreshError::Fresh { reason, message },
                _,
            )
            | (
                SignInAttemptOutcomeMarker::Success | SignInAttemptOutcomeMarker::Absent,
                SignInAttemptFreshError::Fresh { reason, message },
                SignInAttemptStepRelation::SameStep | SignInAttemptStepRelation::OverlappingStep,
            ) => SignInAttemptPageReading::Failure {
                reason,
                message: SignInAttemptSiteMessageEvidence::Captured { text: message },
            },
            (SignInAttemptOutcomeMarker::Error, SignInAttemptFreshError::NotFresh, _) => {
                SignInAttemptPageReading::Failure {
                    reason: SignInFailureReason::Unknown,
                    message: SignInAttemptSiteMessageEvidence::Absent,
                }
            }
            (
                SignInAttemptOutcomeMarker::Success | SignInAttemptOutcomeMarker::Absent,
                SignInAttemptFreshError::Fresh { .. } | SignInAttemptFreshError::NotFresh,
                _,
            ) => SignInAttemptPageReading::Undecided,
        };
        match failure {
            SignInAttemptPageReading::Undecided => {
                self.non_failure_reading(SignInAttemptNonFailure {
                    page,
                    current,
                    relation,
                    marker,
                })
            }
            decided @ (SignInAttemptPageReading::Failure { .. }
            | SignInAttemptPageReading::Challenge(_)
            | SignInAttemptPageReading::SignedIn
            | SignInAttemptPageReading::Settling(_)) => decided,
        }
    }

    fn non_failure_reading(self, facts: SignInAttemptNonFailure<'_>) -> SignInAttemptPageReading {
        use SignInAttemptFieldPresence::{Absent, Present};
        let SignInAttemptNonFailure {
            page,
            current,
            relation,
            marker,
        } = facts;
        let checkpoint = SignInAttemptFieldPresence::from(page.manual_checkpoint_present);
        match (checkpoint, current.one_time_code, self.fields.one_time_code) {
            (Present, _, _) => {
                return SignInAttemptPageReading::Challenge(SignInAttemptChallenge::Verification);
            }
            (Absent, Present, Absent) => {
                return SignInAttemptPageReading::Challenge(SignInAttemptChallenge::OneTimeCode);
            }
            (Absent, Present, Present) | (Absent, Absent, Present | Absent) => {}
        }
        let any_error = page.messages.error_selection();
        match (marker, relation, any_error, page.document) {
            (SignInAttemptOutcomeMarker::Success, _, _, _) => SignInAttemptPageReading::SignedIn,
            (
                SignInAttemptOutcomeMarker::Absent | SignInAttemptOutcomeMarker::Error,
                SignInAttemptStepRelation::NoAuthFields,
                SignInAttemptErrorMessageSelection::NoneErrorLooking,
                _,
            ) => SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::SignedInLooking),
            (
                SignInAttemptOutcomeMarker::Absent | SignInAttemptOutcomeMarker::Error,
                SignInAttemptStepRelation::SameStep,
                SignInAttemptErrorMessageSelection::NoneErrorLooking,
                SignInAttemptDocumentRelation::NewDocument,
            ) => SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::StepRepresented),
            (SignInAttemptOutcomeMarker::Absent | SignInAttemptOutcomeMarker::Error, _, _, _) => {
                SignInAttemptPageReading::Undecided
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct SignInAttemptNonFailure<'a> {
    page: &'a SignInAttemptPageEvidence,
    current: SignInAttemptAuthStep,
    relation: SignInAttemptStepRelation,
    marker: SignInAttemptOutcomeMarker,
}
