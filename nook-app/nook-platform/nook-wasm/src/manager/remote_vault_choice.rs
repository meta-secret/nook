//! Which vault an import opens when its provider holds several.
//!
//! A provider target replicates every vault of an identity, each in its own
//! namespace. Importing from it discovers those vaults; when there are several
//! the user picks one, and that choice holds for the following connect.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{StorageMode, StoreId};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::event_log::VaultDiscovery;
use super::{ChosenProviderVault, NookVaultManager};

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
    Several { store_ids: Vec<String> },
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Discover the vault a staged sync provider holds without requiring or
    /// decrypting a device identity.
    #[wasm_bindgen]
    pub async fn discover_remote_vault(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<tsify::Ts<NookRemoteVaultDiscovery>, JsError> {
        self.reset_vault_session();
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let discovery = if self.storage.mode == StorageMode::Local {
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
                VaultDiscovery::Several(store_ids) => NookRemoteVaultDiscovery::Several {
                    store_ids: store_ids
                        .iter()
                        .map(|store_id| store_id.as_str().to_owned())
                        .collect(),
                },
            }
        };
        Tsify::into_ts(&discovery)
            .map_err(|_| JsError::new("Typed WASM output could not be encoded."))
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
            .discover_remote_vault("local".to_owned(), String::new(), String::new())
            .await?
            .to_rust()
            .map_err(|_| JsError::new("discovery must decode"))?;

        assert_eq!(discovered, NookRemoteVaultDiscovery::Empty);
        assert!(manager.vault.store_id.is_empty());
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));

        assert!(manager.choose_remote_vault("not-a-store").is_err());
        manager.choose_remote_vault("store_abcdefghijk")?;
        assert_eq!(
            manager.storage.chosen_vault,
            ChosenProviderVault::Chosen(StoreId::parse("store_abcdefghijk")?)
        );
        Ok(())
    }
}
