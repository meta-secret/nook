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
//!    hyphen, optionally followed directly by trailing `=` padding, which
//!    [`TotpSecret::parse`] also accepts. `0`/`1`/`8`/`9`, punctuation, other
//!    whitespace, interior padding, and leading, trailing, or doubled
//!    separators are rejected.
//! 3. **Letter case.** The key contains at least one letter, and all of its
//!    letters share one case. Services render a key entirely in upper or lower
//!    case; prose and brand names mix cases (`Office365 Business`), and a
//!    digit-only string (`2345 6723 4567 2345`) is a number, not a random key.
//! 4. **Grouping.** The key is either one ungrouped token, or at least
//!    [`MIN_KEY_GROUPS`] groups where every group except the last has the same
//!    length of [`MIN_GROUP_CHARS`]–[`MAX_GROUP_CHARS`] characters and the last
//!    is not longer. Two-word phrases (`WELCOME25 PROMOCODE`) and sentences of
//!    varying-length words fail this.
//! 5. **Key evidence.** The key contains at least one Base32 digit (`2`–`7`),
//!    or its compact form has at least [`DIGITLESS_MIN_CHARS`] characters.
//! 6. **Key.** [`TotpSecret::parse`] accepts the remainder (at least 10 decoded
//!    bytes), which also performs the canonical normalization.
//!
//! Rule 5 applies to grouped and ungrouped text alike, because uniform word
//! lengths alone do not exclude prose: "scan this code with your app" groups
//! as 4-4-4-4-4-3 letters. English words and short phrases rarely contain
//! digits and never reach 26 letters with uniform grouping.
//!
//! **Tradeoffs.** A random key whose characters happen to be letters only and
//! whose compact length is below 26 is not detected: about 3.6 % of 16-character
//! keys and effectively no 32-character keys. A 16-character key displayed as
//! two 8-character groups is not detected either. The user can still add such
//! keys through the manual form. A single-case ungrouped token of at least 16
//! Base32 characters containing a digit (`WELCOME25PROMOCODE`) is accepted;
//! it must still decode to a valid key, and the user reviews every candidate
//! before save.
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
/// Fewest groups in a grouped key; two-word phrases are not keys.
const MIN_KEY_GROUPS: usize = 3;
/// Length bounds of each full group in a grouped key.
const MIN_GROUP_CHARS: usize = 4;
const MAX_GROUP_CHARS: usize = 8;

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

#[derive(Clone, Copy)]
enum DigitPresence {
    Present,
    Absent,
}

/// The case of the letters seen so far.
#[derive(Clone, Copy)]
enum LetterCase {
    Absent,
    Upper,
    Lower,
    Mixed,
}

impl LetterCase {
    const fn with_upper(self) -> Self {
        match self {
            Self::Absent | Self::Upper => Self::Upper,
            Self::Lower | Self::Mixed => Self::Mixed,
        }
    }

    const fn with_lower(self) -> Self {
        match self {
            Self::Absent | Self::Lower => Self::Lower,
            Self::Upper | Self::Mixed => Self::Mixed,
        }
    }
}

/// Whether the scan is still reading key characters or only trailing padding.
#[derive(Clone, Copy)]
enum ScanPhase {
    Key,
    Padding,
}

/// Group lengths of grammatically valid Base32 text, without the characters.
struct KeyGroups {
    lengths: Vec<usize>,
    digits: DigitPresence,
    letters: LetterCase,
}

enum GroupScan {
    Base32(KeyGroups),
    NotBase32,
}

/// Incremental grammar scan; it records lengths and classes, never characters.
struct KeyScan {
    lengths: Vec<usize>,
    current: usize,
    digits: DigitPresence,
    letters: LetterCase,
    phase: ScanPhase,
}

enum ScanProgress {
    Scanning(KeyScan),
    NotBase32,
}

enum GroupShape {
    Ungrouped,
    UniformGroups,
    Irregular,
}

enum KeyEvidence {
    Sufficient,
    Insufficient,
}

impl KeyScan {
    const fn new() -> Self {
        Self {
            lengths: Vec::new(),
            current: 0,
            digits: DigitPresence::Absent,
            letters: LetterCase::Absent,
            phase: ScanPhase::Key,
        }
    }

