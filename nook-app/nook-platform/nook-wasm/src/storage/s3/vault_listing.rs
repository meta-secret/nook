#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! What an S3 location holds, read before or without connecting to it: the
//! setup and recovery listings, Check access, and identity joins read it the
//! way they read a Google Drive account or a local folder.
//!
//! S3 reports how many event objects a namespace holds, not when they were
//! made, so each vault is observed by its event count. Nothing is decrypted.

use nook_core::{
    CheckedVaultEvents, EventId, EventLogLocation, EventLogNamespaceKind, EventStorageBytes,
    IdentityId, ListedIdentityLog, LocalEventWrite, PlacedNamespace, ProviderIdentityLogEvents,
    ProviderVaultObservation, VaultPlacement,
};

use super::{S3EventStore, S3Storage};
use crate::NookError;
use crate::storage::provider_vault_listing::{
    BrowserHeldVaults, CountedVaultNamespace, InspectedVaults,
};
use crate::storage::remote_event::RemoteEventRead;

/// The namespaces at one S3 location.
#[derive(Clone, Copy)]
pub(crate) struct S3VaultListing<'a> {
    pub(crate) storage: S3Storage<'a>,
}

impl S3VaultListing<'_> {
    /// Every event one namespace holds, read and not yet verified.
    async fn namespace_events(
        &self,
        placed: &PlacedNamespace,
    ) -> Result<Vec<LocalEventWrite>, NookError> {
        let store = S3EventStore {
            storage: self.storage,
            placed,
        };
        let mut events = Vec::new();
        for event_id in store.event_ids().await? {
            if let RemoteEventRead::Retrieved(bytes) = store.read(&event_id).await? {
                events.push(LocalEventWrite { event_id, bytes });
            }
        }
        Ok(events)
    }

    /// One observation per vault namespace. A vault filed under two
    /// identities fails closed, as sync does.
    pub(crate) async fn observations(&self) -> Result<Vec<ProviderVaultObservation>, NookError> {
        let vaults = self
            .storage
            .namespaces(EventLogNamespaceKind::Vault)
            .await?;
        let mut observations = Vec::new();
        for listed in &vaults {
            let EventLogLocation::Vault(store_id) = listed.location() else {
                continue;
            };
            let VaultPlacement::Filed(placed) = VaultPlacement::of(store_id, vaults.clone())?
            else {
                continue;
            };
            let event_count = S3EventStore {
                storage: self.storage,
                placed: &placed,
            }
            .event_ids()
            .await?
            .len();
            observations.push(
                CountedVaultNamespace {
                    store_id: store_id.clone(),
                    identity: placed.identity().clone(),
                    event_count,
                }
                .observation(),
            );
        }
        Ok(observations)
    }

    /// The raw control log of every identity folder at the location.
    pub(crate) async fn identity_log_events(
        &self,
    ) -> Result<Vec<ProviderIdentityLogEvents>, NookError> {
        let mut logs = Vec::new();
        for placed in self
            .storage
            .namespaces(EventLogNamespaceKind::Identity)
            .await?
        {
            logs.push(ProviderIdentityLogEvents {
                identity_id: placed.identity().clone(),
                events: self
                    .namespace_events(&placed)
                    .await?
                    .into_iter()
                    .map(|event| event.bytes)
                    .collect(),
            });
        }
        Ok(logs)
    }

    /// Every identity log at the location, read and verified against the
    /// key this browser lists with.
    pub(crate) async fn identity_logs(
        &self,
        held: &BrowserHeldVaults,
    ) -> Result<Vec<ListedIdentityLog>, NookError> {
        self.identity_log_events()
            .await?
            .into_iter()
            .map(|events| Ok(events.read(held.listing_key.as_ref())?))
            .collect()
    }

    /// What the events of the vaults no identity here holds tell without
    /// their keys: a backup password, a grant, or a request for this app.
    pub(crate) async fn inspect_vaults(
        &self,
        held: &BrowserHeldVaults,
        observations: &[ProviderVaultObservation],
    ) -> Result<InspectedVaults, NookError> {
        let vaults = self
            .storage
            .namespaces(EventLogNamespaceKind::Vault)
            .await?;
        let mut inspected = InspectedVaults::default();
        for store_id in held.unheld(observations) {
            let VaultPlacement::Filed(placed) = VaultPlacement::of(&store_id, vaults.clone())?
            else {
                continue;
            };
            let events = self.namespace_events(&placed).await?;
            inspected.record(store_id, events, held.app_id.as_ref())?;
        }
        Ok(inspected)
    }

    /// Every vault at the location with the identity filing it and its
    /// events, read without its keys.
    pub(crate) async fn all_vault_events(&self) -> Result<Vec<CheckedVaultEvents>, NookError> {
        let mut vaults = Vec::new();
        for placed in self
            .storage
            .namespaces(EventLogNamespaceKind::Vault)
            .await?
        {
            let EventLogLocation::Vault(store_id) = placed.location().clone() else {
                continue;
            };
            vaults.push(CheckedVaultEvents {
                events: self.namespace_events(&placed).await?,
                filed_under: placed.identity().clone(),
                store_id,
            });
        }
        Ok(vaults)
    }

    /// One identity's control log events, read and not yet verified. An
    /// identity the location does not hold has none to read.
    pub(crate) async fn identity_events(
        &self,
        identity_id: &IdentityId,
    ) -> Result<Vec<EventStorageBytes>, NookError> {
        let events = self
            .namespace_events(&PlacedNamespace::identity_log(identity_id.clone()))
            .await?;
        match events.as_slice() {
            [] => Err(Self::identity_not_here()),
            [_, ..] => Ok(events.into_iter().map(|event| event.bytes).collect()),
        }
    }

    /// Write one event into an identity's log the location already holds.
    pub(crate) async fn put_identity_event(
        &self,
        identity_id: &IdentityId,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let placed = PlacedNamespace::identity_log(identity_id.clone());
        let store = S3EventStore {
            storage: self.storage,
            placed: &placed,
        };
        match store.event_ids().await?.first() {
            Some(_) => store.put_if_absent(event_id, bytes).await,
            None => Err(Self::identity_not_here()),
        }
    }

    fn identity_not_here() -> NookError {
        NookError::Database("The identity is not at this S3 location.".to_owned())
    }
}
