//! Masked projections of card, document, and account numbers.

/// A number whose list and default-detail projections reveal only a short tail.
///
/// The visible tail is at most four characters and never more than half of the
/// number, so short document numbers are not disclosed in full by a list row.
#[derive(Clone, Copy)]
pub(crate) struct SensitiveNumber<'a> {
    number: &'a str,
}

const MASK: &str = "••••";
const MAX_VISIBLE_TAIL: usize = 4;

impl<'a> SensitiveNumber<'a> {
    pub(crate) fn new(number: &'a str) -> Self {
        Self { number }
    }

    /// Last visible characters for safe list display (`4242`).
    pub(crate) fn last4(self) -> String {
        let characters = self.number.chars().count();
        let visible = MAX_VISIBLE_TAIL.min(characters / 2);
        self.number.chars().skip(characters - visible).collect()
    }

    /// Masked number for collapsed UI (`•••• 4242`).
    pub(crate) fn masked(self) -> String {
        SensitiveNumber::masked_tail(&self.last4())
    }

    /// Mask an already-projected tail (`•••• 4242`, or `••••` without a tail).
    pub(crate) fn masked_tail(last4: &str) -> String {
        if last4.is_empty() {
            MASK.to_owned()
        } else {
            format!("{MASK} {last4}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SensitiveNumber;

    #[test]
    fn long_numbers_reveal_only_four_trailing_characters() {
        let card = SensitiveNumber::new("4111111111111111");
        assert_eq!(card.last4(), "1111");
        assert_eq!(card.masked(), "•••• 1111");
        let iban = SensitiveNumber::new("GB82WEST12345698765432");
        assert_eq!(iban.last4(), "5432");
        assert_eq!(iban.masked(), "•••• 5432");
    }

    #[test]
    fn short_numbers_reveal_at_most_half() {
        assert_eq!(SensitiveNumber::new("AB1234").last4(), "234");
        assert_eq!(SensitiveNumber::new("1234").last4(), "34");
        assert_eq!(SensitiveNumber::new("7").last4(), "");
        assert_eq!(SensitiveNumber::new("7").masked(), "••••");
        assert_eq!(SensitiveNumber::new("").masked(), "••••");
    }
}
