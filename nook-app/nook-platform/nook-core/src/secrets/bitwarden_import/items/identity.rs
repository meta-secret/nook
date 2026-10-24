//! Bitwarden identity items (type 4) as person, address, and document records.
//!
//! One identity may produce a person, a postal address, a passport, and a
//! driver's license. The SSN, company, username, and title have no Nook type.

use super::BitwardenText;
use crate::secrets::import_support::personal::{PersonalImportItem, PersonalImportPart};
use crate::secrets::import_support::{ImportItemDisposition, ImportSkipReason};
use crate::secrets::personal_data::PresentParts;
use crate::{AddressFields, IdentityDocumentFields, IdentityDocumentKind, PersonFields};
use serde::Deserialize;

/// Foreign Bitwarden identity declaration: present, or absent/null.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(super) enum BitwardenIdentityPayload {
    Identity(Box<BitwardenIdentity>),
    Undeclared(()),
}

impl Default for BitwardenIdentityPayload {
    fn default() -> Self {
        Self::Undeclared(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BitwardenIdentity {
    #[serde(default)]
    first_name: BitwardenText,
    #[serde(default)]
    middle_name: BitwardenText,
    #[serde(default)]
    last_name: BitwardenText,
    #[serde(default)]
    address1: BitwardenText,
    #[serde(default)]
    address2: BitwardenText,
    #[serde(default)]
    address3: BitwardenText,
    #[serde(default)]
    city: BitwardenText,
    #[serde(default)]
    state: BitwardenText,
    #[serde(default)]
    postal_code: BitwardenText,
    #[serde(default)]
    country: BitwardenText,
    #[serde(default)]
    email: BitwardenText,
    #[serde(default)]
    phone: BitwardenText,
    #[serde(default)]
    passport_number: BitwardenText,
    #[serde(default)]
    license_number: BitwardenText,
}

impl BitwardenIdentityPayload {
    pub(super) fn disposition(&self, name: &str) -> ImportItemDisposition {
        let Self::Identity(identity) = self else {
            return ImportItemDisposition::Skipped(ImportSkipReason::IncompletePayload);
        };
        identity.disposition(name)
    }
}

impl BitwardenIdentity {
    fn disposition(&self, name: &str) -> ImportItemDisposition {
        let address_line2 = PresentParts {
            parts: &[&self.address2, &self.address3],
            separator: ", ",
        }
        .joined();
        // Bitwarden exports no printed name for its documents.
        let document = |kind, number: &BitwardenText| {
            PersonalImportPart::document(IdentityDocumentFields {
                kind,
                number,
                issuing_country: "",
                issue_date: "",
                expiry_date: "",
                name_as_printed: "",
            })
        };
        PersonalImportItem {
            parts: vec![
                PersonalImportPart::person(PersonFields {
                    given_name: &self.first_name,
                    middle_name: &self.middle_name,
                    family_name: &self.last_name,
                    birth_date: "",
                    email: &self.email,
                    phone: &self.phone,
                }),
                PersonalImportPart::address(AddressFields {
                    label: name,
                    address_line1: &self.address1,
                    address_line2: &address_line2,
                    city: &self.city,
                    region: &self.state,
                    postal_code: &self.postal_code,
                    country: &self.country,
                }),
                document(IdentityDocumentKind::Passport, &self.passport_number),
                document(IdentityDocumentKind::DriversLicense, &self.license_number),
            ],
        }
        .disposition()
    }
}

#[cfg(test)]
mod tests {
    use super::super::BitwardenItems;
    use crate::{IdentityDocumentKind, SecretValue};

    const IDENTITY: &str = r#"{"items":[{"id":"bw-identity","type":4,"name":"Personal","notes":null,
      "identity":{"title":"Ms","firstName":"Ada","middleName":null,"lastName":"Lovelace",
        "address1":"12 Analytical Row","address2":"Flat 3","address3":null,"city":"London",
        "state":"Greater London","postalCode":"W1 1AA","country":"GB","company":"Engines Ltd",
        "email":"ada@example.com","phone":"+44 20 7946 0958","ssn":"000-00-0000",
        "username":"ada","passportNumber":"X1234567","licenseNumber":"LOVEL812105AA9IJ"}}]}"#;

    #[test]
    fn identity_produces_person_address_passport_and_license() -> anyhow::Result<()> {
        let plan = BitwardenItems::parse(IDENTITY)?.plan();
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let [
            SecretValue::Person(person),
            SecretValue::Address(address),
            SecretValue::IdentityDocument(passport),
            SecretValue::IdentityDocument(license),
        ] = plan.items.as_slice()
        else {
            anyhow::bail!("expected person, address, passport and license");
        };
        assert_eq!(person.full_name(), "Ada Lovelace");
        assert_eq!(person.email, "ada@example.com");
        assert_eq!(address.label, "Personal");
        assert_eq!(address.address_line2, "Flat 3");
        assert_eq!(address.region, "Greater London");
        assert_eq!(passport.kind, IdentityDocumentKind::Passport);
        assert_eq!(passport.number, "X1234567");
        assert!(passport.name_as_printed.is_empty());
        assert_eq!(license.kind, IdentityDocumentKind::DriversLicense);
        Ok(())
    }

    #[test]
    fn sparse_identity_produces_only_present_records() -> anyhow::Result<()> {
        let json = r#"{"items":[{"type":4,"name":"Mail","identity":{"firstName":null,
          "lastName":null,"address1":"1 Main St","city":"Springfield","country":"US"}}]}"#;
        let plan = BitwardenItems::parse(json)?.plan();
        let [SecretValue::Address(address)] = plan.items.as_slice() else {
            anyhow::bail!("expected one address");
        };
        assert_eq!(address.city, "Springfield");
        Ok(())
    }

    #[test]
    fn invalid_or_empty_identities_are_counted_as_skipped() -> anyhow::Result<()> {
        let json = r#"{"items":[
          {"type":4,"name":"Bad email","identity":{"firstName":"Ada","email":"not-an-email"}},
          {"type":4,"name":"Only SSN","identity":{"ssn":"000-00-0000"}},
          {"type":4,"name":"No payload","identity":null},
          {"id":"bitwarden-identity-1","type":4,"name":"Skipped identity"},
          {"type":2,"name":"Note","notes":"kept"}]}"#;
        let plan = BitwardenItems::parse(json)?.plan();
        assert_eq!(usize::from(plan.source_count), 5);
        assert_eq!(usize::from(plan.skipped_unsupported), 4);
        assert!(matches!(
            plan.items.as_slice(),
            [SecretValue::SecureNote(_)]
        ));
        Ok(())
    }
}
