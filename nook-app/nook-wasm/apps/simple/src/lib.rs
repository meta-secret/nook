use nook_wasm::__wasm_bindgen_futures as wasm_bindgen_futures;
pub use nook_wasm::*;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(start)]
pub fn start() {
    nook_wasm::configure_vault_application(nook_core::VaultApplication::Simple);
}

#[wasm_bindgen(js_name = approveExtensionDevice)]
/// Approves an extension join through the Simple application's explicit capability leaf.
///
/// # Errors
///
/// Returns a JavaScript error when the join request is invalid or vault persistence fails.
pub async fn approve_extension_device(
    manager: &mut NookVaultManager,
    join_device_id: String,
    join_public_key: String,
    join_signing_public_key: String,
    label: String,
) -> Result<Vec<NookSecretRecord>, wasm_bindgen::JsError> {
    manager
        .approve_extension_device(
            join_device_id,
            join_public_key,
            join_signing_public_key,
            label,
        )
        .await
}
