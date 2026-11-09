//! The storage a session reads and writes: this browser's own store, or one
//! sync provider prepared with exactly its own credential and target.

use std::cell::RefCell;
use std::collections::BTreeMap;

use nook_core::{
    DriveEventParent, EventLogLocation, EventLogNamespaceKind, GithubRepoName, ICloudShareTargetId,
    ICloudSharedTarget, PlacedNamespace, ProviderSecretText, S3Connection, StorageConnection,
    StorageMode, StoreId, VaultPlacement,
};

use crate::NookError;
use crate::storage::drive_events::DriveEventStore;
use crate::storage::drive_namespace::DriveNamespace;
use crate::storage::event_store::RemoteEventStore;
use crate::storage::github_events::{GitHubEventStore, GitHubRepository};
use crate::storage::icloud::{ICloudEventStore, ICloudLocation};
use crate::storage::opened_location::OpenedLocation;
use crate::storage::provider_vault_listing::DriveVaultListing;
use crate::storage::s3::{S3EventStore, S3Storage, S3VaultListing};
#[cfg(test)]
use crate::test_fixtures::WasmFixture;
use crate::{DriveStorageClient, GitHubStorageClient};
#[cfg(test)]
use nook_core::ValidationError;

/// The storage this session reads and writes.
#[derive(Default)]
pub(in crate::manager) enum PreparedProvider {
    /// This browser's own store; nothing is read from or written to a
    /// provider.
    #[default]
    ThisBrowser,
    Remote(PreparedRemote),
}

/// A prepared sync provider, and where it files each vault.
pub(in crate::manager) struct PreparedRemote {
    provider: RemoteProvider,
    /// The identity folder each vault was found in or filed under here,
    /// learned while this provider stays prepared.
    placements: RefCell<BTreeMap<StoreId, PlacedNamespace>>,
}

/// One remote provider kind, prepared.
pub(in crate::manager) enum RemoteProvider {
    Github(PreparedGithub),
    GoogleDrive(PreparedGoogleDrive),
    ICloud(PreparedICloud),
    S3(PreparedS3),
}

/// A repository reached with this browser's token; the owner is the login
/// GitHub reported for it.
pub(in crate::manager) struct PreparedGithub {
    pub(in crate::manager) token: ProviderSecretText,
    pub(in crate::manager) repository: GithubRepositoryPath,
}

/// The `owner/name` of a GitHub repository: the login GitHub reported and the
/// checked repository name.
pub(in crate::manager) struct GithubRepositoryPath(String);

impl GithubRepositoryPath {
    pub(in crate::manager) fn as_str(&self) -> &str {
        &self.0
    }
}

/// The account's Nook root on Google Drive.
pub(in crate::manager) struct PreparedGoogleDrive {
    pub(in crate::manager) token: ProviderSecretText,
    pub(in crate::manager) root: DriveEventParent,
    /// The Drive folder of each namespace, resolved or created while
    /// prepared.
    folders: RefCell<BTreeMap<PlacedNamespace, DriveEventParent>>,
}

/// The `CloudKit` share this account syncs under.
pub(in crate::manager) struct PreparedICloud {
    pub(in crate::manager) token: ProviderSecretText,
    pub(in crate::manager) share: ICloudSharedTarget,
    /// The share's storage id, which names the local cache.
    target: ICloudShareTargetId,
}

/// An S3 location with this browser's key.
pub(in crate::manager) struct PreparedS3 {
    pub(in crate::manager) connection: S3Connection,
}

/// The credential-free name of the prepared storage. It keys this browser's
/// local vault cache and the outbox rows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::manager) struct ProviderCacheRef(String);

impl ProviderCacheRef {
    pub(in crate::manager) fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether moving from this storage to `next` leaves it.
    pub(in crate::manager) fn switch_to(&self, next: &Self) -> ProviderSwitch {
        if self == next {
            ProviderSwitch::SameStorage
        } else {
            ProviderSwitch::OtherStorage
        }
    }
}

/// Whether preparing a connection moved the session to other storage.
pub(in crate::manager) enum ProviderSwitch {
    SameStorage,
    OtherStorage,
}

