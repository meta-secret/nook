//! Session-independent local materialized projection helpers.

use crate::storage::indexed_db::{load_from_indexed_db, save_to_indexed_db};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub async fn read_local_vault_yaml() -> Result<String, JsError> {
    Ok(load_from_indexed_db()
        .await
        .map_err(|e| JsError::new(&e.to_string()))?
        .unwrap_or_default())
}

#[wasm_bindgen]
pub async fn write_local_vault_yaml(content: String) -> Result<(), JsError> {
    save_to_indexed_db(&content)
        .await
        .map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn vault_content_hash(content: &str) -> String {
    nook_core::VaultRevision::content_hash(content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_content_hash_is_stable_and_content_sensitive() {
        let first = vault_content_hash("vault: one");
        assert_eq!(first, vault_content_hash("vault: one"));
        assert_ne!(first, vault_content_hash("vault: two"));
        assert!(!first.is_empty());
    }
}
