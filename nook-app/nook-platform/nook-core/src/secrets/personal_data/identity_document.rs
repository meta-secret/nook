//! Identity document payload: passports, national IDs, driver's licenses,
//! US Social Security numbers, tax IDs, and memberships.

use super::calendar_date::DocumentDateEntry;
use super::personal_text::PersonalText;
use super::sensitive_number::SensitiveNumber;
use crate::ValidationError;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fmt;
use tsify::Tsify;
use zeroize::Zeroize;

/// Kind of identity document or membership.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum IdentityDocumentKind {
    Passport,
    NationalId,
    DriversLicense,
    /// US Social Security number.
    SocialSecurity,
    TaxId,
    Membership,
}

impl IdentityDocumentKind {
    /// Stable wire name (`passport`, `national-id`, `drivers-license`,
    /// `social-security`, `tax-id`, `membership`).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Passport => "passport",
            Self::NationalId => "national-id",
            Self::DriversLicense => "drivers-license",
            Self::SocialSecurity => "social-security",
            Self::TaxId => "tax-id",
            Self::Membership => "membership",
        }
    }
}

/// Encrypted identity-document plaintext payload (`camelCase` YAML).
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityDocumentSecret {
    pub kind: IdentityDocumentKind,
    /// Social Security numbers are stored as nine digits.
    pub number: String,
    /// Organization that issued the document or membership, or empty.
    pub issuer: String,
    pub issuing_country: String,
    /// ISO `YYYY-MM-DD` or month-only `YYYY-MM`, or empty.
    pub issue_date: String,
    /// ISO `YYYY-MM-DD` or month-only `YYYY-MM`, or empty; never before
    /// `issue_date` (compared by month when either side is month-only).
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
    pub issuer: &'a str,
    pub issuing_country: &'a str,
    pub issue_date: &'a str,
    pub expiry_date: &'a str,
    pub name_as_printed: &'a str,
}

/// US Social Security number digits.
const SSN_DIGITS: usize = 9;

