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

use super::conclusion::{SignInAttemptClosing, SignInAttemptConcluded};
use super::end_state::{SignInAttemptConclusion, SignInAttemptFailure, SignInAttemptLoginForm};
use super::outcome::{SignInAttemptOutcomeWait, SignInAttemptSubmission};
use super::page_evidence::SignInAttemptDocumentRelation;
use super::presentation::{
    SignInAttemptPresentation, SignInAttemptPresentationRequest, SignInAttemptRecordLifetime,
    SignInAttemptResetOffer, SignInAttemptScene, SignInAttemptSigningIn,
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
use super::site::{SignInAttemptOrigin, SignInAttemptSite, SignInAttemptSiteRelation};
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
    /// The exact origin of the page that sent this event.
    pub(crate) sender: &'a SignInAttemptOrigin,
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
    Concluded(SignInAttemptConcluded),
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
    origin: SignInAttemptOrigin,
    login: SignInAttemptLoginReference,
    started_at: SignInAttemptInstant,
}

struct SignInAttemptCompletion {
    identity: SignInAttemptIdentity,
    step: SignInAttemptStep,
    /// The exact origin the presentation is delivered to; a site message is
    /// shown only when it equals the message's capture origin.
    viewer: SignInAttemptOrigin,
}

impl SignInAttemptCompletion {
    fn transition(self) -> Result<SignInAttemptTransition, SignInAttemptRequestError> {
        let Self {
            identity,
            step,
            viewer,
        } = self;
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
            SignInAttemptNext::Concluded(SignInAttemptConcluded { conclusion, form }) => {
                SignInAttemptPhase::Concluded { conclusion, form }
            }
            SignInAttemptNext::Close => {
                return Ok(SignInAttemptTransition {
                    disposition: SignInAttemptDisposition::Close,
                    presentation: SignInAttemptPresentation::from(
                        SignInAttemptPresentationRequest {
                            scene,
                            lifetime: SignInAttemptRecordLifetime::Closing,
                            follow_up,
                            viewer,
                        },
                    ),
                });
            }
        };
        let SignInAttemptIdentity {
            origin,
            login,
            started_at,
        } = identity;
        let record = SignInAttemptRecord {
            schema: SignInAttemptRecordSchema::CURRENT,
            origin,
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
                viewer,
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
        let origin = sender_origin
            .origin()
            .map_err(|_| SignInAttemptRequestError::SenderOriginInvalid)?;
        SignInAttemptCompletion {
            identity: SignInAttemptIdentity {
                origin: origin.clone(),
                login,
                started_at,
            },
            step: SignInAttemptPreSubmitStep::Filling.unchanged(),
            viewer: origin,
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
        let Ok(sender) = sender_origin.origin() else {
            return Ok(SignInAttemptAdvance::OtherSite);
        };
        match record.origin.site().relation(sender.site()) {
            SignInAttemptSiteRelation::SameSite => {}
            SignInAttemptSiteRelation::OtherSite => return Ok(SignInAttemptAdvance::OtherSite),
        }
        let transition = record.apply(SignInAttemptTimedEvent { now, event, sender })?;
        Ok(SignInAttemptAdvance::Advanced {
            transition: Box::new(transition),
        })
    }
}

struct SignInAttemptTimedEvent {
    now: SignInAttemptInstant,
    event: SignInAttemptEvent,
    sender: SignInAttemptOrigin,
}

impl SignInAttemptRecord {
    fn apply(
        self,
        timed: SignInAttemptTimedEvent,
    ) -> Result<SignInAttemptTransition, SignInAttemptRequestError> {
        let Self {
            schema: SignInAttemptRecordSchema::V1,
            origin,
            login,
            started_at,
            phase,
        } = self;
        let SignInAttemptTimedEvent { now, event, sender } = timed;
        let context = SignInAttemptEventContext {
            binding: SignInAttemptBinding {
                site: origin.site(),
                login: &login,
                sender: &sender,
            },
            now,
            event,
        };
        let step = match phase {
            SignInAttemptPhase::BeforeSubmit { step } => step.advance(context),
            SignInAttemptPhase::AwaitingOutcome { wait } => wait.advance(context),
            SignInAttemptPhase::Concluded { conclusion, form } => {
                SignInAttemptConcluded { conclusion, form }.advance(context)
            }
        };
        SignInAttemptCompletion {
            identity: SignInAttemptIdentity {
                origin,
                login,
                started_at,
            },
            step,
            viewer: sender,
        }
        .transition()
    }
}

impl SignInAttemptPreSubmitStep {
    pub(crate) fn unchanged(self) -> SignInAttemptStep {
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
            SignInAttemptEvent::Resumed {} => SignInAttemptConcluded {
                conclusion: SignInAttemptConclusion::TimedOut {},
                form: SignInAttemptLoginForm::Unobserved,
            }
            .unobserved(),
            SignInAttemptEvent::PageObserved { page } => match page.document {
                SignInAttemptDocumentRelation::NewDocument => SignInAttemptConcluded {
                    conclusion: SignInAttemptConclusion::TimedOut {},
                    form: SignInAttemptLoginForm::from(&page),
                }
                .presented(SignInAttemptResetOffer::NotOffered),
                SignInAttemptDocumentRelation::SameDocumentSameRoute
                | SignInAttemptDocumentRelation::SameDocumentNewRoute => self.unchanged(),
            },
            SignInAttemptEvent::Activity { activity } => {
                self.after_activity(SignInAttemptPreSubmitActivity { activity, now })
            }
            SignInAttemptEvent::UserAction {
                action: SignInAttemptUserAction::Dismiss {},
            } => SignInAttemptStep::closing(SignInAttemptClosing::TAKEN_OVER),
            SignInAttemptEvent::UserAction {
                action:
                    SignInAttemptUserAction::TryAgain {}
                    | SignInAttemptUserAction::ChooseAnotherLogin {}
                    | SignInAttemptUserAction::ResetPassword { .. }
                    | SignInAttemptUserAction::FillAuthenticator {},
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
            (Self::Filling | Self::Filled, SignInAttemptActivity::Filled {}) => {
                Self::Filled.unchanged()
            }
            (Self::Filling | Self::Filled, SignInAttemptActivity::SubmissionUnobserved {}) => {
                Self::ManualSubmit.unchanged()
            }
            (Self::Filling | Self::Filled, SignInAttemptActivity::FillFailed {}) => {
                SignInAttemptConcluded {
                    conclusion: SignInAttemptConclusion::Failed {
                        failure: SignInAttemptFailure::FillFailed {},
                    },
                    form: SignInAttemptLoginForm::Shown,
                }
                .unobserved()
            }
            (
                Self::Filling | Self::Filled | Self::ManualSubmit,
                SignInAttemptActivity::SubmissionRejected {},
            ) => SignInAttemptConcluded {
                conclusion: SignInAttemptConclusion::Failed {
                    failure: SignInAttemptFailure::SubmissionRejected {},
                },
                form: SignInAttemptLoginForm::Shown,
            }
            .unobserved(),
            (
                Self::ManualSubmit,
                SignInAttemptActivity::Filled {}
                | SignInAttemptActivity::FillFailed {}
                | SignInAttemptActivity::SubmissionUnobserved {},
            ) => self.unchanged(),
        }
    }
}

struct SignInAttemptPreSubmitActivity {
    activity: SignInAttemptActivity,
    now: SignInAttemptInstant,
}

#[cfg(test)]
mod tests {
    use crate::sign_in_attempt::page_evidence::SignInAttemptDocumentRelation;
    use crate::sign_in_attempt::test_fixture::{
        SignInFieldsFixture, SignInMessageFixture, SignInPageFixture, SignInScenario,
        SignInScenarioEvent, SignInScenarioOutcome, SignInSubmittedAttempt,
    };
    use crate::{
        AuthenticationLoginChecklistStatus, SignInAttemptActionKind, SignInAttemptActivity,
        SignInAttemptAdvanceRequest, SignInAttemptBeginRequest, SignInAttemptEvent,
        SignInAttemptEvidenceDemand, SignInAttemptFollowUp, SignInAttemptLoginReference,
        SignInAttemptMessageKey, SignInAttemptRequestError, SignInAttemptSenderOrigin,
        SignInAttemptSiteMessage, SignInAttemptStatus, SignInAttemptStoredRecord,
    };

