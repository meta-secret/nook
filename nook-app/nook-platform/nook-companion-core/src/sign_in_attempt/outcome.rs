//! Post-submit outcome classification, stability, and the outcome budget.
//!
//! The wait applies one page reading (`page_reading.rs`) at a time:
//! failures, challenges, step progression, and the success marker conclude
//! immediately; "signed-in looking" evidence (never a field removal on the
//! same document and route) confirms after the existing 750 ms stability
//! interval; an unexplained re-presentation of the same step
//! on a new document fails `Unknown` after 2 s. Decisive evidence is evaluated
//! before the 20 s outcome budget, measured from submit, which otherwise ends
//! the wait visibly as `TimedOut`. A new `Submitted` activity restarts it.

use serde::{Deserialize, Serialize};

use super::conclusion::{SignInAttemptClosing, SignInAttemptConcluded};
use super::end_state::{
    SignInAttemptConclusion, SignInAttemptFailure, SignInAttemptLoginForm,
    SignInAttemptSiteMessageEvidence,
};
use super::failure_reason::SignInFailureReason;
use super::lifecycle::{SignInAttemptEventContext, SignInAttemptNext, SignInAttemptStep};
use super::page_evidence::SignInAttemptPageEvidence;
use super::page_reading::{SignInAttemptPageReading, SignInAttemptReadingRequest};
use super::presentation::{SignInAttemptResetOffer, SignInAttemptScene, SignInAttemptSigningIn};
use super::record::{SignInAttemptChronology, SignInAttemptInstant, SignInAttemptPreSubmitStep};
use super::request::{
    SignInAttemptActivity, SignInAttemptEvent, SignInAttemptSubmitBaseline, SignInAttemptUserAction,
};
use super::site::{SignInAttemptOrigin, SignInAttemptSite};
use super::stability::{
    SignInAttemptSettledness, SignInAttemptSettlingEvidence, SignInAttemptStability,
};
use super::submit_baseline::SignInAttemptBaseline;
use crate::{
    AuthenticationOutcomeTimeoutMilliseconds, LoginSaveOutcomeObservation, SignInAttemptFollowUp,
};

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
            stability: SignInAttemptStability::Unsettled {},
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptBudget {
    Remaining,
    Exhausted,
}

