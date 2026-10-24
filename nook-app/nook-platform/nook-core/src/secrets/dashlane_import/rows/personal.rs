//! Dashlane `ids.csv`, `personalInfo.csv`, and bank payment rows.
//!
//! IDs map ID cards, passports, driver's licenses, social security numbers,
//! and tax numbers to identity documents. Personal-info `name` rows become
//! people and `address` rows become addresses. Email, phone (`number`),
//! website, and company rows are separate rows with no name, so they cannot
//! join a person and are not imported.

use super::super::DashlaneImportError;
use super::NormalizedDashlaneHeaders;
use crate::secrets::import_support::personal::{
    BankImportFields, ExportedAccountNumber, ExportedAccountNumberKind, PersonalImportItem,
    PersonalImportPart,
};
use crate::secrets::import_support::{
    CsvExportColumn, CsvRecordFields, ImportItemDisposition, ImportSkipReason,
};
use crate::{
    AddressFields, IdentityDocumentFields, IdentityDocumentKind, PersonFields, SecretValue,
};
use csv::StringRecord;

#[derive(Clone, Copy)]
pub(super) struct IdColumns {
    kind: usize,
    number: CsvExportColumn,
    name: CsvExportColumn,
    issue_date: CsvExportColumn,
    expiration_date: CsvExportColumn,
    place_of_issue: CsvExportColumn,
}

impl IdColumns {
    pub(super) fn from_headers(
        headers: &NormalizedDashlaneHeaders,
    ) -> Result<Self, DashlaneImportError> {
        Ok(Self {
            kind: headers.required("type")?,
            number: headers.optional(&["number"]),
            name: headers.optional(&["name"]),
            issue_date: headers.optional(&["issue_date"]),
            expiration_date: headers.optional(&["expiration_date"]),
            place_of_issue: headers.optional(&["place_of_issue"]),
        })
    }

    pub(super) fn convert(&self, record: &StringRecord) -> (Vec<SecretValue>, usize) {
        let fields = CsvRecordFields::new(record);
        let kind = match fields.trimmed(self.kind).to_ascii_lowercase().as_str() {
            "card" | "id_card" | "idcard" => IdentityDocumentKind::NationalId,
            "passport" => IdentityDocumentKind::Passport,
            "license" | "driver_license" | "driving_licence" => {
                IdentityDocumentKind::DriversLicense
            }
            "social_security" => IdentityDocumentKind::SocialSecurity,
            "tax_number" => IdentityDocumentKind::TaxId,
            _ => {
                return ImportItemDisposition::Skipped(ImportSkipReason::UnsupportedKind)
                    .collected();
            }
        };
        PersonalImportItem {
            parts: vec![PersonalImportPart::document(IdentityDocumentFields {
                kind,
                number: &fields.optional(self.number),
                issuer: "",
                issuing_country: &fields.optional(self.place_of_issue),
                issue_date: &fields.optional(self.issue_date),
                expiry_date: &fields.optional(self.expiration_date),
                name_as_printed: &fields.optional(self.name),
            })],
        }
        .disposition()
        .collected()
    }
}

#[derive(Clone, Copy)]
pub(super) struct PersonalInfoColumns {
    kind: usize,
    first_name: CsvExportColumn,
    middle_name: CsvExportColumn,
    last_name: CsvExportColumn,
    date_of_birth: CsvExportColumn,
    item_name: CsvExportColumn,
    address: CsvExportColumn,
    address_apartment: CsvExportColumn,
    city: CsvExportColumn,
    state: CsvExportColumn,
    zip: CsvExportColumn,
    country: CsvExportColumn,
}

impl PersonalInfoColumns {
    pub(super) fn from_headers(
        headers: &NormalizedDashlaneHeaders,
    ) -> Result<Self, DashlaneImportError> {
        Ok(Self {
            kind: headers.required("type")?,
            first_name: headers.optional(&["first_name"]),
            middle_name: headers.optional(&["middle_name"]),
            last_name: headers.optional(&["last_name"]),
            date_of_birth: headers.optional(&["date_of_birth"]),
            item_name: headers.optional(&["item_name"]),
            address: headers.optional(&["address"]),
            address_apartment: headers.optional(&["address_apartment"]),
            city: headers.optional(&["city"]),
            state: headers.optional(&["state"]),
            zip: headers.optional(&["zip"]),
            country: headers.optional(&["country"]),
        })
    }

