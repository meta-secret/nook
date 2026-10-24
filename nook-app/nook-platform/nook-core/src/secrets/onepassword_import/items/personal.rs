//! 1Password Identity, Passport, Driver License, and Bank Account items.
//!
//! 1PUX stores these as typed section fields addressed by stable ids
//! (`firstname`, `number`, `iban`, …). Dates are Unix seconds; addresses are
//! structured objects. Fields without a Nook equivalent (sex, height, class,
//! occupation, PIN, account type, …) are not imported.

use super::{OnePasswordSection, OnePasswordVaultItem};
use crate::secrets::import_support::ImportItemDisposition;
use crate::secrets::import_support::personal::{
    BankImportFields, PersonalImportItem, PersonalImportPart, UnixDate,
};
use crate::{AddressFields, IdentityDocumentFields, IdentityDocumentKind, PersonFields};
use serde_json::Value;

pub(super) const IDENTITY_CATEGORY_UUID: &str = "004";
pub(super) const BANK_ACCOUNT_CATEGORY_UUID: &str = "101";
pub(super) const DRIVER_LICENSE_CATEGORY_UUID: &str = "103";
pub(super) const PASSPORT_CATEGORY_UUID: &str = "106";

/// Section fields of one item, addressed by their 1PUX field id.
struct OnePasswordTypedFields<'a> {
    sections: &'a [OnePasswordSection],
}

/// Structured 1PUX address components.
#[derive(Default)]
struct OnePasswordAddress {
    street: String,
    city: String,
    state: String,
    zip: String,
    country: String,
}

impl OnePasswordTypedFields<'_> {
    fn value(&self, id: &str) -> Option<&Value> {
        self.sections
            .iter()
            .flat_map(|section| section.fields.iter())
            .find(|field| field.id.trim().eq_ignore_ascii_case(id))
            .map(|field| &field.value)
    }

    /// Text of a scalar or wrapped scalar (`{"string": …}`, `{"email": …}`, …).
    fn text(&self, id: &str) -> String {
        self.value(id).map(Self::scalar_text).unwrap_or_default()
    }

    fn scalar_text(value: &Value) -> String {
        match value {
            Value::String(text) => text.trim().to_owned(),
            Value::Number(number) => number.to_string(),
            Value::Object(wrapped) => [
                "string",
                "concealed",
                "email",
                "phone",
                "menu",
                "email_address",
            ]
            .iter()
            .find_map(|key| wrapped.get(*key))
            .map(Self::scalar_text)
            .unwrap_or_default(),
            Value::Null | Value::Bool(_) | Value::Array(_) => String::new(),
        }
    }

    /// ISO date from Unix seconds (`{"date": 1577836800}`); other text is kept
    /// so that validation reports it rather than dropping it.
    fn date(&self, id: &str) -> String {
        match self.value(id) {
            Some(Value::Object(wrapped)) => match wrapped.get("date") {
                Some(Value::Number(seconds)) => seconds
                    .as_i64()
                    .map_or_else(|| seconds.to_string(), |seconds| UnixDate { seconds }.iso()),
                Some(other) => Self::scalar_text(other),
                None => String::new(),
            },
            Some(Value::Number(seconds)) => seconds
                .as_i64()
                .map_or_else(|| seconds.to_string(), |seconds| UnixDate { seconds }.iso()),
            Some(other) => Self::scalar_text(other),
            None => String::new(),
        }
    }

    fn address(&self, id: &str) -> OnePasswordAddress {
        let Some(Value::Object(wrapped)) = self.value(id) else {
            return OnePasswordAddress::default();
        };
        let Some(Value::Object(address)) = wrapped.get("address") else {
            return OnePasswordAddress::default();
        };
        let part = |key: &str| address.get(key).map(Self::scalar_text).unwrap_or_default();
        OnePasswordAddress {
            street: part("street"),
            city: part("city"),
            state: part("state"),
            zip: part("zip"),
            country: part("country"),
        }
    }
}