    #[test]
    fn begin_binds_the_site_and_presents_nooks_own_fill_step() -> anyhow::Result<()> {
        let scenario = SignInScenario::begin(1_000)?;
        let presentation = &scenario.presentation;
        assert_eq!(presentation.status, SignInAttemptStatus::SigningIn);
        assert_eq!(
            presentation.title_key,
            SignInAttemptMessageKey::WidgetSignInSigningIn
        );
        assert_eq!(
            presentation.description_key,
            SignInAttemptMessageKey::WidgetChecklistFillWorking
        );
        assert_eq!(
            presentation.page_evidence,
            SignInAttemptEvidenceDemand::NotWanted
        );
        assert_eq!(presentation.follow_up, SignInAttemptFollowUp::None);
        assert_eq!(scenario.offered(), vec![SignInAttemptActionKind::Dismiss]);
        assert_eq!(
            presentation.actions.first().map(|offer| offer.label_key),
            Some(SignInAttemptMessageKey::WidgetTakeOver)
        );
        assert_eq!(
            presentation.checklist.status,
            AuthenticationLoginChecklistStatus::Working
        );
        Ok(())
    }

    #[test]
    fn begin_rejects_a_sender_that_is_not_a_canonical_http_origin() -> anyhow::Result<()> {
        for origin in [
            "file:///tmp/login.html",
            "chrome-extension://abc",
            "https://www.namecheap.com/login",
        ] {
            let result = SignInAttemptBeginRequest {
                sender_origin: SignInAttemptSenderOrigin::try_from(origin.to_owned())?,
                login: SignInAttemptLoginReference::try_from(SignInScenario::LOGIN.to_owned())?,
                now: SignInScenario::instant(1_000)?,
            }
            .begin();
            assert_eq!(
                result,
                Err(SignInAttemptRequestError::SenderOriginInvalid),
                "{origin}"
            );
        }
        Ok(())
    }