struct SignInAttemptObservation<'a> {
    page: SignInAttemptPageEvidence,
    site: &'a SignInAttemptSite,
    sender: &'a SignInAttemptOrigin,
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
            SignInAttemptStability::Unsettled {} => SignInAttemptChronology::Ordered,
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
            (
                SignInAttemptChronology::Reversed,
                SignInAttemptChronology::Ordered | SignInAttemptChronology::Reversed,
            )
            | (SignInAttemptChronology::Ordered, SignInAttemptChronology::Reversed) => {
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
                sender: binding.sender,
                now,
            }),
            SignInAttemptEvent::Activity {
                activity: SignInAttemptActivity::Submitted { baseline },
            } => Self::from(SignInAttemptSubmission {
                baseline: &baseline,
                now,
            })
            .wait_or_expire(SignInAttemptExpiry {
                now,
                form: SignInAttemptLoginForm::Unobserved,
            }),
            // Submitted is sent before the real submit, so the actuator's submit
            // outcome arrives while the wait is still undecided.
            SignInAttemptEvent::Activity {
                activity: SignInAttemptActivity::SubmissionUnobserved {},
            } => SignInAttemptPreSubmitStep::ManualSubmit.unchanged(),
            SignInAttemptEvent::Activity {
                activity: SignInAttemptActivity::SubmissionRejected {},
            } => SignInAttemptConcluded {
                conclusion: SignInAttemptConclusion::Failed {
                    failure: SignInAttemptFailure::SubmissionRejected {},
                },
                form: SignInAttemptLoginForm::Shown,
            }
            .unobserved(),
            SignInAttemptEvent::UserAction {
                action: SignInAttemptUserAction::Dismiss {},
            } => SignInAttemptStep::closing(SignInAttemptClosing::TAKEN_OVER),
            SignInAttemptEvent::Resumed {}
            | SignInAttemptEvent::Activity {
                activity: SignInAttemptActivity::Filled {} | SignInAttemptActivity::FillFailed {},
            }
            | SignInAttemptEvent::UserAction {
                action:
                    SignInAttemptUserAction::TryAgain {}
                    | SignInAttemptUserAction::ChooseAnotherLogin {}
                    | SignInAttemptUserAction::ResetPassword { .. }
                    | SignInAttemptUserAction::FillAuthenticator {},
            } => self.wait_or_expire(SignInAttemptExpiry {
                now,
                form: SignInAttemptLoginForm::Unobserved,
            }),
        }
    }

    /// Decisive evidence is evaluated before the budget is applied.
    fn observe(self, observation: SignInAttemptObservation<'_>) -> SignInAttemptStep {
        match self.baseline.reading(SignInAttemptReadingRequest {
            page: &observation.page,
            sender: observation.sender,
        }) {
            SignInAttemptPageReading::Failure { reason, message } => {
                SignInAttemptOutcomeWait::site_rejection(SignInAttemptRejection {
                    failure: SignInAttemptFailure::SiteRejected { reason, message },
                    observation,
                })
            }
            SignInAttemptPageReading::Challenge(challenge) => SignInAttemptConcluded {
                conclusion: SignInAttemptConclusion::ChallengeRequired { challenge },
                form: SignInAttemptLoginForm::from(&observation.page),
            }
            .presented(SignInAttemptResetOffer::NotOffered),
            SignInAttemptPageReading::StepAdvanced => {
                SignInAttemptStep::closing(SignInAttemptClosing::STEP_ADVANCED)
            }
            SignInAttemptPageReading::SignedIn => SignInAttemptStep::signed_in(),
            SignInAttemptPageReading::Settling(evidence) => self.settle(SignInAttemptSettlement {
                evidence,
                observation,
            }),
            SignInAttemptPageReading::Undecided => Self {
                stability: SignInAttemptStability::Unsettled {},
                ..self
            }
            .wait_or_expire(SignInAttemptExpiry::from(&observation)),
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
            | (SignInAttemptStability::Unsettled {}, SignedInLooking | StepRepresented) => {
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
                        message: SignInAttemptSiteMessageEvidence::Absent {},
                    },
                    observation,
                })
            }
            (SignInAttemptSettledness::Settling, SignedInLooking | StepRepresented) => Self {
                stability: SignInAttemptStability::Settling { evidence, since },
                ..self
            }
            .wait_or_expire(SignInAttemptExpiry::from(&observation)),
        }
    }

    fn site_rejection(rejection: SignInAttemptRejection<'_>) -> SignInAttemptStep {
        let SignInAttemptRejection {
            failure,
            observation,
        } = rejection;
        let reset =
            SignInAttemptResetOffer::from(observation.page.links.reset_link(observation.site));
        SignInAttemptConcluded {
            conclusion: SignInAttemptConclusion::Failed { failure },
            form: SignInAttemptLoginForm::from(&observation.page),
        }
        .presented(reset)
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

    fn wait_or_expire(self, expiry: SignInAttemptExpiry) -> SignInAttemptStep {
        let SignInAttemptExpiry { now, form } = expiry;
        let timed_out = SignInAttemptConcluded {
            conclusion: SignInAttemptConclusion::TimedOut {},
            form,
        };
        match (self.budget(now), form) {
            (SignInAttemptBudget::Exhausted, SignInAttemptLoginForm::Unobserved) => {
                timed_out.unobserved()
            }
            (
                SignInAttemptBudget::Exhausted,
                SignInAttemptLoginForm::Shown | SignInAttemptLoginForm::Gone,
            ) => timed_out.presented(SignInAttemptResetOffer::NotOffered),
            (
                SignInAttemptBudget::Remaining,
                SignInAttemptLoginForm::Shown
                | SignInAttemptLoginForm::Gone
                | SignInAttemptLoginForm::Unobserved,
            ) => SignInAttemptStep {
                next: SignInAttemptNext::AwaitingOutcome(self),
                scene: SignInAttemptScene::SigningIn(SignInAttemptSigningIn::AwaitingOutcome),
                follow_up: SignInAttemptFollowUp::None,
            },
        }
    }
}