    fn with_character(mut self, character: char) -> ScanProgress {
        match self.phase {
            ScanPhase::Padding => match character {
                '=' => ScanProgress::Scanning(self),
                _ => ScanProgress::NotBase32,
            },
            ScanPhase::Key => match character {
                'A'..='Z' => {
                    self.current += 1;
                    self.letters = self.letters.with_upper();
                    ScanProgress::Scanning(self)
                }
                'a'..='z' => {
                    self.current += 1;
                    self.letters = self.letters.with_lower();
                    ScanProgress::Scanning(self)
                }
                '2'..='7' => {
                    self.current += 1;
                    self.digits = DigitPresence::Present;
                    ScanProgress::Scanning(self)
                }
                ' ' | '-' => self.with_completed_group(ScanPhase::Key),
                '=' => self.with_completed_group(ScanPhase::Padding),
                _ => ScanProgress::NotBase32,
            },
        }
    }

    fn with_completed_group(mut self, phase: ScanPhase) -> ScanProgress {
        match self.current {
            0 => ScanProgress::NotBase32,
            length => {
                self.lengths.push(length);
                self.current = 0;
                self.phase = phase;
                ScanProgress::Scanning(self)
            }
        }
    }

    fn finish(mut self) -> GroupScan {
        match self.phase {
            ScanPhase::Padding => {}
            ScanPhase::Key => match self.current {
                0 => return GroupScan::NotBase32,
                length => self.lengths.push(length),
            },
        }
        GroupScan::Base32(KeyGroups {
            lengths: self.lengths,
            digits: self.digits,
            letters: self.letters,
        })
    }
}

impl KeyGroups {
    fn scan(text: &str) -> GroupScan {
        let mut scan = KeyScan::new();
        for character in text.chars() {
            scan = match scan.with_character(character) {
                ScanProgress::Scanning(next) => next,
                ScanProgress::NotBase32 => return GroupScan::NotBase32,
            };
        }
        scan.finish()
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
            return GroupShape::Ungrouped;
        };
        match self.lengths.len() >= MIN_KEY_GROUPS
            && (MIN_GROUP_CHARS..=MAX_GROUP_CHARS).contains(first)
            && rest.iter().all(|length| length == first)
            && last <= first
        {
            true => GroupShape::UniformGroups,
            false => GroupShape::Irregular,
        }
    }

    fn evidence(&self) -> KeyEvidence {
        match self.letters {
            LetterCase::Absent | LetterCase::Mixed => return KeyEvidence::Insufficient,
            LetterCase::Upper | LetterCase::Lower => {}
        }
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
            GroupShape::Ungrouped | GroupShape::UniformGroups => match self.evidence() {
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
    fn accepts_eight_by_four_eight_char_and_ungrouped_keys() -> anyhow::Result<()> {
        for (text, canonical) in [
            (
                "GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ",
                "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
            ),
            ("gezdgnbv-gy3tqojq-gezdgnbv", "GEZDGNBVGY3TQOJQGEZDGNBV"),
            ("JBSWY3DPEHPK3PXP", "JBSWY3DPEHPK3PXP"),
        ] {
            assert_eq!(TextFixture { text }.canonical_key()?, canonical, "{text:?}");
        }
        Ok(())
    }

    #[test]
    fn rejects_short_prose_brand_names_and_digit_only_numbers() -> anyhow::Result<()> {
        for text in [
            "Authentication 2FA",
            "Configuration 2FA",
            "Office365 Business",
            "Microsoft365 Account",
            "WELCOME25 PROMOCODE",
            "2345 6723 4567 2345",
            "23456723456723456723456723",
            "JbSw Y3dP EhPk 3pXp",
            "JBSWY3DP EHPK3PXP",
            "JBS Y3D EHP 3PX PQR S",
            "JBSWY3DPE HPK3PXPQR STUVWXYZ2",
        ] {
            TextFixture { text }.assert_rejected()?;
        }
        Ok(())
    }

    #[test]
    fn accepts_terminal_padding_and_rejects_misplaced_padding() -> anyhow::Result<()> {
        for text in [
            "JBSWY3DPEHPK3PXP====",
            "JBSW Y3DP EHPK 3PXP====",
            "Key: jbsw-y3dp-ehpk-3pxp=",
        ] {
            assert_eq!(
                TextFixture { text }.canonical_key()?,
                "JBSWY3DPEHPK3PXP",
                "{text:?}"
            );
        }
        for text in [
            "====",
            "JBSW=Y3DP EHPK 3PXP",
            "JBSW Y3DP EHPK 3PXP =",
            "JBSW Y3DP EHPK 3PXP==Q",
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
