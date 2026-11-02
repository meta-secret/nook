#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::ValidationResult;
use crate::{
    GoogleDriveFolderId, ICloudShareTargetId, ProviderDraftGap, ProviderReplicationCapability,
    ProviderSecretText, ReplicationSupport, ReplicationType, S3Connection, StorageMode,
    StorageProvider,
};

/// Where the manager opens a vault: the provider and everything it connects
/// with, validated again when the manager prepares its storage. It crosses
/// the WASM boundary as one value tagged by its [`StorageMode`]; only the
/// token and the S3 connection carry a secret, and both wipe themselves.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "mode",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum StorageConnection {
    /// `IndexedDB` on this device only.
    Local,
    /// A repository of the token's GitHub account.
    Github {
        token: ProviderSecretText,
        repo: String,
    },
    /// The vault's shared Google Drive folder.
    GoogleDrive {
        token: ProviderSecretText,
        folder_id: GoogleDriveFolderId,
    },
    /// The vault's `CloudKit` share, named by its storage id.
    #[serde(rename = "icloud")]
    ICloud {
        token: ProviderSecretText,
        share_target: ICloudShareTargetId,
    },
    /// An S3-compatible location and this device's key.
    S3 { connection: S3Connection },
}

/// Where the manager opens a vault through a draft, or the gap that stops it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum DraftStorageConnection {
    Ready { connection: StorageConnection },
    Incomplete { gap: ProviderDraftGap },
}

/// The remote connection a staged setup can open.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StagedStorageConnection {
    Incomplete,
    Ready(StorageConnection),
}

impl StorageConnection {
    #[must_use]
    pub const fn mode(&self) -> StorageMode {
        match self {
            Self::Local => StorageMode::Local,
            Self::Github { .. } => StorageMode::Github,
            Self::GoogleDrive { .. } => StorageMode::GoogleDrive,
            Self::ICloud { .. } => StorageMode::ICloud,
            Self::S3 { .. } => StorageMode::S3,
        }
    }
}

/// The host's words for a provider list's detail lines.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderStorageDetailLabels {
    pub this_device_desc: String,
    pub google_signed_in: String,
    pub icloud_signed_in: String,
    pub local_folder_needs_reconnect: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderLabelLabels {
    pub this_device: String,
    pub github: String,
    pub local_folder: String,
    pub google_drive: String,
    pub icloud: String,
}

impl StorageProvider {
    /// Where the manager opens a vault through this row.
    #[must_use]
    pub fn storage_connection(&self) -> StorageConnection {
        self.provider.storage_connection()
    }

    #[must_use]
    pub const fn replication_capability(&self) -> ProviderReplicationCapability {
        self.kind().replication_capability()
    }

    /// The row's capability when it supports `replication_type`.
    pub fn validate_replication(
        &self,
        replication_type: ReplicationType,
    ) -> ValidationResult<ProviderReplicationCapability> {
        self.replication_capability().validate(replication_type)
    }

    #[must_use]
    pub const fn replication_support(
        &self,
        replication_type: ReplicationType,
    ) -> ReplicationSupport {
        self.replication_capability().supports(replication_type)
    }
}

#[cfg(test)]
mod tests {
    use super::{ProviderStorageDetailLabels, StorageConnection};
    use crate::{
        GoogleDriveFolderId, ICloudShareTargetId, ProviderSecretText, S3Connection, StorageMode,
        StorageProvider, StoredProvider,
    };
    use serde_json::json;

    impl ProviderStorageDetailLabels {
        pub(crate) fn catalog_fixture() -> Self {
            Self {
                this_device_desc: "This device detail".to_owned(),
                google_signed_in: "Google signed in".to_owned(),
                icloud_signed_in: "iCloud signed in".to_owned(),
                local_folder_needs_reconnect: "Reconnect folder".to_owned(),
            }
        }
    }

