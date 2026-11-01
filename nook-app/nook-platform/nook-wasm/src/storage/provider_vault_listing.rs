//! What a provider's Nook root holds, read from transport listings alone.
//!
//! Each vault namespace is its own subdirectory of the root. The listing is
//! written once over a [`ProviderLocation`], a Google Drive root or an S3
//! location, which lists, observes, reads, and writes its own namespaces.
//! Google Drive reports when each namespace folder and event file was
//! created; the other transports report only how many event files a
//! namespace holds. Only the events of a vault no identity here holds are
//! read, to see whether a backup password opens it; nothing is decrypted.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{
    AppId, BrowserIdentityVault, BrowserVaultKeys, CheckedVaultEvents, DriveEventParent, EventId,
    EventLogLocation, EventLogNamespaceKind, EventStorageBytes, IdentityId, IdentitySelection,
    KnownIdentityName, KnownVaultName, ListedIdentityLog, ListingAppKey, LocalEventWrite,
    LocalIdentityLog, LocalVaultOccupancy, PlacedNamespace, ProviderIdentityLogEvents,
    ProviderVaultEvents, ProviderVaultKeyholding, ProviderVaultListing,
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
const FOLDER_CONCURRENCY: usize = 4;

/// One provider location a vault listing reads. The location lists its
/// namespaces, observes a vault in one, reads one's events, and writes one
/// event; the listing over them is written once, here.
pub(crate) trait ProviderLocation {
    /// One namespace as the location lists it.
    type Namespace;

    /// Every namespace of one kind at the location.
    async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<Self::Namespace>, NookError>;

    /// The identity folder and event log of a listed namespace.
    fn placed(namespace: &Self::Namespace) -> &PlacedNamespace;

    /// The failure of a vault listed in two namespaces.
    fn filed_twice(store_id: &StoreId) -> NookError;

    /// What the location reports about one vault's namespace.
    async fn observation(
        &self,
        store_id: StoreId,
        vault: Self::Namespace,
    ) -> Result<ProviderVaultObservation, NookError>;

    /// Every event one namespace holds, read and not yet verified.
    async fn events(&self, namespace: &Self::Namespace) -> Result<Vec<LocalEventWrite>, NookError>;

    /// The namespace of one identity's control log the location holds.
    async fn identity_log(&self, identity_id: &IdentityId) -> Result<Self::Namespace, NookError>;

    /// Write one event into a namespace the location holds.
    async fn put_event(
        &self,
        namespace: &Self::Namespace,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError>;

    /// Every vault namespace with the vault it holds.
    async fn vaults(&self) -> Result<Vec<(StoreId, Self::Namespace)>, NookError> {
        Ok(self
            .namespaces(EventLogNamespaceKind::Vault)
            .await?
            .into_iter()
            .filter_map(|vault| {
                let EventLogLocation::Vault(store_id) = Self::placed(&vault).location().clone()
                else {
                    return None;
                };
                Some((store_id, vault))
            })
            .collect())
    }

    /// One observation per vault namespace. A vault listed twice, under two
    /// identities or duplicated by hand, fails closed, as sync does.
    async fn observations(&self) -> Result<Vec<ProviderVaultObservation>, NookError> {
        let mut vaults: Vec<(StoreId, Self::Namespace)> = Vec::new();
        for (store_id, vault) in self.vaults().await? {
            if vaults.iter().any(|(listed, _)| *listed == store_id) {
                return Err(Self::filed_twice(&store_id));
            }
            vaults.push((store_id, vault));
        }
        stream::iter(vaults)
            .map(|(store_id, vault)| self.observation(store_id, vault))
            .buffered(FOLDER_CONCURRENCY)
            .try_collect()
            .await
    }

    /// The public control log of every identity at the location, read and
    /// verified; nothing in it is encrypted.
    async fn identity_logs(
        &self,
        this_browser: Option<&ListingAppKey>,
    ) -> Result<Vec<ListedIdentityLog>, NookError> {
        self.identity_log_events()
            .await?
            .into_iter()
            .map(|events| Ok(events.read(this_browser)?))
            .collect()
    }

    /// The raw control log events of every identity at the location.
    async fn identity_log_events(&self) -> Result<Vec<ProviderIdentityLogEvents>, NookError> {
        stream::iter(self.namespaces(EventLogNamespaceKind::Identity).await?)
            .map(|log| async move {
                Ok::<_, NookError>(ProviderIdentityLogEvents {
                    identity_id: Self::placed(&log).identity().clone(),
                    events: self
                        .events(&log)
                        .await?
                        .into_iter()
                        .map(|event| event.bytes)
                        .collect(),
                })
            })
            .buffered(FOLDER_CONCURRENCY)
            .try_collect()
            .await
    }

    /// One identity's control log events, read and not yet verified.
    async fn identity_events(
        &self,
        identity_id: &IdentityId,
    ) -> Result<Vec<EventStorageBytes>, NookError> {
        let log = self.identity_log(identity_id).await?;
        Ok(self
            .events(&log)
            .await?
            .into_iter()
            .map(|event| event.bytes)
            .collect())
    }

    /// Write one event into an identity's log the location already holds.
    async fn put_identity_event(
        &self,
        identity_id: &IdentityId,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let log = self.identity_log(identity_id).await?;
        self.put_event(&log, event_id, bytes).await
    }

    /// Every vault namespace with the identity filing it and its events,
    /// read without its keys.
    async fn all_vault_events(&self) -> Result<Vec<CheckedVaultEvents>, NookError> {
        stream::iter(self.vaults().await?)
            .map(|(store_id, vault)| async move {
                Ok::<_, NookError>(CheckedVaultEvents {
                    events: self.events(&vault).await?,
                    filed_under: Self::placed(&vault).identity().clone(),
                    store_id,
                })
            })
            .buffered(FOLDER_CONCURRENCY)
            .try_collect()
            .await
    }

    /// What these vaults' events tell without their keys: a backup password,
    /// and whether this app asked for or was granted access.
    async fn inspect_vaults(
        &self,
        store_ids: &[StoreId],
        app_id: Option<&AppId>,
    ) -> Result<InspectedVaults, NookError> {
        let vaults = self.vaults().await?;
        let read: Vec<(StoreId, Vec<LocalEventWrite>)> = stream::iter(
            vaults
                .into_iter()
                .filter(|(store_id, _)| store_ids.contains(store_id)),
        )
        .map(|(store_id, vault)| async move {
            let events = self.events(&vault).await?;
            Ok::<_, NookError>((store_id, events))
        })
        .buffered(FOLDER_CONCURRENCY)
        .try_collect()
        .await?;
        let mut inspected = InspectedVaults::default();
        for (store_id, events) in read {
            inspected.record(store_id, events, app_id)?;
        }
        Ok(inspected)
    }
}

impl ProviderLocation for DriveVaultListing<'_> {
    type Namespace = ListedNamespaceFolder;

