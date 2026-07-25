//! Extension-origin Rexie persistence for non-secret pairing metadata.
//!
//! The extension keeps its pairing grants and selected-vault setup record in
//! `IndexedDB` alongside its other local-first state. Browser-vendor storage is
//! intentionally not part of the vault persistence boundary.

use std::collections::HashMap;

use crate::NookError;

const DB_NAME: &str = "nook_extension";
const STORE: &str = "pairing";

fn idb_err(context: &str, error: impl std::fmt::Debug) -> NookError {
    NookError::IndexedDb(format!("{context}: {error:?}"))
}

async fn open_db() -> Result<rexie::Rexie, NookError> {
    rexie::Rexie::builder(DB_NAME)
        .version(1)
        .add_object_store(rexie::ObjectStore::new(STORE))
        .build()
        .await
        .map_err(|error| idb_err("nook_extension build error", error))
}

pub(crate) async fn read_all() -> Result<HashMap<String, serde_json::Value>, NookError> {
    let rexie = open_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadOnly)
        .map_err(|error| idb_err("nook_extension transaction error", error))?;
    let store = transaction
        .store(STORE)
        .map_err(|error| idb_err("nook_extension store error", error))?;
    let keys = store
        .get_all_keys(None, None)
        .await
        .map_err(|error| idb_err("nook_extension get keys error", error))?;
    let values = store
        .get_all(None, None)
        .await
        .map_err(|error| idb_err("nook_extension get values error", error))?;
    transaction
        .done()
        .await
        .map_err(|error| idb_err("nook_extension transaction done error", error))?;

    let mut entries = HashMap::with_capacity(keys.len());
    for (key, value) in keys.into_iter().zip(values) {
        let key: String = serde_wasm_bindgen::from_value(key)
            .map_err(|error| idb_err("nook_extension key parse error", error))?;
        let value = serde_wasm_bindgen::from_value(value)
            .map_err(|error| idb_err("nook_extension value parse error", error))?;
        entries.insert(key, value);
    }
    Ok(entries)
}

pub(crate) async fn write_all(
    entries: &HashMap<String, serde_json::Value>,
) -> Result<(), NookError> {
    let rexie = open_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|error| idb_err("nook_extension transaction error", error))?;
    let store = transaction
        .store(STORE)
        .map_err(|error| idb_err("nook_extension store error", error))?;
    for (key, value) in entries {
        let key = serde_wasm_bindgen::to_value(key)
            .map_err(|error| idb_err("nook_extension key error", error))?;
        let value = serde_wasm_bindgen::to_value(value)
            .map_err(|error| idb_err("nook_extension serialize error", error))?;
        store
            .put(&value, Some(&key))
            .await
            .map_err(|error| idb_err("nook_extension put error", error))?;
    }
    transaction
        .done()
        .await
        .map(|_| ())
        .map_err(|error| idb_err("nook_extension transaction done error", error))
}

pub(crate) async fn remove(keys: &[String]) -> Result<(), NookError> {
    let rexie = open_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|error| idb_err("nook_extension transaction error", error))?;
    let store = transaction
        .store(STORE)
        .map_err(|error| idb_err("nook_extension store error", error))?;
    for key in keys {
        let key = serde_wasm_bindgen::to_value(key)
            .map_err(|error| idb_err("nook_extension key error", error))?;
        store
            .delete(key)
            .await
            .map_err(|error| idb_err("nook_extension delete error", error))?;
    }
    transaction
        .done()
        .await
        .map(|_| ())
        .map_err(|error| idb_err("nook_extension transaction done error", error))
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod wasm_idb_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn writes_reads_and_removes_extension_pairing_state() {
        let key = format!("test-{}", js_sys::Date::now());
        let mut entries = HashMap::new();
        entries.insert(
            key.clone(),
            serde_json::json!({"status": "ready", "vaultStoreId": "store-test"}),
        );
        write_all(&entries).await.expect("write extension state");
        assert_eq!(
            read_all().await.expect("read extension state").get(&key),
            entries.get(&key)
        );
        remove(std::slice::from_ref(&key))
            .await
            .expect("remove extension state");
        assert!(
            !read_all()
                .await
                .expect("read removed extension state")
                .contains_key(&key)
        );
    }
}
