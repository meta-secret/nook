//! Browser authenticator enrollment: candidate resolution after the trusted
//! **Add 2FA from this page** action, and reviewed labels at save.
//!
//! Nothing here persists or logs page text, QR payloads, setup keys, or URIs.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::ValidationError;

mod candidates;
mod page_origin;
mod reviewed_labels;
mod setup_key_text;

pub use candidates::{
    EnrollmentOtpauthUri, EnrollmentQrPayload, NookAuthenticatorEnrollmentCandidate,
    NookAuthenticatorEnrollmentCandidateRequest, NookAuthenticatorEnrollmentCandidateSource,
    NookAuthenticatorEnrollmentCandidates,
};
pub use page_origin::EnrollmentPageOrigin;
pub use reviewed_labels::{
    AuthenticatorEnrollmentSave, AuthenticatorLabelReview, ReviewedAuthenticatorLabels,
};
pub use setup_key_text::{SetupKeyTextClassification, VisibleSetupKeyText};

/// Rejected enrollment input. Variants never carry page text, payloads, or keys.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum AuthenticatorEnrollmentError {
    #[error("too many QR payloads in one enrollment request")]
    QrPayloadCountExceeded,
    #[error("a QR payload exceeds the enrollment size limit")]
    QrPayloadTooLong,
    #[error("too many setup-key texts in one enrollment request")]
    SetupKeyTextCountExceeded,
    #[error("a setup-key text exceeds the enrollment size limit")]
    SetupKeyTextTooLong,
    #[error("the enrollment page origin is not an http(s) origin")]
    PageOriginInvalid,
    #[error("the reviewed service name is too long")]
    IssuerTooLong,
    #[error("the reviewed service name contains control characters")]
    IssuerControlCharacter,
    #[error("the reviewed account name is too long")]
    AccountTooLong,
    #[error("the reviewed account name contains control characters")]
    AccountControlCharacter,
    #[error(transparent)]
    Validation(#[from] ValidationError),
}
