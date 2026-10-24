//! Explicit-reveal detail view of one decrypted personal-data record.
//!
//! The view exists only for the immediate display, edit, or copy interaction.
//! It carries every plaintext field plus masked numbers for the default
//! collapsed presentation, and is zeroized after crossing the WASM boundary.

use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::{
    AddressSecret, BankAccountSecret, IdentityDocumentKind, IdentityDocumentSecret, PersonSecret,
    SecretValue,
};
use serde::Serialize;
use std::fmt;
use tsify::Tsify;
use zeroize::Zeroize;

/// Detail fields of one personal-data record, discriminated by `kind`.
#[derive(Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PersonalDataView {
    Person(PersonView),
    Address(AddressView),
    IdentityDocument(IdentityDocumentView),
    BankAccount(BankAccountView),
}

#[derive(Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PersonView {
    pub given_name: String,
    pub middle_name: String,
    pub family_name: String,
    pub full_name: String,
    pub birth_date: String,
    pub email: String,
    pub phone: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct AddressView {
    pub label: String,
    pub address_line1: String,
    pub address_line2: String,
    pub city: String,
    pub region: String,
    pub postal_code: String,
    pub country: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityDocumentView {
    pub document_kind: IdentityDocumentKind,
    pub number: String,
    pub masked_number: String,
    pub issuing_country: String,
    pub issue_date: String,
    pub expiry_date: String,
    pub name_as_printed: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BankAccountView {
    pub account_holder: String,
    pub bank_name: String,
    pub account_number: String,
    pub masked_number: String,
    pub routing_code: String,
}

impl PersonalDataView {
    /// Build the detail view of a personal-data record.
    ///
    /// Credit cards keep their dedicated record getters; every other non-personal
    /// type fails with `PersonalDataViewUnavailable`.
    pub fn from_value(value: &SecretValue) -> SecretPayloadResult<Self> {
        match value {
            SecretValue::Person(person) => Ok(Self::Person(PersonView::from_secret(person))),
            SecretValue::Address(address) => Ok(Self::Address(AddressView::from_secret(address))),
            SecretValue::IdentityDocument(document) => Ok(Self::IdentityDocument(
                IdentityDocumentView::from_secret(document),
            )),
            SecretValue::BankAccount(account) => {
                Ok(Self::BankAccount(BankAccountView::from_secret(account)))
            }
            SecretValue::Login(_)
            | SecretValue::ApiKey(_)
            | SecretValue::SeedPhrase(_)
            | SecretValue::SecureNote(_)
            | SecretValue::Passkey(_)
            | SecretValue::Authenticator(_)
            | SecretValue::CreditCard(_)
            | SecretValue::FileAttachment(_) => {
                Err(SecretPayloadError::PersonalDataViewUnavailable {
                    secret_type: value.secret_type(),
                })
            }
        }
    }
}

impl PersonView {
    fn from_secret(person: &PersonSecret) -> Self {
        Self {
            given_name: person.given_name.clone(),
            middle_name: person.middle_name.clone(),
            family_name: person.family_name.clone(),
            full_name: person.full_name(),
            birth_date: person.birth_date.clone(),
            email: person.email.clone(),
            phone: person.phone.clone(),
        }
    }
}

impl AddressView {
    fn from_secret(address: &AddressSecret) -> Self {
        Self {
            label: address.label.clone(),
            address_line1: address.address_line1.clone(),
            address_line2: address.address_line2.clone(),
            city: address.city.clone(),
            region: address.region.clone(),
            postal_code: address.postal_code.clone(),
            country: address.country.clone(),
        }
    }
}

impl IdentityDocumentView {
    fn from_secret(document: &IdentityDocumentSecret) -> Self {
        Self {
            document_kind: document.kind,
            number: document.number.clone(),
            masked_number: document.masked_number(),
            issuing_country: document.issuing_country.clone(),
            issue_date: document.issue_date.clone(),
            expiry_date: document.expiry_date.clone(),
            name_as_printed: document.name_as_printed.clone(),
        }
    }
}

impl BankAccountView {
    fn from_secret(account: &BankAccountSecret) -> Self {
        Self {
            account_holder: account.account_holder.clone(),
            bank_name: account.bank_name.clone(),
            account_number: account.account_number.clone(),
            masked_number: account.masked_number(),
            routing_code: account.routing_code.clone(),
        }
    }
}

impl Zeroize for PersonalDataView {
    fn zeroize(&mut self) {
        match self {
            Self::Person(view) => {
                view.given_name.zeroize();
                view.middle_name.zeroize();
                view.family_name.zeroize();
                view.full_name.zeroize();
                view.birth_date.zeroize();
                view.email.zeroize();
                view.phone.zeroize();
            }
            Self::Address(view) => {
                view.label.zeroize();
                view.address_line1.zeroize();
                view.address_line2.zeroize();
                view.city.zeroize();
                view.region.zeroize();
                view.postal_code.zeroize();
                view.country.zeroize();
            }
            Self::IdentityDocument(view) => {
                view.number.zeroize();
                view.masked_number.zeroize();
                view.issuing_country.zeroize();
                view.issue_date.zeroize();
                view.expiry_date.zeroize();
                view.name_as_printed.zeroize();
            }
            Self::BankAccount(view) => {
                view.account_holder.zeroize();
                view.bank_name.zeroize();
                view.account_number.zeroize();
                view.masked_number.zeroize();
                view.routing_code.zeroize();
            }
        }
    }
}

impl fmt::Debug for PersonalDataView {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self {
            Self::Person(_) => "Person",
            Self::Address(_) => "Address",
            Self::IdentityDocument(_) => "IdentityDocument",
            Self::BankAccount(_) => "BankAccount",
        };
        formatter
            .debug_struct("PersonalDataView")
            .field("kind", &kind)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use super::PersonalDataView;
    use crate::errors::SecretPayloadError;
    use crate::{
        BankAccountFields, BankAccountSecret, CreditCardFields, CreditCardSecret,
        IdentityDocumentFields, IdentityDocumentKind, IdentityDocumentSecret, LoginSecret,
        SecretType, SecretValue,
    };
    use zeroize::Zeroize;

    #[test]
    fn document_view_carries_full_and_masked_number_under_kind_tag() -> anyhow::Result<()> {
        let value = SecretValue::IdentityDocument(IdentityDocumentSecret::from_fields(
            IdentityDocumentFields {
                kind: IdentityDocumentKind::DriversLicense,
                number: "D1234567",
                issuing_country: "US",
                issue_date: "",
                expiry_date: "2031-05-01",
                name_as_printed: "ADA LOVELACE",
            },
        )?);
        let view = PersonalDataView::from_value(&value)?;
        assert_eq!(
            serde_json::to_value(&view)?,
            serde_json::json!({
                "kind": "identity-document",
                "documentKind": "drivers-license",
                "number": "D1234567",
                "maskedNumber": "•••• 4567",
                "issuingCountry": "US",
                "issueDate": "",
                "expiryDate": "2031-05-01",
                "nameAsPrinted": "ADA LOVELACE",
            })
        );
        assert_eq!(
            format!("{view:?}"),
            "PersonalDataView { kind: \"IdentityDocument\", .. }"
        );
        Ok(())
    }

    #[test]
    fn bank_view_zeroizes_every_plaintext_field() -> anyhow::Result<()> {
        let value = SecretValue::BankAccount(BankAccountSecret::from_fields(BankAccountFields {
            account_holder: "Ada Lovelace",
            bank_name: "Analytical Bank",
            account_number: "GB82WEST12345698765432",
            routing_code: "",
        })?);
        let mut view = PersonalDataView::from_value(&value)?;
        let PersonalDataView::BankAccount(account) = &view else {
            anyhow::bail!("expected bank account view");
        };
        assert_eq!(account.masked_number, "•••• 5432");
        assert_eq!(account.account_number, "GB82WEST12345698765432");
        view.zeroize();
        let PersonalDataView::BankAccount(account) = &view else {
            anyhow::bail!("expected bank account view");
        };
        assert!(account.account_number.is_empty());
        assert!(account.masked_number.is_empty());
        assert!(account.account_holder.is_empty());
        Ok(())
    }

    #[test]
    fn non_personal_records_have_no_personal_view() -> anyhow::Result<()> {
        let login = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "ada".to_owned(),
            password: "pw".to_owned(),
            notes: String::new(),
        });
        let card = SecretValue::CreditCard(CreditCardSecret::from_fields(CreditCardFields {
            title: "Card",
            cardholder_name: "",
            number: "4111111111111111",
            expiration_month: "",
            expiration_year: "",
            cvv: "",
            notes: "",
        })?);
        for (value, secret_type) in [(login, SecretType::Login), (card, SecretType::CreditCard)] {
            assert!(matches!(
                PersonalDataView::from_value(&value),
                Err(SecretPayloadError::PersonalDataViewUnavailable { secret_type: actual })
                    if actual == secret_type
            ));
        }
        Ok(())
    }
}
