//! Live in-memory vault scope for queued extension authority checks.
use super::{NookVaultManager, VaultCryptoState};
use nook_companion_core::{
    ActiveExtensionVault, ExtensionActiveVaultScope, ExtensionGrantAuthority,
    ExtensionGrantAuthorityRequest, PairingStorageJson, PairingVaultId,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
impl NookVaultManager {
    pub fn active_extension_vault_scope(&self) -> Result<ExtensionActiveVaultScope, JsError> {
        let VaultCryptoState::Unlocked(_) = &self.vault.crypto else {
            return Ok(ExtensionActiveVaultScope::NoActiveVault);
        };
        if self.vault.store_id.trim().is_empty() {
            return Err(JsError::new(
                "Active extension vault identity is unavailable",
            ));
        }
        Ok(ExtensionActiveVaultScope::Active(ActiveExtensionVault {
            vault_store_id: self.vault.store_id.clone().into(),
        }))
    }

    pub fn classify_extension_grant_authority(
        &self,
        stored_json: PairingStorageJson,
        vault_store_id: PairingVaultId,
    ) -> Result<ExtensionGrantAuthority, JsError> {
        Ok(ExtensionGrantAuthorityRequest {
            stored_json,
            vault_store_id,
            active_vault: self.active_extension_vault_scope()?,
        }
        .classify())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn scope_tracks_decrypted_manager_state_and_reset() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store-test".to_owned();
        assert_eq!(
            manager.active_extension_vault_scope()?,
            ExtensionActiveVaultScope::NoActiveVault
        );
        manager.apply_vault_keys(&"a".repeat(64), &"b".repeat(64))?;
        assert_eq!(
            manager.active_extension_vault_scope()?,
            ExtensionActiveVaultScope::Active(ActiveExtensionVault {
                vault_store_id: "store-test".to_owned().into()
            })
        );
        manager.reset_vault_session();
        assert_eq!(
            manager.active_extension_vault_scope()?,
            ExtensionActiveVaultScope::NoActiveVault
        );
        manager.apply_vault_keys(&"a".repeat(64), &"b".repeat(64))?;
        assert!(manager.active_extension_vault_scope().is_err());
        Ok(())
    }
}
