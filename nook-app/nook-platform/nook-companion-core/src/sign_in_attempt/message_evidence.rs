//! Error-looking message selection over bounded page messages.
//!
//! A message is error-looking when independent signals reach a score of 3:
//!
//! | signal | weight |
//! |---|---|
//! | source `Alert` or `FieldReference` | 2 |
//! | source `LiveRegion` | 1 |
//! | error token (`error`, `danger`, `invalid`, `fail`, `critical`, `negative`) | 2 |
//! | weak token (`alert`, `warn`) | 1 |
//! | reddish foreground or background | 2 |
//! | failure-reason vocabulary in the text | 2 |
//! | generic error vocabulary in the text | 1 |
//!
//! A success or info token (`success`, `valid`, `info`, …) vetoes a message
//! unless an error token is also present. No single signal suffices: a
//! `role=status` "Loading…" or a brand-coloured block is not an error, while
//! the Namecheap lock banner (plain container, reddish colour, lock wording)
//! is. Placement only breaks ties in favour of messages inside the form.

use std::cmp::Ordering;

use super::failure_reason::{SignInFailureReason, SignInFailureReasonReading};
use super::page_evidence::{
    SignInPageColorTone, SignInPageMessage, SignInPageMessagePlacement, SignInPageMessageSource,
    SignInPageMessageText, SignInPageMessageToken, SignInPageMessageTokens, SignInPageMessages,
};
use super::vocabulary::{SignInAttemptNormalizedText, SignInAttemptTermMatch, SignInAttemptTerms};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct SignInAttemptErrorScore(u8);

impl SignInAttemptErrorScore {
    const NONE: Self = Self(0);
    const WEAK: Self = Self(1);
    const STRONG: Self = Self(2);
    const ERROR_LOOKING: Self = Self(3);

    #[must_use]
    fn plus(self, other: Self) -> Self {
        let Self(left) = self;
        let Self(right) = other;
        Self(left.saturating_add(right))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptTokenSignal {
    Error,
    Weak,
    Veto,
    Absent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum SignInAttemptPlacementRank {
    Near,
    Inside,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct SignInAttemptMessageRank {
    score: SignInAttemptErrorScore,
    placement: SignInAttemptPlacementRank,
}

/// One error-looking message with its reason reading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignInAttemptErrorMessage {
    pub(crate) text: SignInPageMessageText,
    pub(crate) reason: SignInFailureReason,
    rank: SignInAttemptMessageRank,
}

/// The best error-looking message on a page, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SignInAttemptErrorMessageSelection {
    Selected(SignInAttemptErrorMessage),
    NoneErrorLooking,
}

impl SignInPageMessageTokens {
    const ERROR_STEMS: SignInAttemptTerms =
        SignInAttemptTerms(&["error", "danger", "invalid", "fail", "critical", "negative"]);
    const WEAK_STEMS: SignInAttemptTerms = SignInAttemptTerms(&["alert", "warn"]);
    const VETO_SEGMENTS: [&'static str; 10] = [
        "success",
        "successful",
        "succeeded",
        "positive",
        "valid",
        "ok",
        "confirmed",
        "info",
        "information",
        "notice-success",
    ];

    fn signal(&self) -> SignInAttemptTokenSignal {
        let joined = self
            .iter()
            .map(SignInPageMessageToken::text)
            .collect::<Vec<_>>()
            .join(" ");
        let text = SignInAttemptNormalizedText::from(joined.as_str());
        let veto = self.veto();
        match (
            Self::ERROR_STEMS.find_in(&text),
            Self::WEAK_STEMS.find_in(&text),
            veto,
        ) {
            (
                SignInAttemptTermMatch::Matched,
                SignInAttemptTermMatch::Matched | SignInAttemptTermMatch::Unmatched,
                SignInAttemptTermMatch::Matched | SignInAttemptTermMatch::Unmatched,
            ) => SignInAttemptTokenSignal::Error,
            (
                SignInAttemptTermMatch::Unmatched,
                SignInAttemptTermMatch::Matched | SignInAttemptTermMatch::Unmatched,
                SignInAttemptTermMatch::Matched,
            ) => SignInAttemptTokenSignal::Veto,
            (
                SignInAttemptTermMatch::Unmatched,
                SignInAttemptTermMatch::Matched,
                SignInAttemptTermMatch::Unmatched,
            ) => SignInAttemptTokenSignal::Weak,
            (
                SignInAttemptTermMatch::Unmatched,
                SignInAttemptTermMatch::Unmatched,
                SignInAttemptTermMatch::Unmatched,
            ) => SignInAttemptTokenSignal::Absent,
        }
    }

    #[expect(
        clippy::match_bool,
        reason = "segment membership is converted immediately into a named veto outcome"
    )]
    fn veto(&self) -> SignInAttemptTermMatch {
        let vetoed = self.iter().any(|token| {
            token
                .text()
                .to_lowercase()
                .split(|character: char| !character.is_alphanumeric())
                .any(|segment| Self::VETO_SEGMENTS.contains(&segment))
        });
        match vetoed {
            true => SignInAttemptTermMatch::Matched,
            false => SignInAttemptTermMatch::Unmatched,
        }
    }
}

