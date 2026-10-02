//! Bridge the vault-backed app inventory into the existing dashboard contract.

use super::{
    CurrentAppIdentity, LocalAppProtection, NookIdentityMemberSnapshot, NookIdentitySnapshot,
};
use crate::NookDatabase;
use nook_core::{IdentityAppInventory, IdentityRecord, IdentityVaultAppInventoryRequest};
use wasm_bindgen::JsError;

pub(super) struct BrowserIdentityVaultAppInventory<'a> {
    pub(super) identity: &'a IdentityRecord,
    pub(super) current_app: &'a CurrentAppIdentity,
    pub(super) local_protections: &'a [LocalAppProtection],
}

impl NookIdentitySnapshot {
    #[must_use]
    pub(super) async fn with_vault_app_inventory(
        mut self,
        request: BrowserIdentityVaultAppInventory<'_>,
    ) -> Result<Self, JsError> {
        let mut inventory = IdentityAppInventory::new(request.identity);
        for vault in &request.identity.vault_deks {
            let store = NookDatabase::load_local_event_store_strict(vault.store_id.as_str())
                .await
                .map_err(|error| JsError::new(&error.to_string()))?;
            let graph = store
                .load_graph(vault.store_id.as_str())
                .map_err(|error| JsError::new(&error.to_string()))?;
            inventory = inventory
                .include_vault(&IdentityVaultAppInventoryRequest {
                    store_id: &vault.store_id,
                    graph: &graph,
                })
                .map_err(|error| JsError::new(&error.to_string()))?;
        }
        self.members = inventory
            .into_members()
            .iter()
            .map(|member| {
                NookIdentityMemberSnapshot::from_member(
                    member,
                    request.current_app,
                    request.local_protections,
                )
            })
            .collect();
        self.app_key_count =
            u32::try_from(self.members.len()).map_err(|error| JsError::new(&error.to_string()))?;
        Ok(self)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub mod tests {
    use super::*;
    use crate::identity_record::NookIdentityMemberLabelKind;
    use crate::manager::NookVaultManager;
    use nook_core::{AppKey, DeviceAccessIdentityState, DeviceAccessProtectionKind};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn local_vault_roster_is_visible_without_sync_after_lock_and_reload() -> anyhow::Result<()>
    {
        let mut manager = NookVaultManager::new();
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear data: {error:?}"))?;
        manager
            .finish_pin_device_protection("inventory test pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("protect browser: {error:?}"))?;
        manager
            .connect_fresh("local".to_owned(), String::new(), String::new())
            .await
            .map_err(|error| anyhow::anyhow!("create vault: {error:?}"))?;
        let extension = AppKey::generate()?;
        let signing_key = manager
            .device_signing_public_key_js()
            .await
            .map_err(|error| anyhow::anyhow!("read signing key: {error:?}"))?;
        manager
            .approve_extension_device(
                extension.app_id().to_string(),
                extension.public_key().to_string(),
                signing_key,
                "Nook Extension".to_owned(),
            )
            .await
            .map_err(|error| anyhow::anyhow!("approve extension: {error:?}"))?;
        let before = NookDatabase::load_identity_directory().await?;
        manager.lock_device_identity();
        let reloaded = NookVaultManager::new();
        let request = reloaded
            .identity_directory_snapshot_request()
            .map_err(|error| anyhow::anyhow!("request inventory: {error:?}"))?;
        let snapshot = request
            .resolve()
            .await
            .map_err(|error| anyhow::anyhow!("read inventory: {error:?}"))?;
        assert_eq!(snapshot.length(), 1);
        assert_eq!(
            snapshot.device_access().identity_state(),
            DeviceAccessIdentityState::Locked
        );
        let identity = snapshot
            .identity(0)
            .map_err(|error| anyhow::anyhow!("read identity: {error:?}"))?;
        assert_eq!(identity.app_key_count(), 2);
        assert_eq!(identity.members().len(), 2);
        assert_eq!(identity.vault_count(), 1);
        let observed_extension = identity
            .members()
            .into_iter()
            .find(|member| member.app_id() == extension.app_id().as_str())
            .ok_or_else(|| anyhow::anyhow!("extension missing from inventory"))?;
        assert_eq!(
            observed_extension.label_kind(),
            NookIdentityMemberLabelKind::Known
        );
        assert_eq!(
            observed_extension
                .label()
                .map_err(|error| anyhow::anyhow!("read extension label: {error:?}"))?,
            "Nook Extension"
        );
        assert_eq!(
            observed_extension.local_protection(),
            DeviceAccessProtectionKind::Missing
        );
        assert!(!observed_extension.current_browser());
        assert_eq!(NookDatabase::load_identity_directory().await?, before);
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear data: {error:?}"))?;
        Ok(())
    }
}