    pub(super) fn convert(&self, record: &StringRecord) -> (Vec<SecretValue>, usize) {
        let fields = CsvRecordFields::new(record);
        let part = match fields.trimmed(self.kind).to_ascii_lowercase().as_str() {
            "name" => PersonalImportPart::person(PersonFields {
                given_name: &fields.optional(self.first_name),
                middle_name: &fields.optional(self.middle_name),
                family_name: &fields.optional(self.last_name),
                birth_date: &fields.optional(self.date_of_birth),
                email: "",
                mobile_phone: "",
                home_phone: "",
                work_phone: "",
            }),
            "address" => PersonalImportPart::address(AddressFields {
                label: &fields.optional(self.item_name),
                address_line1: &fields.optional(self.address),
                address_line2: &fields.optional(self.address_apartment),
                city: &fields.optional(self.city),
                region: &fields.optional(self.state),
                postal_code: &fields.optional(self.zip),
                country: &fields.optional(self.country),
            }),
            _ => PersonalImportPart::Unsupported,
        };
        PersonalImportItem { parts: vec![part] }
            .disposition()
            .collected()
    }
}

/// Bank payment columns: one account number (an IBAN or a domestic number)
/// and one routing number (a BIC beside an IBAN, otherwise a US ABA number).
#[derive(Clone, Copy)]
pub(super) struct BankPaymentColumns {
    pub(super) account_holder: CsvExportColumn,
    pub(super) account_number: CsvExportColumn,
    pub(super) routing_number: CsvExportColumn,
    pub(super) issuing_bank: CsvExportColumn,
}

impl BankPaymentColumns {
    pub(super) fn from_headers(headers: &NormalizedDashlaneHeaders) -> Self {
        Self {
            account_holder: headers.optional(&["account_holder", "account holder"]),
            account_number: headers.optional(&["account_number", "account number"]),
            routing_number: headers.optional(&["routing_number", "routing number"]),
            issuing_bank: headers.optional(&["issuing_bank", "bank_name"]),
        }
    }

    pub(super) fn convert(&self, record: &StringRecord) -> (Vec<SecretValue>, usize) {
        let fields = CsvRecordFields::new(record);
        let account_number = fields.optional(self.account_number);
        let routing_number = fields.optional(self.routing_number);
        let bank_name = fields.optional(self.issuing_bank);
        let account_holder = fields.optional(self.account_holder);
        let bank = match (ExportedAccountNumber {
            raw: &account_number,
        })
        .kind()
        {
            ExportedAccountNumberKind::Iban(iban) => BankImportFields {
                account_holder: &account_holder,
                bank_name: &bank_name,
                iban,
                swift_bic: &routing_number,
                account_number: "",
                routing_number: "",
            },
            ExportedAccountNumberKind::Domestic(number) => BankImportFields {
                account_holder: &account_holder,
                bank_name: &bank_name,
                iban: "",
                swift_bic: "",
                account_number: number,
                routing_number: &routing_number,
            },
        };
        PersonalImportItem {
            parts: PersonalImportPart::banks(&bank),
        }
        .disposition()
        .collected()
    }
}

#[cfg(test)]
mod tests {
    use super::super::{DashlaneCsvInput, DashlaneCsvSelection};
    use crate::{IdentityDocumentKind, SecretValue};

