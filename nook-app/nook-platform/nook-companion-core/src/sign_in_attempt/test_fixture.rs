//! Typed builders for sign-in attempt test scenarios (compiled for tests only).
//!
//! Fixtures construct the real contract DTOs through their validating
//! conversions; they never re-implement classification.

use super::lifecycle::{SignInAttemptAdvance, SignInAttemptDisposition, SignInAttemptTransition};
use super::page_evidence::{
    SignInAttemptDocumentRelation, SignInAttemptPageEvidence, SignInPageColor,
    SignInPageColorChannel, SignInPageControls, SignInPageLink, SignInPageLinkHref,
    SignInPageLinkIndex, SignInPageLinkText, SignInPageLinks, SignInPageMessage,
    SignInPageMessagePlacement, SignInPageMessageSource, SignInPageMessageText,
    SignInPageMessageToken, SignInPageMessageTokens, SignInPageMessages,
};
use super::presentation::{SignInAttemptActionKind, SignInAttemptPresentation};
use super::record::SignInAttemptStoredRecord;
use super::request::{
    SignInAttemptActivity, SignInAttemptAdvanceRequest, SignInAttemptAuthFields,
    SignInAttemptBeginRequest, SignInAttemptEvent, SignInAttemptLoginReference,
    SignInAttemptSenderOrigin, SignInAttemptSubmitBaseline, SignInAttemptUserAction,
};
use crate::{CompanionEpochMilliseconds, LoginControlLabel};

/// Which credential fields a fixture page shows.
#[derive(Debug, Clone, Copy)]
pub(crate) enum SignInFieldsFixture {
    UsernameAndPassword,
    UsernameOnly,
    PasswordOnly,
    OneTimeCode,
    None,
}

impl From<SignInFieldsFixture> for SignInAttemptAuthFields {
    fn from(fields: SignInFieldsFixture) -> Self {
        Self {
            username_present: matches!(
                fields,
                SignInFieldsFixture::UsernameAndPassword | SignInFieldsFixture::UsernameOnly
            ),
            current_password_present: matches!(
                fields,
                SignInFieldsFixture::UsernameAndPassword | SignInFieldsFixture::PasswordOnly
            ),
            one_time_code_present: matches!(fields, SignInFieldsFixture::OneTimeCode),
        }
    }
}

/// Whether a same-document message appeared or changed since the submit.
#[derive(Debug, Clone, Copy)]
pub(crate) enum SignInMessageChangeFixture {
    Unchanged,
    Changed,
}

/// Visible control labels on a fixture page.
#[derive(Debug, Clone, Copy)]
pub(crate) enum SignInControlsFixture {
    SignIn,
    SignOut,
}

impl SignInControlsFixture {
    fn controls(self) -> anyhow::Result<SignInPageControls> {
        let label = match self {
            Self::SignIn => "Sign in",
            Self::SignOut => "Sign out",
        };
        Ok(SignInPageControls::try_from(vec![
            LoginControlLabel::try_from(label.to_owned())?,
        ])?)
    }
}

/// One visible message block; defaults to a plain, neutral container.
#[derive(Debug, Clone)]
pub(crate) struct SignInMessageFixture {
    pub(crate) text: &'static str,
    pub(crate) source: SignInPageMessageSource,
    pub(crate) placement: SignInPageMessagePlacement,
    pub(crate) tokens: &'static [&'static str],
    pub(crate) ancestor_tokens: &'static [&'static str],
    pub(crate) change: SignInMessageChangeFixture,
    pub(crate) foreground: [u8; 3],
    pub(crate) background: [u8; 3],
}

impl SignInMessageFixture {
    /// The Namecheap lock banner text from the reported case.
    pub(crate) const NAMECHEAP_LOCK: &'static str = "Your account has been locked for 24 hours for three consecutive failed password or username entry attempts. Please use Password Reset option...";
    pub(crate) const BLACK: [u8; 3] = [33, 33, 33];
    pub(crate) const WHITE: [u8; 3] = [255, 255, 255];
    /// A reddish foreground like the Namecheap lock banner text.
    pub(crate) const BANNER_RED: [u8; 3] = [200, 40, 40];
    /// A light red tint like a styled error banner background.
    pub(crate) const TINT_RED: [u8; 3] = [253, 236, 234];

