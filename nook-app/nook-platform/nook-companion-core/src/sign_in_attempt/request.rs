//! TypeScript-facing request DTOs for the sign-in attempt lifecycle.
//!
//! The service worker supplies the sender origin from `chrome.runtime` sender
//! metadata and the current time; content scripts supply only bounded,
//! non-secret activity and page facts. Boolean fields are fixed by the frozen
//! TypeScript contract and are converted into named states before policy reads
//! them.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::page_evidence::{
    SignInAttemptPageEvidence, SignInPageControls, SignInPageLink, SignInPageMessages,
};
use super::record::SignInAttemptStoredRecord;
use crate::CompanionEpochMilliseconds;

/// Typed failure of a malformed request DTO; the WASM edge maps it to `JsError`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SignInAttemptRequestError {
    #[error("sign-in attempt sender origin exceeds its bound")]
    SenderOriginTooLong,
    #[error("sign-in attempt sender origin is not an http(s) origin")]
    SenderOriginInvalid,
    #[error("sign-in attempt login reference is invalid")]
    LoginReferenceInvalid,
    #[error("sign-in attempt time is invalid")]
    TimeInvalid,
    #[error("sign-in page text exceeds its bound")]
    PageTextTooLong,
    #[error("sign-in page evidence has too many entries")]
    PageEvidenceTooLarge,
    #[error("sign-in attempt record could not be encoded")]
    RecordEncodingFailed,
}

/// Sender origin text derived by the service worker from `chrome.runtime`
/// sender metadata. Only its bound is checked at decoding; site admission is a
/// lifecycle decision (`begin` rejects it, `advance` answers `OtherSite`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct SignInAttemptSenderOrigin(String);

impl SignInAttemptSenderOrigin {
    pub(crate) const MAX_BYTES: usize = 512;

    pub(crate) fn text(&self) -> &str {
        let Self(origin) = self;
        origin
    }
}

impl TryFrom<String> for SignInAttemptSenderOrigin {
    type Error = SignInAttemptRequestError;

    fn try_from(origin: String) -> Result<Self, Self::Error> {
        match origin.len() {
            0..=Self::MAX_BYTES => Ok(Self(origin)),
            _ => Err(SignInAttemptRequestError::SenderOriginTooLong),
        }
    }
}

impl From<SignInAttemptSenderOrigin> for String {
    fn from(origin: SignInAttemptSenderOrigin) -> Self {
        let SignInAttemptSenderOrigin(origin) = origin;
        origin
    }
}

/// Opaque vault item identity of the selected login, `${vaultStoreId}/${secretId}`.
/// Store ids are `store_` plus an 11-character token; secret ids are either
/// `secret_` plus a token or legacy human labels that may contain spaces,
/// non-ASCII text, or `/`. The reference is therefore split at its first `/`,
/// both components must be non-blank, and only control characters are
/// rejected. It identifies a vault item and is not a credential value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct SignInAttemptLoginReference(String);

impl SignInAttemptLoginReference {
    /// A 17-byte store id, the separator, and a legacy secret label of up to
    /// about 1 KiB (legacy labels are unbounded human names, often URLs).
    pub(crate) const MAX_BYTES: usize = 1_024;
}

impl TryFrom<String> for SignInAttemptLoginReference {
    type Error = SignInAttemptRequestError;

    fn try_from(login: String) -> Result<Self, Self::Error> {
        let Some((store, secret)) = login.split_once('/') else {
            return Err(SignInAttemptRequestError::LoginReferenceInvalid);
        };
        let shaped = !store.trim().is_empty()
            && !secret.trim().is_empty()
            && !login.chars().any(char::is_control);
        match (login.len(), shaped) {
            (1..=Self::MAX_BYTES, true) => Ok(Self(login)),
            (_, _) => Err(SignInAttemptRequestError::LoginReferenceInvalid),
        }
    }
}

impl From<SignInAttemptLoginReference> for String {
    fn from(login: SignInAttemptLoginReference) -> Self {
        let SignInAttemptLoginReference(login) = login;
        login
    }
}

/// Starts one attempt after the user chose `Sign in` (and a login, when several match).
#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SignInAttemptBeginRequest {
    pub sender_origin: SignInAttemptSenderOrigin,
    pub login: SignInAttemptLoginReference,
    pub now: CompanionEpochMilliseconds,
}

