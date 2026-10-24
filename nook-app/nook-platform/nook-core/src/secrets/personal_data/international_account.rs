//! International bank account payload: IBAN with optional SWIFT/BIC.

use super::personal_text::PersonalText;
use super::sensitive_number::SensitiveNumber;
use crate::ValidationError;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::RangeInclusive;
use zeroize::{Zeroize, Zeroizing};

/// Encrypted international-account plaintext payload (`camelCase` YAML).
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InternationalAccountSecret {
    pub account_holder: String,
    pub bank_name: String,
    /// Uppercase IBAN without whitespace; always passes ISO 7064 MOD 97-10.
    pub iban: String,
    /// Uppercase ISO 9362 SWIFT/BIC (8 or 11 characters), or empty.
    pub swift_bic: String,
}

impl fmt::Debug for InternationalAccountSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InternationalAccountSecret")
            .finish_non_exhaustive()
    }
}

/// Named values required by `InternationalAccountSecret::from_fields`.
#[derive(Clone, Copy)]
pub struct InternationalAccountFields<'a> {
    pub account_holder: &'a str,
    pub bank_name: &'a str,
    pub iban: &'a str,
    pub swift_bic: &'a str,
}

/// Shortest and longest IBANs in the ISO 13616 registry.
const IBAN_LENGTHS: RangeInclusive<usize> = 15..=34;
const IBAN_MODULUS: u32 = 97;
/// ISO 9362: 8 characters, or 11 with a branch code.
const BIC_LENGTHS: [usize; 2] = [8, 11];

impl InternationalAccountSecret {
    /// Normalize and validate form or import fields into a stored payload.
    pub fn from_fields(request: InternationalAccountFields<'_>) -> Result<Self, ValidationError> {
        let InternationalAccountFields {
            account_holder,
            bank_name,
            iban,
            swift_bic,
        } = request;
        Ok(Self {
            account_holder: PersonalText::parse(account_holder)?.into_string(),
            bank_name: PersonalText::parse(bank_name)?.into_string(),
            iban: InternationalAccountSecret::normalize_iban(iban)?,
            swift_bic: InternationalAccountSecret::normalize_swift_bic(swift_bic)?,
        })
    }

    /// Re-validate a deserialized payload (import / decrypt path).
    pub fn normalize(self) -> Result<Self, ValidationError> {
        Self::from_fields(self.fields())
    }

    /// Borrow the stored values as validation input.
    #[must_use]
    pub fn fields(&self) -> InternationalAccountFields<'_> {
        InternationalAccountFields {
            account_holder: &self.account_holder,
            bank_name: &self.bank_name,
            iban: &self.iban,
            swift_bic: &self.swift_bic,
        }
    }

    /// Trailing IBAN characters for safe list display.
    #[must_use]
    pub fn last4(&self) -> String {
        SensitiveNumber::new(&self.iban).last4()
    }

    /// Masked IBAN for list rows and default detail (`•••• 5432`).
    #[must_use]
    pub fn masked_number(&self) -> String {
        SensitiveNumber::new(&self.iban).masked()
    }

    pub fn zeroize_plaintext(&mut self) {
        self.account_holder.zeroize();
        self.bank_name.zeroize();
        self.iban.zeroize();
        self.swift_bic.zeroize();
    }
}

impl Zeroize for InternationalAccountSecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

impl InternationalAccountSecret {
    /// Strip whitespace, uppercase, and require ISO 13616 shape plus MOD 97-10.
    fn normalize_iban(raw: &str) -> Result<String, ValidationError> {
        let iban = InternationalAccountSecret::compact_uppercase(raw);
        if iban.is_empty() {
            return Err(ValidationError::InternationalAccountIbanRequired);
        }
        if InternationalAccountSecret::iban_shaped(&iban)
            && InternationalAccountSecret::iban_checksum_valid(&iban)
        {
            Ok(iban)
        } else {
            Err(ValidationError::InternationalAccountIbanInvalid)
        }
    }

    /// Optional ISO 9362 code: bank (4 letters), country (2 letters),
    /// location (2 alphanumerics), then an optional 3-alphanumeric branch.
    fn normalize_swift_bic(raw: &str) -> Result<String, ValidationError> {
        let code = InternationalAccountSecret::compact_uppercase(raw);
        if code.is_empty() {
            return Ok(code);
        }
        let mut characters = code.chars();
        let institution_and_country = characters
            .by_ref()
            .take(6)
            .all(|character| character.is_ascii_uppercase());
        let location_and_branch = characters.all(|character| character.is_ascii_alphanumeric());
        if BIC_LENGTHS.contains(&code.chars().count())
            && institution_and_country
            && location_and_branch
        {
            Ok(code)
        } else {
            Err(ValidationError::SwiftBicInvalid)
        }
    }

    fn compact_uppercase(raw: &str) -> String {
        raw.chars()
            .filter(|character| !character.is_whitespace())
            .flat_map(char::to_uppercase)
            .collect()
    }

