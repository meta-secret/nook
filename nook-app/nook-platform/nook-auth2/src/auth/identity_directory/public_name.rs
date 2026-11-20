//! A keyring label explicitly disclosed in its signed control log.
use serde::{Deserialize, Serialize};

const MAX_LABEL_CHARS: usize = 80;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String")]
pub struct PublicKeyringLabel(String);

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PublicKeyringLabelError {
    #[error("A keyring name cannot be empty.")]
    Empty,
    #[error("A keyring name cannot exceed 80 characters.")]
    TooLong,
    #[error("A keyring name cannot contain control characters.")]
    ControlCharacter,
    #[error("A signed keyring name must be trimmed.")]
    Untrimmed,
}

impl PublicKeyringLabel {
    /// Normalize explicit user input before it becomes signed data.
    pub fn parse(raw: &str) -> Result<Self, PublicKeyringLabelError> {
        Self::try_from(raw.trim().to_owned())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for PublicKeyringLabel {
    type Error = PublicKeyringLabelError;

    /// Validate a signed wire value without altering the signed bytes.
    fn try_from(label: String) -> Result<Self, Self::Error> {
        match label.as_str() {
            "" => Err(Self::Error::Empty),
            name if name.trim() != name => Err(Self::Error::Untrimmed),
            name if name.chars().count() > MAX_LABEL_CHARS => Err(Self::Error::TooLong),
            name if name.chars().any(char::is_control) => Err(Self::Error::ControlCharacter),
            _ => Ok(Self(label)),
        }
    }
}

/// The verified readable name, independent of any sealed legacy name.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum IdentityPublicName {
    #[default]
    Unpublished,
    Published(PublicKeyringLabel),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_is_trimmed_but_wire_values_are_never_rewritten() -> anyhow::Result<()> {
        let label = PublicKeyringLabel::parse("  Work  ")?;
        assert_eq!(label.as_str(), "Work");
        assert_eq!(serde_json::to_string(&label)?, "\"Work\"");
        assert_eq!(
            serde_json::from_str::<PublicKeyringLabel>("\"Work\"")?,
            label
        );
        assert!(serde_json::from_str::<PublicKeyringLabel>("\" Work \"").is_err());
        Ok(())
    }

    #[test]
    fn names_are_nonblank_bounded_unicode_without_controls() -> anyhow::Result<()> {
        assert_eq!(
            PublicKeyringLabel::parse(" \t "),
            Err(PublicKeyringLabelError::Empty)
        );
        assert_eq!(
            PublicKeyringLabel::parse("a\nb"),
            Err(PublicKeyringLabelError::ControlCharacter)
        );
        let at_limit = "家".repeat(MAX_LABEL_CHARS);
        assert_eq!(PublicKeyringLabel::parse(&at_limit)?.as_str(), at_limit);
        assert_eq!(
            PublicKeyringLabel::parse(&(at_limit + "庭")),
            Err(PublicKeyringLabelError::TooLong)
        );
        Ok(())
    }
}
