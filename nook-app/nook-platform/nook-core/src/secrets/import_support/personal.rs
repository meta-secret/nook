//! Shared conversion of exported personal-data fields into Nook records.
//!
//! Importers read their own export shape, then describe each source item as
//! person, address, identity-document, and bank-account parts. Every present
//! part is validated by its payload constructor; one invalid part skips the
//! whole source item so a value is never silently coerced or dropped.

use super::{ImportItemDisposition, ImportSkipReason};
use crate::{
    AddressFields, AddressSecret, CalendarDate, CalendarMonth, DomesticAccountFields,
    DomesticAccountSecret, IdentityDocumentFields, IdentityDocumentKind, IdentityDocumentSecret,
    InternationalAccountFields, InternationalAccountSecret, PersonFields, PersonSecret,
    SecretValue, ValidationError,
};

/// Outcome of converting one personal-data part of a source item.
pub(crate) enum PersonalImportPart {
    /// The source item carries no value for this part.
    Absent,
    Record(Box<SecretValue>),
    /// A present value failed validation.
    Invalid,
    /// Present values do not fit any supported Nook type.
    Unsupported,
}

impl PersonalImportPart {
    /// A person needs a given, middle, or family name; contact details alone
    /// do not form a person record.
    pub(crate) fn person(fields: PersonFields<'_>) -> Self {
        if [fields.given_name, fields.middle_name, fields.family_name]
            .iter()
            .all(|name| name.trim().is_empty())
        {
            return Self::Absent;
        }
        PersonSecret::from_fields(fields).map_or(Self::Invalid, |person| {
            Self::Record(Box::new(SecretValue::Person(person)))
        })
    }

    /// An address needs a street, city, or postal code; a region or country
    /// alone does not form an address record.
    pub(crate) fn address(fields: AddressFields<'_>) -> Self {
        if [
            fields.address_line1,
            fields.address_line2,
            fields.city,
            fields.postal_code,
        ]
        .iter()
        .all(|part| part.trim().is_empty())
        {
            return Self::Absent;
        }
        AddressSecret::from_fields(fields).map_or(Self::Invalid, |address| {
            Self::Record(Box::new(SecretValue::Address(address)))
        })
    }

    /// A document needs its number.
    pub(crate) fn document(fields: IdentityDocumentFields<'_>) -> Self {
        if fields.number.trim().is_empty() {
            return Self::Absent;
        }
        IdentityDocumentSecret::from_fields(fields).map_or(Self::Invalid, |document| {
            Self::Record(Box::new(SecretValue::IdentityDocument(document)))
        })
    }

    /// A free-form "SSN" field of an identity (Bitwarden, Proton Pass) may hold
    /// an ITIN or a non-US national number. Only a valid US Social Security
    /// number becomes a document; any other value is unsupported rather than
    /// coerced into another kind, so the identity's other parts still import.
    /// Typed SSN sources use `document` and stay fail-closed.
    pub(crate) fn identity_ssn_field(number: &str) -> Self {
        if number.trim().is_empty() {
            return Self::Absent;
        }
        match IdentityDocumentSecret::from_fields(IdentityDocumentFields {
            kind: IdentityDocumentKind::SocialSecurity,
            number,
            issuer: "",
            issuing_country: "",
            issue_date: "",
            expiry_date: "",
            name_as_printed: "",
        }) {
            Ok(document) => Self::Record(Box::new(SecretValue::IdentityDocument(document))),
            Err(ValidationError::IdentityDocumentSsnInvalid) => Self::Unsupported,
            Err(_) => Self::Invalid,
        }
    }

    /// An IBAN makes an international account and an account number with a
    /// routing number makes a US domestic account; a source item carrying both
    /// produces both records. Bank values that fit neither are unsupported.
    pub(crate) fn banks(fields: &BankImportFields<'_>) -> Vec<Self> {
        let BankImportFields {
            account_holder,
            bank_name,
            iban,
            swift_bic,
            account_number,
            routing_number,
        } = *fields;
        let present = |value: &str| !value.trim().is_empty();
        let mut parts = Vec::new();
        if present(iban) {
            parts.push(
                InternationalAccountSecret::from_fields(InternationalAccountFields {
                    account_holder,
                    bank_name,
                    iban,
                    swift_bic,
                })
                .map_or(Self::Invalid, |account| {
                    Self::Record(Box::new(SecretValue::InternationalAccount(account)))
                }),
            );
        }
        if present(account_number) && present(routing_number) {
            parts.push(
                DomesticAccountSecret::from_fields(DomesticAccountFields {
                    account_holder,
                    bank_name,
                    account_number,
                    routing_number,
                })
                .map_or(Self::Invalid, |account| {
                    Self::Record(Box::new(SecretValue::DomesticAccount(account)))
                }),
            );
        }
        if parts.is_empty() {
            parts.push(
                if [swift_bic, account_number, routing_number]
                    .iter()
                    .all(|value| value.trim().is_empty())
                {
                    Self::Absent
                } else {
                    Self::Unsupported
                },
            );
        }
        parts
    }
}