impl IdentityDocumentSecret {
    /// Normalize and validate form or import fields into a stored payload.
    pub fn from_fields(request: IdentityDocumentFields<'_>) -> Result<Self, ValidationError> {
        let IdentityDocumentFields {
            kind,
            number,
            issuer,
            issuing_country,
            issue_date,
            expiry_date,
            name_as_printed,
        } = request;
        let number = PersonalText::parse(number)?
            .require(ValidationError::IdentityDocumentNumberRequired)?;
        let number = match kind {
            IdentityDocumentKind::SocialSecurity => {
                IdentityDocumentSecret::normalize_social_security_number(&number)?
            }
            IdentityDocumentKind::Passport
            | IdentityDocumentKind::NationalId
            | IdentityDocumentKind::DriversLicense
            | IdentityDocumentKind::TaxId
            | IdentityDocumentKind::Membership => number,
        };
        let issue_date = DocumentDateEntry::parse(issue_date)
            .map_err(|_| ValidationError::IdentityDocumentDateInvalid)?;
        let expiry_date = DocumentDateEntry::parse(expiry_date)
            .map_err(|_| ValidationError::IdentityDocumentDateInvalid)?;
        match expiry_date.chronology(issue_date) {
            Some(Ordering::Less) => return Err(ValidationError::IdentityDocumentExpiryBeforeIssue),
            Some(Ordering::Equal | Ordering::Greater) | None => {}
        }
        Ok(Self {
            kind,
            number,
            issuer: PersonalText::parse(issuer)?.into_string(),
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
            issuer: &self.issuer,
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
        self.issuer.zeroize();
        self.issuing_country.zeroize();
        self.issue_date.zeroize();
        self.expiry_date.zeroize();
        self.name_as_printed.zeroize();
    }
}

impl IdentityDocumentSecret {
    /// Nine digits after removing spaces and dashes, excluding area numbers
    /// 000, 666, and 900–999, group 00, and serial 0000 (never issued).
    fn normalize_social_security_number(raw: &str) -> Result<String, ValidationError> {
        let digits: String = raw
            .chars()
            .filter(|character| !character.is_whitespace() && *character != '-')
            .collect();
        let values: Vec<u32> = digits.chars().filter_map(|c| c.to_digit(10)).collect();
        let (area, rest) = values.split_at(values.len().min(3));
        let (group, serial) = rest.split_at(rest.len().min(2));
        let number = |part: &[u32]| part.iter().fold(0, |total, digit| total * 10 + digit);
        let well_formed = digits.chars().count() == SSN_DIGITS && values.len() == SSN_DIGITS;
        let issued =
            !matches!(number(area), 0 | 666 | 900..) && number(group) != 0 && number(serial) != 0;
        if well_formed && issued {
            Ok(digits)
        } else {
            Err(ValidationError::IdentityDocumentSsnInvalid)
        }
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
            issuer: "",
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
            (IdentityDocumentKind::SocialSecurity, "social-security"),
            (IdentityDocumentKind::TaxId, "tax-id"),
            (IdentityDocumentKind::Membership, "membership"),
        ] {
            assert_eq!(kind.as_str(), wire);
            assert_eq!(serde_json::to_string(&kind)?, format!("\"{wire}\""));
        }
        assert!(serde_json::from_str::<IdentityDocumentKind>("\"visa\"").is_err());
        Ok(())
    }

    #[test]
    fn social_security_numbers_are_nine_issued_digits() -> anyhow::Result<()> {
        let ssn = |number| {
            IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                kind: IdentityDocumentKind::SocialSecurity,
                number,
                issuing_country: "",
                issue_date: "",
                expiry_date: "",
                ..fields()
            })
        };
        let document = ssn(" 123-45-6789 ")?;
        assert_eq!(document.number, "123456789");
        assert_eq!(document.masked_number(), "•••• 6789");
        assert_eq!(ssn("123 45 6789")?.number, "123456789");
        for invalid in [
            "000-12-3456",
            "666-12-3456",
            "900-12-3456",
            "999-12-3456",
            "123-00-4567",
            "123-45-0000",
            "123-45-678",
            "123-45-67890",
            "12A-45-6789",
            "123.45.6789",
        ] {
            assert_eq!(
                ssn(invalid),
                Err(ValidationError::IdentityDocumentSsnInvalid),
                "{invalid}"
            );
        }
        assert_eq!(
            ssn(" "),
            Err(ValidationError::IdentityDocumentNumberRequired)
        );
        Ok(())
    }

    #[test]
    fn tax_ids_and_memberships_keep_trimmed_text_and_issuer() -> anyhow::Result<()> {
        let tax_id = IdentityDocumentSecret::from_fields(IdentityDocumentFields {
            kind: IdentityDocumentKind::TaxId,
            number: " DE 123 456 789 ",
            issuer: " Bundeszentralamt für Steuern ",
            issuing_country: "DE",
            issue_date: "",
            expiry_date: "",
            name_as_printed: "",
        })?;
        assert_eq!(tax_id.number, "DE 123 456 789");
        assert_eq!(tax_id.issuer, "Bundeszentralamt für Steuern");
        let membership = IdentityDocumentSecret::from_fields(IdentityDocumentFields {
            kind: IdentityDocumentKind::Membership,
            number: "M-0042",
            issuer: "Analytical Society",
            issuing_country: "",
            issue_date: "2019-05",
            expiry_date: "2031-05",
            name_as_printed: "Ada Lovelace",
        })?;
        assert_eq!(membership.issue_date, "2019-05");
        assert_eq!(
            IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                kind: IdentityDocumentKind::Membership,
                number: "",
                ..fields()
            }),
            Err(ValidationError::IdentityDocumentNumberRequired)
        );
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
        for (issue_date, expiry_date) in [
            ("2020-02-30", ""),
            ("", "2030-13-01"),
            ("15/01/2020", ""),
            ("", "2030-13"),
            ("", "30-12"),
            ("", "12/2030"),
        ] {
            assert_eq!(
                IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                    issue_date,
                    expiry_date,
                    ..fields()
                }),
                Err(ValidationError::IdentityDocumentDateInvalid)
            );
        }
        for (issue_date, expiry_date) in [
            ("2030-01-15", "2020-01-14"),
            ("2030-02", "2030-01-31"),
            ("2030-02-01", "2030-01"),
        ] {
            assert_eq!(
                IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                    issue_date,
                    expiry_date,
                    ..fields()
                }),
                Err(ValidationError::IdentityDocumentExpiryBeforeIssue),
                "{issue_date} {expiry_date}"
            );
        }
        let same_month = IdentityDocumentSecret::from_fields(IdentityDocumentFields {
            issue_date: "2030-01-15",
            expiry_date: "2030-01",
            ..fields()
        })?;
        assert_eq!(same_month.expiry_date, "2030-01");
        assert_eq!(same_month.issue_date, "2030-01-15");
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
        let mut document = IdentityDocumentSecret::from_fields(IdentityDocumentFields {
            issuer: "HM Passport Office",
            ..fields()
        })?;
        let debug = format!("{document:?}");
        assert_eq!(debug, "IdentityDocumentSecret { kind: Passport, .. }");
        document.zeroize_plaintext();
        assert!(document.number.is_empty());
        assert!(document.issuer.is_empty());
        assert!(document.issuing_country.is_empty());
        assert!(document.issue_date.is_empty());
        assert!(document.expiry_date.is_empty());
        assert!(document.name_as_printed.is_empty());
        Ok(())
    }
}
