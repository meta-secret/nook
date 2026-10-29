//! What a provider's Nook root holds, read from transport listings alone.
//!
//! Each vault namespace is its own subdirectory of the root. Google Drive
//! reports when each namespace folder and event file was created; the other
//! transports report only how many event files a namespace holds. Only the
//! events of a vault no identity here holds are read, to see whether a backup
//! password opens it; nothing is decrypted.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{
    AppId, BrowserIdentityVault, BrowserVaultKeys, CheckedVaultEvents, DriveEventParent, EventId,
    EventLogLocation, EventLogNamespaceKind, EventStorageBytes, IdentityId, KnownIdentityName,
    KnownVaultName, ListedIdentityLog, ListingAppKey, LocalEventWrite, LocalVaultOccupancy,
    ProviderIdentityLogEvents, ProviderVaultEvents, ProviderVaultKeyholding, ProviderVaultListing,
    ProviderVaultListingRequest, ProviderVaultObservation, ProviderVaultStanding,
    ProviderVaultTime, StoreId,
};

use futures_util::{StreamExt, TryStreamExt, stream};

use super::drive_events::DriveEventStore;
use super::drive_namespace::{DriveNamespace, ListedNamespaceFolder};
use super::remote_event::RemoteEventRead;
use crate::{NookDatabase, NookError};

/// The vault namespaces under one Google Drive Nook root.
pub(crate) struct DriveVaultListing<'a> {
    pub(crate) token: &'a str,
    pub(crate) root: &'a DriveEventParent,
}

/// How many namespace folders a listing reads at once; each also keeps its
/// own downloads in flight.
const DRIVE_FOLDER_CONCURRENCY: usize = 4;

impl DriveVaultListing<'_> {
    /// One observation per vault namespace; a namespace duplicated by hand
    /// fails closed, as sync does.
    pub(crate) async fn observations(&self) -> Result<Vec<ProviderVaultObservation>, NookError> {
        let folders =
            DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Vault)
                .await?;
        let mut vaults: Vec<(StoreId, ListedNamespaceFolder)> = Vec::new();
        for folder in folders {
            let Some(store_id) = folder.store_id().cloned() else {
                continue;
            };
            if vaults.iter().any(|(listed, _)| *listed == store_id) {
                return Err(NookError::Drive(
                    "Google Drive contains ambiguous namespace folders; sync stopped before choosing one."
                        .to_owned(),
                ));
            }
            vaults.push((store_id, folder));
        }
        stream::iter(vaults)
            .map(|(store_id, folder)| self.observation(store_id, folder))
            .buffered(DRIVE_FOLDER_CONCURRENCY)
            .try_collect()
            .await
    }

    async fn observation(
        &self,
        store_id: StoreId,
        folder: ListedNamespaceFolder,
    ) -> Result<ProviderVaultObservation, NookError> {
        let location = EventLogLocation::Vault(store_id.clone());
        let events = DriveEventStore {
            token: self.token,
            parent: &folder.folder,
            location: &location,
        }
        .list_drive_event_times()
        .await?;
        Ok(ProviderVaultObservation {
            store_id,
            identity: folder.placed.identity().clone(),
            namespace_created: folder.created.provider_time()?,
            events,
        })
    }
}

