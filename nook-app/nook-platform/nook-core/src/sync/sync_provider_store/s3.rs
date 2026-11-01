#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The S3 block of a stored provider row and what the store derives from it.
//!
//! The block holds one [`S3Connection`]: the location and this device's access
//! key. The secret access key is sealed to the device key at rest exactly like
//! `githubPat`; while the row is open in memory it holds the plaintext, which
//! only its storage connection and a credential-bearing invite ever carry
//! onward.

use nook_event_log::{IdentityMountTarget, S3MountTarget};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{S3Connection, S3EnrollmentConnection};

impl S3Connection {
    /// Where the row's objects live, as its label shows it: the bucket and
    /// the key prefix below it.
    #[must_use]
    pub fn location_label(&self) -> String {
        self.key_prefix.below(&self.bucket)
    }

    /// The row's detail line: the host it talks to and the key it uses.
    #[must_use]
    pub fn storage_detail(&self) -> String {
        let host = self
            .endpoint
            .split_once("://")
            .map_or(self.endpoint.as_str(), |(_, host)| host);
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
}

/// The S3 block of a stored provider row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "config", rename_all = "camelCase")]
pub enum StoredS3Configuration {
    #[default]
    NotApplicable,
    Configured(S3Connection),
}

#[cfg(test)]
mod tests {
    use super::StoredS3Configuration;
    use crate::S3Connection;
    use serde_json::json;

    const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";
    const SEALED: &str =
        "-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n-----END AGE ENCRYPTED FILE-----\n";

    fn stored(bucket: &str, secret: &str) -> serde_json::Value {
        json!({
            "state": "configured",
            "config": {
                "endpoint": "http://127.0.0.1:8333",
                "region": "us-east-1",
                "bucket": bucket,
                "keyPrefix": { "state": "prefix", "value": "e2e/run-1" },
                "accessKeyId": "device-a",
                "secretAccessKey": secret,
            }
        })
    }

    #[test]
    fn the_block_crosses_the_wire_tagged_camel_cased_and_validated() -> anyhow::Result<()> {
        let block = StoredS3Configuration::Configured(S3Connection::fixture()?);
        assert_eq!(serde_json::to_value(&block)?, stored("nook-dev", SECRET));
        assert_eq!(
            serde_json::from_value::<StoredS3Configuration>(stored("nook-dev", SECRET))?,
            block
        );
        assert_eq!(
            serde_json::to_value(StoredS3Configuration::NotApplicable)?,
            json!({ "state": "notApplicable" })
        );
        // Reading a row back validates it as the setup form does.
        for rejected in [stored("nook/dev", SECRET), stored("nook-dev", "")] {
            assert!(serde_json::from_value::<StoredS3Configuration>(rejected).is_err());
        }
        Ok(())
    }

    #[test]
    fn a_row_at_rest_reads_back_with_its_sealed_secret_unchanged() -> anyhow::Result<()> {
        let sealed = serde_json::from_value::<StoredS3Configuration>(stored("nook-dev", SEALED))?;
        let StoredS3Configuration::Configured(connection) = &sealed else {
            anyhow::bail!("a sealed row keeps its S3 block");
        };
        assert_eq!(connection.secret_access_key.expose(), SEALED);
        assert_eq!(serde_json::to_value(&sealed)?, stored("nook-dev", SEALED));
        Ok(())
    }
}