/// One connection to prepare, and the channel its progress is reported on.
pub(in crate::manager) struct ProviderPreparation<'a> {
    pub(in crate::manager) connection: &'a StorageConnection,
    pub(in crate::manager) status: &'a flume::Sender<String>,
}

impl PreparedProvider {
    /// Prepare one connection: check what it reaches and build its prepared
    /// form. Nothing is assigned, so a failure leaves the previous provider.
    pub(in crate::manager) async fn prepare(
        preparation: ProviderPreparation<'_>,
    ) -> Result<Self, NookError> {
        let ProviderPreparation { connection, status } = preparation;
        let provider = match connection {
            StorageConnection::Local => return Ok(Self::ThisBrowser),
            StorageConnection::Github { token, repo } => {
                let name = GithubRepoName::parse(repo)?;
                drop(status.send("GITHUB_USER_FETCH".to_owned()));
                let owner = GitHubStorageClient::new(token)?
                    .fetch_github_username()
                    .await?;
                let repository = GithubRepositoryPath(format!("{owner}/{name}"));
                drop(status.send("GITHUB_REPO_ENSURE".to_owned()));
                GitHubStorageClient::new(token)?
                    .ensure_github_repo_exists(repository.as_str())
                    .await?;
                RemoteProvider::Github(PreparedGithub {
                    token: token.clone(),
                    repository,
                })
            }
            StorageConnection::GoogleDrive { token, folder_id } => {
                drop(status.send("DRIVE_VERIFY".to_owned()));
                DriveStorageClient::new(token).verify_drive_access().await?;
                RemoteProvider::GoogleDrive(PreparedGoogleDrive {
                    token: token.clone(),
                    root: DriveEventParent::shared_folder_id(folder_id.as_str()),
                    folders: RefCell::default(),
                })
            }
            StorageConnection::ICloud {
                token,
                share_target,
            } => RemoteProvider::ICloud(PreparedICloud {
                token: token.clone(),
                share: share_target.target()?,
                target: share_target.clone(),
            }),
            StorageConnection::S3 { connection } => RemoteProvider::S3(PreparedS3 {
                connection: connection.clone(),
            }),
        };
        Ok(Self::Remote(PreparedRemote {
            provider,
            placements: RefCell::default(),
        }))
    }

    pub(in crate::manager) fn mode(&self) -> StorageMode {
        match self {
            Self::ThisBrowser => StorageMode::Local,
            Self::Remote(remote) => remote.mode(),
        }
    }

    pub(in crate::manager) fn cache_ref(&self) -> ProviderCacheRef {
        match self {
            Self::ThisBrowser => ProviderCacheRef("local".to_owned()),
            Self::Remote(remote) => remote.cache_ref(),
        }
    }
}

impl PreparedRemote {
    pub(in crate::manager) fn mode(&self) -> StorageMode {
        match &self.provider {
            RemoteProvider::Github(_) => StorageMode::Github,
            RemoteProvider::GoogleDrive(_) => StorageMode::GoogleDrive,
            RemoteProvider::ICloud(_) => StorageMode::ICloud,
            RemoteProvider::S3(_) => StorageMode::S3,
        }
    }

    /// The same names the local vault cache and the outbox rows have always
    /// used; the GitHub form keeps its empty trailing path.
    pub(in crate::manager) fn cache_ref(&self) -> ProviderCacheRef {
        ProviderCacheRef(match &self.provider {
            RemoteProvider::Github(github) => format!("github:{}:", github.repository.as_str()),
            RemoteProvider::GoogleDrive(drive) => format!("drive:{}", drive.root.folder_id),
            RemoteProvider::ICloud(icloud) => format!("icloud:{}", icloud.target.as_str()),
            RemoteProvider::S3(s3) => format!("s3:{}", s3.connection.location_identity()),
        })
    }

