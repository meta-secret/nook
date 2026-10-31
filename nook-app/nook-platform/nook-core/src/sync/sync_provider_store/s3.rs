#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The S3 block of a stored provider row and what the store derives from it.
//!
//! The block holds the location (endpoint, region, bucket, key prefix) and
//! this device's access key. The secret access key is sealed to the device
//! key at rest exactly like `githubPat`; while the row is open in memory it
//! holds the plaintext, which only the connect arguments' credential slot and
//! a credential-bearing invite ever carry onward.

use std::fmt;

use nook_event_log::IdentityMountTarget;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use zeroize::Zeroize;

use super::{StorageConnectArgs, ValidationError, ValidationResult};
use crate::{
    EnrollmentProviderSecret, S3AccessKeyId, S3BucketName, S3Connection, S3Credentials, S3Endpoint,
    S3EnrollmentConnection, S3KeyPrefix, S3Location, S3Region, S3SecretAccessKey, StorageMode,
};

/// The stored text of a secret access key: the plaintext while the row is
/// open, age armor sealed to a device key at rest. Never empty, redacted in
/// `Debug`, and wiped when dropped.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(type = "string")]
#[serde(try_from = "String")]
pub struct StoredS3SecretAccessKey(String);

impl StoredS3SecretAccessKey {
    /// The stored text, for the sealing transitions and the connect slot.
    pub(crate) fn text(&self) -> &str {
        let Self(text) = self;
        text
    }

    /// Text a sealing transition produced: armor when sealing, the opened
    /// plaintext when opening. Transitions never produce empty text.
    pub(crate) fn transitioned(text: String) -> Self {
        Self(text)
    }
}

impl From<&S3SecretAccessKey> for StoredS3SecretAccessKey {
    fn from(secret: &S3SecretAccessKey) -> Self {
        Self(secret.expose().to_owned())
    }
}

impl TryFrom<String> for StoredS3SecretAccessKey {
    type Error = ValidationError;
    fn try_from(text: String) -> ValidationResult<Self> {
        match text.len() {
            0 => Err(ValidationError::S3SecretAccessKeyRequired),
            _ => Ok(Self(text)),
        }
    }
}

impl fmt::Debug for StoredS3SecretAccessKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StoredS3SecretAccessKey([redacted])")
    }
}

impl Zeroize for StoredS3SecretAccessKey {
    fn zeroize(&mut self) {
        let Self(text) = self;
        text.zeroize();
    }
}

impl Drop for StoredS3SecretAccessKey {
    fn drop(&mut self) {
        self.zeroize();
    }
}

/// The secret as typed into the setup form. Redacted in `Debug` and wiped
/// when dropped; it becomes a [`S3SecretAccessKey`] only through validation.
#[derive(Clone, PartialEq, Eq, Deserialize, Tsify)]
#[tsify(type = "string")]
#[serde(from = "String")]
pub struct S3SecretAccessKeyInput(String);

impl From<String> for S3SecretAccessKeyInput {
    fn from(text: String) -> Self {
        Self(text)
    }
}

impl fmt::Debug for S3SecretAccessKeyInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("S3SecretAccessKeyInput([redacted])")
    }
}

impl Drop for S3SecretAccessKeyInput {
    fn drop(&mut self) {
        let Self(text) = self;
        text.zeroize();
    }
}

/// What the S3 setup form holds, field by field, before validation.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct S3ConnectionDraft {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    /// Empty for the bucket root.
    pub key_prefix: String,
    pub access_key_id: String,
    pub secret_access_key: S3SecretAccessKeyInput,
}

/// A validated S3 connection as a provider row stores it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct S3ProviderConfig {
    pub endpoint: S3Endpoint,
    pub region: S3Region,
    pub bucket: S3BucketName,
    /// `""` for the bucket root.
    pub key_prefix: S3KeyPrefix,
    pub access_key_id: S3AccessKeyId,
    pub secret_access_key: StoredS3SecretAccessKey,
}

/// One field of the S3 setup form.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum S3DraftField {
    Endpoint,
    Region,
    Bucket,
    KeyPrefix,
    AccessKeyId,
    SecretAccessKey,
}

/// A field the form must correct, and the translation key saying why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct S3DraftFieldError {
    pub field: S3DraftField,
    pub error_key: String,
}

/// What validating the whole form found.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum S3DraftValidation {
    /// Every field is valid: the block a new S3 row is saved with, and the
    /// source that reads the location before it is saved.
    Valid { configuration: S3ProviderConfig },
    /// Every wrong field once, in form order.
    Invalid { fields: Vec<S3DraftFieldError> },
}

