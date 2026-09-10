//! Session-independent local materialized projection helpers.

use crate::NookDatabase;
use crate::VaultSnapshotLookup;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn read_local_vault_yaml() -> Result<String, JsError> {
    Ok(
        match NookDatabase::load_from_indexed_db()
            .await
            .map_err(|e| JsError::new(&e.to_string()))?
        {
            VaultSnapshotLookup::Stored(content) => content,
            VaultSnapshotLookup::NotStored => String::new(),
        },
    )
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn write_local_vault_yaml(content: String) -> Result<(), JsError> {
    NookDatabase::save_to_indexed_db(&content)
        .await
        .map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn vault_content_hash(content: &str) -> String {
    nook_core::VaultRevision::content_hash(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn vault_content_hash_is_stable_and_content_sensitive() {
        let first = vault_content_hash("vault: one");
        assert_eq!(first, vault_content_hash("vault: one"));
        assert_ne!(first, vault_content_hash("vault: two"));
        assert!(!first.is_empty());
    }
}
