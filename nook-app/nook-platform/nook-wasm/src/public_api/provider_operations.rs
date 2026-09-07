use super::{NookProviderSelection, NookStorageConnectArgs, wasm_bindgen};
use crate::types::NookManagerStoreScope;
use nook_core::ManagerStoreScopeRef;

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_wasm_args(
    provider: nook_core::StorageProviderData,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    Ok(provider.connection_args()?.into())
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn active_vault_providers(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    scope: &NookManagerStoreScope,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let active_store_id = match scope.as_core() {
        ManagerStoreScopeRef::Unscoped => None,
        ManagerStoreScopeRef::Store(store_id) => Some(store_id),
    };
    snapshot.providers = nook_core::active_vault_providers(&snapshot.providers, active_store_id);
    Ok(snapshot)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn sync_providers_for_active_vault(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    scope: &NookManagerStoreScope,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let active_store_id = match scope.as_core() {
        ManagerStoreScopeRef::Unscoped => None,
        ManagerStoreScopeRef::Store(store_id) => Some(store_id),
    };
    snapshot.providers =
        nook_core::sync_providers_for_active_vault(&snapshot.providers, active_store_id)?;
    Ok(snapshot)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn local_provider_for_active_vault(
    snapshot: nook_core::AuthProvidersSnapshotData,
    scope: &NookManagerStoreScope,
) -> Result<NookProviderSelection, wasm_bindgen::JsError> {
    let active_store_id = match scope.as_core() {
        ManagerStoreScopeRef::Unscoped => None,
        ManagerStoreScopeRef::Store(store_id) => Some(store_id),
    };
    Ok(NookProviderSelection(
        nook_core::local_provider_for_active_vault(&snapshot.providers, active_store_id)?
            .map(|provider| provider.id),
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_label_by_id(
    snapshot: nook_core::AuthProvidersSnapshotData,
    provider_id: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::provider_label_by_id(
        &snapshot.providers,
        provider_id,
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn providers_visible_while_device_locked(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
) -> nook_core::AuthProvidersSnapshotData {
    snapshot.providers = nook_core::providers_visible_while_device_locked(&snapshot.providers);
    snapshot
}
