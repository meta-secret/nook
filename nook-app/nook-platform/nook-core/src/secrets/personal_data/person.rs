//! Person payload: names, birth date, and contact details.

use super::calendar_date::DateEntry;
use super::personal_text::PersonalText;
use crate::ValidationError;
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

/// Encrypted person plaintext payload (`camelCase` YAML).
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonSecret {
    pub given_name: String,
    pub middle_name: String,
    pub family_name: String,
    /// ISO `YYYY-MM-DD`, or empty.
    pub birth_date: String,
    pub email: String,
    pub phone: String,
}

impl fmt::Debug for PersonSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PersonSecret")
            .finish_non_exhaustive()
    }
}

/// Named values required by `PersonSecret::from_fields`.
#[derive(Clone, Copy)]
pub struct PersonFields<'a> {
    pub given_name: &'a str,
    pub middle_name: &'a str,
    pub family_name: &'a str,
    pub birth_date: &'a str,
    pub email: &'a str,
    pub phone: &'a str,
}

/// Phone punctuation accepted between digits.
const PHONE_PUNCTUATION: &[char] = &['+', '(', ')', '-', '.', ' '];

impl PersonSecret {
    /// Normalize and validate form or import fields into a stored payload.
    pub fn from_fields(request: PersonFields<'_>) -> Result<Self, ValidationError> {
        let PersonFields {
            given_name,
            middle_name,
            family_name,
            birth_date,
            email,
            phone,
        } = request;
        let given_name = PersonalText::parse(given_name)?;
        let family_name = PersonalText::parse(family_name)?;
        let (given_name, family_name) = match (given_name, family_name) {
            (PersonalText::Empty, PersonalText::Empty) => {
                return Err(ValidationError::PersonNameRequired);
            }
            (given_name, family_name) => (given_name.into_string(), family_name.into_string()),
        };
        Ok(Self {
            given_name,
            middle_name: PersonalText::parse(middle_name)?.into_string(),
            family_name,
            birth_date: DateEntry::parse(birth_date)
                .map_err(|_| ValidationError::PersonBirthDateInvalid)?
                .into_string(),
            email: PersonSecret::normalize_email(email)?,
            phone: PersonSecret::normalize_phone(phone)?,
        })
    }

    /// Re-validate a deserialized payload (import / decrypt path).
    pub fn normalize(self) -> Result<Self, ValidationError> {
        Self::from_fields(self.fields())
    }

    /// Borrow the stored values as validation input.
    #[must_use]
    pub fn fields(&self) -> PersonFields<'_> {
        PersonFields {
            given_name: &self.given_name,
            middle_name: &self.middle_name,
            family_name: &self.family_name,
            birth_date: &self.birth_date,
            email: &self.email,
            phone: &self.phone,
        }
    }

    /// Given, middle, and family names joined by single spaces.
    #[must_use]
    pub fn full_name(&self) -> String {
        PersonalText::join_present([
            self.given_name.as_str(),
            self.middle_name.as_str(),
            self.family_name.as_str(),
        ])
    }

    pub fn zeroize_plaintext(&mut self) {
        self.given_name.zeroize();
        self.middle_name.zeroize();
        self.family_name.zeroize();
        self.birth_date.zeroize();
        self.email.zeroize();
        self.phone.zeroize();
    }
}

impl Zeroize for PersonSecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

impl PersonSecret {
    /// Accept a simple `local@domain.tld` shape without whitespace.
    fn normalize_email(raw: &str) -> Result<String, ValidationError> {
        let email = match PersonalText::parse(raw)? {
            PersonalText::Empty => return Ok(String::new()),
            PersonalText::Text(email) => email,
        };
        let Some((local, domain)) = email.split_once('@') else {
            return Err(ValidationError::PersonEmailInvalid);
        };
        let shape_valid = !local.is_empty()
            && !domain.contains('@')
            && domain.contains('.')
            && !domain.starts_with('.')
            && !domain.ends_with('.')
            && !domain.contains("..")
            && !email.chars().any(char::is_whitespace);
        if shape_valid {
            Ok(email)
        } else {
            Err(ValidationError::PersonEmailInvalid)
        }
    }