/// Bank details as exported; an item may carry an IBAN, a US account and
/// routing number, or both.
#[derive(Clone, Copy)]
pub(crate) struct BankImportFields<'a> {
    pub(crate) account_holder: &'a str,
    pub(crate) bank_name: &'a str,
    pub(crate) iban: &'a str,
    pub(crate) swift_bic: &'a str,
    pub(crate) account_number: &'a str,
    pub(crate) routing_number: &'a str,
}

/// One exported account number that may be an IBAN or a domestic number.
pub(crate) struct ExportedAccountNumber<'a> {
    pub(crate) raw: &'a str,
}

/// An exported account number classified by its leading characters.
pub(crate) enum ExportedAccountNumberKind<'a> {
    /// Starts with a two-letter country code, as every IBAN does.
    Iban(&'a str),
    Domestic(&'a str),
}

impl<'a> ExportedAccountNumber<'a> {
    pub(crate) fn kind(&self) -> ExportedAccountNumberKind<'a> {
        let mut leading = self.raw.trim().chars();
        match (leading.next(), leading.next()) {
            (Some(first), Some(second))
                if first.is_ascii_alphabetic() && second.is_ascii_alphabetic() =>
            {
                ExportedAccountNumberKind::Iban(self.raw)
            }
            _ => ExportedAccountNumberKind::Domestic(self.raw),
        }
    }
}

/// The parts produced by one exported item.
pub(crate) struct PersonalImportItem {
    pub(crate) parts: Vec<PersonalImportPart>,
}

impl PersonalImportItem {
    /// Imports every produced record, or skips the whole item when a present
    /// part is invalid, nothing fits a supported type, or nothing is present.
    pub(crate) fn disposition(self) -> ImportItemDisposition {
        let mut records = Vec::new();
        let mut unsupported = false;
        let mut invalid = false;
        for part in self.parts {
            match part {
                PersonalImportPart::Absent => {}
                PersonalImportPart::Record(record) => records.push(*record),
                PersonalImportPart::Invalid => invalid = true,
                PersonalImportPart::Unsupported => unsupported = true,
            }
        }
        if invalid {
            for record in &mut records {
                record.zeroize_plaintext();
            }
            return ImportItemDisposition::Skipped(ImportSkipReason::InvalidPersonalData);
        }
        match (records.is_empty(), unsupported) {
            (false, _) => ImportItemDisposition::ImportedRecords(records),
            (true, true) => ImportItemDisposition::Skipped(ImportSkipReason::UnsupportedKind),
            (true, false) => ImportItemDisposition::Skipped(ImportSkipReason::EmptyRecord),
        }
    }
}

/// An exported date written as `Month,Day,Year` (`January,15,2030`).
pub(crate) struct MonthNameDate<'a> {
    pub(crate) raw: &'a str,
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

/// An English month name (`January` … `December`, any case).
pub(crate) struct MonthName<'a> {
    pub(crate) name: &'a str,
}

impl MonthName<'_> {
    /// Month number 1–12, or none for text that names no month.
    pub(crate) fn number(&self) -> Option<usize> {
        MONTH_NAMES
            .iter()
            .position(|candidate| candidate.eq_ignore_ascii_case(self.name.trim()))
            .map(|index| index + 1)
    }
}

