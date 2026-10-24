//! Proton Pass identity items as person, address, and document records.
//!
//! One identity may produce a person, a postal address, a passport, and a
//! driver's license. Work, social, and SSN details have no Nook type.

use super::ProtonPassVaultItem;
use crate::secrets::import_support::ImportItemDisposition;
use crate::secrets::import_support::personal::{PersonalImportItem, PersonalImportPart};
use crate::{AddressFields, IdentityDocumentFields, IdentityDocumentKind, PersonFields};
use serde::Deserialize;

/// Identity content fields of a Proton Pass item (`camelCase` JSON).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProtonPassIdentityContent {
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    first_name: String,
    #[serde(default)]
    middle_name: String,
    #[serde(default)]
    last_name: String,
    #[serde(default)]
    birthdate: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    phone_number: String,
    #[serde(default)]
    street_address: String,
    #[serde(default)]
    floor: String,
    #[serde(default)]
    city: String,
    #[serde(default)]
    state_or_province: String,
    #[serde(default)]
    zip_or_postal_code: String,
    #[serde(default)]
    country_or_region: String,
    #[serde(default)]
    passport_number: String,
    #[serde(default)]
    license_number: String,
}

impl ProtonPassVaultItem<'_> {
    pub(super) fn identity(&self) -> ImportItemDisposition {
        let identity = &self.item.data.content.identity;
        let split_names = [
            &identity.first_name,
            &identity.middle_name,
            &identity.last_name,
        ]
        .iter()
        .all(|name| name.trim().is_empty());
        // A full name alone has no reliable split; it becomes the given name.
        let given_name = if split_names {
            identity.full_name.as_str()
        } else {
            identity.first_name.as_str()
        };
        let printed_name = match identity.full_name.trim() {
            "" => [
                &identity.first_name,
                &identity.middle_name,
                &identity.last_name,
            ]
            .iter()
            .map(|name| name.trim())
            .filter(|name| !name.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
            full_name => full_name.to_owned(),
        };
        let document = |kind, number: &str| {
            PersonalImportPart::document(IdentityDocumentFields {
                kind,
                number,
                issuing_country: "",
                issue_date: "",
                expiry_date: "",
                name_as_printed: &printed_name,
            })
        };
        PersonalImportItem {
            parts: vec![
                PersonalImportPart::person(PersonFields {
                    given_name,
                    middle_name: &identity.middle_name,
                    family_name: &identity.last_name,
                    birth_date: &identity.birthdate,
                    email: &identity.email,
                    phone: &identity.phone_number,
                }),
                PersonalImportPart::address(AddressFields {
                    label: self.item.data.metadata.name.trim(),
                    address_line1: &identity.street_address,
                    address_line2: &identity.floor,
                    city: &identity.city,
                    region: &identity.state_or_province,
                    postal_code: &identity.zip_or_postal_code,
                    country: &identity.country_or_region,
                }),
                document(IdentityDocumentKind::Passport, &identity.passport_number),
                document(
                    IdentityDocumentKind::DriversLicense,
                    &identity.license_number,
                ),
            ],
        }
        .disposition()
    }
}

#[cfg(test)]
mod tests {
    use super::super::ProtonPassExport;
    use crate::{IdentityDocumentKind, SecretValue};

    #[test]
    fn identity_produces_person_address_and_documents() -> anyhow::Result<()> {
        let json = r#"{"vaults":{"a":{"name":"Personal","items":[{"data":{"type":"identity",
          "metadata":{"name":"Me","note":""},"extraFields":[],
          "content":{"fullName":"Ada Lovelace","email":"ada@example.com","phoneNumber":"+44 20 7946 0958",
            "firstName":"Ada","middleName":"","lastName":"Lovelace","birthdate":"1815-12-10",
            "gender":"","organization":"","streetAddress":"12 Analytical Row","zipOrPostalCode":"W1 1AA",
            "city":"London","stateOrProvince":"","countryOrRegion":"United Kingdom","floor":"3",
            "county":"","socialSecurityNumber":"000-00-0000","passportNumber":"X1234567",
            "licenseNumber":"","website":"","company":"","jobTitle":"","extraSections":[]}}}]}}}"#;
        let plan = ProtonPassExport::parse(json)?.plan();
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let [
            SecretValue::Person(person),
            SecretValue::Address(address),
            SecretValue::IdentityDocument(passport),
        ] = plan.items.as_slice()
        else {
            anyhow::bail!("expected person, address and passport");
        };
        assert_eq!(person.full_name(), "Ada Lovelace");
        assert_eq!(person.birth_date, "1815-12-10");
        assert_eq!(address.label, "Me");
        assert_eq!(address.address_line2, "3");
        assert_eq!(passport.kind, IdentityDocumentKind::Passport);
        assert_eq!(passport.name_as_printed, "Ada Lovelace");
        Ok(())
    }

    #[test]
    fn full_name_only_becomes_the_given_name_and_bad_dates_skip() -> anyhow::Result<()> {
        let json = r#"{"vaults":{"a":{"items":[
          {"data":{"type":"identity","metadata":{"name":"Short"},"content":{"fullName":"Ada Lovelace"}}},
          {"data":{"type":"identity","metadata":{"name":"Bad"},"content":{"firstName":"Ada","birthdate":"10/12/1815"}}},
          {"data":{"type":"identity","metadata":{"name":"Empty"},"content":{"socialSecurityNumber":"000-00-0000"}}}]}}}"#;
        let plan = ProtonPassExport::parse(json)?.plan();
        assert_eq!(usize::from(plan.source_count), 3);
        assert_eq!(usize::from(plan.skipped_unsupported), 2);
        let [SecretValue::Person(person)] = plan.items.as_slice() else {
            anyhow::bail!("expected one person");
        };
        assert_eq!(person.given_name, "Ada Lovelace");
        Ok(())
    }
}
