use super::{NookProviderSelection, NookStorageConnectArgs, wasm_bindgen};
use crate::types::NookManagerStoreScope;
use nook_core::ProviderSelection;
use nook_core::{ActiveVaultScope, LocalProviderSelection, ManagerStoreScopeRef, ProviderRows};
use tsify::Tsify;
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_wasm_args(
    provider: &tsify::Ts<nook_core::StorageProviderData>,
) -> Result<tsify::Ts<NookStorageConnectArgs>, wasm_bindgen::JsError> {
    let provider = provider
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let result = Ok::<_, wasm_bindgen::JsError>(provider.connection_args()?)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn active_vault_providers(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshotData>,
    scope: &NookManagerStoreScope,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshotData>, wasm_bindgen::JsError> {
    let mut snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let active_store_id = match scope.as_core() {
        ManagerStoreScopeRef::Unscoped => ActiveVaultScope::Unselected,
        ManagerStoreScopeRef::Store(store_id) => ActiveVaultScope::StoreId(store_id.to_owned()),
    };
    snapshot.providers = ProviderRows {
        providers: &snapshot.providers,
    }
    .for_vault(&active_store_id)
    .active();
    let result = Ok::<_, wasm_bindgen::JsError>(snapshot)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn sync_providers_for_active_vault(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshotData>,
    scope: &NookManagerStoreScope,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshotData>, wasm_bindgen::JsError> {
    let mut snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let active_store_id = match scope.as_core() {
        ManagerStoreScopeRef::Unscoped => ActiveVaultScope::Unselected,
        ManagerStoreScopeRef::Store(store_id) => ActiveVaultScope::StoreId(store_id.to_owned()),
    };
    snapshot.providers = ProviderRows {
        providers: &snapshot.providers,
    }
    .for_vault(&active_store_id)
    .sync();
    let result = Ok::<_, wasm_bindgen::JsError>(snapshot)?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn local_provider_for_active_vault(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshotData>,
    scope: &NookManagerStoreScope,
) -> Result<NookProviderSelection, wasm_bindgen::JsError> {
    let snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

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
                ProviderSelection::Selected(provider.id.into())
            }
            LocalProviderSelection::Unseeded => ProviderSelection::Unavailable,
        },
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_label_by_id(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshotData>,
    provider_id: &str,
) -> Result<String, wasm_bindgen::JsError> {
    let snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    Ok(ProviderRows {
        providers: &snapshot.providers,
    }
    .label(provider_id))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn providers_visible_while_device_locked(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshotData>,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshotData>, wasm_bindgen::JsError> {
    let mut snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    let result = {
        snapshot.providers = ProviderRows {
            providers: &snapshot.providers,
        }
        .visible_while_locked();
        snapshot
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn select_remote_event_flush_providers(
    request: &tsify::Ts<nook_core::RemoteEventFlushProviderRequest>,
) -> Result<Vec<tsify::Ts<nook_core::StorageProviderData>>, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { request.select() };
    result
        .iter()
        .map(Tsify::into_ts)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}
