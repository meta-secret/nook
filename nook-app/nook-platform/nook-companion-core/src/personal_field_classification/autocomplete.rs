//! WHATWG autocomplete detail-token grammar for personal field names.
//!
//! The grammar is `[section-*] [shipping|billing]
//! [home|work|mobile|fax|pager] field-name [webauthn]`, where a contact hint is
//! valid only before a contact field name. A lone `on` or `off` carries no
//! field-name signal. Any other token sequence is unrecognized.

use super::PersonalFieldKind;

/// Whether a field name may follow a `home`/`work`/`mobile`/`fax`/`pager` hint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ContactFieldName {
    Contact,
    NonContact,
}

/// A recognized WHATWG autocomplete field name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AutocompleteFieldName {
    /// The field name selects a personal value.
    Personal(PersonalFieldKind),
    /// A recognized field name outside personal autofill.
    Other(ContactFieldName),
}

impl AutocompleteFieldName {
    const fn contact(self) -> ContactFieldName {
        match self {
            Self::Personal(PersonalFieldKind::Email | PersonalFieldKind::Phone) => {
                ContactFieldName::Contact
            }
            Self::Personal(
                PersonalFieldKind::GivenName
                | PersonalFieldKind::AdditionalName
                | PersonalFieldKind::FamilyName
                | PersonalFieldKind::FullName
                | PersonalFieldKind::BirthDate
                | PersonalFieldKind::BirthDay
                | PersonalFieldKind::BirthMonth
                | PersonalFieldKind::BirthYear
                | PersonalFieldKind::StreetAddress
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
                | PersonalFieldKind::CardSecurityCode,
            ) => ContactFieldName::NonContact,
            Self::Other(contact) => contact,
        }
    }
}

/// One ASCII-case-insensitive autocomplete token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutocompleteToken {
    /// `on` or `off`.
    Toggle,
    /// `section-*`.
    Section,
    /// `shipping` or `billing`.
    AddressScope,
    /// `home`, `work`, `mobile`, `fax`, or `pager`.
    ContactHint,
    /// Trailing `webauthn`.
    Webauthn,
    FieldName(AutocompleteFieldName),
    Unknown,
}

impl From<&str> for AutocompleteToken {
    fn from(token: &str) -> Self {
        use AutocompleteFieldName::{Other, Personal};
        use ContactFieldName::{Contact, NonContact};
        use PersonalFieldKind as Kind;
        let token = token.to_ascii_lowercase();
        let name = match token.as_str() {
            "on" | "off" => return Self::Toggle,
            "shipping" | "billing" => return Self::AddressScope,
            "home" | "work" | "mobile" | "fax" | "pager" => return Self::ContactHint,
            "webauthn" => return Self::Webauthn,
            "given-name" => Personal(Kind::GivenName),
            "additional-name" => Personal(Kind::AdditionalName),
            "family-name" => Personal(Kind::FamilyName),
            "name" => Personal(Kind::FullName),
            "bday" => Personal(Kind::BirthDate),
            "bday-day" => Personal(Kind::BirthDay),
            "bday-month" => Personal(Kind::BirthMonth),
            "bday-year" => Personal(Kind::BirthYear),
            "email" => Personal(Kind::Email),
            "tel" | "tel-national" | "tel-local" | "tel-country-code" | "tel-area-code"
            | "tel-local-prefix" | "tel-local-suffix" => Personal(Kind::Phone),
            "street-address" => Personal(Kind::StreetAddress),
            "address-line1" => Personal(Kind::AddressLine1),
            "address-line2" => Personal(Kind::AddressLine2),
            "address-level1" => Personal(Kind::AddressLevel1),
            "address-level2" => Personal(Kind::AddressLevel2),
            "postal-code" => Personal(Kind::PostalCode),
            "country" => Personal(Kind::CountryCode),
            "country-name" => Personal(Kind::CountryName),
            "cc-name" | "cc-given-name" | "cc-family-name" => Personal(Kind::CardholderName),
            "cc-number" => Personal(Kind::CardNumber),
            "cc-exp" => Personal(Kind::CardExpiration),
            "cc-exp-month" => Personal(Kind::CardExpirationMonth),
            "cc-exp-year" => Personal(Kind::CardExpirationYear),
            "cc-csc" => Personal(Kind::CardSecurityCode),
            "tel-extension" | "impp" => Other(Contact),
            "honorific-prefix"
            | "honorific-suffix"
            | "nickname"
            | "username"
            | "new-password"
            | "current-password"
            | "one-time-code"
            | "organization-title"
            | "organization"
            | "address-line3"
            | "address-level3"
            | "address-level4"
            | "cc-additional-name"
            | "cc-type"
            | "transaction-currency"
            | "transaction-amount"
            | "language"
            | "sex"
            | "url"
            | "photo" => Other(NonContact),
            other => {
                return match other.strip_prefix("section-") {
                    Some(_) => Self::Section,
                    None => Self::Unknown,
                };
            }
        };
        Self::FieldName(name)
    }
}

