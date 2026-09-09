//! Portable backup/recovery-code candidate extraction for auth companions.
//!
//! Browser adapters supply page text; this module owns which lines look like
//! recovery codes versus prose, URLs, or hint copy.

use crate::recovery_code_language::{AuthenticationCodeHint, AuthenticationCodeSubject};
use std::collections::BTreeSet;

/// Borrowed page copy used for recovery-code discovery and extraction.
pub struct BackupCodePageText<'a> {
    value: &'a str,
}
impl<'a> BackupCodePageText<'a> {
    pub fn new(value: &'a str) -> Self {
        Self { value }
    }
    fn as_str(&self) -> &'a str {
        self.value
    }
}
const MAX_CANDIDATES: usize = 64;
const MAX_CODE_LEN: usize = 64;
const MIN_CODE_LEN: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
enum BackupCodeCandidate {
    Accepted(String),
    Rejected,
}

/// True when the page text advertises backup/recovery codes.
impl BackupCodePageText<'_> {
    #[must_use]
    pub fn page_has_backup_code_hint(&self) -> bool {
        let text = self.as_str();
        BackupCodePageText::new(text).contains_recovery_hint()
    }
}

/// True when plaintext contains at least one recovery-code-shaped line.
///
/// This deliberately exposes only a boolean so pre-approval browser scans do
/// not receive or retain extracted secret candidates.
impl BackupCodePageText<'_> {
    #[must_use]
    pub fn contains_backup_code_candidate(&self) -> bool {
        let text = self.as_str();
        text.split(['\n', '\r']).any(|line| {
            BackupCodePageText::new(line).candidate_shape_matches()
                || line
                    .split(|character: char| {
                        !(character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
                    })
                    .any(|value| Self::new(value).candidate_shape_matches())
        })
    }
}

/// Extract unique backup-code-looking lines from plaintext page content.
impl BackupCodePageText<'_> {
    #[must_use]
    pub fn extract_backup_code_candidates(&self) -> Vec<String> {
        let text = self.as_str();
        let mut candidates = Vec::new();
        let mut seen = BTreeSet::new();
        for line in text.split(['\n', '\r']) {
            let BackupCodeCandidate::Accepted(value) =
                BackupCodePageText::new(line).normalize_candidate()
            else {
                continue;
            };
            if !seen.insert(value.clone()) {
                continue;
            }
            candidates.push(value);
            if candidates.len() >= MAX_CANDIDATES {
                break;
            }
        }
        candidates
    }
}

impl BackupCodePageText<'_> {
    fn normalize_candidate(&self) -> BackupCodeCandidate {
        let value = self.as_str();
        let trimmed = BackupCodePageText::new(value.trim()).collapse_whitespace();
        if !BackupCodePageText::new(&trimmed).candidate_shape_matches() {
            return BackupCodeCandidate::Rejected;
        }
        BackupCodeCandidate::Accepted(trimmed)
    }
}

impl BackupCodePageText<'_> {
    fn candidate_shape_matches(&self) -> bool {
        let value = self.as_str();
        let trimmed = value.trim();
        if trimmed.len() < MIN_CODE_LEN
            || trimmed.len() > MAX_CODE_LEN
            || !BackupCodePageText::new(trimmed).matches_code_line()
        {
            return false;
        }
        if trimmed.contains("://")
            || trimmed.contains('@')
            || trimmed.contains("  ")
            || BackupCodePageText::new(trimmed).contains_recovery_hint()
        {
            return false;
        }
        let mut words = trimmed.split(' ');
        let Some(first_word) = words.next() else {
            return false;
        };
        let second_word = words.next();
        if words.next().is_some() {
            return false;
        }
        if second_word.is_some_and(|word| {
            first_word.chars().all(|c| c.is_ascii_alphabetic())
                && word.chars().all(|c| c.is_ascii_alphabetic())
        }) {
            return false;
        }
        let compact_len = trimmed
            .chars()
            .filter(|c| !c.is_ascii_whitespace() && *c != '_' && *c != '-')
            .count();
        compact_len >= MIN_CODE_LEN
            && trimmed.chars().any(|c| c.is_ascii_digit())
            && !trimmed.to_ascii_lowercase().ends_with("-digit")
    }
}

