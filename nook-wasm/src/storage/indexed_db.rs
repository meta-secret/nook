//! IndexedDB-backed storage adapter.
//!
//! Object stores inside `nook_db`:
//! - `vault` — encrypted vault YAML, local metadata, device identities, and
//!   legacy compatibility keys.
//! - `events` — immutable event bytes keyed by `[store_id, event_id]` strings.
//! - `projections` — encrypted materialized-view cache metadata.
//! - `provider_receipts` — reserved provider event receipt cache.
//! - `outbox` — retryable event appends per provider.
//!
//! Object keys in the `vault` store:
//! - `vault:{store_id}` — encrypted vault YAML for one logical vault.
//! - `vault_registry` — JSON list of locally cached vault metadata.
//! - `active_vault_id` — which `store_id` is currently selected.
//! - `pending_new_local_vault` — when set, local load returns empty so
//!   `connect_fresh` can bootstrap a second vault without overwriting the
//!   previous active blob.
//! - `encrypted_db` — legacy single-vault key (migrated on first read).
//! - `device_id` / `device_identity_wrapped` — stable browser device identity
//!   encrypted with a passkey-PRF-derived key.
//! - `vault_cache:{ref}` — per-provider local mirror of remote YAML.

use crate::NookError;
use serde::{Deserialize, Serialize};

