//! Secret-free list projections and row presentation for personal data.
//!
//! List items carry names, labels, and masked number tails only. Full
//! document/account numbers, birth dates, phones, postal codes, regions,
//! routing codes, and issuing countries stay in the decrypted record.

use super::secret_presentation::SecretTitle;
use crate::secrets::personal_data::SensitiveNumber;
use crate::{
    AddressSecret, DomesticAccountSecret, IdentityDocumentKind, IdentityDocumentSecret,
    InternationalAccountSecret, PersonSecret,
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

/// List metadata for an international account; the IBAN is reduced to its tail.
/// The SWIFT/BIC is a public bank identifier.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InternationalAccountListItem {
    pub bank_name: String,
    pub account_holder: String,
    pub last4: String,
    pub swift_bic: String,
}

/// List metadata for a US domestic account; the account number is reduced to
/// its tail. The ABA routing number is a public bank identifier.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomesticAccountListItem {
    pub bank_name: String,
    pub account_holder: String,
    pub last4: String,
    pub routing_number: String,
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

impl fmt::Debug for InternationalAccountListItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InternationalAccountListItem")
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for DomesticAccountListItem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DomesticAccountListItem")
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

impl InternationalAccountSecret {
    #[must_use]
    pub fn list_item(&self) -> InternationalAccountListItem {
        InternationalAccountListItem {
            bank_name: self.bank_name.clone(),
            account_holder: self.account_holder.clone(),
            last4: self.last4(),
            swift_bic: self.swift_bic.clone(),
        }
    }
}

impl DomesticAccountSecret {
    #[must_use]
    pub fn list_item(&self) -> DomesticAccountListItem {
        DomesticAccountListItem {
            bank_name: self.bank_name.clone(),
            account_holder: self.account_holder.clone(),
            last4: self.last4(),
            routing_number: self.routing_number.clone(),
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

/// Shared row text for both bank account kinds.
struct BankAccountRow<'a> {
    bank_name: &'a str,
    account_holder: &'a str,
    last4: &'a str,
    /// Public bank identifier (SWIFT/BIC or ABA routing number), or empty.
    bank_code: &'a str,
}

impl BankAccountRow<'_> {
    fn display_title(&self) -> String {
        FirstPresent {
            candidates: &[
                self.bank_name,
                self.account_holder,
                &SensitiveNumber::masked_tail(self.last4),
            ],
        }
        .text()
    }

    /// Masked number plus the public bank code (`•••• 5432 · NWBKGB2L`).
    fn summary(&self) -> String {
        let masked = SensitiveNumber::masked_tail(self.last4);
        match self.bank_code.trim() {
            "" => masked,
            code => format!("{masked} · {code}"),
        }
    }

    fn group_key(&self) -> String {
        SecretTitle::new(self.bank_name, "Unnamed Bank Account").group_key()
    }
}

impl InternationalAccountListItem {
    fn row(&self) -> BankAccountRow<'_> {
        BankAccountRow {
            bank_name: &self.bank_name,
            account_holder: &self.account_holder,
            last4: &self.last4,
            bank_code: &self.swift_bic,
        }
    }

    #[must_use]
    pub fn display_title(&self) -> String {
        self.row().display_title()
    }

    /// Masked IBAN plus the SWIFT/BIC when stored (`•••• 5432 · NWBKGB2L`).
    #[must_use]
    pub fn summary(&self) -> String {
        self.row().summary()
    }

    #[must_use]
    pub(crate) fn group_key(&self) -> String {
        self.row().group_key()
    }

    pub(crate) fn search_fields(&self) -> [String; 4] {
        [
            self.bank_name.clone(),
            self.account_holder.clone(),
            self.last4.clone(),
            self.swift_bic.clone(),
        ]
    }
}

