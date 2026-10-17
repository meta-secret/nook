//! Classification of one post-submit page observation against the submit baseline.
//!
//! Decisions, in order, for each page observation after submit:
//!
//! 1. The explicit error marker (alone or with a success marker) is a failure.
//! 2. A fresh error-looking message while the submitted step's username or
//!    password field is still present is a failure.
//! 3. A manual checkpoint is a verification challenge; a one-time-code field
//!    absent at submit is a one-time-code challenge.
//! 4. Without any marker or fresh error-looking message, a current-password
//!    field that was absent at submit means an email-first step advanced:
//!    the attempt closes (`StepAdvanced`) and the next step starts fresh. So
//!    does a username-only step followed, on a `NewDocument` of this or a
//!    same-site origin, by another username-only step (an identifier chain).
//! 5. The explicit success marker confirms sign-in.
//! 6. No auth fields and no error-looking message confirms sign-in once that
//!    evidence has been stable for the existing 750 ms interval, on a
//!    `NewDocument` or after a same-document route change. On the same
//!    document and route, removed fields alone never confirm (the
//!    submitted-login save precedent): only the explicit success marker, or a
//!    newly present authenticated affordance with the same 750 ms stability.
//! 7. A submitted step with a current-password field re-presented on a
//!    `NewDocument` with no error-looking message fails with reason `Unknown`
//!    once stable for 2 s.
//! 8. Otherwise the attempt keeps waiting until the 20 s outcome budget,
//!    measured from submit, expires visibly as `TimedOut`.
//!
//! Freshness: a message counts as newly present on a `NewDocument`, and on
//! the same document (either route) when no error-looking message (same rule)
//! was visible at submit, or when the message appeared or changed since the
//! acting script's submit (`changed_since_submit`).
//!
//! Decisions 6 and 7 become decisive only after their stability window,
//! which the outcome wait (`outcome.rs`) owns together with the budget.

use super::auth_step::{
    SignInAttemptAuthStep, SignInAttemptFieldPresence, SignInAttemptStepRelation,
};
use super::end_state::{
    SignInAttemptChallenge, SignInAttemptSiteMessage, SignInAttemptSiteMessageEvidence,
};
use super::failure_reason::SignInFailureReason;
use super::message_evidence::SignInAttemptErrorMessageSelection;
use super::page_evidence::{SignInAttemptDocumentRelation, SignInAttemptPageEvidence};
use super::site::SignInAttemptOrigin;
use super::stability::SignInAttemptSettlingEvidence;
use super::submit_baseline::{SignInAttemptAffordanceChange, SignInAttemptBaseline};

/// What one page observation says about the submitted login.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SignInAttemptPageReading {
    Failure {
        reason: SignInFailureReason,
        message: SignInAttemptSiteMessageEvidence,
    },
    Challenge(SignInAttemptChallenge),
    StepAdvanced,
    SignedIn,
    Settling(SignInAttemptSettlingEvidence),
    Undecided,
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

/// The failure decision of steps 1–2, or which marker remains for later steps.
enum SignInAttemptLeadingEvidence {
    Failure {
        reason: SignInFailureReason,
        message: SignInAttemptSiteMessageEvidence,
    },
    SuccessMarker,
    /// No marker, but a fresh error-looking message outside the submitted step.
    NoMarkerWithFreshError,
    NoMarker,
}

enum SignInAttemptStepProgression {
    /// The submitted step had no current-password field; one is now shown,
    /// or a new document shows the next username-only identifier step.
    Advanced,
    Unchanged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptCheckpointPresence {
    Present,
    Absent,
}

impl From<bool> for SignInAttemptCheckpointPresence {
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

enum SignInAttemptChallengePresence {
    Challenged(SignInAttemptChallenge),
    Clear,
}

/// One page observation and the exact origin of the page that sent it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SignInAttemptReadingRequest<'a> {
    pub(crate) page: &'a SignInAttemptPageEvidence,
    pub(crate) sender: &'a SignInAttemptOrigin,
}

#[derive(Debug, Clone, Copy)]
struct SignInAttemptPageFacts<'a> {
    page: &'a SignInAttemptPageEvidence,
    sender: &'a SignInAttemptOrigin,
    current: SignInAttemptAuthStep,
    relation: SignInAttemptStepRelation,
    affordance: SignInAttemptAffordanceChange,
}

