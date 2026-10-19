//! Plausibility of one visible text string as a manual Base32 setup key.
//!
//! # Rule
//!
//! A text is a plausible setup key only when all of the following hold:
//!
//! 1. **Label.** After trimming, at most one leading label is removed: any
//!    prefix of up to [`MAX_LABEL_BYTES`] bytes before the first `:`
//!    (`Key:`, `Secret key:`, `Setup key:`, or the same in any language).
//!    A longer prefix is not a label, so its colon makes the text non-Base32.
//! 2. **Grammar.** The remainder is one or more groups of Base32 characters
//!    (`A`–`Z`, `a`–`z`, `2`–`7`) separated by exactly one ASCII space or
//!    hyphen. Padding, `0`/`1`/`8`/`9`, punctuation, other whitespace, and
//!    leading, trailing, or doubled separators are rejected.
//! 3. **Grouping.** With several groups, every group except the last has the
//!    same length and the last is not longer. Sentences of varying-length
//!    words fail this.
//! 4. **Key evidence.** The key contains at least one Base32 digit (`2`–`7`),
//!    or its compact form has at least [`DIGITLESS_MIN_CHARS`] characters.
//! 5. **Key.** [`TotpSecret::parse`] accepts the remainder (at least 10 decoded
//!    bytes), which also performs the canonical normalization.
//!
//! Rule 4 applies to grouped and ungrouped text alike, because uniform word
//! lengths alone do not exclude prose: "Scan this code with your app" groups
//! as 4-4-4-4-4-3 letters. English words and short phrases rarely contain
//! digits and never reach 26 letters with uniform grouping.
//!
//! **Tradeoff.** A random key whose characters happen to be letters only and
//! whose compact length is below 26 is not detected: about 3.6 % of 16-character
//! keys and effectively no 32-character keys. The user can still add such a
//! key through the manual form. A single invented word of 26 or more Base32
//! letters would be accepted; it must still decode to a valid key, and the user
//! reviews every candidate before save.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::AuthenticatorEnrollmentError;
use crate::TotpSecret;
use serde::Deserialize;
use std::cmp::Ordering;
use zeroize::Zeroize;

/// Byte bound for one visible text-bearing element.
const MAX_SETUP_KEY_TEXT_BYTES: usize = 256;
/// Byte bound for a removable leading label such as `Setup key:`.
const MAX_LABEL_BYTES: usize = 64;
/// Compact length at which a digitless key is still accepted.
const DIGITLESS_MIN_CHARS: usize = 26;

/// One bounded visible text string that may present a manual setup key.
#[derive(Deserialize)]
#[serde(try_from = "String")]
pub struct VisibleSetupKeyText(String);

impl TryFrom<String> for VisibleSetupKeyText {
    type Error = AuthenticatorEnrollmentError;

    fn try_from(mut text: String) -> Result<Self, Self::Error> {
        match text.len().cmp(&MAX_SETUP_KEY_TEXT_BYTES) {
            Ordering::Less | Ordering::Equal => Ok(Self(text)),
            Ordering::Greater => {
                text.zeroize();
                Err(AuthenticatorEnrollmentError::SetupKeyTextTooLong)
            }
        }
    }
}

impl Zeroize for VisibleSetupKeyText {
    fn zeroize(&mut self) {
        let Self(text) = self;
        text.zeroize();
    }
}

impl Drop for VisibleSetupKeyText {
    fn drop(&mut self) {
        self.zeroize();
    }
}

/// Whether a visible text presents a manual setup key.
pub enum SetupKeyTextClassification {
    /// The canonical, validated key the text presents.
    SetupKey(TotpSecret),
    /// Prose, a non-Base32 value, or a value too short to be a key.
    NotSetupKey,
}

impl VisibleSetupKeyText {
    #[must_use]
    pub fn classify(&self) -> SetupKeyTextClassification {
        let Self(text) = self;
        let key_text = UnlabeledKeyText::from_visible(text.trim());
        match KeyGroups::scan(key_text.text()) {
            GroupScan::Base32(groups) => groups.classify(key_text.text()),
            GroupScan::NotBase32 => SetupKeyTextClassification::NotSetupKey,
        }
    }
}

/// The visible text after removing at most one short leading label.
struct UnlabeledKeyText<'a> {
    text: &'a str,
}

