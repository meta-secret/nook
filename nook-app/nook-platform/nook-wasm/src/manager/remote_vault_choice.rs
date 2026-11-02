//! Which vault an import opens when its provider holds several.
//!
//! A provider target replicates every vault of an identity, each in its own
//! namespace subdirectory. Importing from it discovers those vaults; when
//! there are several the user picks one from their summaries (created, last
//! activity, event count, short id — never a decrypted name), and that
//! choice holds for the following connect.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{TypedInput, TypedOutput};
use nook_core::{LocalVaultOccupancy, ProviderVaultSummary, StorageMode, StoreId};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::event_log::VaultDiscovery;
use super::{ChosenProviderVault, NookVaultManager, PreparedProvider};
use crate::NookError;
use crate::storage::local_folder::{LocalFolderHandles, LocalFolderLocation};
use crate::storage::opened_location::OpenedLocation;

/// The vaults a staged sync provider holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookRemoteVaultDiscovery {
    /// The provider holds no vault yet.
    Empty,
    /// The one vault the import opens, already loaded into the session.
    #[serde(rename_all = "camelCase")]
    Found { store_id: String },
    /// The provider holds several vaults; choose one and discover again.
    #[serde(rename_all = "camelCase")]
    Several {
        vaults: Vec<ProviderVaultSummary>,
        /// Every identity the provider holds, for the recovery screen's
        /// cards.
        identities: Vec<nook_core::FilingIdentity>,
    },
}

impl NookVaultManager {
    /// The several vaults a location holds, summarized and related to the
    /// local identity, with every identity it holds for the recovery
    /// screen's cards. Discovery runs with no vault open.
    async fn several_discovered_vaults(
        location: OpenedLocation<'_>,
    ) -> Result<NookRemoteVaultDiscovery, NookError> {
        let listing = location.listing(&LocalVaultOccupancy::Closed).await?;
        Ok(NookRemoteVaultDiscovery::Several {
            vaults: listing.vaults,
            identities: listing.identities,
        })
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Discover the vault a staged sync provider holds without requiring or
    /// decrypting a device identity.
    #[wasm_bindgen]
    pub async fn discover_remote_vault(
        &mut self,
        connection: &tsify::Ts<crate::NookStorageConnection>,
    ) -> Result<tsify::Ts<NookRemoteVaultDiscovery>, JsError> {
        let connection = connection.decode()?;
        self.reset_vault_session();
        self.prepare_storage(&connection).await?;
        let discovery = if self.storage.mode() == StorageMode::Local {
            NookRemoteVaultDiscovery::Empty
        } else {
            match self.discover_provider_vault().await? {
                VaultDiscovery::Empty => NookRemoteVaultDiscovery::Empty,
                VaultDiscovery::Chosen => {
                    self.sync_events_from_current_provider().await?;
                    NookRemoteVaultDiscovery::Found {
                        store_id: self.vault.store_id.clone(),
                    }
                }
                VaultDiscovery::Several(_) => match &self.storage.provider {
                    PreparedProvider::Remote(remote) => {
                        Self::several_discovered_vaults(remote.location()).await?
                    }
                    PreparedProvider::ThisBrowser => NookRemoteVaultDiscovery::Empty,
                },
            }
        };
        Ok(discovery.encode()?)
    }

    /// Discover the vault a chosen backup folder holds without requiring or
    /// decrypting a device identity; one vault is loaded into the session.
    #[wasm_bindgen]
    pub async fn discover_backup_folder_vault(
        &mut self,
        handle_id: &str,
    ) -> Result<tsify::Ts<NookRemoteVaultDiscovery>, JsError> {
        self.reset_vault_session();
        let discovery = match self.discover_folder_vaults(handle_id).await? {
            VaultDiscovery::Empty => NookRemoteVaultDiscovery::Empty,
            VaultDiscovery::Chosen => {
                self.sync_local_folder_provider(handle_id).await?;
                NookRemoteVaultDiscovery::Found {
                    store_id: self.vault.store_id.clone(),
                }
            }
            VaultDiscovery::Several(_) => {
                Self::several_discovered_vaults(OpenedLocation::LocalFolder(LocalFolderLocation {
                    folder: LocalFolderHandles::current().open_folder(handle_id).await?,
                }))
                .await?
            }
        };
        Ok(discovery.encode()?)
    }

    /// Open this vault when the provider an import discovers holds several.
    #[wasm_bindgen]
    pub fn choose_remote_vault(&mut self, store_id: &str) -> Result<(), JsError> {
        self.storage.chosen_vault = ChosenProviderVault::Chosen(StoreId::parse(store_id)?);
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use crate::manager::VaultNameState;
    use crate::storage::provider_vault_listing::CountedVaultNamespace;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn discovery_drops_stale_session_state_and_keeps_a_choice() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_stale12345".to_owned();
        manager.vault.vault_name = VaultNameState::Named("Stale vault".to_owned());

        let discovered = manager
            .discover_remote_vault(&Tsify::into_ts(&nook_core::StorageConnection::Local)?)
            .await?
            .to_rust()
            .map_err(|_| JsError::new("discovery must decode"))?;

        assert_eq!(discovered, NookRemoteVaultDiscovery::Empty);
        assert!(manager.vault.store_id.is_empty());
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));

        assert!(manager.choose_remote_vault("not a store").is_err());
        manager.choose_remote_vault("store_abcdefghijk")?;
        assert_eq!(
            manager.storage.chosen_vault,
            ChosenProviderVault::Chosen(StoreId::parse("store_abcdefghijk")?)
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn folder_discovery_drops_stale_session_state_before_reading_the_folder() {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_stale12345".to_owned();
        manager.vault.vault_name = VaultNameState::Named("Stale vault".to_owned());

        assert!(
            manager
                .discover_backup_folder_vault("folder_not_registered")
                .await
                .is_err()
        );
        assert!(manager.vault.store_id.is_empty());
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    fn several_vaults_are_listed_as_summaries() -> anyhow::Result<()> {
        let store_id = StoreId::parse("store_abcdefghijk")?;
        let listing = nook_core::ProviderVaultListingRequest {
            observations: vec![
                CountedVaultNamespace {
                    store_id,
                    identity: nook_core::IdentityId::parse("idn_abcdefghijk")?,
                    event_count: 2,
                }
                .observation(),
            ],
            keys: nook_core::ProviderVaultKeyholding::NONE,
            names: nook_core::BrowserNames::NONE,
            identity_logs: &[],
            local_vault: &LocalVaultOccupancy::Closed,
        }
        .listing();
        let discovery = NookRemoteVaultDiscovery::Several {
            vaults: listing.vaults,
            identities: listing.identities,
        };
        assert_eq!(
            serde_json::to_value(&discovery)?,
            serde_json::json!({
                "state": "several",
                "vaults": [{
                    "storeId": "store_abcdefghijk",
                    "shortId": "abcdefgh",
                    "name": { "state": "unknown" },
                    "identity": {
                        "identityId": "idn_abcdefghijk",
                        "shortId": "abcdefgh",
                        "name": { "state": "unknown" },
                        "words": nook_core::IdentityWords::of(
                            &nook_core::IdentityId::parse("idn_abcdefghijk")?
                        )
                        .words(),
                        "log": { "state": "absent" },
                    },
                    "created": { "state": "unreported" },
                    "lastActivity": { "state": "unreported" },
                    "eventCount": 2,
                    "access": { "state": "unchecked" },
                    "actions": ["importSeparately"],
                }],
                "identities": [],
            })
        );
        Ok(())
    }
}
