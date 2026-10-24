//! Typed `LastPass` secure notes: Address, Bank Account, Driver's License,
//! Passport, and Credit Card.
//!
//! `LastPass` exports these as secure notes (`url` = `http://sn`) whose `extra`
//! text starts with `NoteType:<type>` followed by `Key:Value` lines; `Notes:`
//! holds the remaining free text. Dates are written `Month,Day,Year` and phone
//! numbers as small JSON objects. Other note types stay secure notes.

use crate::secrets::import_support::personal::{
    BankImportFields, MonthNameDate, PersonalImportItem, PersonalImportPart,
};
use crate::secrets::import_support::{ImportItemDisposition, ImportSkipReason};
use crate::{
    AddressFields, CreditCardFields, CreditCardSecret, IdentityDocumentFields,
    IdentityDocumentKind, PersonFields, SecretValue,
};
use std::collections::HashMap;

/// Parsed `NoteType:` secure-note fields.
pub(super) struct LastPassTypedNote {
    note_type: String,
    fields: HashMap<String, String>,
}

const MONTH_NAMES: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

impl LastPassTypedNote {
    /// Parse `extra` when it starts with a `NoteType:` line.
    pub(super) fn parse(extra: &str) -> Option<Self> {
        let mut lines = extra.lines();
        let note_type = lines
            .next()?
            .trim()
            .strip_prefix("NoteType:")?
            .trim()
            .to_owned();
        let mut fields = HashMap::new();
        let mut notes: Vec<&str> = Vec::new();
        let mut in_notes = false;
        for line in lines {
            if in_notes {
                notes.push(line);
                continue;
            }
            if let Some(first) = line.strip_prefix("Notes:") {
                in_notes = true;
                notes.push(first);
                continue;
            }
            if let Some((key, value)) = line.split_once(':') {
                fields.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
            }
        }
        fields.insert("notes".to_owned(), notes.join("\n").trim().to_owned());
        Some(Self { note_type, fields })
    }

    fn field(&self, key: &str) -> &str {
        self.fields.get(key).map_or("", String::as_str)
    }

