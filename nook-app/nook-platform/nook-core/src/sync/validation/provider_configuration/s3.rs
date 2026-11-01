#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! S3-compatible storage connections, validated where they enter Nook.
//!
//! An [`S3Connection`] names where the objects live (endpoint, region,
//! bucket, key prefix) and the key this device signs with. It is built only by
//! validating an [`S3ConnectionDraft`], the setup form's raw fields, which is
//! also how every stored row, invite, and storage connection reads one back.
//! Validation stays minimal: the server refuses anything else.

use std::net::{Ipv4Addr, Ipv6Addr};

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use url::{Host, Url};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::errors::{ValidationError, ValidationResult};
use crate::{ProviderSecretText, S3EnrollmentConnection, S3KeyPrefix};

/// One device's validated connection: where the objects live and the key it
/// signs with. The endpoint is a canonical origin, `scheme://host[:port]`, and
/// the objects start at the bucket root or below a key prefix.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", try_from = "S3ConnectionRecord")]
pub struct S3Connection {
    pub(crate) endpoint: String,
    pub(crate) region: String,
    pub(crate) bucket: String,
    pub(crate) key_prefix: S3KeyPrefix,
    pub(crate) access_key_id: String,
    pub(crate) secret_access_key: ProviderSecretText,
}

/// A stored or carried connection as it reads back. The prefix and the secret
/// are typed already; the location strings and the key id go through the
/// setup form's validators again.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct S3ConnectionRecord {
    endpoint: String,
    region: String,
    bucket: String,
    key_prefix: S3KeyPrefix,
    access_key_id: String,
    secret_access_key: ProviderSecretText,
}

/// What the S3 setup form holds, field by field, before validation. The
/// typed secret is wiped when the draft is dropped.
#[derive(Deserialize, Tsify, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct S3ConnectionDraft {
    #[zeroize(skip)]
    pub endpoint: String,
    #[zeroize(skip)]
    pub region: String,
    #[zeroize(skip)]
    pub bucket: String,
    /// The typed text; blank, or slashes alone, for the bucket root.
    #[zeroize(skip)]
    pub key_prefix: String,
    #[zeroize(skip)]
    pub access_key_id: String,
    pub secret_access_key: String,
}

/// One field of the S3 setup form.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum S3DraftField {
    Endpoint,
    Region,
    Bucket,
    KeyPrefix,
    AccessKeyId,
    SecretAccessKey,
}

/// A field the form must correct, and the translation key saying why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct S3DraftFieldError {
    pub field: S3DraftField,
    pub error_key: String,
}

/// What validating the whole form found.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum S3DraftValidation {
    /// Every field is valid: the connection a new S3 row is saved with.
    Valid { configuration: S3Connection },
    /// Every wrong field once, in form order.
    Invalid { fields: Vec<S3DraftFieldError> },
}

/// What validating one form field found.
enum S3DraftFieldCheck {
    Valid,
    Invalid(S3DraftFieldError),
}

impl S3DraftField {
    /// This field's check of its validated value.
    fn check<T>(self, validated: ValidationResult<T>) -> S3DraftFieldCheck {
        match validated {
            Ok(_) => S3DraftFieldCheck::Valid,
            Err(error) => S3DraftFieldCheck::Invalid(S3DraftFieldError {
                field: self,
                error_key: error.to_string(),
            }),
        }
    }
}

impl S3ConnectionDraft {
    /// Validate every field, so the form can mark each wrong one at once.
    #[must_use]
    pub fn validate(self) -> S3DraftValidation {
        let fields = [
            S3DraftField::Endpoint.check(S3Connection::parse_endpoint(&self.endpoint)),
            S3DraftField::Region.check(S3Connection::parse_region(&self.region)),
            S3DraftField::Bucket.check(S3Connection::parse_bucket(&self.bucket)),
            S3DraftField::KeyPrefix.check(S3KeyPrefix::parse(&self.key_prefix)),
            S3DraftField::AccessKeyId.check(S3Connection::parse_access_key_id(&self.access_key_id)),
            S3DraftField::SecretAccessKey.check(S3Connection::parse_secret_access_key(
                &self.secret_access_key,
            )),
        ]
        .into_iter()
        .fold(Vec::new(), |mut fields, check| {
            if let S3DraftFieldCheck::Invalid(error) = check {
                fields.push(error);
            }
            fields
        });
        match S3Connection::try_from(self) {
            Ok(configuration) => S3DraftValidation::Valid { configuration },
            Err(_) => S3DraftValidation::Invalid { fields },
        }
    }
}