    #[test]
    fn each_connection_crosses_the_wire_tagged_by_its_mode() -> anyhow::Result<()> {
        let token = || ProviderSecretText::try_from("TEST-ONLY-token".to_owned());
        let share = ICloudShareTargetId::fixture()?;
        for (connection, mode, wire) in [
            (
                StorageConnection::Local,
                StorageMode::Local,
                json!({ "mode": "local" }),
            ),
            (
                StorageConnection::Github {
                    token: token()?,
                    repo: "nook".to_owned(),
                },
                StorageMode::Github,
                json!({ "mode": "github", "token": "TEST-ONLY-token", "repo": "nook" }),
            ),
            (
                StorageConnection::GoogleDrive {
                    token: token()?,
                    folder_id: GoogleDriveFolderId::parse("folder-1")?,
                },
                StorageMode::GoogleDrive,
                json!({ "mode": "google-drive", "token": "TEST-ONLY-token", "folderId": "folder-1" }),
            ),
            (
                StorageConnection::ICloud {
                    token: token()?,
                    share_target: share.clone(),
                },
                StorageMode::ICloud,
                json!({ "mode": "icloud", "token": "TEST-ONLY-token", "shareTarget": share.as_str() }),
            ),
        ] {
            assert_eq!(connection.mode(), mode);
            assert_eq!(serde_json::to_value(&connection)?, wire);
            assert_eq!(
                serde_json::from_value::<StorageConnection>(wire)?,
                connection
            );
            assert!(!format!("{connection:?}").contains("TEST-ONLY"));
        }
        for damaged in [
            json!({ "mode": "local-folder" }),
            json!({ "mode": "github", "token": " ", "repo": "nook" }),
            json!({ "mode": "google-drive", "token": "t", "folderId": "" }),
            json!({ "mode": "icloud", "token": "t", "shareTarget": "nook-events" }),
            json!({ "mode": "google-drive", "token": "t", "folderId": "f", "fileName": "nook-events" }),
        ] {
            assert!(
                serde_json::from_value::<StorageConnection>(damaged.clone()).is_err(),
                "{damaged}"
            );
        }
        Ok(())
    }

    #[test]
    fn an_s3_connection_carries_its_secret_in_its_own_field_alone() -> anyhow::Result<()> {
        const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";
        let connection = StorageConnection::S3 {
            connection: S3Connection::fixture()?,
        };
        assert_eq!(connection.mode(), StorageMode::S3);
        let wire = serde_json::to_value(&connection)?;
        assert_eq!(
            wire,
            json!({
                "mode": "s3",
                "connection": {
                    "endpoint": "http://127.0.0.1:8333",
                    "region": "us-east-1",
                    "bucket": "nook-dev",
                    "keyPrefix": { "state": "prefix", "value": "e2e/run-1" },
                    "accessKeyId": "device-a",
                    "secretAccessKey": SECRET,
                },
            })
        );
        assert_eq!(wire.to_string().matches(SECRET).count(), 1);
        assert!(!format!("{connection:?}").contains(SECRET));
        // Reading it back validates the location as the setup form does.
        assert_eq!(
            serde_json::from_value::<StorageConnection>(wire.clone())?,
            connection
        );
        let mut damaged = wire;
        if let Some(bucket) = damaged.pointer_mut("/connection/bucket") {
            *bucket = json!("nook/dev");
        }
        assert!(serde_json::from_value::<StorageConnection>(damaged).is_err());
        Ok(())
    }

    #[test]
    fn a_row_connects_through_its_provider() -> anyhow::Result<()> {
        let s3 = StorageProvider::fixture("s3", StoredProvider::s3_fixture()?);
        assert_eq!(
            s3.storage_connection(),
            StorageConnection::S3 {
                connection: S3Connection::fixture()?
            }
        );
        let folder = StorageProvider::fixture("folder", StoredProvider::local_folder_fixture()?);
        assert_eq!(folder.storage_connection(), StorageConnection::Local);
        Ok(())
    }
}
