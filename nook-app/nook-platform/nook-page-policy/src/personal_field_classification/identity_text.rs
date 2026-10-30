//! Modest identity-text fallback for fields without an autocomplete field name.
//!
//! Identity text joins the field's id, name, placeholder, title, ARIA label,
//! and associated label. Matching uses whole-word phrases over the expanded,
//! lower-case identity, so `firstName`, `first_name`, and `First name` agree.
//! Rules are ordered from most to least specific; the first match wins.

use super::PersonalFieldKind;
use crate::{AuthenticationControlText, PageInputFieldObservation, PageInputType};

/// Words that mark a non-personal input regardless of other identity words.
const UNRELATED_FIELD_WORDS: &[&str] = &[
    "search", "query", "filter", "coupon", "promo", "voucher", "captcha", "gift",
];

/// Words that turn a generic `name` or `address` into a different value.
const NAME_QUALIFIER_WORDS: &[&str] = &[
    "company",
    "organization",
    "organisation",
    "business",
    "user",
    "username",
    "nick",
    "nickname",
    "display",
    "screen",
    "account",
    "file",
    "domain",
    "project",
    "team",
    "group",
    "bank",
    "street",
    "city",
    "country",
];
const ADDRESS_QUALIFIER_WORDS: &[&str] = &["ip", "web", "website", "url", "wallet", "mac", "email"];
const NO_QUALIFIER_WORDS: &[&str] = &[];

/// One ordered identity-word rule.
struct IdentityRule {
    outcome: IdentityTextKind,
    phrases: &'static [&'static str],
    qualifiers: &'static [&'static str],
}

impl IdentityRule {
    const fn plain(kind: PersonalFieldKind, phrases: &'static [&'static str]) -> Self {
        Self {
            outcome: IdentityTextKind::Matched(kind),
            phrases,
            qualifiers: NO_QUALIFIER_WORDS,
        }
    }
}