/// Validate the fields in form order, so the first wrong one is reported.
impl TryFrom<S3ConnectionDraft> for S3Connection {
    type Error = ValidationError;
    fn try_from(draft: S3ConnectionDraft) -> ValidationResult<Self> {
        Ok(Self {
            endpoint: Self::parse_endpoint(&draft.endpoint)?,
            region: Self::parse_region(&draft.region)?,
            bucket: Self::parse_bucket(&draft.bucket)?,
            key_prefix: S3KeyPrefix::parse(&draft.key_prefix)?,
            access_key_id: Self::parse_access_key_id(&draft.access_key_id)?,
            secret_access_key: Self::parse_secret_access_key(&draft.secret_access_key)?,
        })
    }
}

/// Validate a read-back connection's strings as the form's are validated.
impl TryFrom<S3ConnectionRecord> for S3Connection {
    type Error = ValidationError;
    fn try_from(record: S3ConnectionRecord) -> ValidationResult<Self> {
        Ok(Self {
            endpoint: Self::parse_endpoint(&record.endpoint)?,
            region: Self::parse_region(&record.region)?,
            bucket: Self::parse_bucket(&record.bucket)?,
            key_prefix: record.key_prefix,
            access_key_id: Self::parse_access_key_id(&record.access_key_id)?,
            secret_access_key: record.secret_access_key,
        })
    }
}

/// An invite's connection, validated again as a stored one is.
impl TryFrom<&S3EnrollmentConnection> for S3Connection {
    type Error = ValidationError;
    fn try_from(carried: &S3EnrollmentConnection) -> ValidationResult<Self> {
        Self::try_from(S3ConnectionRecord {
            endpoint: carried.endpoint.clone(),
            region: carried.region.clone(),
            bucket: carried.bucket.clone(),
            key_prefix: carried.key_prefix.clone(),
            access_key_id: carried.access_key_id.clone(),
            secret_access_key: carried.secret_access_key.clone(),
        })
    }
}

impl S3Connection {
    /// `https://` to any host, or plain `http://` only to `localhost`,
    /// `127.0.0.1`, or `[::1]` for the local development server, with nothing
    /// beyond the origin: no user name, path, query, or fragment. Kept as the
    /// canonical origin.
    fn parse_endpoint(raw: &str) -> ValidationResult<String> {
        let raw = match raw.trim() {
            "" => return Err(ValidationError::S3EndpointRequired),
            raw => raw,
        };
        let url = Url::parse(raw).map_err(|_| ValidationError::S3EndpointInvalid)?;
        let origin = url.origin().ascii_serialization();
        if url.as_str() != format!("{origin}/") {
            return Err(ValidationError::S3EndpointInvalid);
        }
        let loopback = match url.host() {
            Some(Host::Domain(domain)) => domain == "localhost",
            Some(Host::Ipv4(address)) => address == Ipv4Addr::LOCALHOST,
            Some(Host::Ipv6(address)) => address == Ipv6Addr::LOCALHOST,
            None => false,
        };
        match (url.scheme(), loopback) {
            ("https", _) | ("http", true) => Ok(origin),
            ("http", false) => Err(ValidationError::S3EndpointInsecure),
            _ => Err(ValidationError::S3EndpointInvalid),
        }
    }

    fn parse_region(raw: &str) -> ValidationResult<String> {
        Self::parse_name(
            raw,
            ValidationError::S3RegionRequired,
            ValidationError::S3RegionInvalid,
        )
    }

