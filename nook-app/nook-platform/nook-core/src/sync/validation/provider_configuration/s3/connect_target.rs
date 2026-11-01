#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The S3 connection as the positional connect arguments carry it.
//!
//! Remote providers cross the WASM boundary as `{ mode, pat, repo }`. An S3
//! connection uses `mode = "s3"`, its secret access key in the credential
//! slot (`pat`), where the GitHub token goes, and a versioned reference in the
//! reference slot (`repo`): `s3-target-v1:` followed by JSON naming the
//! endpoint, region, bucket, key prefix, and access key id. The reference
//! never holds the secret, so a log line, cache key, or error carrying it
//! carries no credential.

use serde::{Deserialize, Serialize};

use super::{S3Connection, S3ConnectionDraft};
use crate::errors::{ValidationError, ValidationResult};

/// Version tag of the only S3 reference shape so far.
pub const S3_CONNECT_TARGET_V1_PREFIX: &str = "s3-target-v1:";

/// The JSON after the version tag. Every field is validated again when a
/// reference is read back.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct S3ConnectTargetV1 {
    endpoint: String,
    region: String,
    bucket: String,
    key_prefix: String,
    access_key_id: String,
}

/// The reference slot of an S3 connection's connect arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ConnectReference(String);

impl S3ConnectReference {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(reference) = self;
        reference
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        let Self(reference) = self;
        reference
    }
}

/// The two S3 slots of the positional connect arguments.
#[derive(Clone, Copy)]
pub struct S3ConnectSlots<'a> {
    /// The secret access key (`pat`).
    pub credential: &'a str,
    /// The `s3-target-v1:` reference (`repo`).
    pub reference: &'a str,
}

impl S3Connection {
    /// The reference slot for this connection: its location and key id.
    pub fn connect_reference(&self) -> ValidationResult<S3ConnectReference> {
        let target = S3ConnectTargetV1 {
            endpoint: self.endpoint.clone(),
            region: self.region.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
            access_key_id: self.access_key_id.clone(),
        };
        serde_json::to_string(&target)
            .map(|json| S3ConnectReference(format!("{S3_CONNECT_TARGET_V1_PREFIX}{json}")))
            .map_err(|_| ValidationError::S3StorageTargetInvalid)
    }

    /// Read a connection back from its connect arguments. A reference that is
    /// not exactly the current version is not one; its fields and the secret
    /// are validated as the setup form validates them.
    pub fn from_connect_slots(slots: S3ConnectSlots<'_>) -> ValidationResult<Self> {
        let Some(json) = slots
            .reference
            .trim()
            .strip_prefix(S3_CONNECT_TARGET_V1_PREFIX)
        else {
            return Err(ValidationError::S3StorageTargetInvalid);
        };
        let target: S3ConnectTargetV1 =
            serde_json::from_str(json).map_err(|_| ValidationError::S3StorageTargetInvalid)?;
        Self::try_from(S3ConnectionDraft {
            endpoint: target.endpoint,
            region: target.region,
            bucket: target.bucket,
            key_prefix: target.key_prefix,
            access_key_id: target.access_key_id,
            secret_access_key: slots.credential.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{S3_CONNECT_TARGET_V1_PREFIX, S3ConnectSlots};
    use crate::S3Connection;
    use crate::errors::ValidationError;

    const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";

    #[test]
    fn the_reference_names_the_location_and_key_id_but_never_the_secret() -> anyhow::Result<()> {
        let connection = S3Connection::fixture()?;
        let reference = connection.connect_reference()?;
        assert_eq!(
            reference.as_str(),
            concat!(
                "s3-target-v1:",
                r#"{"endpoint":"http://127.0.0.1:8333","region":"us-east-1","bucket":"nook-dev","#,
                r#""keyPrefix":"e2e/run-1","accessKeyId":"device-a"}"#
            )
        );
        assert!(!reference.as_str().contains(SECRET));

        let read = S3Connection::from_connect_slots(S3ConnectSlots {
            credential: SECRET,
            reference: reference.as_str(),
        })?;
        assert_eq!(read, connection);
        Ok(())
    }

    #[test]
    fn damaged_or_foreign_references_reject_the_connection() -> anyhow::Result<()> {
        let reference = S3Connection::fixture()?.connect_reference()?;
        let body = reference
            .as_str()
            .strip_prefix(S3_CONNECT_TARGET_V1_PREFIX)
            .unwrap_or_default();
        for damaged in [
            String::new(),
            body.to_owned(),
            format!("s3-target-v2:{body}"),
            format!("{S3_CONNECT_TARGET_V1_PREFIX}{{}}"),
            reference.as_str().replace(
                "\"accessKeyId\"",
                "\"secretAccessKey\":\"x\",\"accessKeyId\"",
            ),
        ] {
            assert_eq!(
                S3Connection::from_connect_slots(S3ConnectSlots {
                    credential: SECRET,
                    reference: &damaged,
                })
                .err(),
                Some(ValidationError::S3StorageTargetInvalid),
                "{damaged}"
            );
        }
        // Its fields and the credential are validated again.
        for (credential, reference, error) in [
            (
                SECRET,
                reference
                    .as_str()
                    .replace("http://127.0.0.1", "http://10.0.0.1"),
                ValidationError::S3EndpointInsecure,
            ),
            (
                "",
                reference.as_str().to_owned(),
                ValidationError::S3SecretAccessKeyRequired,
            ),
        ] {
            assert_eq!(
                S3Connection::from_connect_slots(S3ConnectSlots {
                    credential,
                    reference: &reference,
                })
                .err(),
                Some(error)
            );
        }
        Ok(())
    }
}