impl DriveVaultListing<'_> {
    /// The public control log of every identity folder under the root, read
    /// and verified; nothing in it is encrypted.
    pub(crate) async fn identity_logs(
        &self,
        this_browser: Option<&ListingAppKey>,
    ) -> Result<Vec<ListedIdentityLog>, NookError> {
        self.identity_log_events()
            .await?
            .into_iter()
            .map(|events| Ok(events.read(this_browser)?))
            .collect()
    }

    /// The raw control log events of every identity folder under the root.
    pub(crate) async fn identity_log_events(
        &self,
    ) -> Result<Vec<ProviderIdentityLogEvents>, NookError> {
        let folders =
            DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Identity)
                .await?;
        stream::iter(folders)
            .map(|folder| async move {
                let identity_id = folder.placed.identity().clone();
                let events = self.log_events(&identity_id, &folder.folder).await?;
                Ok::<_, NookError>(ProviderIdentityLogEvents {
                    identity_id,
                    events,
                })
            })
            .buffered(DRIVE_FOLDER_CONCURRENCY)
            .try_collect()
            .await
    }

    /// The events an identity's log folder holds, read and not yet verified.
    async fn log_events(
        &self,
        identity_id: &IdentityId,
        folder: &DriveEventParent,
    ) -> Result<Vec<EventStorageBytes>, NookError> {
        let location = EventLogLocation::Identity(identity_id.clone());
        let read = DriveEventStore {
            token: self.token,
            parent: folder,
            location: &location,
        }
        .read_drive_events()
        .await?;
        Ok(read
            .into_iter()
            .filter_map(|(_, event)| match event {
                RemoteEventRead::Retrieved(bytes) => Some(bytes),
                RemoteEventRead::Unavailable => None,
            })
            .collect())
    }
}

impl DriveVaultListing<'_> {
    /// The folder that holds one identity's control log under the root.
    async fn identity_log_folder(
        &self,
        identity_id: &IdentityId,
    ) -> Result<DriveEventParent, NookError> {
        let mut folders =
            DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Identity)
                .await?
                .into_iter()
                .filter(|folder| folder.placed.identity() == identity_id)
                .map(|folder| folder.folder)
                .collect::<Vec<_>>();
        match (folders.pop(), folders.is_empty()) {
            (Some(folder), true) => Ok(folder),
            (Some(_), false) => Err(NookError::Drive(
                "Google Drive contains ambiguous namespace folders; sync stopped before choosing one."
                    .to_owned(),
            )),
            (None, _) => Err(NookError::Drive(
                "The identity is not in this Nook folder.".to_owned(),
            )),
        }
    }

    /// One identity's control log events, read and not yet verified.
    pub(crate) async fn identity_events(
        &self,
        identity_id: &IdentityId,
    ) -> Result<Vec<EventStorageBytes>, NookError> {
        let folder = self.identity_log_folder(identity_id).await?;
        self.log_events(identity_id, &folder).await
    }

    /// Write one event into an identity's log folder the root already holds.
    pub(crate) async fn put_identity_event(
        &self,
        identity_id: &IdentityId,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let folder = self.identity_log_folder(identity_id).await?;
        let location = EventLogLocation::Identity(identity_id.clone());
        DriveEventStore {
            token: self.token,
            parent: &folder,
            location: &location,
        }
        .put_drive_event_if_absent(event_id, bytes)
        .await?;
        Ok(())
    }
}

/// An observation for a transport that only counts a namespace's events.
pub(crate) struct CountedVaultNamespace {
    pub(crate) store_id: StoreId,
    pub(crate) identity: nook_core::IdentityId,
    pub(crate) event_count: usize,
}

impl CountedVaultNamespace {
    pub(crate) fn observation(self) -> ProviderVaultObservation {
        ProviderVaultObservation {
            store_id: self.store_id,
            identity: self.identity,
            namespace_created: ProviderVaultTime::Unreported,
            events: vec![ProviderVaultTime::Unreported; self.event_count],
        }
    }
}

impl crate::DriveStorageClient<'_> {
    /// The signed-in account's Nook root; an account without one holds no vault.
    pub(crate) async fn existing_nook_root(&self) -> Result<DriveEventParent, NookError> {
        match self.find_vault_folder().await? {
            nook_core::DriveVaultFolderSelection::Existing(folder_id) => {
                Ok(DriveEventParent::shared_folder_id(folder_id.as_str()))
            }
            nook_core::DriveVaultFolderSelection::Create => Err(NookError::Drive(
                "The account has no Nook folder.".to_owned(),
            )),
        }
    }
}

