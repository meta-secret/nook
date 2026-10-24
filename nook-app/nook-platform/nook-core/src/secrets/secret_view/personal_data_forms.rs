//! Typed form inputs for personal-data secrets.
//!
//! These structural DTOs cross the WASM boundary through `tsify` and are
//! validated only by the payload constructors in `secrets::personal_data`.

use crate::{
    AddressFields, BankAccountFields, IdentityDocumentFields, IdentityDocumentKind, PersonFields,
};
use serde::Deserialize;
use std::fmt;
use tsify::Tsify;

/// Unvalidated person form input.
#[derive(Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonSecretForm {
    pub given_name: String,
    pub middle_name: String,
    pub family_name: String,
    pub birth_date: String,
    pub email: String,
    pub phone: String,
}

/// Unvalidated postal-address form input.
#[derive(Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddressSecretForm {
    pub label: String,
    pub address_line1: String,
    pub address_line2: String,
    pub city: String,
    pub region: String,
    pub postal_code: String,
    pub country: String,
}

/// Unvalidated identity-document form input.
#[derive(Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityDocumentSecretForm {
    pub kind: IdentityDocumentKind,
    pub number: String,
    pub issuing_country: String,
    pub issue_date: String,
    pub expiry_date: String,
    pub name_as_printed: String,
}

/// Unvalidated bank-account form input.
#[derive(Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BankAccountSecretForm {
    pub account_holder: String,
    pub bank_name: String,
    pub account_number: String,
    pub routing_code: String,
}

impl fmt::Debug for PersonSecretForm {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PersonSecretForm")
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for AddressSecretForm {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AddressSecretForm")
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for IdentityDocumentSecretForm {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IdentityDocumentSecretForm")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for BankAccountSecretForm {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BankAccountSecretForm")
            .finish_non_exhaustive()
    }
}

impl PersonSecretForm {
    #[must_use]
    pub fn fields(&self) -> PersonFields<'_> {
        PersonFields {
            given_name: &self.given_name,
            middle_name: &self.middle_name,
            family_name: &self.family_name,
            birth_date: &self.birth_date,
            email: &self.email,
            phone: &self.phone,
        }
    }
}

impl AddressSecretForm {
    #[must_use]
    pub fn fields(&self) -> AddressFields<'_> {
        AddressFields {
            label: &self.label,
            address_line1: &self.address_line1,
            address_line2: &self.address_line2,
            city: &self.city,
            region: &self.region,
            postal_code: &self.postal_code,
            country: &self.country,
        }
    }
}

impl IdentityDocumentSecretForm {
    #[must_use]
    pub fn fields(&self) -> IdentityDocumentFields<'_> {
        IdentityDocumentFields {
            kind: self.kind,
            number: &self.number,
            issuing_country: &self.issuing_country,
            issue_date: &self.issue_date,
            expiry_date: &self.expiry_date,
            name_as_printed: &self.name_as_printed,
        }
    }
}

impl BankAccountSecretForm {
    #[must_use]
    pub fn fields(&self) -> BankAccountFields<'_> {
        BankAccountFields {
            account_holder: &self.account_holder,
            bank_name: &self.bank_name,
            account_number: &self.account_number,
            routing_code: &self.routing_code,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AddressSecretForm, BankAccountSecretForm, IdentityDocumentSecretForm, PersonSecretForm,
    };
    use crate::errors::SecretPayloadError;
    use crate::{IdentityDocumentKind, SecretFormFields, SecretType, SecretValue, ValidationError};

    fn person_form() -> PersonSecretForm {
        PersonSecretForm {
            given_name: " Ada ".to_owned(),
            middle_name: String::new(),
            family_name: "Lovelace".to_owned(),
            birth_date: "1815-12-10".to_owned(),
            email: "ada@example.com".to_owned(),
            phone: "+44 20 7946 0958".to_owned(),
        }
    }

    fn address_form() -> AddressSecretForm {
        AddressSecretForm {
            label: "Home".to_owned(),
            address_line1: "12 Analytical Row".to_owned(),
            address_line2: "Flat 3".to_owned(),
            city: "London".to_owned(),
            region: "Greater London".to_owned(),
            postal_code: "W1 1AA".to_owned(),
            country: "United Kingdom".to_owned(),
        }
    }

    fn document_form() -> IdentityDocumentSecretForm {
        IdentityDocumentSecretForm {
            kind: IdentityDocumentKind::NationalId,
            number: "ID-998877".to_owned(),
            issuing_country: "GB".to_owned(),
            issue_date: "2021-03-01".to_owned(),
            expiry_date: "2031-03-01".to_owned(),
            name_as_printed: "ADA LOVELACE".to_owned(),
        }
    }

    fn bank_form() -> BankAccountSecretForm {
        BankAccountSecretForm {
            account_holder: "Ada Lovelace".to_owned(),
            bank_name: "Analytical Bank".to_owned(),
            account_number: "de89 3704 0044 0532 0130 00".to_owned(),
            routing_code: "COBADEFFXXX".to_owned(),
        }
    }

