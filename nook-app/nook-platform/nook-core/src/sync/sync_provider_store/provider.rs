#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The provider a stored row names, with exactly its own settings and
//! credentials.
//!
//! A row is saved only once its provider is complete: a Google Drive row has
//! its folder, an iCloud row its share, every remote row its credential. The
//! stages before that live in the [`crate::ProviderDraft`].

use nook_event_log::IdentityMountTarget;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    IdentityMountCapability, ProviderKind, ProviderSecretText, ProviderStorageDetailLabels,
    ProviderTargetKey, S3Connection, StorageConnection, StoredGithubRepository,
};

mod github;
mod local_folder;
mod oauth_file;
mod s3;

pub use github::GithubProvider;
pub use local_folder::{LocalFolderHandleId, LocalFolderName, LocalFolderProvider};
pub use oauth_file::{
    GoogleDriveAuthorization, GoogleDriveProvider, ICloudProvider, OAuthFileProvider,
};

/// The provider of one stored row, tagged by its `type`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum StoredProvider {
    /// This browser's own store. The braces make a row carrying another
    /// provider's field fail to decode.
    Local {},
    LocalFolder(LocalFolderProvider),
    Github(GithubProvider),
    OauthFile(OAuthFileProvider),
    S3(S3Connection),
}

impl ProviderKind {
    /// The label a row of this kind takes from a detail the host names: a
    /// folder name, a repository, or an S3 location. An OAuth row takes its
    /// preset's name.
    #[must_use]
    pub fn label_with_detail(self, detail: &str) -> String {
        match self {
            Self::Local => "This device".to_owned(),
            Self::LocalFolder => LocalFolderName::from(detail.to_owned()).label(),
            Self::Github => StoredGithubRepository::Repository(detail.to_owned()).label(),
            Self::OauthFile(preset) => preset.provider_label().to_owned(),
            Self::S3 => match detail.trim() {
                "" => "S3".to_owned(),
                location => format!("S3 · {location}"),
            },
        }
    }

    /// The label of a row of this kind before any detail is known.
    #[must_use]
    pub fn bare_label(self) -> String {
        self.label_with_detail("")
    }
}

impl StoredProvider {
    #[must_use]
    pub const fn kind(&self) -> ProviderKind {
        match self {
            Self::Local {} => ProviderKind::Local,
            Self::LocalFolder(_) => ProviderKind::LocalFolder,
            Self::Github(_) => ProviderKind::Github,
            Self::OauthFile(oauth) => ProviderKind::OauthFile(oauth.preset()),
            Self::S3(_) => ProviderKind::S3,
        }
    }

    /// The label a new row of this provider takes.
    #[must_use]
    pub fn label(&self) -> String {
        match self {
            Self::Local {} => "This device".to_owned(),
            Self::LocalFolder(folder) => folder.directory_name.label(),
            Self::Github(github) => github.repository.label(),
            Self::OauthFile(oauth) => oauth.preset().provider_label().to_owned(),
            Self::S3(connection) => connection.label(),
        }
    }

    /// Where the manager opens a vault through this provider. A local folder
    /// syncs beside this browser's store, which the manager opens.
    #[must_use]
    pub fn storage_connection(&self) -> StorageConnection {
        match self {
            Self::Local {} | Self::LocalFolder(_) => StorageConnection::Local,
            Self::Github(github) => github.storage_connection(),
            Self::OauthFile(oauth) => oauth.storage_connection(),
            Self::S3(connection) => StorageConnection::S3 {
                connection: connection.clone(),
            },
        }
    }

    /// Every remote provider mounts the identity; this browser's store
    /// stays here.
    #[must_use]
    pub fn identity_mount_capability(&self) -> IdentityMountCapability {
        match self {
            Self::Local {} => IdentityMountCapability::LocalOnly,
            Self::LocalFolder(folder) => {
                IdentityMountCapability::Mountable(IdentityMountTarget::LocalFolder {
                    directory_name: folder.directory_name.as_str().to_owned(),
                })
            }
            Self::Github(github) => IdentityMountCapability::Mountable(github.mount_target()),
            Self::OauthFile(oauth) => IdentityMountCapability::Mountable(oauth.mount_target()),
            // Every device of the identity reaches the bucket with its own key.
            Self::S3(connection) => IdentityMountCapability::Mountable(connection.mount_target()),
        }
    }