impl SignInPageMessage {
    const GENERIC_ERROR_TERMS: SignInAttemptTerms = SignInAttemptTerms(&[
        "error",
        "failed",
        "failure",
        "unable",
        "could not",
        "couldn't",
        "can't",
        "cannot",
        "problem",
        "try again",
        "went wrong",
        "denied",
        "not allowed",
        "ошибк",
        "не удалось",
        "невозможно",
        "попробуйте",
        "повторите",
        "отказ",
    ]);

    fn source_score(&self) -> SignInAttemptErrorScore {
        match self.source {
            SignInPageMessageSource::Alert | SignInPageMessageSource::FieldReference => {
                SignInAttemptErrorScore::STRONG
            }
            SignInPageMessageSource::LiveRegion => SignInAttemptErrorScore::WEAK,
            SignInPageMessageSource::Container => SignInAttemptErrorScore::NONE,
        }
    }

    fn color_score(&self) -> SignInAttemptErrorScore {
        match (self.foreground.tone(), self.background.tone()) {
            (
                SignInPageColorTone::Reddish,
                SignInPageColorTone::Reddish | SignInPageColorTone::Neutral,
            )
            | (SignInPageColorTone::Neutral, SignInPageColorTone::Reddish) => {
                SignInAttemptErrorScore::STRONG
            }
            (SignInPageColorTone::Neutral, SignInPageColorTone::Neutral) => {
                SignInAttemptErrorScore::NONE
            }
        }
    }

    fn text_score(&self, reading: SignInFailureReasonReading) -> SignInAttemptErrorScore {
        let text = SignInAttemptNormalizedText::from(self.text.text());
        match (reading.vocabulary, Self::GENERIC_ERROR_TERMS.find_in(&text)) {
            (
                SignInAttemptTermMatch::Matched,
                SignInAttemptTermMatch::Matched | SignInAttemptTermMatch::Unmatched,
            ) => SignInAttemptErrorScore::STRONG,
            (SignInAttemptTermMatch::Unmatched, SignInAttemptTermMatch::Matched) => {
                SignInAttemptErrorScore::WEAK
            }
            (SignInAttemptTermMatch::Unmatched, SignInAttemptTermMatch::Unmatched) => {
                SignInAttemptErrorScore::NONE
            }
        }
    }

    fn assessment(&self) -> SignInAttemptMessageAssessment {
        let reading =
            SignInFailureReasonReading::from(&SignInAttemptNormalizedText::from(self.text.text()));
        let signals = self
            .source_score()
            .plus(self.color_score())
            .plus(self.text_score(reading));
        let score = match self.tokens.signal() {
            SignInAttemptTokenSignal::Veto => return SignInAttemptMessageAssessment::Ordinary,
            SignInAttemptTokenSignal::Error => signals.plus(SignInAttemptErrorScore::STRONG),
            SignInAttemptTokenSignal::Weak => signals.plus(SignInAttemptErrorScore::WEAK),
            SignInAttemptTokenSignal::Absent => signals,
        };
        let placement = match self.placement {
            SignInPageMessagePlacement::InsideAuthForm => SignInAttemptPlacementRank::Inside,
            SignInPageMessagePlacement::NearAuthForm => SignInAttemptPlacementRank::Near,
        };
        match score.cmp(&SignInAttemptErrorScore::ERROR_LOOKING) {
            Ordering::Less => SignInAttemptMessageAssessment::Ordinary,
            Ordering::Equal | Ordering::Greater => {
                SignInAttemptMessageAssessment::ErrorLooking(SignInAttemptErrorMessage {
                    text: self.text.clone(),
                    reason: reading.reason,
                    rank: SignInAttemptMessageRank { score, placement },
                })
            }
        }
    }
}

enum SignInAttemptMessageAssessment {
    ErrorLooking(SignInAttemptErrorMessage),
    Ordinary,
}

impl SignInAttemptErrorMessageSelection {
    /// Keeps the higher-ranked error-looking message; the earlier one wins ties.
    #[must_use]
    fn consider(self, assessment: SignInAttemptMessageAssessment) -> Self {
        let SignInAttemptMessageAssessment::ErrorLooking(candidate) = assessment else {
            return self;
        };
        match self {
            Self::NoneErrorLooking => Self::Selected(candidate),
            Self::Selected(best) => match candidate.rank.cmp(&best.rank) {
                Ordering::Greater => Self::Selected(candidate),
                Ordering::Less | Ordering::Equal => Self::Selected(best),
            },
        }
    }
}

impl SignInPageMessages {
    /// The highest-ranked error-looking message, whether fresh or stale.
    pub(crate) fn error_selection(&self) -> SignInAttemptErrorMessageSelection {
        self.iter().fold(
            SignInAttemptErrorMessageSelection::NoneErrorLooking,
            |selection, message| selection.consider(message.assessment()),
        )
    }
}
