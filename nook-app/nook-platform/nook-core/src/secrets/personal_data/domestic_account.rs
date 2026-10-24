//! US domestic bank account payload: account number with ABA routing number.

use super::personal_text::PersonalText;
use super::sensitive_number::SensitiveNumber;
use crate::ValidationError;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::RangeInclusive;
use zeroize::Zeroize;

/// Encrypted domestic-account plaintext payload (`camelCase` YAML).
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DomesticAccountSecret {
    pub account_holder: String,
    pub bank_name: String,
    /// 4–17 digits without spaces or dashes.
    pub account_number: String,
    /// Nine-digit ABA routing number passing the 3-7-1 checksum.
    pub routing_number: String,
}

impl fmt::Debug for DomesticAccountSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DomesticAccountSecret")
            .finish_non_exhaustive()
    }
}

/// Named values required by `DomesticAccountSecret::from_fields`.
#[derive(Clone, Copy)]
pub struct DomesticAccountFields<'a> {
    pub account_holder: &'a str,
    pub bank_name: &'a str,
    pub account_number: &'a str,
    pub routing_number: &'a str,
}

/// US ACH account numbers carry up to 17 digits.
const ACCOUNT_NUMBER_DIGITS: RangeInclusive<usize> = 4..=17;
const ROUTING_NUMBER_DIGITS: usize = 9;
/// ABA checksum weights applied to digits 1–9.
const ROUTING_WEIGHTS: [u32; ROUTING_NUMBER_DIGITS] = [3, 7, 1, 3, 7, 1, 3, 7, 1];

impl DomesticAccountSecret {
    /// Normalize and validate form or import fields into a stored payload.
    pub fn from_fields(request: DomesticAccountFields<'_>) -> Result<Self, ValidationError> {
        let DomesticAccountFields {
            account_holder,
            bank_name,
            account_number,
            routing_number,
        } = request;
        Ok(Self {
            account_holder: PersonalText::parse(account_holder)?.into_string(),
            bank_name: PersonalText::parse(bank_name)?.into_string(),
            account_number: DomesticAccountSecret::normalize_account_number(account_number)?,
            routing_number: DomesticAccountSecret::normalize_routing_number(routing_number)?,
        })
    }

    /// Re-validate a deserialized payload (import / decrypt path).
    pub fn normalize(self) -> Result<Self, ValidationError> {
        Self::from_fields(self.fields())
    }

    /// Borrow the stored values as validation input.
    #[must_use]
    pub fn fields(&self) -> DomesticAccountFields<'_> {
        DomesticAccountFields {
            account_holder: &self.account_holder,
            bank_name: &self.bank_name,
            account_number: &self.account_number,
            routing_number: &self.routing_number,
        }
    }

    /// Trailing account-number digits for safe list display.
    #[must_use]
    pub fn last4(&self) -> String {
        SensitiveNumber::new(&self.account_number).last4()
    }

    /// Masked account number for list rows and default detail (`•••• 6789`).
    #[must_use]
    pub fn masked_number(&self) -> String {
        SensitiveNumber::new(&self.account_number).masked()
    }

    pub fn zeroize_plaintext(&mut self) {
        self.account_holder.zeroize();
        self.bank_name.zeroize();
        self.account_number.zeroize();
        self.routing_number.zeroize();
    }
}

impl Zeroize for DomesticAccountSecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

impl DomesticAccountSecret {
    fn normalize_account_number(raw: &str) -> Result<String, ValidationError> {
        let digits = DomesticAccountSecret::strip_separators(raw);
        if digits.is_empty() {
            return Err(ValidationError::DomesticAccountNumberRequired);
        }
        if ACCOUNT_NUMBER_DIGITS.contains(&digits.len())
            && digits.bytes().all(|byte| byte.is_ascii_digit())
        {
            Ok(digits)
        } else {
            Err(ValidationError::DomesticAccountNumberInvalid)
        }
    }

