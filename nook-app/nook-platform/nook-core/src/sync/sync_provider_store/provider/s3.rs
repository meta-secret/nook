#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! An S3 provider row's connection and what the store derives from it.
//!
//! The row holds one [`S3Connection`]: the location and this device's access
//! key. The secret access key is sealed to the device key at rest exactly like
//! a GitHub token; while the row is open in memory it holds the plaintext,
//! which only its storage connection and a credential-bearing invite ever
//! carry onward.

use nook_event_log::{IdentityMountTarget, S3MountTarget};

use crate::{ProviderSecretText, S3Connection, S3EnrollmentConnection};

impl S3Connection {
    /// Where the row's objects live, as its label shows it: the bucket and
    /// the key prefix below it.
    #[must_use]
    pub fn location_label(&self) -> String {
        self.key_prefix.below(&self.bucket)
    }

    /// `S3 · bucket[/prefix]`.
    #[must_use]
    pub fn label(&self) -> String {
        format!("S3 · {}", self.location_label())
    }

    /// The row's detail line: the host it talks to and the key it uses.
    #[must_use]
    pub fn storage_detail(&self) -> String {
        let host = match self.endpoint.split_once("://") {
            Some((_, host)) => host,
            None => self.endpoint.as_str(),
        };
        format!("{host} · {}", self.access_key_id)
    }

    /// The connection a credential-bearing invite carries: all of it, the
    /// plaintext secret included, encrypted by the invite's passphrase as the
    /// GitHub token is.
    #[must_use]
    pub fn enrollment_connection(&self) -> S3EnrollmentConnection {
        S3EnrollmentConnection {
            endpoint: self.endpoint.clone(),
            region: self.region.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
            access_key_id: self.access_key_id.clone(),
            secret_access_key: self.secret_access_key.clone(),
        }
    }

    /// Where the objects live, without the key or the region that reach them.
    #[must_use]
    pub fn mount_location(&self) -> S3MountTarget {
        S3MountTarget {
            endpoint: self.endpoint.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
        }
    }

    /// The credential-free mount record of this location.
    #[must_use]
    pub fn mount_target(&self) -> IdentityMountTarget {
        IdentityMountTarget::S3(self.mount_location())
    }

    pub(crate) fn transition_secrets<E>(
        &self,
        mut transition: impl FnMut(&ProviderSecretText) -> Result<ProviderSecretText, E>,
    ) -> Result<Self, E> {
        Ok(Self {
            endpoint: self.endpoint.clone(),
            region: self.region.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
            access_key_id: self.access_key_id.clone(),
            secret_access_key: transition(&self.secret_access_key)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::{S3Connection, S3KeyPrefix};

    #[test]
    fn an_s3_connection_names_its_label_detail_and_mount() -> anyhow::Result<()> {
        let mut connection = S3Connection::fixture()?;
        assert_eq!(connection.label(), "S3 · nook-dev/e2e/run-1");
        assert_eq!(connection.storage_detail(), "127.0.0.1:8333 · device-a");
        assert_eq!(
            connection.mount_location().location_identity(),
            connection.location_identity()
        );
        connection.key_prefix = S3KeyPrefix::BucketRoot;
        assert_eq!(connection.label(), "S3 · nook-dev");
        assert_eq!(
            connection.enrollment_connection().key_prefix,
            S3KeyPrefix::BucketRoot
        );
        Ok(())
    }
}