    /// A bucket name never holds `/`, which would make it part of a key.
    fn parse_bucket(raw: &str) -> ValidationResult<String> {
        let bucket = Self::parse_name(
            raw,
            ValidationError::S3BucketRequired,
            ValidationError::S3BucketInvalid,
        )?;
        if bucket.contains('/') {
            return Err(ValidationError::S3BucketInvalid);
        }
        Ok(bucket)
    }

    /// Required, and kept exactly as written: sealed text is armor whose line
    /// breaks matter. A blank key is this field's own error.
    fn parse_secret_access_key(raw: &str) -> ValidationResult<ProviderSecretText> {
        ProviderSecretText::try_from(raw.to_owned())
            .map_err(|_| ValidationError::S3SecretAccessKeyRequired)
    }

    fn parse_access_key_id(raw: &str) -> ValidationResult<String> {
        Self::parse_name(
            raw,
            ValidationError::S3AccessKeyIdRequired,
            ValidationError::S3AccessKeyIdInvalid,
        )
    }

    /// A required name with no whitespace or control character inside. The
    /// region and the key id become part of the signed `Authorization`
    /// header, which cannot carry a control character.
    fn parse_name(
        raw: &str,
        required: ValidationError,
        invalid: ValidationError,
    ) -> ValidationResult<String> {
        match raw.trim() {
            "" => Err(required),
            name if name
                .chars()
                .any(|character| character.is_whitespace() || character.is_control()) =>
            {
                Err(invalid)
            }
            name => Ok(name.to_owned()),
        }
    }

    /// The location's identity, `endpoint/bucket[/prefix]`, as its mount
    /// record formats it. Duplicate detection and the local cache key use it.
    #[must_use]
    pub fn location_identity(&self) -> String {
        self.mount_location().location_identity()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        S3Connection, S3ConnectionDraft, S3DraftField, S3DraftFieldError, S3DraftValidation,
    };
    use crate::S3KeyPrefix;
    use crate::errors::ValidationError;
    use serde_json::json;

    const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";

    impl S3ConnectionDraft {
        pub(crate) fn fixture() -> Self {
            Self {
                endpoint: " http://127.0.0.1:8333/ ".to_owned(),
                region: "us-east-1".to_owned(),
                bucket: "nook-dev".to_owned(),
                key_prefix: "e2e/run-1/".to_owned(),
                access_key_id: "device-a".to_owned(),
                secret_access_key: SECRET.to_owned(),
            }
        }
    }

    impl S3Connection {
        pub(crate) fn fixture() -> anyhow::Result<Self> {
            Ok(Self::try_from(S3ConnectionDraft::fixture())?)
        }
    }

    impl S3DraftField {
        /// The fixture draft with this field typed as `raw`, validated.
        fn validated(self, raw: &str) -> Result<S3Connection, ValidationError> {
            let mut draft = S3ConnectionDraft::fixture();
            let raw = raw.to_owned();
            match self {
                Self::Endpoint => draft.endpoint = raw,
                Self::Region => draft.region = raw,
                Self::Bucket => draft.bucket = raw,
                Self::KeyPrefix => draft.key_prefix = raw,
                Self::AccessKeyId => draft.access_key_id = raw,
                Self::SecretAccessKey => draft.secret_access_key = raw,
            }
            S3Connection::try_from(draft)
        }