    /// `LastPass` stores phones as `{"num":"…","ext":"…","cc3l":"…"}`.
    fn phone(&self, key: &str) -> String {
        let raw = self.field(key);
        match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(serde_json::Value::Object(phone)) => phone
                .get("num")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_owned(),
            _ => raw.to_owned(),
        }
    }

    fn date(&self, key: &str) -> String {
        MonthNameDate {
            raw: self.field(key),
        }
        .iso()
    }

    /// Convert a supported note type; other types keep secure-note handling.
    pub(super) fn disposition(&self, name: &str) -> Option<ImportItemDisposition> {
        match self.note_type.as_str() {
            "Address" => Some(self.address(name)),
            "Bank Account" => Some(self.bank_account()),
            "Driver's License" => Some(self.document(IdentityDocumentKind::DriversLicense)),
            "Passport" => Some(self.document(IdentityDocumentKind::Passport)),
            "Credit Card" => Some(self.credit_card(name)),
            _ => None,
        }
    }

    fn address(&self, name: &str) -> ImportItemDisposition {
        let phone = ["mobile phone", "phone", "evening phone"]
            .iter()
            .map(|key| self.phone(key))
            .find(|phone| !phone.is_empty())
            .unwrap_or_default();
        let address_line2 = [self.field("address 2"), self.field("address 3")]
            .into_iter()
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        PersonalImportItem {
            parts: vec![
                PersonalImportPart::person(PersonFields {
                    given_name: self.field("first name"),
                    middle_name: self.field("middle name"),
                    family_name: self.field("last name"),
                    birth_date: &self.date("birthday"),
                    email: self.field("email address"),
                    phone: &phone,
                }),
                PersonalImportPart::address(AddressFields {
                    label: name,
                    address_line1: self.field("address 1"),
                    address_line2: &address_line2,
                    city: self.field("city / town"),
                    region: self.field("state"),
                    postal_code: self.field("zip / postal code"),
                    country: self.field("country"),
                }),
            ],
        }
        .disposition()
    }

    fn bank_account(&self) -> ImportItemDisposition {
        PersonalImportItem {
            parts: vec![PersonalImportPart::bank(&BankImportFields {
                account_holder: "",
                bank_name: self.field("bank name"),
                iban: self.field("iban number"),
                swift_bic: self.field("swift code"),
                account_number: self.field("account number"),
                routing_number: self.field("routing number"),
            })],
        }
        .disposition()
    }

    fn document(&self, kind: IdentityDocumentKind) -> ImportItemDisposition {
        let issuing_country = match self.field("country") {
            "" => self.field("state"),
            country => country,
        };
        PersonalImportItem {
            parts: vec![PersonalImportPart::document(IdentityDocumentFields {
                kind,
                number: self.field("number"),
                issuing_country,
                issue_date: &self.date("issued date"),
                expiry_date: &self.date("expiration date"),
                name_as_printed: self.field("name"),
            })],
        }
        .disposition()
    }

    /// Card expiry is `Month,Year` (`January,2030`).
    fn credit_card(&self, name: &str) -> ImportItemDisposition {
        let (month, year) = match self.field("expiration date").split_once(',') {
            Some((month, year)) => (
                MONTH_NAMES
                    .iter()
                    .position(|candidate| candidate.eq_ignore_ascii_case(month.trim()))
                    .map_or_else(
                        || month.trim().to_owned(),
                        |index| format!("{:02}", index + 1),
                    ),
                year.trim().to_owned(),
            ),
            None => (String::new(), String::new()),
        };
        CreditCardSecret::from_fields(CreditCardFields {
            title: name,
            cardholder_name: self.field("name on card"),
            number: self.field("number"),
            expiration_month: &month,
            expiration_year: &year,
            cvv: self.field("security code"),
            notes: self.field("notes"),
        })
        .map_or(
            ImportItemDisposition::Skipped(ImportSkipReason::InvalidCard),
            |card| ImportItemDisposition::Imported(SecretValue::CreditCard(card)),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::super::LastPassCsvInput;
    use crate::{IdentityDocumentKind, SecretValue};

    const HEADER: &str = "url,username,password,totp,extra,name,grouping,fav\n";

    fn csv(rows: &[(&str, &str)]) -> String {
        let body = rows
            .iter()
            .map(|(name, extra)| {
                format!(
                    "http://sn,,,,\"{}\",{name},Personal,0\n",
                    extra.replace('"', "\"\"")
                )
            })
            .collect::<Vec<_>>()
            .concat();
        format!("{HEADER}{body}")
    }

    #[test]
    fn address_notes_produce_person_and_address() -> anyhow::Result<()> {
        let text = csv(&[(
            "Home",
            "NoteType:Address\nLanguage:en-US\nTitle:ms\nFirst Name:Ada\nMiddle Name:\nLast Name:Lovelace\nUsername:\nGender:f\nBirthday:December,10,1815\nCompany:\nAddress 1:12 Analytical Row\nAddress 2:Flat 3\nAddress 3:\nCity / Town:London\nCounty:\nState:Greater London\nZip / Postal Code:W1 1AA\nCountry:GB\nTimezone:\nEmail Address:ada@example.com\nPhone:{\"num\":\"2079460958\",\"ext\":\"\",\"cc3l\":\"GBR\"}\nEvening Phone:\nMobile Phone:\nFax:\nNotes:",
        )]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        assert_eq!(usize::from(plan.source_count), 1);
        let [SecretValue::Person(person), SecretValue::Address(address)] = plan.items.as_slice()
        else {
            anyhow::bail!("expected person and address");
        };
        assert_eq!(person.birth_date, "1815-12-10");
        assert_eq!(person.phone, "2079460958");
        assert_eq!(address.label, "Home");
        assert_eq!(address.city, "London");
        Ok(())
    }

    #[test]
    fn documents_banks_and_cards_map_to_typed_records() -> anyhow::Result<()> {
        let text = csv(&[
            (
                "Passport",
                "NoteType:Passport\nType:P\nName:ADA LOVELACE\nCountry:GB\nNumber:X1234567\nSex:F\nNationality:British\nIssuing Authority:HMPO\nDate of Birth:December,10,1815\nIssued Date:January,15,2020\nExpiration Date:January,14,2030\nNotes:",
            ),
            (
                "License",
                "NoteType:Driver's License\nNumber:D1234567\nExpiration Date:December,31,2030\nLicense Class:C\nName:Ada Lovelace\nAddress:\nCity / Town:\nState:CA\nZIP / Postal Code:\nCountry:\nDate of Birth:\nSex:\nHeight:\nNotes:",
            ),
            (
                "Checking",
                "NoteType:Bank Account\nBank Name:Federal Bank\nAccount Type:Checking\nRouting Number:021000021\nAccount Number:000123456789\nSWIFT Code:\nIBAN Number:\nPin:1234\nBranch Address:\nBranch Phone:\nNotes:",
            ),
            (
                "Visa",
                "NoteType:Credit Card\nLanguage:en-US\nName on Card:Ada Lovelace\nType:Visa\nNumber:4111111111111111\nSecurity Code:123\nStart Date:,\nExpiration Date:July,2031\nNotes:billing\nsecond line",
            ),
        ]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        assert_eq!(usize::from(plan.source_count), 4);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let [
            SecretValue::IdentityDocument(passport),
            SecretValue::IdentityDocument(license),
            SecretValue::DomesticAccount(account),
            SecretValue::CreditCard(card),
        ] = plan.items.as_slice()
        else {
            anyhow::bail!("expected passport, license, account and card");
        };
        assert_eq!(passport.kind, IdentityDocumentKind::Passport);
        assert_eq!(passport.issue_date, "2020-01-15");
        assert_eq!(passport.expiry_date, "2030-01-14");
        assert_eq!(license.issuing_country, "CA");
        assert_eq!(license.expiry_date, "2030-12-31");
        assert_eq!(account.bank_name, "Federal Bank");
        assert_eq!(card.expiration_month, "07");
        assert_eq!(card.expiration_year, "2031");
        assert_eq!(card.notes, "billing\nsecond line");
        Ok(())
    }

    #[test]
    fn invalid_typed_notes_are_skipped_and_other_types_stay_notes() -> anyhow::Result<()> {
        let text = csv(&[
            (
                "Bad bank",
                "NoteType:Bank Account\nBank Name:Bank\nRouting Number:021000022\nAccount Number:000123456789\nNotes:",
            ),
            (
                "Bad passport",
                "NoteType:Passport\nNumber:X1\nExpiration Date:Smarch,1,2030\nNotes:",
            ),
            (
                "SSN",
                "NoteType:Social Security\nName:Ada\nNumber:000-00-0000\nNotes:",
            ),
        ]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        assert_eq!(usize::from(plan.source_count), 3);
        assert_eq!(usize::from(plan.skipped_unsupported), 2);
        let [SecretValue::SecureNote(note)] = plan.items.as_slice() else {
            anyhow::bail!("expected the social security note");
        };
        assert_eq!(note.title, "SSN");
        Ok(())
    }
}