/// Advances the tab's stored attempt with one event.
#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SignInAttemptAdvanceRequest {
    pub record: SignInAttemptStoredRecord,
    pub sender_origin: SignInAttemptSenderOrigin,
    pub now: CompanionEpochMilliseconds,
    pub event: SignInAttemptEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum SignInAttemptEvent {
    /// Content script (re)mounted on a page while the tab holds a record.
    Resumed,
    /// Activity reported by the actuator that performs fill/submit.
    Activity { activity: SignInAttemptActivity },
    /// Bounded page evidence (in-place polling or after resume).
    PageObserved { page: SignInAttemptPageEvidence },
    /// Explicit user choice from a rendered action.
    UserAction { action: SignInAttemptUserAction },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum SignInAttemptActivity {
    Filled,
    FillFailed,
    /// Nook submitted (or observed the trusted submit of) the filled form.
    Submitted {
        baseline: SignInAttemptSubmitBaseline,
    },
    SubmissionRejected,
    SubmissionUnobserved,
}

/// Submit-time facts collected synchronously right before submit, with the
/// same collector and bounds as `PageObserved`. Rust keeps only whether an
/// error-looking message was present, the auth-field presence, and whether a
/// sign-out style authenticated affordance was present (never the labels).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SignInAttemptSubmitBaseline {
    pub messages: SignInPageMessages,
    pub auth_fields: SignInAttemptAuthFields,
    /// Bounded visible control labels at submit (existing login-save collector).
    pub controls: SignInPageControls,
}

/// Visible authentication field presence (frozen contract booleans).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SignInAttemptAuthFields {
    pub username_present: bool,
    pub current_password_present: bool,
    pub one_time_code_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum SignInAttemptUserAction {
    TryAgain,
    ChooseAnotherLogin,
    /// Fresh, revalidated link facts at click time.
    ResetPassword {
        link: SignInPageLink,
    },
    FillAuthenticator,
    Dismiss,
}

#[cfg(test)]
mod tests {
    use super::{
        SignInAttemptAdvanceRequest, SignInAttemptLoginReference, SignInAttemptRequestError,
        SignInAttemptSenderOrigin,
    };

    #[test]
    fn login_reference_accepts_every_vault_id_and_rejects_only_malformed_shapes() {
        for valid in [
            "store_abcdefghijk/secret_SMypl8K0w9a",
            "store_abcdefghijk/github.com work",
            "store_abcdefghijk/почта для работы",
            "store_abcdefghijk/https://example.com/login",
        ] {
            assert!(
                SignInAttemptLoginReference::try_from(valid.to_owned()).is_ok(),
                "{valid}"
            );
        }
        let prefix = "store_abcdefghijk/";
        let exactly_at_bound = format!(
            "{prefix}{}",
            "s".repeat(SignInAttemptLoginReference::MAX_BYTES - prefix.len())
        );
        assert_eq!(
            exactly_at_bound.len(),
            SignInAttemptLoginReference::MAX_BYTES
        );
        assert!(SignInAttemptLoginReference::try_from(exactly_at_bound).is_ok());
        for invalid in [
            String::new(),
            "store_abcdefghijk".to_owned(),
            "/secret_SMypl8K0w9a".to_owned(),
            "store_abcdefghijk/ ".to_owned(),
            "store_abcdefghijk/tab\tinside".to_owned(),
            "store_abcdefghijk/new\nline".to_owned(),
            format!(
                "store_abcdefghijk/{}",
                "x".repeat(SignInAttemptLoginReference::MAX_BYTES)
            ),
        ] {
            assert_eq!(
                SignInAttemptLoginReference::try_from(invalid),
                Err(SignInAttemptRequestError::LoginReferenceInvalid)
            );
        }
    }

    #[test]
    fn sender_origin_rejects_only_over_bound_text_at_decoding() {
        assert!(SignInAttemptSenderOrigin::try_from("file://".to_owned()).is_ok());
        assert_eq!(
            SignInAttemptSenderOrigin::try_from(
                "h".repeat(SignInAttemptSenderOrigin::MAX_BYTES + 1)
            ),
            Err(SignInAttemptRequestError::SenderOriginTooLong)
        );
    }

    #[test]
    fn advance_request_keeps_rust_field_names_and_rejects_unknown_input() {
        let rust_names = r#"{"record":"{}","sender_origin":"https://a.example","now":1,"event":{"kind":"Resumed"}}"#;
        assert!(serde_json::from_str::<SignInAttemptAdvanceRequest>(rust_names).is_ok());
        let unknown_field = r#"{"record":"{}","sender_origin":"https://a.example","now":1,"event":{"kind":"Resumed"},"extra":1}"#;
        assert!(serde_json::from_str::<SignInAttemptAdvanceRequest>(unknown_field).is_err());
        let unknown_event = r#"{"record":"{}","sender_origin":"https://a.example","now":1,"event":{"kind":"Retry"}}"#;
        assert!(serde_json::from_str::<SignInAttemptAdvanceRequest>(unknown_event).is_err());
        let renamed = r#"{"record":"{}","senderOrigin":"https://a.example","now":1,"event":{"kind":"Resumed"}}"#;
        assert!(serde_json::from_str::<SignInAttemptAdvanceRequest>(renamed).is_err());
    }
}
