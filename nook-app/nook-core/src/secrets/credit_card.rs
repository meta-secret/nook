//! Credit-card secret payload parsing and validation.

use crate::ValidationError;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

const MIN_CARD_DIGITS: usize = 12;
const MAX_CARD_DIGITS: usize = 19;

/// Encrypted credit-card plaintext payload (`camelCase` YAML).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreditCardSecret {
    pub title: String,
    pub cardholder_name: String,
    pub number: String,
    pub expiration_month: String,
    pub expiration_year: String,
    pub cvv: String,
    pub notes: String,
}

impl CreditCardSecret {
    /// Normalize and validate form or import fields into a stored payload.
    pub fn from_fields(
        title: &str,
        cardholder_name: &str,
        number: &str,
        expiration_month: &str,
        expiration_year: &str,
        cvv: &str,
        notes: &str,
    ) -> Result<Self, ValidationError> {
        let title = title.trim().to_owned();
        if title.is_empty() {
            return Err(ValidationError::CreditCardTitleRequired);
        }

        let number = normalize_card_number(number)?;
        let (expiration_month, expiration_year) =
            normalize_expiration(expiration_month, expiration_year)?;
        let cvv = normalize_cvv(cvv)?;

        Ok(Self {
            title,
            cardholder_name: cardholder_name.trim().to_owned(),
            number,
            expiration_month,
            expiration_year,
            cvv,
            notes: notes.replace("\r\n", "\n"),
        })
    }

    /// Re-validate a deserialized payload (import / decrypt path).
    pub fn normalize(&mut self) -> Result<(), ValidationError> {
        *self = Self::from_fields(
            &self.title,
            &self.cardholder_name,
            &self.number,
            &self.expiration_month,
            &self.expiration_year,
            &self.cvv,
            &self.notes,
        )?;
        Ok(())
    }

    /// Last four digits for safe list display.
    #[must_use]
    pub fn last4(&self) -> String {
        self.number
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect()
    }

    /// Masked PAN for collapsed UI (`•••• 4242`).
    #[must_use]
    pub fn masked_number(&self) -> String {
        format!("•••• {}", self.last4())
    }

    /// `MM/YYYY` when both expiry parts are present.
    #[must_use]
    pub fn expiration_display(&self) -> String {
        if self.expiration_month.is_empty() || self.expiration_year.is_empty() {
            String::new()
        } else {
            format!("{}/{}", self.expiration_month, self.expiration_year)
        }
    }

    pub fn zeroize_plaintext(&mut self) {
        self.title.zeroize();
        self.cardholder_name.zeroize();
        self.number.zeroize();
        self.expiration_month.zeroize();
        self.expiration_year.zeroize();
        self.cvv.zeroize();
        self.notes.zeroize();
    }
}

impl Zeroize for CreditCardSecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

fn normalize_card_number(raw: &str) -> Result<String, ValidationError> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    if !(MIN_CARD_DIGITS..=MAX_CARD_DIGITS).contains(&digits.len()) {
        return Err(ValidationError::CreditCardNumberInvalid);
    }
    if !luhn_valid(&digits) {
        return Err(ValidationError::CreditCardNumberInvalid);
    }
    Ok(digits)
}

fn normalize_cvv(raw: &str) -> Result<String, ValidationError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if !(3..=4).contains(&trimmed.len()) || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ValidationError::CreditCardCvvInvalid);
    }
    Ok(trimmed.to_owned())
}

fn normalize_expiration(
    month_raw: &str,
    year_raw: &str,
) -> Result<(String, String), ValidationError> {
    let month_raw = month_raw.trim();
    let year_raw = year_raw.trim();
    if month_raw.is_empty() && year_raw.is_empty() {
        return Ok((String::new(), String::new()));
    }
    if month_raw.is_empty() || year_raw.is_empty() {
        return Err(ValidationError::CreditCardExpirationInvalid);
    }

    let month = parse_month(month_raw)?;
    let year = parse_year(year_raw)?;
    Ok((format!("{month:02}"), format!("{year:04}")))
}

fn parse_month(raw: &str) -> Result<u32, ValidationError> {
    let month: u32 = raw
        .parse()
        .map_err(|_| ValidationError::CreditCardExpirationInvalid)?;
    if (1..=12).contains(&month) {
        Ok(month)
    } else {
        Err(ValidationError::CreditCardExpirationInvalid)
    }
}

fn parse_year(raw: &str) -> Result<u32, ValidationError> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    match digits.len() {
        2 => {
            let yy: u32 = digits
                .parse()
                .map_err(|_| ValidationError::CreditCardExpirationInvalid)?;
            // Payment cards use a rolling century window around the current era.
            Ok(2000 + yy)
        }
        4 => {
            let year: u32 = digits
                .parse()
                .map_err(|_| ValidationError::CreditCardExpirationInvalid)?;
            if (2000..=2100).contains(&year) {
                Ok(year)
            } else {
                Err(ValidationError::CreditCardExpirationInvalid)
            }
        }
        _ => Err(ValidationError::CreditCardExpirationInvalid),
    }
}

fn luhn_valid(digits: &str) -> bool {
    let mut sum = 0_u32;
    let mut double = false;
    for ch in digits.chars().rev() {
        let Some(mut digit) = ch.to_digit(10) else {
            return false;
        };
        if double {
            digit *= 2;
            if digit > 9 {
                digit -= 9;
            }
        }
        sum += digit;
        double = !double;
    }
    sum.is_multiple_of(10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_visa_test_number_and_masks_last4() {
        let card = CreditCardSecret::from_fields(
            "Personal Visa",
            "Ada Lovelace",
            "4111 1111 1111 1111",
            "12",
            "30",
            "123",
            "work card",
        )
        .unwrap();

        assert_eq!(card.number, "4111111111111111");
        assert_eq!(card.expiration_month, "12");
        assert_eq!(card.expiration_year, "2030");
        assert_eq!(card.last4(), "1111");
        assert_eq!(card.masked_number(), "•••• 1111");
        assert_eq!(card.expiration_display(), "12/2030");
    }

    #[test]
    fn rejects_invalid_luhn_and_partial_expiry() {
        assert_eq!(
            CreditCardSecret::from_fields("Bad", "", "4111111111111112", "", "", "", ""),
            Err(ValidationError::CreditCardNumberInvalid)
        );
        assert_eq!(
            CreditCardSecret::from_fields("Bad", "", "4111111111111111", "12", "", "", ""),
            Err(ValidationError::CreditCardExpirationInvalid)
        );
        assert_eq!(
            CreditCardSecret::from_fields("Bad", "", "4111111111111111", "", "", "12", ""),
            Err(ValidationError::CreditCardCvvInvalid)
        );
        assert_eq!(
            CreditCardSecret::from_fields("", "", "4111111111111111", "", "", "", ""),
            Err(ValidationError::CreditCardTitleRequired)
        );
    }

    #[test]
    fn allows_empty_optional_fields() {
        let card =
            CreditCardSecret::from_fields("Debit", "", "4111111111111111", "", "", "", "").unwrap();
        assert!(card.cardholder_name.is_empty());
        assert!(card.cvv.is_empty());
        assert!(card.expiration_display().is_empty());
    }
}
