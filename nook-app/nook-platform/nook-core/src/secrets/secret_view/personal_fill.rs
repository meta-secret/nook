//! Minimum plaintext projection for an explicit personal-data form fill.
//!
//! The extension classifies page fields into [`PersonalFieldKind`]s and asks
//! for one user-selected record. Only the requested kinds of that record's
//! group leave this owner, each in a zeroizing buffer. Personal data is not
//! site-bound, so no origin admission applies.

use crate::{
    AddressSecret, CalendarDate, CreditCardSecret, PersonSecret, SecretRecord, SecretType,
    SecretValue,
};
use std::fmt;
use zeroize::{Zeroize, Zeroizing};

pub use nook_companion_core::{PersonalFieldGroup, PersonalFieldKind};

/// The one secret type whose records fill a personal field group.
///
/// Record listing for a fill offer and the fill projection both use this
/// mapping, so the offered records are exactly the records the reveal admits.
pub trait PersonalFillRecordType {
    fn record_type(self) -> SecretType;
}

impl PersonalFillRecordType for PersonalFieldGroup {
    fn record_type(self) -> SecretType {
        match self {
            PersonalFieldGroup::Person => SecretType::Person,
            PersonalFieldGroup::Address => SecretType::Address,
            PersonalFieldGroup::Card => SecretType::CreditCard,
        }
    }
}

/// One derived value for one requested field kind.
pub struct PersonalFillValue {
    kind: PersonalFieldKind,
    value: Zeroizing<String>,
}

impl PersonalFillValue {
    #[must_use]
    pub fn kind(&self) -> PersonalFieldKind {
        self.kind
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.value.as_str()
    }
}

impl Zeroize for PersonalFillValue {
    fn zeroize(&mut self) {
        self.value.zeroize();
    }
}

impl fmt::Debug for PersonalFillValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PersonalFillValue")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

/// Values for the requested kinds, in request order, without empty values.
#[derive(Debug, Default)]
pub struct PersonalFillValues {
    values: Vec<PersonalFillValue>,
}

impl PersonalFillValues {
    #[must_use]
    pub fn values(&self) -> &[PersonalFillValue] {
        &self.values
    }

    #[must_use]
    fn with_value(mut self, value: PersonalFillValue) -> Self {
        self.values.push(value);
        self
    }
}

impl Zeroize for PersonalFillValues {
    fn zeroize(&mut self) {
        self.values.iter_mut().for_each(Zeroize::zeroize);
    }
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum PersonalFillError {
    #[error("selected secret type {} cannot fill {group:?} fields", .secret_type.as_str())]
    GroupMismatch {
        secret_type: SecretType,
        group: PersonalFieldGroup,
    },
    #[error("requested field {kind:?} does not belong to {group:?} fields")]
    KindOutsideGroup {
        kind: PersonalFieldKind,
        group: PersonalFieldGroup,
    },
    #[error("stored birth date is not a calendar date")]
    StoredBirthDateInvalid,
}

/// One explicit, user-initiated fill of a decrypted personal-data record.
pub struct PersonalFillProjection<'a> {
    pub record: SecretRecord,
    pub group: PersonalFieldGroup,
    pub kinds: &'a [PersonalFieldKind],
}

impl Drop for PersonalFillProjection<'_> {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl Zeroize for PersonalFillProjection<'_> {
    fn zeroize(&mut self) {
        self.record.zeroize_plaintext();
    }
}

impl fmt::Debug for PersonalFillProjection<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PersonalFillProjection")
            .field("secret_type", &self.record.secret_type)
            .field("group", &self.group)
            .field("kinds", &self.kinds)
            .finish_non_exhaustive()
    }
}

