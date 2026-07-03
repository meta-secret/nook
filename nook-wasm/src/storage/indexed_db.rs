//! IndexedDB-backed storage adapter.
//!
//! Object keys in the `vault` store inside `nook_db`:
//! - `vault:{store_id}` — encrypted vault YAML for one logical vault.
//! - `vault_registry` — JSON list of locally cached vault metadata.
//! - `active_vault_id` — which `store_id` is currently selected.
//! - `pending_new_local_vault` — when set, local load returns empty so
//!   `connect_fresh` can bootstrap a second vault without overwriting the
//!   previous active blob.
//! - `encrypted_db` — legacy single-vault key (migrated on first read).
//! - `device_id` / `device_identity_secret` — stable browser device identity.
//! - `vault_cache:{ref}` — per-provider local mirror of remote YAML.

use crate::NookError;
use serde::{Deserialize, Serialize};

const LEGACY_ENCRYPTED_DB_KEY: &str = "encrypted_db";
const ACTIVE_VAULT_KEY: &str = "active_vault_id";
const VAULT_REGISTRY_KEY: &str = "vault_registry";
const PENDING_NEW_LOCAL_VAULT_KEY: &str = "pending_new_local_vault";

/// This browser's persisted device identity — the stable id we use across
/// reloads plus the X25519 secret string that decrypts our own `auth:`
/// envelopes (in keys-mode vaults).
pub(crate) struct DeviceIdentityRecord {
    pub(crate) device_id: String,
    pub(crate) secret: String,
}

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
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
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

// -------------------------------------------------------------
// IndexedDB Storage Functions (via rexie)
// -------------------------------------------------------------

pub(crate) async fn load_or_create_device_identity() -> Result<DeviceIdentityRecord, NookError> {
    if let Some(existing) = load_device_identity_from_indexed_db().await? {
        return Ok(existing);
    }
    let identity = nook_core::DeviceIdentity::generate()?;
    Ok(DeviceIdentityRecord {
        device_id: identity.device_id().to_string(),
        secret: identity.secret_string().into_inner(),
    })
}

async fn load_device_identity_from_indexed_db() -> Result<Option<DeviceIdentityRecord>, NookError> {
    let rexie = open_vault_db().await?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;

    let id_key = serde_wasm_bindgen::to_value("device_id")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let secret_key = serde_wasm_bindgen::to_value("device_identity_secret")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let id_value = store
        .get(id_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {e:?}")))?;
    let secret_value = store
        .get(secret_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {e:?}")))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;

    if id_value.is_none() || secret_value.is_none() {
        return Ok(None);
    }
    let id_value = id_value.unwrap();
    let secret_value = secret_value.unwrap();
    if id_value.is_undefined()
        || id_value.is_null()
        || secret_value.is_undefined()
        || secret_value.is_null()
    {
        return Ok(None);
    }

    let device_id: String = serde_wasm_bindgen::from_value(id_value)
        .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {e:?}")))?;
    let secret: String = serde_wasm_bindgen::from_value(secret_value)
        .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {e:?}")))?;
    Ok(Some(DeviceIdentityRecord { device_id, secret }))
}

pub(crate) async fn save_device_identity_to_indexed_db(
    device_id: &str,
    secret: &str,
) -> Result<(), NookError> {
    let rexie = open_vault_db().await?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;

    let id_key = serde_wasm_bindgen::to_value("device_id")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let secret_key = serde_wasm_bindgen::to_value("device_identity_secret")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let id_value = serde_wasm_bindgen::to_value(device_id)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let secret_value = serde_wasm_bindgen::to_value(secret)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;

    store
        .put(&id_value, Some(&id_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    store
        .put(&secret_value, Some(&secret_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
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

/// Browser-local mirror of the last known vault YAML for a remote storage ref.
pub(crate) async fn save_vault_local_cache(
    cache_ref: &str,
    content: &str,
) -> Result<(), NookError> {
    idb_put_string(&vault_cache_key(cache_ref), content).await
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
    if label.is_some() {
        let mut registry = load_vault_registry().await?;
        upsert_registry_entry(&mut registry, &store_id, label, false);
        save_vault_registry(&registry).await?;
    }
    Ok(store_id)
}