const LEGACY_ENCRYPTED_DB_KEY: &str = "encrypted_db";
const ACTIVE_VAULT_KEY: &str = "active_vault_id";
const VAULT_REGISTRY_KEY: &str = "vault_registry";
const PENDING_NEW_LOCAL_VAULT_KEY: &str = "pending_new_local_vault";
const DEVICE_ID_KEY: &str = "device_id";
const WRAPPED_DEVICE_IDENTITY_KEY: &str = "device_identity_wrapped";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultRegistryEntry {
    pub store_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_unlocked_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultRegistry {
    pub vaults: Vec<VaultRegistryEntry>,
}

fn vault_blob_key(store_id: &str) -> String {
    format!("vault:{store_id}")
}

fn vault_cache_key(cache_ref: &str) -> String {
    format!("vault_cache:{cache_ref}")
}

async fn open_vault_db() -> Result<rexie::Rexie, NookError> {
    rexie::Rexie::builder("nook_db")
        .version(2)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .add_object_store(rexie::ObjectStore::new("events"))
        .add_object_store(rexie::ObjectStore::new("projections"))
        .add_object_store(rexie::ObjectStore::new("provider_receipts"))
        .add_object_store(rexie::ObjectStore::new("outbox"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {e:?}")))
}

async fn idb_get_string(key: &str) -> Result<Option<String>, NookError> {
    let rexie = open_vault_db().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let id_key = serde_wasm_bindgen::to_value(key)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let value = store
        .get(id_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    match value {
        None => Ok(None),
        Some(val) if val.is_undefined() || val.is_null() => Ok(None),
        Some(val) => {
            let text: String = serde_wasm_bindgen::from_value(val)
                .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {e:?}")))?;
            Ok(Some(text))
        }
    }
}

async fn idb_put_string(key: &str, value: &str) -> Result<(), NookError> {
    let rexie = open_vault_db().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let id_key = serde_wasm_bindgen::to_value(key)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let id_value = serde_wasm_bindgen::to_value(value)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    store
        .put(&id_value, Some(&id_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

async fn idb_delete_key(key: &str) -> Result<(), NookError> {
    let rexie = open_vault_db().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let id_key = serde_wasm_bindgen::to_value(key)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    store
        .delete(id_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Delete error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

fn store_id_from_yaml(content: &str) -> Result<String, NookError> {
    nook_core::read_vault_store_id(content)
        .map_err(|e| NookError::Database(e.to_string()))?
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| NookError::Database("Vault YAML is missing store_id.".to_owned()))
}

fn label_from_yaml(content: &str) -> Option<String> {
    nook_core::read_vault_name(content).ok().flatten()
}

pub(crate) async fn load_vault_registry() -> Result<VaultRegistry, NookError> {
    let raw = idb_get_string(VAULT_REGISTRY_KEY).await?;
    let Some(json) = raw else {
        return Ok(VaultRegistry::default());
    };
    serde_json::from_str(&json)
        .map_err(|e| NookError::IndexedDb(format!("Vault registry parse error: {e}")))
}

async fn save_vault_registry(registry: &VaultRegistry) -> Result<(), NookError> {
    let json = serde_json::to_string(registry)
        .map_err(|e| NookError::IndexedDb(format!("Vault registry serialize error: {e}")))?;
    idb_put_string(VAULT_REGISTRY_KEY, &json).await
}

pub(crate) async fn get_active_vault_id() -> Result<Option<String>, NookError> {
    idb_get_string(ACTIVE_VAULT_KEY).await
}

pub(crate) async fn set_active_vault_id(store_id: &str) -> Result<(), NookError> {
    idb_put_string(ACTIVE_VAULT_KEY, store_id).await
}

async fn is_pending_new_local_vault() -> Result<bool, NookError> {
    Ok(idb_get_string(PENDING_NEW_LOCAL_VAULT_KEY).await?.is_some())
}

pub(crate) async fn prepare_new_local_vault_slot() -> Result<(), NookError> {
    idb_put_string(PENDING_NEW_LOCAL_VAULT_KEY, "1").await
}

async fn clear_pending_new_local_vault() -> Result<(), NookError> {
    idb_delete_key(PENDING_NEW_LOCAL_VAULT_KEY).await
}

fn upsert_registry_entry(
    registry: &mut VaultRegistry,
    store_id: &str,
    label: Option<&str>,
    touch_unlock: bool,
) {
    let now = if touch_unlock {
        Some(chrono_lite_now())
    } else {
        None
    };
    if let Some(entry) = registry
        .vaults
        .iter_mut()
        .find(|entry| entry.store_id == store_id)
    {
        if let Some(text) = label {
            entry.label = Some(text.to_owned());
        }
        if touch_unlock {
            entry.last_unlocked_at = now;
        }
        return;
    }
    registry.vaults.push(VaultRegistryEntry {
        store_id: store_id.to_owned(),
        label: label.map(str::to_owned),
        last_unlocked_at: now,
    });
}

fn chrono_lite_now() -> String {
    js_sys::Date::new_0().to_iso_string().into()
}

async fn migrate_legacy_encrypted_db_if_needed() -> Result<(), NookError> {
    let legacy = idb_get_string(LEGACY_ENCRYPTED_DB_KEY).await?;
    let Some(content) = legacy.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };

    let store_id = store_id_from_yaml(&content)?;
    idb_put_string(&vault_blob_key(&store_id), &content).await?;

    let mut registry = load_vault_registry().await?;
    upsert_registry_entry(&mut registry, &store_id, None, false);
    save_vault_registry(&registry).await?;

    if get_active_vault_id().await?.is_none() {
        set_active_vault_id(&store_id).await?;
    }

    idb_delete_key(LEGACY_ENCRYPTED_DB_KEY).await
}

pub(crate) async fn list_vault_registry_entries() -> Result<Vec<VaultRegistryEntry>, NookError> {
    migrate_legacy_encrypted_db_if_needed().await?;
    Ok(load_vault_registry().await?.vaults)
}

pub(crate) async fn load_vault_blob(store_id: &str) -> Result<Option<String>, NookError> {
    migrate_legacy_encrypted_db_if_needed().await?;
    idb_get_string(&vault_blob_key(store_id)).await
}

pub(crate) async fn save_vault_blob(store_id: &str, content: &str) -> Result<(), NookError> {
    idb_put_string(&vault_blob_key(store_id), content).await?;
    let mut registry = load_vault_registry().await?;
    upsert_registry_entry(&mut registry, store_id, None, true);
    save_vault_registry(&registry).await?;
    set_active_vault_id(store_id).await?;
    clear_pending_new_local_vault().await
}

pub(crate) async fn device_identity_protection_status() -> Result<&'static str, NookError> {
    if idb_get_string(WRAPPED_DEVICE_IDENTITY_KEY).await?.is_some() {
        return Ok("passkey");
    }
    Ok("missing")
}

pub(crate) async fn load_wrapped_device_identity()
-> Result<Option<(String, nook_core::WrappedDeviceIdentity)>, NookError> {
    let Some(raw) = idb_get_string(WRAPPED_DEVICE_IDENTITY_KEY).await? else {
        return Ok(None);
    };
    let device_id = idb_get_string(DEVICE_ID_KEY)
        .await?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            NookError::IndexedDb("Protected device identity is missing device_id.".to_owned())
        })?;
    let wrapped = nook_core::parse_wrapped_device_identity(&raw)?;
    Ok(Some((device_id, wrapped)))
}

/// Atomically install a verified wrapped identity after the just-written
/// ciphertext can be read back.
pub(crate) async fn save_wrapped_device_identity(
    device_id: &str,
    record: &nook_core::WrappedDeviceIdentity,
) -> Result<(), NookError> {
    let wrapped = nook_core::serialize_wrapped_device_identity(record)?;
    let rexie = open_vault_db().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;

    let id_key = serde_wasm_bindgen::to_value(DEVICE_ID_KEY)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let wrapped_key = serde_wasm_bindgen::to_value(WRAPPED_DEVICE_IDENTITY_KEY)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let id_value = serde_wasm_bindgen::to_value(device_id)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let wrapped_value = serde_wasm_bindgen::to_value(&wrapped)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;

    store
        .put(&id_value, Some(&id_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    store
        .put(&wrapped_value, Some(&wrapped_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    let verified_value = store
        .get(wrapped_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Verify get error: {e:?}")))?
        .ok_or_else(|| {
            NookError::IndexedDb("Wrapped device identity verification failed.".to_owned())
        })?;
    let verified: String = serde_wasm_bindgen::from_value(verified_value)
        .map_err(|e| NookError::IndexedDb(format!("Verify parse error: {e:?}")))?;
    if verified != wrapped {
        return Err(NookError::IndexedDb(
            "Wrapped device identity verification mismatch.".to_owned(),
        ));
    }

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

pub(crate) async fn delete_device_identity_for_recovery() -> Result<(), NookError> {
    idb_delete_key(WRAPPED_DEVICE_IDENTITY_KEY).await?;
    idb_delete_key(DEVICE_ID_KEY).await
}

#[cfg(target_arch = "wasm32")]
#[cfg(test)]
mod device_identity_storage_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn verified_wrapped_identity_round_trips() {
        let _ = rexie::Rexie::delete("nook_db").await;
        let identity = nook_core::DeviceIdentity::generate().expect("identity");
        let secret = identity.secret_string();
        assert_eq!(
            device_identity_protection_status().await.expect("status"),
            "missing"
        );

        let setup = nook_core::DeviceKeyProtectionSetup::generate().expect("setup");
        let prf_output = [21u8; 32];
        let wrapped = nook_core::wrap_device_identity(
            &secret,
            &[7u8; 32],
            setup.user_handle(),
            setup.prf_input(),
            &prf_output,
        )
        .expect("wrap");
        save_wrapped_device_identity(identity.device_id().as_str(), &wrapped)
            .await
            .expect("persist wrapped identity");

        let (_, reloaded) = load_wrapped_device_identity()
            .await
            .expect("load")
            .expect("record");
        assert_eq!(
            nook_core::unwrap_device_identity(&reloaded, &prf_output).expect("unwrap"),
            secret
        );
    }
}

pub(crate) async fn load_from_indexed_db() -> Result<Option<String>, NookError> {
    migrate_legacy_encrypted_db_if_needed().await?;

    if is_pending_new_local_vault().await? {
        return Ok(None);
    }

    let active = get_active_vault_id().await?;
    let Some(store_id) = active.filter(|id| !id.trim().is_empty()) else {
        return Ok(None);
    };
    load_vault_blob(&store_id).await
}

pub(crate) async fn has_local_vault() -> Result<bool, NookError> {
    migrate_legacy_encrypted_db_if_needed().await?;
    let registry = load_vault_registry().await?;
    Ok(!registry.vaults.is_empty())
}

pub(crate) async fn has_active_local_vault() -> Result<bool, NookError> {
    Ok(load_from_indexed_db()
        .await?
        .is_some_and(|content| !content.trim().is_empty()))
}

pub(crate) async fn load_vault_local_cache(cache_ref: &str) -> Result<Option<String>, NookError> {
    idb_get_string(&vault_cache_key(cache_ref)).await
}

pub(crate) async fn save_to_indexed_db(content: &str) -> Result<(), NookError> {
    if content.trim().is_empty() {
        return Err(NookError::Database(
            "Refusing to persist empty vault blob.".to_owned(),
        ));
    }
    let store_id = store_id_from_yaml(content)?;
    save_vault_blob(&store_id, content).await
}

pub(crate) async fn set_local_vault_label(store_id: &str, label: &str) -> Result<(), NookError> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err(NookError::Database(
            "Vault label cannot be empty.".to_owned(),
        ));
    }
    migrate_legacy_encrypted_db_if_needed().await?;
    let mut registry = load_vault_registry().await?;
    if !registry
        .vaults
        .iter()
        .any(|entry| entry.store_id == store_id)
    {
        return Err(NookError::Database(format!(
            "Vault {store_id} is not registered on this device."
        )));
    }
    upsert_registry_entry(&mut registry, store_id, Some(trimmed), false);
    save_vault_registry(&registry).await?;
    if let Some(content) = load_vault_blob(store_id).await? {
        let named = nook_core::set_vault_name(&content, trimmed)?;
        idb_put_string(&vault_blob_key(store_id), named.as_str()).await?;
    }
    Ok(())
}

pub(crate) async fn switch_active_vault(store_id: &str) -> Result<(), NookError> {
    migrate_legacy_encrypted_db_if_needed().await?;
    let registry = load_vault_registry().await?;
    if !registry
        .vaults
        .iter()
        .any(|entry| entry.store_id == store_id)
    {
        return Err(NookError::Database(format!(
            "Vault {store_id} is not registered on this device."
        )));
    }
    clear_pending_new_local_vault().await?;
    set_active_vault_id(store_id).await
}

pub(crate) async fn import_vault_blob(
    content: &str,
    label: Option<&str>,
) -> Result<String, NookError> {
    let store_id = store_id_from_yaml(content)?;
    save_vault_blob(&store_id, content).await?;
    let yaml_label = label_from_yaml(content);
    let label = label.or(yaml_label.as_deref());
    if let Some(label) = label {
        let mut registry = load_vault_registry().await?;
        upsert_registry_entry(&mut registry, &store_id, Some(label), false);
        save_vault_registry(&registry).await?;
    }
    Ok(store_id)
}