/// The record payload admitted for the requested group.
enum GroupRecord<'a> {
    Person(&'a PersonSecret),
    Address(&'a AddressSecret),
    Card(&'a CreditCardSecret),
}

impl PersonalFillProjection<'_> {
    /// Project the requested kinds; reject other groups and other record types.
    pub fn reveal(self) -> Result<PersonalFillValues, PersonalFillError> {
        let record = self.admitted_record()?;
        let mut requested: Vec<PersonalFieldKind> = Vec::with_capacity(self.kinds.len());
        for kind in self.kinds {
            if kind.group() != self.group {
                return Err(PersonalFillError::KindOutsideGroup {
                    kind: *kind,
                    group: self.group,
                });
            }
            if !requested.contains(kind) {
                requested.push(*kind);
            }
        }
        requested
            .into_iter()
            .try_fold(PersonalFillValues::default(), |values, kind| {
                let value = Zeroizing::new(record.value(kind)?);
                Ok(if value.is_empty() {
                    values
                } else {
                    values.with_value(PersonalFillValue { kind, value })
                })
            })
    }

    fn admitted_record(&self) -> Result<GroupRecord<'_>, PersonalFillError> {
        let secret_type = self.record.data.secret_type();
        let mismatch = PersonalFillError::GroupMismatch {
            secret_type,
            group: self.group,
        };
        if secret_type != self.group.record_type() {
            return Err(mismatch);
        }
        match &self.record.data {
            SecretValue::Person(person) => Ok(GroupRecord::Person(person)),
            SecretValue::Address(address) => Ok(GroupRecord::Address(address)),
            SecretValue::CreditCard(card) => Ok(GroupRecord::Card(card)),
            SecretValue::Login(_)
            | SecretValue::ApiKey(_)
            | SecretValue::SeedPhrase(_)
            | SecretValue::SecureNote(_)
            | SecretValue::Passkey(_)
            | SecretValue::Authenticator(_)
            | SecretValue::FileAttachment(_)
            | SecretValue::IdentityDocument(_)
            | SecretValue::InternationalAccount(_)
            | SecretValue::DomesticAccount(_) => Err(mismatch),
        }
    }
}

