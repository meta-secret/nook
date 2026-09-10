use super::{NookProviderSelection, NookStorageConnectArgs, wasm_bindgen};
use crate::types::NookManagerStoreScope;
use nook_core::{ActiveVaultScope, LocalProviderSelection, ManagerStoreScopeRef, ProviderRows};

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn provider_wasm_args(
    provider: nook_core::StorageProviderData,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    Ok(provider.connection_args()?.into())
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn active_vault_providers(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    scope: &NookManagerStoreScope,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let active_store_id = match scope.as_core() {
        ManagerStoreScopeRef::Unscoped => ActiveVaultScope::Unselected,
        ManagerStoreScopeRef::Store(store_id) => ActiveVaultScope::StoreId(store_id.to_owned()),
    };
    snapshot.providers = ProviderRows {
        providers: &snapshot.providers,
    }
    .for_vault(&active_store_id)
    .active();
    Ok(snapshot)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn sync_providers_for_active_vault(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    scope: &NookManagerStoreScope,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let active_store_id = match scope.as_core() {
        ManagerStoreScopeRef::Unscoped => ActiveVaultScope::Unselected,
        ManagerStoreScopeRef::Store(store_id) => ActiveVaultScope::StoreId(store_id.to_owned()),
    };
    snapshot.providers = ProviderRows {
        providers: &snapshot.providers,
    }
    .for_vault(&active_store_id)
    .sync();
    Ok(snapshot)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn local_provider_for_active_vault(
    snapshot: nook_core::AuthProvidersSnapshotData,
    scope: &NookManagerStoreScope,
) -> Result<NookProviderSelection, wasm_bindgen::JsError> {
    let active_store_id = match scope.as_core() {
        ManagerStoreScopeRef::Unscoped => ActiveVaultScope::Unselected,
        ManagerStoreScopeRef::Store(store_id) => ActiveVaultScope::StoreId(store_id.to_owned()),
    };
    Ok(NookProviderSelection(
        match (ProviderRows {
            providers: &snapshot.providers,
        })
        .for_vault(&active_store_id)
        .local()
        {
            LocalProviderSelection::Selected(provider) => {
                nook_core::ProviderSelection::Selected(provider.id.into())
            }
            LocalProviderSelection::Unseeded => nook_core::ProviderSelection::Unavailable,
        },
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn provider_label_by_id(
    snapshot: nook_core::AuthProvidersSnapshotData,
    provider_id: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(ProviderRows {
        providers: &snapshot.providers,
    }
    .label(provider_id))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn providers_visible_while_device_locked(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
) -> nook_core::AuthProvidersSnapshotData {
    snapshot.providers = ProviderRows {
        providers: &snapshot.providers,
    }
    .visible_while_locked();
    snapshot
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn select_remote_event_flush_providers(
    request: nook_core::RemoteEventFlushProviderRequest,
) -> Vec<nook_core::StorageProviderData> {
    request.select()
}