    /// The duplicate-detection key: rows with the same key reach the same
    /// storage with the same credential.
    #[must_use]
    pub fn target_key(&self) -> ProviderTargetKey {
        match self {
            Self::Local {} => "local".to_owned().into(),
            Self::LocalFolder(folder) => {
                format!("local-folder:{}", folder.handle_id.as_str()).into()
            }
            Self::Github(github) => github.target_key(),
            Self::OauthFile(oauth) => oauth.target_key(),
            Self::S3(connection) => format!("s3:{}", connection.location_identity()).into(),
        }
    }

    /// The detail line a provider list shows under the label.
    #[must_use]
    pub fn storage_detail(&self, labels: &ProviderStorageDetailLabels) -> String {
        match self {
            Self::Local {} => labels.this_device_desc.clone(),
            Self::LocalFolder(folder) => {
                folder.storage_detail(&labels.local_folder_needs_reconnect)
            }
            Self::Github(github) => github.storage_detail(),
            Self::OauthFile(oauth) => oauth.storage_detail(labels),
            Self::S3(connection) => connection.storage_detail(),
        }
    }

    /// Every credential this provider holds: none for this browser's store
    /// or a local folder, the token for GitHub, the access token for Google
    /// Drive, the web-auth token for iCloud, the secret access key for S3.
    /// Sealing, opening, the storage admission check, and pairing
    /// authentication walk this list; no other code names a credential field.
    #[must_use]
    pub fn secrets(&self) -> Vec<&ProviderSecretText> {
        match self {
            Self::Local {} | Self::LocalFolder(_) => Vec::new(),
            Self::Github(github) => vec![&github.token],
            Self::OauthFile(oauth) => vec![oauth.token()],
            Self::S3(connection) => vec![&connection.secret_access_key],
        }
    }

