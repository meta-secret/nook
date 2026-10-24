//! Portable personal-data field classification from browser-collected facts.
//!
//! The host reports the same structural, non-secret [`PageInputFieldObservation`]
//! it reports for credential recognition. This module decides which personal
//! value (name, contact, birth date, address, or payment card part) a field
//! accepts, so the host only renders the offer and assigns values.
//!
//! Autocomplete tokens are authoritative when the field declares a recognized
//! WHATWG field name. Identity-text words are a modest fallback used only when
//! no field name is declared. Credential fields keep their existing login
//! behavior: password inputs, one-time-code fields, and login-context username
//! fields never classify as personal data.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

mod autocomplete;
mod fill_plan;
mod identity_text;

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::page_field_classification::{AuthenticationFieldUsability, AuthenticationInputRole};
use crate::{PageInputFieldObservation, PageInputType, PageLoginContext};
use autocomplete::{AutocompleteDeclaration, AutocompleteFieldName};
use identity_text::IdentityTextKind;

pub use fill_plan::{
    PersonalFillField, PersonalFillOpportunity, PersonalFillPlan, PersonalFillScope,
    PersonalFillUnavailability,
};

/// Personal-data record family that can fill a classified field.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PersonalFieldGroup {
    Person,
    Address,
    Card,
}

/// Personal value accepted by one page field.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PersonalFieldKind {
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
    StreetAddress,
    AddressLine1,
    AddressLine2,
    /// Region, state, or province.
    AddressLevel1,
    /// City or town.
    AddressLevel2,
    PostalCode,
    CountryCode,
    CountryName,
    CardholderName,
    CardNumber,
    CardExpiration,
    CardExpirationMonth,
    CardExpirationYear,
    CardSecurityCode,
}

impl PersonalFieldKind {
    /// Record family whose values fill this kind.
    #[must_use]
    pub const fn group(self) -> PersonalFieldGroup {
        match self {
            Self::GivenName
            | Self::AdditionalName
            | Self::FamilyName
            | Self::FullName
            | Self::BirthDate
            | Self::BirthDay
            | Self::BirthMonth
            | Self::BirthYear
            | Self::Email
            | Self::Phone => PersonalFieldGroup::Person,
            Self::StreetAddress
            | Self::AddressLine1
            | Self::AddressLine2
            | Self::AddressLevel1
            | Self::AddressLevel2
            | Self::PostalCode
            | Self::CountryCode
            | Self::CountryName => PersonalFieldGroup::Address,
            Self::CardholderName
            | Self::CardNumber
            | Self::CardExpiration
            | Self::CardExpirationMonth
            | Self::CardExpirationYear
            | Self::CardSecurityCode => PersonalFieldGroup::Card,
        }
    }
}

/// Which page signal established a personal field kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum PersonalFieldEvidence {
    /// The field declared a WHATWG autocomplete field name.
    Autocomplete,
    /// No field name was declared; identity-text words matched.
    IdentityText,
}

/// One classified personal field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub struct ClassifiedPersonalField {
    #[tsify(type = "keyof typeof PersonalFieldKind")]
    pub kind: PersonalFieldKind,
    #[tsify(type = "keyof typeof PersonalFieldGroup")]
    pub group: PersonalFieldGroup,
    pub evidence: PersonalFieldEvidence,
}

impl ClassifiedPersonalField {
    const fn new(kind: PersonalFieldKind, evidence: PersonalFieldEvidence) -> Self {
        Self {
            kind,
            group: kind.group(),
            evidence,
        }
    }
}

/// Whether one page input accepts a personal value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum PersonalFieldClassification {
    Unclassified,
    Classified(ClassifiedPersonalField),
}

impl PersonalFieldClassification {
    /// Classify one live input without workflow or fill authority.
    #[must_use]
    pub fn from_page_input(input: &PageInputFieldObservation) -> Self {
        let (PageInputType::Text
        | PageInputType::Email
        | PageInputType::Tel
        | PageInputType::Number
        | PageInputType::Other) = input.input_type
        else {
            return Self::Unclassified;
        };
        let AuthenticationFieldUsability::Role(role) = input.usable_authentication_role() else {
            return Self::Unclassified;
        };
        match (role, input.login_context) {
            (AuthenticationInputRole::OneTimeCode(_), _)
            | (AuthenticationInputRole::Username(_), PageLoginContext::Authentication) => {
                Self::Unclassified
            }
            (AuthenticationInputRole::Username(_), PageLoginContext::Unrelated)
            | (
                AuthenticationInputRole::NonAuthentication(_)
                | AuthenticationInputRole::Unrelated(_),
                _,
            ) => Self::from_declaration(input),
        }
    }