impl SignInAttemptBaseline {
    fn fresh_error(self, page: &SignInAttemptPageEvidence) -> SignInAttemptFreshError {
        match page
            .messages
            .admitted_error_selection(self.admission(page.document))
        {
            SignInAttemptErrorMessageSelection::Selected(selected) => {
                SignInAttemptFreshError::Fresh {
                    reason: selected.reason,
                    message: SignInAttemptSiteMessage::from(&selected.text),
                }
            }
            SignInAttemptErrorMessageSelection::NoneErrorLooking => {
                SignInAttemptFreshError::NotFresh
            }
        }
    }

    pub(crate) fn reading(
        self,
        request: SignInAttemptReadingRequest<'_>,
    ) -> SignInAttemptPageReading {
        let SignInAttemptReadingRequest { page, sender } = request;
        let current = SignInAttemptAuthStep::from(&page.auth_fields);
        let facts = SignInAttemptPageFacts {
            page,
            sender,
            current,
            relation: self.fields.relation(current),
            affordance: self.affordance_change(page),
        };
        match self.leading_evidence(facts) {
            SignInAttemptLeadingEvidence::Failure { reason, message } => {
                SignInAttemptPageReading::Failure { reason, message }
            }
            SignInAttemptLeadingEvidence::SuccessMarker => match self.challenge(facts) {
                SignInAttemptChallengePresence::Challenged(challenge) => {
                    SignInAttemptPageReading::Challenge(challenge)
                }
                SignInAttemptChallengePresence::Clear => SignInAttemptPageReading::SignedIn,
            },
            SignInAttemptLeadingEvidence::NoMarkerWithFreshError => match self.challenge(facts) {
                SignInAttemptChallengePresence::Challenged(challenge) => {
                    SignInAttemptPageReading::Challenge(challenge)
                }
                SignInAttemptChallengePresence::Clear => facts.settling(),
            },
            SignInAttemptLeadingEvidence::NoMarker => {
                match (self.challenge(facts), self.progression(facts)) {
                    (
                        SignInAttemptChallengePresence::Challenged(challenge),
                        SignInAttemptStepProgression::Advanced
                        | SignInAttemptStepProgression::Unchanged,
                    ) => SignInAttemptPageReading::Challenge(challenge),
                    (
                        SignInAttemptChallengePresence::Clear,
                        SignInAttemptStepProgression::Advanced,
                    ) => SignInAttemptPageReading::StepAdvanced,
                    (
                        SignInAttemptChallengePresence::Clear,
                        SignInAttemptStepProgression::Unchanged,
                    ) => facts.settling(),
                }
            }
        }
    }

    /// Step 4: an email-first step (no current-password field at submit) that
    /// now shows a current-password field has advanced to the next step, and
    /// so has a username-only step whose new document is again username-only.
    fn progression(self, facts: SignInAttemptPageFacts<'_>) -> SignInAttemptStepProgression {
        use SignInAttemptDocumentRelation::{
            NewDocument, SameDocumentNewRoute, SameDocumentSameRoute,
        };
        use SignInAttemptFieldPresence::{Absent, Present};
        match (
            self.fields.username,
            self.fields.current_password,
            facts.current.username,
            facts.current.current_password,
            facts.page.document,
        ) {
            (
                Present | Absent,
                Absent,
                Present | Absent,
                Present,
                SameDocumentSameRoute | SameDocumentNewRoute | NewDocument,
            )
            | (Present, Absent, Present, Absent, NewDocument) => {
                SignInAttemptStepProgression::Advanced
            }
            (
                Present | Absent,
                Present,
                Present | Absent,
                Present | Absent,
                SameDocumentSameRoute | SameDocumentNewRoute | NewDocument,
            )
            | (
                Absent,
                Absent,
                Present | Absent,
                Absent,
                SameDocumentSameRoute | SameDocumentNewRoute | NewDocument,
            )
            | (
                Present,
                Absent,
                Absent,
                Absent,
                SameDocumentSameRoute | SameDocumentNewRoute | NewDocument,
            )
            | (Present, Absent, Present, Absent, SameDocumentSameRoute | SameDocumentNewRoute) => {
                SignInAttemptStepProgression::Unchanged
            }
        }
    }