/// The clock reading and the latest login-form evidence for a budget check.
#[derive(Debug, Clone, Copy)]
struct SignInAttemptExpiry {
    now: SignInAttemptInstant,
    form: SignInAttemptLoginForm,
}

impl From<&SignInAttemptObservation<'_>> for SignInAttemptExpiry {
    fn from(observation: &SignInAttemptObservation<'_>) -> Self {
        Self {
            now: observation.now,
            form: SignInAttemptLoginForm::from(&observation.page),
        }
    }
}

struct SignInAttemptRejection<'a> {
    failure: SignInAttemptFailure,
    observation: SignInAttemptObservation<'a>,
}

#[cfg(test)]
mod tests {
    use crate::sign_in_attempt::page_evidence::{
        SignInAttemptDocumentRelation, SignInPageLink, SignInPageLinkHref, SignInPageLinkIndex,
        SignInPageLinkText,
    };
    use crate::sign_in_attempt::test_fixture::{
        SignInControlsFixture, SignInFieldsFixture, SignInLinkFixture, SignInMarkerFixture,
        SignInMessageChangeFixture, SignInMessageFixture, SignInObservationFixture,
        SignInPageFixture, SignInScenario, SignInSubmittedAttempt,
    };
    use crate::{
        AuthenticationLoginChecklistOutcomePolling, AuthenticationLoginChecklistStatus,
        SignInAttemptActionKind, SignInAttemptActivity, SignInAttemptEvidenceDemand,
        SignInAttemptFollowUp, SignInAttemptMessageKey, SignInAttemptSiteMessage,
        SignInAttemptStatus, SignInAttemptUserAction,
    };

    struct SignInReasonExpectation {
        text: &'static str,
        key: SignInAttemptMessageKey,
    }

    #[test]
    fn failed_after_reload_shows_the_reason_and_survives_further_reloads() -> anyhow::Result<()> {
        let awaiting = SignInSubmittedAttempt::login_form().awaiting()?;
        assert_eq!(
            awaiting.presentation.page_evidence,
            SignInAttemptEvidenceDemand::Wanted
        );
        assert_eq!(
            awaiting.presentation.checklist.outcome_polling,
            AuthenticationLoginChecklistOutcomePolling::Wait
        );
        let resumed = awaiting.resumed(3_000)?.retained()?;
        assert_eq!(resumed.presentation.status, SignInAttemptStatus::SigningIn);
        assert_eq!(
            resumed.presentation.description_key,
            SignInAttemptMessageKey::WidgetSignInSigningInDescription
        );
        let failed = resumed
            .observe(SignInObservationFixture {
                at: 3_200,
                page: SignInPageFixture {
                    messages: vec![SignInMessageFixture::alert(
                        "Incorrect username or password.",
                    )],
                    ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                },
            })?
            .retained()?;
        let presentation = failed.presentation.clone();
        assert_eq!(presentation.status, SignInAttemptStatus::Failed);
        assert_eq!(
            presentation.title_key,
            SignInAttemptMessageKey::WidgetSignInFailed
        );
        assert_eq!(
            presentation.description_key,
            SignInAttemptMessageKey::WidgetSignInReasonWrongCredentials
        );
        assert_eq!(
            presentation.site_message,
            Some(SignInAttemptSiteMessage::try_from(
                "Incorrect username or password.".to_owned()
            )?)
        );
        assert_eq!(
            presentation.checklist.status,
            AuthenticationLoginChecklistStatus::Attention
        );
        assert_eq!(
            failed.offered(),
            vec![
                SignInAttemptActionKind::TryAgain,
                SignInAttemptActionKind::ChooseAnotherLogin,
                SignInAttemptActionKind::Dismiss,
            ]
        );
        let reloaded_much_later = failed.resumed(600_000)?.retained()?;
        assert_eq!(
            reloaded_much_later.presentation.status,
            SignInAttemptStatus::Failed
        );
        assert_eq!(
            reloaded_much_later.presentation.description_key,
            presentation.description_key
        );
        assert_eq!(
            reloaded_much_later.presentation.site_message,
            presentation.site_message
        );
        assert_eq!(reloaded_much_later.presentation.reset_link, None);
        assert_eq!(
            reloaded_much_later.presentation.page_evidence,
            SignInAttemptEvidenceDemand::Wanted
        );
        Ok(())
    }

