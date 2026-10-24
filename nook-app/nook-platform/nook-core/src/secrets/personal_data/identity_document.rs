//! Identity document payload: passports, national IDs, and driver's licenses.

use super::calendar_date::DateEntry;
use super::personal_text::PersonalText;
use super::sensitive_number::SensitiveNumber;
use crate::ValidationError;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fmt;
use tsify::Tsify;
use zeroize::Zeroize;

/// Kind of government-issued identity document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum IdentityDocumentKind {
    Passport,
    NationalId,
    DriversLicense,
}

impl IdentityDocumentKind {
    /// Stable wire name (`passport`, `national-id`, `drivers-license`).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Passport => "passport",
            Self::NationalId => "national-id",
            Self::DriversLicense => "drivers-license",
        }
    }
}

/// Encrypted identity-document plaintext payload (`camelCase` YAML).
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityDocumentSecret {
    pub kind: IdentityDocumentKind,
    pub number: String,
    pub issuing_country: String,
    /// ISO `YYYY-MM-DD`, or empty.
    pub issue_date: String,
    /// ISO `YYYY-MM-DD`, or empty; never before `issue_date`.
    pub expiry_date: String,
    pub name_as_printed: String,
}

impl fmt::Debug for IdentityDocumentSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IdentityDocumentSecret")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

/// Named values required by `IdentityDocumentSecret::from_fields`.
#[derive(Clone, Copy)]
pub struct IdentityDocumentFields<'a> {
    pub kind: IdentityDocumentKind,
    pub number: &'a str,
    pub issuing_country: &'a str,
    pub issue_date: &'a str,
    pub expiry_date: &'a str,
    pub name_as_printed: &'a str,
}

impl IdentityDocumentSecret {
    /// Normalize and validate form or import fields into a stored payload.
    pub fn from_fields(request: IdentityDocumentFields<'_>) -> Result<Self, ValidationError> {
        let IdentityDocumentFields {
            kind,
            number,
            issuing_country,
            issue_date,
            expiry_date,
            name_as_printed,
        } = request;
        let number = PersonalText::parse(number)?
            .require(ValidationError::IdentityDocumentNumberRequired)?;
        let issue_date = DateEntry::parse(issue_date)
            .map_err(|_| ValidationError::IdentityDocumentDateInvalid)?;
        let expiry_date = DateEntry::parse(expiry_date)
            .map_err(|_| ValidationError::IdentityDocumentDateInvalid)?;
        if let (DateEntry::Date(issued), DateEntry::Date(expires)) = (issue_date, expiry_date) {
            match expires.cmp(&issued) {
                Ordering::Less => return Err(ValidationError::IdentityDocumentExpiryBeforeIssue),
                Ordering::Equal | Ordering::Greater => {}
            }
        }
        Ok(Self {
            kind,
            number,
            issuing_country: PersonalText::parse(issuing_country)?.into_string(),
            issue_date: issue_date.into_string(),
            expiry_date: expiry_date.into_string(),
            name_as_printed: PersonalText::parse(name_as_printed)?.into_string(),
        })
    }

    /// Re-validate a deserialized payload (import / decrypt path).
    pub fn normalize(self) -> Result<Self, ValidationError> {
        Self::from_fields(self.fields())
    }

    /// Borrow the stored values as validation input.
    #[must_use]
    pub fn fields(&self) -> IdentityDocumentFields<'_> {
        IdentityDocumentFields {
            kind: self.kind,
            number: &self.number,
            issuing_country: &self.issuing_country,
            issue_date: &self.issue_date,
            expiry_date: &self.expiry_date,
            name_as_printed: &self.name_as_printed,
        }
    }

    /// Trailing document-number characters for safe list display.
    #[must_use]
    pub fn last4(&self) -> String {
        SensitiveNumber::new(&self.number).last4()
    }

    /// Masked document number for list rows and default detail (`•••• 4567`).
    #[must_use]
    pub fn masked_number(&self) -> String {
        SensitiveNumber::new(&self.number).masked()
    }

    pub fn zeroize_plaintext(&mut self) {
        self.number.zeroize();
        self.issuing_country.zeroize();
        self.issue_date.zeroize();
        self.expiry_date.zeroize();
        self.name_as_printed.zeroize();
    }
}

