pub use nook_wasm::*;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(start)]
pub fn start() {
    nook_wasm::configure_vault_application(nook_core::VaultApplication::LegacyMigration);
}
