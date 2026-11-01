#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The S3 protocol of an S3 provider, without I/O.
//!
//! A host sends what this module builds and hands back what it received:
//!
//! 1. Object keys place each namespace's events at their local-folder paths
//!    below the location's key prefix, and read listed keys and folders back.
//! 2. [`S3RequestSigner`] builds a path-style `GetObject`, create-only
//!    `PutObject`, `DeleteObject`, or `ListObjectsV2` request, signed with
//!    AWS Signature Version 4 at the instant the host's clock supplies.
//! 3. The host returns the status and body as an [`S3Response`], which
//!    classifies them for the request that received them.
//!
//! A create-only write whose key is taken reads the key back and settles with
//! [`S3ExistingEvent`]. Every refusal of the key surfaces as
//! [`S3RequestFailure::KeyAccessDenied`].

mod classification;
mod object_keys;
mod request;

pub use classification::{
    S3ExistingEvent, S3ListingContinuation, S3ObjectDeletion, S3ObjectListing, S3ObjectRead,
    S3ObjectWrite, S3RequestFailure, S3Response,
};
pub use object_keys::{
    S3EventAddress, S3IdentityFolder, S3ListedEvent, S3ListedKey, S3ListedNamespace,
};
pub use request::{
    S3HttpRequest, S3ListObjects, S3ListPage, S3ObjectUpload, S3RequestSigner, S3SigningError,
};
