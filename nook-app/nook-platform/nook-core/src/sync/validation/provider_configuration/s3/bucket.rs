#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! S3 bucket names, checked against the general-purpose bucket naming rules.

use std::fmt;
use std::net::Ipv4Addr;

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{ValidationError, ValidationResult};

/// Prefixes S3 reserves for its own bucket kinds.
const RESERVED_PREFIXES: [&str; 3] = ["xn--", "sthree-", "amzn-s3-demo-"];
/// Suffixes S3 reserves for access points, directory and table buckets.
const RESERVED_SUFFIXES: [&str; 5] = ["-s3alias", "--ol-s3", ".mrap", "--x-s3", "--table-s3"];

/// A bucket name that follows the S3 general-purpose bucket rules: 3 to 63
/// lowercase letters, digits, dots, and hyphens; a letter or digit at each
/// end; no adjacent dots; not shaped like an IPv4 address; and none of the
/// reserved prefixes or suffixes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[tsify(type = "string")]
#[serde(try_from = "String", into = "String")]
pub struct S3BucketName(String);

impl S3BucketName {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let bucket = match raw.trim() {
            "" => return Err(ValidationError::S3BucketRequired),
            bucket => bucket,
        };
        let bucket = match bucket.len() {
            3..=63 => bucket,
            _ => return Err(ValidationError::S3BucketLength),
        };
        let bucket = match bucket
            .bytes()
            .find(|byte| !matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-'))
        {
            Some(_) => return Err(ValidationError::S3BucketChars),
            None => bucket,
        };
        let bucket = match bucket.as_bytes() {
            [first, .., last] if first.is_ascii_alphanumeric() && last.is_ascii_alphanumeric() => {
                bucket
            }
            _ => return Err(ValidationError::S3BucketInvalid),
        };
        let bucket = match bucket.find("..") {
            Some(_) => return Err(ValidationError::S3BucketInvalid),
            None => bucket,
        };
        let bucket = match bucket.parse::<Ipv4Addr>() {
            Ok(_) => return Err(ValidationError::S3BucketInvalid),
            Err(_) => bucket,
        };
        let bucket = match RESERVED_PREFIXES
            .iter()
            .find(|prefix| bucket.starts_with(**prefix))
        {
            Some(_) => return Err(ValidationError::S3BucketInvalid),
            None => bucket,
        };
        match RESERVED_SUFFIXES
            .iter()
            .find(|suffix| bucket.ends_with(**suffix))
        {
            Some(_) => Err(ValidationError::S3BucketInvalid),
            None => Ok(Self(bucket.to_owned())),
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(bucket) = self;
        bucket
    }
}

impl fmt::Display for S3BucketName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl TryFrom<String> for S3BucketName {
    type Error = ValidationError;
    fn try_from(value: String) -> ValidationResult<Self> {
        Self::parse(&value)
    }
}

impl From<S3BucketName> for String {
    fn from(bucket: S3BucketName) -> Self {
        let S3BucketName(bucket) = bucket;
        bucket
    }
}

#[cfg(test)]
mod tests {
    use super::S3BucketName;
    use crate::errors::ValidationError;

    struct RejectedBucket {
        name: String,
        error: ValidationError,
    }

    impl RejectedBucket {
        fn new(name: &str, error: ValidationError) -> Self {
            Self {
                name: name.to_owned(),
                error,
            }
        }
    }

    #[test]
    fn general_purpose_bucket_names_are_accepted_as_written() -> anyhow::Result<()> {
        let longest = "b".repeat(63);
        for name in [
            "nook-dev",
            "abc",
            "my.vault.backup",
            "0-backups-9",
            longest.as_str(),
        ] {
            assert_eq!(S3BucketName::parse(&format!(" {name}\n"))?.as_str(), name);
        }
        Ok(())
    }

    #[test]
    fn bucket_names_outside_the_s3_rules_are_rejected() {
        for case in [
            RejectedBucket::new("  ", ValidationError::S3BucketRequired),
            RejectedBucket::new("ab", ValidationError::S3BucketLength),
            RejectedBucket::new(&"b".repeat(64), ValidationError::S3BucketLength),
            RejectedBucket::new("Nook-Dev", ValidationError::S3BucketChars),
            RejectedBucket::new("nook_dev", ValidationError::S3BucketChars),
            RejectedBucket::new("nook dev", ValidationError::S3BucketChars),
            RejectedBucket::new("nöok", ValidationError::S3BucketChars),
            RejectedBucket::new("-nook", ValidationError::S3BucketInvalid),
            RejectedBucket::new("nook.", ValidationError::S3BucketInvalid),
            RejectedBucket::new("nook..dev", ValidationError::S3BucketInvalid),
            RejectedBucket::new("192.168.5.4", ValidationError::S3BucketInvalid),
            RejectedBucket::new("xn--nook", ValidationError::S3BucketInvalid),
            RejectedBucket::new("sthree-nook", ValidationError::S3BucketInvalid),
            RejectedBucket::new("amzn-s3-demo-nook", ValidationError::S3BucketInvalid),
            RejectedBucket::new("nook-s3alias", ValidationError::S3BucketInvalid),
            RejectedBucket::new("nook--ol-s3", ValidationError::S3BucketInvalid),
            RejectedBucket::new("nook.mrap", ValidationError::S3BucketInvalid),
            RejectedBucket::new("nook--x-s3", ValidationError::S3BucketInvalid),
            RejectedBucket::new("nook--table-s3", ValidationError::S3BucketInvalid),
        ] {
            assert_eq!(
                S3BucketName::parse(&case.name),
                Err(case.error),
                "{}",
                case.name
            );
        }
    }
}
