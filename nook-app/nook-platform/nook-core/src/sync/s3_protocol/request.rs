#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The signed requests Nook sends to an S3 location.
//!
//! Every request is path-style, `<endpoint>/<bucket>[/<key>]`, so a bucket
//! name never becomes part of a host name and the endpoint's certificate
//! covers every bucket. `aws-sigv4` signs it in the `Authorization` header,
//! with the body's real SHA-256, at the instant the caller supplies; the URL's
//! authority is the signed `host`. The transport sends the request unchanged.
//! The secret enters only the signing-key derivation and appears in no URL,
//! header, or error.

use std::iter;
use std::time::{SystemTime, UNIX_EPOCH};

use aws_credential_types::Credentials;
use aws_sigv4::http_request::{
    self, PayloadChecksumKind, PercentEncodingMode, SignableBody, SignableRequest, SigningSettings,
    UriPathNormalizationMode,
};
use aws_sigv4::sign::v4;
use bytes::Bytes;
use http::Request;
use http::header::{AUTHORIZATION, IF_NONE_MATCH};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use time::OffsetDateTime;

use super::S3EventAddress;
use crate::{EventStorageBytes, S3Connection};

/// RFC 3986 unreserved characters stay literal; every other byte is
/// percent-encoded, so the URL is already in the form S3 signs.
const UNRESERVED: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

/// One signed request, ready for the transport.
pub type S3HttpRequest = Request<Bytes>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum S3SigningError {
    #[error("S3 request time is outside the signable range")]
    RequestTimeOutOfRange,
    #[error("S3 request could not be signed")]
    Unsignable,
}

/// Which page of a listing a request asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3ListPage {
    First,
    /// The page after the one that answered with this continuation token.
    After(String),
}

/// One `ListObjectsV2` page of the keys and folders directly below a prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ListObjects {
    pub prefix: String,
    pub page: S3ListPage,
}

/// One event object to create.
#[derive(Clone, Copy)]
pub struct S3ObjectUpload<'a> {
    pub event: S3EventAddress<'a>,
    pub body: &'a EventStorageBytes,
}

/// Signs requests for one connection at one instant.
#[derive(Clone, Copy)]
pub struct S3RequestSigner<'a> {
    pub connection: &'a S3Connection,
    pub time: SystemTime,
}

