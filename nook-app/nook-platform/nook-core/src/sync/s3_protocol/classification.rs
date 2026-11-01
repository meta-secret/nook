#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! What an S3 answer means for the request that received it.
//!
//! - A missing object (`404`) is absent, not a failure.
//! - A create-only write that finds its key taken (`412`) is settled the way
//!   the local-folder provider settles an existing event file.
//! - Every `403`, whatever its body, is one typed "this key has no access to
//!   the vault folder" failure: a refused, unknown, or mis-signed key alike.
//! - Anything else keeps only its provider failure category and status. An
//!   error body is never read: its message can name keys.

use std::str;

use bytes::Bytes;
use http::StatusCode;
use nook_app_common::i18n_keys;
use quick_xml::de;
use serde::Deserialize;

use crate::{EventId, EventStorageBytes, ProviderFailureCause};

/// One answer to one request, as the transport received it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3Response {
    pub status: StatusCode,
    pub body: Bytes,
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

/// Whether more pages follow a listing page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3ListingContinuation {
    Complete,
    /// The opaque token S3 continues the listing after.
    Continues(String),
}

/// One page of a `ListObjectsV2` answer: the keys and folders it listed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ObjectListing {
    pub keys: Vec<String>,
    pub folders: Vec<String>,
    pub continuation: S3ListingContinuation,
}

