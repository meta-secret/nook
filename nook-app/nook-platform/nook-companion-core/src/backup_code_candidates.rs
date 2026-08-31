//! Portable backup/recovery-code candidate extraction for auth companions.
//!
//! Browser adapters supply page text; this module owns which lines look like
//! recovery codes versus prose, URLs, or hint copy.

const MAX_CANDIDATES: usize = 64;
const MAX_CODE_LEN: usize = 64;
const MIN_CODE_LEN: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
enum BackupCodeCandidate {
    Accepted(String),
    Rejected,
}

/// True when the page text advertises backup/recovery codes.
#[must_use]
pub fn page_has_backup_code_hint(text: &str) -> bool {
    contains_recovery_hint(text)
}

/// True when plaintext contains at least one recovery-code-shaped line.
///
/// This deliberately exposes only a boolean so pre-approval browser scans do
/// not receive or retain extracted secret candidates.
#[must_use]
pub fn contains_backup_code_candidate(text: &str) -> bool {
    text.split(['\n', '\r']).any(|line| {
        candidate_shape_matches(line)
            || line
                .split(|character: char| {
                    !(character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
                })
                .any(candidate_shape_matches)
    })
}

/// Extract unique backup-code-looking lines from plaintext page content.
#[must_use]
pub fn extract_backup_code_candidates(text: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for line in text.split(['\n', '\r']) {
        let BackupCodeCandidate::Accepted(value) = normalize_candidate(line) else {
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

fn normalize_candidate(value: &str) -> BackupCodeCandidate {
    let trimmed = collapse_whitespace(value.trim());
    if !candidate_shape_matches(&trimmed) {
        return BackupCodeCandidate::Rejected;
    }
    BackupCodeCandidate::Accepted(trimmed)
}

fn candidate_shape_matches(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.len() < MIN_CODE_LEN || trimmed.len() > MAX_CODE_LEN || !matches_code_line(trimmed) {
        return false;
    }
    if trimmed.contains("://")
        || trimmed.contains('@')
        || trimmed.contains("  ")
        || contains_recovery_hint(trimmed)
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
    compact_len >= MIN_CODE_LEN && trimmed.chars().any(|c| c.is_ascii_digit())
}

fn collapse_whitespace(value: &str) -> String {
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

fn matches_code_line(value: &str) -> bool {
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

fn contains_recovery_hint(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let needles = [
        "backup code",
        "backup codes",
        "recovery code",
        "recovery codes",
        "one-time code",
        "one-time codes",
        "one time code",
        "one time codes",
        "emergency code",
        "emergency codes",
        "2fa code",
        "2fa codes",
        "mfa code",
        "mfa codes",
        "authenticator code",
        "authenticator codes",
    ];
    needles
        .iter()
        .any(|needle| contains_word_phrase(&lower, needle))
}

fn contains_word_phrase(haystack: &str, phrase: &str) -> bool {
    let Some(mut start) = haystack.find(phrase) else {
        return false;
    };
    loop {
        let end = start + phrase.len();
        let before_ok = start == 0
            || !haystack
                .as_bytes()
                .get(start - 1)
                .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_');
        let after_ok = end >= haystack.len()
            || !haystack
                .as_bytes()
                .get(end)
                .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_');
        if before_ok && after_ok {
            return true;
        }
        let next = haystack[start + 1..]
            .find(phrase)
            .map(|offset| start + 1 + offset);
        match next {
            Some(index) => start = index,
            None => return false,
        }
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
            extract_backup_code_candidates(&text),
            vec!["A1B2-C3D4-E5F6".to_owned(), "G7H8-I9J0-K1L2".to_owned()]
        );
    }

    #[test]
    fn recovery_hint_requires_codes_phrase_not_email_local_parts() {
        assert!(!page_has_backup_code_hint(
            "Email: alice-2fa@nook.test\nPassword: secret"
        ));
        assert!(page_has_backup_code_hint(
            "Save your backup codes\nA1B2-C3D4-E5F6"
        ));
        assert!(page_has_backup_code_hint(
            "Enable 2FA codes for your account"
        ));
    }

    #[test]
    fn candidate_detection_does_not_return_secret_material() {
        assert!(contains_backup_code_candidate("A1B2-C3D4-E5F6"));
        assert!(contains_backup_code_candidate(
            "Save your recovery codes: A1B2-C3D4-E5F6"
        ));
        assert!(contains_backup_code_candidate("ABCD-EFGH-IJK1"));
        assert!(!contains_backup_code_candidate(
            "Save your 8-digit backup codes"
        ));
        assert!(!contains_backup_code_candidate("Save your backup codes"));
    }

    #[test]
    fn normalize_rejects_alpha_only_two_word_phrases() {
        assert!(matches!(
            normalize_candidate("backup codes"),
            BackupCodeCandidate::Rejected
        ));
        assert!(matches!(
            normalize_candidate("A1B2-C3D4-E5F6"),
            BackupCodeCandidate::Accepted(_)
        ));
    }
}