    /// The same provider with each credential replaced by what `transition`
    /// makes of it, in [`Self::secrets`] order. Nothing changes when a
    /// replacement fails: the caller keeps the original.
    pub fn transition_secrets<E>(
        &self,
        transition: impl FnMut(&ProviderSecretText) -> Result<ProviderSecretText, E>,
    ) -> Result<Self, E> {
        Ok(match self {
            Self::Local {} => Self::Local {},
            Self::LocalFolder(folder) => Self::LocalFolder(folder.clone()),
            Self::Github(github) => Self::Github(github.transition_secrets(transition)?),
            Self::OauthFile(oauth) => Self::OauthFile(oauth.transition_secrets(transition)?),
            Self::S3(connection) => Self::S3(connection.transition_secrets(transition)?),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{GithubProvider, LocalFolderProvider, OAuthFileProvider, StoredProvider};
    use crate::{
        IdentityMountCapability, OAuthAccountIdentity, OAuthFilePreset, ProviderKind,
        ProviderSecretText, ProviderStorageDetailLabels, S3Connection, StorageConnection,
    };
    use serde_json::json;
    use std::convert::Infallible;
    use zeroize::{Zeroize, ZeroizeOnDrop};

    impl StoredProvider {
        pub(crate) fn local_folder_fixture() -> anyhow::Result<Self> {
            Ok(Self::LocalFolder(LocalFolderProvider::fixture(
                "Nook Backup",
                "handle-1",
            )?))
        }

        pub(crate) fn github_fixture() -> anyhow::Result<Self> {
            Ok(Self::Github(GithubProvider::fixture(
                "team-vault",
                "github_pat_11TESTONLYNOTREAL",
            )?))
        }

        pub(crate) fn google_drive_fixture() -> anyhow::Result<Self> {
            Ok(Self::OauthFile(OAuthFileProvider::google_drive_fixture(
                "folder-1",
                OAuthAccountIdentity::Email("owner@example.com".to_owned()),
            )?))
        }

        pub(crate) fn icloud_fixture() -> anyhow::Result<Self> {
            Ok(Self::OauthFile(OAuthFileProvider::icloud_fixture(
                OAuthAccountIdentity::Email("member@icloud.com".to_owned()),
            )?))
        }

        pub(crate) fn s3_fixture() -> anyhow::Result<Self> {
            Ok(Self::S3(S3Connection::fixture()?))
        }

        /// Every provider, one of each variant.
        pub(crate) fn every_fixture() -> anyhow::Result<[Self; 6]> {
            Ok([
                Self::Local {},
                Self::local_folder_fixture()?,
                Self::github_fixture()?,
                Self::google_drive_fixture()?,
                Self::icloud_fixture()?,
                Self::s3_fixture()?,
            ])
        }
    }

    struct WipedOnDrop;
    impl WipedOnDrop {
        /// Compiles only for a type that wipes itself when dropped.
        const fn check<T: ZeroizeOnDrop>() {}
    }

    #[test]
    fn every_provider_round_trips_tagged_by_its_type() -> anyhow::Result<()> {
        for provider in StoredProvider::every_fixture()? {
            let wire = serde_json::to_value(&provider)?;
            assert_eq!(
                wire.get("type"),
                Some(&json!(match provider.kind() {
                    ProviderKind::Local => "local",
                    ProviderKind::LocalFolder => "local-folder",
                    ProviderKind::Github => "github",
                    ProviderKind::OauthFile(_) => "oauth-file",
                    ProviderKind::S3 => "s3",
                }))
            );
            assert_eq!(serde_json::from_value::<StoredProvider>(wire)?, provider);
        }
        assert_eq!(
            serde_json::to_value(StoredProvider::Local {})?,
            json!({ "type": "local" })
        );
        Ok(())
    }

    #[test]
    fn a_provider_with_a_missing_or_foreign_field_is_not_a_provider() -> anyhow::Result<()> {
        for provider in StoredProvider::every_fixture()? {
            let wire = serde_json::to_value(&provider)?;
            let fields: Vec<String> = match wire.as_object() {
                Some(fields) => fields
                    .keys()
                    .filter(|key| *key != "type")
                    .cloned()
                    .collect(),
                None => anyhow::bail!("a provider serializes as an object"),
            };
            for field in fields {
                let mut missing = wire.clone();
                if let Some(object) = missing.as_object_mut() {
                    object.remove(&field);
                }
                assert!(
                    serde_json::from_value::<StoredProvider>(missing).is_err(),
                    "{field}"
                );
            }
            for foreign in [
                "token",
                "secretAccessKey",
                "handleId",
                "folderId",
                "shareTarget",
            ] {
                let mut mixed = wire.clone();
                if let Some(object) = mixed.as_object_mut()
                    && !object.contains_key(foreign)
                {
                    object.insert(foreign.to_owned(), json!("x"));
                    assert!(
                        serde_json::from_value::<StoredProvider>(mixed).is_err(),
                        "{foreign} on {:?}",
                        provider.kind()
                    );
                }
            }
        }
        for unknown in [
            json!({ "type": "dropbox" }),
            json!({ "type": "local", "s3": {} }),
        ] {
            assert!(serde_json::from_value::<StoredProvider>(unknown).is_err());
        }
        let blank_token = json!({
            "type": "github",
            "repository": { "state": "defaultRepository" },
            "token": " ",
        });
        assert!(serde_json::from_value::<StoredProvider>(blank_token).is_err());
        Ok(())
    }

    #[test]
    fn each_provider_names_its_kind_label_connection_and_mount() -> anyhow::Result<()> {
        let labels = ProviderStorageDetailLabels::catalog_fixture();
        let [local, folder, github, drive, icloud, s3] = StoredProvider::every_fixture()?;
        assert_eq!(local.label(), "This device");
        assert_eq!(folder.label(), "Local backup · Nook Backup");
        assert_eq!(github.label(), "GitHub · team-vault");
        assert_eq!(drive.label(), "Google Drive");
        assert_eq!(icloud.label(), "iCloud");
        assert_eq!(s3.label(), "S3 · nook-dev/e2e/run-1");
        assert_eq!(local.storage_detail(&labels), labels.this_device_desc);
        assert_eq!(folder.storage_detail(&labels), "Nook Backup");
        assert_eq!(drive.storage_detail(&labels), "owner@example.com");
        assert_eq!(
            icloud.storage_detail(&labels),
            "nook-events · member@icloud.com"
        );
        assert_eq!(
            drive.kind(),
            ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive)
        );
        assert_eq!(
            icloud.kind(),
            ProviderKind::OauthFile(OAuthFilePreset::ICloud)
        );
        for provider in [&local, &folder] {
            assert_eq!(provider.storage_connection(), StorageConnection::Local);
        }
        assert!(matches!(
            github.storage_connection(),
            StorageConnection::Github { .. }
        ));
        assert!(matches!(
            drive.storage_connection(),
            StorageConnection::GoogleDrive { .. }
        ));
        assert!(matches!(
            icloud.storage_connection(),
            StorageConnection::ICloud { .. }
        ));
        assert!(matches!(
            s3.storage_connection(),
            StorageConnection::S3 { .. }
        ));
        assert_eq!(
            local.identity_mount_capability(),
            IdentityMountCapability::LocalOnly
        );
        for remote in [&folder, &github, &drive, &icloud, &s3] {
            assert!(matches!(
                remote.identity_mount_capability(),
                IdentityMountCapability::Mountable(_)
            ));
        }
        assert_eq!(local.target_key(), "local".to_owned().into());
        assert_eq!(
            folder.target_key(),
            "local-folder:handle-1".to_owned().into()
        );
        assert_eq!(
            s3.target_key(),
            "s3:http://127.0.0.1:8333/nook-dev/e2e/run-1"
                .to_owned()
                .into()
        );
        Ok(())
    }

    #[test]
    fn a_kind_labels_a_row_from_the_detail_the_host_names() {
        for (kind, detail, label) in [
            (ProviderKind::Local, "ignored", "This device"),
            (
                ProviderKind::LocalFolder,
                " Nook Backup ",
                "Local backup · Nook Backup",
            ),
            (ProviderKind::Github, " team-vault ", "GitHub · team-vault"),
            (ProviderKind::Github, "nook", "GitHub"),
            (
                ProviderKind::OauthFile(OAuthFilePreset::ICloud),
                "work.yaml",
                "iCloud",
            ),
            (ProviderKind::S3, " nook-dev/team ", "S3 · nook-dev/team"),
        ] {
            assert_eq!(kind.label_with_detail(detail), label);
        }
        for (kind, label) in [
            (ProviderKind::LocalFolder, "Local backup"),
            (ProviderKind::Github, "GitHub"),
            (
                ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive),
                "Google Drive",
            ),
            (ProviderKind::S3, "S3"),
        ] {
            assert_eq!(kind.bare_label(), label);
        }
    }

    #[test]
    fn the_credential_walk_names_each_secret_once_and_keeps_debug_redacted() -> anyhow::Result<()> {
        WipedOnDrop::check::<ProviderSecretText>();
        for (provider, count) in StoredProvider::every_fixture()?
            .into_iter()
            .zip([0, 0, 1, 1, 1, 1])
        {
            assert_eq!(provider.secrets().len(), count, "{:?}", provider.kind());
            let unchanged =
                provider.transition_secrets(|secret| Ok::<_, Infallible>(secret.clone()));
            assert_eq!(unchanged, Ok(provider.clone()));
            let replaced = provider.transition_secrets(|_| {
                ProviderSecretText::try_from("TEST-ONLY-replaced".to_owned())
            })?;
            for secret in replaced.secrets() {
                assert_eq!(secret.expose(), "TEST-ONLY-replaced");
            }
            for secret in provider.secrets() {
                assert!(!format!("{provider:?}").contains(secret.expose()));
            }
            let mut wiped = provider.secrets().into_iter().cloned().collect::<Vec<_>>();
            for secret in &mut wiped {
                secret.zeroize();
                assert_eq!(secret.expose(), "");
            }
        }
        let failing = StoredProvider::github_fixture()?
            .transition_secrets(|_| Err::<ProviderSecretText, _>("refused"));
        assert_eq!(failing, Err("refused"));
        Ok(())
    }
}