    /// 15–34 characters: two country letters, two check digits, then alphanumerics.
    fn iban_shaped(iban: &str) -> bool {
        let mut characters = iban.chars();
        let country = characters
            .by_ref()
            .take(2)
            .all(|character| character.is_ascii_uppercase());
        let check_digits = characters
            .by_ref()
            .take(2)
            .all(|character| character.is_ascii_digit());
        let basic_account = characters.all(|character| character.is_ascii_alphanumeric());
        IBAN_LENGTHS.contains(&iban.chars().count()) && country && check_digits && basic_account
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
    use super::{InternationalAccountFields, InternationalAccountSecret};
    use crate::ValidationError;

    fn fields() -> InternationalAccountFields<'static> {
        InternationalAccountFields {
            account_holder: " Ada Lovelace ",
            bank_name: "Analytical Bank",
            iban: "gb82 west 1234 5698 7654 32",
            swift_bic: " nwbk gb 2l ",
        }
    }

    #[test]
    fn normalizes_iban_and_lowercase_bic_and_masks_the_iban() -> anyhow::Result<()> {
        let account = InternationalAccountSecret::from_fields(fields())?;
        assert_eq!(account.account_holder, "Ada Lovelace");
        assert_eq!(account.iban, "GB82WEST12345698765432");
        assert_eq!(account.swift_bic, "NWBKGB2L");
        assert_eq!(account.last4(), "5432");
        assert_eq!(account.masked_number(), "•••• 5432");
        assert_eq!(account.clone().normalize()?, account);
        Ok(())
    }

    #[test]
    fn accepts_valid_ibans_and_rejects_checksum_length_and_non_iban_values() -> anyhow::Result<()> {
        for iban in [
            "DE89 3704 0044 0532 0130 00",
            "FR14 2004 1010 0505 0001 3M02 606",
            "NO93 8601 1117 947",
        ] {
            InternationalAccountSecret::from_fields(InternationalAccountFields {
                iban,
                ..fields()
            })?;
        }
        for iban in [
            "GB82WEST12345698765433",
            "DE89370400440532013001",
            "NO938601111794",
            "GB82WEST1234569876543212345678901234",
            "000123456789",
            "40-1234-567",
            "GB82-WEST-1234-5698-7654-32",
            "1282WEST12345698765432",
        ] {
            assert_eq!(
                InternationalAccountSecret::from_fields(InternationalAccountFields {
                    iban,
                    ..fields()
                }),
                Err(ValidationError::InternationalAccountIbanInvalid),
                "{iban}"
            );
        }
        assert_eq!(
            InternationalAccountSecret::from_fields(InternationalAccountFields {
                iban: "  ",
                ..fields()
            }),
            Err(ValidationError::InternationalAccountIbanRequired)
        );
        Ok(())
    }

    #[test]
    fn swift_bic_is_optional_and_accepts_8_or_11_characters() -> anyhow::Result<()> {
        let without = InternationalAccountSecret::from_fields(InternationalAccountFields {
            swift_bic: "",
            ..fields()
        })?;
        assert!(without.swift_bic.is_empty());
        for (raw, normalized) in [
            ("DEUTDEFF", "DEUTDEFF"),
            ("deutdeff500", "DEUTDEFF500"),
            ("COBA DE FF XXX", "COBADEFFXXX"),
        ] {
            let account = InternationalAccountSecret::from_fields(InternationalAccountFields {
                swift_bic: raw,
                ..fields()
            })?;
            assert_eq!(account.swift_bic, normalized);
        }
        for swift_bic in [
            "DEUTDEF",
            "DEUTDEFF5",
            "DEUTDEFF5000",
            "DEU1DEFF",
            "DEUTD3FF",
            "DEUTDEF-",
            "DEUTDEFF50-",
        ] {
            assert_eq!(
                InternationalAccountSecret::from_fields(InternationalAccountFields {
                    swift_bic,
                    ..fields()
                }),
                Err(ValidationError::SwiftBicInvalid),
                "{swift_bic}"
            );
        }
        Ok(())
    }

    #[test]
    fn rejects_control_characters_in_names() {
        assert_eq!(
            InternationalAccountSecret::from_fields(InternationalAccountFields {
                bank_name: "Bank\u{1b}",
                ..fields()
            }),
            Err(ValidationError::PersonalDataTextInvalid)
        );
    }

    #[test]
    fn debug_redacts_every_value_and_zeroize_clears_fields() -> anyhow::Result<()> {
        let mut account = InternationalAccountSecret::from_fields(fields())?;
        assert_eq!(format!("{account:?}"), "InternationalAccountSecret { .. }");
        account.zeroize_plaintext();
        assert!(account.account_holder.is_empty());
        assert!(account.bank_name.is_empty());
        assert!(account.iban.is_empty());
        assert!(account.swift_bic.is_empty());
        Ok(())
    }
}
