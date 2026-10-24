//! Personal-data vault payloads: people, postal addresses, identity
//! documents, and bank accounts.
//!
//! Each payload owns its normalization and validation, a redacted `Debug`
//! representation, and plaintext zeroization. List projections, form inputs,
//! and the explicit-reveal detail view live in `secret_view`. Credit cards stay
//! in `credit_card` but share the `SecretCategory::PersonalData` section.

mod address;
mod calendar_date;
mod domestic_account;
mod identity_document;
mod international_account;
mod person;
mod personal_text;
mod sensitive_number;

pub use address::{AddressFields, AddressSecret};
pub use calendar_date::{CalendarDate, CalendarDateError, CalendarMonth};
pub use domestic_account::{DomesticAccountFields, DomesticAccountSecret};
pub use identity_document::{IdentityDocumentFields, IdentityDocumentKind, IdentityDocumentSecret};
pub use international_account::{InternationalAccountFields, InternationalAccountSecret};
pub use person::{PersonFields, PersonSecret};
pub(crate) use personal_text::PresentParts;
pub(crate) use sensitive_number::SensitiveNumber;
