//! The keyrings a staged sync provider keeps, for recovering one.
//!
//! A provider keeps keyrings, not vaults: each identity's control log and
//! the event log of every vault it owns, each in its own namespace
//! subdirectory. Recovering from a provider therefore lists its keyrings,
//! with the vaults filed under them for their cards (created, last
//! activity, event count, short id — never a decrypted name). A keyring is
//! listed whether it owns several vaults, one, or none; no vault is opened
//! on its own.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{TypedInput, TypedOutput};
use nook_core::ProviderKeyringDiscovery;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{NookVaultManager, PreparedProvider};
use crate::storage::local_folder::{LocalFolderHandles, LocalFolderLocation};
use crate::storage::opened_location::OpenedLocation;

#[wasm_bindgen]
impl NookVaultManager {
    /// The keyrings a staged sync provider keeps, read without requiring or
    /// decrypting a device identity. Discovery runs with no vault open.
    #[wasm_bindgen]
    pub async fn discover_provider_keyrings(
        &mut self,
        connection: &tsify::Ts<crate::NookStorageConnection>,
    ) -> Result<tsify::Ts<ProviderKeyringDiscovery>, JsError> {
        let connection = connection.decode()?;
        self.reset_vault_session();
        self.prepare_storage(&connection).await?;
        let discovery = match &self.storage.provider {
            PreparedProvider::Remote(remote) => {
                remote.location().listing().await?.keyring_discovery()
            }
            PreparedProvider::ThisBrowser => ProviderKeyringDiscovery::Empty,
        };
        Ok(discovery.encode()?)
    }

    /// The keyrings a chosen backup folder keeps, read without requiring or
    /// decrypting a device identity.
    #[wasm_bindgen]
    pub async fn discover_backup_folder_keyrings(
        &mut self,
        handle_id: &str,
    ) -> Result<tsify::Ts<ProviderKeyringDiscovery>, JsError> {
        self.reset_vault_session();
        let folder = OpenedLocation::LocalFolder(LocalFolderLocation {
            folder: LocalFolderHandles::current().open_folder(handle_id).await?,
        });
        Ok(folder.listing().await?.keyring_discovery().encode()?)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use crate::manager::VaultNameState;
    use tsify::Tsify;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn discovery_drops_stale_session_state() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_stale12345".to_owned();
        manager.vault.vault_name = VaultNameState::Named("Stale vault".to_owned());

        let discovered = manager
            .discover_provider_keyrings(&Tsify::into_ts(&nook_core::StorageConnection::Local)?)
            .await?
            .to_rust()
            .map_err(|_| JsError::new("discovery must decode"))?;

        assert_eq!(discovered, ProviderKeyringDiscovery::Empty);
        assert!(manager.vault.store_id.is_empty());
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));
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
                .discover_backup_folder_keyrings("folder_not_registered")
                .await
                .is_err()
        );
        assert!(manager.vault.store_id.is_empty());
        assert!(matches!(manager.vault.vault_name, VaultNameState::Unnamed));
    }
}