impl S3DraftField {
    /// This field's error, when its value does not parse.
    fn errors<T>(self, parsed: ValidationResult<T>) -> Vec<S3DraftFieldError> {
        match parsed {
            Ok(_) => Vec::new(),
            Err(error) => vec![S3DraftFieldError {
                field: self,
                error_key: error.to_string(),
            }],
        }
    }
}

impl S3ConnectionDraft {
    /// Validate every field, so the form can mark each wrong one at once.
    #[must_use]
    pub fn validate(self) -> S3DraftValidation {
        let S3SecretAccessKeyInput(secret) = &self.secret_access_key;
        let fields = [
            S3DraftField::Endpoint.errors(S3Endpoint::parse(&self.endpoint)),
            S3DraftField::Region.errors(S3Region::parse(&self.region)),
            S3DraftField::Bucket.errors(S3BucketName::parse(&self.bucket)),
            S3DraftField::KeyPrefix.errors(S3KeyPrefix::parse(&self.key_prefix)),
            S3DraftField::AccessKeyId.errors(S3AccessKeyId::parse(&self.access_key_id)),
            S3DraftField::SecretAccessKey.errors(S3SecretAccessKey::parse(secret)),
        ]
        .into_iter()
        .flatten()
        .collect();
        match S3ProviderConfig::try_from(self) {
            Ok(configuration) => S3DraftValidation::Valid { configuration },
            Err(_) => S3DraftValidation::Invalid { fields },
        }
    }
}

/// Validate the form in its field order, so the first wrong field is the
/// one reported.
impl TryFrom<S3ConnectionDraft> for S3ProviderConfig {
    type Error = ValidationError;
    fn try_from(draft: S3ConnectionDraft) -> ValidationResult<Self> {
        let endpoint = S3Endpoint::parse(&draft.endpoint)?;
        let region = S3Region::parse(&draft.region)?;
        let bucket = S3BucketName::parse(&draft.bucket)?;
        let key_prefix = S3KeyPrefix::parse(&draft.key_prefix)?;
        let access_key_id = S3AccessKeyId::parse(&draft.access_key_id)?;
        let S3SecretAccessKeyInput(secret) = &draft.secret_access_key;
        let secret = S3SecretAccessKey::parse(secret)?;
        Ok(Self {
            endpoint,
            region,
            bucket,
            key_prefix,
            access_key_id,
            secret_access_key: StoredS3SecretAccessKey::from(&secret),
        })
    }
}

impl S3ProviderConfig {
    #[must_use]
    pub fn location(&self) -> S3Location {
        S3Location {
            endpoint: self.endpoint.clone(),
            region: self.region.clone(),
            bucket: self.bucket.clone(),
            key_prefix: self.key_prefix.clone(),
        }
    }

    /// The connection a request signs with. A row whose secret is still
    /// sealed, or otherwise not a well-formed secret, has none.
    pub fn connection(&self) -> ValidationResult<S3Connection> {
        Ok(S3Connection {
            location: self.location(),
            credentials: S3Credentials {
                access_key_id: self.access_key_id.clone(),
                secret_access_key: S3SecretAccessKey::parse(self.secret_access_key.text())?,
            },
        })
    }

    /// Positional connect arguments: `s3`, the secret, and the versioned
    /// reference that names everything else.
    pub fn connect_args(&self) -> ValidationResult<StorageConnectArgs> {
        let connection = self.connection()?;
        let reference = connection.connect_reference()?;
        Ok(StorageConnectArgs {
            mode: StorageMode::S3.as_str().to_owned(),
            pat: connection.credentials.secret_access_key.expose().to_owned(),
            repo: reference.into_inner(),
        })
    }

    /// Where the row's objects live, as its label shows it: the bucket and
    /// the key prefix below it.
    #[must_use]
    pub fn location_label(&self) -> String {
        match &self.key_prefix {
            S3KeyPrefix::BucketRoot => self.bucket.to_string(),
            S3KeyPrefix::Folder(path) => format!("{}/{path}", self.bucket),
        }
    }

    /// The row's detail line: the host it talks to and the key it uses.
    #[must_use]
    pub fn storage_detail(&self) -> String {
        format!("{} · {}", self.endpoint.host_header(), self.access_key_id)
    }

    /// The connection a credential-bearing invite carries: all of it, the
    /// plaintext secret included, encrypted by the invite's passphrase as the
    /// GitHub token is. A row whose secret is still sealed has none to give.
    pub fn enrollment_connection(&self) -> ValidationResult<S3EnrollmentConnection> {
        let S3Connection {
            location,
            credentials,
        } = self.connection()?;
        Ok(S3EnrollmentConnection {
            endpoint: location.endpoint.to_string(),
            region: location.region.to_string(),
            bucket: location.bucket.to_string(),
            key_prefix: location.key_prefix.to_string(),
            access_key_id: credentials.access_key_id.to_string(),
            secret_access_key: EnrollmentProviderSecret::from(
                credentials.secret_access_key.expose().to_owned(),
            ),
        })
    }