    /// The provider as a location the listings, checks and joins read.
    pub(in crate::manager) fn location(&self) -> OpenedLocation<'_> {
        match &self.provider {
            RemoteProvider::Github(github) => OpenedLocation::Github(GitHubRepository {
                token: &github.token,
                repo: github.repository.as_str(),
            }),
            RemoteProvider::GoogleDrive(drive) => OpenedLocation::GoogleDrive(DriveVaultListing {
                token: &drive.token,
                root: drive.root.clone(),
            }),
            RemoteProvider::ICloud(icloud) => OpenedLocation::ICloud(ICloudLocation {
                token: &icloud.token,
                share: &icloud.share,
            }),
            RemoteProvider::S3(s3) => OpenedLocation::S3(S3VaultListing {
                storage: S3Storage {
                    connection: &s3.connection,
                },
            }),
        }
    }

    /// Names the provider in a refused write ("GitHub event parse: …").
    pub(in crate::manager) fn label(&self) -> &'static str {
        match &self.provider {
            RemoteProvider::Github(_) => "GitHub",
            RemoteProvider::GoogleDrive(_) => "Drive",
            RemoteProvider::ICloud(_) => "CloudKit",
            RemoteProvider::S3(_) => "S3",
        }
    }

    /// Every namespace of one kind at the provider, each in the identity
    /// folder that files it.
    pub(in crate::manager) async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        match &self.provider {
            RemoteProvider::Github(github) => {
                GitHubRepository {
                    token: &github.token,
                    repo: github.repository.as_str(),
                }
                .namespaces(kind)
                .await
            }
            RemoteProvider::GoogleDrive(drive) => {
                DriveNamespace::list_placed(&drive.token, &drive.root, kind).await
            }
            RemoteProvider::ICloud(icloud) => {
                ICloudEventStore::list_icloud_namespaces(&icloud.token, &icloud.share, kind).await
            }
            RemoteProvider::S3(s3) => {
                S3Storage {
                    connection: &s3.connection,
                }
                .namespaces(kind)
                .await
            }
        }
    }

    /// Every namespace that files one vault, whichever identity's folder
    /// holds it. `CloudKit` asks for the vault's records directly.
    async fn vault_namespaces(
        &self,
        store_id: &StoreId,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        match &self.provider {
            RemoteProvider::ICloud(icloud) => {
                ICloudEventStore::find_icloud_vault(&icloud.token, &icloud.share, store_id).await
            }
            RemoteProvider::Github(_) | RemoteProvider::GoogleDrive(_) | RemoteProvider::S3(_) => {
                let location = EventLogLocation::Vault(store_id.clone());
                Ok(self
                    .namespaces(EventLogNamespaceKind::Vault)
                    .await?
                    .into_iter()
                    .filter(|placed| *placed.location() == location)
                    .collect())
            }
        }
    }

    /// Where one log already sits here: an identity log in its own folder, a
    /// vault in the identity folder that files it. A vault the provider does
    /// not hold yet sits nowhere.
    pub(in crate::manager) async fn placement(
        &self,
        location: &EventLogLocation,
    ) -> Result<VaultPlacement, NookError> {
        let store_id = match location {
            EventLogLocation::Identity(identity) => {
                return Ok(VaultPlacement::Filed(PlacedNamespace::identity_log(
                    identity.clone(),
                )));
            }
            EventLogLocation::Vault(store_id) => store_id,
        };
        if let Some(placed) = self.placements.borrow().get(store_id) {
            return Ok(VaultPlacement::Filed(placed.clone()));
        }
        let placement = VaultPlacement::of(store_id, self.vault_namespaces(store_id).await?)?;
        if let VaultPlacement::Filed(placed) = &placement {
            self.remember(placed);
        }
        Ok(placement)
    }

    /// Remember the folder a vault is filed under here.
    pub(in crate::manager) fn remember(&self, placed: &PlacedNamespace) {
        if let EventLogLocation::Vault(store_id) = placed.location() {
            self.placements
                .borrow_mut()
                .insert(store_id.clone(), placed.clone());
        }
    }

    /// The store of one placed namespace at this provider.
    pub(in crate::manager) async fn event_store<'a>(
        &'a self,
        placed: &'a PlacedNamespace,
    ) -> Result<RemoteEventStore<'a>, NookError> {
        Ok(match &self.provider {
            RemoteProvider::Github(github) => RemoteEventStore::Github(GitHubEventStore {
                token: &github.token,
                repo: github.repository.as_str(),
                placed,
            }),
            RemoteProvider::GoogleDrive(drive) => RemoteEventStore::GoogleDrive(DriveEventStore {
                token: &drive.token,
                parent: drive.namespace_folder(placed).await?,
                location: placed.location(),
            }),
            RemoteProvider::ICloud(icloud) => RemoteEventStore::ICloud(ICloudEventStore {
                web_auth_token: &icloud.token,
                target: &icloud.share,
                placed,
            }),
            RemoteProvider::S3(s3) => RemoteEventStore::S3(S3EventStore {
                storage: S3Storage {
                    connection: &s3.connection,
                },
                placed,
            }),
        })
    }
}

