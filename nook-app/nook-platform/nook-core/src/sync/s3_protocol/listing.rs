#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! `ListObjectsV2`: what a listing asks for and what one page answers.

use quick_xml::de;
use serde::Deserialize;

use super::{S3CommonPrefix, S3ListPrefix, S3ListedObjectKey, S3RequestFailure};

/// Whether a listing stops at the first `/` below its prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum S3ListDepth {
    /// `delimiter=/`: keys directly below the prefix, and each deeper folder
    /// once as a common prefix, as a directory lists its entries.
    DirectChildren,
    /// Every key below the prefix.
    AllDescendants,
}

/// The opaque token S3 returns to continue a truncated listing. It may hold
/// `/`, `+`, and `=`; the query encoding escapes them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ContinuationToken(String);

impl S3ContinuationToken {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(token) = self;
        token
    }
}

/// Which page a listing request asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3ListPage {
    First,
    After(S3ContinuationToken),
}

/// How many keys one page may hold: 1 to 1,000, the S3 maximum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct S3ListPageSize(u16);

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("S3 list pages hold 1 to 1000 keys")]
pub struct S3ListPageSizeOutOfRange;

impl S3ListPageSize {
    pub const MAXIMUM: Self = Self(1000);

    pub(super) fn text(self) -> String {
        let Self(size) = self;
        size.to_string()
    }
}

impl TryFrom<u16> for S3ListPageSize {
    type Error = S3ListPageSizeOutOfRange;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: max-keys is a number in the ListObjectsV2 query"
        )
    )]
    fn try_from(size: u16) -> Result<Self, Self::Error> {
        match size {
            1..=1000 => Ok(Self(size)),
            _ => Err(S3ListPageSizeOutOfRange),
        }
    }
}

/// One `ListObjectsV2` request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ListObjects {
    pub prefix: S3ListPrefix,
    pub depth: S3ListDepth,
    pub page: S3ListPage,
    pub page_size: S3ListPageSize,
}

impl S3ListObjects {
    /// The same listing, continued after a truncated page.
    #[must_use]
    pub fn next_page(self, token: S3ContinuationToken) -> Self {
        Self {
            page: S3ListPage::After(token),
            ..self
        }
    }
}

/// Whether more pages follow this one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum S3ListingContinuation {
    Complete,
    Continues(S3ContinuationToken),
}

/// One page of a `ListObjectsV2` answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ObjectListing {
    pub keys: Vec<S3ListedObjectKey>,
    pub folders: Vec<S3CommonPrefix>,
    pub continuation: S3ListingContinuation,
}

/// `IsTruncated`, named as soon as it is read.
#[derive(Deserialize)]
#[serde(from = "bool")]
enum ListTruncation {
    Complete,
    Truncated,
}

impl From<bool> for ListTruncation {
    #[expect(
        clippy::match_bool,
        reason = "the XML boolean is converted into the named truncation state at the parse boundary"
    )]
    fn from(truncated: bool) -> Self {
        match truncated {
            true => Self::Truncated,
            false => Self::Complete,
        }
    }
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

/// The parts of `ListBucketResult` a listing uses; other elements are skipped.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ListBucketResultXml {
    is_truncated: ListTruncation,
    #[serde(default)]
    next_continuation_token: String,
    #[serde(default)]
    contents: Vec<ListedObjectXml>,
    #[serde(default)]
    common_prefixes: Vec<ListedFolderXml>,
}