    /// The credential-free mount record of this location.
    #[must_use]
    pub fn mount_target(&self) -> IdentityMountTarget {
        IdentityMountTarget::S3 {
            endpoint: self.endpoint.to_string(),
            region: self.region.to_string(),
            bucket: self.bucket.to_string(),
            key_prefix: self.key_prefix.to_string(),
        }
    }
}

/// The S3 block of a stored provider row.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "config", rename_all = "camelCase")]
pub enum StoredS3Configuration {
    #[default]
    NotApplicable,
    Configured(S3ProviderConfig),
}

impl StoredS3Configuration {
    /// Connect arguments of an S3 row. A row without its S3 block cannot
    /// connect.
    pub fn connect_args(&self) -> ValidationResult<StorageConnectArgs> {
        match self {
            Self::Configured(config) => config.connect_args(),
            Self::NotApplicable => Err(ValidationError::S3StorageTargetInvalid),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        S3ConnectionDraft, S3DraftField, S3DraftFieldError, S3DraftValidation, S3ProviderConfig,
        S3SecretAccessKeyInput, StoredS3Configuration, StoredS3SecretAccessKey,
    };
    use crate::errors::ValidationError;
    use crate::{IdentityMountTarget, S3_CONNECT_TARGET_V1_PREFIX, S3ConnectSlots, S3Connection};
    use serde_json::json;

    const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";

    impl S3ConnectionDraft {
        pub(crate) fn fixture() -> Self {
            Self {
                endpoint: " http://127.0.0.1:8333/ ".to_owned(),
                region: "us-east-1".to_owned(),
                bucket: "nook-dev".to_owned(),
                key_prefix: "e2e/run-1/".to_owned(),
                access_key_id: "device-a".to_owned(),
                secret_access_key: S3SecretAccessKeyInput::from(SECRET.to_owned()),
            }
        }
    }

    impl S3ProviderConfig {
        pub(crate) fn fixture() -> anyhow::Result<Self> {
            Ok(Self::try_from(S3ConnectionDraft::fixture())?)
        }
    }

    #[test]
    fn a_draft_reports_every_wrong_field_once_in_form_order() -> anyhow::Result<()> {
        let valid = S3ConnectionDraft::fixture().validate();
        assert_eq!(
            valid,
            S3DraftValidation::Valid {
                configuration: S3ProviderConfig::fixture()?
            }
        );
        assert_eq!(
            serde_json::to_value(&valid)?.get("state"),
            Some(&json!("valid"))
        );
        let invalid = S3ConnectionDraft {
            endpoint: "http://s3.example.com".to_owned(),
            region: String::new(),
            bucket: "nook-dev".to_owned(),
            key_prefix: "team/../other".to_owned(),
            access_key_id: "device-a".to_owned(),
            secret_access_key: S3SecretAccessKeyInput::from(String::new()),
        }
        .validate();
        let field = |field, error: ValidationError| S3DraftFieldError {
            field,
            error_key: error.to_string(),
        };
        assert_eq!(
            invalid,
            S3DraftValidation::Invalid {
                fields: vec![
                    field(S3DraftField::Endpoint, ValidationError::S3EndpointInsecure),
                    field(S3DraftField::Region, ValidationError::S3RegionRequired),
                    field(S3DraftField::KeyPrefix, ValidationError::S3KeyPrefixInvalid),
                    field(
                        S3DraftField::SecretAccessKey,
                        ValidationError::S3SecretAccessKeyRequired
                    ),
                ]
            }
        );
        assert_eq!(
            serde_json::to_value(&invalid)?,
            json!({
                "state": "invalid",
                "fields": [
                    { "field": "endpoint", "errorKey": ValidationError::S3EndpointInsecure.to_string() },
                    { "field": "region", "errorKey": ValidationError::S3RegionRequired.to_string() },
                    { "field": "keyPrefix", "errorKey": ValidationError::S3KeyPrefixInvalid.to_string() },
                    {
                        "field": "secretAccessKey",
                        "errorKey": ValidationError::S3SecretAccessKeyRequired.to_string()
                    },
                ]
            })
        );
        // A wrong field never echoes the secret typed beside it.
        let mut wrong_bucket = S3ConnectionDraft::fixture();
        wrong_bucket.bucket = "Bad_Bucket".to_owned();
        let report = serde_json::to_string(&wrong_bucket.validate())?;
        assert!(!report.contains(SECRET), "{report}");
        Ok(())
    }

    #[test]
    fn a_draft_validates_into_the_stored_block_in_form_order() -> anyhow::Result<()> {
        let config = S3ProviderConfig::fixture()?;
        assert_eq!(config.endpoint.to_string(), "http://127.0.0.1:8333");
        assert_eq!(config.key_prefix.to_string(), "e2e/run-1");
        assert_eq!(config.location_label(), "nook-dev/e2e/run-1");
        assert_eq!(config.storage_detail(), "127.0.0.1:8333 · device-a");

        let mut draft = S3ConnectionDraft::fixture();
        draft.endpoint = "http://s3.example.com".to_owned();
        draft.bucket = "Bad_Bucket".to_owned();
        assert_eq!(
            S3ProviderConfig::try_from(draft),
            Err(ValidationError::S3EndpointInsecure)
        );
        let mut draft = S3ConnectionDraft::fixture();
        draft.secret_access_key = S3SecretAccessKeyInput::from(String::new());
        assert_eq!(
            S3ProviderConfig::try_from(draft),
            Err(ValidationError::S3SecretAccessKeyRequired)
        );
        Ok(())
    }

    #[test]
    fn secrets_stay_out_of_debug_and_the_reference_slot() -> anyhow::Result<()> {
        let config = S3ProviderConfig::fixture()?;
        assert!(!format!("{config:?}").contains(SECRET));
        assert!(!format!("{:?}", S3ConnectionDraft::fixture()).contains(SECRET));

        let args = StoredS3Configuration::Configured(config.clone()).connect_args()?;
        assert_eq!(args.mode, "s3");
        assert_eq!(args.pat, SECRET);
        assert!(args.repo.starts_with(S3_CONNECT_TARGET_V1_PREFIX));
        assert!(!args.repo.contains(SECRET));
        let read = S3Connection::from_connect_slots(S3ConnectSlots {
            credential: &args.pat,
            reference: &args.repo,
        })?;
        assert_eq!(read.location, config.location());
        Ok(())
    }

    #[test]
    fn a_sealed_or_missing_block_has_no_connection() -> anyhow::Result<()> {
        let mut sealed = S3ProviderConfig::fixture()?;
        sealed.secret_access_key = StoredS3SecretAccessKey::transitioned(
            "-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n-----END AGE ENCRYPTED FILE-----\n"
                .to_owned(),
        );
        assert!(matches!(
            StoredS3Configuration::Configured(sealed).connect_args(),
            Err(ValidationError::S3SecretAccessKeyInvalid)
        ));
        assert!(matches!(
            StoredS3Configuration::NotApplicable.connect_args(),
            Err(ValidationError::S3StorageTargetInvalid)
        ));
        Ok(())
    }

    struct StoredBlockWire {
        bucket: &'static str,
        secret: &'static str,
    }

    impl StoredBlockWire {
        fn json(&self) -> serde_json::Value {
            json!({
                "state": "configured",
                "config": {
                    "endpoint": "http://127.0.0.1:8333",
                    "region": "us-east-1",
                    "bucket": self.bucket,
                    "keyPrefix": "e2e/run-1",
                    "accessKeyId": "device-a",
                    "secretAccessKey": self.secret,
                }
            })
        }
    }

    #[test]
    fn the_block_crosses_the_wire_tagged_and_camel_cased() -> anyhow::Result<()> {
        let stored = StoredS3Configuration::Configured(S3ProviderConfig::fixture()?);
        let wire = StoredBlockWire {
            bucket: "nook-dev",
            secret: SECRET,
        }
        .json();
        assert_eq!(serde_json::to_value(&stored)?, wire);
        assert_eq!(
            serde_json::from_value::<StoredS3Configuration>(wire)?,
            stored
        );
        assert_eq!(
            serde_json::to_value(StoredS3Configuration::NotApplicable)?,
            json!({ "state": "notApplicable" })
        );
        for rejected in [
            StoredBlockWire {
                bucket: "Bad_Bucket",
                secret: SECRET,
            },
            StoredBlockWire {
                bucket: "nook-dev",
                secret: "",
            },
        ] {
            assert!(serde_json::from_value::<StoredS3Configuration>(rejected.json()).is_err());
        }
        Ok(())
    }

    #[test]
    fn the_mount_record_names_the_location_and_no_key() -> anyhow::Result<()> {
        assert_eq!(
            S3ProviderConfig::fixture()?.mount_target(),
            IdentityMountTarget::S3 {
                endpoint: "http://127.0.0.1:8333".to_owned(),
                region: "us-east-1".to_owned(),
                bucket: "nook-dev".to_owned(),
                key_prefix: "e2e/run-1".to_owned(),
            }
        );
        Ok(())
    }
}
