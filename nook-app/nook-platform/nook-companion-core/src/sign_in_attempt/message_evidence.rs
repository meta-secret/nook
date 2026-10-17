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

    /// Error and weak stems read the element's and its ancestors' tokens; the
    /// success/info veto reads only the element's own tokens, so a wrapper
    /// class cannot suppress a styled error banner.
    fn signal(&self, ancestors: &Self) -> SignInAttemptTokenSignal {
        let joined = self
            .iter()
            .chain(ancestors.iter())
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
        let score = match self.tokens.signal(&self.ancestor_tokens) {
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

/// Which messages a freshness decision admits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptMessageAdmission {
    /// Every message (a new document, or no error-looking message at submit).
    Every,
    /// Only messages that appeared or changed since the acting script's submit.
    ChangedSinceSubmit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptMessageChange {
    Changed,
    Unchanged,
}

impl SignInPageMessage {
    #[expect(
        clippy::match_bool,
        reason = "the sensor contract boolean is converted immediately into a named change state"
    )]
    fn change(&self) -> SignInAttemptMessageChange {
        match self.changed_since_submit {
            true => SignInAttemptMessageChange::Changed,
            false => SignInAttemptMessageChange::Unchanged,
        }
    }

    fn admitted(&self, admission: SignInAttemptMessageAdmission) -> SignInAttemptMessageAssessment {
        match (admission, self.change()) {
            (
                SignInAttemptMessageAdmission::Every,
                SignInAttemptMessageChange::Changed | SignInAttemptMessageChange::Unchanged,
            )
            | (
                SignInAttemptMessageAdmission::ChangedSinceSubmit,
                SignInAttemptMessageChange::Changed,
            ) => self.assessment(),
            (
                SignInAttemptMessageAdmission::ChangedSinceSubmit,
                SignInAttemptMessageChange::Unchanged,
            ) => SignInAttemptMessageAssessment::Ordinary,
        }
    }
}

impl SignInPageMessages {
    /// The highest-ranked error-looking message, whether fresh or stale.
    pub(crate) fn error_selection(&self) -> SignInAttemptErrorMessageSelection {
        self.admitted_error_selection(SignInAttemptMessageAdmission::Every)
    }