impl PreparedGoogleDrive {
    /// The Drive folder of one namespace: remembered, or resolved (and
    /// created when absent) under the root, then remembered.
    async fn namespace_folder(
        &self,
        placed: &PlacedNamespace,
    ) -> Result<DriveEventParent, NookError> {
        if let Some(folder) = self.folders.borrow().get(placed) {
            return Ok(folder.clone());
        }
        let folder = DriveNamespace {
            token: &self.token,
            parent: &self.root,
            placed,
        }
        .resolve()
        .await?;
        self.folders
            .borrow_mut()
            .insert(placed.clone(), folder.clone());
        Ok(folder)
    }
}

#[cfg(test)]
impl PreparedProvider {
    /// A prepared GitHub repository, as `prepare` builds it after GitHub
    /// named the owner.
    pub(in crate::manager) fn github_fixture(
        token: &str,
        repository: &str,
    ) -> Result<Self, ValidationError> {
        Ok(Self::remote_fixture(RemoteProvider::Github(
            PreparedGithub {
                token: WasmFixture::secret(token)?,
                repository: GithubRepositoryPath(repository.to_owned()),
            },
        )))
    }

    /// A prepared Google Drive Nook root.
    pub(in crate::manager) fn drive_fixture(
        token: &str,
        root: &str,
    ) -> Result<Self, ValidationError> {
        Ok(Self::remote_fixture(RemoteProvider::GoogleDrive(
            PreparedGoogleDrive {
                token: WasmFixture::secret(token)?,
                root: DriveEventParent::shared_folder_id(root),
                folders: RefCell::default(),
            },
        )))
    }

    /// A prepared S3 location.
    pub(in crate::manager) fn s3_fixture(connection: S3Connection) -> Self {
        Self::remote_fixture(RemoteProvider::S3(PreparedS3 { connection }))
    }

    fn remote_fixture(provider: RemoteProvider) -> Self {
        Self::Remote(PreparedRemote {
            provider,
            placements: RefCell::default(),
        })
    }
}

#[cfg(test)]
impl ProviderCacheRef {
    /// A cache name a test owns, so its outbox rows stay its own.
    pub(in crate::manager) fn fixture(name: &str) -> Self {
        Self(name.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn each_prepared_provider_reads_as_its_own_location() -> anyhow::Result<()> {
        let github = PreparedProvider::github_fixture("github-token", "owner/repo")?;
        let drive = PreparedProvider::drive_fixture("drive-token", "root-folder")?;
        let s3 = PreparedProvider::s3_fixture(WasmFixture::s3_connection()?);
        let PreparedProvider::Remote(github) = &github else {
            anyhow::bail!("a GitHub fixture is remote");
        };
        assert!(matches!(
            github.location(),
            OpenedLocation::Github(GitHubRepository {
                repo: "owner/repo",
                ..
            })
        ));
        let PreparedProvider::Remote(drive) = &drive else {
            anyhow::bail!("a Drive fixture is remote");
        };
        assert!(matches!(
            drive.location(),
            OpenedLocation::GoogleDrive(DriveVaultListing { root, .. })
                if root == DriveEventParent::shared_folder_id("root-folder")
        ));
        let PreparedProvider::Remote(s3) = &s3 else {
            anyhow::bail!("an S3 fixture is remote");
        };
        assert!(matches!(s3.location(), OpenedLocation::S3(_)));
        Ok(())
    }
}
