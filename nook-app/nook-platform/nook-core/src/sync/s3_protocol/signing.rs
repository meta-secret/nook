#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! AWS Signature Version 4 in the `Authorization` header, as S3 checks it.
//!
//! Every request signs its method, canonical path and query, the `host`,
//! `x-amz-content-sha256`, and `x-amz-date` headers plus any it adds, and the
//! SHA-256 of its body. Signing reads no clock: the caller supplies the
//! instant. The secret enters only the signing-key derivation and never a
//! header, a URL, or an error.

use std::fmt;

use hmac::{Hmac, KeyInit, Mac};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use zeroize::Zeroizing;

use crate::{S3Credentials, S3HostHeader, S3Region};

const ALGORITHM: &str = "AWS4-HMAC-SHA256";
const SERVICE: &str = "s3";
const SCOPE_TERMINATOR: &str = "aws4_request";
/// Prepended to the secret to key the first HMAC of the derivation.
const SIGNING_KEY_SEED: &str = "AWS4";

/// RFC 3986 unreserved characters stay literal; every other byte is
/// percent-encoded with uppercase hex, as S3's canonical form requires.
const UNRESERVED: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum S3SigningError {
    #[error("S3 request time is outside the signable range")]
    RequestTimeOutOfRange,
    #[error("S3 signing key could not be derived")]
    SigningKey,
}

/// Whole seconds since the Unix epoch, as the host's clock reports them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct S3UnixSeconds(u64);

impl From<u64> for S3UnixSeconds {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: the browser clock reading crosses the host boundary as a number"
        )
    )]
    fn from(seconds: u64) -> Self {
        Self(seconds)
    }
}

/// The instant a request is signed at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct S3RequestTime(OffsetDateTime);

impl TryFrom<S3UnixSeconds> for S3RequestTime {
    type Error = S3SigningError;
    fn try_from(seconds: S3UnixSeconds) -> Result<Self, S3SigningError> {
        let S3UnixSeconds(seconds) = seconds;
        let seconds = i64::try_from(seconds).map_err(|_| S3SigningError::RequestTimeOutOfRange)?;
        OffsetDateTime::from_unix_timestamp(seconds)
            .map(Self)
            .map_err(|_| S3SigningError::RequestTimeOutOfRange)
    }
}

impl S3RequestTime {
    /// `YYYYMMDD`, the date of the credential scope.
    fn scope_date(self) -> String {
        let Self(at) = self;
        format!("{:04}{:02}{:02}", at.year(), u8::from(at.month()), at.day())
    }

    /// `YYYYMMDDTHHMMSSZ`, the `x-amz-date` header.
    pub(super) fn amz_date(self) -> String {
        let Self(at) = self;
        format!(
            "{}T{:02}{:02}{:02}Z",
            self.scope_date(),
            at.hour(),
            at.minute(),
            at.second()
        )
    }
}

/// The request methods Nook sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum S3HttpMethod {
    Get,
    Put,
    Delete,
}

impl S3HttpMethod {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Put => "PUT",
            Self::Delete => "DELETE",
        }
    }
}

/// The hex SHA-256 of a request body, sent as `x-amz-content-sha256`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct S3PayloadHash(String);

impl S3PayloadHash {
    pub(super) fn of(body: &[u8]) -> Self {
        Self(hex::encode(Sha256::digest(body)))
    }

    pub(super) fn as_str(&self) -> &str {
        let Self(hash) = self;
        hash
    }
}

/// The canonical path: `/` and each decoded segment, URI-encoded. The same
/// text is the URL's path, so what is sent is exactly what is signed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct S3CanonicalPath(String);

impl S3CanonicalPath {
    pub(super) fn of_segments<'a>(segments: impl IntoIterator<Item = &'a str>) -> Self {
        let encoded = segments
            .into_iter()
            .map(|segment| utf8_percent_encode(segment, UNRESERVED).to_string())
            .collect::<Vec<_>>()
            .join("/");
        Self(format!("/{encoded}"))
    }

    pub(super) fn as_str(&self) -> &str {
        let Self(path) = self;
        path
    }
}

/// One query parameter, decoded.
pub(super) struct S3QueryParameter<'a> {
    pub(super) name: &'static str,
    pub(super) value: &'a str,
}

/// The canonical query: parameters URI-encoded and sorted. The same text is
/// the URL's query; `/` and spaces are encoded, never written as `+`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct S3CanonicalQuery(String);

