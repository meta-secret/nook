//! Normalized visible text and closed term lists used by sign-in classifiers.
//!
//! Matching is case-insensitive substring search over whitespace-collapsed,
//! lowercase text. Term lists are owned by the classifier that interprets them.

/// Lowercase, whitespace-collapsed visible text used only for classification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignInAttemptNormalizedText(String);

impl From<&str> for SignInAttemptNormalizedText {
    fn from(visible: &str) -> Self {
        let lowered = visible
            .chars()
            .map(SignInAttemptNormalizedText::fold_character)
            .collect::<String>()
            .to_lowercase();
        Self(lowered.split_whitespace().collect::<Vec<_>>().join(" "))
    }
}

impl SignInAttemptNormalizedText {
    /// Typographic apostrophes and the Russian `ё` compare like their plain forms.
    const fn fold_character(character: char) -> char {
        match character {
            '\u{2019}' | '\u{2018}' | '`' => '\'',
            'ё' => 'е',
            'Ё' => 'Е',
            other => other,
        }
    }
}

/// A closed list of lowercase terms owned by one classifier.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SignInAttemptTerms(pub(super) &'static [&'static str]);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptTermMatch {
    Matched,
    Unmatched,
}

impl SignInAttemptTerms {
    #[expect(
        clippy::match_bool,
        reason = "the substring search result is converted immediately into a named match outcome"
    )]
    pub(crate) fn find_in(self, text: &SignInAttemptNormalizedText) -> SignInAttemptTermMatch {
        let Self(terms) = self;
        let SignInAttemptNormalizedText(text) = text;
        match terms.iter().any(|term| text.contains(term)) {
            true => SignInAttemptTermMatch::Matched,
            false => SignInAttemptTermMatch::Unmatched,
        }
    }
}

impl SignInAttemptTerms {
    /// Like `find_in`, but a term counts only where it starts a word, so a
    /// stem does not match inside a longer word ("blocked" for "locked").
    pub(crate) fn find_word_start_in(
        self,
        text: &SignInAttemptNormalizedText,
    ) -> SignInAttemptTermMatch {
        let Self(terms) = self;
        let SignInAttemptNormalizedText(text) = text;
        let starts_word = terms.iter().any(|term| {
            text.match_indices(term).any(|(index, _)| {
                text.get(..index)
                    .and_then(|before| before.chars().next_back())
                    .is_none_or(|previous| !previous.is_alphanumeric())
            })
        });
        SignInAttemptTermMatch::from(starts_word)
    }
}

impl From<bool> for SignInAttemptTermMatch {
    #[expect(
        clippy::match_bool,
        reason = "the word-start search result is converted immediately into a named match outcome"
    )]
    fn from(matched: bool) -> Self {
        match matched {
            true => Self::Matched,
            false => Self::Unmatched,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SignInAttemptNormalizedText, SignInAttemptTermMatch, SignInAttemptTerms};

    #[test]
    fn normalization_folds_case_whitespace_apostrophes_and_yo() {
        let text = SignInAttemptNormalizedText::from("  We   COULDN\u{2019}T\nfind  Учётную ");
        assert_eq!(
            text,
            SignInAttemptNormalizedText("we couldn't find учетную".to_owned())
        );
    }

    struct WordCase {
        text: &'static str,
        expected: SignInAttemptTermMatch,
    }

    #[test]
    fn word_start_matching_ignores_terms_inside_longer_words() {
        use SignInAttemptTermMatch::{Matched, Unmatched};
        let terms = SignInAttemptTerms(&["locked", "блокировк"]);
        for case in [
            WordCase {
                text: "Your account has been locked.",
                expected: Matched,
            },
            WordCase {
                text: "locked out",
                expected: Matched,
            },
            WordCase {
                text: "Pop-up blocked",
                expected: Unmatched,
            },
            WordCase {
                text: "Account unlocked",
                expected: Unmatched,
            },
            WordCase {
                text: "Блокировка входа",
                expected: Matched,
            },
            WordCase {
                text: "Разблокировка выполнена",
                expected: Unmatched,
            },
        ] {
            assert_eq!(
                terms.find_word_start_in(&SignInAttemptNormalizedText::from(case.text)),
                case.expected,
                "{}",
                case.text
            );
        }
    }

    #[test]
    fn terms_match_substrings_of_normalized_text_only() {
        let terms = SignInAttemptTerms(&["locked", "заблокирован"]);
        assert_eq!(
            terms.find_in(&SignInAttemptNormalizedText::from("Account LOCKED")),
            SignInAttemptTermMatch::Matched
        );
        assert_eq!(
            terms.find_in(&SignInAttemptNormalizedText::from("Аккаунт заблокирована")),
            SignInAttemptTermMatch::Matched
        );
        assert_eq!(
            terms.find_in(&SignInAttemptNormalizedText::from("Welcome back")),
            SignInAttemptTermMatch::Unmatched
        );
    }
}
