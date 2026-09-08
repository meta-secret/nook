//! BIP-39 mnemonic validation (word membership + checksum).

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::errors::{ValidationError, ValidationResult};
use bip39::{Language, Mnemonic};
use zeroize::Zeroize;

/// A supported BIP-39 mnemonic word count inferred from normalized input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bip39MnemonicWordCount(u32);

impl Bip39MnemonicWordCount {
    pub const WORDS_12: Self = Self(12);
    pub const WORDS_24: Self = Self(24);
}

impl From<Bip39MnemonicWordCount> for u32 {
    fn from(value: Bip39MnemonicWordCount) -> Self {
        value.0
    }
}

/// Maximum number of matching BIP-39 word suggestions to return.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bip39WordSuggestionLimit(usize);

impl From<usize> for Bip39WordSuggestionLimit {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<Bip39WordSuggestionLimit> for usize {
    fn from(value: Bip39WordSuggestionLimit) -> Self {
        value.0
    }
}

/// Expected BIP-39 word count for membership validation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bip39WordSequenceExpectedCount(usize);

impl From<usize> for Bip39WordSequenceExpectedCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<Bip39WordSequenceExpectedCount> for usize {
    fn from(value: Bip39WordSequenceExpectedCount) -> Self {
        value.0
    }
}

/// An unchecked BIP-39 mnemonic request owned by its input text.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Bip39MnemonicInput<'a> {
    text: &'a str,
}

impl<'a> Bip39MnemonicInput<'a> {
    #[must_use]
    pub const fn new(text: &'a str) -> Self {
        Self { text }
    }

    /// Validates an English BIP-39 mnemonic and returns the validated value.
    pub fn validate(self) -> ValidationResult<Bip39Mnemonic> {
        let normalized = self.text.trim();
        if normalized.is_empty() {
            return Err(ValidationError::Bip39Empty);
        }

        Mnemonic::parse_in_normalized(Language::English, normalized)
            .map(|_| Bip39Mnemonic {
                text: normalized.to_owned(),
            })
            .map_err(|_| ValidationError::Bip39Invalid)
    }

    #[must_use]
    pub fn parse_words(self) -> Vec<String> {
        Self::parse_words_from(self.text)
    }

    #[must_use]
    pub fn infer_length(self) -> Option<Bip39MnemonicWordCount> {
        match self.parse_words().len() {
            12 => Some(Bip39MnemonicWordCount::WORDS_12),
            24 => Some(Bip39MnemonicWordCount::WORDS_24),
            _ => None,
        }
    }

    fn parse_words_from(text: &str) -> Vec<String> {
        text.split_whitespace()
            .map(str::trim)
            .filter(|word| !word.is_empty())
            .map(str::to_lowercase)
            .collect()
    }
}

/// A validated English BIP-39 mnemonic.
#[derive(Clone, PartialEq, Eq)]
pub struct Bip39Mnemonic {
    text: String,
}

impl Bip39Mnemonic {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.text
    }

    #[must_use]
    pub fn parse_words(&self) -> Vec<String> {
        Bip39MnemonicInput::parse_words_from(&self.text)
    }

    #[must_use]
    pub fn infer_length(&self) -> Option<Bip39MnemonicWordCount> {
        match self.parse_words().len() {
            12 => Some(Bip39MnemonicWordCount::WORDS_12),
            24 => Some(Bip39MnemonicWordCount::WORDS_24),
            _ => None,
        }
    }
}

impl Zeroize for Bip39Mnemonic {
    fn zeroize(&mut self) {
        self.text.zeroize();
    }
}

impl Drop for Bip39Mnemonic {
    fn drop(&mut self) {
        self.zeroize();
    }
}

/// The bundled English BIP-39 word list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bip39EnglishWordList(Vec<&'static str>);

impl Bip39EnglishWordList {
    #[must_use]
    pub fn english() -> Self {
        Self(Language::English.word_list().to_vec())
    }

    #[must_use]
    pub fn into_words(self) -> Vec<&'static str> {
        self.0
    }
}

/// A word queried against the bundled English BIP-39 list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bip39Word<'a> {
    value: &'a str,
}

impl<'a> Bip39Word<'a> {
    #[must_use]
    pub const fn new(value: &'a str) -> Self {
        Self { value }
    }

    #[must_use]
    pub fn is_known(self) -> bool {
        let normalized = self.value.trim().to_lowercase();
        !normalized.is_empty() && Language::English.find_word(&normalized).is_some()
    }
}

/// Input for bounded BIP-39 word suggestions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bip39WordSuggestionRequest<'a> {
    pub prefix: &'a str,
    pub limit: Bip39WordSuggestionLimit,
}

impl Bip39WordSuggestionRequest<'_> {
    #[must_use]
    pub fn suggest(self) -> Vec<&'static str> {
        let limit = usize::from(self.limit);
        let needle = self.prefix.trim().to_lowercase();
        if needle.is_empty() || limit == 0 {
            return Vec::new();
        }
        Language::English
            .words_by_prefix(&needle)
            .iter()
            .copied()
            .take(limit)
            .collect()
    }
}

/// Input for BIP-39 word-sequence membership validation.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Bip39WordSequenceRequest<'a> {
    pub text: &'a str,
    pub expected_word_count: Bip39WordSequenceExpectedCount,
}