impl GroupRecord<'_> {
    /// Derived value for `kind`; empty when the record stores nothing for it.
    ///
    /// Callers have already checked that `kind` belongs to this record's group.
    fn value(&self, kind: PersonalFieldKind) -> Result<String, PersonalFillError> {
        match self {
            Self::Person(person) => GroupRecord::person_value(person, kind),
            Self::Address(address) => Ok(GroupRecord::address_value(address, kind)),
            Self::Card(card) => Ok(GroupRecord::card_value(card, kind)),
        }
    }

    fn person_value(
        person: &PersonSecret,
        kind: PersonalFieldKind,
    ) -> Result<String, PersonalFillError> {
        let birth_part = |part: fn(&CalendarDate) -> String| match person.birth_date.as_str() {
            "" => Ok(String::new()),
            stored => CalendarDate::parse(stored)
                .map(|date| part(&date))
                .map_err(|_| PersonalFillError::StoredBirthDateInvalid),
        };
        match kind {
            PersonalFieldKind::GivenName => Ok(person.given_name.clone()),
            PersonalFieldKind::AdditionalName => Ok(person.middle_name.clone()),
            PersonalFieldKind::FamilyName => Ok(person.family_name.clone()),
            PersonalFieldKind::FullName => Ok(person.full_name()),
            PersonalFieldKind::BirthDate => birth_part(CalendarDate::iso_text),
            PersonalFieldKind::BirthDay => birth_part(CalendarDate::day_text),
            PersonalFieldKind::BirthMonth => birth_part(CalendarDate::month_text),
            PersonalFieldKind::BirthYear => birth_part(CalendarDate::year_text),
            PersonalFieldKind::Email => Ok(person.email.clone()),
            PersonalFieldKind::Phone => Ok(person.phone.clone()),
            PersonalFieldKind::StreetAddress
            | PersonalFieldKind::AddressLine1
            | PersonalFieldKind::AddressLine2
            | PersonalFieldKind::AddressLevel1
            | PersonalFieldKind::AddressLevel2
            | PersonalFieldKind::PostalCode
            | PersonalFieldKind::CountryCode
            | PersonalFieldKind::CountryName
            | PersonalFieldKind::CardholderName
            | PersonalFieldKind::CardNumber
            | PersonalFieldKind::CardExpiration
            | PersonalFieldKind::CardExpirationMonth
            | PersonalFieldKind::CardExpirationYear
            | PersonalFieldKind::CardSecurityCode => Ok(String::new()),
        }
    }

    fn address_value(address: &AddressSecret, kind: PersonalFieldKind) -> String {
        match kind {
            PersonalFieldKind::StreetAddress => match address.address_line2.as_str() {
                "" => address.address_line1.clone(),
                line2 => format!("{}\n{line2}", address.address_line1),
            },
            PersonalFieldKind::AddressLine1 => address.address_line1.clone(),
            PersonalFieldKind::AddressLine2 => address.address_line2.clone(),
            PersonalFieldKind::AddressLevel1 => address.region.clone(),
            PersonalFieldKind::AddressLevel2 => address.city.clone(),
            PersonalFieldKind::PostalCode => address.postal_code.clone(),
            PersonalFieldKind::CountryCode | PersonalFieldKind::CountryName => {
                address.country.clone()
            }
            PersonalFieldKind::GivenName
            | PersonalFieldKind::AdditionalName
            | PersonalFieldKind::FamilyName
            | PersonalFieldKind::FullName
            | PersonalFieldKind::BirthDate
            | PersonalFieldKind::BirthDay
            | PersonalFieldKind::BirthMonth
            | PersonalFieldKind::BirthYear
            | PersonalFieldKind::Email
            | PersonalFieldKind::Phone
            | PersonalFieldKind::CardholderName
            | PersonalFieldKind::CardNumber
            | PersonalFieldKind::CardExpiration
            | PersonalFieldKind::CardExpirationMonth
            | PersonalFieldKind::CardExpirationYear
            | PersonalFieldKind::CardSecurityCode => String::new(),
        }
    }

    fn card_value(card: &CreditCardSecret, kind: PersonalFieldKind) -> String {
        match kind {
            PersonalFieldKind::CardholderName => card.cardholder_name.clone(),
            PersonalFieldKind::CardNumber => card.number.clone(),
            PersonalFieldKind::CardExpiration => {
                match (
                    card.expiration_month.as_str(),
                    card.expiration_year.as_str(),
                ) {
                    ("", _) | (_, "") => String::new(),
                    (month, year) => {
                        let short_year: String = year.chars().skip(2).collect();
                        format!("{month}/{short_year}")
                    }
                }
            }
            PersonalFieldKind::CardExpirationMonth => card.expiration_month.clone(),
            PersonalFieldKind::CardExpirationYear => card.expiration_year.clone(),
            PersonalFieldKind::CardSecurityCode => card.cvv.clone(),
            PersonalFieldKind::GivenName
            | PersonalFieldKind::AdditionalName
            | PersonalFieldKind::FamilyName
            | PersonalFieldKind::FullName
            | PersonalFieldKind::BirthDate
            | PersonalFieldKind::BirthDay
            | PersonalFieldKind::BirthMonth
            | PersonalFieldKind::BirthYear
            | PersonalFieldKind::Email
            | PersonalFieldKind::Phone
            | PersonalFieldKind::StreetAddress
            | PersonalFieldKind::AddressLine1
            | PersonalFieldKind::AddressLine2
            | PersonalFieldKind::AddressLevel1
            | PersonalFieldKind::AddressLevel2
            | PersonalFieldKind::PostalCode
            | PersonalFieldKind::CountryCode
            | PersonalFieldKind::CountryName => String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PersonalFieldGroup, PersonalFieldKind, PersonalFillError, PersonalFillProjection,
        PersonalFillRecordType, PersonalFillValues,
    };
    use crate::{
        AddressFields, AddressSecret, CreditCardFields, CreditCardSecret, IdentityDocumentFields,
        IdentityDocumentKind, IdentityDocumentSecret, LoginSecret, PersonFields, PersonSecret,
        SecretId, SecretRecord, SecretType, SecretValue,
    };
    use zeroize::Zeroize;

    fn record(data: SecretValue) -> SecretRecord {
        SecretRecord {
            id: SecretId::from_vault_record("secret_personal"),
            secret_type: data.secret_type(),
            data,
        }
    }

    fn person() -> anyhow::Result<SecretRecord> {
        Ok(record(SecretValue::Person(PersonSecret::from_fields(
            PersonFields {
                given_name: "Ada",
                middle_name: "Augusta",
                family_name: "Lovelace",
                birth_date: "1815-12-10",
                email: "ada@example.com",
                phone: "+44 20 7946 0958",
            },
        )?)))
    }

    fn address(address_line2: &str) -> anyhow::Result<SecretRecord> {
        Ok(record(SecretValue::Address(AddressSecret::from_fields(
            AddressFields {
                label: "Home",
                address_line1: "12 Analytical Row",
                address_line2,
                city: "London",
                region: "Greater London",
                postal_code: "W1 1AA",
                country: "GB",
            },
        )?)))
    }

    struct CardExpiry<'a> {
        month: &'a str,
        year: &'a str,
    }

    fn card(expiry: &CardExpiry<'_>) -> anyhow::Result<SecretRecord> {
        Ok(record(SecretValue::CreditCard(
            CreditCardSecret::from_fields(CreditCardFields {
                title: "Personal Visa",
                cardholder_name: "ADA LOVELACE",
                number: "4111 1111 1111 1111",
                expiration_month: expiry.month,
                expiration_year: expiry.year,
                cvv: "123",
                notes: "never projected",
            })?,
        )))
    }

    const UNDATED: CardExpiry<'static> = CardExpiry {
        month: "",
        year: "",
    };

    struct Reveal<'a> {
        record: SecretRecord,
        group: PersonalFieldGroup,
        kinds: &'a [PersonalFieldKind],
    }

    struct FilledValue {
        kind: PersonalFieldKind,
        value: String,
    }

    impl Reveal<'_> {
        fn values(self) -> Result<PersonalFillValues, PersonalFillError> {
            PersonalFillProjection {
                record: self.record,
                group: self.group,
                kinds: self.kinds,
            }
            .reveal()
        }

        fn filled(self) -> anyhow::Result<Vec<FilledValue>> {
            Ok(self
                .values()?
                .values()
                .iter()
                .map(|value| FilledValue {
                    kind: value.kind(),
                    value: value.as_str().to_owned(),
                })
                .collect())
        }
    }

    fn assert_filled(actual: &[FilledValue], expected: &[(PersonalFieldKind, &str)]) {
        assert_eq!(actual.len(), expected.len());
        for (filled, (kind, value)) in actual.iter().zip(expected) {
            assert_eq!(filled.kind, *kind);
            assert_eq!(filled.value, *value);
        }
    }

    #[test]
    fn person_kinds_derive_names_and_birth_date_parts() -> anyhow::Result<()> {
        use PersonalFieldKind::{
            AdditionalName, BirthDate, BirthDay, BirthMonth, BirthYear, Email, FamilyName,
            FullName, GivenName, Phone,
        };
        let filled = Reveal {
            record: person()?,
            group: PersonalFieldGroup::Person,
            kinds: &[
                GivenName,
                AdditionalName,
                FamilyName,
                FullName,
                BirthDate,
                BirthDay,
                BirthMonth,
                BirthYear,
                Email,
                Phone,
            ],
        }
        .filled()?;
        assert_filled(
            &filled,
            &[
                (GivenName, "Ada"),
                (AdditionalName, "Augusta"),
                (FamilyName, "Lovelace"),
                (FullName, "Ada Augusta Lovelace"),
                (BirthDate, "1815-12-10"),
                (BirthDay, "10"),
                (BirthMonth, "12"),
                (BirthYear, "1815"),
                (Email, "ada@example.com"),
                (Phone, "+44 20 7946 0958"),
            ],
        );
        Ok(())
    }

    #[test]
    fn birth_date_parts_are_zero_padded() -> anyhow::Result<()> {
        let mut record = person()?;
        if let SecretValue::Person(person) = &mut record.data {
            person.birth_date = "1990-03-07".to_owned();
        }
        let filled = Reveal {
            record,
            group: PersonalFieldGroup::Person,
            kinds: &[PersonalFieldKind::BirthDay, PersonalFieldKind::BirthMonth],
        }
        .filled()?;
        assert_filled(
            &filled,
            &[
                (PersonalFieldKind::BirthDay, "07"),
                (PersonalFieldKind::BirthMonth, "03"),
            ],
        );
        Ok(())
    }

    #[test]
    fn address_kinds_join_street_lines_and_map_levels_and_country() -> anyhow::Result<()> {
        use PersonalFieldKind::{
            AddressLevel1, AddressLevel2, AddressLine1, AddressLine2, CountryCode, CountryName,
            PostalCode, StreetAddress,
        };
        let filled = Reveal {
            record: address("Flat 3")?,
            group: PersonalFieldGroup::Address,
            kinds: &[
                StreetAddress,
                AddressLine1,
                AddressLine2,
                AddressLevel1,
                AddressLevel2,
                PostalCode,
                CountryCode,
                CountryName,
            ],
        }
        .filled()?;
        assert_filled(
            &filled,
            &[
                (StreetAddress, "12 Analytical Row\nFlat 3"),
                (AddressLine1, "12 Analytical Row"),
                (AddressLine2, "Flat 3"),
                (AddressLevel1, "Greater London"),
                (AddressLevel2, "London"),
                (PostalCode, "W1 1AA"),
                (CountryCode, "GB"),
                (CountryName, "GB"),
            ],
        );
        let single_line = Reveal {
            record: address("")?,
            group: PersonalFieldGroup::Address,
            kinds: &[StreetAddress, AddressLine2],
        }
        .filled()?;
        assert_filled(&single_line, &[(StreetAddress, "12 Analytical Row")]);
        Ok(())
    }

    #[test]
    fn card_kinds_format_expiry_and_include_security_code() -> anyhow::Result<()> {
        use PersonalFieldKind::{
            CardExpiration, CardExpirationMonth, CardExpirationYear, CardNumber, CardSecurityCode,
            CardholderName,
        };
        let kinds = [
            CardholderName,
            CardNumber,
            CardExpiration,
            CardExpirationMonth,
            CardExpirationYear,
            CardSecurityCode,
        ];
        let filled = Reveal {
            record: card(&CardExpiry {
                month: "7",
                year: "2031",
            })?,
            group: PersonalFieldGroup::Card,
            kinds: &kinds,
        }
        .filled()?;
        assert_filled(
            &filled,
            &[
                (CardholderName, "ADA LOVELACE"),
                (CardNumber, "4111111111111111"),
                (CardExpiration, "07/31"),
                (CardExpirationMonth, "07"),
                (CardExpirationYear, "2031"),
                (CardSecurityCode, "123"),
            ],
        );
        let undated = Reveal {
            record: card(&UNDATED)?,
            group: PersonalFieldGroup::Card,
            kinds: &kinds,
        }
        .filled()?;
        assert_filled(
            &undated,
            &[
                (CardholderName, "ADA LOVELACE"),
                (CardNumber, "4111111111111111"),
                (CardSecurityCode, "123"),
            ],
        );
        Ok(())
    }

    #[test]
    fn empty_values_are_omitted_and_duplicate_kinds_fill_once() -> anyhow::Result<()> {
        let record = record(SecretValue::Person(PersonSecret::from_fields(
            PersonFields {
                given_name: "Ada",
                middle_name: "",
                family_name: "",
                birth_date: "",
                email: "",
                phone: "",
            },
        )?));
        let filled = Reveal {
            record,
            group: PersonalFieldGroup::Person,
            kinds: &[
                PersonalFieldKind::GivenName,
                PersonalFieldKind::FamilyName,
                PersonalFieldKind::BirthYear,
                PersonalFieldKind::Email,
                PersonalFieldKind::GivenName,
            ],
        }
        .filled()?;
        assert_filled(&filled, &[(PersonalFieldKind::GivenName, "Ada")]);
        Ok(())
    }

    #[test]
    fn rejects_records_outside_the_requested_group() -> anyhow::Result<()> {
        let document = record(SecretValue::IdentityDocument(
            IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                kind: IdentityDocumentKind::Passport,
                number: "X1234567",
                issuing_country: "GB",
                issue_date: "",
                expiry_date: "",
                name_as_printed: "ADA LOVELACE",
            })?,
        ));
        let login = record(SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "ada".to_owned(),
            password: "pw".to_owned(),
            notes: String::new(),
        }));
        for (record, group, secret_type) in [
            (person()?, PersonalFieldGroup::Address, SecretType::Person),
            (address("")?, PersonalFieldGroup::Card, SecretType::Address),
            (
                card(&UNDATED)?,
                PersonalFieldGroup::Person,
                SecretType::CreditCard,
            ),
            (
                document,
                PersonalFieldGroup::Person,
                SecretType::IdentityDocument,
            ),
            (login, PersonalFieldGroup::Card, SecretType::Login),
        ] {
            assert_eq!(
                Reveal {
                    record,
                    group,
                    kinds: &[],
                }
                .values()
                .map(|values| values.values().len()),
                Err(PersonalFillError::GroupMismatch { secret_type, group })
            );
        }
        Ok(())
    }

    #[test]
    fn listing_filter_type_is_exactly_the_type_the_projection_admits() -> anyhow::Result<()> {
        for group in [
            PersonalFieldGroup::Person,
            PersonalFieldGroup::Address,
            PersonalFieldGroup::Card,
        ] {
            let filter = crate::SecretTypeFilter::Only(group.record_type());
            for record in [person()?, address("")?, card(&UNDATED)?] {
                let listed = filter.matches(record.secret_type);
                let admitted = Reveal {
                    record,
                    group,
                    kinds: &[],
                }
                .values()
                .is_ok();
                assert_eq!(listed, admitted, "{group:?}");
            }
        }
        Ok(())
    }

    #[test]
    fn rejects_kinds_outside_the_requested_group() -> anyhow::Result<()> {
        assert_eq!(
            Reveal {
                record: person()?,
                group: PersonalFieldGroup::Person,
                kinds: &[PersonalFieldKind::GivenName, PersonalFieldKind::CardNumber],
            }
            .values()
            .map(|values| values.values().len()),
            Err(PersonalFillError::KindOutsideGroup {
                kind: PersonalFieldKind::CardNumber,
                group: PersonalFieldGroup::Person,
            })
        );
        Ok(())
    }

    #[test]
    fn invalid_stored_birth_date_fails_closed() -> anyhow::Result<()> {
        let mut record = person()?;
        if let SecretValue::Person(person) = &mut record.data {
            person.birth_date = "1815-02-30".to_owned();
        }
        assert_eq!(
            Reveal {
                record,
                group: PersonalFieldGroup::Person,
                kinds: &[PersonalFieldKind::BirthDay],
            }
            .values()
            .map(|values| values.values().len()),
            Err(PersonalFillError::StoredBirthDateInvalid)
        );
        Ok(())
    }

    #[test]
    fn values_redact_debug_and_zeroize() -> anyhow::Result<()> {
        let mut values = Reveal {
            record: card(&CardExpiry {
                month: "12",
                year: "2030",
            })?,
            group: PersonalFieldGroup::Card,
            kinds: &[
                PersonalFieldKind::CardNumber,
                PersonalFieldKind::CardSecurityCode,
            ],
        }
        .values()?;
        let debug = format!("{values:?}");
        assert!(debug.contains("CardNumber"));
        assert!(!debug.contains("4111"));
        assert!(!debug.contains("123"));
        values.zeroize();
        assert!(
            values
                .values()
                .iter()
                .all(|value| value.as_str().is_empty())
        );

        let projection = PersonalFillProjection {
            record: person()?,
            group: PersonalFieldGroup::Person,
            kinds: &[PersonalFieldKind::Email],
        };
        let debug = format!("{projection:?}");
        assert!(debug.contains("Person"));
        assert!(!debug.contains("ada@example.com"));
        Ok(())
    }
}