    /// Nine digits whose 3-7-1 weighted sum is a multiple of ten.
    fn normalize_routing_number(raw: &str) -> Result<String, ValidationError> {
        let digits = DomesticAccountSecret::strip_separators(raw);
        if digits.is_empty() {
            return Err(ValidationError::RoutingNumberRequired);
        }
        let values: Vec<u32> = digits.chars().filter_map(|c| c.to_digit(10)).collect();
        let checksum: u32 = values
            .iter()
            .zip(ROUTING_WEIGHTS)
            .map(|(digit, weight)| digit * weight)
            .sum();
        if digits.chars().count() == ROUTING_NUMBER_DIGITS
            && values.len() == ROUTING_NUMBER_DIGITS
            && checksum.is_multiple_of(10)
        {
            Ok(digits)
        } else {
            Err(ValidationError::RoutingNumberInvalid)
        }
    }

    fn strip_separators(raw: &str) -> String {
        raw.chars()
            .filter(|character| !character.is_whitespace() && *character != '-')
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{DomesticAccountFields, DomesticAccountSecret};
    use crate::ValidationError;

    fn fields() -> DomesticAccountFields<'static> {
        DomesticAccountFields {
            account_holder: " Ada Lovelace ",
            bank_name: "Federal Bank",
            account_number: "0001-2345 6789",
            routing_number: "0210-0002-1",
        }
    }

    #[test]
    fn normalizes_separators_and_masks_the_account_number() -> anyhow::Result<()> {
        let account = DomesticAccountSecret::from_fields(fields())?;
        assert_eq!(account.account_holder, "Ada Lovelace");
        assert_eq!(account.account_number, "000123456789");
        assert_eq!(account.routing_number, "021000021");
        assert_eq!(account.last4(), "6789");
        assert_eq!(account.masked_number(), "•••• 6789");
        assert_eq!(account.clone().normalize()?, account);
        Ok(())
    }

    #[test]
    fn account_number_requires_4_to_17_digits() -> anyhow::Result<()> {
        for account_number in ["1234", "12345678901234567"] {
            let account = DomesticAccountSecret::from_fields(DomesticAccountFields {
                account_number,
                ..fields()
            })?;
            assert_eq!(account.account_number, account_number);
        }
        for account_number in ["123", "123456789012345678", "12345A789", "1234.5678"] {
            assert_eq!(
                DomesticAccountSecret::from_fields(DomesticAccountFields {
                    account_number,
                    ..fields()
                }),
                Err(ValidationError::DomesticAccountNumberInvalid),
                "{account_number}"
            );
        }
        assert_eq!(
            DomesticAccountSecret::from_fields(DomesticAccountFields {
                account_number: " - ",
                ..fields()
            }),
            Err(ValidationError::DomesticAccountNumberRequired)
        );
        Ok(())
    }

    #[test]
    fn routing_number_requires_nine_digits_with_a_valid_aba_checksum() -> anyhow::Result<()> {
        for routing_number in ["011000015", "021000021", "121000358"] {
            DomesticAccountSecret::from_fields(DomesticAccountFields {
                routing_number,
                ..fields()
            })?;
        }
        for routing_number in [
            "021000022",
            "011000016",
            "02100002",
            "0210000210",
            "02100002A",
        ] {
            assert_eq!(
                DomesticAccountSecret::from_fields(DomesticAccountFields {
                    routing_number,
                    ..fields()
                }),
                Err(ValidationError::RoutingNumberInvalid),
                "{routing_number}"
            );
        }
        assert_eq!(
            DomesticAccountSecret::from_fields(DomesticAccountFields {
                routing_number: "",
                ..fields()
            }),
            Err(ValidationError::RoutingNumberRequired)
        );
        Ok(())
    }

    #[test]
    fn debug_redacts_every_value_and_zeroize_clears_fields() -> anyhow::Result<()> {
        let mut account = DomesticAccountSecret::from_fields(fields())?;
        assert_eq!(format!("{account:?}"), "DomesticAccountSecret { .. }");
        account.zeroize_plaintext();
        assert!(account.account_holder.is_empty());
        assert!(account.bank_name.is_empty());
        assert!(account.account_number.is_empty());
        assert!(account.routing_number.is_empty());
        Ok(())
    }
}
