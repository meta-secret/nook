#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! S3-compatible storage connections, validated where they enter Nook.
//!
//! A connection names where the objects live, its [`S3Location`] (endpoint,
//! region, bucket, key prefix), and the key this device signs with, its
//! [`S3Credentials`]. The location is credential-free and the same on every
//! device of a keyring; each device brings its own key.

use std::fmt;

mod bucket;
mod connect_target;
mod credentials;
mod endpoint;
mod key_prefix;
mod region;

pub use bucket::S3BucketName;
pub use connect_target::{S3_CONNECT_TARGET_V1_PREFIX, S3ConnectReference, S3ConnectSlots};
pub use credentials::{S3AccessKeyId, S3Credentials, S3SecretAccessKey};
pub use endpoint::{S3Endpoint, S3EndpointScheme, S3HostHeader};
pub use key_prefix::{S3KeyPrefix, S3KeyPrefixPath};
pub use region::S3Region;

/// Where an S3 provider keeps its objects. It holds no credential.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct S3Location {
    pub endpoint: S3Endpoint,
    pub region: S3Region,
    pub bucket: S3BucketName,
    pub key_prefix: S3KeyPrefix,
}

/// The identity of a location: `endpoint/bucket[/prefix]`. Rows with the same
/// identity reach the same objects, whatever key or region they sign with.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct S3StorageIdentity(String);

impl S3StorageIdentity {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(identity) = self;
        identity
    }
}

impl fmt::Display for S3StorageIdentity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl S3Location {
    #[must_use]
    pub fn storage_identity(&self) -> S3StorageIdentity {
        S3StorageIdentity(match &self.key_prefix {
            S3KeyPrefix::BucketRoot => format!("{}/{}", self.endpoint, self.bucket),
            S3KeyPrefix::Folder(path) => format!("{}/{}/{path}", self.endpoint, self.bucket),
        })
    }
}

/// One device's validated connection: the location and the key it signs with.
#[derive(Debug, Clone)]
pub struct S3Connection {
    pub location: S3Location,
    pub credentials: S3Credentials,
}

#[cfg(test)]
mod tests {
    use super::{S3BucketName, S3Endpoint, S3KeyPrefix, S3Location, S3Region};

    #[test]
    fn a_location_is_identified_by_endpoint_bucket_and_prefix_alone() -> anyhow::Result<()> {
        let location = S3Location {
            endpoint: S3Endpoint::parse("https://s3.example.com")?,
            region: S3Region::parse("us-east-1")?,
            bucket: S3BucketName::parse("nook-vaults")?,
            key_prefix: S3KeyPrefix::BucketRoot,
        };
        assert_eq!(
            location.storage_identity().as_str(),
            "https://s3.example.com/nook-vaults"
        );
        let elsewhere = S3Location {
            region: S3Region::parse("eu-west-1")?,
            ..location.clone()
        };
        assert_eq!(location.storage_identity(), elsewhere.storage_identity());
        let team = S3Location {
            key_prefix: S3KeyPrefix::parse("team/")?,
            ..location
        };
        assert_eq!(
            team.storage_identity().as_str(),
            "https://s3.example.com/nook-vaults/team"
        );
        Ok(())
    }
}