impl MonthNameDate<'_> {
    /// ISO text for a complete date, empty for a blank one, or the original
    /// text so that validation reports a malformed date instead of losing it.
    pub(crate) fn iso(&self) -> String {
        let raw = self.raw.trim();
        let parts: Vec<&str> = raw.split(',').map(str::trim).collect();
        if parts.iter().all(|part| part.is_empty()) {
            return String::new();
        }
        let [month, day, year] = parts.as_slice() else {
            return raw.to_owned();
        };
        let Some(month) = (MonthName { name: month }).number() else {
            return raw.to_owned();
        };
        let candidate = format!("{year}-{month:02}-{day:0>2}");
        match CalendarDate::parse(&candidate) {
            Ok(date) => date.to_string(),
            Err(_) => raw.to_owned(),
        }
    }

    /// Like `iso`, but a document date written without a day
    /// (`January,,2030`) keeps month precision (`2030-01`).
    pub(crate) fn document_iso(&self) -> String {
        let raw = self.raw.trim();
        let parts: Vec<&str> = raw.split(',').map(str::trim).collect();
        let [month, "", year] = parts.as_slice() else {
            return self.iso();
        };
        if month.is_empty() && year.is_empty() {
            return String::new();
        }
        let Some(month) = (MonthName { name: month }).number() else {
            return raw.to_owned();
        };
        match CalendarMonth::parse(&format!("{year}-{month:02}")) {
            Ok(month) => month.to_string(),
            Err(_) => raw.to_owned(),
        }
    }
}

/// An exported date stored as Unix seconds (1Password `date` fields).
pub(crate) struct UnixDate {
    pub(crate) seconds: i64,
}

impl UnixDate {
    /// UTC calendar date as ISO `YYYY-MM-DD` (Howard Hinnant's civil-from-days).
    pub(crate) fn iso(&self) -> String {
        let days = self.seconds.div_euclid(86_400);
        let shifted = days + 719_468;
        let era = shifted.div_euclid(146_097);
        let day_of_era = shifted.rem_euclid(146_097);
        let year_of_era =
            (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
        let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        let month_index = (5 * day_of_year + 2) / 153;
        let day = day_of_year - (153 * month_index + 2) / 5 + 1;
        let month = if month_index < 10 {
            month_index + 3
        } else {
            month_index - 9
        };
        let year = year_of_era + era * 400 + i64::from(month <= 2);
        format!("{year:04}-{month:02}-{day:02}")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BankImportFields, ExportedAccountNumber, ExportedAccountNumberKind, MonthNameDate,
        PersonalImportItem, PersonalImportPart, UnixDate,
    };
    use crate::secrets::import_support::{ImportItemDisposition, ImportSkipReason};
    use crate::{AddressFields, PersonFields, SecretValue};

    const NO_BANK: BankImportFields<'static> = BankImportFields {
        account_holder: "",
        bank_name: "",
        iban: "",
        swift_bic: "",
        account_number: "",
        routing_number: "",
    };

