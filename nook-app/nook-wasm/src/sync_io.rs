//! Session-independent local materialized projection helpers.

use crate::storage::indexed_db::{load_from_indexed_db, save_to_indexed_db};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = readLocalVaultYaml)]
pub async fn read_local_vault_yaml() -> Result<String, JsError> {
    Ok(load_from_indexed_db()
        .await
        .map_err(|e| JsError::new(&e.to_string()))?
        .unwrap_or_default())
}

#[wasm_bindgen(js_name = writeLocalVaultYaml)]
pub async fn write_local_vault_yaml(content: String) -> Result<(), JsError> {
    save_to_indexed_db(&content)
        .await
        .map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen(js_name = vaultContentHash)]
pub fn vault_content_hash(content: &str) -> String {
    nook_core::vault_content_hash(content)
}
