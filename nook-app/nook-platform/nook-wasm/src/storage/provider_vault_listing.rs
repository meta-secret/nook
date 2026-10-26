//! What a provider's Nook root holds, read from transport listings alone.
//!
//! Each vault namespace is its own subdirectory of the root. Google Drive
//! reports when each namespace folder and event file was created; the other
//! transports report only how many event files a namespace holds. Nothing is
//! downloaded or decrypted.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{
    DriveEventParent, EventLogLocation, EventLogNamespaceKind, IdentitySelection,
    LocalVaultOccupancy, ProviderVaultListing, ProviderVaultListingRequest,
    ProviderVaultObservation, ProviderVaultTime, StoreId,
};

use super::drive_events::DriveEventStore;
use super::drive_namespace::DriveNamespace;
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

/// Relate provider observations to the identity selected on this device.
pub(crate) struct LocalVaultClassification<'a> {
    pub(crate) local_vault: &'a LocalVaultOccupancy,
}

impl LocalVaultClassification<'_> {
    /// Vaults the selected local identity holds. No selected identity holds
    /// none.
    async fn identity_vaults() -> Result<Vec<StoreId>, NookError> {
        let directory = NookDatabase::load_identity_directory().await?;
        let IdentitySelection::Selected(identity_id) = directory.selection() else {
            return Ok(Vec::new());
        };
        Ok(directory
            .identities()
            .iter()
            .filter(|identity| &identity.identity_id == identity_id)
            .flat_map(|identity| identity.vault_deks.iter())
            .map(|dek| dek.store_id.clone())
            .collect())
    }

    pub(crate) async fn listing(
        &self,
        observations: Vec<ProviderVaultObservation>,
    ) -> Result<ProviderVaultListing, NookError> {
        let identity_vaults = Self::identity_vaults().await?;
        Ok(ProviderVaultListingRequest {
            observations,
            identity_vaults: &identity_vaults,
            local_vault: self.local_vault,
        }
        .listing())
    }
}
