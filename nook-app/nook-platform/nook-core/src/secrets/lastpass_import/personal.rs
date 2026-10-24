//! Typed `LastPass` secure notes: Address, Bank Account, Driver's License,
//! Passport, Social Security, Membership, and Credit Card.
//!
//! `LastPass` exports these as secure notes (`url` = `http://sn`) whose `extra`
//! text starts with `NoteType:<type>` followed by `Key:Value` lines; `Notes:`
//! holds the remaining free text. Dates are written `Month,Day,Year` and phone
//! numbers as small JSON objects. Other note types stay secure notes.
//!
//! A typed note whose free text or other fields have no Nook mapping also
//! imports as a secure note, so its original text is kept alongside the
//! typed records.

use crate::secrets::import_support::personal::{
    BankImportFields, MonthName, MonthNameDate, PersonalImportItem, PersonalImportPart,
};
use crate::secrets::import_support::{ImportItemDisposition, ImportSkipReason};
use crate::secrets::personal_data::PresentParts;
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

/// Export metadata naming the note template language (`en-US`).
const EXPORT_LANGUAGE_KEY: &str = "language";

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

    /// Document dates keep month precision when the day is blank.
    fn document_date(&self, key: &str) -> String {
        MonthNameDate {
            raw: self.field(key),
        }
        .document_iso()
    }

    /// Convert a supported note type; other types keep secure-note handling.
    pub(super) fn disposition(&self, name: &str) -> Option<ImportItemDisposition> {
        match self.note_type.as_str() {
            "Address" => Some(self.address(name)),
            "Bank Account" => Some(self.bank_account()),
            "Driver's License" => Some(self.document(IdentityDocumentKind::DriversLicense)),
            "Passport" => Some(self.document(IdentityDocumentKind::Passport)),
            "Social Security" => Some(self.social_security()),
            "Membership" => Some(self.membership()),
            "Credit Card" => Some(self.credit_card(name)),
            _ => None,
        }
    }

    /// The field filling the mobile phone: `Mobile Phone`, or the unlabelled
    /// `Phone` when no mobile phone is stored. Beside a mobile phone the
    /// unlabelled phone stays in the kept secure note.
    fn mobile_phone_key(&self) -> &'static str {
        if self.phone("mobile phone").is_empty() {
            "phone"
        } else {
            "mobile phone"
        }
    }

    /// Fields this note's typed records consume.
    fn mapped_keys(&self) -> Vec<&'static str> {
        match self.note_type.as_str() {
            "Address" => vec![
                "first name",
                "middle name",
                "last name",
                "birthday",
                "email address",
                self.mobile_phone_key(),
                "evening phone",
                "address 1",
                "address 2",
                "address 3",
                "city / town",
                "state",
                "zip / postal code",
                "country",
            ],
            "Bank Account" => {
                let mut keys = vec!["bank name"];
                if !self.field("iban number").is_empty() {
                    keys.extend(["iban number", "swift code"]);
                }
                if !self.field("account number").is_empty()
                    && !self.field("routing number").is_empty()
                {
                    keys.extend(["account number", "routing number"]);
                }
                keys
            }
            "Driver's License" => vec![
                "number",
                "country",
                "issued date",
                "expiration date",
                "name",
            ],
            "Passport" => vec![
                "number",
                "country",
                "issuing authority",
                "issued date",
                "expiration date",
                "name",
            ],
            "Social Security" => vec!["number", "name"],
            "Membership" => vec![
                "organization",
                "membership number",
                "member name",
                "start date",
                "expiration date",
            ],
            "Credit Card" => vec![
                "name on card",
                "number",
                "security code",
                "expiration date",
                "notes",
            ],
            _ => Vec::new(),
        }
    }

    /// Whether free text or any non-empty field has no typed mapping.
    /// `LastPass` writes blank dates as bare commas, and `Language` is
    /// export metadata rather than user data.
    pub(super) fn has_unmapped_values(&self) -> bool {
        let mapped = self.mapped_keys();
        self.fields.iter().any(|(key, value)| {
            !mapped.contains(&key.as_str())
                && key != EXPORT_LANGUAGE_KEY
                && value
                    .chars()
                    .any(|character| character != ',' && !character.is_whitespace())
        })
    }

    fn address(&self, name: &str) -> ImportItemDisposition {
        let address_line2 = PresentParts {
            parts: &[self.field("address 2"), self.field("address 3")],
            separator: ", ",
        }
        .joined();
        PersonalImportItem {
            parts: vec![
                PersonalImportPart::person(PersonFields {
                    given_name: self.field("first name"),
                    middle_name: self.field("middle name"),
                    family_name: self.field("last name"),
                    birth_date: &self.date("birthday"),
                    email: self.field("email address"),
                    mobile_phone: &self.phone(self.mobile_phone_key()),
                    // The evening phone is the home phone; LastPass has no
                    // work phone field.
                    home_phone: &self.phone("evening phone"),
                    work_phone: "",
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
            parts: PersonalImportPart::banks(&BankImportFields {
                account_holder: "",
                bank_name: self.field("bank name"),
                iban: self.field("iban number"),
                swift_bic: self.field("swift code"),
                account_number: self.field("account number"),
                routing_number: self.field("routing number"),
            }),
        }
        .disposition()
    }

    fn document(&self, kind: IdentityDocumentKind) -> ImportItemDisposition {
        PersonalImportItem {
            parts: vec![PersonalImportPart::document(IdentityDocumentFields {
                kind,
                number: self.field("number"),
                issuer: self.field("issuing authority"),
                issuing_country: self.field("country"),
                issue_date: &self.document_date("issued date"),
                expiry_date: &self.document_date("expiration date"),
                name_as_printed: self.field("name"),
            })],
        }
        .disposition()
    }

    fn social_security(&self) -> ImportItemDisposition {
        PersonalImportItem {
            parts: vec![PersonalImportPart::document(IdentityDocumentFields {
                kind: IdentityDocumentKind::SocialSecurity,
                number: self.field("number"),
                issuer: "",
                issuing_country: "",
                issue_date: "",
                expiry_date: "",
                name_as_printed: self.field("name"),
            })],
        }
        .disposition()
    }

    /// The membership start date is its issue date.
    fn membership(&self) -> ImportItemDisposition {
        PersonalImportItem {
            parts: vec![PersonalImportPart::document(IdentityDocumentFields {
                kind: IdentityDocumentKind::Membership,
                number: self.field("membership number"),
                issuer: self.field("organization"),
                issuing_country: "",
                issue_date: &self.document_date("start date"),
                expiry_date: &self.document_date("expiration date"),
                name_as_printed: self.field("member name"),
            })],
        }
        .disposition()
    }

    /// Card expiry is `Month,Year` (`January,2030`).
    fn credit_card(&self, name: &str) -> ImportItemDisposition {
        let (month, year) = match self.field("expiration date").split_once(',') {
            Some((month, year)) => (
                (MonthName { name: month })
                    .number()
                    .map_or_else(|| month.trim().to_owned(), |number| format!("{number:02}")),
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
    fn fully_mapped_address_with_export_language_gives_person_and_address_only()
    -> anyhow::Result<()> {
        let text = csv(&[(
            "Home",
            "NoteType:Address\nLanguage:en-US\nTitle:\nFirst Name:Ada\nMiddle Name:\nLast Name:Lovelace\nUsername:\nGender:\nBirthday:December,10,1815\nCompany:\nAddress 1:12 Analytical Row\nAddress 2:Flat 3\nAddress 3:\nCity / Town:London\nCounty:\nState:Greater London\nZip / Postal Code:W1 1AA\nCountry:GB\nTimezone:\nEmail Address:ada@example.com\nPhone:{\"num\":\"2079460958\",\"ext\":\"\",\"cc3l\":\"GBR\"}\nEvening Phone:\nMobile Phone:\nFax:\nNotes:",
        )]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        assert_eq!(usize::from(plan.source_count), 1);
        let [SecretValue::Person(person), SecretValue::Address(address)] = plan.items.as_slice()
        else {
            anyhow::bail!("expected person and address only");
        };
        assert_eq!(person.birth_date, "1815-12-10");
        assert_eq!(person.mobile_phone, "2079460958");
        assert!(person.home_phone.is_empty());
        assert_eq!(address.label, "Home");
        assert_eq!(address.city, "London");
        Ok(())
    }

    #[test]
    fn unmapped_fields_and_free_text_also_keep_the_whole_secure_note() -> anyhow::Result<()> {
        let extra = "NoteType:Address\nLanguage:en-US\nFirst Name:Ada\nLast Name:Lovelace\nGender:f\nAddress 1:12 Analytical Row\nCity / Town:London\nPhone:\nMobile Phone:{\"num\":\"7700900000\",\"ext\":\"\",\"cc3l\":\"GBR\"}\nEvening Phone:{\"num\":\"2079460958\",\"ext\":\"\",\"cc3l\":\"GBR\"}\nNotes:Gate code 1234";
        let text = csv(&[("Home", extra)]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let [
            SecretValue::Person(person),
            SecretValue::Address(_),
            SecretValue::SecureNote(note),
        ] = plan.items.as_slice()
        else {
            anyhow::bail!("expected person, address and the original note");
        };
        assert_eq!(person.mobile_phone, "7700900000");
        assert_eq!(person.home_phone, "2079460958");
        assert_eq!(note.title, "Home");
        assert!(note.note.starts_with(extra));
        assert!(note.note.contains("## LastPass\n- group: Personal"));
        Ok(())
    }

    #[test]
    fn fully_mapped_documents_banks_and_cards_map_to_typed_records() -> anyhow::Result<()> {
        let text = csv(&[
            (
                "Passport",
                "NoteType:Passport\nType:\nName:ADA LOVELACE\nCountry:GB\nNumber:X1234567\nSex:\nNationality:\nIssuing Authority:\nDate of Birth:,,\nIssued Date:January,15,2020\nExpiration Date:January,14,2030\nNotes:",
            ),
            (
                "License",
                "NoteType:Driver's License\nNumber:D1234567\nExpiration Date:December,31,2030\nLicense Class:\nName:Ada Lovelace\nAddress:\nCity / Town:\nState:\nZIP / Postal Code:\nCountry:US\nDate of Birth:\nSex:\nHeight:\nNotes:",
            ),
            (
                "Checking",
                "NoteType:Bank Account\nBank Name:Federal Bank\nAccount Type:\nRouting Number:021000021\nAccount Number:000123456789\nSWIFT Code:\nIBAN Number:\nPin:\nBranch Address:\nBranch Phone:\nNotes:",
            ),
            (
                "Visa",
                "NoteType:Credit Card\nName on Card:Ada Lovelace\nType:\nNumber:4111111111111111\nSecurity Code:123\nStart Date:,\nExpiration Date:July,2031\nNotes:billing\nsecond line",
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
            anyhow::bail!("expected passport, license, account and card only");
        };
        assert_eq!(passport.kind, IdentityDocumentKind::Passport);
        assert_eq!(passport.issue_date, "2020-01-15");
        assert_eq!(passport.expiry_date, "2030-01-14");
        assert_eq!(license.issuing_country, "US");
        assert_eq!(license.expiry_date, "2030-12-31");
        assert_eq!(account.bank_name, "Federal Bank");
        assert_eq!(card.expiration_month, "07");
        assert_eq!(card.expiration_year, "2031");
        assert_eq!(card.notes, "billing\nsecond line");
        Ok(())
    }

    #[test]
    fn social_security_membership_and_month_dates_map_to_documents() -> anyhow::Result<()> {
        let text = csv(&[
            (
                "SSN",
                "NoteType:Social Security\nName:Ada Lovelace\nNumber:123-45-6789\nNotes:",
            ),
            (
                "Society",
                "NoteType:Membership\nOrganization:Analytical Society\nMembership Number:M-0042\nMember Name:Ada Lovelace\nStart Date:May,,2019\nExpiration Date:May,31,2031\nWebsite:\nTelephone:\nPassword:\nNotes:",
            ),
            (
                "Passport",
                "NoteType:Passport\nName:ADA LOVELACE\nCountry:GB\nNumber:X1234567\nIssuing Authority:HM Passport Office\nIssued Date:January,15,2020\nExpiration Date:January,,2030\nNotes:",
            ),
        ]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let [
            SecretValue::IdentityDocument(ssn),
            SecretValue::IdentityDocument(membership),
            SecretValue::IdentityDocument(passport),
        ] = plan.items.as_slice()
        else {
            anyhow::bail!("expected three documents and no kept notes");
        };
        assert_eq!(ssn.kind, IdentityDocumentKind::SocialSecurity);
        assert_eq!(ssn.number, "123456789");
        assert_eq!(membership.kind, IdentityDocumentKind::Membership);
        assert_eq!(membership.issuer, "Analytical Society");
        assert_eq!(membership.issue_date, "2019-05");
        assert_eq!(membership.expiry_date, "2031-05-31");
        assert_eq!(passport.issuer, "HM Passport Office");
        assert_eq!(passport.expiry_date, "2030-01");
        Ok(())
    }

    #[test]
    fn labelled_phones_fill_mobile_and_home_and_a_second_unlabelled_phone_is_kept()
    -> anyhow::Result<()> {
        let text = csv(&[(
            "Home",
            "NoteType:Address\nFirst Name:Ada\nAddress 1:1 Main St\nPhone:{\"num\":\"5550100\",\"ext\":\"\",\"cc3l\":\"USA\"}\nMobile Phone:{\"num\":\"5550199\",\"ext\":\"\",\"cc3l\":\"USA\"}\nEvening Phone:{\"num\":\"5550142\",\"ext\":\"\",\"cc3l\":\"USA\"}\nNotes:",
        )]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        let [
            SecretValue::Person(person),
            SecretValue::Address(_),
            SecretValue::SecureNote(note),
        ] = plan.items.as_slice()
        else {
            anyhow::bail!("expected person, address and the kept note");
        };
        assert_eq!(person.mobile_phone, "5550199");
        assert_eq!(person.home_phone, "5550142");
        assert!(person.work_phone.is_empty());
        assert!(note.note.contains("5550100"));
        Ok(())
    }

    #[test]
    fn bank_notes_with_iban_and_us_routing_produce_both_accounts() -> anyhow::Result<()> {
        let text = csv(&[(
            "Transatlantic",
            "NoteType:Bank Account\nBank Name:Transatlantic Bank\nRouting Number:021000021\nAccount Number:000123456789\nSWIFT Code:NWBKGB2L\nIBAN Number:GB82WEST12345698765432\nNotes:",
        )]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        assert!(matches!(
            plan.items.as_slice(),
            [
                SecretValue::InternationalAccount(_),
                SecretValue::DomesticAccount(_)
            ]
        ));
        Ok(())
    }

    #[test]
    fn license_state_stays_in_the_note_instead_of_the_issuing_country() -> anyhow::Result<()> {
        let text = csv(&[(
            "License",
            "NoteType:Driver's License\nNumber:D1234567\nState:CA\nCountry:\nNotes:",
        )]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        let [
            SecretValue::IdentityDocument(license),
            SecretValue::SecureNote(note),
        ] = plan.items.as_slice()
        else {
            anyhow::bail!("expected license and note");
        };
        assert!(license.issuing_country.is_empty());
        assert!(note.note.contains("State:CA"));
        Ok(())
    }

    #[test]
    fn invalid_typed_notes_are_skipped_and_other_types_stay_notes() -> anyhow::Result<()> {
        let text = csv(&[
            (
                "Bad bank",
                "NoteType:Bank Account\nBank Name:Bank\nRouting Number:021000022\nAccount Number:000123456789\nNotes:keep me",
            ),
            (
                "Bad passport",
                "NoteType:Passport\nNumber:X1\nExpiration Date:Smarch,1,2030\nNotes:",
            ),
            (
                "Unissued SSN",
                "NoteType:Social Security\nName:Ada\nNumber:000-00-0000\nNotes:",
            ),
            (
                "Insurance",
                "NoteType:Insurance\nCompany:Example Mutual\nPolicy Number:P-1\nNotes:",
            ),
        ]);
        let plan = LastPassCsvInput::new(&text).plan()?;
        assert_eq!(usize::from(plan.source_count), 4);
        assert_eq!(usize::from(plan.skipped_unsupported), 3);
        let [SecretValue::SecureNote(note)] = plan.items.as_slice() else {
            anyhow::bail!("expected only the insurance note");
        };
        assert_eq!(note.title, "Insurance");
        Ok(())
    }
}
