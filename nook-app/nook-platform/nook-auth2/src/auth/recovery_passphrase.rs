//! Keyring recovery passphrases.
//!
//! A recovery passphrase is a member of a keyring (identity) whose private
//! keys are sealed under generated words from the Orchard Street Long List.
//! People never choose the words: [`RecoveryPhrase::generate`] draws them,
//! [`TypedRecoveryWords`] reads them back as typed, and
//! [`RecoverySecret`] seals and unseals the member's keys under them with the
//! age scrypt construction at work factor 18.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

mod seal;
mod words;

use std::fmt;

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

pub use seal::{RecoverySealedSecret, RecoverySecret};
pub use words::{
    RecoveryWord, RecoveryWordCount, RecoveryWordDraw, RecoveryWordPosition, RecoveryWordSample,
    RecoveryWordSuggestions, RecoveryWordTyping, TypedRecoveryWord, TypedRecoveryWords,
    UnknownRecoveryWord,
};

/// How many words a recovery passphrase has.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, tsify::Tsify,
)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryStrength {
    /// Four words, about 56 bits. The default.
    Standard,
    /// Five words, about 70 bits.
    High,
}

impl RecoveryStrength {
    #[must_use]
    pub fn word_count(self) -> RecoveryWordCount {
        match self {
            Self::Standard => RecoveryWordCount::STANDARD,
            Self::High => RecoveryWordCount::HIGH,
        }
    }
}

/// Why typed words, a confirmation, or an unsealing were refused.
#[derive(Debug, thiserror::Error)]
pub enum RecoveryPassphraseError {
    #[error("A recovery passphrase needs a label.")]
    LabelRequired,
    #[error("No recovery words were typed.")]
    Empty,
    /// Words the list does not hold; nothing was decrypted.
    #[error("Some typed words are not recovery words.")]
    UnknownWords(Vec<UnknownRecoveryWord>),
    #[error("A recovery passphrase has {expected:?} words; {typed:?} were typed.")]
    WordCount {
        expected: RecoveryWordCount,
        typed: RecoveryWordCount,
    },
    /// Every word is a list word, but they are not the words shown.
    #[error("These are not the recovery words shown.")]
    NotTheShownWords,
    /// Every word is a list word, but they do not open this passphrase.
    #[error("These words do not open this recovery passphrase.")]
    WrongWords,
    #[error("The recovery passphrase is unreadable: {0}")]
    Unreadable(String),
    #[error("Generating a recovery passphrase failed: {0}")]
    Random(String),
}

/// The generated words of one recovery passphrase. Wiped when dropped and
/// never printed.
pub struct RecoveryPhrase {
    strength: RecoveryStrength,
    words: Vec<RecoveryWord>,
}

impl fmt::Debug for RecoveryPhrase {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RecoveryPhrase")
            .field("strength", &self.strength)
            .finish_non_exhaustive()
    }
}

impl Drop for RecoveryPhrase {
    fn drop(&mut self) {
        self.words.zeroize();
    }
}

impl RecoveryPhrase {
    /// Draw every word uniformly from the list.
    pub fn generate(strength: RecoveryStrength) -> Result<Self, RecoveryPassphraseError> {
        let words = (0..strength.word_count().into())
            .map(|_: u32| RecoveryWord::generate())
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self { strength, words })
    }

    /// Read typed words as a passphrase of `strength`. Each word is checked
    /// against the list, and the count against the strength, before any
    /// passphrase work runs.
    pub fn parse(
        typed: &TypedRecoveryWords,
        strength: RecoveryStrength,
    ) -> Result<Self, RecoveryPassphraseError> {
        Ok(Self {
            strength,
            words: typed.words_of_count(strength.word_count())?,
        })
    }

    #[must_use]
    pub fn strength(&self) -> RecoveryStrength {
        self.strength
    }

    /// The words to show, once, so the person can write them down.
    #[must_use]
    pub fn words(&self) -> Vec<&'static str> {
        self.words.iter().map(|word| word.text()).collect()
    }

    /// Check words typed back against these. A typing slip is reported word
    /// by word; list words that are not these are refused as a whole.
    #[expect(
        clippy::match_bool,
        reason = "word equality with the shown phrase is matched through a native pattern"
    )]
    pub fn confirm(&self, typed: &TypedRecoveryWords) -> Result<(), RecoveryPassphraseError> {
        let retyped = Self::parse(typed, self.strength)?;
        match retyped.words == self.words {
            true => Ok(()),
            false => Err(RecoveryPassphraseError::NotTheShownWords),
        }
    }

    /// The canonical text scrypt runs on: the list words, lowercase, one
    /// space apart. However the words were typed, the same words give it.
    fn scrypt_passphrase(&self) -> Zeroizing<String> {
        Zeroizing::new(self.words().join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(text: &str) -> TypedRecoveryWords {
        TypedRecoveryWords::from(text.to_owned())
    }

    #[test]
    fn standard_has_four_words_and_high_has_five() -> Result<(), RecoveryPassphraseError> {
        assert_eq!(
            RecoveryPhrase::generate(RecoveryStrength::Standard)?
                .words()
                .len(),
            4
        );
        assert_eq!(
            RecoveryPhrase::generate(RecoveryStrength::High)?
                .words()
                .len(),
            5
        );
        assert_eq!(
            serde_json::to_string(&RecoveryStrength::High).ok(),
            Some("\"high\"".to_owned())
        );
        Ok(())
    }

    #[test]
    fn the_retyped_words_must_be_the_shown_ones() -> Result<(), RecoveryPassphraseError> {
        let phrase = RecoveryPhrase::generate(RecoveryStrength::Standard)?;
        let shown = phrase.words();
        phrase.confirm(&typed(&shown.join(" ").to_uppercase()))?;
        phrase.confirm(&typed(&shown.join("-")))?;
        phrase.confirm(&typed(&shown.concat()))?;

        let other = RecoveryPhrase::generate(RecoveryStrength::Standard)?;
        assert!(matches!(
            phrase.confirm(&typed(&other.words().join(" "))),
            Err(RecoveryPassphraseError::NotTheShownWords)
        ));
        assert!(matches!(
            phrase.confirm(&typed(
                &shown.iter().take(3).copied().collect::<Vec<_>>().join(" ")
            )),
            Err(RecoveryPassphraseError::WordCount { .. })
        ));
        let mut typo_words = shown
            .iter()
            .map(|word| (*word).to_owned())
            .collect::<Vec<_>>();
        if let Some(first) = typo_words.first_mut() {
            first.push_str("qzq");
        }
        let typo = typo_words.join(" ");
        assert!(matches!(
            phrase.confirm(&typed(&typo)),
            Err(RecoveryPassphraseError::UnknownWords(unknown))
                if unknown.iter().map(|word| u32::from(word.position)).collect::<Vec<_>>() == vec![0]
        ));
        Ok(())
    }
}