        /// What the connection keeps for this field, as its row stores it.
        fn kept(self, connection: &S3Connection) -> anyhow::Result<serde_json::Value> {
            let serde_json::Value::String(name) = serde_json::to_value(self)? else {
                anyhow::bail!("a form field serializes as its name");
            };
            serde_json::to_value(connection)?
                .get(&name)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("the connection keeps {name}"))
        }
    }

    #[test]
    fn each_field_keeps_what_it_accepts_in_its_canonical_form() -> anyhow::Result<()> {
        use S3DraftField::{AccessKeyId, Bucket, Endpoint, KeyPrefix, Region, SecretAccessKey};
        let accepted = [
            (
                Endpoint,
                " https://S3.Example.COM ",
                json!("https://s3.example.com"),
            ),
            (
                Endpoint,
                "https://s3.example.com:443/",
                json!("https://s3.example.com"),
            ),
            (
                Endpoint,
                "http://localhost:8333/",
                json!("http://localhost:8333"),
            ),
            (Endpoint, "HTTP://LOCALHOST:80", json!("http://localhost")),
            (Region, " eu_central-1 ", json!("eu_central-1")),
            (Bucket, "Nook_Dev..backups", json!("Nook_Dev..backups")),
            (KeyPrefix, "/", json!({ "state": "bucketRoot" })),
            (
                KeyPrefix,
                " /team/vaults/ ",
                json!({ "state": "prefix", "value": "team/vaults" }),
            ),
            (
                KeyPrefix,
                "a/.b/c..d/команда 1",
                json!({ "state": "prefix", "value": "a/.b/c..d/команда 1" }),
            ),
            (AccessKeyId, " user@team+1 ", json!("user@team+1")),
            (SecretAccessKey, " kept exactly\n", json!(" kept exactly\n")),
        ];
        for (field, raw, kept) in accepted {
            assert_eq!(field.kept(&field.validated(raw)?)?, kept, "{raw:?}");
        }
        // These endpoints are canonical origins already.
        for raw in [
            "https://minio.example.com:9000",
            "https://[2001:db8::1]:8443",
            "http://127.0.0.1:8333",
            "http://[::1]:8333",
        ] {
            assert_eq!(Endpoint.kept(&Endpoint.validated(raw)?)?, json!(raw));
        }
        Ok(())
    }

    #[test]
    fn each_field_rejects_what_cannot_name_an_s3_location_or_key() {
        use S3DraftField::{AccessKeyId, Bucket, Endpoint, KeyPrefix, Region, SecretAccessKey};
        let rejected: &[(S3DraftField, ValidationError, &[&str])] = &[
            (Endpoint, ValidationError::S3EndpointRequired, &[" \t"]),
            // Plain HTTP is only for this machine.
            (
                Endpoint,
                ValidationError::S3EndpointInsecure,
                &[
                    "http://s3.example.com",
                    "http://10.0.0.5:9000",
                    "http://127.0.0.2:8333",
                    "http://localhost.example.com",
                    "http://[::2]:8333",
                ],
            ),
            // An endpoint is an http(s) origin and nothing more.
            (
                Endpoint,
                ValidationError::S3EndpointInvalid,
                &[
                    "https://user:secret@s3.example.com",
                    "https://s3.example.com/bucket",
                    "https://s3.example.com/?",
                    "https://s3.example.com/#top",
                    "s3.example.com",
                    "ftp://s3.example.com",
                    "file:///tmp/bucket",
                ],
            ),
            (Region, ValidationError::S3RegionRequired, &[""]),
            (
                Region,
                ValidationError::S3RegionInvalid,
                &["us east", "us-east-1\u{7}"],
            ),
            (Bucket, ValidationError::S3BucketRequired, &[" "]),
            (
                Bucket,
                ValidationError::S3BucketInvalid,
                &["nook/dev", "nook dev"],
            ),
            (
                KeyPrefix,
                ValidationError::S3KeyPrefixInvalid,
                &["team//vaults", "team/./vaults", "team/..", "team\nvaults"],
            ),
            (AccessKeyId, ValidationError::S3AccessKeyIdRequired, &[""]),
            (
                AccessKeyId,
                ValidationError::S3AccessKeyIdInvalid,
                &["AKIA EXAMPLE", "AKIA\u{7f}"],
            ),
            // One blank rule for every provider secret: empty or whitespace only.
            (
                SecretAccessKey,
                ValidationError::S3SecretAccessKeyRequired,
                &["", " ", "\t\n"],
            ),
        ];
        for (field, error, raws) in rejected {
            for raw in *raws {
                assert_eq!(field.validated(raw).err().as_ref(), Some(error), "{raw:?}");
            }
        }
    }

    #[test]
    fn a_draft_reports_every_wrong_field_once_in_form_order() -> anyhow::Result<()> {
        let valid = S3ConnectionDraft::fixture().validate();
        assert_eq!(
            valid,
            S3DraftValidation::Valid {
                configuration: S3Connection::fixture()?
            }
        );
        assert_eq!(
            serde_json::to_value(&valid)?.get("state"),
            Some(&json!("valid"))
        );
        let mut draft = S3ConnectionDraft::fixture();
        draft.endpoint = "http://s3.example.com".to_owned();
        draft.region = String::new();
        draft.key_prefix = "team/../other".to_owned();
        draft.secret_access_key = String::new();
        let invalid = draft.validate();
        let field = |field, error: ValidationError| S3DraftFieldError {
            field,
            error_key: error.to_string(),
        };
        assert_eq!(
            invalid,
            S3DraftValidation::Invalid {
                fields: vec![
                    field(S3DraftField::Endpoint, ValidationError::S3EndpointInsecure),
                    field(S3DraftField::Region, ValidationError::S3RegionRequired),
                    field(S3DraftField::KeyPrefix, ValidationError::S3KeyPrefixInvalid),
                    field(
                        S3DraftField::SecretAccessKey,
                        ValidationError::S3SecretAccessKeyRequired
                    ),
                ]
            }
        );
        assert_eq!(
            serde_json::to_value(&invalid)?.pointer("/fields/2"),
            Some(&json!({
                "field": "keyPrefix",
                "errorKey": ValidationError::S3KeyPrefixInvalid.to_string(),
            }))
        );
        // A wrong field never echoes the secret typed beside it.
        let mut wrong_bucket = S3ConnectionDraft::fixture();
        wrong_bucket.bucket = "nook/dev".to_owned();
        let report = serde_json::to_string(&wrong_bucket.validate())?;
        assert!(!report.contains(SECRET), "{report}");
        assert!(!format!("{:?}", S3Connection::fixture()?).contains(SECRET));
        Ok(())
    }

    #[test]
    fn a_location_is_identified_by_endpoint_bucket_and_prefix_alone() -> anyhow::Result<()> {
        let connection = S3Connection::fixture()?;
        assert_eq!(
            connection.location_identity(),
            "http://127.0.0.1:8333/nook-dev/e2e/run-1"
        );
        let mut elsewhere = connection.clone();
        elsewhere.region = "eu-west-1".to_owned();
        elsewhere.access_key_id = "device-b".to_owned();
        assert_eq!(
            elsewhere.location_identity(),
            connection.location_identity()
        );
        elsewhere.key_prefix = S3KeyPrefix::BucketRoot;
        assert_eq!(
            elsewhere.location_identity(),
            "http://127.0.0.1:8333/nook-dev"
        );
        Ok(())
    }

    #[test]
    fn a_stored_connection_reads_back_only_through_the_form_validators() -> anyhow::Result<()> {
        let stored = serde_json::to_value(S3Connection::fixture()?)?;
        assert_eq!(
            stored,
            json!({
                "endpoint": "http://127.0.0.1:8333",
                "region": "us-east-1",
                "bucket": "nook-dev",
                "keyPrefix": { "state": "prefix", "value": "e2e/run-1" },
                "accessKeyId": "device-a",
                "secretAccessKey": SECRET,
            })
        );
        assert_eq!(
            serde_json::from_value::<S3Connection>(stored.clone())?,
            S3Connection::fixture()?
        );
        for (field, value) in [
            ("keyPrefix", json!("e2e/run-1")),
            (
                "keyPrefix",
                json!({ "state": "prefix", "value": "e2e/run-1/" }),
            ),
            ("endpoint", json!("http://s3.example.com")),
            ("region", json!("")),
            ("bucket", json!("nook/dev")),
            ("accessKeyId", json!("device a")),
            ("secretAccessKey", json!(" ")),
            ("sessionToken", json!("not-a-connection-field")),
        ] {
            let mut row = stored.clone();
            if let Some(fields) = row.as_object_mut() {
                fields.insert(field.to_owned(), value);
            }
            assert!(
                serde_json::from_value::<S3Connection>(row).is_err(),
                "{field}"
            );
        }
        Ok(())
    }
}