impl DomesticAccountListItem {
    fn row(&self) -> BankAccountRow<'_> {
        BankAccountRow {
            bank_name: &self.bank_name,
            account_holder: &self.account_holder,
            last4: &self.last4,
            bank_code: &self.routing_number,
        }
    }

    #[must_use]
    pub fn display_title(&self) -> String {
        self.row().display_title()
    }

    /// Masked account number plus the routing number (`•••• 6789 · 021000021`).
    #[must_use]
    pub fn summary(&self) -> String {
        self.row().summary()
    }

    #[must_use]
    pub(crate) fn group_key(&self) -> String {
        self.row().group_key()
    }

    pub(crate) fn search_fields(&self) -> [String; 4] {
        [
            self.bank_name.clone(),
            self.account_holder.clone(),
            self.last4.clone(),
            self.routing_number.clone(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AddressListItem, DomesticAccountListItem, IdentityDocumentListItem,
        InternationalAccountListItem, PersonListItem,
    };
    use crate::{
        AddressFields, AddressSecret, DomesticAccountFields, DomesticAccountSecret,
        IdentityDocumentFields, IdentityDocumentKind, IdentityDocumentSecret,
        InternationalAccountFields, InternationalAccountSecret, PersonFields, PersonSecret,
        SecretCategory, SecretId, SecretListItemData, SecretRecord, SecretValue,
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

    fn international_account() -> anyhow::Result<SecretRecord> {
        Ok(record(SecretValue::InternationalAccount(
            InternationalAccountSecret::from_fields(InternationalAccountFields {
                account_holder: "Ada Lovelace",
                bank_name: "Analytical Bank",
                iban: "GB82WEST12345698765432",
                swift_bic: "NWBKGB2L",
            })?,
        )))
    }

    fn domestic_account() -> anyhow::Result<SecretRecord> {
        Ok(record(SecretValue::DomesticAccount(
            DomesticAccountSecret::from_fields(DomesticAccountFields {
                account_holder: "Ada Lovelace",
                bank_name: "Federal Bank",
                account_number: "000123456789",
                routing_number: "021000021",
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
    fn international_list_item_masks_iban_and_shows_public_bic() -> anyhow::Result<()> {
        let record = international_account()?;
        let item = record.list_item();
        assert_eq!(
            item.data,
            SecretListItemData::InternationalAccount(InternationalAccountListItem {
                bank_name: "Analytical Bank".to_owned(),
                account_holder: "Ada Lovelace".to_owned(),
                last4: "5432".to_owned(),
                swift_bic: "NWBKGB2L".to_owned(),
            })
        );
        assert_eq!(item.display_title(), "Analytical Bank");
        assert_eq!(item.summary(), "•••• 5432 · NWBKGB2L");
        assert_eq!(record.summary(), "•••• 5432 · NWBKGB2L");
        assert_eq!(record.primary_credential(), "GB82WEST12345698765432");
        assert_eq!(item.website_host(), "");
        assert_eq!(record.secret_type.category(), SecretCategory::PersonalData);
        let search = item.normalized_search_text();
        assert!(!search.contains("gb82west"));
        assert!(record.matches_search("analytical"));
        assert!(record.matches_search("nwbk"));
        assert!(!format!("{item:?}").contains("5432"));
        Ok(())
    }

    #[test]
    fn domestic_list_item_masks_account_number_and_shows_routing_number() -> anyhow::Result<()> {
        let record = domestic_account()?;
        let item = record.list_item();
        assert_eq!(
            item.data,
            SecretListItemData::DomesticAccount(DomesticAccountListItem {
                bank_name: "Federal Bank".to_owned(),
                account_holder: "Ada Lovelace".to_owned(),
                last4: "6789".to_owned(),
                routing_number: "021000021".to_owned(),
            })
        );
        assert_eq!(item.display_title(), "Federal Bank");
        assert_eq!(item.summary(), "•••• 6789 · 021000021");
        assert_eq!(record.primary_credential(), "000123456789");
        assert_eq!(record.secret_type.category(), SecretCategory::PersonalData);
        let search = item.normalized_search_text();
        assert!(!search.contains("000123456789"));
        assert!(record.matches_search("021000021"));
        assert!(!format!("{item:?}").contains("021000021"));
        Ok(())
    }

    #[test]
    fn blank_optional_labels_fall_back_to_masked_or_unnamed_titles() {
        let account = InternationalAccountListItem {
            bank_name: String::new(),
            account_holder: String::new(),
            last4: "5432".to_owned(),
            swift_bic: String::new(),
        };
        assert_eq!(account.display_title(), "•••• 5432");
        assert_eq!(account.summary(), "•••• 5432");
        assert_eq!(account.group_key(), "Unnamed Bank Account");
        let domestic = DomesticAccountListItem {
            bank_name: String::new(),
            account_holder: "Ada Lovelace".to_owned(),
            last4: "6789".to_owned(),
            routing_number: "021000021".to_owned(),
        };
        assert_eq!(domestic.display_title(), "Ada Lovelace");
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
        let mut account = international_account()?;
        account.zeroize_plaintext();
        let SecretValue::InternationalAccount(account) = &account.data else {
            anyhow::bail!("expected international account");
        };
        assert!(account.iban.is_empty());
        assert!(account.swift_bic.is_empty());
        let mut domestic = domestic_account()?;
        domestic.zeroize_plaintext();
        let SecretValue::DomesticAccount(domestic) = &domestic.data else {
            anyhow::bail!("expected domestic account");
        };
        assert!(domestic.account_number.is_empty());
        assert!(domestic.routing_number.is_empty());
        Ok(())
    }
}
