//! Shared single-line text normalization for personal-data fields.

use crate::ValidationError;

/// Trimmed personal-data text: either absent (empty) or present.
#[derive(Clone, PartialEq, Eq)]
pub(super) enum PersonalText {
    Empty,
    Text(String),
}

impl PersonalText {
    /// Trim surrounding whitespace and reject embedded control characters.
    pub(super) fn parse(raw: &str) -> Result<Self, ValidationError> {
        let text = raw.trim();
        match (text.is_empty(), text.chars().any(char::is_control)) {
            (_, true) => Err(ValidationError::PersonalDataTextInvalid),
            (true, false) => Ok(Self::Empty),
            (false, false) => Ok(Self::Text(text.to_owned())),
        }
    }

    /// Normalized text, or the empty string for an absent optional field.
    pub(super) fn into_string(self) -> String {
        match self {
            Self::Empty => String::new(),
            Self::Text(text) => text,
        }
    }

    /// Normalized text for a field that must be present.
    pub(super) fn require(self, missing: ValidationError) -> Result<String, ValidationError> {
        match self {
            Self::Empty => Err(missing),
            Self::Text(text) => Ok(text),
        }
    }

    /// Join the present parts with one space (`Ada Augusta Lovelace`).
    pub(super) fn join_present<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
        parts
            .into_iter()
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::PersonalText;
    use crate::ValidationError;

    #[test]
    fn trims_and_classifies_empty_text() -> anyhow::Result<()> {
        assert!(PersonalText::parse("  ")? == PersonalText::Empty);
        assert!(PersonalText::parse(" Ada ")? == PersonalText::Text("Ada".to_owned()));
        assert_eq!(PersonalText::parse("")?.into_string(), "");
        Ok(())
    }

    #[test]
    fn rejects_embedded_control_characters() {
        for raw in ["Ada\nLovelace", "Ada\u{0}", "\u{7}bell", "tab\there"] {
            assert!(matches!(
                PersonalText::parse(raw),
                Err(ValidationError::PersonalDataTextInvalid)
            ));
        }
    }

    #[test]
    fn require_reports_the_supplied_missing_error() -> anyhow::Result<()> {
        assert_eq!(
            PersonalText::parse(" ")?.require(ValidationError::AddressLine1Required),
            Err(ValidationError::AddressLine1Required)
        );
        assert_eq!(
            PersonalText::parse(" 1 Main St ")?.require(ValidationError::AddressLine1Required),
            Ok("1 Main St".to_owned())
        );
        Ok(())
    }

    #[test]
    fn join_present_skips_blank_parts() {
        assert_eq!(
            PersonalText::join_present(["Ada", "", " Lovelace "]),
            "Ada Lovelace"
        );
        assert_eq!(PersonalText::join_present(["", " "]), "");
    }
}