    #[test]
    fn namecheap_lock_banner_is_account_locked_and_offers_the_pages_reset_link()
    -> anyhow::Result<()> {
        let failed = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 4_000,
                page: SignInPageFixture {
                    messages: vec![SignInMessageFixture::red_banner(
                        SignInMessageFixture::NAMECHEAP_LOCK,
                    )],
                    links: vec![SignInLinkFixture::NAMECHEAP_RESET],
                    ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                },
            })?
            .retained()?;
        assert_eq!(
            failed.presentation.description_key,
            SignInAttemptMessageKey::WidgetSignInReasonAccountLocked
        );
        assert_eq!(
            failed.presentation.site_message,
            Some(SignInAttemptSiteMessage::try_from(
                SignInMessageFixture::NAMECHEAP_LOCK.to_owned()
            )?)
        );
        assert_eq!(
            failed.presentation.reset_link,
            Some(SignInPageLinkIndex::from(7))
        );
        assert_eq!(
            failed.presentation.page_evidence,
            SignInAttemptEvidenceDemand::NotWanted
        );
        assert!(
            failed
                .offered()
                .contains(&SignInAttemptActionKind::ResetPassword)
        );

        let cross_site = SignInPageLink {
            index: SignInPageLinkIndex::from(7),
            text: SignInPageLinkText::try_from("Password Reset".to_owned())?,
            href: SignInPageLinkHref::try_from("https://evil.example/forgotpassword/".to_owned())?,
        };
        let refused = failed
            .clone()
            .act(SignInAttemptUserAction::ResetPassword { link: cross_site })?
            .retained()?;
        assert_eq!(refused.presentation.status, SignInAttemptStatus::Failed);
        assert_eq!(refused.presentation.reset_link, None);
        assert_eq!(
            refused.presentation.page_evidence,
            SignInAttemptEvidenceDemand::Wanted
        );

        let fresh_link = SignInPageLink {
            index: SignInPageLinkIndex::from(7),
            text: SignInPageLinkText::try_from("Password Reset".to_owned())?,
            href: SignInPageLinkHref::try_from(
                "https://www.namecheap.com/myaccount/forgotpassword/".to_owned(),
            )?,
        };
        let reset = failed
            .act(SignInAttemptUserAction::ResetPassword { link: fresh_link })?
            .closed()?;
        assert_eq!(
            reset.follow_up,
            SignInAttemptFollowUp::ActivateResetLink {
                link: SignInPageLinkIndex::from(7)
            }
        );
        assert_eq!(reset.status, SignInAttemptStatus::Dismissed);
        assert!(reset.actions.is_empty());
        Ok(())
    }

    #[test]
    fn lock_banner_without_a_reset_link_offers_no_reset() -> anyhow::Result<()> {
        let failed = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 4_000,
                page: SignInPageFixture {
                    messages: vec![SignInMessageFixture::red_banner(
                        SignInMessageFixture::NAMECHEAP_LOCK,
                    )],
                    ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                },
            })?
            .retained()?;
        assert_eq!(failed.presentation.reset_link, None);
        assert!(
            !failed
                .offered()
                .contains(&SignInAttemptActionKind::ResetPassword)
        );
        Ok(())
    }

    #[test]
    fn in_place_wrong_password_and_rate_limit_are_classified_on_the_same_document()
    -> anyhow::Result<()> {
        for expected in [
            SignInReasonExpectation {
                text: "The password you entered is incorrect.",
                key: SignInAttemptMessageKey::WidgetSignInReasonWrongCredentials,
            },
            SignInReasonExpectation {
                text: "Too many attempts. Try again in 15 minutes.",
                key: SignInAttemptMessageKey::WidgetSignInReasonRateLimited,
            },
            SignInReasonExpectation {
                text: "Oops! Something went wrong.",
                key: SignInAttemptMessageKey::WidgetSignInReasonUnknown,
            },
        ] {
            let failed = SignInSubmittedAttempt::login_form()
                .awaiting()?
                .observe(SignInObservationFixture {
                    at: 1_600,
                    page: SignInPageFixture {
                        messages: vec![SignInMessageFixture::field_reference(expected.text)],
                        ..SignInPageFixture::login_form(
                            SignInAttemptDocumentRelation::SameDocumentSameRoute,
                        )
                    },
                })?
                .retained()?;
            assert_eq!(
                failed.presentation.description_key, expected.key,
                "{}",
                expected.text
            );
            assert_eq!(
                failed.presentation.site_message,
                Some(SignInAttemptSiteMessage::try_from(
                    expected.text.to_owned()
                )?)
            );
        }
        Ok(())
    }

    #[test]
    fn stale_same_document_banner_keeps_waiting_and_is_not_stored() -> anyhow::Result<()> {
        let banner = SignInPageFixture {
            messages: vec![SignInMessageFixture::red_banner(
                "Incorrect username or password.",
            )],
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentSameRoute)
        };
        let awaiting = SignInSubmittedAttempt {
            baseline: banner.clone(),
        }
        .awaiting()?;
        assert!(!awaiting.record.text().contains("Incorrect"));
        let still_waiting = awaiting
            .observe(SignInObservationFixture {
                at: 2_000,
                page: banner,
            })?
            .retained()?;
        assert_eq!(
            still_waiting.presentation.status,
            SignInAttemptStatus::SigningIn
        );
        assert_eq!(
            still_waiting.presentation.page_evidence,
            SignInAttemptEvidenceDemand::Wanted
        );
        Ok(())
    }

    #[test]
    fn success_after_navigation_confirms_after_the_stability_interval_and_closes()
    -> anyhow::Result<()> {
        let dashboard = SignInPageFixture {
            fields: SignInFieldsFixture::None,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
        };
        let settling = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 3_000,
                page: dashboard.clone(),
            })?
            .retained()?;
        assert_eq!(settling.presentation.status, SignInAttemptStatus::SigningIn);
        let still_settling = settling
            .observe(SignInObservationFixture {
                at: 3_500,
                page: dashboard.clone(),
            })?
            .retained()?;
        assert_eq!(
            still_settling.presentation.status,
            SignInAttemptStatus::SigningIn
        );
        let confirmed = still_settling
            .observe(SignInObservationFixture {
                at: 3_750,
                page: dashboard,
            })?
            .closed()?;
        assert_eq!(confirmed.status, SignInAttemptStatus::SignedIn);
        assert_eq!(
            confirmed.title_key,
            SignInAttemptMessageKey::WidgetSignInSignedIn
        );
        assert_eq!(
            confirmed.description_key,
            SignInAttemptMessageKey::WidgetSignInSignedInDescription
        );
        assert_eq!(
            confirmed.checklist.status,
            AuthenticationLoginChecklistStatus::Complete
        );
        assert_eq!(
            confirmed.page_evidence,
            SignInAttemptEvidenceDemand::NotWanted
        );
        Ok(())
    }

    #[test]
    fn interrupted_stability_restarts_and_the_success_marker_confirms_at_once() -> anyhow::Result<()>
    {
        let clean = SignInPageFixture {
            fields: SignInFieldsFixture::None,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentNewRoute)
        };
        let interrupted = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 2_000,
                page: clean.clone(),
            })?
            .retained()?
            .observe(SignInObservationFixture {
                at: 2_400,
                page: SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                ),
            })?
            .retained()?
            .observe(SignInObservationFixture {
                at: 2_900,
                page: clean.clone(),
            })?
            .retained()?;
        assert_eq!(
            interrupted.presentation.status,
            SignInAttemptStatus::SigningIn
        );
        let marked = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 1_200,
                page: SignInPageFixture {
                    marker: SignInMarkerFixture::Success,
                    ..clean
                },
            })?
            .closed()?;
        assert_eq!(marked.status, SignInAttemptStatus::SignedIn);
        Ok(())
    }

    #[test]
    fn unexplained_re_presentation_on_a_new_document_fails_unknown_after_two_seconds()
    -> anyhow::Result<()> {
        let same_step = SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument);
        let settling = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 3_000,
                page: same_step.clone(),
            })?
            .retained()?;
        assert_eq!(settling.presentation.status, SignInAttemptStatus::SigningIn);
        let failed = settling
            .observe(SignInObservationFixture {
                at: 5_000,
                page: same_step,
            })?
            .retained()?;
        assert_eq!(failed.presentation.status, SignInAttemptStatus::Failed);
        assert_eq!(
            failed.presentation.description_key,
            SignInAttemptMessageKey::WidgetSignInReasonUnknown
        );
        assert_eq!(failed.presentation.site_message, None);
        Ok(())
    }

    #[test]
    fn no_decisive_evidence_within_the_budget_times_out_visibly_and_is_retained()
    -> anyhow::Result<()> {
        let undecided = SignInPageFixture {
            fields: SignInFieldsFixture::PasswordOnly,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentSameRoute)
        };
        let waiting = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 21_000,
                page: undecided.clone(),
            })?
            .retained()?;
        assert_eq!(waiting.presentation.status, SignInAttemptStatus::SigningIn);
        let timed_out = waiting
            .observe(SignInObservationFixture {
                at: 21_100,
                page: undecided,
            })?
            .retained()?;
        assert_eq!(timed_out.presentation.status, SignInAttemptStatus::TimedOut);
        assert_eq!(
            timed_out.presentation.title_key,
            SignInAttemptMessageKey::WidgetSignInTimedOut
        );
        assert_eq!(
            timed_out.offered(),
            vec![
                SignInAttemptActionKind::TryAgain,
                SignInAttemptActionKind::Dismiss
            ]
        );
        let reloaded = timed_out.resumed(90_000)?.retained()?;
        assert_eq!(reloaded.presentation.status, SignInAttemptStatus::TimedOut);
        let resumed_late = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .resumed(30_000)?
            .retained()?;
        assert_eq!(
            resumed_late.presentation.status,
            SignInAttemptStatus::TimedOut
        );
        Ok(())
    }

    #[test]
    fn same_route_spinner_never_confirms_and_times_out_without_the_marker() -> anyhow::Result<()> {
        let spinner = SignInPageFixture {
            fields: SignInFieldsFixture::None,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentSameRoute)
        };
        let waiting = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 1_500,
                page: spinner.clone(),
            })?
            .retained()?
            .observe(SignInObservationFixture {
                at: 15_000,
                page: spinner.clone(),
            })?
            .retained()?;
        assert_eq!(waiting.presentation.status, SignInAttemptStatus::SigningIn);
        assert_eq!(
            waiting.presentation.page_evidence,
            SignInAttemptEvidenceDemand::Wanted
        );
        let timed_out = waiting
            .clone()
            .observe(SignInObservationFixture {
                at: 21_100,
                page: spinner.clone(),
            })?
            .retained()?;
        assert_eq!(timed_out.presentation.status, SignInAttemptStatus::TimedOut);
        let marked = waiting
            .observe(SignInObservationFixture {
                at: 16_000,
                page: SignInPageFixture {
                    marker: SignInMarkerFixture::Success,
                    ..spinner
                },
            })?
            .closed()?;
        assert_eq!(marked.status, SignInAttemptStatus::SignedIn);
        Ok(())
    }

    #[test]
    fn same_document_route_change_confirms_after_the_stability_interval() -> anyhow::Result<()> {
        let routed = SignInPageFixture {
            fields: SignInFieldsFixture::None,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentNewRoute)
        };
        let settling = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 1_500,
                page: routed.clone(),
            })?
            .retained()?;
        assert_eq!(settling.presentation.status, SignInAttemptStatus::SigningIn);
        let confirmed = settling
            .observe(SignInObservationFixture {
                at: 2_250,
                page: routed,
            })?
            .closed()?;
        assert_eq!(confirmed.status, SignInAttemptStatus::SignedIn);
        Ok(())
    }

    #[test]
    fn email_first_progression_closes_with_step_advanced() -> anyhow::Result<()> {
        for document in [
            SignInAttemptDocumentRelation::SameDocumentSameRoute,
            SignInAttemptDocumentRelation::SameDocumentNewRoute,
            SignInAttemptDocumentRelation::NewDocument,
        ] {
            let advanced = SignInSubmittedAttempt {
                baseline: SignInPageFixture {
                    fields: SignInFieldsFixture::UsernameOnly,
                    ..SignInPageFixture::login_form(
                        SignInAttemptDocumentRelation::SameDocumentSameRoute,
                    )
                },
            }
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 2_000,
                page: SignInPageFixture {
                    fields: SignInFieldsFixture::PasswordOnly,
                    ..SignInPageFixture::login_form(document)
                },
            })?
            .closed()?;
            assert_eq!(advanced.status, SignInAttemptStatus::StepAdvanced);
            assert!(advanced.actions.is_empty());
            assert_eq!(
                advanced.page_evidence,
                SignInAttemptEvidenceDemand::NotWanted
            );
            assert_eq!(advanced.follow_up, SignInAttemptFollowUp::None);
        }
        Ok(())
    }

    #[test]
    fn same_route_new_sign_out_affordance_confirms_after_the_stability_interval()
    -> anyhow::Result<()> {
        let signed_out = SignInPageFixture {
            fields: SignInFieldsFixture::None,
            controls: SignInControlsFixture::SignOut,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentSameRoute)
        };
        let confirmed = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 1_500,
                page: signed_out.clone(),
            })?
            .retained()?
            .observe(SignInObservationFixture {
                at: 2_300,
                page: signed_out,
            })?
            .closed()?;
        assert_eq!(confirmed.status, SignInAttemptStatus::SignedIn);
        Ok(())
    }

    #[test]
    fn spa_retry_with_a_changed_banner_fails_and_an_unchanged_banner_times_out()
    -> anyhow::Result<()> {
        let banner = SignInPageFixture {
            messages: vec![SignInMessageFixture::red_banner(
                "Incorrect username or password.",
            )],
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentSameRoute)
        };
        let failed = SignInSubmittedAttempt {
            baseline: banner.clone(),
        }
        .awaiting()?
        .observe(SignInObservationFixture {
            at: 1_600,
            page: SignInPageFixture {
                messages: vec![SignInMessageFixture {
                    change: SignInMessageChangeFixture::Changed,
                    ..SignInMessageFixture::red_banner("Too many attempts. Try again later.")
                }],
                ..banner.clone()
            },
        })?
        .retained()?;
        assert_eq!(
            failed.presentation.description_key,
            SignInAttemptMessageKey::WidgetSignInReasonRateLimited
        );
        let timed_out = SignInSubmittedAttempt {
            baseline: banner.clone(),
        }
        .awaiting()?
        .observe(SignInObservationFixture {
            at: 1_600,
            page: banner.clone(),
        })?
        .retained()?
        .observe(SignInObservationFixture {
            at: 21_200,
            page: banner,
        })?
        .retained()?;
        assert_eq!(timed_out.presentation.status, SignInAttemptStatus::TimedOut);
        Ok(())
    }

    #[test]
    fn submit_outcomes_reported_after_submitted_match_the_pre_submit_scenes() -> anyhow::Result<()>
    {
        for activity in [
            SignInAttemptActivity::SubmissionUnobserved {},
            SignInAttemptActivity::SubmissionRejected {},
        ] {
            let before_submit = SignInScenario::begin(1_000)?
                .activity(activity.clone())?
                .retained()?;
            let after_submitted = SignInSubmittedAttempt::login_form()
                .awaiting()?
                .activity(activity.clone())?
                .retained()?;
            assert_eq!(
                after_submitted.presentation, before_submit.presentation,
                "{activity:?}"
            );
            assert_eq!(
                after_submitted.offered(),
                before_submit.offered(),
                "{activity:?}"
            );
        }
        let manual = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .activity(SignInAttemptActivity::SubmissionUnobserved {})?
            .retained()?;
        assert_eq!(manual.presentation.status, SignInAttemptStatus::SigningIn);
        assert_eq!(
            manual.presentation.description_key,
            SignInAttemptMessageKey::WidgetChecklistSubmitManual
        );
        let rejected = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .activity(SignInAttemptActivity::SubmissionRejected {})?
            .retained()?;
        assert_eq!(rejected.presentation.status, SignInAttemptStatus::Failed);
        assert_eq!(
            rejected.presentation.description_key,
            SignInAttemptMessageKey::WidgetChecklistSubmitRejected
        );
        assert_eq!(
            rejected.presentation.page_evidence,
            SignInAttemptEvidenceDemand::NotWanted
        );
        Ok(())
    }
}