    #[test]
    fn ids_map_every_document_type_and_skip_invalid_rows() -> anyhow::Result<()> {
        let text = concat!(
            "type,number,name,issue_date,expiration_date,place_of_issue,state\n",
            "card,ID998877,Ada Lovelace,2021-03-01,2031-03-01,GB,\n",
            "passport,X1234567,ADA LOVELACE,2020-01-15,2030-01-14,GB,\n",
            "license,D1234567,Ada Lovelace,,2030-12,US,CA\n",
            "social_security,123-45-6789,Ada Lovelace,,,US,\n",
            "tax_number,DE 123 456 789,Ada Lovelace,,,DE,\n",
            "social_security,000-00-0000,Ada Lovelace,,,US,\n",
            "passport,X7654321,Ada Lovelace,2030-01-15,2020-01-14,GB,\n",
            "loyalty,42,Ada Lovelace,,,,\n",
        );
        let plan = DashlaneCsvInput {
            text,
            selection: DashlaneCsvSelection::Detect,
        }
        .check()?
        .collect()?;
        assert_eq!(usize::from(plan.source_count), 8);
        assert_eq!(usize::from(plan.skipped_unsupported), 3);
        let kinds: Vec<IdentityDocumentKind> = plan
            .items
            .iter()
            .filter_map(|item| match item {
                SecretValue::IdentityDocument(document) => Some(document.kind),
                _ => None,
            })
            .collect();
        assert_eq!(
            kinds,
            [
                IdentityDocumentKind::NationalId,
                IdentityDocumentKind::Passport,
                IdentityDocumentKind::DriversLicense,
                IdentityDocumentKind::SocialSecurity,
                IdentityDocumentKind::TaxId
            ]
        );
        let Some(SecretValue::IdentityDocument(license)) = plan.items.get(2) else {
            anyhow::bail!("expected the license");
        };
        assert_eq!(license.expiry_date, "2030-12");
        Ok(())
    }

    #[test]
    fn personal_info_maps_name_and_address_rows() -> anyhow::Result<()> {
        let text = concat!(
            "type,title,first_name,middle_name,last_name,login,date_of_birth,place_of_birth,",
            "email,email_type,item_name,phone_number,address,city,state,state_code,state_number,",
            "zip,address_recipient,address_building,address_apartment,address_floor,",
            "address_door_code,job_title,url\n",
            "name,Ms,Ada,,Lovelace,,1815-12-10,London,,,,,,,,,,,,,,,,,\n",
            "address,,,,,,,,,,Home,,12 Analytical Row,London,Greater London,,,W1 1AA,,,Flat 3,,,,\n",
            "email,,,,,,,,ada@example.com,personal,Personal,,,,,,,,,,,,,,\n",
            "name,,Ada,,,,1815-02-30,,,,,,,,,,,,,,,,,,\n",
        );
        let plan = DashlaneCsvInput {
            text,
            selection: DashlaneCsvSelection::Detect,
        }
        .check()?
        .collect()?;
        assert_eq!(usize::from(plan.source_count), 4);
        assert_eq!(usize::from(plan.skipped_unsupported), 2);
        let [SecretValue::Person(person), SecretValue::Address(address)] = plan.items.as_slice()
        else {
            anyhow::bail!("expected person then address");
        };
        assert_eq!(person.full_name(), "Ada Lovelace");
        assert_eq!(person.birth_date, "1815-12-10");
        assert_eq!(address.label, "Home");
        assert_eq!(address.address_line2, "Flat 3");
        assert_eq!(address.postal_code, "W1 1AA");
        Ok(())
    }

    #[test]
    fn bank_payments_become_international_or_domestic_accounts() -> anyhow::Result<()> {
        let text = concat!(
            "type,account_name,account_holder,cc_number,code,expiration_month,expiration_year,",
            "routing_number,account_number,country,issuing_bank\n",
            "bank,Euro account,Ada Lovelace,,,,,COBADEFFXXX,DE89370400440532013000,DE,Commerzbank\n",
            "bank,Checking,Ada Lovelace,,,,,021000021,000123456789,US,\n",
            "bank,Bad routing,Ada Lovelace,,,,,021000022,000123456789,US,\n",
            "bank,No routing,Ada Lovelace,,,,,,000123456789,US,\n",
        );
        let plan = DashlaneCsvInput {
            text,
            selection: DashlaneCsvSelection::Detect,
        }
        .check()?
        .collect()?;
        assert_eq!(usize::from(plan.source_count), 4);
        assert_eq!(usize::from(plan.skipped_unsupported), 2);
        let [
            SecretValue::InternationalAccount(international),
            SecretValue::DomesticAccount(domestic),
        ] = plan.items.as_slice()
        else {
            anyhow::bail!("expected international then domestic account");
        };
        assert_eq!(international.bank_name, "Commerzbank");
        assert_eq!(international.swift_bic, "COBADEFFXXX");
        assert!(domestic.bank_name.is_empty());
        assert_eq!(domestic.routing_number, "021000021");
        Ok(())
    }
}