impl DriveVaultListing<'_> {
    /// The subfolder that holds one vault's events.
    async fn vault_folder(&self, store_id: &StoreId) -> Result<DriveEventParent, NookError> {
        let mut folders =
            DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Vault)
                .await?
                .into_iter()
                .filter(|folder| folder.store_id() == Some(store_id))
                .map(|folder| folder.folder)
                .collect::<Vec<_>>();
        match (folders.pop(), folders.is_empty()) {
            (Some(folder), true) => Ok(folder),
            (Some(_), false) => Err(NookError::Drive(
                "Google Drive contains ambiguous namespace folders; sync stopped before choosing one."
                    .to_owned(),
            )),
            (None, _) => Err(NookError::Drive(
                "The vault is not in this Nook folder.".to_owned(),
            )),
        }
    }

    /// Write one event into a vault's subfolder the root already holds.
    pub(crate) async fn put_vault_event(
        &self,
        store_id: &StoreId,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let folder = self.vault_folder(store_id).await?;
        let location = EventLogLocation::Vault(store_id.clone());
        DriveEventStore {
            token: self.token,
            parent: &folder,
            location: &location,
        }
        .put_drive_event_if_absent(event_id, bytes)
        .await?;
        Ok(())
    }

    /// One vault's events, read without its keys.
    pub(crate) async fn vault_events(
        &self,
        store_id: &StoreId,
    ) -> Result<Vec<LocalEventWrite>, NookError> {
        let folder = self.vault_folder(store_id).await?;
        self.namespace_events(store_id, &folder).await
    }

    async fn namespace_events(
        &self,
        store_id: &StoreId,
        folder: &DriveEventParent,
    ) -> Result<Vec<LocalEventWrite>, NookError> {
        let location = EventLogLocation::Vault(store_id.clone());
        let read = DriveEventStore {
            token: self.token,
            parent: folder,
            location: &location,
        }
        .read_drive_events()
        .await?;
        Ok(read
            .into_iter()
            .filter_map(|(event_id, event)| match event {
                RemoteEventRead::Retrieved(bytes) => Some(LocalEventWrite { event_id, bytes }),
                RemoteEventRead::Unavailable => None,
            })
            .collect())
    }
}

impl DriveVaultListing<'_> {
    /// Every vault namespace under the root with the identity filing it and
    /// its events, read without its keys.
    pub(crate) async fn all_vault_events(&self) -> Result<Vec<CheckedVaultEvents>, NookError> {
        let folders =
            DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Vault)
                .await?;
        stream::iter(folders.into_iter().filter_map(|folder| {
            let store_id = folder.store_id().cloned()?;
            Some((store_id, folder))
        }))
        .map(|(store_id, folder)| async move {
            Ok::<_, NookError>(CheckedVaultEvents {
                events: self.namespace_events(&store_id, &folder.folder).await?,
                filed_under: folder.placed.identity().clone(),
                store_id,
            })
        })
        .buffered(DRIVE_FOLDER_CONCURRENCY)
        .try_collect()
        .await
    }
}

impl DriveVaultListing<'_> {
    /// What these vaults' events tell without their keys: a backup password,
    /// and whether this app asked for or was granted access.
    pub(crate) async fn inspect_vaults(
        &self,
        store_ids: &[StoreId],
        app_id: Option<&AppId>,
    ) -> Result<InspectedVaults, NookError> {
        let folders =
            DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Vault)
                .await?;
        let read: Vec<(StoreId, Vec<LocalEventWrite>)> =
            stream::iter(folders.into_iter().filter_map(|folder| {
                let store_id = folder.store_id().cloned()?;
                store_ids.contains(&store_id).then_some((store_id, folder))
            }))
            .map(|(store_id, folder)| async move {
                let events = self.namespace_events(&store_id, &folder.folder).await?;
                Ok::<_, NookError>((store_id, events))
            })
            .buffered(DRIVE_FOLDER_CONCURRENCY)
            .try_collect()
            .await?;
        let mut inspected = InspectedVaults::default();
        for (store_id, events) in read {
            inspected.record(store_id, events, app_id)?;
        }
        Ok(inspected)
    }
}

/// The unheld vaults sorted by what their events tell.
#[derive(Default)]
pub(crate) struct InspectedVaults {
    pub(crate) password: Vec<StoreId>,
    pub(crate) granted: Vec<StoreId>,
    pub(crate) requested: Vec<StoreId>,
}