impl OnePasswordVaultItem<'_> {
    fn typed_fields(&self) -> OnePasswordTypedFields<'_> {
        OnePasswordTypedFields {
            sections: &self.item.details.sections,
        }
    }

    /// Identity → person (names, birth date, email, phone) and address.
    pub(super) fn identity(&self) -> ImportItemDisposition {
        let fields = self.typed_fields();
        let address = fields.address("address");
        let phone = ["defphone", "cellphone", "homephone", "busphone"]
            .iter()
            .map(|id| fields.text(id))
            .find(|phone| !phone.is_empty())
            .unwrap_or_default();
        PersonalImportItem {
            parts: vec![
                PersonalImportPart::person(PersonFields {
                    given_name: &fields.text("firstname"),
                    middle_name: &fields.text("initial"),
                    family_name: &fields.text("lastname"),
                    birth_date: &fields.date("birthdate"),
                    email: &fields.text("email"),
                    phone: &phone,
                }),
                PersonalImportPart::address(AddressFields {
                    label: self.item.overview.title.trim(),
                    address_line1: &address.street,
                    address_line2: "",
                    city: &address.city,
                    region: &address.state,
                    postal_code: &address.zip,
                    country: &address.country,
                }),
            ],
        }
        .disposition()
    }

    /// Passport → identity document with issue and expiry dates.
    pub(super) fn passport(&self) -> ImportItemDisposition {
        let fields = self.typed_fields();
        PersonalImportItem {
            parts: vec![PersonalImportPart::document(IdentityDocumentFields {
                kind: IdentityDocumentKind::Passport,
                number: &fields.text("number"),
                issuing_country: &fields.text("issuing_country"),
                issue_date: &fields.date("issue_date"),
                expiry_date: &fields.date("expiry_date"),
                name_as_printed: &fields.text("fullname"),
            })],
        }
        .disposition()
    }

    /// Driver License → identity document. Its month-and-year expiry names no
    /// calendar day, so it is not imported.
    pub(super) fn driver_license(&self) -> ImportItemDisposition {
        let fields = self.typed_fields();
        PersonalImportItem {
            parts: vec![PersonalImportPart::document(IdentityDocumentFields {
                kind: IdentityDocumentKind::DriversLicense,
                number: &fields.text("number"),
                issuing_country: &fields.text("country"),
                issue_date: "",
                expiry_date: "",
                name_as_printed: &fields.text("fullname"),
            })],
        }
        .disposition()
    }

    /// Bank Account → international (IBAN) or US domestic account.
    pub(super) fn bank_account(&self) -> ImportItemDisposition {
        let fields = self.typed_fields();
        PersonalImportItem {
            parts: vec![PersonalImportPart::bank(&BankImportFields {
                account_holder: &fields.text("owner"),
                bank_name: &fields.text("bankName"),
                iban: &fields.text("iban"),
                swift_bic: &fields.text("swift"),
                account_number: &fields.text("accountNo"),
                routing_number: &fields.text("routingNo"),
            })],
        }
        .disposition()
    }
}

#[cfg(test)]
mod tests {
    use super::super::ExportData;
    use crate::{IdentityDocumentKind, SecretValue};

