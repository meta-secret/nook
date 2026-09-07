//! `IndexedDB` persistence for verified Sentinel genesis deliveries.
//!
//! This adapter owns the recipient-bound delivery catalog and its resumable
//! finalization marker. Verification remains in `nook-core`; this module only
//! persists the identifiers and encrypted delivery JSON returned by that
//! verified boundary.

use crate::NookError;
use rexie::TransactionMode;
use serde::{Deserialize, Serialize};

const SENTINEL_GENESIS_SHARE_CATALOG_KEY: &str = "sentinel_genesis_share_catalog";
pub(crate) const SENTINEL_GENESIS_FINALIZATION_PENDING_KEY: &str =
    "sentinel_genesis_finalization_pending";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SentinelGenesisShareCatalogEntry {
    pub store_id: String,
    pub device_id: String,
    pub delivery_json: String,
}

fn sentinel_genesis_share_key(store_id: &str, device_id: &str) -> String {
    format!("sentinel_genesis_share:{store_id}:{device_id}")
}

/// Persist an already verified, recipient-bound Sentinel share delivery.
pub(crate) async fn save_sentinel_genesis_share_delivery(
    store_id: &str,
    device_id: &str,
    delivery_json: &str,
) -> Result<(), NookError> {
    if store_id.trim().is_empty() || device_id.trim().is_empty() || delivery_json.trim().is_empty()
    {
        return Err(NookError::Database(
            "Refusing to persist an incomplete Sentinel genesis share delivery.".to_owned(),
        ));
    }
    let rexie = super::open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let catalog_key = serde_wasm_bindgen::to_value(SENTINEL_GENESIS_SHARE_CATALOG_KEY)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let raw_catalog = store
        .get(catalog_key.clone())
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {e:?}")))?;
    let mut catalog = match raw_catalog {
        Some(value) if !value.is_null() && !value.is_undefined() => {
            let json: String = serde_wasm_bindgen::from_value(value)
                .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {e:?}")))?;
            serde_json::from_str::<Vec<SentinelGenesisShareCatalogEntry>>(&json).map_err(|e| {
                NookError::IndexedDb(format!("Sentinel share catalog parse error: {e}"))
            })?
        }
        _ => Vec::new(),
    };
    catalog.retain(|entry| entry.store_id != store_id || entry.device_id != device_id);
    catalog.push(SentinelGenesisShareCatalogEntry {
        store_id: store_id.to_owned(),
        device_id: device_id.to_owned(),
        delivery_json: delivery_json.to_owned(),
    });
    let delivery_key =
        serde_wasm_bindgen::to_value(&sentinel_genesis_share_key(store_id, device_id))
            .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let delivery_value = serde_wasm_bindgen::to_value(delivery_json)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    store
        .put(&delivery_value, Some(&delivery_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    let catalog_json = serde_json::to_string(&catalog).map_err(|e| {
        NookError::IndexedDb(format!("Sentinel share catalog serialize error: {e}"))
    })?;
    let catalog_value = serde_wasm_bindgen::to_value(&catalog_json)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    store
        .put(&catalog_value, Some(&catalog_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

pub(crate) async fn load_sentinel_genesis_share_delivery(
    store_id: &str,
    device_id: &str,
) -> Result<Option<String>, NookError> {
    if store_id.trim().is_empty() || device_id.trim().is_empty() {
        return Ok(None);
    }
    super::idb_get_string(&sentinel_genesis_share_key(store_id, device_id)).await
}

pub(crate) async fn list_sentinel_genesis_share_deliveries(
    device_id: &str,
) -> Result<Vec<SentinelGenesisShareCatalogEntry>, NookError> {
    if device_id.trim().is_empty() {
        return Ok(Vec::new());
    }
    let Some(json) = super::idb_get_string(SENTINEL_GENESIS_SHARE_CATALOG_KEY).await? else {
        return Ok(Vec::new());
    };
    let mut entries: Vec<SentinelGenesisShareCatalogEntry> = serde_json::from_str(&json)
        .map_err(|e| NookError::IndexedDb(format!("Sentinel share catalog parse error: {e}")))?;
    entries.retain(|entry| entry.device_id == device_id);
    entries.sort_by(|left, right| left.store_id.cmp(&right.store_id));
    Ok(entries)
}

pub(crate) async fn save_sentinel_genesis_finalization_pending(
    pending_json: &str,
) -> Result<(), NookError> {
    if pending_json.trim().is_empty() {
        return Err(NookError::Database(
            "Refusing to persist an empty Sentinel finalization plan.".to_owned(),
        ));
    }
    super::idb_put_string(SENTINEL_GENESIS_FINALIZATION_PENDING_KEY, pending_json).await
}

pub(crate) async fn load_sentinel_genesis_finalization_pending() -> Result<Option<String>, NookError>
{
    super::idb_get_string(SENTINEL_GENESIS_FINALIZATION_PENDING_KEY).await
}

pub(crate) async fn clear_sentinel_genesis_finalization_pending() -> Result<(), NookError> {
    super::idb_delete_key(SENTINEL_GENESIS_FINALIZATION_PENDING_KEY).await
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use rexie::Rexie;
    use wasm_bindgen_test::*;

    use super::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn verified_sentinel_genesis_share_delivery_round_trips()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let store_id = "store_testsentinel11";
        let device_id = "0123456789abcdef";
        let payload = r#"{"version":1,"ciphertext":"verified"}"#;

        save_sentinel_genesis_share_delivery(store_id, device_id, payload).await?;

        assert_eq!(
            load_sentinel_genesis_share_delivery(store_id, device_id)
                .await?
                .as_deref(),
            Some(payload)
        );
        assert_eq!(
            list_sentinel_genesis_share_deliveries(device_id).await?,
            vec![SentinelGenesisShareCatalogEntry {
                store_id: store_id.to_owned(),
                device_id: device_id.to_owned(),
                delivery_json: payload.to_owned(),
            }]
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn sentinel_storage_rejects_empty_inputs_without_writes()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        assert!(
            save_sentinel_genesis_share_delivery("", "device", "payload")
                .await
                .is_err()
        );
        assert!(
            load_sentinel_genesis_share_delivery("", "device")
                .await?
                .is_none()
        );
        assert!(list_sentinel_genesis_share_deliveries("").await?.is_empty());
        assert!(
            save_sentinel_genesis_finalization_pending(" ")
                .await
                .is_err()
        );
        assert!(
            load_sentinel_genesis_finalization_pending()
                .await?
                .is_none()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn sentinel_catalog_replaces_same_identity_and_filters_devices()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        save_sentinel_genesis_share_delivery("store_b", "device-1", "old").await?;
        save_sentinel_genesis_share_delivery("store_a", "device-2", "other").await?;
        save_sentinel_genesis_share_delivery("store_b", "device-1", "new").await?;
        assert_eq!(
            list_sentinel_genesis_share_deliveries("device-1").await?,
            vec![SentinelGenesisShareCatalogEntry {
                store_id: "store_b".to_owned(),
                device_id: "device-1".to_owned(),
                delivery_json: "new".to_owned(),
            }]
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn finalization_pending_round_trip_can_be_cleared() -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        save_sentinel_genesis_finalization_pending("{\"store\":\"pending\"}").await?;
        assert_eq!(
            load_sentinel_genesis_finalization_pending()
                .await?
                .as_deref(),
            Some("{\"store\":\"pending\"}")
        );
        clear_sentinel_genesis_finalization_pending().await?;
        assert!(
            load_sentinel_genesis_finalization_pending()
                .await?
                .is_none()
        );
        Ok(())
    }
}