    /// The highest-ranked error-looking message among admitted messages.
    pub(crate) fn admitted_error_selection(
        &self,
        admission: SignInAttemptMessageAdmission,
    ) -> SignInAttemptErrorMessageSelection {
        self.iter().fold(
            SignInAttemptErrorMessageSelection::NoneErrorLooking,
            |selection, message| selection.consider(message.admitted(admission)),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::SignInAttemptErrorMessageSelection;
    use crate::sign_in_attempt::failure_reason::SignInFailureReason;
    use crate::sign_in_attempt::page_evidence::{
        SignInPageMessagePlacement, SignInPageMessageSource, SignInPageMessages,
    };
    use crate::sign_in_attempt::test_fixture::SignInMessageFixture;

    /// Selects the error-looking message among fixture messages.
    struct SelectionCase {
        messages: Vec<SignInMessageFixture>,
    }

    impl SelectionCase {
        fn selected_text(&self) -> anyhow::Result<String> {
            let messages = self
                .messages
                .iter()
                .map(SignInMessageFixture::message)
                .collect::<anyhow::Result<Vec<_>>>()?;
            match SignInPageMessages::try_from(messages)?.error_selection() {
                SignInAttemptErrorMessageSelection::Selected(selected) => {
                    Ok(selected.text.text().to_owned())
                }
                SignInAttemptErrorMessageSelection::NoneErrorLooking => Ok(String::new()),
            }
        }
    }

    #[test]
    fn no_single_weak_signal_makes_a_message_an_error() -> anyhow::Result<()> {
        for message in [
            SignInMessageFixture::alert("Loading…"),
            SignInMessageFixture::red_banner("Welcome to Namecheap"),
            SignInMessageFixture::container("Incorrect format? See the help center"),
            SignInMessageFixture::field_reference("Use your email address"),
            SignInMessageFixture {
                source: SignInPageMessageSource::LiveRegion,
                ..SignInMessageFixture::container("Error")
            },
            SignInMessageFixture {
                tokens: &["alert", "alert-success"],
                ..SignInMessageFixture::alert("You could not be signed out, please try again")
            },
            SignInMessageFixture {
                tokens: &["notice-info"],
                background: SignInMessageFixture::TINT_RED,
                ..SignInMessageFixture::container("Sign-in failed")
            },
        ] {
            assert_eq!(
                SelectionCase {
                    messages: vec![message.clone()]
                }
                .selected_text()?,
                "",
                "{message:?}"
            );
        }
        Ok(())
    }

    #[test]
    fn combined_signals_select_error_looking_messages() -> anyhow::Result<()> {
        for message in [
            SignInMessageFixture::red_banner(SignInMessageFixture::NAMECHEAP_LOCK),
            SignInMessageFixture::alert("Incorrect username or password."),
            SignInMessageFixture {
                tokens: &["form-error"],
                ..SignInMessageFixture::container("Something went wrong")
            },
            SignInMessageFixture {
                tokens: &["has-error", "help-block"],
                ..SignInMessageFixture::container("Please check your password and try again")
            },
            SignInMessageFixture {
                background: SignInMessageFixture::TINT_RED,
                ..SignInMessageFixture::container("Не удалось войти")
            },
            SignInMessageFixture {
                tokens: &["alert", "alert-danger"],
                ..SignInMessageFixture::container("Your session expired, please try again")
            },
        ] {
            assert_eq!(
                SelectionCase {
                    messages: vec![message.clone()]
                }
                .selected_text()?,
                message.text,
                "{message:?}"
            );
        }
        Ok(())
    }

    #[test]
    fn selection_prefers_stronger_evidence_then_the_form_then_page_order() -> anyhow::Result<()> {
        let near = SignInMessageFixture {
            placement: SignInPageMessagePlacement::NearAuthForm,
            ..SignInMessageFixture::alert("Invalid password")
        };
        let inside = SignInMessageFixture::alert("Invalid email");
        let stronger = SignInMessageFixture {
            tokens: &["error"],
            ..SignInMessageFixture::red_banner("Account locked")
        };
        assert_eq!(
            SelectionCase {
                messages: vec![near.clone(), inside.clone()]
            }
            .selected_text()?,
            "Invalid email"
        );
        assert_eq!(
            SelectionCase {
                messages: vec![inside.clone(), stronger.clone()]
            }
            .selected_text()?,
            "Account locked"
        );
        assert_eq!(
            SelectionCase {
                messages: vec![inside, SignInMessageFixture::alert("Wrong password")]
            }
            .selected_text()?,
            "Invalid email"
        );
        Ok(())
    }

    #[test]
    fn the_selected_message_carries_its_reason_reading() -> anyhow::Result<()> {
        let messages = SignInPageMessages::try_from(vec![
            SignInMessageFixture::red_banner(SignInMessageFixture::NAMECHEAP_LOCK).message()?,
        ])?;
        let SignInAttemptErrorMessageSelection::Selected(selected) = messages.error_selection()
        else {
            anyhow::bail!("the Namecheap lock banner must be error-looking");
        };
        assert_eq!(selected.reason, SignInFailureReason::AccountLocked);
        Ok(())
    }

    #[test]
    fn only_the_elements_own_tokens_can_veto_a_styled_banner() -> anyhow::Result<()> {
        let wrapped = SignInMessageFixture {
            ancestor_tokens: &["panel-info", "ok"],
            ..SignInMessageFixture::red_banner(SignInMessageFixture::NAMECHEAP_LOCK)
        };
        assert_eq!(
            SelectionCase {
                messages: vec![wrapped]
            }
            .selected_text()?,
            SignInMessageFixture::NAMECHEAP_LOCK
        );
        let own_info = SignInMessageFixture {
            tokens: &["notice-info"],
            ..SignInMessageFixture::red_banner(SignInMessageFixture::NAMECHEAP_LOCK)
        };
        assert_eq!(
            SelectionCase {
                messages: vec![own_info]
            }
            .selected_text()?,
            ""
        );
        let ancestor_error = SignInMessageFixture {
            ancestor_tokens: &["form-group", "has-error"],
            ..SignInMessageFixture::container("Please check your password and try again")
        };
        assert_eq!(
            SelectionCase {
                messages: vec![ancestor_error]
            }
            .selected_text()?,
            "Please check your password and try again"
        );
        Ok(())
    }
}