    #[test]
    fn nook_fill_failures_conclude_without_a_site_reason() -> anyhow::Result<()> {
        let fill_failed = SignInScenario::begin(1_000)?
            .activity(SignInAttemptActivity::FillFailed {})?
            .retained()?;
        assert_eq!(fill_failed.presentation.status, SignInAttemptStatus::Failed);
        assert_eq!(
            fill_failed.presentation.description_key,
            SignInAttemptMessageKey::WidgetChecklistFillFailed
        );
        assert_eq!(
            fill_failed.offered(),
            vec![
                SignInAttemptActionKind::TryAgain,
                SignInAttemptActionKind::ChooseAnotherLogin,
                SignInAttemptActionKind::Dismiss,
            ]
        );
        let rejected = SignInScenario::begin(1_000)?
            .activity(SignInAttemptActivity::SubmissionRejected {})?
            .retained()?;
        assert_eq!(
            rejected.presentation.description_key,
            SignInAttemptMessageKey::WidgetChecklistSubmitRejected
        );
        Ok(())
    }

    #[test]
    fn manual_submission_waits_for_the_users_submit_and_reload_before_submit_times_out()
    -> anyhow::Result<()> {
        let manual = SignInScenario::begin(1_000)?
            .activity(SignInAttemptActivity::SubmissionUnobserved {})?
            .retained()?;
        assert_eq!(
            manual.presentation.description_key,
            SignInAttemptMessageKey::WidgetChecklistSubmitManual
        );
        let awaiting = manual.submitted(&SignInSubmittedAttempt::login_form().baseline)?;
        assert_eq!(
            awaiting.presentation.description_key,
            SignInAttemptMessageKey::WidgetSignInSigningInDescription
        );
        let lost = SignInScenario::begin(1_000)?
            .activity(SignInAttemptActivity::Filled {})?
            .retained()?
            .resumed(1_500)?
            .retained()?;
        assert_eq!(lost.presentation.status, SignInAttemptStatus::TimedOut);
        Ok(())
    }

    #[test]
    fn sender_binding_answers_other_site_and_keeps_same_site_subdomains() -> anyhow::Result<()> {
        let awaiting = SignInSubmittedAttempt::login_form().awaiting()?;
        for origin in [
            "https://evil.example",
            "http://www.namecheap.com",
            "file://",
        ] {
            let outcome = awaiting.clone().advance(SignInScenarioEvent {
                at: 2_000,
                origin,
                event: SignInAttemptEvent::Resumed {},
            })?;
            assert!(
                matches!(outcome, SignInScenarioOutcome::OtherSite),
                "{origin}"
            );
        }
        let subdomain = awaiting.advance(SignInScenarioEvent {
            at: 2_000,
            origin: "https://ap.www.namecheap.com",
            event: SignInAttemptEvent::Resumed {},
        })?;
        assert!(matches!(subdomain, SignInScenarioOutcome::Retained(_)));
        Ok(())
    }