    /// Accept digits with common phone punctuation; at least one digit.
    fn normalize_phone(raw: &str) -> Result<String, ValidationError> {
        let phone = match PersonalText::parse(raw)? {
            PersonalText::Empty => return Ok(String::new()),
            PersonalText::Text(phone) => phone,
        };
        let allowed = phone
            .chars()
            .all(|character| character.is_ascii_digit() || PHONE_PUNCTUATION.contains(&character));
        match (
            allowed,
            phone.chars().any(|character| character.is_ascii_digit()),
        ) {
            (true, true) => Ok(phone),
            _ => Err(ValidationError::PersonPhoneInvalid),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PersonFields, PersonSecret};
    use crate::ValidationError;

    fn fields() -> PersonFields<'static> {
        PersonFields {
            given_name: " Ada ",
            middle_name: "Augusta",
            family_name: "Lovelace ",
            birth_date: " 1815-12-10 ",
            email: " ada@example.com ",
            phone: "+44 (20) 7946-0958",
        }
    }

    #[test]
    fn normalizes_trimmed_fields_and_joins_full_name() -> anyhow::Result<()> {
        let person = PersonSecret::from_fields(fields())?;
        assert_eq!(person.given_name, "Ada");
        assert_eq!(person.family_name, "Lovelace");
        assert_eq!(person.birth_date, "1815-12-10");
        assert_eq!(person.email, "ada@example.com");
        assert_eq!(person.phone, "+44 (20) 7946-0958");
        assert_eq!(person.full_name(), "Ada Augusta Lovelace");
        assert_eq!(person.clone().normalize()?, person);
        Ok(())
    }

    #[test]
    fn requires_given_or_family_name() -> anyhow::Result<()> {
        assert_eq!(
            PersonSecret::from_fields(PersonFields {
                given_name: " ",
                family_name: "",
                ..fields()
            }),
            Err(ValidationError::PersonNameRequired)
        );
        let family_only = PersonSecret::from_fields(PersonFields {
            given_name: "",
            middle_name: "",
            ..fields()
        })?;
        assert_eq!(family_only.full_name(), "Lovelace");
        Ok(())
    }

    #[test]
    fn optional_fields_may_be_blank() -> anyhow::Result<()> {
        let person = PersonSecret::from_fields(PersonFields {
            given_name: "Ada",
            middle_name: "",
            family_name: "",
            birth_date: "",
            email: "",
            phone: "",
        })?;
        assert!(person.birth_date.is_empty());
        assert!(person.email.is_empty());
        assert!(person.phone.is_empty());
        Ok(())
    }

    #[test]
    fn rejects_invalid_birth_dates_emails_phones_and_control_text() {
        for birth_date in ["1815-02-30", "10/12/1815", "1815-12-1"] {
            assert_eq!(
                PersonSecret::from_fields(PersonFields {
                    birth_date,
                    ..fields()
                }),
                Err(ValidationError::PersonBirthDateInvalid)
            );
        }
        for email in [
            "ada",
            "ada@",
            "@example.com",
            "ada@example",
            "ada@@example.com",
            "ada@.example.com",
            "ada@example..com",
            "ada lovelace@example.com",
        ] {
            assert_eq!(
                PersonSecret::from_fields(PersonFields { email, ..fields() }),
                Err(ValidationError::PersonEmailInvalid),
                "{email}"
            );
        }
        for phone in ["call me", "+()", "555-0100 ext. 7"] {
            assert_eq!(
                PersonSecret::from_fields(PersonFields { phone, ..fields() }),
                Err(ValidationError::PersonPhoneInvalid),
                "{phone}"
            );
        }
        assert_eq!(
            PersonSecret::from_fields(PersonFields {
                middle_name: "Au\u{0}gusta",
                ..fields()
            }),
            Err(ValidationError::PersonalDataTextInvalid)
        );
    }

    #[test]
    fn debug_redacts_every_personal_value_and_zeroize_clears_fields() -> anyhow::Result<()> {
        let mut person = PersonSecret::from_fields(fields())?;
        let debug = format!("{person:?}");
        assert_eq!(debug, "PersonSecret { .. }");
        person.zeroize_plaintext();
        assert!(person.given_name.is_empty());
        assert!(person.middle_name.is_empty());
        assert!(person.family_name.is_empty());
        assert!(person.birth_date.is_empty());
        assert!(person.email.is_empty());
        assert!(person.phone.is_empty());
        Ok(())
    }
}
