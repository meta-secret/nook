//! One provider location opened for reading, whichever way it was reached:
//! the current provider of a session or a location the page names.
//!
//! `ProviderLocation` has async methods and a per-location namespace type,
//! so it is not object-safe; each consumer operation delegates here once.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{EventStorageBytes, IdentityId, LocalVaultOccupancy, ProviderVaultListing};

use super::github_events::GitHubRepository;
use super::icloud::ICloudLocation;
use super::local_folder::LocalFolderLocation;
use super::provider_vault_listing::{
    DriveVaultListing, IdentityEventPut, ProviderLocation, SourceContents,
};
use super::s3::S3VaultListing;
use crate::NookError;

/// One provider location opened for reading.
pub(crate) enum OpenedLocation<'a> {
    Github(GitHubRepository<'a>),
    GoogleDrive(DriveVaultListing<'a>),
    ICloud(ICloudLocation<'a>),
    S3(S3VaultListing<'a>),
    LocalFolder(LocalFolderLocation),
}

impl OpenedLocation<'_> {
    /// Every identity log and vault the location holds, read without any key.
    pub(crate) async fn contents(&self) -> Result<SourceContents, NookError> {
        match self {
            Self::Github(location) => location.contents().await,
            Self::GoogleDrive(location) => location.contents().await,
            Self::ICloud(location) => location.contents().await,
            Self::S3(location) => location.contents().await,
            Self::LocalFolder(location) => location.contents().await,
        }
    }

    /// What the location holds, related to this browser's keys and the vault
    /// it has open.
    pub(crate) async fn listing(
        &self,
        local_vault: &LocalVaultOccupancy,
    ) -> Result<ProviderVaultListing, NookError> {
        match self {
            Self::Github(location) => location.listing(local_vault).await,
            Self::GoogleDrive(location) => location.listing(local_vault).await,
            Self::ICloud(location) => location.listing(local_vault).await,
            Self::S3(location) => location.listing(local_vault).await,
            Self::LocalFolder(location) => location.listing(local_vault).await,
        }
    }

    /// One identity's control log events, read and not yet verified.
    pub(crate) async fn identity_events(
        &self,
        identity_id: &IdentityId,
    ) -> Result<Vec<EventStorageBytes>, NookError> {
        match self {
            Self::Github(location) => location.identity_events(identity_id).await,
            Self::GoogleDrive(location) => location.identity_events(identity_id).await,
            Self::ICloud(location) => location.identity_events(identity_id).await,
            Self::S3(location) => location.identity_events(identity_id).await,
            Self::LocalFolder(location) => location.identity_events(identity_id).await,
        }
    }

    /// Write one event into an identity's log at the location.
    pub(crate) async fn put_identity_event(
        &self,
        put: IdentityEventPut<'_>,
    ) -> Result<(), NookError> {
        match self {
            Self::Github(location) => location.put_identity_event(put).await,
            Self::GoogleDrive(location) => location.put_identity_event(put).await,
            Self::ICloud(location) => location.put_identity_event(put).await,
            Self::S3(location) => location.put_identity_event(put).await,
            Self::LocalFolder(location) => location.put_identity_event(put).await,
        }
    }
}
