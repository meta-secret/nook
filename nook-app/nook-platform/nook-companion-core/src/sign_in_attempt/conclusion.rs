//! Retained end states of a sign-in attempt and the user's resolutions.
//!
//! A concluded attempt never expires and never reverts on its own; it stays
//! visible across reloads until the user resolves it or the tab closes.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::auth_step::SignInAttemptLoginWorkflow;
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

/// Who produced a concluded end state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptConclusionOrigin {
    /// Nook's own fill or submit failed before the site responded.
    Nook,
    /// The site's response (or its absence within the budget) concluded it.
    Site,
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
    /// changes it. Page evidence re-presents it only while the page still
    /// shows the login workflow; otherwise the record closes as
    /// `WorkflowLeft` without claiming an outcome. Events without page
    /// evidence re-present it and ask for page evidence.
    pub(crate) fn advance(self, context: SignInAttemptEventContext<'_>) -> SignInAttemptStep {
        let SignInAttemptEventContext { binding, event, .. } = context;
        match event {
            SignInAttemptEvent::UserAction { action } => {
                self.resolve(SignInAttemptResolution { action, binding })
            }
            SignInAttemptEvent::PageObserved { page } => match self.origin() {
                SignInAttemptConclusionOrigin::Nook => {
                    self.presented(SignInAttemptResetOffer::NotOffered)
                }
                SignInAttemptConclusionOrigin::Site => {
                    match SignInAttemptLoginWorkflow::from(&page.auth_fields) {
                        SignInAttemptLoginWorkflow::Shown => self.presented(
                            SignInAttemptResetOffer::from(page.links.reset_link(binding.site)),
                        ),
                        SignInAttemptLoginWorkflow::Left => {
                            SignInAttemptStep::closing(SignInAttemptClosing::WORKFLOW_LEFT)
                        }
                    }
                }
            },
            SignInAttemptEvent::Resumed | SignInAttemptEvent::Activity { .. } => self.unobserved(),
        }
    }

    /// Whether the site produced this end state. Nook's own fill and submit
    /// failures happen before the site responds, often because the fields
    /// are not visible, so they never close as `WorkflowLeft`.
    const fn origin(&self) -> SignInAttemptConclusionOrigin {
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
            Self::ChallengeRequired { challenge } => SignInAttemptScene::ChallengeRequired {
                challenge: *challenge,
                evidence: representation.evidence,
            },
            Self::TimedOut => SignInAttemptScene::TimedOut {
                evidence: representation.evidence,
            },
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
                    scene: SignInAttemptScene::ChallengeRequired {
                        challenge: Self::OneTimeCode,
                        evidence: SignInAttemptEvidenceDemand::NotWanted,
                    },
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
    /// The concluded attempt's page left the login workflow: no outcome claim.
    pub(crate) const WORKFLOW_LEFT: Self = Self {
        scene: SignInAttemptScene::WorkflowLeft,
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

#[cfg(test)]
mod tests {
    use crate::sign_in_attempt::page_evidence::{
        SignInAttemptDocumentRelation, SignInPageLinkIndex,
    };
    use crate::sign_in_attempt::test_fixture::{
        SignInFieldsFixture, SignInLinkFixture, SignInMarkerFixture, SignInMessageFixture,
        SignInObservationFixture, SignInPageFixture, SignInScenario, SignInSubmittedAttempt,
    };
    use crate::{
        AuthenticationLoginChecklistStatus, SignInAttemptActionKind, SignInAttemptActivity,
        SignInAttemptEvidenceDemand, SignInAttemptFollowUp, SignInAttemptLoginReference,
        SignInAttemptMessageKey, SignInAttemptStatus, SignInAttemptUserAction,
    };

    #[test]
    fn one_time_code_challenge_hands_off_to_the_authenticator_picker() -> anyhow::Result<()> {
        let challenged = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 3_000,
                page: SignInPageFixture {
                    fields: SignInFieldsFixture::OneTimeCode,
                    ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                },
            })?
            .retained()?;
        assert_eq!(
            challenged.presentation.status,
            SignInAttemptStatus::ChallengeRequired
        );
        assert_eq!(
            challenged.presentation.title_key,
            SignInAttemptMessageKey::WidgetSignInChallenge
        );
        assert_eq!(
            challenged.presentation.description_key,
            SignInAttemptMessageKey::WidgetSignInChallengeOneTimeCodeDescription
        );
        assert_eq!(
            challenged.offered(),
            vec![
                SignInAttemptActionKind::FillAuthenticator,
                SignInAttemptActionKind::Dismiss
            ]
        );
        let unoffered = challenged
            .clone()
            .act(SignInAttemptUserAction::TryAgain)?
            .retained()?;
        assert_eq!(
            unoffered.presentation.status,
            SignInAttemptStatus::ChallengeRequired
        );
        let handed_off = challenged
            .act(SignInAttemptUserAction::FillAuthenticator)?
            .closed()?;
        assert_eq!(
            handed_off.follow_up,
            SignInAttemptFollowUp::OpenAuthenticatorPicker
        );
        assert!(handed_off.actions.is_empty());
        Ok(())
    }

    #[test]
    fn verification_checkpoint_offers_take_over_and_try_again() -> anyhow::Result<()> {
        let challenged = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 3_000,
                page: SignInPageFixture {
                    marker: SignInMarkerFixture::ManualCheckpoint,
                    ..SignInPageFixture::login_form(
                        SignInAttemptDocumentRelation::SameDocumentSameRoute,
                    )
                },
            })?
            .retained()?;
        assert_eq!(
            challenged.presentation.description_key,
            SignInAttemptMessageKey::WidgetSignInChallengeVerificationDescription
        );
        assert_eq!(
            challenged.offered(),
            vec![
                SignInAttemptActionKind::TryAgain,
                SignInAttemptActionKind::Dismiss
            ]
        );
        let taken_over = challenged
            .clone()
            .act(SignInAttemptUserAction::Dismiss)?
            .closed()?;
        assert_eq!(taken_over.status, SignInAttemptStatus::Dismissed);
        assert_eq!(
            taken_over.checklist.status,
            AuthenticationLoginChecklistStatus::Inactive
        );
        let restarted = challenged
            .act(SignInAttemptUserAction::TryAgain)?
            .closed()?;
        assert_eq!(
            restarted.follow_up,
            SignInAttemptFollowUp::RestartWithSameLogin {
                login: SignInAttemptLoginReference::try_from(SignInScenario::LOGIN.to_owned())?,
            }
        );
        Ok(())
    }

    #[test]
    fn dismiss_takes_over_in_flight_and_returns_to_fresh_after_a_conclusion() -> anyhow::Result<()>
    {
        let taken_over = SignInScenario::begin(1_000)?
            .act(SignInAttemptUserAction::Dismiss)?
            .closed()?;
        assert_eq!(taken_over.status, SignInAttemptStatus::Dismissed);
        assert_eq!(
            taken_over.title_key,
            SignInAttemptMessageKey::WidgetChecklistInactive
        );
        assert_eq!(
            taken_over.checklist.status,
            AuthenticationLoginChecklistStatus::Inactive
        );
        let awaiting_taken_over = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .act(SignInAttemptUserAction::Dismiss)?
            .closed()?;
        assert_eq!(
            awaiting_taken_over.checklist.status,
            AuthenticationLoginChecklistStatus::Inactive
        );
        let concluded = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .resumed(30_000)?
            .retained()?
            .act(SignInAttemptUserAction::Dismiss)?
            .closed()?;
        assert_eq!(concluded.status, SignInAttemptStatus::Dismissed);
        assert_eq!(
            concluded.title_key,
            SignInAttemptMessageKey::WidgetLoginTitle
        );
        assert_eq!(
            concluded.checklist.status,
            AuthenticationLoginChecklistStatus::Ready
        );
        assert_eq!(concluded.follow_up, SignInAttemptFollowUp::None);
        Ok(())
    }

    #[test]
    fn try_again_and_choose_another_login_close_with_their_follow_up() -> anyhow::Result<()> {
        let failed = SignInSubmittedAttempt::login_form()
            .awaiting()?
            .observe(SignInObservationFixture {
                at: 1_500,
                page: SignInPageFixture {
                    messages: vec![SignInMessageFixture::alert("Invalid password")],
                    ..SignInPageFixture::login_form(
                        SignInAttemptDocumentRelation::SameDocumentSameRoute,
                    )
                },
            })?
            .retained()?;
        let restarted = failed
            .clone()
            .act(SignInAttemptUserAction::TryAgain)?
            .closed()?;
        assert_eq!(restarted.status, SignInAttemptStatus::SigningIn);
        assert_eq!(
            restarted.follow_up,
            SignInAttemptFollowUp::RestartWithSameLogin {
                login: SignInAttemptLoginReference::try_from(SignInScenario::LOGIN.to_owned())?,
            }
        );
        assert!(restarted.actions.is_empty());
        let picker = failed
            .act(SignInAttemptUserAction::ChooseAnotherLogin)?
            .closed()?;
        assert_eq!(picker.follow_up, SignInAttemptFollowUp::OpenLoginPicker);
        Ok(())
    }

    /// A retained Namecheap lock failure re-presented after a reload.
    struct ReloadedLockFailure;

    impl ReloadedLockFailure {
        fn scenario() -> anyhow::Result<SignInScenario> {
            SignInSubmittedAttempt::login_form()
                .awaiting()?
                .observe(SignInObservationFixture {
                    at: 3_000,
                    page: SignInPageFixture {
                        messages: vec![SignInMessageFixture::red_banner(
                            SignInMessageFixture::NAMECHEAP_LOCK,
                        )],
                        ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                    },
                })?
                .retained()?
                .resumed(9_000)?
                .retained()
        }
    }

    #[test]
    fn page_evidence_on_a_reloaded_failure_offers_reset_only_for_a_current_reset_link()
    -> anyhow::Result<()> {
        let reloaded = ReloadedLockFailure::scenario()?;
        assert_eq!(reloaded.presentation.reset_link, None);
        assert_eq!(
            reloaded.presentation.page_evidence,
            SignInAttemptEvidenceDemand::Wanted
        );
        let with_link = reloaded
            .clone()
            .observe(SignInObservationFixture {
                at: 9_200,
                page: SignInPageFixture {
                    messages: vec![SignInMessageFixture::red_banner(
                        SignInMessageFixture::NAMECHEAP_LOCK,
                    )],
                    links: vec![SignInLinkFixture::NAMECHEAP_RESET],
                    ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                },
            })?
            .retained()?;
        assert_eq!(with_link.presentation.status, SignInAttemptStatus::Failed);
        assert_eq!(
            with_link.presentation.reason_key,
            Some(SignInAttemptMessageKey::WidgetSignInReasonAccountLocked)
        );
        assert_eq!(
            with_link.presentation.reset_link,
            Some(SignInPageLinkIndex::from(7))
        );
        assert!(
            with_link
                .offered()
                .contains(&SignInAttemptActionKind::ResetPassword)
        );
        assert_eq!(
            with_link.presentation.page_evidence,
            SignInAttemptEvidenceDemand::NotWanted
        );
        let without_link = reloaded
            .observe(SignInObservationFixture {
                at: 9_200,
                page: SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument),
            })?
            .retained()?;
        assert_eq!(
            without_link.presentation.status,
            SignInAttemptStatus::Failed
        );
        assert_eq!(without_link.presentation.reset_link, None);
        assert!(
            !without_link
                .offered()
                .contains(&SignInAttemptActionKind::ResetPassword)
        );
        assert_eq!(
            without_link.presentation.page_evidence,
            SignInAttemptEvidenceDemand::NotWanted
        );
        Ok(())
    }

    /// One concluded end state, re-observed after a reload.
    struct ConcludedCase {
        concluded: SignInScenario,
        status: SignInAttemptStatus,
        workflow_page: SignInPageFixture,
    }

    impl ConcludedCase {
        fn all() -> anyhow::Result<Vec<Self>> {
            let failed = ReloadedLockFailure::scenario()?;
            let timed_out = SignInSubmittedAttempt::login_form()
                .awaiting()?
                .resumed(30_000)?
                .retained()?;
            let challenged = SignInSubmittedAttempt::login_form()
                .awaiting()?
                .observe(SignInObservationFixture {
                    at: 3_000,
                    page: SignInPageFixture {
                        fields: SignInFieldsFixture::OneTimeCode,
                        ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                    },
                })?
                .retained()?
                .resumed(9_000)?
                .retained()?;
            Ok(vec![
                Self {
                    concluded: failed,
                    status: SignInAttemptStatus::Failed,
                    workflow_page: SignInPageFixture::login_form(
                        SignInAttemptDocumentRelation::NewDocument,
                    ),
                },
                Self {
                    concluded: timed_out,
                    status: SignInAttemptStatus::TimedOut,
                    workflow_page: SignInPageFixture::login_form(
                        SignInAttemptDocumentRelation::NewDocument,
                    ),
                },
                Self {
                    concluded: challenged,
                    status: SignInAttemptStatus::ChallengeRequired,
                    workflow_page: SignInPageFixture {
                        fields: SignInFieldsFixture::OneTimeCode,
                        ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                    },
                },
            ])
        }
    }

    #[test]
    fn concluded_records_ask_for_page_evidence_after_resume() -> anyhow::Result<()> {
        for case in ConcludedCase::all()? {
            assert_eq!(case.concluded.presentation.status, case.status);
            assert_eq!(
                case.concluded.presentation.page_evidence,
                SignInAttemptEvidenceDemand::Wanted,
                "{:?}",
                case.status
            );
        }
        Ok(())
    }

    #[test]
    fn concluded_records_stay_while_the_login_workflow_is_shown_and_close_once_it_is_left()
    -> anyhow::Result<()> {
        for case in ConcludedCase::all()? {
            let kept = case
                .concluded
                .clone()
                .observe(SignInObservationFixture {
                    at: 9_500,
                    page: case.workflow_page.clone(),
                })?
                .retained()?;
            assert_eq!(kept.presentation.status, case.status);
            assert_eq!(
                kept.presentation.page_evidence,
                SignInAttemptEvidenceDemand::NotWanted
            );
            let left = case
                .concluded
                .observe(SignInObservationFixture {
                    at: 9_500,
                    page: SignInPageFixture {
                        fields: SignInFieldsFixture::None,
                        ..SignInPageFixture::login_form(SignInAttemptDocumentRelation::NewDocument)
                    },
                })?
                .closed()?;
            assert_eq!(
                left.status,
                SignInAttemptStatus::WorkflowLeft,
                "{:?}",
                case.status
            );
            assert!(left.actions.is_empty());
            assert_eq!(left.reset_link, None);
            assert_eq!(left.page_evidence, SignInAttemptEvidenceDemand::NotWanted);
            assert_eq!(left.follow_up, SignInAttemptFollowUp::None);
        }
        Ok(())
    }

    #[test]
    fn nook_fill_and_submit_failures_never_close_as_workflow_left() -> anyhow::Result<()> {
        for activity in [
            SignInAttemptActivity::FillFailed,
            SignInAttemptActivity::SubmissionRejected,
        ] {
            let failed = SignInScenario::begin(1_000)?
                .activity(activity)?
                .retained()?;
            assert_eq!(failed.presentation.status, SignInAttemptStatus::Failed);
            assert_eq!(
                failed.presentation.page_evidence,
                SignInAttemptEvidenceDemand::NotWanted
            );
            let observed = failed
                .observe(SignInObservationFixture {
                    at: 1_200,
                    page: SignInPageFixture {
                        fields: SignInFieldsFixture::None,
                        ..SignInPageFixture::login_form(
                            SignInAttemptDocumentRelation::SameDocumentSameRoute,
                        )
                    },
                })?
                .retained()?;
            assert_eq!(observed.presentation.status, SignInAttemptStatus::Failed);
            assert_eq!(
                observed.presentation.page_evidence,
                SignInAttemptEvidenceDemand::NotWanted
            );
            let resumed = observed.resumed(9_000)?.retained()?;
            assert_eq!(resumed.presentation.status, SignInAttemptStatus::Failed);
            assert_eq!(
                resumed.presentation.page_evidence,
                SignInAttemptEvidenceDemand::NotWanted
            );
        }
        Ok(())
    }
}
