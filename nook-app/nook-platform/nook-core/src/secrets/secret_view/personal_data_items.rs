//! Secret-free list projections and row presentation for personal data.
//!
//! List items carry names, labels, and masked number tails only. Full
//! document/account numbers, birth dates, phones, postal codes, regions,
//! routing codes, and issuing countries stay in the decrypted record.

use super::secret_presentation::SecretTitle;
use crate::secrets::personal_data::SensitiveNumber;
use crate::{
    AddressSecret, BankAccountSecret, IdentityDocumentKind, IdentityDocumentSecret, PersonSecret,
};
use serde::{Deserialize, Serialize};
use std::fmt;

/// List metadata for a person record.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PersonListItem {
    pub full_name: String,
    pub email: String,
}

/// List metadata for a postal address record.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AddressListItem {
    pub label: String,
    pub line1: String,
    pub city: String,
    pub country: String,
}

/// List metadata for an identity document; the number is reduced to its tail.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IdentityDocumentListItem {
    pub kind: IdentityDocumentKind,
    pub name_as_printed: String,
    pub last4: String,
    pub expiry_date: String,
}

/// List metadata for a bank account; the account number is reduced to its tail.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BankAccountListItem {
    pub bank_name: String,
    pub account_holder: String,
    pub last4: String,
}

impl fmt::Debug for PersonListItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PersonListItem")
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for AddressListItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AddressListItem")
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for BankAccountListItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BankAccountListItem")
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for IdentityDocumentListItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IdentityDocumentListItem")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

/// First non-blank candidate, trimmed; empty when every candidate is blank.
struct FirstPresent<'a> {
    candidates: &'a [&'a str],
}

impl FirstPresent<'_> {
    fn text(&self) -> String {
        self.candidates
            .iter()
            .map(|candidate| candidate.trim())
            .find(|candidate| !candidate.is_empty())
            .unwrap_or_default()
            .to_owned()
    }
}

impl PersonSecret {
    #[must_use]
    pub fn list_item(&self) -> PersonListItem {
        PersonListItem {
            full_name: self.full_name(),
            email: self.email.clone(),
        }
    }
}

impl AddressSecret {
    #[must_use]
    pub fn list_item(&self) -> AddressListItem {
        AddressListItem {
            label: self.label.clone(),
            line1: self.address_line1.clone(),
            city: self.city.clone(),
            country: self.country.clone(),
        }
    }
}

impl IdentityDocumentSecret {
    #[must_use]
    pub fn list_item(&self) -> IdentityDocumentListItem {
        IdentityDocumentListItem {
            kind: self.kind,
            name_as_printed: self.name_as_printed.clone(),
            last4: self.last4(),
            expiry_date: self.expiry_date.clone(),
        }
    }
}

impl BankAccountSecret {
    #[must_use]
    pub fn list_item(&self) -> BankAccountListItem {
        BankAccountListItem {
            bank_name: self.bank_name.clone(),
            account_holder: self.account_holder.clone(),
            last4: self.last4(),
        }
    }
}

impl PersonListItem {
    #[must_use]
    pub fn display_title(&self) -> String {
        self.full_name.trim().to_owned()
    }

    #[must_use]
    pub fn summary(&self) -> String {
        FirstPresent {
            candidates: &[&self.email, &self.full_name],
        }
        .text()
    }

    #[must_use]
    pub(crate) fn group_key(&self) -> String {
        SecretTitle::new(&self.full_name, "Unnamed Person").group_key()
    }

    pub(crate) fn search_fields(&self) -> [String; 2] {
        [self.full_name.clone(), self.email.clone()]
    }
}

impl AddressListItem {
    #[must_use]
    pub fn display_title(&self) -> String {
        FirstPresent {
            candidates: &[&self.label, &self.line1],
        }
        .text()
    }

    /// `City, Country` when either is present, otherwise the first line.
    #[must_use]
    pub fn summary(&self) -> String {
        let locality = [self.city.trim(), self.country.trim()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        FirstPresent {
            candidates: &[&locality, &self.line1],
        }
        .text()
    }

    #[must_use]
    pub(crate) fn group_key(&self) -> String {
        SecretTitle::new(&self.display_title(), "Unnamed Address").group_key()
    }

    pub(crate) fn search_fields(&self) -> [String; 4] {
        [
            self.label.clone(),
            self.line1.clone(),
            self.city.clone(),
            self.country.clone(),
        ]
    }
}

impl IdentityDocumentListItem {
    #[must_use]
    pub fn display_title(&self) -> String {
        FirstPresent {
            candidates: &[&self.name_as_printed, &self.summary()],
        }
        .text()
    }

