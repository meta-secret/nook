//! Bank account payload with IBAN checksum validation.

use super::personal_text::PersonalText;
use super::sensitive_number::SensitiveNumber;
use crate::ValidationError;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::RangeInclusive;
use zeroize::{Zeroize, Zeroizing};

/// Encrypted bank-account plaintext payload (`camelCase` YAML).
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BankAccountSecret {
    pub account_holder: String,
    pub bank_name: String,
    /// Uppercase account number or IBAN without whitespace.
    pub account_number: String,
    /// Uppercase alphanumeric routing, sort, or BIC code, or empty.
    pub routing_code: String,
}

impl fmt::Debug for BankAccountSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BankAccountSecret")
            .finish_non_exhaustive()
    }
}

/// Named values required by `BankAccountSecret::from_fields`.
#[derive(Clone, Copy)]
pub struct BankAccountFields<'a> {
    pub account_holder: &'a str,
    pub bank_name: &'a str,
    pub account_number: &'a str,
    pub routing_code: &'a str,
}

/// Shortest and longest IBANs in the ISO 13616 registry.
const IBAN_LENGTHS: RangeInclusive<usize> = 15..=34;
const IBAN_MODULUS: u32 = 97;

/// Account-number format detected after normalization.
enum AccountNumberFormat {
    Iban,
    Domestic,
}

impl BankAccountSecret {
    /// Normalize and validate form or import fields into a stored payload.
    pub fn from_fields(request: BankAccountFields<'_>) -> Result<Self, ValidationError> {
        let BankAccountFields {
            account_holder,
            bank_name,
            account_number,
            routing_code,
        } = request;
        Ok(Self {
            account_holder: PersonalText::parse(account_holder)?.into_string(),
            bank_name: PersonalText::parse(bank_name)?.into_string(),
            account_number: BankAccountSecret::normalize_account_number(account_number)?,
            routing_code: BankAccountSecret::normalize_routing_code(routing_code)?,
        })
    }

    /// Re-validate a deserialized payload (import / decrypt path).
    pub fn normalize(self) -> Result<Self, ValidationError> {
        Self::from_fields(self.fields())
    }

    /// Borrow the stored values as validation input.
    #[must_use]
    pub fn fields(&self) -> BankAccountFields<'_> {
        BankAccountFields {
            account_holder: &self.account_holder,
            bank_name: &self.bank_name,
            account_number: &self.account_number,
            routing_code: &self.routing_code,
        }
    }

    /// Trailing account-number characters for safe list display.
    #[must_use]
    pub fn last4(&self) -> String {
        SensitiveNumber::new(&self.account_number).last4()
    }

    /// Masked account number for list rows and default detail (`•••• 5432`).
    #[must_use]
    pub fn masked_number(&self) -> String {
        SensitiveNumber::new(&self.account_number).masked()
    }

    pub fn zeroize_plaintext(&mut self) {
        self.account_holder.zeroize();
        self.bank_name.zeroize();
        self.account_number.zeroize();
        self.routing_code.zeroize();
    }
}

impl Zeroize for BankAccountSecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

impl BankAccountSecret {
    /// Strip whitespace and uppercase; enforce mod-97 when the value is IBAN-shaped.
    fn normalize_account_number(raw: &str) -> Result<String, ValidationError> {
        let number = BankAccountSecret::compact_uppercase(raw);
        if number.is_empty() {
            return Err(ValidationError::BankAccountNumberRequired);
        }
        match BankAccountSecret::account_number_format(&number) {
            AccountNumberFormat::Iban => {
                if BankAccountSecret::iban_checksum_valid(&number) {
                    Ok(number)
                } else {
                    Err(ValidationError::BankAccountIbanInvalid)
                }
            }
            AccountNumberFormat::Domestic => match (
                number
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-'),
                number
                    .chars()
                    .any(|character| character.is_ascii_alphanumeric()),
            ) {
                (true, true) => Ok(number),
                _ => Err(ValidationError::BankAccountNumberInvalid),
            },
        }
    }

    /// Strip whitespace and `-` separators, uppercase, and require alphanumerics.
    fn normalize_routing_code(raw: &str) -> Result<String, ValidationError> {
        let code: String = BankAccountSecret::compact_uppercase(raw)
            .chars()
            .filter(|character| *character != '-')
            .collect();
        if code
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
        {
            Ok(code)
        } else {
            Err(ValidationError::BankAccountRoutingCodeInvalid)
        }
    }

    fn compact_uppercase(raw: &str) -> String {
        raw.chars()
            .filter(|character| !character.is_whitespace())
            .flat_map(char::to_uppercase)
            .collect()
    }

    /// Two letters, two check digits, then 11–30 alphanumerics.
    fn account_number_format(number: &str) -> AccountNumberFormat {
        let mut characters = number.chars();
        let country = characters
            .by_ref()
            .take(2)
            .all(|character| character.is_ascii_uppercase());
        let check_digits = characters
            .by_ref()
            .take(2)
            .all(|character| character.is_ascii_digit());
        let basic_account = characters.all(|character| character.is_ascii_alphanumeric());
        match (
            IBAN_LENGTHS.contains(&number.chars().count()),
            country && check_digits && basic_account,
        ) {
            (true, true) => AccountNumberFormat::Iban,
            _ => AccountNumberFormat::Domestic,
        }
    }