impl S3ObjectListing {
    /// Read one page. A body that is not this XML, or a truncated page
    /// without a token to continue it, is malformed.
    pub(super) fn parse(body: &str) -> Result<Self, S3RequestFailure> {
        let page: ListBucketResultXml =
            de::from_str(body).map_err(|_| S3RequestFailure::MalformedResponse)?;
        let continuation = match page.is_truncated {
            ListTruncation::Complete => S3ListingContinuation::Complete,
            ListTruncation::Truncated => match page.next_continuation_token.as_str() {
                "" => return Err(S3RequestFailure::MalformedResponse),
                _ => S3ListingContinuation::Continues(S3ContinuationToken(
                    page.next_continuation_token,
                )),
            },
        };
        Ok(Self {
            keys: page
                .contents
                .into_iter()
                .map(|object| S3ListedObjectKey::from(object.key))
                .collect(),
            folders: page
                .common_prefixes
                .into_iter()
                .map(|folder| S3CommonPrefix::from(folder.prefix))
                .collect(),
            continuation,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        S3ContinuationToken, S3ListDepth, S3ListObjects, S3ListPage, S3ListPageSize,
        S3ListPageSizeOutOfRange, S3ListingContinuation, S3ObjectListing,
    };
    use crate::{S3CommonPrefix, S3KeyPrefix, S3ListedObjectKey, S3RequestFailure};

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

    #[test]
    fn a_page_lists_its_keys_and_folders() -> anyhow::Result<()> {
        let page = S3ObjectListing::parse(SERVER_IDENTITY_FOLDER)?;
        assert_eq!(
            page.keys
                .iter()
                .map(S3ListedObjectKey::as_str)
                .collect::<Vec<_>>(),
            vec!["e2e-run-1/meta-secret-nook/idn_abcdefghijk/identity.yaml"]
        );
        assert_eq!(
            page.folders
                .iter()
                .map(S3CommonPrefix::as_str)
                .collect::<Vec<_>>(),
            vec![
                "e2e-run-1/meta-secret-nook/idn_abcdefghijk/log/",
                "e2e-run-1/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/",
            ]
        );
        assert_eq!(page.continuation, S3ListingContinuation::Complete);
        Ok(())
    }

    #[test]
    fn a_truncated_page_carries_its_continuation_token() -> anyhow::Result<()> {
        let page = S3ObjectListing::parse(TRUNCATED_PAGE)?;
        assert_eq!(page.keys.len(), 2);
        assert!(page.folders.is_empty());
        let S3ListingContinuation::Continues(token) = page.continuation else {
            anyhow::bail!("a truncated page continues");
        };
        assert_eq!(
            token.as_str(),
            "1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM="
        );
        // The namespace declaration is optional.
        let plain =
            TRUNCATED_PAGE.replace(r#" xmlns="http://s3.amazonaws.com/doc/2006-03-01/""#, "");
        assert_eq!(S3ObjectListing::parse(&plain)?.keys.len(), 2);
        Ok(())
    }

    #[test]
    fn a_page_that_cannot_be_read_or_continued_is_malformed() {
        let no_token = TRUNCATED_PAGE.replace(
            "<NextContinuationToken>1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</NextContinuationToken>",
            "",
        );
        for body in [
            no_token.as_str(),
            "",
            "not xml",
            "<ListBucketResult><Name>bucket</Name></ListBucketResult>",
            "<Error><Code>AccessDenied</Code></Error>",
        ] {
            assert_eq!(
                S3ObjectListing::parse(body),
                Err(S3RequestFailure::MalformedResponse),
                "{body}"
            );
        }
    }

    #[test]
    fn a_listing_continues_with_its_token_and_bounded_pages() -> anyhow::Result<()> {
        let listing = S3ListObjects {
            prefix: S3KeyPrefix::BucketRoot.identity_folders_listing(),
            depth: S3ListDepth::DirectChildren,
            page: S3ListPage::First,
            page_size: S3ListPageSize::MAXIMUM,
        };
        let token = S3ContinuationToken("token/+=".to_owned());
        let next = listing.clone().next_page(token.clone());
        assert_eq!(next.page, S3ListPage::After(token));
        assert_eq!(next.prefix, listing.prefix);
        assert_eq!(S3ListPageSize::try_from(1)?.text(), "1");
        for out_of_range in [0, 1001] {
            assert_eq!(
                S3ListPageSize::try_from(out_of_range),
                Err(S3ListPageSizeOutOfRange)
            );
        }
        Ok(())
    }
}
