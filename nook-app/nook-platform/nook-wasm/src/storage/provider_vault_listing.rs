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

use nook_core::ProviderSecretText;
use nook_core::{
    BrowserIdentityVault, BrowserNames, BrowserVaultKeys, CheckedVaultEvents, DriveEventParent,
    EventError, EventId, EventLogLocation, EventLogNamespaceKind, EventStorageBytes, IdentityId,
    IdentitySelection, KnownIdentityName, KnownVaultName, ListedIdentityLog, ListingIdentity,
    LocalEventWrite, LocalIdentityLog, LocalVaultOccupancy, PlacedNamespace,
    ProviderIdentityLogEvents, ProviderVaultEvents, ProviderVaultKeyholding, ProviderVaultListing,
    ProviderVaultListingRequest, ProviderVaultObservation, ProviderVaultStanding,
    ProviderVaultTime, StoreId,
};

use futures_util::future::try_join;
use futures_util::{StreamExt, TryStreamExt, stream};
use std::collections::BTreeSet;

use super::checked_event_write::{CheckedEventWrite, CheckedEventWriteRequest};
use super::drive_events::DriveEventStore;
use super::drive_namespace::{DriveNamespace, ListedNamespaceFolder};
use super::event_store::EventStore;
use crate::{NookDatabase, NookError};

/// The vault namespaces under one Google Drive Nook root.
pub(crate) struct DriveVaultListing<'a> {
    pub(crate) token: &'a ProviderSecretText,
    pub(crate) root: DriveEventParent,
}

/// A location's identity logs and vaults, read without any key.
pub(crate) struct SourceContents {
    pub(crate) identity_logs: Vec<ProviderIdentityLogEvents>,
    pub(crate) vaults: Vec<CheckedVaultEvents>,
}

impl SourceContents {
    /// What a source with no identity and no vault holds.
    pub(crate) fn empty() -> Self {
        Self {
            identity_logs: Vec::new(),
            vaults: Vec::new(),
        }
    }
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

    /// Names the location in a refused write ("Drive event parse: …").
    const PROVIDER: &'static str;

    /// Every namespace of one kind at the location.
    async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<Self::Namespace>, NookError>;

    /// The identity folder and event log of a listed namespace.
    fn placed(namespace: &Self::Namespace) -> &PlacedNamespace;

    /// What the location reports about one vault's namespace.
    async fn observation(
        &self,
        vault: ListedVault<Self::Namespace>,
    ) -> Result<ProviderVaultObservation, NookError>;

    /// Every event one namespace holds, read and not yet verified.
    async fn events(&self, namespace: &Self::Namespace) -> Result<Vec<LocalEventWrite>, NookError>;

    /// The namespace of one identity's control log the location holds.
    async fn identity_log(&self, identity_id: &IdentityId) -> Result<Self::Namespace, NookError>;

