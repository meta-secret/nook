//! Extension-origin Rexie persistence for non-secret pairing metadata.
//!
//! The extension keeps its pairing grants and selected-vault setup record in
//! `IndexedDB` alongside its other local-first state. Browser-vendor storage is
//! intentionally not part of the vault persistence boundary.

use rexie::{ObjectStore, Rexie, TransactionMode};
use std::fmt;

use std::collections::HashMap;

use crate::NookError;
use nook_companion_core::{ExtensionPairingRecord, ExtensionPairingState};

const DB_NAME: &str = "nook_extension";
const STORE: &str = "pairing";
pub(crate) fn validate_entries(
    entries: &HashMap<String, ExtensionPairingRecord>,
) -> Result<(), NookError> {
    ExtensionPairingState::from_entries(entries.clone())
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))
}

fn idb_err(context: &str, error: impl fmt::Debug) -> NookError {
    NookError::IndexedDb(format!("{context}: {error:?}"))
}

async fn open_db() -> Result<rexie::Rexie, NookError> {
    Rexie::builder(DB_NAME)
        .version(1)
        .add_object_store(ObjectStore::new(STORE))
        .build()
        .await
        .map_err(|error| idb_err("nook_extension build error", error))
}

pub(crate) async fn read_all() -> Result<ExtensionPairingState, NookError> {
    let rexie = open_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadOnly)
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
        let value: ExtensionPairingRecord = serde_wasm_bindgen::from_value(value)
            .map_err(|error| idb_err("nook_extension value parse error", error))?;
        entries.insert(key, value);
    }
    validate_entries(&entries)?;
    Ok(ExtensionPairingState::from_entries(entries))
}

pub(crate) async fn write_all(state: &ExtensionPairingState) -> Result<(), NookError> {
    reconcile(state, &[]).await
}

pub(crate) async fn reconcile(
    state: &ExtensionPairingState,
    removed_keys: &[String],
) -> Result<(), NookError> {
    let entries = state.to_entries();
    validate_entries(&entries)?;
    let rexie = open_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadWrite)
        .map_err(|error| idb_err("nook_extension transaction error", error))?;
    let store = transaction
        .store(STORE)
        .map_err(|error| idb_err("nook_extension store error", error))?;
    for key in removed_keys {
        let key = serde_wasm_bindgen::to_value(key)
            .map_err(|error| idb_err("nook_extension key error", error))?;
        store
            .delete(key)
            .await
            .map_err(|error| idb_err("nook_extension delete error", error))?;
    }
    for (key, value) in &entries {
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
        .transaction(&[STORE], TransactionMode::ReadWrite)
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
    use js_sys::Date;
    use std::slice;

    use super::*;
    use nook_companion_core::{
        EXTENSION_GRANT_KEY_PREFIX as GRANT_KEY_PREFIX, ExtensionConnectScope,
        ExtensionPairingVaultType, StoredExtensionPairingGrant,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn writes_reads_and_removes_extension_pairing_state() -> anyhow::Result<()> {
        let vault_store_id = format!("store-test-{}", Date::now());
        let key = format!("{GRANT_KEY_PREFIX}{vault_store_id}");
        let mut entries = HashMap::new();
        entries.insert(
            key.clone(),
            ExtensionPairingRecord::Grant(StoredExtensionPairingGrant {
                vault_type: ExtensionPairingVaultType::Simple,
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id,
                vault_name: "Personal".to_owned(),
                approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
                scopes: vec![ExtensionConnectScope::PasswordFilling],
                sync_provider_count: 1.into(),
                event_count: 2.into(),
                event_log_heads: vec!["event-2".to_owned()],
                last_local_sync_at: "2026-07-25T00:00:01.000Z".to_owned(),
            }),
        );
        write_all(&ExtensionPairingState::from_entries(entries.clone())).await?;
        assert_eq!(read_all().await?.to_entries().get(&key), entries.get(&key));
        remove(slice::from_ref(&key)).await?;
        assert!(!read_all().await?.to_entries().contains_key(&key));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::{
        EXTENSION_GRANT_KEY_PREFIX as GRANT_KEY_PREFIX, ExtensionConnectScope,
        ExtensionPairingVaultType, StoredExtensionPairingGrant,
    };

    #[test]
    fn rejects_a_grant_stored_under_a_different_vault_key() {
        let mut entries = HashMap::new();
        entries.insert(
            format!("{GRANT_KEY_PREFIX}store-other"),
            ExtensionPairingRecord::Grant(StoredExtensionPairingGrant {
                vault_type: ExtensionPairingVaultType::Simple,
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id: "store-selected".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
                scopes: vec![ExtensionConnectScope::PasswordFilling],
                sync_provider_count: 0.into(),
                event_count: 1.into(),
                event_log_heads: vec!["event-1".to_owned()],
                last_local_sync_at: "2026-07-25T00:00:01.000Z".to_owned(),
            }),
        );

        assert!(validate_entries(&entries).is_err());
    }
}