impl InspectedVaults {
    pub(crate) fn record(
        &mut self,
        store_id: StoreId,
        events: Vec<LocalEventWrite>,
        app_id: Option<&AppId>,
    ) -> Result<(), NookError> {
        let inspection = ProviderVaultEvents {
            store_id: &store_id,
            events,
        }
        .inspect(app_id)?;
        if inspection.backup_password {
            self.password.push(store_id.clone());
        }
        match inspection.standing {
            ProviderVaultStanding::Granted => self.granted.push(store_id),
            ProviderVaultStanding::Requested => self.requested.push(store_id),
            ProviderVaultStanding::Stranger => {}
        }
        Ok(())
    }
}

/// Relate provider observations to the keys this browser holds and the vault
/// it has open.
pub(crate) struct LocalVaultClassification<'a> {
    pub(crate) local_vault: &'a LocalVaultOccupancy,
}

/// The vaults this browser holds keys for, by identity.
pub(crate) struct BrowserHeldVaults {
    pub(crate) identity_vaults: Vec<StoreId>,
    pub(crate) other_identity_vaults: Vec<BrowserIdentityVault>,
    /// This browser's app key under the identity in use.
    pub(crate) app_id: Option<AppId>,
    /// That key and the identity in use, which each identity's log is read
    /// against.
    pub(crate) listing_key: Option<ListingAppKey>,
    /// The names this browser keeps for its registered vaults.
    pub(crate) names: Vec<KnownVaultName>,
    /// The labels of the identities on this browser.
    pub(crate) identity_names: Vec<KnownIdentityName>,
}

impl BrowserHeldVaults {
    pub(crate) async fn load() -> Result<Self, NookError> {
        let directory = NookDatabase::load_identity_directory().await?;
        let keyring = NookDatabase::load_keyring().await?;
        let names = NookDatabase::load_vault_registry()
            .await?
            .vaults
            .into_iter()
            .map(|entry| {
                Ok(KnownVaultName {
                    store_id: StoreId::parse(&entry.store_id)?,
                    name: entry.label,
                })
            })
            .collect::<Result<Vec<_>, NookError>>()?;
        let identity_names = directory
            .identities()
            .iter()
            .map(|identity| KnownIdentityName {
                identity_id: identity.identity_id.clone(),
                name: identity.label.clone(),
            })
            .collect();
        let keys = BrowserVaultKeys {
            directory: &directory,
            keyring: &keyring,
        };
        Ok(Self {
            identity_vaults: keys.identity_vaults(),
            other_identity_vaults: keys.other_identity_vaults(),
            app_id: keys.identity_app_id(),
            listing_key: keys.listing_key(),
            names,
            identity_names,
        })
    }

    /// The listed vaults no identity here holds: only a backup password or a
    /// member's grant opens them.
    pub(crate) fn unheld(&self, observations: &[ProviderVaultObservation]) -> Vec<StoreId> {
        observations
            .iter()
            .map(|observation| observation.store_id.clone())
            .filter(|store_id| {
                !self.identity_vaults.contains(store_id)
                    && !self
                        .other_identity_vaults
                        .iter()
                        .any(|held| &held.store_id == store_id)
            })
            .collect()
    }
}

impl LocalVaultClassification<'_> {
    pub(crate) fn listing(
        &self,
        observations: Vec<ProviderVaultObservation>,
        held: &BrowserHeldVaults,
        inspected: &InspectedVaults,
        identity_logs: &[ListedIdentityLog],
    ) -> ProviderVaultListing {
        ProviderVaultListingRequest {
            observations,
            keys: ProviderVaultKeyholding {
                identity_vaults: &held.identity_vaults,
                browser_vaults: &held.other_identity_vaults,
                granted_vaults: &inspected.granted,
                password_vaults: &inspected.password,
                requested_vaults: &inspected.requested,
                identity_in_use: held.app_id.is_some(),
            },
            names: nook_core::BrowserNames {
                vaults: &held.names,
                identities: &held.identity_names,
            },
            identity_logs,
            local_vault: self.local_vault,
        }
        .listing()
    }
}