    /// Write one checked event into a namespace the location holds.
    async fn put_event(&self, write: NamespaceWrite<'_, Self::Namespace>) -> Result<(), NookError>;

    /// Every vault namespace with the vault it holds.
    async fn vaults(&self) -> Result<Vec<ListedVault<Self::Namespace>>, NookError> {
        Ok(self
            .namespaces(EventLogNamespaceKind::Vault)
            .await?
            .into_iter()
            .filter_map(|namespace| {
                let EventLogLocation::Vault(store_id) = Self::placed(&namespace).location().clone()
                else {
                    return None;
                };
                Some(ListedVault {
                    store_id,
                    namespace,
                })
            })
            .collect())
    }

    /// One observation per vault namespace. A vault listed twice, under two
    /// identities or duplicated by hand, fails closed, as sync does.
    async fn observations(&self) -> Result<Vec<ProviderVaultObservation>, NookError> {
        let vaults = self.vaults().await?;
        let mut listed = BTreeSet::new();
        for vault in &vaults {
            if !listed.insert(&vault.store_id) {
                return Err(EventError::VaultFiledTwice {
                    store_id: vault.store_id.as_str().to_owned(),
                }
                .into());
            }
        }
        stream::iter(vaults)
            .map(|vault| self.observation(vault))
            .buffered(FOLDER_CONCURRENCY)
            .try_collect()
            .await
    }

    /// The public control log of every identity at the location, read and
    /// verified; nothing in it is encrypted.
    async fn identity_logs(
        &self,
        this_browser: &ListingIdentity,
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

    /// Write one event into an identity's log the location already holds. A
    /// malformed event is refused before any request.
    async fn put_identity_event(&self, put: IdentityEventPut<'_>) -> Result<(), NookError> {
        let location = EventLogLocation::Identity(put.identity_id.clone());
        let event = CheckedEventWrite::parse(CheckedEventWriteRequest {
            bytes: put.bytes.as_ref(),
            event_id: put.event_id,
            location: &location,
            provider: Self::PROVIDER,
        })?;
        let log = self.identity_log(put.identity_id).await?;
        self.put_event(NamespaceWrite {
            namespace: &log,
            event,
        })
        .await
    }

    /// Every vault namespace with the identity filing it and its events,
    /// read without its keys.
    async fn all_vault_events(&self) -> Result<Vec<CheckedVaultEvents>, NookError> {
        stream::iter(self.vaults().await?)
            .map(|vault| async move {
                Ok::<_, NookError>(CheckedVaultEvents {
                    events: self.events(&vault.namespace).await?,
                    filed_under: Self::placed(&vault.namespace).identity().clone(),
                    store_id: vault.store_id,
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
        inspection: VaultInspection<'_>,
    ) -> Result<InspectedVaults, NookError> {
        let vaults = self.vaults().await?;
        let read: Vec<InspectedVault<'_>> = stream::iter(
            vaults
                .into_iter()
                .filter(|vault| inspection.store_ids.contains(&vault.store_id)),
        )
        .map(|vault| async move {
            Ok::<_, NookError>(InspectedVault {
                events: self.events(&vault.namespace).await?,
                store_id: vault.store_id,
                this_browser: inspection.this_browser,
            })
        })
        .buffered(FOLDER_CONCURRENCY)
        .try_collect()
        .await?;
        read.into_iter()
            .try_fold(InspectedVaults::default(), InspectedVaults::record)
    }

    /// Every identity log and every vault the location holds, read side by
    /// side without any key.
    async fn contents(&self) -> Result<SourceContents, NookError> {
        let (identity_logs, vaults) =
            try_join(self.identity_log_events(), self.all_vault_events()).await?;
        Ok(SourceContents {
            identity_logs,
            vaults,
        })
    }

    /// What the location holds, related to this browser's keys and the vault
    /// it has open. The vaults and the identity logs are read side by side;
    /// only the vaults no identity here holds are then inspected.
    async fn listing(
        &self,
        local_vault: &LocalVaultOccupancy,
    ) -> Result<ProviderVaultListing, NookError> {
        let held = BrowserHeldVaults::load().await?;
        let (observations, identity_logs) =
            try_join(self.observations(), self.identity_logs(&held.identity)).await?;
        let unheld = held.unheld(&observations);
        let inspected = self
            .inspect_vaults(VaultInspection {
                store_ids: &unheld,
                this_browser: &held.identity,
            })
            .await?;
        Ok(held.listing(VaultListingParts {
            observations,
            inspected: &inspected,
            identity_logs: &identity_logs,
            local_vault,
        }))
    }
}

/// One vault namespace and the vault it holds.
pub(crate) struct ListedVault<N> {
    pub(crate) store_id: StoreId,
    pub(crate) namespace: N,
}

/// The unheld vaults a listing inspects, read against this browser's key.
#[derive(Clone, Copy)]
pub(crate) struct VaultInspection<'a> {
    pub(crate) store_ids: &'a [StoreId],
    pub(crate) this_browser: &'a ListingIdentity,
}

/// One signed event for an identity's log at a location.
#[derive(Clone, Copy)]
pub(crate) struct IdentityEventPut<'a> {
    pub(crate) identity_id: &'a IdentityId,
    pub(crate) event_id: &'a EventId,
    pub(crate) bytes: &'a EventStorageBytes,
}

/// One checked event and the namespace it goes into.
pub(crate) struct NamespaceWrite<'a, N> {
    pub(crate) namespace: &'a N,
    pub(crate) event: CheckedEventWrite<'a>,
}

impl ProviderLocation for DriveVaultListing<'_> {
    type Namespace = ListedNamespaceFolder;
    const PROVIDER: &'static str = "Drive";

    async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<ListedNamespaceFolder>, NookError> {
        DriveNamespace::list_folders(self.token, &self.root, kind).await
    }

    fn placed(folder: &ListedNamespaceFolder) -> &PlacedNamespace {
        &folder.placed
    }

    /// A vault folder, by when Drive created it and each of its event files.
    async fn observation(
        &self,
        vault: ListedVault<ListedNamespaceFolder>,
    ) -> Result<ProviderVaultObservation, NookError> {
        let ListedVault {
            store_id,
            namespace: folder,
        } = vault;
        let events = DriveEventStore {
            token: self.token,
            parent: folder.folder.clone(),
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
        DriveEventStore {
            token: self.token,
            parent: folder.folder.clone(),
            location: folder.placed.location(),
        }
        .events()
        .await
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
        write: NamespaceWrite<'_, ListedNamespaceFolder>,
    ) -> Result<(), NookError> {
        DriveEventStore {
            token: self.token,
            parent: write.namespace.folder.clone(),
            location: write.namespace.placed.location(),
        }
        .put_checked(write.event)
        .await
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
            DriveNamespace::list_folders(self.token, &self.root, EventLogNamespaceKind::Vault)
                .await?
                .into_iter()
                .filter(|folder| {
                    *folder.placed.location() == EventLogLocation::Vault(store_id.clone())
                })
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

    /// Write one checked event into a vault's subfolder the root already
    /// holds.
    pub(crate) async fn put_vault_event(
        &self,
        event: CheckedEventWrite<'_>,
    ) -> Result<(), NookError> {
        let EventLogLocation::Vault(store_id) = event.location() else {
            return Err(NookError::Drive(
                "Only a vault's events go into a vault folder.".to_owned(),
            ));
        };
        let folder = self.vault_folder(store_id).await?;
        self.put_event(NamespaceWrite {
            namespace: &folder,
            event,
        })
        .await
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

/// One unheld vault's events, read against this browser's key.
pub(crate) struct InspectedVault<'a> {
    pub(crate) store_id: StoreId,
    pub(crate) events: Vec<LocalEventWrite>,
    pub(crate) this_browser: &'a ListingIdentity,
}

impl InspectedVaults {
    /// Sort one more vault by what its events tell.
    pub(crate) fn record(mut self, vault: InspectedVault<'_>) -> Result<Self, NookError> {
        let InspectedVault {
            store_id,
            events,
            this_browser,
        } = vault;
        let inspection = ProviderVaultEvents {
            store_id: &store_id,
            events,
        }
        .inspect(this_browser)?;
        if inspection.backup_password {
            self.password.push(store_id.clone());
        }
        match inspection.standing {
            ProviderVaultStanding::Granted => self.granted.push(store_id),
            ProviderVaultStanding::Requested => self.requested.push(store_id),
            ProviderVaultStanding::Stranger => {}
        }
        Ok(self)
    }
}

/// What one listing read, to relate to the keys this browser holds.
pub(crate) struct VaultListingParts<'a> {
    pub(crate) observations: Vec<ProviderVaultObservation>,
    pub(crate) inspected: &'a InspectedVaults,
    pub(crate) identity_logs: &'a [ListedIdentityLog],
    pub(crate) local_vault: &'a LocalVaultOccupancy,
}

/// The vaults this browser holds keys for, by identity.
pub(crate) struct BrowserHeldVaults {
    pub(crate) identity_vaults: Vec<StoreId>,
    pub(crate) other_identity_vaults: Vec<BrowserIdentityVault>,
    /// The identity in use and this browser's app key under it, which each
    /// identity's log and each unheld vault is read against.
    pub(crate) identity: ListingIdentity,
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
            identity: keys.listing_identity(local_log),
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

    /// Relate what one listing read to the keys this browser holds and the
    /// vault it has open.
    pub(crate) fn listing(&self, parts: VaultListingParts<'_>) -> ProviderVaultListing {
        let VaultListingParts {
            observations,
            inspected,
            identity_logs,
            local_vault,
        } = parts;
        ProviderVaultListingRequest {
            observations,
            keys: ProviderVaultKeyholding {
                identity_vaults: &self.identity_vaults,
                browser_vaults: &self.other_identity_vaults,
                granted_vaults: &inspected.granted,
                password_vaults: &inspected.password,
                requested_vaults: &inspected.requested,
                session: self.identity.session(),
            },
            names: BrowserNames {
                vaults: &self.names,
                identities: &self.identity_names,
            },
            identity_logs,
            local_vault,
        }
        .listing()
    }
}
