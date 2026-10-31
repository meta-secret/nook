#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The signed requests Nook sends to an S3 location.
//!
//! Every request is path-style, `<endpoint>/<bucket>[/<key>]`, so a bucket
//! name never becomes part of a host name and the endpoint's certificate
//! covers every bucket. A request is complete: the transport sends its
//! method, URL, headers, and body exactly as given and lets the URL set
//! `Host`, which is signed as the endpoint's `host[:port]`. The secret signs
//! the request and appears in none of its parts.

use std::{fmt, iter};

use super::{
    S3CanonicalPath, S3CanonicalQuery, S3HttpMethod, S3ListDepth, S3ListObjects, S3ListPage,
    S3ObjectKey, S3PayloadHash, S3QueryParameter, S3RequestTime, S3SignedHeader, S3SigningError,
    S3SigningInput,
};
use crate::{EventStorageBytes, S3Connection};

/// The headers a request sends besides `Host`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum S3RequestHeaderName {
    Authorization,
    AmzContentSha256,
    AmzDate,
    IfNoneMatch,
}

impl S3RequestHeaderName {
    /// The lowercase header name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Authorization => "authorization",
            Self::AmzContentSha256 => "x-amz-content-sha256",
            Self::AmzDate => "x-amz-date",
            Self::IfNoneMatch => "if-none-match",
        }
    }
}

/// One header to send exactly as given.
#[derive(Clone, PartialEq, Eq)]
pub struct S3RequestHeader {
    pub name: S3RequestHeaderName,
    value: String,
}

impl S3RequestHeader {
    #[must_use]
    pub fn value(&self) -> &str {
        &self.value
    }
}

/// A signature authorizes its exact request until the request time is too
/// old, so diagnostics show the `Authorization` value redacted.
impl fmt::Debug for S3RequestHeader {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self.name {
            S3RequestHeaderName::Authorization => "[redacted]",
            S3RequestHeaderName::AmzContentSha256
            | S3RequestHeaderName::AmzDate
            | S3RequestHeaderName::IfNoneMatch => self.value.as_str(),
        };
        formatter
            .debug_struct("S3RequestHeader")
            .field("name", &self.name.as_str())
            .field("value", &value)
            .finish()
    }
}

/// The full URL of a request: endpoint, bucket, key, and query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3RequestUrl(String);

impl S3RequestUrl {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(url) = self;
        url
    }
}

/// What a request uploads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3RequestBody {
    Empty,
    Event(EventStorageBytes),
}

impl S3RequestBody {
    fn bytes(&self) -> &[u8] {
        match self {
            Self::Empty => &[],
            Self::Event(bytes) => bytes.as_ref(),
        }
    }
}

/// One signed request, ready for the transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3HttpRequest {
    pub method: S3HttpMethod,
    pub url: S3RequestUrl,
    pub headers: Vec<S3RequestHeader>,
    pub body: S3RequestBody,
}

/// One event object to create.
#[derive(Clone, Copy)]
pub struct S3ObjectUpload<'a> {
    pub key: &'a S3ObjectKey,
    pub body: &'a EventStorageBytes,
}

/// `If-None-Match: *`, signed so that it cannot be dropped on the way.
const KEY_ABSENT: [S3SignedHeader<'static>; 1] = [S3SignedHeader {
    name: S3RequestHeaderName::IfNoneMatch.as_str(),
    value: "*",
}];

/// Whether a write must leave an existing object in place.
#[derive(Clone, Copy)]
enum WriteCondition {
    Unconditional,
    /// S3 answers `412` instead of replacing an existing object.
    KeyAbsent,
}

impl WriteCondition {
    fn signed_headers(self) -> &'static [S3SignedHeader<'static>] {
        match self {
            Self::Unconditional => &[],
            Self::KeyAbsent => &KEY_ABSENT,
        }
    }

    fn request_headers(self) -> Vec<S3RequestHeader> {
        match self {
            Self::Unconditional => Vec::new(),
            Self::KeyAbsent => vec![S3RequestHeader {
                name: S3RequestHeaderName::IfNoneMatch,
                value: "*".to_owned(),
            }],
        }
    }
}

/// One request before it is signed.
struct UnsignedRequest {
    method: S3HttpMethod,
    path: S3CanonicalPath,
    query: S3CanonicalQuery,
    condition: WriteCondition,
    body: S3RequestBody,
}

