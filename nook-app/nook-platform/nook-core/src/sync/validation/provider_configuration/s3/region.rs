#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The signing region of an S3 provider.

use std::fmt;

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{ValidationError, ValidationResult};

/// The region a request's signature is scoped to, such as `us-east-1`. S3
/// services that ignore regions still check the one they were configured
/// with, so it is required and used exactly as written.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[tsify(type = "string")]
#[serde(try_from = "String", into = "String")]
pub struct S3Region(String);

impl S3Region {
    /// At most 64 letters, digits, hyphens, and underscores: the region is
    /// one segment of the signature's credential scope.
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let region = match raw.trim() {
            "" => return Err(ValidationError::S3RegionRequired),
            region => region,
        };
        let region = match region.len() {
            1..=64 => region,
            _ => return Err(ValidationError::S3RegionInvalid),
        };
        match region
            .bytes()
            .find(|byte| !matches!(byte, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_'))
        {
            Some(_) => Err(ValidationError::S3RegionInvalid),
            None => Ok(Self(region.to_owned())),
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(region) = self;
        region
    }
}

impl fmt::Display for S3Region {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl TryFrom<String> for S3Region {
    type Error = ValidationError;
    fn try_from(value: String) -> ValidationResult<Self> {
        Self::parse(&value)
    }
}

impl From<S3Region> for String {
    fn from(region: S3Region) -> Self {
        let S3Region(region) = region;
        region
    }
}

#[cfg(test)]
mod tests {
    use super::S3Region;
    use crate::errors::ValidationError;

    #[test]
    fn regions_are_single_scope_segments() -> anyhow::Result<()> {
        for region in ["us-east-1", "auto", "eu_central", "US-Gov-West-1"] {
            assert_eq!(S3Region::parse(&format!(" {region} "))?.as_str(), region);
        }
        assert_eq!(S3Region::parse(""), Err(ValidationError::S3RegionRequired));
        let too_long = "a".repeat(65);
        for region in ["us/east", "us east", "région", too_long.as_str()] {
            assert_eq!(
                S3Region::parse(region),
                Err(ValidationError::S3RegionInvalid),
                "{region}"
            );
        }
        Ok(())
    }
}