impl Bip39WordSequenceRequest<'_> {
    #[must_use]
    pub fn validate(self) -> Bip39WordSequenceValidation {
        let words = Bip39MnemonicInput::new(self.text).parse_words();
        if words.len() != usize::from(self.expected_word_count) {
            return Bip39WordSequenceValidation::WrongWordCount;
        }
        if words.iter().any(|word| !Bip39Word::new(word).is_known()) {
            return Bip39WordSequenceValidation::UnknownWord;
        }
        Bip39WordSequenceValidation::Valid
    }
}

/// Typed result of BIP-39 word-sequence membership validation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bip39WordSequenceValidation {
    Valid,
    WrongWordCount,
    UnknownWord,
}

/// Normalized BIP-39 words that can be joined for presentation.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Bip39Words<'a> {
    words: &'a [String],
}

impl<'a> Bip39Words<'a> {
    #[must_use]
    pub const fn new(words: &'a [String]) -> Self {
        Self { words }
    }

    #[must_use]
    pub fn join(self) -> String {
        self.words
            .iter()
            .map(|word| word.trim().to_lowercase())
            .filter(|word| !word.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::*;
    use bip39::Mnemonic;

    const VALID_12: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn accepts_standard_bip39_test_vectors() -> anyhow::Result<()> {
        assert!(Bip39MnemonicInput::new(VALID_12).validate().is_ok());
        let mnemonic_24 = Mnemonic::from_entropy(&[0u8; 32])?;
        let mnemonic_24 = mnemonic_24.to_string();
        assert!(Bip39MnemonicInput::new(&mnemonic_24).validate().is_ok());
        Ok(())
    }

    #[test]
    fn rejects_unknown_words() {
        assert!(Bip39MnemonicInput::new("notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword").validate().is_err());
    }

    #[test]
    fn rejects_valid_words_with_bad_checksum() {
        assert!(
            Bip39MnemonicInput::new("able able able able able able able able able able able able")
                .validate()
                .is_err()
        );
    }

    #[test]
    fn rejects_wrong_word_count() {
        assert!(
            Bip39MnemonicInput::new("abandon abandon abandon")
                .validate()
                .is_err()
        );
    }

    #[test]
    fn rejects_empty_mnemonic() {
        assert!(Bip39MnemonicInput::new("   ").validate().is_err());
    }

    #[test]
    fn exposes_bundled_english_wordlist() {
        let words = Bip39EnglishWordList::english().into_words();
        assert_eq!(words.len(), 2048);
        assert_eq!(words.first().copied(), Some("abandon"));
        assert_eq!(words.last().copied(), Some("zoo"));
    }

    #[test]
    fn suggests_words_by_prefix() {
        assert_eq!(
            Bip39WordSuggestionRequest {
                prefix: "ab",
                limit: 4.into(),
            }
            .suggest(),
            vec!["abandon", "ability", "able", "about"]
        );
        assert_eq!(
            Bip39WordSuggestionRequest {
                prefix: "zoo",
                limit: 8.into(),
            }
            .suggest(),
            vec!["zoo"]
        );
        assert!(
            Bip39WordSuggestionRequest {
                prefix: "missing",
                limit: 8.into(),
            }
            .suggest()
            .is_empty()
        );
    }

    #[test]
    fn validates_word_sequence_membership_without_checksum() {
        assert_eq!(
            Bip39WordSequenceRequest {
                text: "abandon ability able about above absent absorb abstract absurd abuse access accident",
                expected_word_count: 12.into(),
            }
            .validate(),
            Bip39WordSequenceValidation::Valid
        );
        assert_eq!(
            Bip39WordSequenceRequest {
                text: "abandon notaword",
                expected_word_count: 2.into(),
            }
            .validate(),
            Bip39WordSequenceValidation::UnknownWord
        );
        assert_eq!(
            Bip39WordSequenceRequest {
                text: "abandon ability",
                expected_word_count: 12.into(),
            }
            .validate(),
            Bip39WordSequenceValidation::WrongWordCount
        );
    }

    #[test]
    fn normalizes_and_joins_mnemonic_words() {
        assert_eq!(
            Bip39MnemonicInput::new("  Abandon   ability\nable ").parse_words(),
            vec!["abandon", "ability", "able"]
        );
        assert_eq!(
            Bip39Words::new(&[
                " abandon ".to_owned(),
                "ABILITY".to_owned(),
                String::new(),
                "able".to_owned(),
            ])
            .join(),
            "abandon ability able"
        );
    }

    #[test]
    fn infers_supported_mnemonic_lengths() -> anyhow::Result<()> {
        let twelve_word_length = Bip39MnemonicInput::new(
            "abandon ability able about above absent absorb abstract absurd abuse access accident",
        )
        .infer_length()
        .ok_or_else(|| io::Error::other("12-word mnemonic length must be recognized"))?;
        assert_eq!(u32::from(twelve_word_length), 12);
        let twenty_four_word_length = Bip39MnemonicInput::new(
            "abandon ability able about above absent absorb abstract absurd abuse access accident \
             account accuse achieve acid acoustic acquire across act action actor actress actual",
        )
        .infer_length()
        .ok_or_else(|| io::Error::other("24-word mnemonic length must be recognized"))?;
        assert_eq!(u32::from(twenty_four_word_length), 24);
        assert_eq!(
            Bip39MnemonicInput::new("abandon ability").infer_length(),
            None
        );
        Ok(())
    }
}