    fn round_trip(fields: &SecretFormFields) -> anyhow::Result<SecretValue> {
        let yaml = SecretFormFields::build_secret_yaml_from_form(fields)?;
        let value = SecretValue::from_yaml(fields.secret_type(), &yaml)?;
        assert_eq!(value.secret_type(), fields.secret_type());
        assert_eq!(value.to_yaml()?.as_str(), yaml.as_str());
        Ok(value)
    }

    #[test]
    fn every_personal_form_round_trips_through_validated_camel_case_yaml() -> anyhow::Result<()> {
        let SecretValue::Person(person) = round_trip(&SecretFormFields::Person(person_form()))?
        else {
            anyhow::bail!("expected person");
        };
        assert_eq!(person.given_name, "Ada");

        let fields = SecretFormFields::Address(address_form());
        let yaml = SecretFormFields::build_secret_yaml_from_form(&fields)?;
        assert!(yaml.as_str().contains("addressLine1: 12 Analytical Row"));
        assert!(yaml.as_str().contains("postalCode: W1 1AA"));
        round_trip(&fields)?;

        let fields = SecretFormFields::IdentityDocument(document_form());
        let yaml = SecretFormFields::build_secret_yaml_from_form(&fields)?;
        assert!(yaml.as_str().contains("kind: national-id"));
        assert!(yaml.as_str().contains("nameAsPrinted: ADA LOVELACE"));
        round_trip(&fields)?;

        let SecretValue::BankAccount(account) =
            round_trip(&SecretFormFields::BankAccount(bank_form()))?
        else {
            anyhow::bail!("expected bank account");
        };
        assert_eq!(account.account_number, "DE89370400440532013000");
        Ok(())
    }

    #[test]
    fn invalid_forms_fail_with_typed_validation_errors() {
        let cases = [
            (
                SecretFormFields::Person(PersonSecretForm {
                    given_name: String::new(),
                    family_name: String::new(),
                    ..person_form()
                }),
                ValidationError::PersonNameRequired,
            ),
            (
                SecretFormFields::Address(AddressSecretForm {
                    address_line1: " ".to_owned(),
                    ..address_form()
                }),
                ValidationError::AddressLine1Required,
            ),
            (
                SecretFormFields::IdentityDocument(IdentityDocumentSecretForm {
                    expiry_date: "2020-01-01".to_owned(),
                    ..document_form()
                }),
                ValidationError::IdentityDocumentExpiryBeforeIssue,
            ),
            (
                SecretFormFields::BankAccount(BankAccountSecretForm {
                    account_number: "DE89370400440532013001".to_owned(),
                    ..bank_form()
                }),
                ValidationError::BankAccountIbanInvalid,
            ),
        ];
        for (fields, expected) in cases {
            assert!(matches!(
                SecretFormFields::build_secret_yaml_from_form(&fields),
                Err(SecretPayloadError::Validation(error)) if error == expected
            ));
        }
    }

    #[test]
    fn decrypt_path_revalidates_and_rejects_unknown_or_invalid_payloads() {
        let invalid_iban = "accountHolder: Ada\nbankName: Bank\naccountNumber: GB82WEST12345698765433\nroutingCode: ''\n";
        assert!(matches!(
            SecretValue::from_yaml_str(SecretType::BankAccount, invalid_iban),
            Err(SecretPayloadError::Validation(
                ValidationError::BankAccountIbanInvalid
            ))
        ));
        let unknown_field = "givenName: Ada\nmiddleName: ''\nfamilyName: ''\nbirthDate: ''\nemail: ''\nphone: ''\nnickname: Countess\n";
        assert!(matches!(
            SecretValue::from_yaml_str(SecretType::Person, unknown_field),
            Err(SecretPayloadError::InvalidPerson(_))
        ));
        let unknown_kind = "kind: visa\nnumber: X1\nissuingCountry: ''\nissueDate: ''\nexpiryDate: ''\nnameAsPrinted: ''\n";
        assert!(matches!(
            SecretValue::from_yaml_str(SecretType::IdentityDocument, unknown_kind),
            Err(SecretPayloadError::InvalidIdentityDocument(_))
        ));
        assert!(matches!(
            SecretValue::from_yaml_str(SecretType::Address, "label: Home\n"),
            Err(SecretPayloadError::InvalidAddress(_))
        ));
    }

    #[test]
    fn forms_deserialize_from_camel_case_dto_and_redact_debug() -> anyhow::Result<()> {
        let form: IdentityDocumentSecretForm = serde_json::from_value(serde_json::json!({
            "kind": "drivers-license",
            "number": "D1234567",
            "issuingCountry": "US",
            "issueDate": "",
            "expiryDate": "",
            "nameAsPrinted": "ADA LOVELACE",
        }))?;
        assert_eq!(form.kind, IdentityDocumentKind::DriversLicense);
        assert_eq!(
            format!("{form:?}"),
            "IdentityDocumentSecretForm { kind: DriversLicense, .. }"
        );
        assert!(
            serde_json::from_value::<BankAccountSecretForm>(serde_json::json!({
                "accountHolder": "", "bankName": "", "accountNumber": "1", "routingCode": "",
                "iban": "extra"
            }))
            .is_err()
        );
        let debug = format!("{:?}", SecretFormFields::BankAccount(bank_form()));
        assert!(!debug.contains("3704"));
        assert!(!debug.contains("Ada"));
        Ok(())
    }
}