/// Signs requests for one connection at one instant.
#[derive(Clone, Copy)]
pub struct S3RequestSigner<'a> {
    pub connection: &'a S3Connection,
    pub time: S3RequestTime,
}

impl S3RequestSigner<'_> {
    /// `GetObject` of one key.
    pub fn get_object(self, key: &S3ObjectKey) -> Result<S3HttpRequest, S3SigningError> {
        self.sign(UnsignedRequest {
            method: S3HttpMethod::Get,
            path: self.object_path(key),
            query: S3CanonicalQuery::of(&[]),
            condition: WriteCondition::Unconditional,
            body: S3RequestBody::Empty,
        })
    }

    /// `PutObject` that creates the key, or is answered `412` when the key
    /// is taken.
    pub fn put_object_if_absent(
        self,
        upload: S3ObjectUpload<'_>,
    ) -> Result<S3HttpRequest, S3SigningError> {
        self.sign(UnsignedRequest {
            method: S3HttpMethod::Put,
            path: self.object_path(upload.key),
            query: S3CanonicalQuery::of(&[]),
            condition: WriteCondition::KeyAbsent,
            body: S3RequestBody::Event(upload.body.clone()),
        })
    }

    /// `DeleteObject` of one key.
    pub fn delete_object(self, key: &S3ObjectKey) -> Result<S3HttpRequest, S3SigningError> {
        self.sign(UnsignedRequest {
            method: S3HttpMethod::Delete,
            path: self.object_path(key),
            query: S3CanonicalQuery::of(&[]),
            condition: WriteCondition::Unconditional,
            body: S3RequestBody::Empty,
        })
    }

    /// One page of `ListObjectsV2`.
    pub fn list_objects(self, listing: &S3ListObjects) -> Result<S3HttpRequest, S3SigningError> {
        let page_size = listing.page_size.text();
        let mut parameters = vec![
            S3QueryParameter {
                name: "list-type",
                value: "2",
            },
            S3QueryParameter {
                name: "prefix",
                value: listing.prefix.as_str(),
            },
            S3QueryParameter {
                name: "max-keys",
                value: &page_size,
            },
        ];
        parameters.extend(match listing.depth {
            S3ListDepth::DirectChildren => vec![S3QueryParameter {
                name: "delimiter",
                value: "/",
            }],
            S3ListDepth::AllDescendants => Vec::new(),
        });
        parameters.extend(match &listing.page {
            S3ListPage::First => Vec::new(),
            S3ListPage::After(token) => vec![S3QueryParameter {
                name: "continuation-token",
                value: token.as_str(),
            }],
        });
        self.sign(UnsignedRequest {
            method: S3HttpMethod::Get,
            path: S3CanonicalPath::of_segments([self.connection.location.bucket.as_str()]),
            query: S3CanonicalQuery::of(&parameters),
            condition: WriteCondition::Unconditional,
            body: S3RequestBody::Empty,
        })
    }

    /// `/<bucket>/<key>`, each `/`-separated part of the key encoded alone.
    fn object_path(self, key: &S3ObjectKey) -> S3CanonicalPath {
        S3CanonicalPath::of_segments(
            iter::once(self.connection.location.bucket.as_str()).chain(key.as_str().split('/')),
        )
    }

    fn sign(self, request: UnsignedRequest) -> Result<S3HttpRequest, S3SigningError> {
        let location = &self.connection.location;
        let host = location.endpoint.host_header();
        let payload = S3PayloadHash::of(request.body.bytes());
        let authorization = S3SigningInput {
            method: request.method,
            host: &host,
            path: &request.path,
            query: &request.query,
            headers: request.condition.signed_headers(),
            payload: &payload,
            time: self.time,
            region: &location.region,
            credentials: &self.connection.credentials,
        }
        .sign()?;
        let url = match request.query.as_str() {
            "" => format!("{}{}", location.endpoint, request.path.as_str()),
            query => format!("{}{}?{query}", location.endpoint, request.path.as_str()),
        };
        let mut headers = vec![
            S3RequestHeader {
                name: S3RequestHeaderName::Authorization,
                value: authorization.into_inner(),
            },
            S3RequestHeader {
                name: S3RequestHeaderName::AmzContentSha256,
                value: payload.as_str().to_owned(),
            },
            S3RequestHeader {
                name: S3RequestHeaderName::AmzDate,
                value: self.time.amz_date(),
            },
        ];
        headers.extend(request.condition.request_headers());
        Ok(S3HttpRequest {
            method: request.method,
            url: S3RequestUrl(url),
            headers,
            body: request.body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        S3HttpRequest, S3ObjectUpload, S3RequestBody, S3RequestHeaderName, S3RequestSigner,
    };
    use crate::{
        EventId, EventStorageBytes, IdentityId, PlacedNamespace, S3AccessKeyId, S3BucketName,
        S3Connection, S3Credentials, S3Endpoint, S3EventAddress, S3HttpMethod, S3HttpStatus,
        S3KeyPrefix, S3ListDepth, S3ListObjects, S3ListPage, S3ListPageSize, S3ListingContinuation,
        S3Location, S3ObjectKey, S3Region, S3RequestTime, S3Response, S3ResponseBody,
        S3SecretAccessKey, S3UnixSeconds, StoreId,
    };

    const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";
    /// 2026-10-31T22:07:25Z.
    const SIGNED_AT: u64 = 1_793_484_445;
    const DIGEST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";

    struct Fixture {
        connection: S3Connection,
        time: S3RequestTime,
    }

    impl Fixture {
        fn new(endpoint: &str) -> anyhow::Result<Self> {
            Ok(Self {
                connection: S3Connection {
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
                },
                time: S3RequestTime::try_from(S3UnixSeconds::from(SIGNED_AT))?,
            })
        }

        fn signer(&self) -> S3RequestSigner<'_> {
            S3RequestSigner {
                connection: &self.connection,
                time: self.time,
            }
        }

        fn event_key(&self) -> anyhow::Result<S3ObjectKey> {
            Ok(self
                .connection
                .location
                .key_prefix
                .event_key(S3EventAddress {
                    placed: &PlacedNamespace::vault(
                        IdentityId::parse("idn_abcdefghijk")?,
                        StoreId::parse("store_abcdefghijk")?,
                    ),
                    event_id: &EventId::parse(&format!("sha256u:{DIGEST}"))?,
                }))
        }
    }

    /// One sent header, laid out for comparison.
    #[derive(Debug, PartialEq, Eq)]
    struct SentHeader {
        name: &'static str,
        value: String,
    }

    impl SentHeader {
        fn of(request: &S3HttpRequest) -> Vec<Self> {
            request
                .headers
                .iter()
                .map(|header| Self {
                    name: header.name.as_str(),
                    value: header.value().to_owned(),
                })
                .collect()
        }
    }

    const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    #[test]
    fn a_create_only_put_signs_its_body_and_its_condition() -> anyhow::Result<()> {
        let fixture = Fixture::new("http://127.0.0.1:8333")?;
        let key = fixture.event_key()?;
        let body = EventStorageBytes::from(b"event: first\n".to_vec());
        let request = fixture.signer().put_object_if_absent(S3ObjectUpload {
            key: &key,
            body: &body,
        })?;
        assert_eq!(request.method, S3HttpMethod::Put);
        assert_eq!(
            request.url.as_str(),
            format!(
                "http://127.0.0.1:8333/nook-dev/e2e/run-1/meta-secret-nook/idn_abcdefghijk/\
                 store_abcdefghijk/events/{DIGEST}.yaml"
            )
        );
        // The signature was computed independently from the canonical request
        // `PUT`, the URL path, an empty query, the `host:127.0.0.1:8333`,
        // `if-none-match:*`, `x-amz-content-sha256`, and `x-amz-date` lines,
        // and the body's SHA-256.
        assert_eq!(
            SentHeader::of(&request),
            vec![
                SentHeader {
                    name: "authorization",
                    value: "AWS4-HMAC-SHA256 Credential=device-a/20261031/us-east-1/s3/aws4_request, \
                            SignedHeaders=host;if-none-match;x-amz-content-sha256;x-amz-date, \
                            Signature=3092bda55ca4107d3b8da51c00caab0cc43f0d539d311a351056df02e0040426"
                        .to_owned(),
                },
                SentHeader {
                    name: "x-amz-content-sha256",
                    value: "634e0e87464f7ec2b8293a0b8fb86169f62a1b5086d76dc9bd3a92b799ed41cf".to_owned(),
                },
                SentHeader {
                    name: "x-amz-date",
                    value: "20261031T220725Z".to_owned(),
                },
                SentHeader {
                    name: "if-none-match",
                    value: "*".to_owned(),
                },
            ]
        );
        assert_eq!(request.body, S3RequestBody::Event(body));
        Ok(())
    }

    #[test]
    fn a_listing_page_signs_its_whole_query() -> anyhow::Result<()> {
        let fixture = Fixture::new("https://s3.example.com")?;
        let listing = S3ListObjects {
            prefix: fixture
                .connection
                .location
                .key_prefix
                .identity_folders_listing(),
            depth: S3ListDepth::DirectChildren,
            page: S3ListPage::First,
            page_size: S3ListPageSize::MAXIMUM,
        };
        let first = fixture.signer().list_objects(&listing)?;
        assert_eq!(first.method, S3HttpMethod::Get);
        assert_eq!(
            first.url.as_str(),
            "https://s3.example.com/nook-dev?delimiter=%2F&list-type=2&max-keys=1000\
             &prefix=e2e%2Frun-1%2Fmeta-secret-nook%2F"
        );
        assert_eq!(
            SentHeader::of(&first)
                .first()
                .map(|header| header.value.clone()),
            Some(
                "AWS4-HMAC-SHA256 Credential=device-a/20261031/us-east-1/s3/aws4_request, \
                 SignedHeaders=host;x-amz-content-sha256;x-amz-date, \
                 Signature=607bcba7e68baea879e28e2e9c17da4bb052bfe0557030d0d0ded15c4ca8eefa"
                    .to_owned()
            )
        );
        assert_eq!(first.body, S3RequestBody::Empty);

        let truncated = S3Response {
            status: S3HttpStatus::from(200),
            body: S3ResponseBody::from(
                "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>\
                 1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</NextContinuationToken>\
                 </ListBucketResult>"
                    .as_bytes()
                    .to_vec(),
            ),
        }
        .into_listing()?;
        let S3ListingContinuation::Continues(token) = truncated.continuation else {
            anyhow::bail!("a truncated page continues");
        };
        let next = fixture.signer().list_objects(&listing.next_page(token))?;
        assert_eq!(
            next.url.as_str(),
            "https://s3.example.com/nook-dev?continuation-token=1ueGcxLPRx1Tr%2FXYExHnhbYLgveDs2J\
             %2Fwm36Hy4vbOwM%3D&delimiter=%2F&list-type=2&max-keys=1000\
             &prefix=e2e%2Frun-1%2Fmeta-secret-nook%2F"
        );
        Ok(())
    }

    #[test]
    fn reads_and_deletes_address_the_object_without_a_body() -> anyhow::Result<()> {
        let fixture = Fixture::new("http://[::1]:9000")?;
        let key = fixture.event_key()?;
        let read = fixture.signer().get_object(&key)?;
        let delete = fixture.signer().delete_object(&key)?;
        assert_eq!(read.method, S3HttpMethod::Get);
        assert_eq!(delete.method, S3HttpMethod::Delete);
        for request in [&read, &delete] {
            assert_eq!(
                request.url.as_str(),
                format!(
                    "http://[::1]:9000/nook-dev/e2e/run-1/meta-secret-nook/idn_abcdefghijk/\
                     store_abcdefghijk/events/{DIGEST}.yaml"
                )
            );
            assert_eq!(request.body, S3RequestBody::Empty);
            assert_eq!(
                request
                    .headers
                    .iter()
                    .map(|header| header.name)
                    .collect::<Vec<_>>(),
                vec![
                    S3RequestHeaderName::Authorization,
                    S3RequestHeaderName::AmzContentSha256,
                    S3RequestHeaderName::AmzDate,
                ]
            );
            assert_eq!(
                SentHeader::of(request)
                    .get(1)
                    .map(|header| header.value.as_str()),
                Some(EMPTY_SHA256)
            );
        }
        assert_ne!(read.headers.first(), delete.headers.first());
        Ok(())
    }

    #[test]
    fn no_part_of_a_request_carries_the_secret() -> anyhow::Result<()> {
        let fixture = Fixture::new("https://s3.example.com")?;
        let key = fixture.event_key()?;
        let body = EventStorageBytes::from(b"event: first\n".to_vec());
        let request = fixture.signer().put_object_if_absent(S3ObjectUpload {
            key: &key,
            body: &body,
        })?;
        let shown = format!("{request:?}");
        assert!(!shown.contains(SECRET), "{shown}");
        assert!(!shown.contains("Signature="), "{shown}");
        assert!(!request.url.as_str().contains(SECRET));
        for header in &request.headers {
            assert!(!header.value().contains(SECRET), "{header:?}");
        }
        Ok(())
    }
}
