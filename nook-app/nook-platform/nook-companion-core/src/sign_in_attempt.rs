//! Durable, Rust-owned sign-in attempt lifecycle for the Nook Pilot.
//!
//! Clicking **Sign in** begins one attempt per tab. The service worker keeps
//! the opaque record in `chrome.storage.session`, bound to the tab and its
//! site, so the attempt survives reloads and same-site navigation. Rust owns
//! the record shape and strict decoding, site binding, every transition,
//! outcome and reason classification, reset-link classification, the outcome
//! budget, the offered actions, message-key selection, and the disposition.
//! Content scripts are sensors and actuators only.
//!
//! The record and every request are non-secret: no credential, username,
//! field value, or page text is stored except the one Rust-selected, bounded
//! site message of a failed attempt, and nothing here is logged.

mod auth_step;
mod conclusion;
mod failure_reason;
mod lifecycle;
mod message_evidence;
mod outcome;
mod page_evidence;
mod page_reading;
mod presentation;
mod record;
mod request;
mod reset_link;
mod site;
mod submit_baseline;
#[cfg(test)]
mod test_fixture;
mod vocabulary;

pub use conclusion::SignInAttemptSiteMessage;
pub use lifecycle::{SignInAttemptAdvance, SignInAttemptDisposition, SignInAttemptTransition};
pub use page_evidence::{
    SignInAttemptDocumentRelation, SignInAttemptPageEvidence, SignInPageColor,
    SignInPageColorChannel, SignInPageControls, SignInPageLink, SignInPageLinkHref,
    SignInPageLinkIndex, SignInPageLinkText, SignInPageLinks, SignInPageMessage,
    SignInPageMessagePlacement, SignInPageMessageSource, SignInPageMessageText,
    SignInPageMessageToken, SignInPageMessageTokens, SignInPageMessages,
};
pub use presentation::{
    SignInAttemptActionKind, SignInAttemptActionOffer, SignInAttemptEvidenceDemand,
    SignInAttemptFollowUp, SignInAttemptMessageKey, SignInAttemptPresentation, SignInAttemptStatus,
};
pub use record::SignInAttemptStoredRecord;
pub use request::{
    SignInAttemptActivity, SignInAttemptAdvanceRequest, SignInAttemptAuthFields,
    SignInAttemptBeginRequest, SignInAttemptEvent, SignInAttemptLoginReference,
    SignInAttemptRequestError, SignInAttemptSenderOrigin, SignInAttemptSubmitBaseline,
    SignInAttemptUserAction,
};
