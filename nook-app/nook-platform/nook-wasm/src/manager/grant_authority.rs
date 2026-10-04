//! Live in-memory vault scope for queued extension authority checks.
use super::{NookVaultManager, VaultCryptoState};
use nook_companion_core::{ActiveExtensionVault, ExtensionActiveVaultScope};
use nook_core::StoreId;
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
impl NookVaultManager {
    pub fn active_extension_vault_scope(
        &self,
    ) -> Result<tsify::Ts<ExtensionActiveVaultScope>, wasm_bindgen::JsError> {
        let VaultCryptoState::Unlocked(_) = &self.vault.crypto else {
            return Tsify::into_ts(&ExtensionActiveVaultScope::NoActiveVault)
                .map_err(|_| JsError::new("Typed WASM output could not be encoded."));
        };
        if self.vault.store_id.trim().is_empty() {
            return Err(JsError::new(
                "Active extension vault identity is unavailable",
            ));
        }
        let result = ExtensionActiveVaultScope::Active(ActiveExtensionVault {
            vault_store_id: StoreId::parse(&self.vault.store_id)
                .map_err(|error| JsError::new(&error.to_string()))?,
        });
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_core::StoreId;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn scope_tracks_decrypted_manager_state_and_reset() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = StoreId::before_genesis_placeholder().into_inner();
        assert_eq!(
            manager
                .active_extension_vault_scope()?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            ExtensionActiveVaultScope::NoActiveVault
        );
        manager.apply_vault_keys(&"a".repeat(64), &"b".repeat(64))?;
        assert_eq!(
            manager
                .active_extension_vault_scope()?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            ExtensionActiveVaultScope::Active(ActiveExtensionVault {
                vault_store_id: StoreId::before_genesis_placeholder()
            })
        );
        manager.reset_vault_session();
        assert_eq!(
            manager
                .active_extension_vault_scope()?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            ExtensionActiveVaultScope::NoActiveVault
        );
        manager.apply_vault_keys(&"a".repeat(64), &"b".repeat(64))?;
        assert!(manager.active_extension_vault_scope().is_err());
        Ok(())
    }
}