impl S3RequestSigner<'_> {
    /// `GetObject` of one event.
    pub fn get_object(self, event: S3EventAddress<'_>) -> Result<S3HttpRequest, S3SigningError> {
        self.sign(Request::get(self.object_url(event)).body(Bytes::new()))
    }

    /// `PutObject` that creates the event's key, or is answered `412` when the
    /// key is taken. `If-None-Match` is signed, so it cannot be dropped.
    pub fn put_object_if_absent(
        self,
        upload: S3ObjectUpload<'_>,
    ) -> Result<S3HttpRequest, S3SigningError> {
        self.sign(
            Request::put(self.object_url(upload.event))
                .header(IF_NONE_MATCH, "*")
                .body(Bytes::copy_from_slice(upload.body.as_ref())),
        )
    }

    /// `DeleteObject` of one event.
    pub fn delete_object(self, event: S3EventAddress<'_>) -> Result<S3HttpRequest, S3SigningError> {
        self.sign(Request::delete(self.object_url(event)).body(Bytes::new()))
    }

    /// One page of `ListObjectsV2`, delimited at `/` as a folder lists its
    /// entries.
    pub fn list_objects(self, listing: &S3ListObjects) -> Result<S3HttpRequest, S3SigningError> {
        let location = &self.connection.location;
        let continuation = match &listing.page {
            S3ListPage::First => String::new(),
            S3ListPage::After(token) => {
                format!(
                    "&continuation-token={}",
                    utf8_percent_encode(token, UNRESERVED)
                )
            }
        };
        let url = format!(
            "{}/{}?delimiter=%2F&list-type=2&prefix={}{continuation}",
            location.endpoint,
            utf8_percent_encode(location.bucket.as_str(), UNRESERVED),
            utf8_percent_encode(&listing.prefix, UNRESERVED),
        );
        self.sign(Request::get(url).body(Bytes::new()))
    }

    /// `<endpoint>/<bucket>/<key>`, each `/`-separated part of the key that
    /// the layout builds for the event encoded alone.
    fn object_url(self, event: S3EventAddress<'_>) -> String {
        let location = &self.connection.location;
        let key = location.key_prefix.event_key(event);
        iter::once(location.bucket.as_str())
            .chain(key.split('/'))
            .fold(location.endpoint.to_string(), |url, segment| {
                format!("{url}/{}", utf8_percent_encode(segment, UNRESERVED))
            })
    }

    /// Sign the request the `http` builder produced, with S3's settings: the
    /// URL is signed exactly as encoded, and the body hash is sent as
    /// `x-amz-content-sha256`.
    fn sign(self, built: http::Result<S3HttpRequest>) -> Result<S3HttpRequest, S3SigningError> {
        let mut request = built.map_err(|_| S3SigningError::Unsignable)?;
        // The signer writes the instant through `time`, which panics after
        // the year 9999, so an unwritable clock fails here instead.
        self.time
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|since| i64::try_from(since.as_secs()).ok())
            .and_then(|seconds| OffsetDateTime::from_unix_timestamp(seconds).ok())
            .ok_or(S3SigningError::RequestTimeOutOfRange)?;
        let credentials = &self.connection.credentials;
        let identity = Credentials::new(
            credentials.access_key_id.as_str(),
            credentials.secret_access_key.expose(),
            None,
            None,
            "nook",
        )
        .into();
        let mut settings = SigningSettings::default();
        settings.percent_encoding_mode = PercentEncodingMode::Single;
        settings.uri_path_normalization_mode = UriPathNormalizationMode::Disabled;
        settings.payload_checksum_kind = PayloadChecksumKind::XAmzSha256;
        let params = v4::SigningParams::builder()
            .identity(&identity)
            .region(self.connection.location.region.as_str())
            .name("s3")
            .time(self.time)
            .settings(settings)
            .build()
            .map_err(|_| S3SigningError::Unsignable)?
            .into();
        let headers = request
            .headers()
            .iter()
            .map(|(name, value)| value.to_str().map(|value| (name.as_str(), value)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| S3SigningError::Unsignable)?;
        let signable = SignableRequest::new(
            request.method().as_str(),
            request.uri().to_string(),
            headers.into_iter(),
            SignableBody::Bytes(request.body()),
        )
        .map_err(|_| S3SigningError::Unsignable)?;
        let (instructions, _signature) = http_request::sign(signable, &params)
            .map_err(|_| S3SigningError::Unsignable)?
            .into_parts();
        instructions.apply_to_request_http1x(&mut request);
        // A signature authorizes its exact request until the request time is
        // too old, so diagnostics show it redacted.
        let Some(authorization) = request.headers_mut().get_mut(AUTHORIZATION) else {
            return Err(S3SigningError::Unsignable);
        };
        authorization.set_sensitive(true);
        Ok(request)
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use bytes::Bytes;
    use http::{Method, Request};

    use super::{
        S3HttpRequest, S3ListObjects, S3ListPage, S3ObjectUpload, S3RequestSigner, S3SigningError,
    };
    use crate::{
        EventId, EventStorageBytes, IdentityId, PlacedNamespace, S3AccessKeyId, S3BucketName,
        S3Connection, S3Credentials, S3Endpoint, S3EventAddress, S3KeyPrefix, S3Location, S3Region,
        S3SecretAccessKey, StoreId,
    };

    const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";
    /// 2026-10-31T22:07:25Z.
    const SIGNED_AT: u64 = 1_793_484_445;
    const DIGEST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";

    fn connection(endpoint: &str) -> anyhow::Result<S3Connection> {
        Ok(S3Connection {
            location: S3Location {
                endpoint: S3Endpoint::parse(endpoint)?,
                region: S3Region::parse("us-east-1")?,
                bucket: S3BucketName::parse("nook-dev")?,
                key_prefix: S3KeyPrefix::parse("e2e/run-1")?,
            },
            credentials: S3Credentials {
                access_key_id: S3AccessKeyId::parse("device-a")?,
                secret_access_key: S3SecretAccessKey::parse(SECRET)?,
            },
        })
    }

    fn at(unix_seconds: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(unix_seconds)
    }

    fn signer(connection: &S3Connection) -> S3RequestSigner<'_> {
        S3RequestSigner {
            connection,
            time: at(SIGNED_AT),
        }
    }

    fn header<'a>(request: &'a S3HttpRequest, name: &str) -> Option<&'a str> {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    }

    #[test]
    fn the_aws_get_object_example_signs_to_its_published_signature() -> anyhow::Result<()> {
        // Amazon S3 API Reference, "Signature Calculations for the
        // Authorization Header: Transferring Payload in a Single Chunk".
        let example = S3Connection {
            location: S3Location {
                endpoint: S3Endpoint::parse("https://examplebucket.s3.amazonaws.com")?,
                region: S3Region::parse("us-east-1")?,
                bucket: S3BucketName::parse("examplebucket")?,
                key_prefix: S3KeyPrefix::BucketRoot,
            },
            credentials: S3Credentials {
                access_key_id: S3AccessKeyId::parse("AKIAIOSFODNN7EXAMPLE")?,
                secret_access_key: S3SecretAccessKey::parse(
                    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                )?,
            },
        };
        let signed = S3RequestSigner {
            connection: &example,
            // 2013-05-24T00:00:00Z.
            time: at(1_369_353_600),
        }
        .sign(
            Request::get("https://examplebucket.s3.amazonaws.com/test.txt")
                .header("range", "bytes=0-9")
                .body(Bytes::new()),
        )?;
        assert_eq!(
            header(&signed, "authorization"),
            Some(
                "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, \
                 SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, \
                 Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
            )
        );
        Ok(())
    }

    #[test]
    fn a_create_only_put_signs_its_condition_and_its_body() -> anyhow::Result<()> {
        let connection = connection("http://127.0.0.1:8333")?;
        let vault = PlacedNamespace::vault(
            IdentityId::parse("idn_abcdefghijk")?,
            StoreId::parse("store_abcdefghijk")?,
        );
        let event_id = EventId::parse(&format!("sha256u:{DIGEST}"))?;
        let event = S3EventAddress {
            placed: &vault,
            event_id: &event_id,
        };
        let body = EventStorageBytes::from(b"event: first\n".to_vec());
        let put =
            signer(&connection).put_object_if_absent(S3ObjectUpload { event, body: &body })?;
        let url = format!(
            "http://127.0.0.1:8333/nook-dev/e2e/run-1/meta-secret-nook/idn_abcdefghijk/\
             store_abcdefghijk/events/{DIGEST}.yaml"
        );
        assert_eq!(put.method(), Method::PUT);
        assert_eq!(put.uri().to_string(), url);
        assert_eq!(put.body().as_ref(), b"event: first\n");
        assert_eq!(header(&put, "if-none-match"), Some("*"));
        // The SHA-256 of `event: first\n`.
        assert_eq!(
            header(&put, "x-amz-content-sha256"),
            Some("634e0e87464f7ec2b8293a0b8fb86169f62a1b5086d76dc9bd3a92b799ed41cf")
        );
        assert_eq!(header(&put, "x-amz-date"), Some("20261031T220725Z"));
        // Computed independently from the canonical request `PUT`, the URL
        // path, an empty query, the `host:127.0.0.1:8333`, `if-none-match:*`,
        // `x-amz-content-sha256`, and `x-amz-date` lines, and the body hash.
        assert_eq!(
            header(&put, "authorization"),
            Some(
                "AWS4-HMAC-SHA256 Credential=device-a/20261031/us-east-1/s3/aws4_request, \
                 SignedHeaders=host;if-none-match;x-amz-content-sha256;x-amz-date, \
                 Signature=3092bda55ca4107d3b8da51c00caab0cc43f0d539d311a351056df02e0040426"
            )
        );
        let shown = format!("{put:?}");
        assert!(!shown.contains(SECRET), "{shown}");
        assert!(!shown.contains("Signature="), "{shown}");

        // Reads and deletes address the same object, without a body or a
        // condition.
        for (request, method) in [
            (signer(&connection).get_object(event)?, Method::GET),
            (signer(&connection).delete_object(event)?, Method::DELETE),
        ] {
            assert_eq!(request.method(), method);
            assert_eq!(request.uri().to_string(), url);
            assert!(request.body().is_empty());
            assert_eq!(header(&request, "if-none-match"), None);
        }

        let unwritable = S3RequestSigner {
            connection: &connection,
            time: at(253_402_300_800),
        };
        assert_eq!(
            unwritable.get_object(event).err(),
            Some(S3SigningError::RequestTimeOutOfRange)
        );
        Ok(())
    }

    #[test]
    fn a_listing_continues_with_its_token_encoded_and_no_credentials() -> anyhow::Result<()> {
        let connection = connection("https://s3.example.com")?;
        let mut listing = S3ListObjects {
            prefix: connection.location.key_prefix.identity_folders_listing(),
            page: S3ListPage::First,
        };
        let first = signer(&connection).list_objects(&listing)?;
        assert_eq!(first.method(), Method::GET);
        assert_eq!(
            first.uri().to_string(),
            "https://s3.example.com/nook-dev?delimiter=%2F&list-type=2\
             &prefix=e2e%2Frun-1%2Fmeta-secret-nook%2F"
        );
        listing.page = S3ListPage::After("1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vb+M=".to_owned());
        let next = signer(&connection).list_objects(&listing)?;
        let url = next.uri().to_string();
        assert_eq!(
            url,
            "https://s3.example.com/nook-dev?delimiter=%2F&list-type=2\
             &prefix=e2e%2Frun-1%2Fmeta-secret-nook%2F\
             &continuation-token=1ueGcxLPRx1Tr%2FXYExHnhbYLgveDs2J%2Fwm36Hy4vb%2BM%3D"
        );
        assert!(!url.contains(SECRET) && !url.contains("device-a"), "{url}");
        Ok(())
    }
}
