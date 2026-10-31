#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! What an S3 answer means for the request that received it.
//!
//! - A missing object (`404 NoSuchKey`) is absent, not a failure.
//! - A create-only write that finds its key taken (`412`) is settled the way
//!   the local-folder provider settles an existing event file.
//! - Every `403`, whatever its code or body, is one typed "this key has no
//!   access to the vault folder" failure: a refused, unknown, or mis-signed
//!   key alike.
//! - Anything else keeps only its provider failure category and status. An
//!   error body is read for its code only: its message can name keys, so it is
//!   never kept.

use std::{fmt, str};

use nook_app_common::i18n_keys;
use quick_xml::de;
use serde::Deserialize;

use super::S3ObjectListing;
use crate::{EventId, EventStorageBytes, ProviderFailureCause};

/// The HTTP status of an answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct S3HttpStatus(u16);

impl From<u16> for S3HttpStatus {
    fn from(status: u16) -> Self {
        Self(status)
    }
}

impl fmt::Display for S3HttpStatus {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let Self(status) = self;
        status.fmt(formatter)
    }
}

/// The body of an answer, as the transport received it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ResponseBody(Vec<u8>);

impl From<Vec<u8>> for S3ResponseBody {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: the transport hands over the response body as bytes"
        )
    )]
    fn from(body: Vec<u8>) -> Self {
        Self(body)
    }
}

/// One answer to one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3Response {
    pub status: S3HttpStatus,
    pub body: S3ResponseBody,
}

/// What reading one object found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3ObjectRead {
    Found(EventStorageBytes),
    Absent,
}

/// What a create-only write did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum S3ObjectWrite {
    Created,
    /// The key was taken; read it and settle with [`S3ExistingEvent`].
    AlreadyExists,
}

/// What deleting one object did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum S3ObjectDeletion {
    Deleted,
    Absent,
}

/// Why a request failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum S3RequestFailure {
    /// Any `403`: the server refused this key, did not know it, rejected its
    /// signature, or gave it no access to the bucket and prefix.
    #[error("{}", i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED)]
    KeyAccessDenied,
    /// Any other failure, as its loggable category and status.
    #[error("S3 request failed with status {status}")]
    Provider {
        cause: ProviderFailureCause,
        status: S3HttpStatus,
    },
    /// A successful answer whose body is not what the request returns.
    #[error("S3 response could not be read")]
    MalformedResponse,
    /// Different bytes sit at the event's content address: corruption.
    #[error("S3 event {event_id} already exists with different content")]
    EventContentDiverged { event_id: EventId },
    /// The write found the key taken, but reading it found nothing.
    #[error("S3 reported event {event_id} as stored, but it could not be read back")]
    EventConflictUnresolved { event_id: EventId },
}

impl S3RequestFailure {
    /// The stable code the WASM boundary attaches to a refused key, as it
    /// attaches `github-token-rejected` to a rejected GitHub token.
    pub const KEY_ACCESS_DENIED_CODE: &'static str = "s3-key-access-denied";

    /// The loggable category of this failure.
    #[must_use]
    pub fn cause(&self) -> ProviderFailureCause {
        match self {
            Self::KeyAccessDenied => ProviderFailureCause::Forbidden,
            Self::Provider { cause, .. } => *cause,
            Self::MalformedResponse
            | Self::EventContentDiverged { .. }
            | Self::EventConflictUnresolved { .. } => ProviderFailureCause::Other,
        }
    }
}