    async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<ListedNamespaceFolder>, NookError> {
        DriveNamespace::list_folders(self.token, self.root, kind).await
    }

    fn placed(folder: &ListedNamespaceFolder) -> &PlacedNamespace {
        &folder.placed
    }

    fn filed_twice(_: &StoreId) -> NookError {
        NookError::Drive(
            "Google Drive contains ambiguous namespace folders; sync stopped before choosing one."
                .to_owned(),
        )
    }

    /// A vault folder, by when Drive created it and each of its event files.
    async fn observation(
        &self,
        store_id: StoreId,
        folder: ListedNamespaceFolder,
    ) -> Result<ProviderVaultObservation, NookError> {
        let events = DriveEventStore {
            token: self.token,
            parent: &folder.folder,
            location: folder.placed.location(),
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

    async fn events(
        &self,
        folder: &ListedNamespaceFolder,
    ) -> Result<Vec<LocalEventWrite>, NookError> {
        let read = DriveEventStore {
            token: self.token,
            parent: &folder.folder,
            location: folder.placed.location(),
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

    /// The one folder under the root that holds the identity's control log.
    async fn identity_log(
        &self,
        identity_id: &IdentityId,
    ) -> Result<ListedNamespaceFolder, NookError> {
        let mut folders = self
            .namespaces(EventLogNamespaceKind::Identity)
            .await?
            .into_iter()
            .filter(|folder| folder.placed.identity() == identity_id)
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

    async fn put_event(
        &self,
        folder: &ListedNamespaceFolder,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        DriveEventStore {
            token: self.token,
            parent: &folder.folder,
            location: folder.placed.location(),
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
    async fn vault_folder(&self, store_id: &StoreId) -> Result<ListedNamespaceFolder, NookError> {
        let mut folders =
            DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Vault)
                .await?
                .into_iter()
                .filter(|folder| folder.store_id() == Some(store_id))
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
        self.put_event(&folder, event_id, bytes).await
    }

    /// One vault's events, read without its keys.
    pub(crate) async fn vault_events(
        &self,
        store_id: &StoreId,
    ) -> Result<Vec<LocalEventWrite>, NookError> {
        let folder = self.vault_folder(store_id).await?;
        self.events(&folder).await
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
        // Whether the identity in use already has its own control log here,
        // which decides if its key may still finish another identity's join.
        let local_log = match directory.selection() {
            IdentitySelection::Selected(selected) => {
                if NookDatabase::load_identity_log(selected).await?.is_empty() {
                    LocalIdentityLog::Empty
                } else {
                    LocalIdentityLog::Replicated
                }
            }
            IdentitySelection::Empty => LocalIdentityLog::Empty,
        };
        let keys = BrowserVaultKeys {
            directory: &directory,
            keyring: &keyring,
        };
        Ok(Self {
            identity_vaults: keys.identity_vaults(),
            other_identity_vaults: keys.other_identity_vaults(),
            app_id: keys.identity_app_id(),
            listing_key: keys.listing_key(local_log),
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