impl S3CanonicalQuery {
    pub(super) fn of(parameters: &[S3QueryParameter<'_>]) -> Self {
        let mut encoded = parameters
            .iter()
            .map(|parameter| {
                format!(
                    "{}={}",
                    utf8_percent_encode(parameter.name, UNRESERVED),
                    utf8_percent_encode(parameter.value, UNRESERVED)
                )
            })
            .collect::<Vec<_>>();
        encoded.sort();
        Self(encoded.join("&"))
    }

    pub(super) fn as_str(&self) -> &str {
        let Self(query) = self;
        query
    }
}

/// A header the request sends and signs, besides `host`,
/// `x-amz-content-sha256`, and `x-amz-date`.
pub(super) struct S3SignedHeader<'a> {
    /// Lowercase header name.
    pub(super) name: &'static str,
    pub(super) value: &'a str,
}

/// Everything one signature covers.
pub(super) struct S3SigningInput<'a> {
    pub(super) method: S3HttpMethod,
    pub(super) host: &'a S3HostHeader,
    pub(super) path: &'a S3CanonicalPath,
    pub(super) query: &'a S3CanonicalQuery,
    pub(super) headers: &'a [S3SignedHeader<'a>],
    pub(super) payload: &'a S3PayloadHash,
    pub(super) time: S3RequestTime,
    pub(super) region: &'a S3Region,
    pub(super) credentials: &'a S3Credentials,
}

/// The `Authorization` header value: algorithm, credential scope, signed
/// header names, and signature. It names the key id, never the secret.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct S3Authorization(String);

impl S3Authorization {
    pub(super) fn into_inner(self) -> String {
        let Self(value) = self;
        value
    }

    #[cfg(test)]
    fn as_str(&self) -> &str {
        let Self(value) = self;
        value
    }
}

/// A signature authorizes its exact request until the request time is too
/// old, so diagnostics show it redacted.
impl fmt::Debug for S3Authorization {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("S3Authorization([redacted])")
    }
}

/// One header line of the canonical request.
struct CanonicalHeader {
    name: &'static str,
    value: String,
}

/// The canonical header block and the signed-header list, both by name.
struct CanonicalHeaders {
    block: String,
    signed: String,
}

/// The scope a signing key is derived for.
struct SigningScope<'a> {
    date: &'a str,
    region: &'a str,
    service: &'static str,
}

impl SigningScope<'_> {
    fn text(&self) -> String {
        format!(
            "{}/{}/{}/{SCOPE_TERMINATOR}",
            self.date, self.region, self.service
        )
    }

    /// `kSigning`: HMAC-SHA256 chained over date, region, service, and the
    /// terminator, starting from `AWS4` and the secret.
    fn signing_key(
        &self,
        credentials: &S3Credentials,
    ) -> Result<Zeroizing<[u8; 32]>, S3SigningError> {
        let secret = credentials.secret_access_key.expose();
        // Sized up front, so no reallocation leaves a copy of the secret behind.
        let mut seed = Zeroizing::new(String::with_capacity(SIGNING_KEY_SEED.len() + secret.len()));
        seed.push_str(SIGNING_KEY_SEED);
        seed.push_str(secret);
        let date_key = Self::hmac(seed.as_bytes(), self.date.as_bytes())?;
        let region_key = Self::hmac(date_key.as_slice(), self.region.as_bytes())?;
        let service_key = Self::hmac(region_key.as_slice(), self.service.as_bytes())?;
        Self::hmac(service_key.as_slice(), SCOPE_TERMINATOR.as_bytes())
    }

    fn hmac(key: &[u8], data: &[u8]) -> Result<Zeroizing<[u8; 32]>, S3SigningError> {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(key).map_err(|_| S3SigningError::SigningKey)?;
        mac.update(data);
        Ok(Zeroizing::new(mac.finalize().into_bytes().into()))
    }
}

/// The canonical request and the header names it signs.
struct CanonicalRequest {
    text: String,
    signed_headers: String,
}