/// The error codes an answer is classified by.
enum S3ErrorCode {
    NoSuchKey,
    /// Any other code, or a body without one.
    Unclassified,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ErrorXml {
    #[serde(default)]
    code: String,
}

impl S3ErrorCode {
    fn of(body: &S3ResponseBody) -> Self {
        let S3ResponseBody(bytes) = body;
        let Ok(text) = str::from_utf8(bytes) else {
            return Self::Unclassified;
        };
        let Ok(error) = de::from_str::<ErrorXml>(text) else {
            return Self::Unclassified;
        };
        match error.code.as_str() {
            "NoSuchKey" => Self::NoSuchKey,
            _ => Self::Unclassified,
        }
    }
}

/// The status families classification tells apart.
enum StatusClass {
    Success,
    Forbidden,
    NotFound,
    PreconditionFailed,
    Failure,
}

impl S3HttpStatus {
    fn class(self) -> StatusClass {
        let Self(status) = self;
        match status {
            200..=299 => StatusClass::Success,
            403 => StatusClass::Forbidden,
            404 => StatusClass::NotFound,
            412 => StatusClass::PreconditionFailed,
            _ => StatusClass::Failure,
        }
    }

    fn cause(self) -> ProviderFailureCause {
        let Self(status) = self;
        match status {
            401 => ProviderFailureCause::Unauthorized,
            403 => ProviderFailureCause::Forbidden,
            404 => ProviderFailureCause::NotFound,
            429 => ProviderFailureCause::RateLimited,
            500..=599 => ProviderFailureCause::ProviderError,
            _ => ProviderFailureCause::Other,
        }
    }
}

impl S3Response {
    /// Every `403` is the key's failure, whatever its body says; every other
    /// failure keeps the category of its status.
    fn failure(&self) -> S3RequestFailure {
        let status = self.status;
        match status.class() {
            StatusClass::Forbidden => S3RequestFailure::KeyAccessDenied,
            StatusClass::Success
            | StatusClass::NotFound
            | StatusClass::PreconditionFailed
            | StatusClass::Failure => S3RequestFailure::Provider {
                cause: status.cause(),
                status,
            },
        }
    }

    /// Only `NoSuchKey` makes a 404 an absent object; a missing bucket fails.
    fn absent_or_failure<T>(&self, absent: T) -> Result<T, S3RequestFailure> {
        match S3ErrorCode::of(&self.body) {
            S3ErrorCode::NoSuchKey => Ok(absent),
            S3ErrorCode::Unclassified => Err(self.failure()),
        }
    }

    /// Classify the answer to `GetObject`.
    pub fn into_object_read(self) -> Result<S3ObjectRead, S3RequestFailure> {
        match self.status.class() {
            StatusClass::Success => {
                let S3ResponseBody(bytes) = self.body;
                Ok(S3ObjectRead::Found(EventStorageBytes::from(bytes)))
            }
            StatusClass::NotFound => self.absent_or_failure(S3ObjectRead::Absent),
            StatusClass::Forbidden | StatusClass::PreconditionFailed | StatusClass::Failure => {
                Err(self.failure())
            }
        }
    }

    /// Classify the answer to a create-only `PutObject`.
    pub fn into_object_write(self) -> Result<S3ObjectWrite, S3RequestFailure> {
        match self.status.class() {
            StatusClass::Success => Ok(S3ObjectWrite::Created),
            StatusClass::PreconditionFailed => Ok(S3ObjectWrite::AlreadyExists),
            StatusClass::Forbidden | StatusClass::NotFound | StatusClass::Failure => {
                Err(self.failure())
            }
        }
    }

    /// Classify the answer to `DeleteObject`.
    pub fn into_object_deletion(self) -> Result<S3ObjectDeletion, S3RequestFailure> {
        match self.status.class() {
            StatusClass::Success => Ok(S3ObjectDeletion::Deleted),
            StatusClass::NotFound => self.absent_or_failure(S3ObjectDeletion::Absent),
            StatusClass::Forbidden | StatusClass::PreconditionFailed | StatusClass::Failure => {
                Err(self.failure())
            }
        }
    }

    /// Classify the answer to `ListObjectsV2` and read its page.
    pub fn into_listing(self) -> Result<S3ObjectListing, S3RequestFailure> {
        match self.status.class() {
            StatusClass::Success => {
                let S3ResponseBody(bytes) = &self.body;
                let text =
                    str::from_utf8(bytes).map_err(|_| S3RequestFailure::MalformedResponse)?;
                S3ObjectListing::parse(text)
            }
            StatusClass::Forbidden
            | StatusClass::NotFound
            | StatusClass::PreconditionFailed
            | StatusClass::Failure => Err(self.failure()),
        }
    }
}

/// A create-only write found the event's key already taken.
#[derive(Clone, Copy)]
pub struct S3ExistingEvent<'a> {
    pub event_id: &'a EventId,
    pub requested: &'a EventStorageBytes,
}