    /// ISO 7064 MOD 97-10 over the rearranged IBAN (`BBAN + country + check`).
    fn iban_checksum_valid(iban: &str) -> bool {
        let head = Zeroizing::new(iban.chars().take(4).collect::<String>());
        let remainder =
            iban.chars()
                .skip(4)
                .chain(head.chars())
                .fold(0_u32, |remainder, character| match character.to_digit(36) {
                    Some(value) if value < 10 => (remainder * 10 + value) % IBAN_MODULUS,
                    Some(value) => (remainder * 100 + value) % IBAN_MODULUS,
                    None => remainder,
                });
        remainder == 1
    }
}

#[cfg(test)]
mod tests {
    use super::{BankAccountFields, BankAccountSecret};
    use crate::ValidationError;

    fn fields() -> BankAccountFields<'static> {
        BankAccountFields {
            account_holder: " Ada Lovelace ",
            bank_name: "Analytical Bank",
            account_number: "gb82 west 1234 5698 7654 32",
            routing_code: "nwbk-gb2l",
        }
    }

    #[test]
    fn normalizes_iban_and_routing_code() -> anyhow::Result<()> {
        let account = BankAccountSecret::from_fields(fields())?;
        assert_eq!(account.account_holder, "Ada Lovelace");
        assert_eq!(account.account_number, "GB82WEST12345698765432");
        assert_eq!(account.routing_code, "NWBKGB2L");
        assert_eq!(account.last4(), "5432");
        assert_eq!(account.masked_number(), "•••• 5432");
        assert_eq!(account.clone().normalize()?, account);
        Ok(())
    }

    #[test]
    fn accepts_valid_ibans_and_rejects_bad_checksums() -> anyhow::Result<()> {
        for iban in [
            "DE89 3704 0044 0532 0130 00",
            "FR14 2004 1010 0505 0001 3M02 606",
            "NO93 8601 1117 947",
        ] {
            BankAccountSecret::from_fields(BankAccountFields {
                account_number: iban,
                ..fields()
            })?;
        }
        for iban in ["GB82WEST12345698765433", "DE89370400440532013001"] {
            assert_eq!(
                BankAccountSecret::from_fields(BankAccountFields {
                    account_number: iban,
                    ..fields()
                }),
                Err(ValidationError::BankAccountIbanInvalid),
                "{iban}"
            );
        }
        Ok(())
    }

    #[test]
    fn domestic_numbers_allow_alphanumerics_and_hyphens() -> anyhow::Result<()> {
        let account = BankAccountSecret::from_fields(BankAccountFields {
            account_number: " 000123456789 ",
            routing_code: "021000021",
            ..fields()
        })?;
        assert_eq!(account.account_number, "000123456789");
        let hyphenated = BankAccountSecret::from_fields(BankAccountFields {
            account_number: "40-1234-567",
            routing_code: "",
            ..fields()
        })?;
        assert_eq!(hyphenated.account_number, "40-1234-567");
        assert!(hyphenated.routing_code.is_empty());
        Ok(())
    }

    #[test]
    fn rejects_missing_or_malformed_numbers_and_codes() {
        assert_eq!(
            BankAccountSecret::from_fields(BankAccountFields {
                account_number: "  ",
                ..fields()
            }),
            Err(ValidationError::BankAccountNumberRequired)
        );
        assert_eq!(
            BankAccountSecret::from_fields(BankAccountFields {
                account_number: "1234/5678",
                ..fields()
            }),
            Err(ValidationError::BankAccountNumberInvalid)
        );
        assert_eq!(
            BankAccountSecret::from_fields(BankAccountFields {
                account_number: "--",
                ..fields()
            }),
            Err(ValidationError::BankAccountNumberInvalid)
        );
        assert_eq!(
            BankAccountSecret::from_fields(BankAccountFields {
                routing_code: "12.34.56",
                ..fields()
            }),
            Err(ValidationError::BankAccountRoutingCodeInvalid)
        );
        assert_eq!(
            BankAccountSecret::from_fields(BankAccountFields {
                bank_name: "Bank\u{1b}",
                ..fields()
            }),
            Err(ValidationError::PersonalDataTextInvalid)
        );
    }

    #[test]
    fn debug_redacts_every_personal_value_and_zeroize_clears_fields() -> anyhow::Result<()> {
        let mut account = BankAccountSecret::from_fields(fields())?;
        assert_eq!(format!("{account:?}"), "BankAccountSecret { .. }");
        account.zeroize_plaintext();
        assert!(account.account_holder.is_empty());
        assert!(account.bank_name.is_empty());
        assert!(account.account_number.is_empty());
        assert!(account.routing_code.is_empty());
        Ok(())
    }
}
