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
}