impl<'a> UnlabeledKeyText<'a> {
    fn from_visible(text: &'a str) -> Self {
        let text = match text.split_once(':') {
            Some((label, key)) => match label.len() {
                0..=MAX_LABEL_BYTES => key.trim(),
                _ => text,
            },
            None => text,
        };
        Self { text }
    }

    const fn text(&self) -> &'a str {
        self.text
    }
}

enum DigitPresence {
    Present,
    Absent,
}

/// Group lengths of grammatically valid Base32 text, without the characters.
struct KeyGroups {
    lengths: Vec<usize>,
    digits: DigitPresence,
}

enum GroupScan {
    Base32(KeyGroups),
    NotBase32,
}

enum GroupShape {
    Uniform,
    Irregular,
}

enum KeyEvidence {
    Sufficient,
    Insufficient,
}

impl KeyGroups {
    fn scan(text: &str) -> GroupScan {
        let mut lengths = Vec::new();
        let mut current = 0_usize;
        let mut digits = DigitPresence::Absent;
        for character in text.chars() {
            match character {
                'A'..='Z' | 'a'..='z' => current += 1,
                '2'..='7' => {
                    current += 1;
                    digits = DigitPresence::Present;
                }
                ' ' | '-' => match current {
                    0 => return GroupScan::NotBase32,
                    length => {
                        lengths.push(length);
                        current = 0;
                    }
                },
                _ => return GroupScan::NotBase32,
            }
        }
        match current {
            0 => GroupScan::NotBase32,
            length => {
                lengths.push(length);
                GroupScan::Base32(Self { lengths, digits })
            }
        }
    }