impl S3SigningInput<'_> {
    /// Header values are trimmed with inner runs of spaces collapsed.
    fn canonical_headers(&self) -> CanonicalHeaders {
        let mut headers = vec![
            CanonicalHeader {
                name: "host",
                value: self.host.as_str().to_owned(),
            },
            CanonicalHeader {
                name: "x-amz-content-sha256",
                value: self.payload.as_str().to_owned(),
            },
            CanonicalHeader {
                name: "x-amz-date",
                value: self.time.amz_date(),
            },
        ];
        headers.extend(self.headers.iter().map(|header| {
            CanonicalHeader {
                name: header.name,
                value: header
                    .value
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
            }
        }));
        headers.sort_by(|left, right| left.name.cmp(right.name));
        CanonicalHeaders {
            block: headers.iter().fold(String::new(), |block, header| {
                block + header.name + ":" + &header.value + "\n"
            }),
            signed: headers
                .iter()
                .map(|header| header.name)
                .collect::<Vec<_>>()
                .join(";"),
        }
    }

    fn canonical_request(&self) -> CanonicalRequest {
        let CanonicalHeaders { block, signed } = self.canonical_headers();
        CanonicalRequest {
            text: format!(
                "{}\n{}\n{}\n{block}\n{signed}\n{}",
                self.method.as_str(),
                self.path.as_str(),
                self.query.as_str(),
                self.payload.as_str()
            ),
            signed_headers: signed,
        }
    }

    pub(super) fn sign(&self) -> Result<S3Authorization, S3SigningError> {
        let canonical = self.canonical_request();
        let date = self.time.scope_date();
        let scope = SigningScope {
            date: &date,
            region: self.region.as_str(),
            service: SERVICE,
        };
        let string_to_sign = format!(
            "{ALGORITHM}\n{}\n{}\n{}",
            self.time.amz_date(),
            scope.text(),
            hex::encode(Sha256::digest(canonical.text.as_bytes()))
        );
        let key = scope.signing_key(self.credentials)?;
        let signature =
            hex::encode(SigningScope::hmac(key.as_slice(), string_to_sign.as_bytes())?.as_slice());
        Ok(S3Authorization(format!(
            "{ALGORITHM} Credential={}/{}, SignedHeaders={}, Signature={signature}",
            self.credentials.access_key_id,
            scope.text(),
            canonical.signed_headers
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        S3CanonicalPath, S3CanonicalQuery, S3HttpMethod, S3PayloadHash, S3QueryParameter,
        S3RequestTime, S3SignedHeader, S3SigningError, S3SigningInput, S3UnixSeconds, SigningScope,
    };
    use crate::{
        S3AccessKeyId, S3Credentials, S3Endpoint, S3HostHeader, S3Region, S3SecretAccessKey,
    };

    // The examples of the Amazon S3 API Reference, "Signature Calculations for
    // the Authorization Header: Transferring Payload in a Single Chunk".
    const KEY_ID: &str = "AKIAIOSFODNN7EXAMPLE";
    const SECRET: &str = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    /// 2013-05-24T00:00:00Z.
    const EXAMPLE_TIME: u64 = 1_369_353_600;
    const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    struct AwsExample {
        host: S3HostHeader,
        region: S3Region,
        credentials: S3Credentials,
        time: S3RequestTime,
    }

    impl AwsExample {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                host: S3Endpoint::parse("https://examplebucket.s3.amazonaws.com")?.host_header(),
                region: S3Region::parse("us-east-1")?,
                credentials: S3Credentials {
                    access_key_id: S3AccessKeyId::parse(KEY_ID)?,
                    secret_access_key: S3SecretAccessKey::parse(SECRET)?,
                },
                time: S3RequestTime::try_from(S3UnixSeconds::from(EXAMPLE_TIME))?,
            })
        }
    }

    struct ExampleRequest<'a> {
        method: S3HttpMethod,
        path: &'a S3CanonicalPath,
        query: &'a S3CanonicalQuery,
        headers: &'a [S3SignedHeader<'a>],
        payload: &'a S3PayloadHash,
    }

    impl AwsExample {
        fn input<'a>(&'a self, request: &ExampleRequest<'a>) -> S3SigningInput<'a> {
            S3SigningInput {
                method: request.method,
                host: &self.host,
                path: request.path,
                query: request.query,
                headers: request.headers,
                payload: request.payload,
                time: self.time,
                region: &self.region,
                credentials: &self.credentials,
            }
        }
    }

    #[test]
    fn the_aws_get_object_example_signs_to_its_published_signature() -> anyhow::Result<()> {
        let example = AwsExample::new()?;
        let path = S3CanonicalPath::of_segments(["test.txt"]);
        let query = S3CanonicalQuery::of(&[]);
        let payload = S3PayloadHash::of(b"");
        let headers = [S3SignedHeader {
            name: "range",
            value: "bytes=0-9",
        }];
        let input = example.input(&ExampleRequest {
            method: S3HttpMethod::Get,
            path: &path,
            query: &query,
            headers: &headers,
            payload: &payload,
        });
        assert_eq!(
            input.canonical_request().text,
            format!(
                "GET\n/test.txt\n\nhost:examplebucket.s3.amazonaws.com\nrange:bytes=0-9\n\
                 x-amz-content-sha256:{EMPTY_SHA256}\nx-amz-date:20130524T000000Z\n\n\
                 host;range;x-amz-content-sha256;x-amz-date\n{EMPTY_SHA256}"
            )
        );
        assert_eq!(
            input.sign()?.as_str(),
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, \
             SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, \
             Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
        Ok(())
    }

    #[test]
    fn the_aws_put_object_example_signs_its_payload_and_encoded_path() -> anyhow::Result<()> {
        let example = AwsExample::new()?;
        let payload = S3PayloadHash::of(b"Welcome to Amazon S3.");
        assert_eq!(
            payload.as_str(),
            "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"
        );
        let path = S3CanonicalPath::of_segments(["test$file.text"]);
        assert_eq!(path.as_str(), "/test%24file.text");
        let query = S3CanonicalQuery::of(&[]);
        let headers = [
            S3SignedHeader {
                name: "date",
                value: "Fri, 24 May 2013 00:00:00 GMT",
            },
            S3SignedHeader {
                name: "x-amz-storage-class",
                value: "REDUCED_REDUNDANCY",
            },
        ];
        let authorization = example
            .input(&ExampleRequest {
                method: S3HttpMethod::Put,
                path: &path,
                query: &query,
                headers: &headers,
                payload: &payload,
            })
            .sign()?;
        assert!(authorization.as_str().ends_with(
            "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
        ));
        Ok(())
    }

    #[test]
    fn the_aws_list_objects_example_signs_its_sorted_query() -> anyhow::Result<()> {
        let example = AwsExample::new()?;
        let query = S3CanonicalQuery::of(&[
            S3QueryParameter {
                name: "prefix",
                value: "J",
            },
            S3QueryParameter {
                name: "max-keys",
                value: "2",
            },
        ]);
        assert_eq!(query.as_str(), "max-keys=2&prefix=J");
        let path = S3CanonicalPath::of_segments([]);
        let payload = S3PayloadHash::of(b"");
        let authorization = example
            .input(&ExampleRequest {
                method: S3HttpMethod::Get,
                path: &path,
                query: &query,
                headers: &[],
                payload: &payload,
            })
            .sign()?;
        assert!(authorization.as_str().ends_with(
            "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"
        ));
        Ok(())
    }

    #[test]
    fn the_signing_key_follows_the_aws_derivation_example() -> anyhow::Result<()> {
        // AWS General Reference, "Examples of how to derive a signing key".
        let credentials = S3Credentials {
            access_key_id: S3AccessKeyId::parse(KEY_ID)?,
            secret_access_key: S3SecretAccessKey::parse(
                "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            )?,
        };
        let key = SigningScope {
            date: "20120215",
            region: "us-east-1",
            service: "iam",
        }
        .signing_key(&credentials)?;
        assert_eq!(
            hex::encode(key.as_slice()),
            "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"
        );
        Ok(())
    }

    #[test]
    fn request_times_come_from_the_callers_clock_only() -> anyhow::Result<()> {
        let time = S3RequestTime::try_from(S3UnixSeconds::from(1_793_484_445))?;
        assert_eq!(time.amz_date(), "20261031T220725Z");
        assert_eq!(time.scope_date(), "20261031");
        for unsignable in [u64::MAX, 253_402_300_800] {
            assert_eq!(
                S3RequestTime::try_from(S3UnixSeconds::from(unsignable)),
                Err(S3SigningError::RequestTimeOutOfRange)
            );
        }
        Ok(())
    }

    #[test]
    fn canonical_paths_and_queries_encode_everything_but_unreserved_characters() {
        assert_eq!(
            S3CanonicalPath::of_segments(["bucket", "a b+c~d", "é", ""]).as_str(),
            "/bucket/a%20b%2Bc~d/%C3%A9/"
        );
        assert_eq!(
            S3CanonicalQuery::of(&[
                S3QueryParameter {
                    name: "prefix",
                    value: "team/meta-secret-nook/",
                },
                S3QueryParameter {
                    name: "continuation-token",
                    value: "1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=",
                },
                S3QueryParameter {
                    name: "delimiter",
                    value: "/",
                },
            ])
            .as_str(),
            "continuation-token=1ueGcxLPRx1Tr%2FXYExHnhbYLgveDs2J%2Fwm36Hy4vbOwM%3D\
             &delimiter=%2F&prefix=team%2Fmeta-secret-nook%2F"
        );
    }
}
