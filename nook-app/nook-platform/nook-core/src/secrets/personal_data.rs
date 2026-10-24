//! Personal-data vault payloads: people, postal addresses, identity
//! documents, and bank accounts.
//!
//! Each payload owns its normalization and validation, a redacted `Debug`
//! representation, and plaintext zeroization. List projections, form inputs,
//! and the explicit-reveal detail view live in `secret_view`. Credit cards stay
//! in `credit_card` but share the `SecretCategory::PersonalData` section.

mod address;
mod bank_account;
mod calendar_date;
mod identity_document;
mod person;
mod personal_text;
mod sensitive_number;

pub use address::{AddressFields, AddressSecret};
pub use bank_account::{BankAccountFields, BankAccountSecret};
pub use calendar_date::{CalendarDate, CalendarDateError};
pub use identity_document::{IdentityDocumentFields, IdentityDocumentKind, IdentityDocumentSecret};
pub use person::{PersonFields, PersonSecret};
pub(crate) use sensitive_number::SensitiveNumber;
