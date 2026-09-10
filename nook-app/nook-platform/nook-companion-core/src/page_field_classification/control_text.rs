//! Borrowed authentication text and its lexical matching vocabulary.
pub struct AuthenticationControlText<'a> {
    value: &'a str,
}
impl<'a> AuthenticationControlText<'a> {
    pub(super) fn as_str(&self) -> &'a str {
        self.value
    }
    #[must_use]
    pub fn new(value: &'a str) -> Self {
        Self { value }
    }
}
impl AuthenticationControlText<'_> {
    #[must_use]
    pub fn expand_identity_text(&self) -> String {
        let value = self.value;
        let mut with_breaks = String::with_capacity(value.len() * 2);
        let chars: Vec<char> = value.chars().collect();
        for (index, c) in chars.iter().enumerate() {
            if index > 0 {
                let prev = chars[index - 1];
                let needs_break = (prev.is_ascii_lowercase() && c.is_ascii_uppercase())
                    || (prev.is_ascii_alphabetic() && c.is_ascii_digit())
                    || (prev.is_ascii_digit() && c.is_ascii_alphabetic());
                if needs_break {
                    with_breaks.push(' ');
                }
            }
            if matches!(*c, '_' | '-' | '.' | '/' | '#') {
                with_breaks.push(' ');
            } else {
                with_breaks.push(*c);
            }
        }
        with_breaks
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase()
    }
    pub(crate) fn contains_any_word(&self, needles: &[&str]) -> bool {
        let haystack = self.value;
        needles
            .iter()
            .any(|needle| AuthenticationControlText::new(haystack).contains_word_phrase(needle))
    }
    pub(crate) fn contains_word_phrase(&self, phrase: &str) -> bool {
        let haystack = self.value;
        let Some(mut start) = haystack.find(phrase) else {
            return false;
        };
        loop {
            let end = start + phrase.len();
            let before_ok = start == 0
                || !haystack
                    .as_bytes()
                    .get(start - 1)
                    .copied()
                    .is_some_and(Self::is_word_byte);
            let after_ok = end >= haystack.len()
                || !haystack
                    .as_bytes()
                    .get(end)
                    .copied()
                    .is_some_and(Self::is_word_byte);
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
    const fn is_word_byte(byte: u8) -> bool {
        byte.is_ascii_alphanumeric() || byte == b'_'
    }
}