    /// Steps 1–2: the error marker, or a fresh error-looking message while the
    /// submitted step's username or password field is still present.
    fn leading_evidence(self, facts: SignInAttemptPageFacts<'_>) -> SignInAttemptLeadingEvidence {
        use SignInAttemptOutcomeMarker::{Absent, Error, Success};
        use SignInAttemptStepRelation::{NoAuthFields, OtherStep, OverlappingStep, SameStep};
        let marker = SignInAttemptOutcomeMarker::from(facts.page);
        match (marker, self.fresh_error(facts.page), facts.relation) {
            (
                Error,
                SignInAttemptFreshError::Fresh { reason, message },
                SameStep | OverlappingStep | OtherStep | NoAuthFields,
            )
            | (
                Success | Absent,
                SignInAttemptFreshError::Fresh { reason, message },
                SameStep | OverlappingStep,
            ) => SignInAttemptLeadingEvidence::Failure {
                reason,
                message: SignInAttemptSiteMessageEvidence::Captured {
                    text: message,
                    origin: facts.sender.clone(),
                },
            },
            (
                Error,
                SignInAttemptFreshError::NotFresh,
                SameStep | OverlappingStep | OtherStep | NoAuthFields,
            ) => SignInAttemptLeadingEvidence::Failure {
                reason: SignInFailureReason::Unknown,
                message: SignInAttemptSiteMessageEvidence::Absent {},
            },
            (Success, SignInAttemptFreshError::Fresh { .. }, OtherStep | NoAuthFields)
            | (
                Success,
                SignInAttemptFreshError::NotFresh,
                SameStep | OverlappingStep | OtherStep | NoAuthFields,
            ) => SignInAttemptLeadingEvidence::SuccessMarker,
            (Absent, SignInAttemptFreshError::Fresh { .. }, OtherStep | NoAuthFields) => {
                SignInAttemptLeadingEvidence::NoMarkerWithFreshError
            }
            (
                Absent,
                SignInAttemptFreshError::NotFresh,
                SameStep | OverlappingStep | OtherStep | NoAuthFields,
            ) => SignInAttemptLeadingEvidence::NoMarker,
        }
    }

    /// Step 3: a manual checkpoint, or a one-time-code field absent at submit.
    fn challenge(self, facts: SignInAttemptPageFacts<'_>) -> SignInAttemptChallengePresence {
        use SignInAttemptFieldPresence::{Absent, Present};
        let checkpoint =
            SignInAttemptCheckpointPresence::from(facts.page.manual_checkpoint_present);
        match (
            checkpoint,
            facts.current.one_time_code,
            self.fields.one_time_code,
        ) {
            (SignInAttemptCheckpointPresence::Present, Present | Absent, Present | Absent) => {
                SignInAttemptChallengePresence::Challenged(SignInAttemptChallenge::Verification)
            }
            (SignInAttemptCheckpointPresence::Absent, Present, Absent) => {
                SignInAttemptChallengePresence::Challenged(SignInAttemptChallenge::OneTimeCode)
            }
            (SignInAttemptCheckpointPresence::Absent, Present, Present)
            | (SignInAttemptCheckpointPresence::Absent, Absent, Present | Absent) => {
                SignInAttemptChallengePresence::Clear
            }
        }
    }
}

