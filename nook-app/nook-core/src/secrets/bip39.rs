//! BIP-39 mnemonic validation (word membership + checksum).

use crate::errors::{ValidationError, ValidationResult};
use bip39::{Language, Mnemonic};

/// Validates a normalized English BIP-39 mnemonic (12 or 24 words).
pub fn validate_bip39_mnemonic(mnemonic: &str) -> ValidationResult<()> {
    let normalized = mnemonic.trim();
    if normalized.is_empty() {
        return Err(ValidationError::Bip39Empty);
    }

    Mnemonic::parse_in_normalized(Language::English, normalized)
        .map(|_| ())
        .map_err(|_| ValidationError::Bip39Invalid)
}

#[must_use]
pub fn bip39_english_wordlist() -> Vec<&'static str> {
    Language::English.word_list().to_vec()
}

#[must_use]
pub fn is_known_bip39_word(word: &str) -> bool {
    let normalized = word.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }
    Language::English.find_word(&normalized).is_some()
}

#[must_use]
pub fn suggest_bip39_words(prefix: &str, limit: usize) -> Vec<&'static str> {
    let needle = prefix.trim().to_lowercase();
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
pub fn is_bip39_word_sequence_valid(text: &str, expected_word_count: usize) -> bool {
    let words = parse_bip39_words(text);
    words.len() == expected_word_count && words.iter().all(|word| is_known_bip39_word(word))
}

#[must_use]
pub fn parse_bip39_words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(str::trim)
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

#[must_use]
pub fn join_bip39_words(words: &[String]) -> String {
    words
        .iter()
        .map(|word| word.trim().to_lowercase())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[must_use]
pub fn infer_bip39_mnemonic_length(text: &str) -> Option<u32> {
    match parse_bip39_words(text).len() {
        12 => Some(12),
        24 => Some(24),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bip39::Mnemonic;

    const VALID_12: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn accepts_standard_bip39_test_vectors() {
        assert!(validate_bip39_mnemonic(VALID_12).is_ok());
        let mnemonic_24 = Mnemonic::from_entropy(&[0u8; 32]).expect("24-word mnemonic");
        assert!(validate_bip39_mnemonic(&mnemonic_24.to_string()).is_ok());
    }

    #[test]
    fn rejects_unknown_words() {
        assert!(validate_bip39_mnemonic("notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword").is_err());
    }

    #[test]
    fn rejects_valid_words_with_bad_checksum() {
        assert!(
            validate_bip39_mnemonic("able able able able able able able able able able able able")
                .is_err()
        );
    }

    #[test]
    fn rejects_wrong_word_count() {
        assert!(validate_bip39_mnemonic("abandon abandon abandon").is_err());
    }

    #[test]
    fn rejects_empty_mnemonic() {
        assert!(validate_bip39_mnemonic("   ").is_err());
    }

    #[test]
    fn exposes_bundled_english_wordlist() {
        let words = bip39_english_wordlist();
        assert_eq!(words.len(), 2048);
        assert_eq!(words.first().copied(), Some("abandon"));
        assert_eq!(words.last().copied(), Some("zoo"));
    }

    #[test]
    fn suggests_words_by_prefix() {
        assert_eq!(
            suggest_bip39_words("ab", 4),
            vec!["abandon", "ability", "able", "about"]
        );
        assert_eq!(suggest_bip39_words("zoo", 8), vec!["zoo"]);
        assert!(suggest_bip39_words("missing", 8).is_empty());
    }

    #[test]
    fn validates_word_sequence_membership_without_checksum() {
        assert!(is_bip39_word_sequence_valid(
            "abandon ability able about above absent absorb abstract absurd abuse access accident",
            12
        ));
        assert!(!is_bip39_word_sequence_valid("abandon notaword", 12));
        assert!(!is_bip39_word_sequence_valid("abandon ability", 12));
    }

    #[test]
    fn normalizes_and_joins_mnemonic_words() {
        assert_eq!(
            parse_bip39_words("  Abandon   ability\nable "),
            vec!["abandon", "ability", "able"]
        );
        assert_eq!(
            join_bip39_words(&[
                " abandon ".to_owned(),
                "ABILITY".to_owned(),
                String::new(),
                "able".to_owned(),
            ]),
            "abandon ability able"
        );
    }

    #[test]
    fn infers_supported_mnemonic_lengths() {
        assert_eq!(
            infer_bip39_mnemonic_length(
                "abandon ability able about above absent absorb abstract absurd abuse access accident"
            ),
            Some(12)
        );
        assert_eq!(infer_bip39_mnemonic_length("abandon ability"), None);
    }
}