    fn from_declaration(input: &PageInputFieldObservation) -> Self {
        match AutocompleteDeclaration::from_tokens(&input.autocomplete_tokens) {
            AutocompleteDeclaration::Declared(AutocompleteFieldName::Personal(kind)) => {
                Self::Classified(ClassifiedPersonalField::new(
                    kind,
                    PersonalFieldEvidence::Autocomplete,
                ))
            }
            AutocompleteDeclaration::Declared(AutocompleteFieldName::Other(_)) => {
                Self::Unclassified
            }
            AutocompleteDeclaration::Absent | AutocompleteDeclaration::Unrecognized => {
                match IdentityTextKind::from_page_input(input) {
                    IdentityTextKind::Matched(kind) => Self::Classified(
                        ClassifiedPersonalField::new(kind, PersonalFieldEvidence::IdentityText),
                    ),
                    IdentityTextKind::Unmatched => Self::Unclassified,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::OneTimeCodeEntryEvidence;
    use crate::credential_fill::FocusedCredentialOpportunity;

    struct InputFixture;

    impl InputFixture {
        fn text(identity_text: &str) -> PageInputFieldObservation {
            PageInputFieldObservation {
                input_type: PageInputType::Text,
                disabled: false,
                read_only: false,
                autocomplete_tokens: Vec::new(),
                identity_text: identity_text.to_owned(),
                login_context: PageLoginContext::Unrelated,
                one_time_code_entry: OneTimeCodeEntryEvidence::Unobserved,
            }
        }

        fn tokens(tokens: &[&str]) -> PageInputFieldObservation {
            PageInputFieldObservation {
                autocomplete_tokens: tokens.iter().map(|token| (*token).to_owned()).collect(),
                ..Self::text("field")
            }
        }
    }

    fn classified(
        kind: PersonalFieldKind,
        evidence: PersonalFieldEvidence,
    ) -> PersonalFieldClassification {
        PersonalFieldClassification::Classified(ClassifiedPersonalField::new(kind, evidence))
    }

    #[test]
    fn every_kind_belongs_to_its_record_group() {
        use PersonalFieldKind::{
            AdditionalName, AddressLevel1, AddressLevel2, AddressLine1, AddressLine2, BirthDate,
            BirthDay, BirthMonth, BirthYear, CardExpiration, CardExpirationMonth,
            CardExpirationYear, CardNumber, CardSecurityCode, CardholderName, CountryCode,
            CountryName, Email, FamilyName, FullName, GivenName, Phone, PostalCode, StreetAddress,
        };
        let person = [
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
        ];
        let address = [
            StreetAddress,
            AddressLine1,
            AddressLine2,
            AddressLevel1,
            AddressLevel2,
            PostalCode,
            CountryCode,
            CountryName,
        ];
        let card = [
            CardholderName,
            CardNumber,
            CardExpiration,
            CardExpirationMonth,
            CardExpirationYear,
            CardSecurityCode,
        ];
        for kind in person {
            assert_eq!(kind.group(), PersonalFieldGroup::Person, "{kind:?}");
        }
        for kind in address {
            assert_eq!(kind.group(), PersonalFieldGroup::Address, "{kind:?}");
        }
        for kind in card {
            assert_eq!(kind.group(), PersonalFieldGroup::Card, "{kind:?}");
        }
    }

    #[test]
    fn autocomplete_declaration_wins_over_identity_words() {
        let field = PageInputFieldObservation {
            identity_text: "city".to_owned(),
            ..InputFixture::tokens(&["postal-code"])
        };
        assert_eq!(
            PersonalFieldClassification::from_page_input(&field),
            classified(
                PersonalFieldKind::PostalCode,
                PersonalFieldEvidence::Autocomplete
            )
        );
    }

    #[test]
    fn declared_non_personal_field_name_blocks_the_identity_fallback() {
        let organization = PageInputFieldObservation {
            identity_text: "company name".to_owned(),
            ..InputFixture::tokens(&["organization"])
        };
        let nickname = PageInputFieldObservation {
            identity_text: "first name".to_owned(),
            ..InputFixture::tokens(&["nickname"])
        };
        for field in [organization, nickname] {
            assert_eq!(
                PersonalFieldClassification::from_page_input(&field),
                PersonalFieldClassification::Unclassified
            );
        }
    }

    #[test]
    fn toggles_and_unrecognized_tokens_fall_back_to_identity_words() {
        for tokens in [
            &["off"][..],
            &["on"][..],
            &["nope"][..],
            &["section-a"][..],
            &[][..],
        ] {
            let field = PageInputFieldObservation {
                identity_text: "First name".to_owned(),
                ..InputFixture::tokens(tokens)
            };
            assert_eq!(
                PersonalFieldClassification::from_page_input(&field),
                classified(
                    PersonalFieldKind::GivenName,
                    PersonalFieldEvidence::IdentityText
                ),
                "{tokens:?}"
            );
        }
    }

    #[test]
    fn password_disabled_and_read_only_inputs_never_classify() {
        let password = PageInputFieldObservation {
            input_type: PageInputType::Password,
            ..InputFixture::tokens(&["cc-number"])
        };
        let heuristic_password = PageInputFieldObservation {
            input_type: PageInputType::Password,
            ..InputFixture::text("card number")
        };
        let disabled = PageInputFieldObservation {
            disabled: true,
            ..InputFixture::tokens(&["given-name"])
        };
        let read_only = PageInputFieldObservation {
            read_only: true,
            ..InputFixture::text("first name")
        };
        let read_only_card = PageInputFieldObservation {
            read_only: true,
            ..InputFixture::tokens(&["cc-number"])
        };
        for field in [
            password,
            heuristic_password,
            disabled,
            read_only,
            read_only_card,
        ] {
            assert_eq!(
                PersonalFieldClassification::from_page_input(&field),
                PersonalFieldClassification::Unclassified
            );
        }
    }

    #[test]
    fn login_username_and_one_time_code_fields_keep_their_credential_role() {
        let login_email = PageInputFieldObservation {
            input_type: PageInputType::Email,
            login_context: PageLoginContext::Authentication,
            ..InputFixture::tokens(&["email"])
        };
        let login_phone = PageInputFieldObservation {
            input_type: PageInputType::Tel,
            login_context: PageLoginContext::Authentication,
            ..InputFixture::text("phone number")
        };
        let login_text_email = PageInputFieldObservation {
            login_context: PageLoginContext::Authentication,
            ..InputFixture::text("Email address")
        };
        let one_time_code = InputFixture::tokens(&["one-time-code"]);
        let heuristic_code = PageInputFieldObservation {
            login_context: PageLoginContext::Authentication,
            ..InputFixture::text("verification code")
        };
        for field in [
            login_email,
            login_phone,
            login_text_email,
            one_time_code,
            heuristic_code,
        ] {
            assert!(field.looks_like_username_field() || field.looks_like_one_time_code_field());
            assert_eq!(
                PersonalFieldClassification::from_page_input(&field),
                PersonalFieldClassification::Unclassified
            );
        }
    }

    #[test]
    fn contact_fields_outside_login_context_classify_as_person_data() {
        let signup_email = PageInputFieldObservation {
            input_type: PageInputType::Email,
            ..InputFixture::tokens(&["email"])
        };
        assert!(signup_email.looks_like_username_field());
        assert_eq!(
            PersonalFieldClassification::from_page_input(&signup_email),
            classified(
                PersonalFieldKind::Email,
                PersonalFieldEvidence::Autocomplete
            )
        );
        let phone = PageInputFieldObservation {
            input_type: PageInputType::Tel,
            ..InputFixture::text("Mobile")
        };
        assert_eq!(
            PersonalFieldClassification::from_page_input(&phone),
            classified(
                PersonalFieldKind::Phone,
                PersonalFieldEvidence::IdentityText
            )
        );
    }

    #[test]
    fn login_context_does_not_hide_non_credential_personal_fields() {
        let field = PageInputFieldObservation {
            login_context: PageLoginContext::Authentication,
            ..InputFixture::tokens(&["shipping", "postal-code"])
        };
        assert_eq!(
            PersonalFieldClassification::from_page_input(&field),
            classified(
                PersonalFieldKind::PostalCode,
                PersonalFieldEvidence::Autocomplete
            )
        );
    }

    #[test]
    fn other_input_types_accept_only_declared_field_names() {
        let date = PageInputFieldObservation {
            input_type: PageInputType::Other,
            ..InputFixture::tokens(&["bday"])
        };
        assert_eq!(
            PersonalFieldClassification::from_page_input(&date),
            classified(
                PersonalFieldKind::BirthDate,
                PersonalFieldEvidence::Autocomplete
            )
        );
        let checkbox = PageInputFieldObservation {
            input_type: PageInputType::Other,
            ..InputFixture::text("same as shipping address")
        };
        assert_eq!(
            PersonalFieldClassification::from_page_input(&checkbox),
            PersonalFieldClassification::Unclassified
        );
    }

    #[test]
    fn credential_recognition_is_unchanged_for_classified_fields() {
        let login_username = PageInputFieldObservation {
            input_type: PageInputType::Email,
            login_context: PageLoginContext::Authentication,
            ..InputFixture::tokens(&["username"])
        };
        assert_eq!(
            FocusedCredentialOpportunity::from_page_input(&login_username),
            FocusedCredentialOpportunity::Username
        );
        assert_eq!(
            PersonalFieldClassification::from_page_input(&login_username),
            PersonalFieldClassification::Unclassified
        );
        let card = InputFixture::tokens(&["cc-number"]);
        assert_eq!(
            FocusedCredentialOpportunity::from_page_input(&card),
            FocusedCredentialOpportunity::Unavailable
        );
        assert_eq!(
            PersonalFieldClassification::from_page_input(&card),
            classified(
                PersonalFieldKind::CardNumber,
                PersonalFieldEvidence::Autocomplete
            )
        );
    }

    #[test]
    fn serialization_preserves_source_names() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::to_string(&classified(
                PersonalFieldKind::AddressLevel2,
                PersonalFieldEvidence::IdentityText
            ))?,
            r#"{"Classified":{"kind":"AddressLevel2","group":"Address","evidence":"IdentityText"}}"#
        );
        assert_eq!(
            serde_json::to_string(&PersonalFieldClassification::Unclassified)?,
            r#""Unclassified""#
        );
        Ok(())
    }
}
