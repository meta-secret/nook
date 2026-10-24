//! Postal address payload.

use super::personal_text::PersonalText;
use crate::ValidationError;
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

/// Encrypted postal-address plaintext payload (`camelCase` YAML).
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddressSecret {
    /// Optional user label such as `Home`.
    pub label: String,
    pub address_line1: String,
    pub address_line2: String,
    pub city: String,
    /// State, province, or other first-level region.
    pub region: String,
    pub postal_code: String,
    /// Country as the user stored it (name or code).
    pub country: String,
}

impl fmt::Debug for AddressSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AddressSecret")
            .finish_non_exhaustive()
    }
}

/// Named values required by `AddressSecret::from_fields`.
#[derive(Clone, Copy)]
pub struct AddressFields<'a> {
    pub label: &'a str,
    pub address_line1: &'a str,
    pub address_line2: &'a str,
    pub city: &'a str,
    pub region: &'a str,
    pub postal_code: &'a str,
    pub country: &'a str,
}

impl AddressSecret {
    /// Normalize and validate form or import fields into a stored payload.
    pub fn from_fields(request: AddressFields<'_>) -> Result<Self, ValidationError> {
        let AddressFields {
            label,
            address_line1,
            address_line2,
            city,
            region,
            postal_code,
            country,
        } = request;
        Ok(Self {
            label: PersonalText::parse(label)?.into_string(),
            address_line1: PersonalText::parse(address_line1)?
                .require(ValidationError::AddressLine1Required)?,
            address_line2: PersonalText::parse(address_line2)?.into_string(),
            city: PersonalText::parse(city)?.into_string(),
            region: PersonalText::parse(region)?.into_string(),
            postal_code: PersonalText::parse(postal_code)?.into_string(),
            country: PersonalText::parse(country)?.into_string(),
        })
    }

    /// Re-validate a deserialized payload (import / decrypt path).
    pub fn normalize(self) -> Result<Self, ValidationError> {
        Self::from_fields(self.fields())
    }

    /// Borrow the stored values as validation input.
    #[must_use]
    pub fn fields(&self) -> AddressFields<'_> {
        AddressFields {
            label: &self.label,
            address_line1: &self.address_line1,
            address_line2: &self.address_line2,
            city: &self.city,
            region: &self.region,
            postal_code: &self.postal_code,
            country: &self.country,
        }
    }

    pub fn zeroize_plaintext(&mut self) {
        self.label.zeroize();
        self.address_line1.zeroize();
        self.address_line2.zeroize();
        self.city.zeroize();
        self.region.zeroize();
        self.postal_code.zeroize();
        self.country.zeroize();
    }
}

impl Zeroize for AddressSecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

#[cfg(test)]
mod tests {
    use super::{AddressFields, AddressSecret};
    use crate::ValidationError;

    fn fields() -> AddressFields<'static> {
        AddressFields {
            label: " Home ",
            address_line1: " 12 Analytical Row ",
            address_line2: "Flat 3",
            city: "London",
            region: "Greater London",
            postal_code: " W1 1AA ",
            country: "GB",
        }
    }

    #[test]
    fn normalizes_trimmed_fields_and_round_trips() -> anyhow::Result<()> {
        let address = AddressSecret::from_fields(fields())?;
        assert_eq!(address.label, "Home");
        assert_eq!(address.address_line1, "12 Analytical Row");
        assert_eq!(address.postal_code, "W1 1AA");
        assert_eq!(address.clone().normalize()?, address);
        Ok(())
    }

    #[test]
    fn requires_first_line_and_rejects_control_text() {
        assert_eq!(
            AddressSecret::from_fields(AddressFields {
                address_line1: "  ",
                ..fields()
            }),
            Err(ValidationError::AddressLine1Required)
        );
        assert_eq!(
            AddressSecret::from_fields(AddressFields {
                address_line2: "Flat\r3",
                ..fields()
            }),
            Err(ValidationError::PersonalDataTextInvalid)
        );
    }

    #[test]
    fn optional_fields_may_be_blank() -> anyhow::Result<()> {
        let address = AddressSecret::from_fields(AddressFields {
            label: "",
            address_line1: "1 Main St",
            address_line2: "",
            city: "",
            region: "",
            postal_code: "",
            country: "",
        })?;
        assert!(address.label.is_empty());
        assert!(address.country.is_empty());
        Ok(())
    }

    #[test]
    fn debug_redacts_every_personal_value_and_zeroize_clears_fields() -> anyhow::Result<()> {
        let mut address = AddressSecret::from_fields(fields())?;
        assert_eq!(format!("{address:?}"), "AddressSecret { .. }");
        address.zeroize_plaintext();
        assert_eq!(address.fields().address_line1, "");
        assert!(address.label.is_empty());
        assert!(address.city.is_empty());
        assert!(address.region.is_empty());
        assert!(address.postal_code.is_empty());
        assert!(address.country.is_empty());
        assert!(address.address_line2.is_empty());
        Ok(())
    }
}
