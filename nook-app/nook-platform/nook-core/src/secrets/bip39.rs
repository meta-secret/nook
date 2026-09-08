//! BIP-39 mnemonic validation (word membership + checksum).

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::errors::{ValidationError, ValidationResult};
use bip39::{Language, Mnemonic};

/// A supported BIP-39 mnemonic word count inferred from normalized input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bip39MnemonicWordCount(u32);

impl Bip39MnemonicWordCount {
    pub const WORDS_12: Self = Self(12);
    pub const WORDS_24: Self = Self(24);
}

/// Operations over the English BIP-39 mnemonic domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bip39Mnemonic;

/// Input for bounded BIP-39 word suggestions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bip39WordSuggestionRequest<'a> {
    pub prefix: &'a str,
    pub limit: Bip39WordSuggestionLimit,
}

/// Input for BIP-39 word-sequence membership validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bip39WordSequenceRequest<'a> {
    pub text: &'a str,
    pub expected_word_count: Bip39WordSequenceExpectedCount,
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

impl Bip39Mnemonic {
    /// Validates an English BIP-39 mnemonic (12 or 24 words).
    pub fn validate(mnemonic: &str) -> ValidationResult<()> {
        let normalized = mnemonic.trim();
        if normalized.is_empty() {
            return Err(ValidationError::Bip39Empty);
        }

        Mnemonic::parse_in_normalized(Language::English, normalized)
            .map(|_| ())
            .map_err(|_| ValidationError::Bip39Invalid)
    }

    #[must_use]
    pub fn english_wordlist() -> Vec<&'static str> {
        Language::English.word_list().to_vec()
    }

    #[must_use]
    pub fn is_known_word(word: &str) -> bool {
        let normalized = word.trim().to_lowercase();
        if normalized.is_empty() {
            return false;
        }
        Language::English.find_word(&normalized).is_some()
    }

    #[must_use]
    pub fn suggest(request: Bip39WordSuggestionRequest<'_>) -> Vec<&'static str> {
        let limit = usize::from(request.limit);
        let needle = request.prefix.trim().to_lowercase();
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

    #[must_use]
    pub fn is_word_sequence_valid(request: Bip39WordSequenceRequest<'_>) -> bool {
        let words = Self::parse_words(request.text);
        words.len() == usize::from(request.expected_word_count)
            && words.iter().all(|word| Self::is_known_word(word))
    }

    #[must_use]
    pub fn parse_words(text: &str) -> Vec<String> {
        text.split_whitespace()
            .map(str::trim)
            .filter(|word| !word.is_empty())
            .map(str::to_lowercase)
            .collect()
    }

    #[must_use]
    pub fn join_words(words: &[String]) -> String {
        words
            .iter()
            .map(|word| word.trim().to_lowercase())
            .filter(|word| !word.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[must_use]
    pub fn infer_length(text: &str) -> Option<Bip39MnemonicWordCount> {
        match Self::parse_words(text).len() {
            12 => Some(Bip39MnemonicWordCount::WORDS_12),
            24 => Some(Bip39MnemonicWordCount::WORDS_24),
            _ => None,
        }
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
        assert!(Bip39Mnemonic::validate(VALID_12).is_ok());
        let mnemonic_24 = Mnemonic::from_entropy(&[0u8; 32])?;
        assert!(Bip39Mnemonic::validate(&mnemonic_24.to_string()).is_ok());
        Ok(())
    }

    #[test]
    fn rejects_unknown_words() {
        assert!(Bip39Mnemonic::validate("notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword").is_err());
    }

    #[test]
    fn rejects_valid_words_with_bad_checksum() {
        assert!(
            Bip39Mnemonic::validate("able able able able able able able able able able able able")
                .is_err()
        );
    }

    #[test]
    fn rejects_wrong_word_count() {
        assert!(Bip39Mnemonic::validate("abandon abandon abandon").is_err());
    }

    #[test]
    fn rejects_empty_mnemonic() {
        assert!(Bip39Mnemonic::validate("   ").is_err());
    }

    #[test]
    fn exposes_bundled_english_wordlist() {
        let words = Bip39Mnemonic::english_wordlist();
        assert_eq!(words.len(), 2048);
        assert_eq!(words.first().copied(), Some("abandon"));
        assert_eq!(words.last().copied(), Some("zoo"));
    }

    #[test]
    fn suggests_words_by_prefix() {
        assert_eq!(
            Bip39Mnemonic::suggest(Bip39WordSuggestionRequest {
                prefix: "ab",
                limit: 4.into(),
            }),
            vec!["abandon", "ability", "able", "about"]
        );
        assert_eq!(
            Bip39Mnemonic::suggest(Bip39WordSuggestionRequest {
                prefix: "zoo",
                limit: 8.into(),
            }),
            vec!["zoo"]
        );
        assert!(
            Bip39Mnemonic::suggest(Bip39WordSuggestionRequest {
                prefix: "missing",
                limit: 8.into(),
            })
            .is_empty()
        );
    }

    #[test]
    fn validates_word_sequence_membership_without_checksum() {
        assert!(Bip39Mnemonic::is_word_sequence_valid(
            Bip39WordSequenceRequest {
                text: "abandon ability able about above absent absorb abstract absurd abuse access accident",
                expected_word_count: 12.into(),
            }
        ));
        assert!(!Bip39Mnemonic::is_word_sequence_valid(
            Bip39WordSequenceRequest {
                text: "abandon notaword",
                expected_word_count: 12.into(),
            }
        ));
        assert!(!Bip39Mnemonic::is_word_sequence_valid(
            Bip39WordSequenceRequest {
                text: "abandon ability",
                expected_word_count: 12.into(),
            }
        ));
    }

    #[test]
    fn normalizes_and_joins_mnemonic_words() {
        assert_eq!(
            Bip39Mnemonic::parse_words("  Abandon   ability\nable "),
            vec!["abandon", "ability", "able"]
        );
        assert_eq!(
            Bip39Mnemonic::join_words(&[
                " abandon ".to_owned(),
                "ABILITY".to_owned(),
                String::new(),
                "able".to_owned(),
            ]),
            "abandon ability able"
        );
    }

    #[test]
    fn infers_supported_mnemonic_lengths() -> anyhow::Result<()> {
        let twelve_word_length = Bip39Mnemonic::infer_length(
            "abandon ability able about above absent absorb abstract absurd abuse access accident",
        )
        .ok_or_else(|| io::Error::other("12-word mnemonic length must be recognized"))?;
        assert_eq!(u32::from(twelve_word_length), 12);
        let twenty_four_word_length = Bip39Mnemonic::infer_length(
            "abandon ability able about above absent absorb abstract absurd abuse access accident \
             account accuse achieve acid acoustic acquire across act action actor actress actual",
        )
        .ok_or_else(|| io::Error::other("24-word mnemonic length must be recognized"))?;
        assert_eq!(u32::from(twenty_four_word_length), 24);
        assert_eq!(Bip39Mnemonic::infer_length("abandon ability"), None);
        Ok(())
    }
}
