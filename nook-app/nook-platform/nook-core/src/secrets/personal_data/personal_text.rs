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
}

/// Trimmed, non-blank text parts joined by one separator
/// (`Ada Augusta Lovelace`, `Flat 3, Building B`).
pub(crate) struct PresentParts<'a> {
    pub(crate) parts: &'a [&'a str],
    pub(crate) separator: &'a str,
}

impl PresentParts<'_> {
    pub(crate) fn joined(&self) -> String {
        self.parts
            .iter()
            .map(|part| part.trim())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(self.separator)
    }
}

#[cfg(test)]
mod tests {
    use super::{PersonalText, PresentParts};
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
    fn present_parts_skip_blank_parts_and_use_the_separator() {
        assert_eq!(
            PresentParts {
                parts: &["Ada", "", " Lovelace "],
                separator: " ",
            }
            .joined(),
            "Ada Lovelace"
        );
        assert_eq!(
            PresentParts {
                parts: &[" Flat 3 ", "", "Building B"],
                separator: ", ",
            }
            .joined(),
            "Flat 3, Building B"
        );
        assert_eq!(
            PresentParts {
                parts: &["", " "],
                separator: " ",
            }
            .joined(),
            ""
        );
    }
}