    pub(crate) const fn container(text: &'static str) -> Self {
        Self {
            text,
            source: SignInPageMessageSource::Container,
            placement: SignInPageMessagePlacement::InsideAuthForm,
            tokens: &[],
            ancestor_tokens: &[],
            change: SignInMessageChangeFixture::Unchanged,
            foreground: Self::BLACK,
            background: Self::WHITE,
        }
    }

    /// A plain container with a reddish foreground and no tokens (Namecheap style).
    pub(crate) const fn red_banner(text: &'static str) -> Self {
        Self {
            foreground: Self::BANNER_RED,
            ..Self::container(text)
        }
    }

    /// An unstyled `role=alert` region.
    pub(crate) const fn alert(text: &'static str) -> Self {
        Self {
            source: SignInPageMessageSource::Alert,
            ..Self::container(text)
        }
    }

    /// An unstyled `aria-describedby` / `aria-errormessage` target of an auth input.
    pub(crate) const fn field_reference(text: &'static str) -> Self {
        Self {
            source: SignInPageMessageSource::FieldReference,
            ..Self::container(text)
        }
    }

    pub(crate) fn message(&self) -> anyhow::Result<SignInPageMessage> {
        Ok(SignInPageMessage {
            text: SignInPageMessageText::try_from(self.text.to_owned())?,
            source: self.source,
            placement: self.placement,
            tokens: Self::tokens(self.tokens)?,
            ancestor_tokens: Self::tokens(self.ancestor_tokens)?,
            foreground: Self::color(self.foreground),
            background: Self::color(self.background),
            changed_since_submit: matches!(self.change, SignInMessageChangeFixture::Changed),
        })
    }

    fn tokens(tokens: &[&str]) -> anyhow::Result<SignInPageMessageTokens> {
        let tokens = tokens
            .iter()
            .map(|token| SignInPageMessageToken::try_from((*token).to_owned()))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(SignInPageMessageTokens::try_from(tokens)?)
    }