impl SignInAttemptPageFacts<'_> {
    /// Steps 5–7: evidence that becomes decisive only once stable.
    fn settling(self) -> SignInAttemptPageReading {
        use SignInAttemptDocumentRelation::{
            NewDocument, SameDocumentNewRoute, SameDocumentSameRoute,
        };
        use SignInAttemptErrorMessageSelection::{NoneErrorLooking, Selected};
        use SignInAttemptStepRelation::{NoAuthFields, OtherStep, OverlappingStep, SameStep};
        match (
            self.relation,
            self.page.messages.error_selection(),
            self.page.document,
        ) {
            (NoAuthFields, NoneErrorLooking, SameDocumentNewRoute | NewDocument) => {
                SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::SignedInLooking)
            }
            (SameStep, NoneErrorLooking, NewDocument) => {
                SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::StepRepresented)
            }
            (NoAuthFields, NoneErrorLooking, SameDocumentSameRoute) => match self.affordance {
                SignInAttemptAffordanceChange::NewlyPresent => SignInAttemptPageReading::Settling(
                    SignInAttemptSettlingEvidence::SignedInLooking,
                ),
                SignInAttemptAffordanceChange::NotNew => SignInAttemptPageReading::Undecided,
            },
            (SameStep, NoneErrorLooking, SameDocumentSameRoute | SameDocumentNewRoute)
            | (
                OverlappingStep | OtherStep,
                NoneErrorLooking,
                SameDocumentSameRoute | SameDocumentNewRoute | NewDocument,
            )
            | (
                SameStep | OverlappingStep | OtherStep | NoAuthFields,
                Selected(_),
                SameDocumentSameRoute | SameDocumentNewRoute | NewDocument,
            ) => SignInAttemptPageReading::Undecided,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SignInAttemptBaseline, SignInAttemptPageReading, SignInAttemptReadingRequest};
    use crate::sign_in_attempt::end_state::{
        SignInAttemptChallenge, SignInAttemptSiteMessage, SignInAttemptSiteMessageEvidence,
    };
    use crate::sign_in_attempt::failure_reason::SignInFailureReason;
    use crate::sign_in_attempt::page_evidence::SignInAttemptDocumentRelation;
    use crate::sign_in_attempt::site::SignInAttemptOrigin;
    use crate::sign_in_attempt::stability::SignInAttemptSettlingEvidence;
    use crate::sign_in_attempt::test_fixture::{
        SignInControlsFixture, SignInFieldsFixture, SignInMarkerFixture,
        SignInMessageChangeFixture, SignInMessageFixture, SignInPageFixture,
    };

    struct ExpectedReason {
        text: &'static str,
        reason: SignInFailureReason,
    }

    /// Reads one post-submit page against the baseline collected at submit.
    struct ReadingCase {
        submitted: SignInPageFixture,
        observed: SignInPageFixture,
    }

    impl ReadingCase {
        const SENDER: &'static str = "https://www.namecheap.com";

        fn read(&self) -> anyhow::Result<SignInAttemptPageReading> {
            let baseline = SignInAttemptBaseline::from(&self.submitted.baseline()?);
            let sender = SignInAttemptOrigin::try_from(Self::SENDER.to_owned())?;
            Ok(baseline.reading(SignInAttemptReadingRequest {
                page: &self.observed.page()?,
                sender: &sender,
            }))
        }

        fn failure(
            reason: SignInFailureReason,
            text: &str,
        ) -> anyhow::Result<SignInAttemptPageReading> {
            Ok(SignInAttemptPageReading::Failure {
                reason,
                message: SignInAttemptSiteMessageEvidence::Captured {
                    text: SignInAttemptSiteMessage::try_from(text.to_owned())?,
                    origin: SignInAttemptOrigin::try_from(Self::SENDER.to_owned())?,
                },
            })
        }
    }

    #[test]
    fn namecheap_plain_reddish_banner_after_reload_is_account_locked() -> anyhow::Result<()> {
        let case = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                messages: vec![SignInMessageFixture::red_banner(
                    SignInMessageFixture::NAMECHEAP_LOCK,
                )],
                ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
            },
        };
        assert_eq!(
            case.read()?,
            ReadingCase::failure(
                SignInFailureReason::AccountLocked,
                SignInMessageFixture::NAMECHEAP_LOCK
            )?
        );
        Ok(())
    }

    #[test]
    fn the_same_text_without_any_error_styling_is_not_selected_as_the_site_message()
    -> anyhow::Result<()> {
        let case = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                messages: vec![SignInMessageFixture::container(
                    SignInMessageFixture::NAMECHEAP_LOCK,
                )],
                ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
            },
        };
        assert_eq!(
            case.read()?,
            SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::StepRepresented)
        );
        Ok(())
    }

    #[test]
    fn spa_error_appearing_in_place_without_a_prior_banner_is_fresh() -> anyhow::Result<()> {
        let field_error = SignInMessageFixture::field_reference("Incorrect password. Try again.");
        let case = ReadingCase {
            submitted: SignInPageFixture {
                messages: vec![SignInMessageFixture::container(
                    "By signing in you accept the Terms of Service",
                )],
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
            observed: SignInPageFixture {
                messages: vec![
                    SignInMessageFixture::container(
                        "By signing in you accept the Terms of Service",
                    ),
                    field_error,
                ],
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
        };
        assert_eq!(
            case.read()?,
            ReadingCase::failure(
                SignInFailureReason::WrongCredentials,
                "Incorrect password. Try again."
            )?
        );
        Ok(())
    }

    #[test]
    fn same_document_banner_that_was_error_looking_at_submit_is_stale() -> anyhow::Result<()> {
        let stale = SignInPageFixture {
            messages: vec![SignInMessageFixture::red_banner(
                "Incorrect username or password.",
            )],
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentSameRoute)
        };
        let case = ReadingCase {
            submitted: stale.clone(),
            observed: stale,
        };
        assert_eq!(case.read()?, SignInAttemptPageReading::Undecided);
        let new_route = ReadingCase {
            submitted: case.submitted.clone(),
            observed: SignInPageFixture {
                document: SignInAttemptDocumentRelation::SameDocumentNewRoute,
                ..case.observed.clone()
            },
        };
        assert_eq!(new_route.read()?, SignInAttemptPageReading::Undecided);
        let reloaded = ReadingCase {
            submitted: case.submitted.clone(),
            observed: SignInPageFixture {
                document: SignInAttemptDocumentRelation::NewDocument,
                ..case.observed.clone()
            },
        };
        assert_eq!(
            reloaded.read()?,
            ReadingCase::failure(
                SignInFailureReason::WrongCredentials,
                "Incorrect username or password."
            )?
        );
        Ok(())
    }

    #[test]
    fn rate_limit_and_unclear_messages_keep_the_site_text_and_fail_closed() -> anyhow::Result<()> {
        for expected in [
            ExpectedReason {
                text: "Too many sign-in attempts. Please try again later.",
                reason: SignInFailureReason::RateLimited,
            },
            ExpectedReason {
                text: "Something went wrong",
                reason: SignInFailureReason::Unknown,
            },
            ExpectedReason {
                text: "Слишком много попыток. Попробуйте позже.",
                reason: SignInFailureReason::RateLimited,
            },
        ] {
            let ExpectedReason { text, reason } = expected;
            let case = ReadingCase {
                submitted: SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                ),
                observed: SignInPageFixture {
                    messages: vec![SignInMessageFixture::alert(text)],
                    ..SignInPageFixture::login_form(
                        SignInAttemptDocumentRelation::SameDocumentSameRoute,
                    )
                },
            };
            assert_eq!(case.read()?, ReadingCase::failure(reason, text)?, "{text}");
        }
        Ok(())
    }

    #[test]
    fn explicit_error_marker_fails_even_without_a_message_or_auth_fields() -> anyhow::Result<()> {
        let case = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                marker: SignInMarkerFixture::Error,
                fields: SignInFieldsFixture::None,
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
        };
        assert_eq!(
            case.read()?,
            SignInAttemptPageReading::Failure {
                reason: SignInFailureReason::Unknown,
                message: SignInAttemptSiteMessageEvidence::Absent {},
            }
        );
        Ok(())
    }

    #[test]
    fn challenges_follow_failures_and_precede_success() -> anyhow::Result<()> {
        let otp = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                fields: SignInFieldsFixture::OneTimeCode,
                ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
            },
        };
        assert_eq!(
            otp.read()?,
            SignInAttemptPageReading::Challenge(SignInAttemptChallenge::OneTimeCode)
        );
        let checkpoint = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                marker: SignInMarkerFixture::ManualCheckpoint,
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
        };
        assert_eq!(
            checkpoint.read()?,
            SignInAttemptPageReading::Challenge(SignInAttemptChallenge::Verification)
        );
        let failure_first = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                marker: SignInMarkerFixture::ManualCheckpoint,
                messages: vec![SignInMessageFixture::alert("Incorrect password")],
                ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
            },
        };
        assert_eq!(
            failure_first.read()?,
            ReadingCase::failure(SignInFailureReason::WrongCredentials, "Incorrect password")?
        );
        Ok(())
    }

    #[test]
    fn success_requires_the_marker_or_a_clean_page_without_auth_fields() -> anyhow::Result<()> {
        let marked = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                marker: SignInMarkerFixture::Success,
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
        };
        assert_eq!(marked.read()?, SignInAttemptPageReading::SignedIn);
        let clean = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                fields: SignInFieldsFixture::None,
                ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
            },
        };
        assert_eq!(
            clean.read()?,
            SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::SignedInLooking)
        );
        let lingering_error = ReadingCase {
            submitted: SignInPageFixture {
                messages: vec![SignInMessageFixture::red_banner("Incorrect password")],
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
            observed: SignInPageFixture {
                fields: SignInFieldsFixture::None,
                messages: vec![SignInMessageFixture::red_banner("Incorrect password")],
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
        };
        assert_eq!(lingering_error.read()?, SignInAttemptPageReading::Undecided);
        Ok(())
    }

    #[test]
    fn removed_fields_on_the_same_route_never_look_signed_in() -> anyhow::Result<()> {
        let spinner = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture {
                fields: SignInFieldsFixture::None,
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
        };
        assert_eq!(spinner.read()?, SignInAttemptPageReading::Undecided);
        let routed = ReadingCase {
            submitted: spinner.submitted.clone(),
            observed: SignInPageFixture {
                document: SignInAttemptDocumentRelation::SameDocumentNewRoute,
                ..spinner.observed.clone()
            },
        };
        assert_eq!(
            routed.read()?,
            SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::SignedInLooking)
        );
        let marked = ReadingCase {
            submitted: spinner.submitted.clone(),
            observed: SignInPageFixture {
                marker: SignInMarkerFixture::Success,
                ..spinner.observed.clone()
            },
        };
        assert_eq!(marked.read()?, SignInAttemptPageReading::SignedIn);
        Ok(())
    }

    #[test]
    fn fresh_in_place_errors_fail_on_either_same_document_route() -> anyhow::Result<()> {
        for document in [
            SignInAttemptDocumentRelation::SameDocumentSameRoute,
            SignInAttemptDocumentRelation::SameDocumentNewRoute,
        ] {
            let case = ReadingCase {
                submitted: SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                ),
                observed: SignInPageFixture {
                    messages: vec![SignInMessageFixture::alert("Incorrect password")],
                    ..SignInPageFixture::login_form(document)
                },
            };
            assert_eq!(
                case.read()?,
                ReadingCase::failure(SignInFailureReason::WrongCredentials, "Incorrect password")?,
                "{document:?}"
            );
        }
        Ok(())
    }

    #[test]
    fn email_first_step_progression_advances_on_same_and_new_documents() -> anyhow::Result<()> {
        for document in [
            SignInAttemptDocumentRelation::SameDocumentSameRoute,
            SignInAttemptDocumentRelation::SameDocumentNewRoute,
            SignInAttemptDocumentRelation::NewDocument,
        ] {
            for observed in [
                SignInFieldsFixture::PasswordOnly,
                SignInFieldsFixture::UsernameAndPassword,
            ] {
                let case = ReadingCase {
                    submitted: SignInPageFixture {
                        fields: SignInFieldsFixture::UsernameOnly,
                        ..SignInPageFixture::login_form(
                            SignInAttemptDocumentRelation::SameDocumentSameRoute,
                        )
                    },
                    observed: SignInPageFixture {
                        fields: observed,
                        ..SignInPageFixture::login_form(document)
                    },
                };
                assert_eq!(
                    case.read()?,
                    SignInAttemptPageReading::StepAdvanced,
                    "{document:?} {observed:?}"
                );
            }
        }
        Ok(())
    }

    #[test]
    fn step_progression_never_hides_an_error_or_a_same_step_rejection() -> anyhow::Result<()> {
        let unknown_account = ReadingCase {
            submitted: SignInPageFixture {
                fields: SignInFieldsFixture::UsernameOnly,
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
            observed: SignInPageFixture {
                messages: vec![SignInMessageFixture::alert("We couldn't find your account")],
                ..SignInPageFixture {
                    fields: SignInFieldsFixture::UsernameOnly,
                    ..SignInPageFixture::login_form(
                        SignInAttemptDocumentRelation::SameDocumentSameRoute,
                    )
                }
            },
        };
        assert_eq!(
            unknown_account.read()?,
            ReadingCase::failure(
                SignInFailureReason::WrongCredentials,
                "We couldn't find your account"
            )?
        );
        let error_on_new_step = ReadingCase {
            submitted: SignInPageFixture {
                fields: SignInFieldsFixture::UsernameOnly,
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
            observed: SignInPageFixture {
                messages: vec![SignInMessageFixture::alert("Something went wrong")],
                ..SignInPageFixture {
                    fields: SignInFieldsFixture::PasswordOnly,
                    ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                }
            },
        };
        assert_eq!(
            error_on_new_step.read()?,
            SignInAttemptPageReading::Undecided
        );
        let namecheap_same_step = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument),
        };
        assert_eq!(
            namecheap_same_step.read()?,
            SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::StepRepresented)
        );
        let same_document_same_step = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
        };
        assert_eq!(
            same_document_same_step.read()?,
            SignInAttemptPageReading::Undecided
        );
        Ok(())
    }

    #[test]
    fn same_route_confirmation_needs_a_newly_present_sign_out_affordance() -> anyhow::Result<()> {
        let signed_out = SignInPageFixture {
            fields: SignInFieldsFixture::None,
            controls: SignInControlsFixture::SignOut,
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentSameRoute)
        };
        let new_affordance = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: signed_out.clone(),
        };
        assert_eq!(
            new_affordance.read()?,
            SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::SignedInLooking)
        );
        let already_present = ReadingCase {
            submitted: SignInPageFixture {
                controls: SignInControlsFixture::SignOut,
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
            observed: signed_out,
        };
        assert_eq!(already_present.read()?, SignInAttemptPageReading::Undecided);
        Ok(())
    }

    #[test]
    fn a_changed_banner_is_fresh_on_an_spa_retry_while_an_unchanged_one_is_stale()
    -> anyhow::Result<()> {
        let submitted = SignInPageFixture {
            messages: vec![SignInMessageFixture::red_banner(
                "Incorrect username or password.",
            )],
            ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::SameDocumentSameRoute)
        };
        let changed = ReadingCase {
            submitted: submitted.clone(),
            observed: SignInPageFixture {
                messages: vec![SignInMessageFixture {
                    change: SignInMessageChangeFixture::Changed,
                    ..SignInMessageFixture::red_banner("Your account has been locked.")
                }],
                ..SignInPageFixture::login_form(
                    SignInAttemptDocumentRelation::SameDocumentSameRoute,
                )
            },
        };
        assert_eq!(
            changed.read()?,
            ReadingCase::failure(
                SignInFailureReason::AccountLocked,
                "Your account has been locked."
            )?
        );
        let unchanged = ReadingCase {
            submitted: submitted.clone(),
            observed: submitted,
        };
        assert_eq!(unchanged.read()?, SignInAttemptPageReading::Undecided);
        Ok(())
    }

    #[test]
    fn identifier_chain_on_a_new_document_advances_unless_a_message_or_password_step_explains_it()
    -> anyhow::Result<()> {
        let identifier = |document| SignInPageFixture {
            fields: SignInFieldsFixture::UsernameOnly,
            ..SignInPageFixture::login_form(document)
        };
        let reload = ReadingCase {
            submitted: identifier(SignInAttemptDocumentRelation::SameDocumentSameRoute),
            observed: identifier(SignInAttemptDocumentRelation::NewDocument),
        };
        assert_eq!(reload.read()?, SignInAttemptPageReading::StepAdvanced);
        let no_account = ReadingCase {
            submitted: identifier(SignInAttemptDocumentRelation::SameDocumentSameRoute),
            observed: SignInPageFixture {
                messages: vec![SignInMessageFixture::alert(
                    "No account found with that email",
                )],
                ..identifier(SignInAttemptDocumentRelation::NewDocument)
            },
        };
        assert_eq!(
            no_account.read()?,
            ReadingCase::failure(
                SignInFailureReason::WrongCredentials,
                "No account found with that email"
            )?
        );
        for document in [
            SignInAttemptDocumentRelation::SameDocumentSameRoute,
            SignInAttemptDocumentRelation::SameDocumentNewRoute,
        ] {
            let same_document = ReadingCase {
                submitted: identifier(SignInAttemptDocumentRelation::SameDocumentSameRoute),
                observed: identifier(document),
            };
            assert_eq!(
                same_document.read()?,
                SignInAttemptPageReading::Undecided,
                "{document:?}"
            );
        }
        let password_step = ReadingCase {
            submitted: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
            observed: SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument),
        };
        assert_eq!(
            password_step.read()?,
            SignInAttemptPageReading::Settling(SignInAttemptSettlingEvidence::StepRepresented)
        );
        Ok(())
    }
}
