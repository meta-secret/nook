#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! Where an S3 location's objects start in its bucket.

use serde::{Deserialize, Serialize};

use crate::errors::{ValidationError, ValidationResult};

/// Where an S3 location's objects start: at the bucket root, or below a
/// prefix of one or more key segments.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, tsify::Tsify)]
#[serde(
    tag = "state",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum S3KeyPrefix {
    BucketRoot,
    Prefix(S3KeyPrefixPath),
}

/// A prefix's segments joined by `/`, with no slash around them. No segment is
/// empty, `.`, or `..`, and none holds a control character, so a prefix never
/// escapes or blurs the key layout below it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, tsify::Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct S3KeyPrefixPath(String);

impl S3KeyPrefix {
    /// The setup form's text. Surrounding whitespace and slashes go, and
    /// nothing left is the bucket root.
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        match raw.trim().trim_matches('/') {
            "" => Ok(Self::BucketRoot),
            prefix => S3KeyPrefixPath::try_from(prefix.to_owned()).map(Self::Prefix),
        }
    }

    /// `base` with the prefix below it: `base` or `base/prefix`.
    #[must_use]
    pub fn below(&self, base: &str) -> String {
        match self {
            Self::BucketRoot => base.to_owned(),
            Self::Prefix(prefix) => format!("{base}/{}", prefix.as_str()),
        }
    }

    /// The key a provider path takes: `path` or `prefix/path`.
    #[must_use]
    pub fn key_of(&self, path: &str) -> String {
        match self {
            Self::BucketRoot => path.to_owned(),
            Self::Prefix(prefix) => format!("{}/{path}", prefix.as_str()),
        }
    }
}

impl S3KeyPrefixPath {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(path) = self;
        path
    }
}

/// A stored prefix is read exactly: a slash around it or an empty segment is
/// a damaged value, not a form to normalise.
impl TryFrom<String> for S3KeyPrefixPath {
    type Error = ValidationError;
    fn try_from(path: String) -> ValidationResult<Self> {
        match path.as_str() {
            damaged
                if damaged.chars().any(char::is_control)
                    || damaged
                        .split('/')
                        .any(|segment| matches!(segment, "" | "." | "..")) =>
            {
                Err(ValidationError::S3KeyPrefixInvalid)
            }
            _ => Ok(Self(path)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{S3KeyPrefix, S3KeyPrefixPath};
    use crate::errors::ValidationError;
    use serde_json::json;
    use tsify::Tsify;

    fn prefix(path: &str) -> anyhow::Result<S3KeyPrefix> {
        Ok(S3KeyPrefix::Prefix(S3KeyPrefixPath::try_from(
            path.to_owned(),
        )?))
    }

    #[test]
    fn the_form_text_names_the_bucket_root_or_its_normalised_prefix() -> anyhow::Result<()> {
        for root in ["", " ", "/", " / ", "//"] {
            assert_eq!(
                S3KeyPrefix::parse(root)?,
                S3KeyPrefix::BucketRoot,
                "{root:?}"
            );
        }
        for (raw, kept) in [
            ("team", "team"),
            (" /team/vaults/ ", "team/vaults"),
            ("e2e/run-1/", "e2e/run-1"),
            ("a/.b/c..d/команда 1", "a/.b/c..d/команда 1"),
        ] {
            assert_eq!(S3KeyPrefix::parse(raw)?, prefix(kept)?, "{raw:?}");
        }
        for raw in [
            "team//vaults",
            "team/./vaults",
            "team/..",
            "./team",
            "team\nvaults",
        ] {
            assert_eq!(
                S3KeyPrefix::parse(raw),
                Err(ValidationError::S3KeyPrefixInvalid),
                "{raw:?}"
            );
        }
        Ok(())
    }

    #[test]
    fn a_stored_prefix_reads_back_only_in_its_exact_form() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::to_value(S3KeyPrefix::BucketRoot)?,
            json!({ "state": "bucketRoot" })
        );
        assert_eq!(
            serde_json::to_value(prefix("vaults/team")?)?,
            json!({ "state": "prefix", "value": "vaults/team" })
        );
        assert_eq!(
            serde_json::from_value::<S3KeyPrefix>(json!({ "state": "bucketRoot" }))?,
            S3KeyPrefix::BucketRoot
        );
        assert_eq!(
            serde_json::from_value::<S3KeyPrefix>(json!({ "state": "prefix", "value": "a/b" }))?,
            prefix("a/b")?
        );
        for damaged in [
            json!({ "state": "prefix", "value": "a/" }),
            json!({ "state": "prefix", "value": "/a" }),
            json!({ "state": "prefix", "value": "" }),
            json!({ "state": "prefix", "value": "a//b" }),
            json!({ "state": "prefix", "value": "a/../b" }),
            json!({ "state": "prefix" }),
            json!({ "state": "bucketRoot", "value": "a" }),
            json!({ "state": "bucketRoot", "path": "a" }),
            json!({ "state": "root" }),
            json!(""),
            json!("a/b"),
        ] {
            assert!(
                serde_json::from_value::<S3KeyPrefix>(damaged.clone()).is_err(),
                "{damaged}"
            );
        }
        assert!(S3KeyPrefixPath::DECL.ends_with("export type S3KeyPrefixPath = string;"));
        Ok(())
    }

    #[test]
    fn a_prefix_places_keys_and_labels_below_it() -> anyhow::Result<()> {
        let team = prefix("vaults/team")?;
        assert_eq!(team.below("nook-dev"), "nook-dev/vaults/team");
        assert_eq!(
            team.key_of("meta-secret-nook/x"),
            "vaults/team/meta-secret-nook/x"
        );
        assert_eq!(S3KeyPrefix::BucketRoot.below("nook-dev"), "nook-dev");
        assert_eq!(
            S3KeyPrefix::BucketRoot.key_of("meta-secret-nook/x"),
            "meta-secret-nook/x"
        );
        Ok(())
    }
}