const IDENTITY_RULES: &[IdentityRule] = &[
    IdentityRule {
        outcome: IdentityTextKind::Unmatched,
        phrases: UNRELATED_FIELD_WORDS,
        qualifiers: NO_QUALIFIER_WORDS,
    },
    IdentityRule::plain(
        PersonalFieldKind::CardholderName,
        &[
            "cardholder",
            "card holder",
            "name on card",
            "card name",
            "holder name",
            "cc name",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::CardSecurityCode,
        &[
            "cvv",
            "cvv 2",
            "cvc",
            "cvc 2",
            "csc",
            "security code",
            "card code",
            "card verification",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::CardExpirationMonth,
        &[
            "exp month",
            "expiry month",
            "expiration month",
            "expires month",
            "cc month",
            "card month",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::CardExpirationYear,
        &[
            "exp year",
            "expiry year",
            "expiration year",
            "expires year",
            "cc year",
            "card year",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::CardExpiration,
        &[
            "expiry",
            "expiration",
            "exp date",
            "mm yy",
            "mm yyyy",
            "valid thru",
            "valid through",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::CardNumber,
        &[
            "card number",
            "cardnumber",
            "cc number",
            "ccnumber",
            "credit card",
            "debit card",
            "card no",
            "card num",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::BirthDay,
        &["dob day", "bday day", "birthday day", "day of birth"],
    ),
    IdentityRule::plain(
        PersonalFieldKind::BirthMonth,
        &[
            "dob month",
            "bday month",
            "birthday month",
            "birth month",
            "month of birth",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::BirthYear,
        &[
            "dob year",
            "bday year",
            "birthday year",
            "birth year",
            "year of birth",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::BirthDate,
        &[
            "birthday",
            "birth date",
            "birthdate",
            "date of birth",
            "dob",
            "bday",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::GivenName,
        &[
            "first name",
            "firstname",
            "fname",
            "given name",
            "givenname",
            "forename",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::AdditionalName,
        &[
            "middle name",
            "middlename",
            "mname",
            "middle initial",
            "additional name",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::FamilyName,
        &[
            "last name",
            "lastname",
            "lname",
            "surname",
            "family name",
            "familyname",
        ],
    ),
    IdentityRule::plain(PersonalFieldKind::Email, &["email", "e mail"]),
    IdentityRule::plain(
        PersonalFieldKind::Phone,
        &[
            "phone",
            "telephone",
            "tel",
            "mobile",
            "cell",
            "cellphone",
            "phone number",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::PostalCode,
        &[
            "zip",
            "zip code",
            "zipcode",
            "postcode",
            "post code",
            "postal",
            "postal code",
            "postalcode",
        ],
    ),
    IdentityRule::plain(
        PersonalFieldKind::AddressLevel2,
        &["city", "town", "locality", "suburb"],
    ),
    IdentityRule::plain(
        PersonalFieldKind::AddressLevel1,
        &["state", "province", "region", "county"],
    ),
    IdentityRule::plain(PersonalFieldKind::CountryName, &["country", "country name"]),
    IdentityRule {
        outcome: IdentityTextKind::Matched(PersonalFieldKind::AddressLine2),
        phrases: &[
            "address line 2",
            "address 2",
            "line 2",
            "apartment",
            "apt",
            "suite",
        ],
        qualifiers: ADDRESS_QUALIFIER_WORDS,
    },
    IdentityRule {
        outcome: IdentityTextKind::Matched(PersonalFieldKind::AddressLine1),
        phrases: &[
            "address line 1",
            "address 1",
            "line 1",
            "street address",
            "street",
            "address",
        ],
        qualifiers: ADDRESS_QUALIFIER_WORDS,
    },
    IdentityRule {
        outcome: IdentityTextKind::Matched(PersonalFieldKind::FullName),
        phrases: &["full name", "fullname", "your name", "name"],
        qualifiers: NAME_QUALIFIER_WORDS,
    },
];

/// Result of matching identity words against the ordered rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum IdentityTextKind {
    Matched(PersonalFieldKind),
    Unmatched,
}

impl IdentityTextKind {
    pub(super) fn from_page_input(input: &PageInputFieldObservation) -> Self {
        let identity = AuthenticationControlText::new(&input.identity_text).expand_identity_text();
        let identity = AuthenticationControlText::new(&identity);
        match input.input_type {
            PageInputType::Email => return Self::Matched(PersonalFieldKind::Email),
            PageInputType::Text | PageInputType::Tel | PageInputType::Number => {}
            PageInputType::Password | PageInputType::Other => return Self::Unmatched,
        }
        match IDENTITY_RULES.iter().find(|rule| {
            identity.contains_any_word(rule.phrases) && !identity.contains_any_word(rule.qualifiers)
        }) {
            Some(rule) => rule.outcome,
            None => Self::Unmatched,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{OneTimeCodeEntryEvidence, PageLoginContext};

    fn kind(identity_text: &str) -> IdentityTextKind {
        IdentityTextKind::from_page_input(&PageInputFieldObservation {
            input_type: PageInputType::Text,
            disabled: false,
            read_only: false,
            autocomplete_tokens: Vec::new(),
            identity_text: identity_text.to_owned(),
            login_context: PageLoginContext::Unrelated,
            one_time_code_entry: OneTimeCodeEntryEvidence::Unobserved,
        })
    }

    #[test]
    fn common_identity_words_and_variants_select_their_kind() {
        use PersonalFieldKind as Kind;
        for (identity, expected) in [
            ("First name", Kind::GivenName),
            ("firstName", Kind::GivenName),
            ("first_name", Kind::GivenName),
            ("fname", Kind::GivenName),
            ("Middle name", Kind::AdditionalName),
            ("Last name", Kind::FamilyName),
            ("lastname", Kind::FamilyName),
            ("lname", Kind::FamilyName),
            ("Surname", Kind::FamilyName),
            ("Full name", Kind::FullName),
            ("Name", Kind::FullName),
            ("Birthday", Kind::BirthDate),
            ("dob", Kind::BirthDate),
            ("Date of birth", Kind::BirthDate),
            ("birth month", Kind::BirthMonth),
            ("dob_year", Kind::BirthYear),
            ("dob-day", Kind::BirthDay),
            ("E-mail", Kind::Email),
            ("Email address", Kind::Email),
            ("Phone", Kind::Phone),
            ("mobile", Kind::Phone),
            ("Telephone number", Kind::Phone),
            ("Street address", Kind::AddressLine1),
            ("address", Kind::AddressLine1),
            ("addressLine1", Kind::AddressLine1),
            ("address2", Kind::AddressLine2),
            ("Apartment, suite, etc.", Kind::AddressLine2),
            ("City", Kind::AddressLevel2),
            ("Town", Kind::AddressLevel2),
            ("State", Kind::AddressLevel1),
            ("Province", Kind::AddressLevel1),
            ("Region", Kind::AddressLevel1),
            ("Zip", Kind::PostalCode),
            ("zipCode", Kind::PostalCode),
            ("Postcode", Kind::PostalCode),
            ("Postal code", Kind::PostalCode),
            ("Country", Kind::CountryName),
            ("Card number", Kind::CardNumber),
            ("ccnumber", Kind::CardNumber),
            ("Name on card", Kind::CardholderName),
            ("Cardholder name", Kind::CardholderName),
            ("CVV", Kind::CardSecurityCode),
            ("Security code", Kind::CardSecurityCode),
            ("Expiry month", Kind::CardExpirationMonth),
            ("exp_year", Kind::CardExpirationYear),
            ("Expiration date (MM/YY)", Kind::CardExpiration),
        ] {
            assert_eq!(
                kind(identity),
                IdentityTextKind::Matched(expected),
                "{identity}"
            );
        }
    }

    #[test]
    fn specific_rules_win_over_generic_words() {
        assert_eq!(
            kind("billing address city"),
            IdentityTextKind::Matched(PersonalFieldKind::AddressLevel2)
        );
        assert_eq!(
            kind("shipping address zip"),
            IdentityTextKind::Matched(PersonalFieldKind::PostalCode)
        );
        assert_eq!(
            kind("first name name"),
            IdentityTextKind::Matched(PersonalFieldKind::GivenName)
        );
    }

    #[test]
    fn qualified_and_unrelated_identities_do_not_match() {
        for identity in [
            "",
            "Company name",
            "Username",
            "Display name",
            "IP address",
            "Wallet address",
            "Search",
            "Coupon code",
            "Gift card number",
            "Message",
            "Comments",
            "united states of mind",
        ] {
            assert_eq!(kind(identity), IdentityTextKind::Unmatched, "{identity}");
        }
    }

    #[test]
    fn input_type_constrains_the_fallback() {
        let field = |input_type, identity_text: &str| PageInputFieldObservation {
            input_type,
            disabled: false,
            read_only: false,
            autocomplete_tokens: Vec::new(),
            identity_text: identity_text.to_owned(),
            login_context: PageLoginContext::Unrelated,
            one_time_code_entry: OneTimeCodeEntryEvidence::Unobserved,
        };
        assert_eq!(
            IdentityTextKind::from_page_input(&field(PageInputType::Email, "contact")),
            IdentityTextKind::Matched(PersonalFieldKind::Email)
        );
        assert_eq!(
            IdentityTextKind::from_page_input(&field(PageInputType::Tel, "phone")),
            IdentityTextKind::Matched(PersonalFieldKind::Phone)
        );
        assert_eq!(
            IdentityTextKind::from_page_input(&field(PageInputType::Number, "zip")),
            IdentityTextKind::Matched(PersonalFieldKind::PostalCode)
        );
        for input_type in [PageInputType::Other, PageInputType::Password] {
            assert_eq!(
                IdentityTextKind::from_page_input(&field(input_type, "first name")),
                IdentityTextKind::Unmatched
            );
        }
    }
}