    fn color(channels: [u8; 3]) -> SignInPageColor {
        let [red, green, blue] = channels;
        SignInPageColor {
            red: SignInPageColorChannel::from(red),
            green: SignInPageColorChannel::from(green),
            blue: SignInPageColorChannel::from(blue),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SignInLinkFixture {
    pub(crate) index: u32,
    pub(crate) text: &'static str,
    pub(crate) href: &'static str,
}

impl SignInLinkFixture {
    /// The Namecheap banner's own "Password Reset" link.
    pub(crate) const NAMECHEAP_RESET: Self = Self {
        index: 7,
        text: "Password Reset",
        href: "https://www.namecheap.com/myaccount/forgotpassword/",
    };

    fn link(&self) -> anyhow::Result<SignInPageLink> {
        Ok(SignInPageLink {
            index: SignInPageLinkIndex::from(self.index),
            text: SignInPageLinkText::try_from(self.text.to_owned())?,
            href: SignInPageLinkHref::try_from(self.href.to_owned())?,
        })
    }
}

/// Markers and checkpoint reported by the existing page adapters.
#[derive(Debug, Clone, Copy)]
pub(crate) enum SignInMarkerFixture {
    None,
    Success,
    Error,
    ManualCheckpoint,
}

/// One bounded page observation.
#[derive(Debug, Clone)]
pub(crate) struct SignInPageFixture {
    pub(crate) document: SignInAttemptDocumentRelation,
    pub(crate) fields: SignInFieldsFixture,
    pub(crate) marker: SignInMarkerFixture,
    pub(crate) messages: Vec<SignInMessageFixture>,
    pub(crate) links: Vec<SignInLinkFixture>,
    pub(crate) controls: SignInControlsFixture,
}

impl SignInPageFixture {
    pub(crate) const fn login_form(document: SignInAttemptDocumentRelation) -> Self {
        Self {
            document,
            fields: SignInFieldsFixture::UsernameAndPassword,
            marker: SignInMarkerFixture::None,
            messages: Vec::new(),
            links: Vec::new(),
            controls: SignInControlsFixture::SignIn,
        }
    }

    pub(crate) fn page(&self) -> anyhow::Result<SignInAttemptPageEvidence> {
        let links = self
            .links
            .iter()
            .map(SignInLinkFixture::link)
            .collect::<anyhow::Result<Vec<_>>>()?;
        Ok(SignInAttemptPageEvidence {
            document: self.document,
            auth_fields: SignInAttemptAuthFields::from(self.fields),
            manual_checkpoint_present: matches!(self.marker, SignInMarkerFixture::ManualCheckpoint),
            success_marker_present: matches!(self.marker, SignInMarkerFixture::Success),
            error_marker_present: matches!(self.marker, SignInMarkerFixture::Error),
            controls: self.controls.controls()?,
            messages: self.messages()?,
            links: SignInPageLinks::try_from(links)?,
        })
    }

    /// The submit-time baseline collected from this page.
    pub(crate) fn baseline(&self) -> anyhow::Result<SignInAttemptSubmitBaseline> {
        Ok(SignInAttemptSubmitBaseline {
            messages: self.messages()?,
            auth_fields: SignInAttemptAuthFields::from(self.fields),
            controls: self.controls.controls()?,
        })
    }

    fn messages(&self) -> anyhow::Result<SignInPageMessages> {
        let messages = self
            .messages
            .iter()
            .map(SignInMessageFixture::message)
            .collect::<anyhow::Result<Vec<_>>>()?;
        Ok(SignInPageMessages::try_from(messages)?)
    }
}

/// One event delivered to a scenario's stored record at a clock reading.
pub(crate) struct SignInScenarioEvent {
    pub(crate) at: u32,
    pub(crate) origin: &'static str,
    pub(crate) event: SignInAttemptEvent,
}

/// A tab holding one stored attempt record, driven through the public API.
#[derive(Debug, Clone)]
pub(crate) struct SignInScenario {
    pub(crate) record: SignInAttemptStoredRecord,
    pub(crate) presentation: SignInAttemptPresentation,
}

#[derive(Debug)]
pub(crate) enum SignInScenarioOutcome {
    Retained(SignInScenario),
    Closed(SignInAttemptPresentation),
    RecordRejected,
    OtherSite,
}

impl SignInScenario {
    pub(crate) const ORIGIN: &'static str = "https://www.namecheap.com";
    pub(crate) const LOGIN: &'static str = "store_demo:secret_demo";

    pub(crate) fn instant(at: u32) -> anyhow::Result<CompanionEpochMilliseconds> {
        Ok(serde_json::from_str::<CompanionEpochMilliseconds>(
            &at.to_string(),
        )?)
    }

    pub(crate) fn begin(at: u32) -> anyhow::Result<Self> {
        let transition = SignInAttemptBeginRequest {
            sender_origin: SignInAttemptSenderOrigin::try_from(Self::ORIGIN.to_owned())?,
            login: SignInAttemptLoginReference::try_from(Self::LOGIN.to_owned())?,
            now: Self::instant(at)?,
        }
        .begin()?;
        SignInScenarioOutcome::from(transition).retained()
    }

    pub(crate) fn advance(
        self,
        step: SignInScenarioEvent,
    ) -> anyhow::Result<SignInScenarioOutcome> {
        let advance = SignInAttemptAdvanceRequest {
            record: self.record,
            sender_origin: SignInAttemptSenderOrigin::try_from(step.origin.to_owned())?,
            now: Self::instant(step.at)?,
            event: step.event,
        }
        .advance()?;
        Ok(match advance {
            SignInAttemptAdvance::Advanced { transition } => {
                SignInScenarioOutcome::from(*transition)
            }
            SignInAttemptAdvance::RecordRejected => SignInScenarioOutcome::RecordRejected,
            SignInAttemptAdvance::OtherSite => SignInScenarioOutcome::OtherSite,
        })
    }

    pub(crate) fn activity(
        self,
        activity: SignInAttemptActivity,
    ) -> anyhow::Result<SignInScenarioOutcome> {
        self.advance(SignInScenarioEvent {
            at: 1_050,
            origin: Self::ORIGIN,
            event: SignInAttemptEvent::Activity { activity },
        })
    }

    /// Submits the filled form with the given submit-time page as baseline.
    pub(crate) fn submitted(self, baseline: &SignInPageFixture) -> anyhow::Result<Self> {
        self.advance(SignInScenarioEvent {
            at: 1_100,
            origin: Self::ORIGIN,
            event: SignInAttemptEvent::Activity {
                activity: SignInAttemptActivity::Submitted {
                    baseline: baseline.baseline()?,
                },
            },
        })?
        .retained()
    }

    pub(crate) fn observe(
        self,
        observation: SignInObservationFixture,
    ) -> anyhow::Result<SignInScenarioOutcome> {
        let SignInObservationFixture { at, page } = observation;
        self.advance(SignInScenarioEvent {
            at,
            origin: Self::ORIGIN,
            event: SignInAttemptEvent::PageObserved { page: page.page()? },
        })
    }

    pub(crate) fn act(
        self,
        action: SignInAttemptUserAction,
    ) -> anyhow::Result<SignInScenarioOutcome> {
        self.advance(SignInScenarioEvent {
            at: 2_000,
            origin: Self::ORIGIN,
            event: SignInAttemptEvent::UserAction { action },
        })
    }

    pub(crate) fn resumed(self, at: u32) -> anyhow::Result<SignInScenarioOutcome> {
        self.advance(SignInScenarioEvent {
            at,
            origin: Self::ORIGIN,
            event: SignInAttemptEvent::Resumed,
        })
    }

    pub(crate) fn offered(&self) -> Vec<SignInAttemptActionKind> {
        self.presentation
            .actions
            .iter()
            .map(|offer| offer.action)
            .collect()
    }
}

pub(crate) struct SignInObservationFixture {
    pub(crate) at: u32,
    pub(crate) page: SignInPageFixture,
}

impl From<SignInAttemptTransition> for SignInScenarioOutcome {
    fn from(transition: SignInAttemptTransition) -> Self {
        match transition.disposition {
            SignInAttemptDisposition::Retain { record } => Self::Retained(SignInScenario {
                record,
                presentation: transition.presentation,
            }),
            SignInAttemptDisposition::Close => Self::Closed(transition.presentation),
        }
    }
}

impl SignInScenarioOutcome {
    pub(crate) fn retained(self) -> anyhow::Result<SignInScenario> {
        let Self::Retained(scenario) = self else {
            anyhow::bail!("expected a retained record, got {self:?}");
        };
        Ok(scenario)
    }

    pub(crate) fn closed(self) -> anyhow::Result<SignInAttemptPresentation> {
        let Self::Closed(presentation) = self else {
            anyhow::bail!("expected a closing transition, got {self:?}");
        };
        Ok(presentation)
    }
}

/// Drives an attempt from `begin` through `Filled` and `Submitted`.
pub(crate) struct SignInSubmittedAttempt {
    pub(crate) baseline: SignInPageFixture,
}

impl SignInSubmittedAttempt {
    /// A username/password form with no message at submit.
    pub(crate) const fn login_form() -> Self {
        Self {
            baseline: SignInPageFixture::login_form(
                SignInAttemptDocumentRelation::SameDocumentSameRoute,
            ),
        }
    }

    pub(crate) fn awaiting(&self) -> anyhow::Result<SignInScenario> {
        SignInScenario::begin(1_000)?
            .activity(SignInAttemptActivity::Filled)?
            .retained()?
            .submitted(&self.baseline)
    }
}