impl S3ExistingEvent<'_> {
    /// Settle it with what reading the key found, as the local-folder provider
    /// settles an existing event file: the same bytes mean the event is
    /// already stored; any other bytes are corruption and fail the write.
    pub fn settle(self, stored: S3ObjectRead) -> Result<(), S3RequestFailure> {
        match stored {
            S3ObjectRead::Found(bytes) if bytes == *self.requested => Ok(()),
            S3ObjectRead::Found(_) => Err(S3RequestFailure::EventContentDiverged {
                event_id: self.event_id.clone(),
            }),
            S3ObjectRead::Absent => Err(S3RequestFailure::EventConflictUnresolved {
                event_id: self.event_id.clone(),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        S3ExistingEvent, S3HttpStatus, S3ObjectDeletion, S3ObjectRead, S3ObjectWrite,
        S3RequestFailure, S3Response, S3ResponseBody,
    };
    use crate::{EventId, EventStorageBytes, ProviderFailureCause};
    use nook_app_common::i18n_keys;

    struct Answer {
        status: u16,
        code: &'static str,
    }

    impl Answer {
        fn response(&self) -> S3Response {
            let body = match self.code {
                "" => String::new(),
                code => format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Error><Code>{code}</Code>\
                     <Message>The resource /nook-dev/team/meta-secret-nook/x does not exist</Message>\
                     <RequestId>4442587FB7D0A2F9</RequestId></Error>"
                ),
            };
            S3Response {
                status: S3HttpStatus::from(self.status),
                body: S3ResponseBody::from(body.into_bytes()),
            }
        }
    }

    fn provider(cause: ProviderFailureCause, status: u16) -> S3RequestFailure {
        S3RequestFailure::Provider {
            cause,
            status: S3HttpStatus::from(status),
        }
    }

    #[test]
    fn a_read_finds_the_object_or_its_absence() -> anyhow::Result<()> {
        let found = S3Response {
            status: S3HttpStatus::from(200),
            body: S3ResponseBody::from(b"event: yaml\n".to_vec()),
        };
        assert_eq!(
            found.into_object_read()?,
            S3ObjectRead::Found(EventStorageBytes::from(b"event: yaml\n".to_vec()))
        );
        let missing = Answer {
            status: 404,
            code: "NoSuchKey",
        };
        assert_eq!(missing.response().into_object_read()?, S3ObjectRead::Absent);
        for not_an_object in [
            Answer {
                status: 404,
                code: "NoSuchBucket",
            },
            Answer {
                status: 404,
                code: "",
            },
        ] {
            assert_eq!(
                not_an_object.response().into_object_read(),
                Err(provider(ProviderFailureCause::NotFound, 404))
            );
        }
        Ok(())
    }

    #[test]
    fn every_403_is_one_access_failure_whatever_its_body() {
        // A refused, unknown, or mis-signed key, a skewed clock, a code Nook
        // does not know, and a body without one are all the key's failure.
        for code in [
            "AccessDenied",
            "InvalidAccessKeyId",
            "SignatureDoesNotMatch",
            "RequestTimeTooSkewed",
            "SomethingNew",
            "",
        ] {
            let refused = Answer { status: 403, code };
            assert_eq!(
                refused.response().into_object_read(),
                Err(S3RequestFailure::KeyAccessDenied)
            );
            assert_eq!(
                refused.response().into_object_write(),
                Err(S3RequestFailure::KeyAccessDenied)
            );
            assert_eq!(
                refused.response().into_listing(),
                Err(S3RequestFailure::KeyAccessDenied)
            );
            assert_eq!(
                refused.response().into_object_deletion(),
                Err(S3RequestFailure::KeyAccessDenied)
            );
        }
        let unreadable = S3Response {
            status: S3HttpStatus::from(403),
            body: S3ResponseBody::from(vec![0xff, 0xfe, 0x00]),
        };
        assert_eq!(
            unreadable.into_listing(),
            Err(S3RequestFailure::KeyAccessDenied)
        );
        assert_eq!(
            S3RequestFailure::KeyAccessDenied.to_string(),
            i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED
        );
        assert_eq!(
            S3RequestFailure::KEY_ACCESS_DENIED_CODE,
            "s3-key-access-denied"
        );
        assert_eq!(
            S3RequestFailure::KeyAccessDenied.cause(),
            ProviderFailureCause::Forbidden
        );
    }

    #[test]
    fn a_create_only_write_reports_a_taken_key() -> anyhow::Result<()> {
        assert_eq!(
            Answer {
                status: 200,
                code: "",
            }
            .response()
            .into_object_write()?,
            S3ObjectWrite::Created
        );
        assert_eq!(
            Answer {
                status: 412,
                code: "PreconditionFailed",
            }
            .response()
            .into_object_write()?,
            S3ObjectWrite::AlreadyExists
        );
        assert_eq!(
            Answer {
                status: 409,
                code: "ConditionalRequestConflict",
            }
            .response()
            .into_object_write(),
            Err(provider(ProviderFailureCause::Other, 409))
        );
        Ok(())
    }

    #[test]
    fn a_deletion_of_a_missing_object_is_absent() -> anyhow::Result<()> {
        for deleted in [204, 200] {
            assert_eq!(
                Answer {
                    status: deleted,
                    code: "",
                }
                .response()
                .into_object_deletion()?,
                S3ObjectDeletion::Deleted
            );
        }
        assert_eq!(
            Answer {
                status: 404,
                code: "NoSuchKey",
            }
            .response()
            .into_object_deletion()?,
            S3ObjectDeletion::Absent
        );
        Ok(())
    }

    #[test]
    fn other_failures_keep_their_category_and_status_but_no_body() {
        for (answer, cause) in [
            (
                Answer {
                    status: 503,
                    code: "SlowDown",
                },
                ProviderFailureCause::ProviderError,
            ),
            (
                Answer {
                    status: 429,
                    code: "",
                },
                ProviderFailureCause::RateLimited,
            ),
            (
                Answer {
                    status: 500,
                    code: "InternalError",
                },
                ProviderFailureCause::ProviderError,
            ),
            (
                Answer {
                    status: 401,
                    code: "",
                },
                ProviderFailureCause::Unauthorized,
            ),
            (
                Answer {
                    status: 301,
                    code: "PermanentRedirect",
                },
                ProviderFailureCause::Other,
            ),
            (
                Answer {
                    status: 400,
                    code: "AuthorizationHeaderMalformed",
                },
                ProviderFailureCause::Other,
            ),
        ] {
            let failure = answer.response().into_listing();
            assert_eq!(failure, Err(provider(cause, answer.status)));
            let Err(failure) = failure else {
                continue;
            };
            let shown = failure.to_string();
            assert!(!shown.contains("meta-secret-nook"), "{shown}");
            assert_eq!(failure.cause(), cause);
            // Hosts that only keep the message classify it the same way.
            assert_eq!(ProviderFailureCause::classify(&shown), cause, "{shown}");
        }
    }

    #[test]
    fn a_taken_event_key_is_settled_like_an_existing_event_file() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let requested = EventStorageBytes::from(b"event: first\n".to_vec());
        let existing = S3ExistingEvent {
            event_id: &event_id,
            requested: &requested,
        };
        existing.settle(S3ObjectRead::Found(requested.clone()))?;
        assert_eq!(
            existing.settle(S3ObjectRead::Found(EventStorageBytes::from(
                b"event: other\n".to_vec()
            ))),
            Err(S3RequestFailure::EventContentDiverged {
                event_id: event_id.clone()
            })
        );
        assert_eq!(
            existing.settle(S3ObjectRead::Absent),
            Err(S3RequestFailure::EventConflictUnresolved { event_id })
        );
        Ok(())
    }
}