    struct OnePasswordFixture<'a> {
        category: &'a str,
        title: &'a str,
        fields: &'a str,
    }

    impl OnePasswordFixture<'_> {
        fn json(&self) -> String {
            format!(
                r#"{{"accounts":[{{"vaults":[{{"attrs":{{"name":"Personal"}},"items":[{{"categoryUuid":"{}","overview":{{"title":"{}"}},"details":{{"sections":[{{"title":"Details","fields":[{}]}}]}}}}]}}]}}]}}"#,
                self.category, self.title, self.fields
            )
        }
    }

    #[test]
    fn identity_produces_person_and_structured_address() -> anyhow::Result<()> {
        let json = OnePasswordFixture {
            category: "004",
            title: "Home identity",
            fields: r#"{"id":"firstname","value":{"string":"Ada"}},
              {"id":"initial","value":{"string":"A"}},
              {"id":"lastname","value":{"string":"Lovelace"}},
              {"id":"sex","value":{"menu":"female"}},
              {"id":"birthdate","value":{"date":951782400}},
              {"id":"address","value":{"address":{"street":"12 Analytical Row","city":"London","state":"Greater London","zip":"W1 1AA","country":"gb"}}},
              {"id":"defphone","value":{"phone":"+44 20 7946 0958"}},
              {"id":"email","value":{"email":{"email_address":"ada@example.com","provider":null}}}"#,
        }
        .json();
        let plan = ExportData::parse(&json)?.plan();
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let [SecretValue::Person(person), SecretValue::Address(address)] = plan.items.as_slice()
        else {
            anyhow::bail!("expected person and address");
        };
        assert_eq!(person.full_name(), "Ada A Lovelace");
        assert_eq!(person.birth_date, "2000-02-29");
        assert_eq!(person.email, "ada@example.com");
        assert_eq!(person.phone, "+44 20 7946 0958");
        assert_eq!(address.label, "Home identity");
        assert_eq!(address.address_line1, "12 Analytical Row");
        assert_eq!(address.postal_code, "W1 1AA");
        assert_eq!(address.country, "gb");
        Ok(())
    }

    #[test]
    fn passport_and_driver_license_produce_documents() -> anyhow::Result<()> {
        let passport = OnePasswordFixture {
            category: "106",
            title: "Passport",
            fields: r#"{"id":"type","value":{"string":"P"}},
              {"id":"issuing_country","value":{"string":"GB"}},
              {"id":"number","value":{"string":"X1234567"}},
              {"id":"fullname","value":{"string":"ADA LOVELACE"}},
              {"id":"issue_date","value":{"date":1577836800}},
              {"id":"expiry_date","value":{"date":1893456000}}"#,
        }
        .json();
        let plan = ExportData::parse(&passport)?.plan();
        let [SecretValue::IdentityDocument(document)] = plan.items.as_slice() else {
            anyhow::bail!("expected passport");
        };
        assert_eq!(document.kind, IdentityDocumentKind::Passport);
        assert_eq!(document.issue_date, "2020-01-01");
        assert_eq!(document.expiry_date, "2030-01-01");
        assert_eq!(document.issuing_country, "GB");

        let license = OnePasswordFixture {
            category: "103",
            title: "License",
            fields: r#"{"id":"fullname","value":{"string":"Ada Lovelace"}},
              {"id":"number","value":{"string":"D1234567"}},
              {"id":"class","value":{"string":"C"}},
              {"id":"state","value":{"string":"CA"}},
              {"id":"expiry_date","value":{"monthYear":203012}}"#,
        }
        .json();
        let plan = ExportData::parse(&license)?.plan();
        let [SecretValue::IdentityDocument(document)] = plan.items.as_slice() else {
            anyhow::bail!("expected driver license");
        };
        assert_eq!(document.kind, IdentityDocumentKind::DriversLicense);
        assert!(document.issuing_country.is_empty());
        assert!(document.expiry_date.is_empty());
        Ok(())
    }

    #[test]
    fn bank_accounts_choose_iban_or_us_routing_and_skip_others() -> anyhow::Result<()> {
        for (fields, expected_international) in [
            (
                r#"{"id":"bankName","value":{"string":"Analytical Bank"}},
                  {"id":"owner","value":{"string":"Ada Lovelace"}},
                  {"id":"iban","value":{"string":"GB82 WEST 1234 5698 7654 32"}},
                  {"id":"swift","value":{"string":"NWBKGB2L"}},
                  {"id":"telephonePin","value":{"concealed":"1234"}}"#,
                true,
            ),
            (
                r#"{"id":"bankName","value":{"string":"Federal Bank"}},
                  {"id":"accountType","value":{"menu":"checking"}},
                  {"id":"routingNo","value":{"string":"021000021"}},
                  {"id":"accountNo","value":{"string":"000123456789"}}"#,
                false,
            ),
        ] {
            let json = OnePasswordFixture {
                category: "101",
                title: "Bank",
                fields,
            }
            .json();
            let plan = ExportData::parse(&json)?.plan();
            match (plan.items.as_slice(), expected_international) {
                ([SecretValue::InternationalAccount(account)], true) => {
                    assert_eq!(account.iban, "GB82WEST12345698765432");
                    assert_eq!(account.swift_bic, "NWBKGB2L");
                }
                ([SecretValue::DomesticAccount(account)], false) => {
                    assert_eq!(account.routing_number, "021000021");
                }
                _ => anyhow::bail!("unexpected bank records"),
            }
        }
        for fields in [
            r#"{"id":"accountNo","value":{"string":"000123456789"}}"#,
            r#"{"id":"iban","value":{"string":"GB82WEST12345698765433"}}"#,
        ] {
            let json = OnePasswordFixture {
                category: "101",
                title: "Bank",
                fields,
            }
            .json();
            let plan = ExportData::parse(&json)?.plan();
            assert!(plan.items.is_empty());
            assert_eq!(usize::from(plan.skipped_unsupported), 1);
        }
        Ok(())
    }

    #[test]
    fn invalid_identity_dates_skip_the_item() -> anyhow::Result<()> {
        let json = OnePasswordFixture {
            category: "004",
            title: "Identity",
            fields: r#"{"id":"firstname","value":{"string":"Ada"}},
              {"id":"birthdate","value":{"date":"tomorrow"}}"#,
        }
        .json();
        let plan = ExportData::parse(&json)?.plan();
        assert!(plan.items.is_empty());
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        Ok(())
    }
}
