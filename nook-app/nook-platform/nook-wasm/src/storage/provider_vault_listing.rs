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
    AppId, BrowserIdentityVault, BrowserVaultKeys, DriveEventParent, EventId, EventLogLocation,
    EventLogNamespaceKind, KnownVaultName, LocalEventWrite, LocalVaultOccupancy,
    ProviderVaultEvents, ProviderVaultKeyholding, ProviderVaultListing,
    ProviderVaultListingRequest, ProviderVaultObservation, ProviderVaultStanding,
    ProviderVaultTime, StoreId,
};

use super::drive_events::DriveEventStore;
use super::drive_namespace::DriveNamespace;
use super::remote_event::RemoteEventRead;
use crate::{NookDatabase, NookError};

/// The vault namespaces under one Google Drive Nook root.
pub(crate) struct DriveVaultListing<'a> {
    pub(crate) token: &'a str,
    pub(crate) root: &'a DriveEventParent,
}

impl DriveVaultListing<'_> {
    /// One observation per vault namespace; a namespace duplicated by hand
    /// fails closed, as sync does.
    pub(crate) async fn observations(&self) -> Result<Vec<ProviderVaultObservation>, NookError> {
        let folders =
            DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Vault)
                .await?;
        let mut observations: Vec<ProviderVaultObservation> = Vec::new();
        for folder in folders {
            // A namespace name that is no store id is not a vault.
            let Ok(store_id) = StoreId::parse(&folder.namespace_id) else {
                continue;
            };
            if observations
                .iter()
                .any(|observation| observation.store_id == store_id)
            {
                return Err(NookError::Drive(
                    "Google Drive contains ambiguous namespace folders; sync stopped before choosing one."
                        .to_owned(),
                ));
            }
            let location = EventLogLocation::Vault(store_id.clone());
            let events = DriveEventStore {
                token: self.token,
                parent: &folder.folder,
                location: &location,
            }
            .list_drive_event_times()
            .await?;
            observations.push(ProviderVaultObservation {
                store_id,
                namespace_created: folder.created.provider_time()?,
                events,
            });
        }
        Ok(observations)
    }
}

/// An observation for a transport that only counts a namespace's events.
pub(crate) struct CountedVaultNamespace {
    pub(crate) store_id: StoreId,
    pub(crate) event_count: usize,
}

impl CountedVaultNamespace {
    pub(crate) fn observation(self) -> ProviderVaultObservation {
        ProviderVaultObservation {
            store_id: self.store_id,
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
        DriveNamespace::list_folders(self.token, self.root, EventLogNamespaceKind::Vault)
            .await?
            .into_iter()
            .find(|folder| StoreId::parse(&folder.namespace_id).is_ok_and(|id| &id == store_id))
            .map(|folder| folder.folder)
            .ok_or_else(|| NookError::Drive("The vault is not in this Nook folder.".to_owned()))
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
        let store = DriveEventStore {
            token: self.token,
            parent: folder,
            location: &location,
        };
        let mut events = Vec::new();
        for raw_id in store.list_drive_event_ids().await? {
            let event_id = EventId::parse(&raw_id)?;
            if let RemoteEventRead::Retrieved(bytes) = store.read_drive_event(&event_id).await? {
                events.push(LocalEventWrite { event_id, bytes });
            }
        }
        Ok(events)
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
        let mut inspected = InspectedVaults::default();
        for folder in folders {
            let Ok(store_id) = StoreId::parse(&folder.namespace_id) else {
                continue;
            };
            if !store_ids.contains(&store_id) {
                continue;
            }
            let events = self.namespace_events(&store_id, &folder.folder).await?;
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
    /// The names this browser keeps for its registered vaults.
    pub(crate) names: Vec<KnownVaultName>,
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
        let keys = BrowserVaultKeys {
            directory: &directory,
            keyring: &keyring,
        };
        Ok(Self {
            identity_vaults: keys.identity_vaults(),
            other_identity_vaults: keys.other_identity_vaults(),
            app_id: keys.identity_app_id(),
            names,
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
            names: &held.names,
            local_vault: self.local_vault,
        }
        .listing()
    }
}