    /// Masked document number (`•••• 4567`).
    #[must_use]
    pub fn summary(&self) -> String {
        SensitiveNumber::masked_tail(&self.last4)
    }

    #[must_use]
    pub(crate) fn group_key(&self) -> String {
        SecretTitle::new(&self.name_as_printed, "Unnamed Document").group_key()
    }

    pub(crate) fn search_fields(&self) -> [String; 4] {
        [
            self.kind.as_str().to_owned(),
            self.name_as_printed.clone(),
            self.last4.clone(),
            self.expiry_date.clone(),
        ]
    }
}

impl BankAccountListItem {
    #[must_use]
    pub fn display_title(&self) -> String {
        FirstPresent {
            candidates: &[&self.bank_name, &self.account_holder, &self.summary()],
        }
        .text()
    }

    /// Masked account number (`•••• 5432`).
    #[must_use]
    pub fn summary(&self) -> String {
        SensitiveNumber::masked_tail(&self.last4)
    }

    #[must_use]
    pub(crate) fn group_key(&self) -> String {
        SecretTitle::new(&self.bank_name, "Unnamed Bank Account").group_key()
    }

    pub(crate) fn search_fields(&self) -> [String; 3] {
        [
            self.bank_name.clone(),
            self.account_holder.clone(),
            self.last4.clone(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::{AddressListItem, BankAccountListItem, IdentityDocumentListItem, PersonListItem};
    use crate::{
        AddressFields, AddressSecret, BankAccountFields, BankAccountSecret, IdentityDocumentFields,
        IdentityDocumentKind, IdentityDocumentSecret, PersonFields, PersonSecret, SecretId,
        SecretListItemData, SecretRecord, SecretValue,
    };

    fn record(data: SecretValue) -> SecretRecord {
        SecretRecord {
            id: SecretId::from_vault_record("secret_personal"),
            secret_type: data.secret_type(),
            data,
        }
    }

    fn document() -> anyhow::Result<SecretRecord> {
        Ok(record(SecretValue::IdentityDocument(
            IdentityDocumentSecret::from_fields(IdentityDocumentFields {
                kind: IdentityDocumentKind::Passport,
                number: "X1234567",
                issuing_country: "GB",
                issue_date: "2020-01-15",
                expiry_date: "2030-01-14",
                name_as_printed: "ADA LOVELACE",
            })?,
        )))
    }

    fn bank_account() -> anyhow::Result<SecretRecord> {
        Ok(record(SecretValue::BankAccount(
            BankAccountSecret::from_fields(BankAccountFields {
                account_holder: "Ada Lovelace",
                bank_name: "Analytical Bank",
                account_number: "GB82WEST12345698765432",
                routing_code: "NWBKGB2L",
            })?,
        )))
    }

    #[test]
    fn person_list_item_keeps_name_and_email_only() -> anyhow::Result<()> {
        let record = record(SecretValue::Person(PersonSecret::from_fields(
            PersonFields {
                given_name: "Ada",
                middle_name: "Augusta",
                family_name: "Lovelace",
                birth_date: "1815-12-10",
                email: "ada@example.com",
                phone: "+44 20 7946 0958",
            },
        )?));
        let item = record.list_item();
        assert_eq!(
            item.data,
            SecretListItemData::Person(PersonListItem {
                full_name: "Ada Augusta Lovelace".to_owned(),
                email: "ada@example.com".to_owned(),
            })
        );
        assert_eq!(item.display_title(), "Ada Augusta Lovelace");
        assert_eq!(item.summary(), "ada@example.com");
        assert_eq!(item.group_key(), "Ada Augusta Lovelace");
        assert_eq!(record.display_title(), item.display_title());
        assert_eq!(record.primary_credential(), "");
        let search = item.normalized_search_text();
        assert!(search.contains("ada@example.com"));
        assert!(!search.contains("1815"));
        assert!(!search.contains("7946"));
        assert!(!format!("{item:?}").contains("Ada"));
        Ok(())
    }

    #[test]
    fn address_list_item_summarizes_locality_without_postal_details() -> anyhow::Result<()> {
        let record = record(SecretValue::Address(AddressSecret::from_fields(
            AddressFields {
                label: "",
                address_line1: "12 Analytical Row",
                address_line2: "Flat 3",
                city: "London",
                region: "Greater London",
                postal_code: "W1 1AA",
                country: "GB",
            },
        )?));
        let item = record.list_item();
        assert_eq!(
            item.data,
            SecretListItemData::Address(AddressListItem {
                label: String::new(),
                line1: "12 Analytical Row".to_owned(),
                city: "London".to_owned(),
                country: "GB".to_owned(),
            })
        );
        assert_eq!(item.display_title(), "12 Analytical Row");
        assert_eq!(item.summary(), "London, GB");
        assert_eq!(record.group_key(), "12 Analytical Row");
        assert!(!item.normalized_search_text().contains("w1 1aa"));
        assert!(record.matches_search("london"));
        Ok(())
    }

    #[test]
    fn document_list_item_masks_number_and_omits_dates_of_issue() -> anyhow::Result<()> {
        let record = document()?;
        let item = record.list_item();
        assert_eq!(
            item.data,
            SecretListItemData::IdentityDocument(IdentityDocumentListItem {
                kind: IdentityDocumentKind::Passport,
                name_as_printed: "ADA LOVELACE".to_owned(),
                last4: "4567".to_owned(),
                expiry_date: "2030-01-14".to_owned(),
            })
        );
        assert_eq!(item.display_title(), "ADA LOVELACE");
        assert_eq!(item.summary(), "•••• 4567");
        assert_eq!(record.summary(), "•••• 4567");
        assert_eq!(record.primary_credential(), "X1234567");
        let search = item.normalized_search_text();
        assert!(search.contains("passport"));
        assert!(!search.contains("x1234567"));
        assert!(!search.contains("2020-01-15"));
        assert!(!format!("{item:?}").contains("4567"));
        Ok(())
    }

    #[test]
    fn bank_list_item_masks_account_number_and_omits_routing_code() -> anyhow::Result<()> {
        let record = bank_account()?;
        let item = record.list_item();
        assert_eq!(
            item.data,
            SecretListItemData::BankAccount(BankAccountListItem {
                bank_name: "Analytical Bank".to_owned(),
                account_holder: "Ada Lovelace".to_owned(),
                last4: "5432".to_owned(),
            })
        );
        assert_eq!(item.display_title(), "Analytical Bank");
        assert_eq!(item.summary(), "•••• 5432");
        assert_eq!(item.website_host(), "");
        let search = item.normalized_search_text();
        assert!(!search.contains("gb82west"));
        assert!(!search.contains("nwbkgb2l"));
        assert!(record.matches_search("analytical"));
        assert!(!record.matches_search("NWBK"));
        Ok(())
    }

    #[test]
    fn blank_optional_labels_fall_back_to_masked_or_unnamed_titles() {
        let account = BankAccountListItem {
            bank_name: String::new(),
            account_holder: String::new(),
            last4: "5432".to_owned(),
        };
        assert_eq!(account.display_title(), "•••• 5432");
        assert_eq!(account.group_key(), "Unnamed Bank Account");
        let document = IdentityDocumentListItem {
            kind: IdentityDocumentKind::NationalId,
            name_as_printed: String::new(),
            last4: String::new(),
            expiry_date: String::new(),
        };
        assert_eq!(document.display_title(), "••••");
        assert_eq!(document.group_key(), "Unnamed Document");
    }

    #[test]
    fn zeroize_plaintext_clears_every_personal_variant() -> anyhow::Result<()> {
        let mut document = document()?;
        document.zeroize_plaintext();
        let SecretValue::IdentityDocument(document) = &document.data else {
            anyhow::bail!("expected identity document");
        };
        assert!(document.number.is_empty());
        let mut account = bank_account()?;
        account.zeroize_plaintext();
        let SecretValue::BankAccount(account) = &account.data else {
            anyhow::bail!("expected bank account");
        };
        assert!(account.account_number.is_empty());
        assert!(account.account_holder.is_empty());
        Ok(())
    }
}
