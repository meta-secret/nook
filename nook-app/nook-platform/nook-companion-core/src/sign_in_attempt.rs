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
//! Requests carry no credential or field value, and nothing here is logged.
//! The record's only page text is the one Rust-selected, bounded site message
//! of a failed attempt. It is the site's own text and may include what the
//! site displays (an email address, for example), so it lives only in
//! trusted-context session storage, is cleared on resolution or tab close,
//! and is presented only to the exact origin that recorded it.

mod auth_step;
mod conclusion;
mod end_state;
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
mod stability;
mod submit_baseline;
#[cfg(test)]
mod test_fixture;
mod vocabulary;

pub use end_state::SignInAttemptSiteMessage;
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
