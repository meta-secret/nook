//! IndexedDB-backed storage adapter.
//!
//! Two object keys live in the `vault` store inside the `nook_db` database:
//! - `encrypted_db` — the on-disk vault file (YAML, UTF-8 text).
//! - `device_id` / `device_identity_secret` — this browser's stable device
//!   identifier and X25519 secret string (used to unwrap `auth:` rows in
//!   keys-mode vaults).
//!
//! All functions are async and return `NookError::IndexedDb` on the various
//! IDB / serde failure modes — the call sites are happy to bubble that up.

use crate::NookError;

// -------------------------------------------------------------
// IndexedDB Storage Functions (via rexie)
// -------------------------------------------------------------

pub(crate) async fn load_or_create_device_identity() -> Result<(String, String), NookError> {
    if let Some(existing) = load_device_identity_from_indexed_db().await? {
        return Ok(existing);
    }
    let identity = nook_core::DeviceIdentity::generate().map_err(NookError::Encryption)?;
    Ok((identity.device_id().to_owned(), identity.secret_string()))
}

async fn load_device_identity_from_indexed_db() -> Result<Option<(String, String)>, NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let id_key = serde_wasm_bindgen::to_value("device_id")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let secret_key = serde_wasm_bindgen::to_value("device_identity_secret")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let id_value = store
        .get(id_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {:?}", e)))?;
    let secret_value = store
        .get(secret_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;

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
        .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {:?}", e)))?;
    let secret: String = serde_wasm_bindgen::from_value(secret_value)
        .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {:?}", e)))?;
    Ok(Some((device_id, secret)))
}

pub(crate) async fn save_device_identity_to_indexed_db(
    device_id: &str,
    secret: &str,
) -> Result<(), NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let id_key = serde_wasm_bindgen::to_value("device_id")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let secret_key = serde_wasm_bindgen::to_value("device_identity_secret")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let id_value = serde_wasm_bindgen::to_value(device_id)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let secret_value = serde_wasm_bindgen::to_value(secret)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;

    store
        .put(&id_value, Some(&id_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {:?}", e)))?;
    store
        .put(&secret_value, Some(&secret_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;
    Ok(())
}

pub(crate) async fn load_from_indexed_db() -> Result<Option<String>, NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let key = serde_wasm_bindgen::to_value("encrypted_db")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let value = store
        .get(key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;

    match value {
        None => Ok(None),
        Some(val) => {
            if val.is_undefined() || val.is_null() {
                Ok(None)
            } else {
                let hex: String = serde_wasm_bindgen::from_value(val)
                    .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {:?}", e)))?;
                Ok(Some(hex))
            }
        }
    }
}

pub(crate) async fn save_to_indexed_db(hex: &str) -> Result<(), NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let key = serde_wasm_bindgen::to_value("encrypted_db")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let value = serde_wasm_bindgen::to_value(hex)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    store
        .put(&value, Some(&key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;
    Ok(())
}
