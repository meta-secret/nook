//! Extension-origin Rexie persistence for non-secret pairing metadata.
//!
//! The extension keeps its pairing grants and selected-vault setup record in
//! `IndexedDB` alongside its other local-first state. Browser-vendor storage is
//! intentionally not part of the vault persistence boundary.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::NookError;

const DB_NAME: &str = "nook_extension";
const STORE: &str = "pairing";
pub(crate) const SETUP_KEY: &str = "nook:extension-setup";
pub(crate) const GRANT_KEY_PREFIX: &str = "nook:extension-pairing-grant:";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionPairingGrant {
    vault_type: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    device_label: String,
    vault_store_id: String,
    vault_name: String,
    approved_at: String,
    scopes: Vec<String>,
    sync_provider_count: u32,
    event_count: u32,
    event_log_heads: Vec<String>,
    last_local_sync_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionReadySetup {
    status: String,
    device_label: String,
    paired_vaults: Vec<String>,
    selected_vault_store_id: String,
    selected_vault_name: String,
    sync_provider_count: u32,
    event_count: u32,
    event_log_heads: Vec<String>,
    last_local_sync_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(untagged)]
pub(crate) enum ExtensionPairingRecord {
    Grant(ExtensionPairingGrant),
    Setup(ExtensionReadySetup),
}

fn non_empty(value: &str) -> bool {
    !value.trim().is_empty()
}

impl ExtensionPairingRecord {
    fn validate_for_key(&self, key: &str) -> Result<(), NookError> {
        match self {
            Self::Grant(grant) => {
                let Some(vault_store_id) = key.strip_prefix(GRANT_KEY_PREFIX) else {
                    return Err(NookError::Database(
                        "Extension pairing grant used an unsupported key.".to_owned(),
                    ));
                };
                if grant.vault_type != "simple"
                    || vault_store_id != grant.vault_store_id
                    || !non_empty(&grant.device_id)
                    || !non_empty(&grant.device_public_key)
                    || !non_empty(&grant.device_signing_public_key)
                    || !non_empty(&grant.device_label)
                    || !non_empty(&grant.vault_name)
                    || !non_empty(&grant.approved_at)
                    || grant.scopes.iter().any(|scope| !non_empty(scope))
                    || grant.event_count == 0
                    || grant.event_log_heads.is_empty()
                    || grant.event_log_heads.iter().any(|head| !non_empty(head))
                    || !non_empty(&grant.last_local_sync_at)
                {
                    return Err(NookError::Database(
                        "Extension pairing grant is incomplete or inconsistent.".to_owned(),
                    ));
                }
            }
            Self::Setup(setup) => {
                if key != SETUP_KEY
                    || setup.status != "ready"
                    || !non_empty(&setup.device_label)
                    || setup.paired_vaults.is_empty()
                    || setup.paired_vaults.iter().any(|vault| !non_empty(vault))
                    || !non_empty(&setup.selected_vault_store_id)
                    || !non_empty(&setup.selected_vault_name)
                    || setup.event_count == 0
                    || setup.event_log_heads.is_empty()
                    || setup.event_log_heads.iter().any(|head| !non_empty(head))
                    || !non_empty(&setup.last_local_sync_at)
                {
                    return Err(NookError::Database(
                        "Extension pairing setup is incomplete or inconsistent.".to_owned(),
                    ));
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_entries(
    entries: &HashMap<String, ExtensionPairingRecord>,
) -> Result<(), NookError> {
    for (key, record) in entries {
        record.validate_for_key(key)?;
    }
    Ok(())
}

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

pub(crate) async fn read_all() -> Result<HashMap<String, ExtensionPairingRecord>, NookError> {
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
        let value: ExtensionPairingRecord = serde_wasm_bindgen::from_value(value)
            .map_err(|error| idb_err("nook_extension value parse error", error))?;
        entries.insert(key, value);
    }
    validate_entries(&entries)?;
    Ok(entries)
}

pub(crate) async fn write_all(
    entries: &HashMap<String, ExtensionPairingRecord>,
) -> Result<(), NookError> {
    validate_entries(entries)?;
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
        let vault_store_id = format!("store-test-{}", js_sys::Date::now());
        let key = format!("{GRANT_KEY_PREFIX}{vault_store_id}");
        let mut entries = HashMap::new();
        entries.insert(
            key.clone(),
            ExtensionPairingRecord::Grant(ExtensionPairingGrant {
                vault_type: "simple".to_owned(),
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id,
                vault_name: "Personal".to_owned(),
                approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
                scopes: vec!["password-filling".to_owned()],
                sync_provider_count: 1,
                event_count: 2,
                event_log_heads: vec!["event-2".to_owned()],
                last_local_sync_at: "2026-07-25T00:00:01.000Z".to_owned(),
            }),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_grant_stored_under_a_different_vault_key() {
        let mut entries = HashMap::new();
        entries.insert(
            format!("{GRANT_KEY_PREFIX}store-other"),
            ExtensionPairingRecord::Grant(ExtensionPairingGrant {
                vault_type: "simple".to_owned(),
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id: "store-selected".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
                scopes: vec!["password-filling".to_owned()],
                sync_provider_count: 0,
                event_count: 1,
                event_log_heads: vec!["event-1".to_owned()],
                last_local_sync_at: "2026-07-25T00:00:01.000Z".to_owned(),
            }),
        );

        assert!(validate_entries(&entries).is_err());
    }
}