/// What the field's autocomplete tokens declare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AutocompleteDeclaration {
    /// No tokens, or only an `on`/`off` toggle.
    Absent,
    /// Tokens do not form a recognized detail-token sequence.
    Unrecognized,
    Declared(AutocompleteFieldName),
}

impl AutocompleteDeclaration {
    pub(super) fn from_tokens(tokens: &[String]) -> Self {
        let tokens = tokens
            .iter()
            .map(|token| AutocompleteToken::from(token.as_str()))
            .collect::<Vec<_>>();
        let rest = match tokens.as_slice() {
            [] | [AutocompleteToken::Toggle] => return Self::Absent,
            [AutocompleteToken::Section, rest @ ..] | rest => rest,
        };
        let rest = match rest {
            [AutocompleteToken::AddressScope, rest @ ..] | rest => rest,
        };
        let rest = match rest {
            [rest @ .., AutocompleteToken::Webauthn] | rest => rest,
        };
        match rest {
            [AutocompleteToken::FieldName(name)] => Self::Declared(*name),
            [
                AutocompleteToken::ContactHint,
                AutocompleteToken::FieldName(name),
            ] => match name.contact() {
                ContactFieldName::Contact => Self::Declared(*name),
                ContactFieldName::NonContact => Self::Unrecognized,
            },
            _ => Self::Unrecognized,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declaration(tokens: &[&str]) -> AutocompleteDeclaration {
        let tokens = tokens
            .iter()
            .map(|token| (*token).to_owned())
            .collect::<Vec<_>>();
        AutocompleteDeclaration::from_tokens(&tokens)
    }

    fn personal(kind: PersonalFieldKind) -> AutocompleteDeclaration {
        AutocompleteDeclaration::Declared(AutocompleteFieldName::Personal(kind))
    }

    #[test]
    fn every_listed_personal_token_selects_its_kind() {
        use PersonalFieldKind as Kind;
        for (token, kind) in [
            ("given-name", Kind::GivenName),
            ("additional-name", Kind::AdditionalName),
            ("family-name", Kind::FamilyName),
            ("name", Kind::FullName),
            ("bday", Kind::BirthDate),
            ("bday-day", Kind::BirthDay),
            ("bday-month", Kind::BirthMonth),
            ("bday-year", Kind::BirthYear),
            ("email", Kind::Email),
            ("tel", Kind::Phone),
            ("tel-national", Kind::Phone),
            ("tel-local", Kind::Phone),
            ("tel-country-code", Kind::Phone),
            ("tel-area-code", Kind::Phone),
            ("tel-local-prefix", Kind::Phone),
            ("tel-local-suffix", Kind::Phone),
            ("street-address", Kind::StreetAddress),
            ("address-line1", Kind::AddressLine1),
            ("address-line2", Kind::AddressLine2),
            ("address-level1", Kind::AddressLevel1),
            ("address-level2", Kind::AddressLevel2),
            ("postal-code", Kind::PostalCode),
            ("country", Kind::CountryCode),
            ("country-name", Kind::CountryName),
            ("cc-name", Kind::CardholderName),
            ("cc-given-name", Kind::CardholderName),
            ("cc-family-name", Kind::CardholderName),
            ("cc-number", Kind::CardNumber),
            ("cc-exp", Kind::CardExpiration),
            ("cc-exp-month", Kind::CardExpirationMonth),
            ("cc-exp-year", Kind::CardExpirationYear),
            ("cc-csc", Kind::CardSecurityCode),
        ] {
            assert_eq!(declaration(&[token]), personal(kind), "{token}");
            assert_eq!(
                declaration(&[token.to_ascii_uppercase().as_str()]),
                personal(kind),
                "{token} uppercase"
            );
        }
    }

    #[test]
    fn section_address_scope_and_webauthn_prefixes_are_skipped() {
        assert_eq!(
            declaration(&["section-blue", "shipping", "postal-code"]),
            personal(PersonalFieldKind::PostalCode)
        );
        assert_eq!(
            declaration(&["billing", "cc-number"]),
            personal(PersonalFieldKind::CardNumber)
        );
        assert_eq!(
            declaration(&["section-x", "address-line1"]),
            personal(PersonalFieldKind::AddressLine1)
        );
        assert_eq!(
            declaration(&["email", "webauthn"]),
            personal(PersonalFieldKind::Email)
        );
        assert_eq!(
            declaration(&["section-a", "billing", "work", "email", "webauthn"]),
            personal(PersonalFieldKind::Email)
        );
    }

    #[test]
    fn contact_hints_apply_only_to_contact_field_names() {
        for hint in ["home", "work", "mobile", "fax", "pager"] {
            assert_eq!(
                declaration(&[hint, "tel"]),
                personal(PersonalFieldKind::Phone),
                "{hint}"
            );
            assert_eq!(
                declaration(&[hint, "postal-code"]),
                AutocompleteDeclaration::Unrecognized,
                "{hint}"
            );
        }
        assert_eq!(
            declaration(&["home", "impp"]),
            AutocompleteDeclaration::Declared(AutocompleteFieldName::Other(
                ContactFieldName::Contact
            ))
        );
    }

    #[test]
    fn toggles_alone_carry_no_signal() {
        assert_eq!(declaration(&[]), AutocompleteDeclaration::Absent);
        assert_eq!(declaration(&["off"]), AutocompleteDeclaration::Absent);
        assert_eq!(declaration(&["ON"]), AutocompleteDeclaration::Absent);
        assert_eq!(
            declaration(&["off", "email"]),
            AutocompleteDeclaration::Unrecognized
        );
    }

    #[test]
    fn malformed_sequences_are_unrecognized() {
        for tokens in [
            &["nope"][..],
            &["section-a"][..],
            &["shipping"][..],
            &["webauthn"][..],
            &["shipping", "section-a", "postal-code"][..],
            &["given-name", "family-name"][..],
            &["postal-code", "shipping"][..],
            &["mobile"][..],
        ] {
            assert_eq!(
                declaration(tokens),
                AutocompleteDeclaration::Unrecognized,
                "{tokens:?}"
            );
        }
    }

    #[test]
    fn recognized_non_personal_names_are_declared_other() {
        for token in [
            "username",
            "current-password",
            "new-password",
            "one-time-code",
            "organization",
            "nickname",
            "address-line3",
            "address-level3",
            "cc-type",
            "cc-additional-name",
            "url",
        ] {
            assert_eq!(
                declaration(&[token]),
                AutocompleteDeclaration::Declared(AutocompleteFieldName::Other(
                    ContactFieldName::NonContact
                )),
                "{token}"
            );
        }
        assert_eq!(
            declaration(&["tel-extension"]),
            AutocompleteDeclaration::Declared(AutocompleteFieldName::Other(
                ContactFieldName::Contact
            ))
        );
    }
}
