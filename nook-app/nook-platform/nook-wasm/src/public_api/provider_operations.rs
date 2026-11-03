use super::{NookProviderSelection, NookStorageConnection, wasm_bindgen};
use crate::types::NookManagerStoreScope;
use crate::{TypedInput, TypedOutput};
use nook_core::ProviderSelection;
use nook_core::{ActiveVaultScope, LocalProviderSelection, ManagerStoreScopeRef, ProviderRows};

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_wasm_args(
    provider: &tsify::Ts<nook_core::StorageProvider>,
) -> Result<tsify::Ts<NookStorageConnection>, wasm_bindgen::JsError> {
    let provider = provider.decode()?;

    Ok(provider.storage_connection().encode()?)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn active_vault_providers(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    scope: &NookManagerStoreScope,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
    let mut snapshot = snapshot.decode()?;

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
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn sync_providers_for_active_vault(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    scope: &NookManagerStoreScope,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
    let mut snapshot = snapshot.decode()?;

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
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn local_provider_for_active_vault(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    scope: &NookManagerStoreScope,
) -> Result<NookProviderSelection, wasm_bindgen::JsError> {
    let snapshot = snapshot.decode()?;

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
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    provider_id: &str,
) -> Result<String, wasm_bindgen::JsError> {
    let snapshot = snapshot.decode()?;

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
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
    let mut snapshot = snapshot.decode()?;
    let result = {
        snapshot.providers = ProviderRows {
            providers: &snapshot.providers,
        }
        .visible_while_locked();
        snapshot
    };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn select_remote_event_flush_providers(
    request: &tsify::Ts<nook_core::RemoteEventFlushProviderRequest>,
) -> Result<Vec<tsify::Ts<nook_core::StorageProvider>>, wasm_bindgen::JsError> {
    let request = request.decode()?;
    let result = { request.select() };
    Ok(result
        .iter()
        .map(TypedOutput::encode)
        .collect::<Result<Vec<_>, _>>()?)
}
