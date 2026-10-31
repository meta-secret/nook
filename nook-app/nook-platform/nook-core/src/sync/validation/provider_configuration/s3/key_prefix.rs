#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The optional key prefix an S3 provider keeps its objects under.
//!
//! A prefix cannot escape or blur the object layout below it: it never starts
//! with `/`, every segment is non-empty and neither `.` nor `..`, and segments
//! use only the URI unreserved characters, so no key ever needs escaping.
//! One trailing `/` is accepted and dropped: `team/vaults/` is `team/vaults`.

use std::fmt;

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{ValidationError, ValidationResult};

/// The longest prefix accepted, which leaves the event key layout below it
/// far inside the 1,024-byte S3 key limit.
const MAX_KEY_PREFIX_LEN: usize = 256;

/// Where a provider keeps its Nook objects inside the bucket. The wire form
/// is the normalized prefix text, empty for the bucket root.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[tsify(type = "string")]
#[serde(try_from = "String", into = "String")]
pub enum S3KeyPrefix {
    /// The objects start at the bucket root.
    #[default]
    BucketRoot,
    /// The objects sit below these slash-separated segments.
    Folder(S3KeyPrefixPath),
}

/// Normalized prefix segments joined by `/`, with no leading or trailing
/// slash.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct S3KeyPrefixPath(String);

impl S3KeyPrefixPath {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(path) = self;
        path
    }
}

impl fmt::Display for S3KeyPrefixPath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl S3KeyPrefix {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let prefix = match raw.trim() {
            "" => return Ok(Self::BucketRoot),
            prefix => prefix,
        };
        let prefix = match prefix.bytes().find(|byte| {
            !matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/')
        }) {
            Some(_) => return Err(ValidationError::S3KeyPrefixChars),
            None => prefix,
        };
        let prefix = match prefix.len() {
            ..=MAX_KEY_PREFIX_LEN => prefix,
            _ => return Err(ValidationError::S3KeyPrefixLength),
        };
        let path = prefix.strip_suffix('/').unwrap_or(prefix);
        match path
            .split('/')
            .find(|segment| matches!(*segment, "" | "." | ".."))
        {
            Some(_) => Err(ValidationError::S3KeyPrefixInvalid),
            None => Ok(Self::Folder(S3KeyPrefixPath(path.to_owned()))),
        }
    }
}

impl fmt::Display for S3KeyPrefix {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BucketRoot => Ok(()),
            Self::Folder(path) => path.fmt(formatter),
        }
    }
}

impl TryFrom<String> for S3KeyPrefix {
    type Error = ValidationError;
    fn try_from(value: String) -> ValidationResult<Self> {
        Self::parse(&value)
    }
}

impl From<S3KeyPrefix> for String {
    fn from(prefix: S3KeyPrefix) -> Self {
        prefix.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::S3KeyPrefix;
    use crate::errors::ValidationError;

    struct NormalizedPrefix {
        raw: &'static str,
        normalized: &'static str,
    }

    #[test]
    fn prefixes_normalize_to_their_segments() -> anyhow::Result<()> {
        assert_eq!(S3KeyPrefix::parse("  ")?, S3KeyPrefix::BucketRoot);
        for case in [
            NormalizedPrefix {
                raw: "team",
                normalized: "team",
            },
            NormalizedPrefix {
                raw: " team/vaults/ ",
                normalized: "team/vaults",
            },
            NormalizedPrefix {
                raw: "e2e-run_1.a~b",
                normalized: "e2e-run_1.a~b",
            },
            NormalizedPrefix {
                raw: "a/.b/c..d/",
                normalized: "a/.b/c..d",
            },
        ] {
            let prefix = S3KeyPrefix::parse(case.raw)?;
            assert_eq!(prefix.to_string(), case.normalized, "{}", case.raw);
            assert_eq!(S3KeyPrefix::parse(case.normalized)?, prefix);
        }
        Ok(())
    }

    #[test]
    fn prefixes_cannot_escape_or_blur_the_layout() {
        for raw in [
            "/team",
            "/",
            "team//vaults",
            "team//",
            "team/./vaults",
            "team/..",
            "..",
            ".",
            "./team",
        ] {
            assert_eq!(
                S3KeyPrefix::parse(raw),
                Err(ValidationError::S3KeyPrefixInvalid),
                "{raw}"
            );
        }
        for raw in [
            "team vaults",
            "team\\vaults",
            "team\u{0}",
            "team\nvaults",
            "команда",
            "team%2Fvaults",
            "team?x",
            "team+1",
        ] {
            assert_eq!(
                S3KeyPrefix::parse(raw),
                Err(ValidationError::S3KeyPrefixChars),
                "{raw:?}"
            );
        }
        assert_eq!(
            S3KeyPrefix::parse(&"a".repeat(257)),
            Err(ValidationError::S3KeyPrefixLength)
        );
        assert!(S3KeyPrefix::parse(&"a".repeat(256)).is_ok());
    }

    #[test]
    fn prefixes_cross_the_wire_as_their_normalized_text() -> anyhow::Result<()> {
        let prefix: S3KeyPrefix = serde_json::from_str("\"team/vaults/\"")?;
        assert_eq!(serde_json::to_string(&prefix)?, "\"team/vaults\"");
        let root: S3KeyPrefix = serde_json::from_str("\"\"")?;
        assert_eq!(root, S3KeyPrefix::BucketRoot);
        assert_eq!(serde_json::to_string(&root)?, "\"\"");
        assert!(serde_json::from_str::<S3KeyPrefix>("\"/team\"").is_err());
        Ok(())
    }
}