    fn person(given_name: &'static str, birth_date: &'static str) -> PersonFields<'static> {
        PersonFields {
            given_name,
            middle_name: "",
            family_name: "",
            birth_date,
            email: "ada@example.com",
            mobile_phone: "",
            home_phone: "",
            work_phone: "",
        }
    }

    #[test]
    fn composite_items_import_every_present_part() {
        let disposition = PersonalImportItem {
            parts: vec![
                PersonalImportPart::person(person("Ada", "")),
                PersonalImportPart::address(AddressFields {
                    label: "Home",
                    address_line1: "1 Main St",
                    address_line2: "",
                    city: "",
                    region: "",
                    postal_code: "",
                    country: "US",
                }),
            ]
            .into_iter()
            .chain(PersonalImportPart::banks(&NO_BANK))
            .collect(),
        }
        .disposition();
        let ImportItemDisposition::ImportedRecords(records) = disposition else {
            panic!("expected imported records");
        };
        assert!(matches!(
            records.as_slice(),
            [SecretValue::Person(_), SecretValue::Address(_)]
        ));
    }

    #[test]
    fn one_invalid_part_skips_the_item_and_blank_items_are_empty() {
        assert!(matches!(
            PersonalImportItem {
                parts: vec![
                    PersonalImportPart::person(person("Ada", "")),
                    PersonalImportPart::person(person("Ada", "1815-02-30")),
                ],
            }
            .disposition(),
            ImportItemDisposition::Skipped(ImportSkipReason::InvalidPersonalData)
        ));
        assert!(matches!(
            PersonalImportItem {
                parts: vec![PersonalImportPart::person(person("", ""))],
            }
            .disposition(),
            ImportItemDisposition::Skipped(ImportSkipReason::EmptyRecord)
        ));
    }

    #[test]
    fn bank_parts_produce_international_domestic_or_both() {
        let international = PersonalImportPart::banks(&BankImportFields {
            iban: "DE89 3704 0044 0532 0130 00",
            swift_bic: "COBADEFFXXX",
            ..NO_BANK
        });
        assert!(matches!(
            international.as_slice(),
            [PersonalImportPart::Record(record)] if matches!(**record, SecretValue::InternationalAccount(_))
        ));
        let domestic = PersonalImportPart::banks(&BankImportFields {
            account_number: "000123456789",
            routing_number: "021000021",
            ..NO_BANK
        });
        assert!(matches!(
            domestic.as_slice(),
            [PersonalImportPart::Record(record)] if matches!(**record, SecretValue::DomesticAccount(_))
        ));
        let both = PersonalImportPart::banks(&BankImportFields {
            iban: "DE89 3704 0044 0532 0130 00",
            swift_bic: "COBADEFFXXX",
            account_number: "000123456789",
            routing_number: "021000021",
            ..NO_BANK
        });
        let ImportItemDisposition::ImportedRecords(records) =
            (PersonalImportItem { parts: both }).disposition()
        else {
            panic!("expected two bank records");
        };
        assert!(matches!(
            records.as_slice(),
            [
                SecretValue::InternationalAccount(_),
                SecretValue::DomesticAccount(_)
            ]
        ));
        let invalid_domestic = PersonalImportPart::banks(&BankImportFields {
            iban: "DE89 3704 0044 0532 0130 00",
            account_number: "000123456789",
            routing_number: "021000022",
            ..NO_BANK
        });
        assert!(matches!(
            (PersonalImportItem {
                parts: invalid_domestic
            })
            .disposition(),
            ImportItemDisposition::Skipped(ImportSkipReason::InvalidPersonalData)
        ));
        assert!(matches!(
            PersonalImportPart::banks(&BankImportFields {
                account_number: "000123456789",
                ..NO_BANK
            })
            .as_slice(),
            [PersonalImportPart::Unsupported]
        ));
        assert!(matches!(
            PersonalImportPart::banks(&BankImportFields {
                iban: "DE89370400440532013001",
                ..NO_BANK
            })
            .as_slice(),
            [PersonalImportPart::Invalid]
        ));
        assert!(matches!(
            PersonalImportPart::banks(&NO_BANK).as_slice(),
            [PersonalImportPart::Absent]
        ));
    }

    #[test]
    fn exported_account_numbers_with_country_letters_are_ibans() {
        assert!(matches!(
            (ExportedAccountNumber { raw: " gb82 west" }).kind(),
            ExportedAccountNumberKind::Iban(_)
        ));
        assert!(matches!(
            (ExportedAccountNumber { raw: "000123" }).kind(),
            ExportedAccountNumberKind::Domestic(_)
        ));
    }

    #[test]
    fn month_name_dates_convert_or_keep_malformed_text_for_validation() {
        assert_eq!(
            MonthNameDate {
                raw: "January,15,2030"
            }
            .iso(),
            "2030-01-15"
        );
        assert_eq!(
            MonthNameDate {
                raw: " march , 7 , 1990 "
            }
            .iso(),
            "1990-03-07"
        );
        assert_eq!(MonthNameDate { raw: ",," }.iso(), "");
        assert_eq!(MonthNameDate { raw: "" }.iso(), "");
        assert_eq!(
            MonthNameDate {
                raw: "February,30,2030"
            }
            .iso(),
            "February,30,2030"
        );
        assert_eq!(
            MonthNameDate {
                raw: "Smarch,1,2030"
            }
            .iso(),
            "Smarch,1,2030"
        );
        for short_year in ["January,15,30", "January,15,030"] {
            assert_eq!(MonthNameDate { raw: short_year }.iso(), short_year);
        }
        assert_eq!(
            MonthNameDate {
                raw: "December,,2030"
            }
            .document_iso(),
            "2030-12"
        );
        assert_eq!(
            MonthNameDate {
                raw: "December,31,2030"
            }
            .document_iso(),
            "2030-12-31"
        );
        assert_eq!(MonthNameDate { raw: ",," }.document_iso(), "");
        for malformed in ["December,,30", "Smarch,,2030"] {
            assert_eq!(MonthNameDate { raw: malformed }.document_iso(), malformed);
        }
        assert_eq!(
            MonthNameDate {
                raw: "December,,2030"
            }
            .iso(),
            "December,,2030"
        );
    }

    #[test]
    fn unix_dates_convert_to_utc_calendar_dates() {
        assert_eq!(UnixDate { seconds: 0 }.iso(), "1970-01-01");
        assert_eq!(
            UnixDate {
                seconds: 951_782_400
            }
            .iso(),
            "2000-02-29"
        );
        assert_eq!(
            UnixDate {
                seconds: 1_893_456_000
            }
            .iso(),
            "2030-01-01"
        );
        assert_eq!(UnixDate { seconds: -86_400 }.iso(), "1969-12-31");
    }
}