    #[expect(
        clippy::match_bool,
        reason = "the length comparison is converted through a native pattern into a named group shape"
    )]
    fn shape(&self) -> GroupShape {
        let Some((last, leading)) = self.lengths.split_last() else {
            return GroupShape::Irregular;
        };
        let Some((first, rest)) = leading.split_first() else {
            return GroupShape::Uniform;
        };
        match rest.iter().all(|length| length == first) && last <= first {
            true => GroupShape::Uniform,
            false => GroupShape::Irregular,
        }
    }

    fn evidence(&self) -> KeyEvidence {
        match self.digits {
            DigitPresence::Present => KeyEvidence::Sufficient,
            DigitPresence::Absent => match self.lengths.iter().sum::<usize>() {
                0..DIGITLESS_MIN_CHARS => KeyEvidence::Insufficient,
                _ => KeyEvidence::Sufficient,
            },
        }
    }

    fn classify(&self, key_text: &str) -> SetupKeyTextClassification {
        match self.shape() {
            GroupShape::Irregular => SetupKeyTextClassification::NotSetupKey,
            GroupShape::Uniform => match self.evidence() {
                KeyEvidence::Insufficient => SetupKeyTextClassification::NotSetupKey,
                KeyEvidence::Sufficient => match TotpSecret::parse(key_text) {
                    Ok(secret) => SetupKeyTextClassification::SetupKey(secret),
                    Err(_) => SetupKeyTextClassification::NotSetupKey,
                },
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AuthenticatorEnrollmentError, MAX_SETUP_KEY_TEXT_BYTES, SetupKeyTextClassification,
        VisibleSetupKeyText,
    };

    struct TextFixture<'a> {
        text: &'a str,
    }

    impl TextFixture<'_> {
        fn classify(&self) -> Result<SetupKeyTextClassification, AuthenticatorEnrollmentError> {
            Ok(VisibleSetupKeyText::try_from(self.text.to_owned())?.classify())
        }

        fn canonical_key(&self) -> anyhow::Result<String> {
            match self.classify()? {
                SetupKeyTextClassification::SetupKey(secret) => Ok(secret.as_str().to_owned()),
                SetupKeyTextClassification::NotSetupKey => {
                    anyhow::bail!("expected a setup key for fixture {:?}", self.text)
                }
            }
        }

        fn assert_rejected(&self) -> anyhow::Result<()> {
            match self.classify()? {
                SetupKeyTextClassification::NotSetupKey => Ok(()),
                SetupKeyTextClassification::SetupKey(_) => {
                    anyhow::bail!("fixture {:?} was classified as a setup key", self.text)
                }
            }
        }
    }

    #[test]
    fn accepts_grouped_lowercase_hyphenated_and_labeled_keys() -> anyhow::Result<()> {
        for text in [
            "JBSW Y3DP EHPK 3PXP",
            "jbswy3dpehpk3pxp",
            "jbsw-y3dp-ehpk-3pxp",
            "Key: JBSW Y3DP EHPK 3PXP",
            "  Setup key:JBSWY3DPEHPK3PXP  ",
            "Clé secrète : jbsw y3dp ehpk 3pxp",
            "JBSW Y3DP EHPK 3PXP 7",
        ] {
            let canonical = TextFixture { text }.canonical_key()?;
            assert!(canonical.starts_with("JBSWY3DPEHPK3PX"), "{text:?}");
        }
        assert_eq!(
            TextFixture {
                text: "JBSW Y3DP EHPK 3PXP"
            }
            .canonical_key()?,
            "JBSWY3DPEHPK3PXP"
        );
        Ok(())
    }

    #[test]
    fn accepts_long_digitless_keys_but_not_short_digitless_ones() -> anyhow::Result<()> {
        assert_eq!(
            TextFixture {
                text: "ABCD EFGH IJKL MNOP QRST UVWX YZAB CDEF"
            }
            .canonical_key()?,
            "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF"
        );
        TextFixture {
            text: "ABCD EFGH IJKL MNOP",
        }
        .assert_rejected()?;
        TextFixture {
            text: "AUTHENTICATORAPPLICATIONS",
        }
        .assert_rejected()?;
        TextFixture {
            text: "Authenticator Applications",
        }
        .assert_rejected()?;
        Ok(())
    }

    #[test]
    fn rejects_english_instructions_and_marketing_sentences() -> anyhow::Result<()> {
        for text in [
            "Scan this QR code to set up your account",
            "Popular choices include Google Authenticator",
            "Scan this code with your app",
            "Enter this code manually: Scan this code with your app",
            "Use an authenticator app",
            "Setup key",
        ] {
            TextFixture { text }.assert_rejected()?;
        }
        Ok(())
    }

    #[test]
    fn rejects_short_and_non_base32_values() -> anyhow::Result<()> {
        for text in [
            "",
            "Key:",
            "JBSWY3DP",
            "JBSW Y3DP",
            "JBSW Y3DP EHPK 3PX0",
            "JBSW Y3DP EHPK 3PX1",
            "JBSW Y3DP EHPK 3PX8",
            "JBSW Y3DP EHPK 3PX9",
            "JBSWY3DPEHPK3PXP!",
            "JBSWY3DPEHPK3PXP====",
            "JBSW_Y3DP_EHPK_3PXP",
            "JBSW  Y3DP EHPK 3PXP",
            "JBSW Y3DP EHPK 3PXP-",
            "JBSW\tY3DP\tEHPK\t3PXP",
            "JBSW\u{a0}Y3DP\u{a0}EHPK\u{a0}3PXP",
            "JBSW Y3DP EHPK 3PXPQ",
            "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP",
        ] {
            TextFixture { text }.assert_rejected()?;
        }
        Ok(())
    }

    #[test]
    fn removes_only_one_short_leading_label() -> anyhow::Result<()> {
        TextFixture {
            text: "Account: Key: JBSW Y3DP EHPK 3PXP",
        }
        .assert_rejected()?;
        let long_label = format!("{}: JBSW Y3DP EHPK 3PXP", "L".repeat(65));
        TextFixture { text: &long_label }.assert_rejected()?;
        let short_label = format!("{}: JBSW Y3DP EHPK 3PXP", "L".repeat(64));
        assert_eq!(
            TextFixture { text: &short_label }.canonical_key()?,
            "JBSWY3DPEHPK3PXP"
        );
        Ok(())
    }

    #[test]
    fn rejects_oversize_visible_text_before_classification() {
        let bounded = "A".repeat(MAX_SETUP_KEY_TEXT_BYTES);
        assert!(VisibleSetupKeyText::try_from(bounded).is_ok());
        let oversize = "A".repeat(MAX_SETUP_KEY_TEXT_BYTES + 1);
        assert!(matches!(
            VisibleSetupKeyText::try_from(oversize),
            Err(AuthenticatorEnrollmentError::SetupKeyTextTooLong)
        ));
    }
}