impl Zeroize for IdentityDocumentSecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

#[cfg(test)]
mod tests {
    use super::{IdentityDocumentFields, IdentityDocumentKind, IdentityDocumentSecret};
    use crate::ValidationError;

    fn fields() -> IdentityDocumentFields<'static> {
        IdentityDocumentFields {
            kind: IdentityDocumentKind::Passport,
            number: " X1234567 ",
            issuing_country: "GB",
            issue_date: "2020-01-15",
            expiry_date: "2030-01-14",
            name_as_printed: "ADA LOVELACE",
        }
    }

    #[test]
    fn normalizes_fields_and_masks_number() -> anyhow::Result<()> {
        let document = IdentityDocumentSecret::from_fields(fields())?;
        assert_eq!(document.number, "X1234567");
        assert_eq!(document.last4(), "4567");
        assert_eq!(document.masked_number(), "•••• 4567");
        assert_eq!(document.clone().normalize()?, document);
        Ok(())
    }

    #[test]
    fn kind_uses_kebab_case_wire_names() -> anyhow::Result<()> {
        for (kind, wire) in [
            (IdentityDocumentKind::Passport, "passport"),
            (IdentityDocumentKind::NationalId, "national-id"),
            (IdentityDocumentKind::DriversLicense, "drivers-license"),
        ] {
            assert_eq!(kind.as_str(), wire);
            assert_eq!(serde_json::to_string(&kind)?, format!("\"{wire}\""));
        }
        assert!(serde_json::from_str::<IdentityDocumentKind>("\"visa\"").is_err());
        Ok(())
    }

    #[test]
    fn requires_number_and_valid_ordered_dates() -> anyhow::Result<()> {
        assert_eq!(
            IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                number: " ",
                ..fields()
            }),
            Err(ValidationError::IdentityDocumentNumberRequired)
        );
        for (issue_date, expiry_date) in
            [("2020-02-30", ""), ("", "2030-13-01"), ("15/01/2020", "")]
        {
            assert_eq!(
                IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                    issue_date,
                    expiry_date,
                    ..fields()
                }),
                Err(ValidationError::IdentityDocumentDateInvalid)
            );
        }
        assert_eq!(
            IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                issue_date: "2030-01-15",
                expiry_date: "2020-01-14",
                ..fields()
            }),
            Err(ValidationError::IdentityDocumentExpiryBeforeIssue)
        );
        let same_day = IdentityDocumentSecret::from_fields(IdentityDocumentFields {
            issue_date: "2030-01-15",
            expiry_date: "2030-01-15",
            ..fields()
        })?;
        assert_eq!(same_day.expiry_date, "2030-01-15");
        let undated = IdentityDocumentSecret::from_fields(IdentityDocumentFields {
            issue_date: "",
            expiry_date: "",
            ..fields()
        })?;
        assert!(undated.issue_date.is_empty());
        Ok(())
    }

    #[test]
    fn debug_shows_only_kind_and_zeroize_clears_fields() -> anyhow::Result<()> {
        let mut document = IdentityDocumentSecret::from_fields(fields())?;
        let debug = format!("{document:?}");
        assert_eq!(debug, "IdentityDocumentSecret { kind: Passport, .. }");
        document.zeroize_plaintext();
        assert!(document.number.is_empty());
        assert!(document.issuing_country.is_empty());
        assert!(document.issue_date.is_empty());
        assert!(document.expiry_date.is_empty());
        assert!(document.name_as_printed.is_empty());
        Ok(())
    }
}