/// Why a request failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum S3RequestFailure {
    /// Any `403`: the server refused this key, did not know it, rejected its
    /// signature, or gave it no access to the bucket and prefix.
    #[error("{}", i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED)]
    KeyAccessDenied,
    /// Any other failure, as its loggable category and status.
    #[error("S3 request failed with status {}", .status.as_u16())]
    Provider {
        cause: ProviderFailureCause,
        status: StatusCode,
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

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ListedObjectXml {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ListedFolderXml {
    prefix: String,
}

/// One element of a `ListBucketResult`, in document order.
#[derive(Deserialize)]
enum ListBucketElement {
    IsTruncated(bool),
    NextContinuationToken(String),
    Contents(ListedObjectXml),
    CommonPrefixes(ListedFolderXml),
    /// Every element a listing does not use.
    #[serde(other)]
    Unrelated,
}

/// A `ListBucketResult`: its elements, whichever it holds.
#[derive(Deserialize)]
struct ListBucketResultXml {
    #[serde(rename = "$value")]
    elements: Vec<ListBucketElement>,
}

/// What a page has said about its truncation so far.
enum PageTruncation {
    Unstated,
    Stated(bool),
}

/// The continuation token a page has carried so far.
enum PageToken {
    Absent,
    Present(String),
}

/// A listing page as its elements are read.
struct S3ListingPage {
    keys: Vec<String>,
    folders: Vec<String>,
    truncation: PageTruncation,
    token: PageToken,
}

impl S3ListingPage {
    const EMPTY: Self = Self {
        keys: Vec::new(),
        folders: Vec::new(),
        truncation: PageTruncation::Unstated,
        token: PageToken::Absent,
    };

    fn with(mut self, element: ListBucketElement) -> Self {
        match element {
            ListBucketElement::IsTruncated(truncated) => {
                self.truncation = PageTruncation::Stated(truncated);
            }
            ListBucketElement::NextContinuationToken(token) => {
                self.token = PageToken::Present(token);
            }
            ListBucketElement::Contents(object) => self.keys.push(object.key),
            ListBucketElement::CommonPrefixes(folder) => self.folders.push(folder.prefix),
            ListBucketElement::Unrelated => {}
        }
        self
    }

    /// A page must say whether it is truncated, and a truncated page must
    /// carry a token to continue it.
    fn finish(self) -> Result<S3ObjectListing, S3RequestFailure> {
        let continuation = match (self.truncation, self.token) {
            (PageTruncation::Stated(false), _) => S3ListingContinuation::Complete,
            (PageTruncation::Stated(true), PageToken::Present(token)) => match token.as_str() {
                "" => return Err(S3RequestFailure::MalformedResponse),
                _ => S3ListingContinuation::Continues(token),
            },
            (PageTruncation::Stated(true), PageToken::Absent) | (PageTruncation::Unstated, _) => {
                return Err(S3RequestFailure::MalformedResponse);
            }
        };
        Ok(S3ObjectListing {
            keys: self.keys,
            folders: self.folders,
            continuation,
        })
    }
}

impl S3ObjectListing {
    /// Read one page. A body that is not this XML, a page that does not say
    /// whether it is truncated, or a truncated page without a token to
    /// continue it, is malformed.
    fn parse(body: &[u8]) -> Result<Self, S3RequestFailure> {
        let page: ListBucketResultXml = str::from_utf8(body)
            .ok()
            .and_then(|text| de::from_str(text).ok())
            .ok_or(S3RequestFailure::MalformedResponse)?;
        page.elements
            .into_iter()
            .fold(S3ListingPage::EMPTY, S3ListingPage::with)
            .finish()
    }
}

impl S3Response {
    /// Every `403` is the key's failure, whatever its body says; every other
    /// failure keeps the category of its status.
    fn failure(&self) -> S3RequestFailure {
        match self.status {
            StatusCode::FORBIDDEN => S3RequestFailure::KeyAccessDenied,
            status => S3RequestFailure::Provider {
                cause: ProviderFailureCause::from(status),
                status,
            },
        }
    }

    /// Classify the answer to `GetObject`.
    pub fn into_object_read(self) -> Result<S3ObjectRead, S3RequestFailure> {
        match self.status.as_u16() {
            200..=299 => Ok(S3ObjectRead::Found(EventStorageBytes::from(Vec::from(
                self.body,
            )))),
            404 => Ok(S3ObjectRead::Absent),
            _ => Err(self.failure()),
        }
    }

    /// Classify the answer to a create-only `PutObject`.
    pub fn into_object_write(self) -> Result<S3ObjectWrite, S3RequestFailure> {
        match self.status.as_u16() {
            200..=299 => Ok(S3ObjectWrite::Created),
            412 => Ok(S3ObjectWrite::AlreadyExists),
            _ => Err(self.failure()),
        }
    }

    /// Classify the answer to `DeleteObject`.
    pub fn into_object_deletion(self) -> Result<S3ObjectDeletion, S3RequestFailure> {
        match self.status.as_u16() {
            200..=299 => Ok(S3ObjectDeletion::Deleted),
            404 => Ok(S3ObjectDeletion::Absent),
            _ => Err(self.failure()),
        }
    }

    /// Classify the answer to `ListObjectsV2` and read its page.
    pub fn into_listing(self) -> Result<S3ObjectListing, S3RequestFailure> {
        match self.status.as_u16() {
            200..=299 => S3ObjectListing::parse(&self.body),
            _ => Err(self.failure()),
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
    use bytes::Bytes;
    use http::StatusCode;
    use nook_app_common::i18n_keys;

    use super::{
        S3ExistingEvent, S3ListingContinuation, S3ObjectDeletion, S3ObjectRead, S3ObjectWrite,
        S3RequestFailure, S3Response,
    };
    use crate::{EventId, EventStorageBytes, ProviderFailureCause};

    const EVENT: &[u8] = b"event: first\n";

    /// A delimited page of an identity folder, with the `&#34;` quote escapes
    /// Go-based S3 servers write into `ETag`.
    const SERVER_IDENTITY_FOLDER: &str = concat!(
        r#"<?xml version="1.0" encoding="UTF-8"?>"#,
        "\n",
        r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>nook-dev</Name>"#,
        "<Prefix>e2e-run-1/meta-secret-nook/idn_abcdefghijk/</Prefix><MaxKeys>1000</MaxKeys>",
        "<Delimiter>/</Delimiter><IsTruncated>false</IsTruncated><Contents>",
        "<Key>e2e-run-1/meta-secret-nook/idn_abcdefghijk/identity.yaml</Key>",
        "<ETag>&#34;fb4cdbcd656745d8fd4a22ed9e2680f5&#34;</ETag><Size>16</Size>",
        "<StorageClass>STANDARD</StorageClass><LastModified>2026-10-31T21:27:58Z</LastModified>",
        "</Contents><CommonPrefixes><Prefix>e2e-run-1/meta-secret-nook/idn_abcdefghijk/log/</Prefix>",
        "</CommonPrefixes><CommonPrefixes>",
        "<Prefix>e2e-run-1/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/</Prefix>",
        "</CommonPrefixes><KeyCount>3</KeyCount></ListBucketResult>",
    );

    /// A truncated page in the shape the S3 API Reference documents.
    const TRUNCATED_PAGE: &str = concat!(
        r#"<?xml version="1.0" encoding="UTF-8"?>"#,
        r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">"#,
        "<Name>bucket</Name><Prefix>p/</Prefix><KeyCount>2</KeyCount><MaxKeys>2</MaxKeys>",
        "<IsTruncated>true</IsTruncated>",
        "<NextContinuationToken>1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</NextContinuationToken>",
        "<Contents><Key>p/a.yaml</Key><LastModified>2026-10-31T10:00:00.000Z</LastModified>",
        "<ETag>&quot;9b2c&quot;</ETag><Size>412</Size><StorageClass>STANDARD</StorageClass></Contents>",
        "<Contents><Key>p/b.yaml</Key><LastModified>2026-10-31T10:00:01.000Z</LastModified>",
        "<ETag>&quot;0f34&quot;</ETag><Size>398</Size><StorageClass>STANDARD</StorageClass></Contents>",
        "</ListBucketResult>",
    );

    fn answer(status: u16, body: &[u8]) -> anyhow::Result<S3Response> {
        Ok(S3Response {
            status: StatusCode::from_u16(status)?,
            body: Bytes::copy_from_slice(body),
        })
    }

    fn provider(cause: ProviderFailureCause, status: u16) -> anyhow::Result<S3RequestFailure> {
        Ok(S3RequestFailure::Provider {
            cause,
            status: StatusCode::from_u16(status)?,
        })
    }

    #[test]
    fn each_status_means_what_its_request_asked_for() -> anyhow::Result<()> {
        let found = || Ok(S3ObjectRead::Found(EventStorageBytes::from(EVENT.to_vec())));
        let denied = S3RequestFailure::KeyAccessDenied;
        let other = |status| provider(ProviderFailureCause::Other, status);
        // Each row: the status, then what a read, a create-only write, and a
        // deletion make of it. A listing fails like a read, except that its
        // success body must be a listing and a 404 is the provider's.
        for (status, read, write, deletion) in [
            (
                200,
                found(),
                Ok(S3ObjectWrite::Created),
                Ok(S3ObjectDeletion::Deleted),
            ),
            (
                204,
                found(),
                Ok(S3ObjectWrite::Created),
                Ok(S3ObjectDeletion::Deleted),
            ),
            (
                404,
                Ok(S3ObjectRead::Absent),
                Err(provider(ProviderFailureCause::NotFound, 404)?),
                Ok(S3ObjectDeletion::Absent),
            ),
            (
                412,
                Err(other(412)?),
                Ok(S3ObjectWrite::AlreadyExists),
                Err(other(412)?),
            ),
            (
                403,
                Err(denied.clone()),
                Err(denied.clone()),
                Err(denied.clone()),
            ),
        ] {
            assert_eq!(answer(status, EVENT)?.into_object_read(), read, "{status}");
            assert_eq!(
                answer(status, EVENT)?.into_object_write(),
                write,
                "{status}"
            );
            assert_eq!(
                answer(status, EVENT)?.into_object_deletion(),
                deletion,
                "{status}"
            );
        }
        for (status, listing) in [
            (200, S3RequestFailure::MalformedResponse),
            (404, provider(ProviderFailureCause::NotFound, 404)?),
            (412, other(412)?),
            (403, denied.clone()),
        ] {
            assert_eq!(
                answer(status, EVENT)?.into_listing(),
                Err(listing),
                "{status}"
            );
        }
        // Every other failure keeps its category and status, never its body,
        // and hosts that keep only the message classify it the same way.
        for (status, cause) in [
            (401, ProviderFailureCause::Unauthorized),
            (429, ProviderFailureCause::RateLimited),
            (500, ProviderFailureCause::ProviderError),
            (503, ProviderFailureCause::ProviderError),
            (301, ProviderFailureCause::Other),
            (400, ProviderFailureCause::Other),
        ] {
            let failure = provider(cause, status)?;
            let body = b"<Error><Message>No key team/meta-secret-nook/x</Message></Error>";
            assert_eq!(answer(status, body)?.into_listing(), Err(failure.clone()));
            assert_eq!(
                answer(status, body)?.into_object_read(),
                Err(failure.clone())
            );
            let shown = failure.to_string();
            assert_eq!(shown, format!("S3 request failed with status {status}"));
            assert_eq!(ProviderFailureCause::classify(&shown), cause, "{shown}");
        }
        assert_eq!(denied.to_string(), i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED);
        assert_eq!(
            ProviderFailureCause::classify(&denied.to_string()),
            ProviderFailureCause::Forbidden
        );
        Ok(())
    }

    #[test]
    fn a_listing_page_reads_its_keys_folders_and_continuation() -> anyhow::Result<()> {
        let page = answer(200, SERVER_IDENTITY_FOLDER.as_bytes())?.into_listing()?;
        assert_eq!(
            page.keys,
            vec!["e2e-run-1/meta-secret-nook/idn_abcdefghijk/identity.yaml"]
        );
        assert_eq!(
            page.folders,
            vec![
                "e2e-run-1/meta-secret-nook/idn_abcdefghijk/log/",
                "e2e-run-1/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/",
            ]
        );
        assert_eq!(page.continuation, S3ListingContinuation::Complete);

        // The namespace declaration is optional.
        let plain =
            TRUNCATED_PAGE.replace(r#" xmlns="http://s3.amazonaws.com/doc/2006-03-01/""#, "");
        for truncated in [TRUNCATED_PAGE, plain.as_str()] {
            let page = answer(200, truncated.as_bytes())?.into_listing()?;
            assert_eq!(page.keys, vec!["p/a.yaml", "p/b.yaml"]);
            assert!(page.folders.is_empty());
            assert_eq!(
                page.continuation,
                S3ListingContinuation::Continues(
                    "1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=".to_owned()
                )
            );
        }

        // The token may come before the truncation flag; a complete page
        // ignores a token it carries.
        for (body, continuation) in [
            (
                "<ListBucketResult><NextContinuationToken>t</NextContinuationToken>\
                 <IsTruncated>true</IsTruncated></ListBucketResult>",
                S3ListingContinuation::Continues("t".to_owned()),
            ),
            (
                "<ListBucketResult><IsTruncated>false</IsTruncated>\
                 <NextContinuationToken>t</NextContinuationToken></ListBucketResult>",
                S3ListingContinuation::Complete,
            ),
        ] {
            let page = answer(200, body.as_bytes())?.into_listing()?;
            assert_eq!(page.continuation, continuation, "{body}");
            assert!(page.keys.is_empty() && page.folders.is_empty());
        }

        let no_token = TRUNCATED_PAGE.replace(
            "<NextContinuationToken>1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</NextContinuationToken>",
            "",
        );
        let empty_token = TRUNCATED_PAGE.replace(
            "1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</NextContinuationToken>",
            "</NextContinuationToken>",
        );
        for body in [
            no_token.as_bytes(),
            empty_token.as_bytes(),
            b"",
            b"not xml",
            b"<ListBucketResult/>",
            b"<ListBucketResult><Name>bucket</Name></ListBucketResult>",
            &[0xff, 0xfe, 0x00],
        ] {
            assert_eq!(
                answer(200, body)?.into_listing(),
                Err(S3RequestFailure::MalformedResponse),
                "{body:?}"
            );
        }
        Ok(())
    }

    #[test]
    fn a_taken_event_key_is_settled_like_an_existing_event_file() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let requested = EventStorageBytes::from(EVENT.to_vec());
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