impl BackupCodePageText<'_> {
    fn collapse_whitespace(&self) -> String {
        let value = self.as_str();
        let mut out = String::with_capacity(value.len());
        let mut previous_space = false;
        for c in value.chars() {
            if c.is_whitespace() {
                if !previous_space && !out.is_empty() {
                    out.push(' ');
                    previous_space = true;
                }
                continue;
            }
            previous_space = false;
            out.push(c);
        }
        out
    }
}

impl BackupCodePageText<'_> {
    fn matches_code_line(&self) -> bool {
        let value = self.as_str();
        let body = value
            .strip_prefix("- ")
            .or_else(|| value.strip_prefix("* "))
            .or_else(|| value.strip_prefix("• "))
            .unwrap_or(value);
        let bytes = body.as_bytes();
        if bytes.len() < MIN_CODE_LEN || bytes.len() > MAX_CODE_LEN {
            return false;
        }
        let Some((first, rest)) = bytes.split_first() else {
            return false;
        };
        if !first.is_ascii_alphanumeric() {
            return false;
        }
        let Some((last, middle)) = rest.split_last() else {
            return false;
        };
        if !last.is_ascii_alphanumeric() {
            return false;
        }
        // CODE_LINE middle is `{4,62}` of alnum/space/_/- for total body length 6..=64.
        if middle.len() < 4 || middle.len() > 62 {
            return false;
        }
        middle
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b' ' || *b == b'_' || *b == b'-')
    }
}

impl BackupCodePageText<'_> {
    fn contains_recovery_hint(&self) -> bool {
        matches!(
            AuthenticationCodeSubject::recognize_hint(self.as_str()),
            AuthenticationCodeHint::Observed(_)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_recovery_looking_lines_and_ignores_prose() {
        let text = [
            "Save your backup codes",
            "Keep these recovery codes safe.",
            "A1B2-C3D4-E5F6",
            "G7H8-I9J0-K1L2",
            "This sentence should not become a code.",
            "https://example.test/recovery",
            "alice@example.test",
        ]
        .join("\n");

        assert_eq!(
            BackupCodePageText::new(&text).extract_backup_code_candidates(),
            vec!["A1B2-C3D4-E5F6".to_owned(), "G7H8-I9J0-K1L2".to_owned()]
        );
    }

    #[test]
    fn recovery_hint_requires_codes_phrase_not_email_local_parts() {
        assert!(
            !BackupCodePageText::new("Email: alice-2fa@nook.test\nPassword: secret")
                .page_has_backup_code_hint()
        );
        assert!(
            BackupCodePageText::new("Save your backup codes\nA1B2-C3D4-E5F6")
                .page_has_backup_code_hint()
        );
        assert!(
            BackupCodePageText::new("Enable 2FA codes for your account")
                .page_has_backup_code_hint()
        );
    }

    #[test]
    fn candidate_detection_does_not_return_secret_material() {
        assert!(BackupCodePageText::new("A1B2-C3D4-E5F6").contains_backup_code_candidate());
        assert!(
            BackupCodePageText::new("Save your recovery codes: A1B2-C3D4-E5F6")
                .contains_backup_code_candidate()
        );
        assert!(BackupCodePageText::new("ABCD-EFGH-IJK1").contains_backup_code_candidate());
        assert!(
            !BackupCodePageText::new("Save your 8-digit backup codes")
                .contains_backup_code_candidate()
        );
        assert!(
            !BackupCodePageText::new("Save your backup codes").contains_backup_code_candidate()
        );
    }

    #[test]
    fn normalize_rejects_alpha_only_two_word_phrases() {
        assert!(matches!(
            BackupCodePageText::new("backup codes").normalize_candidate(),
            BackupCodeCandidate::Rejected
        ));
        assert!(matches!(
            BackupCodePageText::new("A1B2-C3D4-E5F6").normalize_candidate(),
            BackupCodeCandidate::Accepted(_)
        ));
    }
}