    #[test]
    fn undecodable_records_are_rejected_without_a_request_error() -> anyhow::Result<()> {
        let valid = SignInSubmittedAttempt::login_form().awaiting()?.record;
        let unknown_field = valid.text().replacen('{', r#"{"username":"alice","#, 1);
        let over_bound = format!(
            "{}{}",
            valid.text(),
            " ".repeat(SignInAttemptStoredRecord::MAX_BYTES)
        );
        for stored in [
            "",
            "not json",
            "{}",
            unknown_field.as_str(),
            over_bound.as_str(),
        ] {
            let outcome = SignInScenario {
                record: serde_json::from_str::<SignInAttemptStoredRecord>(&serde_json::to_string(
                    stored,
                )?)?,
                presentation: SignInScenario::begin(1_000)?.presentation,
            }
            .resumed(2_000)?;
            assert!(
                matches!(outcome, SignInScenarioOutcome::RecordRejected),
                "{stored}"
            );
        }
        Ok(())
    }

    #[test]
    fn an_invalid_clock_reading_is_a_request_error() -> anyhow::Result<()> {
        let result = SignInAttemptAdvanceRequest {
            record: SignInScenario::begin(1_000)?.record,
            sender_origin: SignInAttemptSenderOrigin::try_from(SignInScenario::ORIGIN.to_owned())?,
            now: serde_json::from_str("0")?,
            event: SignInAttemptEvent::Resumed {},
        }
        .advance();
        assert_eq!(result, Err(SignInAttemptRequestError::TimeInvalid));
        Ok(())
    }

    /// Page observations sent from a chosen same-site origin.
    struct SiblingObservation {
        origin: &'static str,
        at: u32,
        page: SignInPageFixture,
    }

    impl SiblingObservation {
        const SIBLING: &'static str = "https://app.namecheap.com";

        fn deliver(self, scenario: SignInScenario) -> anyhow::Result<SignInScenarioOutcome> {
            scenario.advance(SignInScenarioEvent {
                at: self.at,
                origin: self.origin,
                event: SignInAttemptEvent::PageObserved {
                    page: self.page.page()?,
                },
            })
        }
    }

    #[test]
    fn a_same_site_sibling_origin_can_carry_the_attempt_to_signed_in() -> anyhow::Result<()> {
        let dashboard = SignInPageFixture {
            fields: SignInFieldsFixture::None,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
        };
        let resumed = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .advance(SignInScenarioEvent {
                at: 2_500,
                origin: SiblingObservation::SIBLING,
                event: SignInAttemptEvent::Resumed {},
            })?
            .retained()?;
        let settling = SiblingObservation {
            origin: SiblingObservation::SIBLING,
            at: 3_000,
            page: dashboard.clone(),
        }
        .deliver(resumed)?
        .retained()?;
        let confirmed = SiblingObservation {
            origin: SiblingObservation::SIBLING,
            at: 3_800,
            page: dashboard,
        }
        .deliver(settling)?
        .closed()?;
        assert_eq!(confirmed.status, SignInAttemptStatus::SignedIn);
        Ok(())
    }

    #[test]
    fn the_site_message_follows_its_capture_origin_not_the_beginning_origin() -> anyhow::Result<()>
    {
        let failed = SiblingObservation {
            origin: SiblingObservation::SIBLING,
            at: 3_000,
            page: SignInPageFixture {
                messages: vec![SignInMessageFixture::alert("Incorrect password")],
                ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
            },
        }
        .deliver(SignInSubmittedAttempt::login_form().awaiting()?)?
        .retained()?;
        let expected = Some(SignInAttemptSiteMessage::try_from(
            "Incorrect password".to_owned(),
        )?);
        assert_eq!(failed.presentation.site_message, expected);
        let on_capture_origin = failed
            .clone()
            .advance(SignInScenarioEvent {
                at: 4_000,
                origin: SiblingObservation::SIBLING,
                event: SignInAttemptEvent::Resumed {},
            })?
            .retained()?;
        assert_eq!(on_capture_origin.presentation.site_message, expected);
        let on_beginning_origin = failed.resumed(4_000)?.retained()?;
        assert_eq!(
            on_beginning_origin.presentation.status,
            SignInAttemptStatus::Failed
        );
        assert_eq!(on_beginning_origin.presentation.site_message, None);
        Ok(())
    }

    #[test]
    fn an_identifier_chain_closes_as_step_advanced_on_this_or_a_sibling_origin()
    -> anyhow::Result<()> {
        let identifier = SignInPageFixture {
            fields: SignInFieldsFixture::UsernameOnly,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
        };
        for origin in [SignInScenario::ORIGIN, SiblingObservation::SIBLING] {
            let advanced = SiblingObservation {
                origin,
                at: 2_500,
                page: identifier.clone(),
            }
            .deliver(
                SignInSubmittedAttempt {
                    baseline: SignInPageFixture {
                        fields: SignInFieldsFixture::UsernameOnly,
                        ..SignInPageFixture::login_form(
                            SignInAttemptDocumentRelation::SameDocumentSameRoute,
                        )
                    },
                }
                .awaiting()?,
            )?
            .closed()?;
            assert_eq!(
                advanced.status,
                SignInAttemptStatus::StepAdvanced,
                "{origin}"
            );
            assert!(advanced.actions.is_empty(), "{origin}");
            assert_eq!(advanced.follow_up, SignInAttemptFollowUp::None, "{origin}");
        }
        Ok(())
    }
}
