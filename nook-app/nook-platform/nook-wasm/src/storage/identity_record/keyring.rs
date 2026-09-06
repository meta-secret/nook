//! Versioned persistence for independently protected local identity keys.

use crate::storage;
use crate::storage::{event_db, indexed_db};
use nook_core::{IdentitySelection, LocalIdentityKeyring};
use rexie::TransactionMode;

use crate::NookError;

use super::{load_directory_for_write, map_domain_error, write_identity_directory};

mod legacy;
mod protection;
mod signing;

use protection::IdentityTransitionAdmission;
pub(crate) use protection::ProtectedIdentityPublication;

pub(crate) use signing::LocalIdentitySigner;

pub(crate) const LOCAL_IDENTITY_KEYRING_KEY: &str = "local_identity_keyring_v1";

pub(crate) struct ProtectedLocalIdentitySave {
    pub(crate) identity: nook_core::IdentityRecord,
    pub(crate) signing_seed: String,
}

async fn read_string(
    store: &rexie::Store,
    key: &str,
    context: &str,
) -> Result<Option<String>, NookError> {
    let key = serde_wasm_bindgen::to_value(key)
        .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
    let value = store
        .get(key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("{context} read error: {error:?}")))?;
    value
        .filter(|value| !value.is_undefined() && !value.is_null())
        .map(serde_wasm_bindgen::from_value::<String>)
        .transpose()
        .map_err(|error| NookError::IndexedDb(format!("{context} value error: {error:?}")))
}

async fn delete_key(store: &rexie::Store, key: &str, context: &str) -> Result<(), NookError> {
    let key = serde_wasm_bindgen::to_value(key)
        .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
    store
        .delete(key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("{context} delete error: {error:?}")))
}

fn decode_keyring(raw: &str) -> Result<nook_core::LocalIdentityKeyring, NookError> {
    let keyring: nook_core::LocalIdentityKeyring = serde_json::from_str(raw).map_err(|error| {
        NookError::IndexedDb(format!("Local identity keyring decode error: {error}"))
    })?;
    keyring
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))?;
    Ok(keyring)
}

pub(super) async fn load_persisted_keyring_for_recovery(
    store: &rexie::Store,
) -> Result<nook_core::LocalIdentityKeyring, NookError> {
    match read_string(store, LOCAL_IDENTITY_KEYRING_KEY, "Local identity keyring").await? {
        Some(raw) => decode_keyring(&raw),
        None => Ok(LocalIdentityKeyring::empty()),
    }
}

fn validate_keyring_directory_binding(
    keyring: &nook_core::LocalIdentityKeyring,
    directory: &nook_core::IdentityDirectory,
) -> Result<(), NookError> {
    for entry in keyring.entries() {
        let identity = directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == *entry.identity_id())
            .ok_or_else(|| {
                NookError::Database(format!(
                    "Local keyring identity is absent from the directory: {}",
                    entry.identity_id()
                ))
            })?;
        if !identity.has_app_id(entry.app_id()) {
            return Err(NookError::Database(format!(
                "Local keyring app id is not a member of identity {}",
                entry.identity_id()
            )));
        }
    }
    Ok(())
}

pub(super) async fn write_keyring(
    store: &rexie::Store,
    keyring: &nook_core::LocalIdentityKeyring,
) -> Result<(), NookError> {
    keyring
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))?;
    let encoded = serde_json::to_string(keyring).map_err(|error| {
        NookError::IndexedDb(format!("Local identity keyring encode error: {error}"))
    })?;
    let value = serde_wasm_bindgen::to_value(&encoded).map_err(|error| {
        NookError::IndexedDb(format!("Local identity keyring value error: {error:?}"))
    })?;
    let key = serde_wasm_bindgen::to_value(LOCAL_IDENTITY_KEYRING_KEY).map_err(|error| {
        NookError::IndexedDb(format!("Local identity keyring key error: {error:?}"))
    })?;
    store.put(&value, Some(&key)).await.map_err(|error| {
        NookError::IndexedDb(format!("Local identity keyring write error: {error:?}"))
    })?;
    let verified = store
        .get(key)
        .await
        .map_err(|error| {
            NookError::IndexedDb(format!("Local identity keyring verify error: {error:?}"))
        })?
        .ok_or_else(|| {
            NookError::IndexedDb("Local identity keyring verification failed".to_owned())
        })?;
    let verified: String = serde_wasm_bindgen::from_value(verified).map_err(|error| {
        NookError::IndexedDb(format!(
            "Local identity keyring verify value error: {error:?}"
        ))
    })?;
    if verified != encoded {
        return Err(NookError::IndexedDb(
            "Local identity keyring verification mismatch".to_owned(),
        ));
    }
    Ok(())
}

pub(super) async fn load_keyring_for_store(
    store: &rexie::Store,
    directory: &nook_core::IdentityDirectory,
) -> Result<nook_core::LocalIdentityKeyring, NookError> {
    let mut keyring =
        match read_string(store, LOCAL_IDENTITY_KEYRING_KEY, "Local identity keyring").await? {
            Some(raw) => decode_keyring(&raw)?,
            None => LocalIdentityKeyring::empty(),
        };
    let migrated = legacy::migrate_legacy_active_key(store, directory, &mut keyring).await?;
    validate_keyring_directory_binding(&keyring, directory)?;
    if migrated {
        write_keyring(store, &keyring).await?;
    }
    Ok(keyring)
}

pub(super) async fn selected_entry_from_store(
    store: &rexie::Store,
) -> Result<Option<nook_core::LocalIdentityKeyringEntry>, NookError> {
    let directory = load_directory_for_write(store).await?;
    let keyring = load_keyring_for_store(store, &directory).await?;
    let IdentitySelection::Selected(identity_id) = directory.selection() else {
        return Ok(None);
    };
    Ok(keyring.entry(identity_id).cloned())
}

pub(super) async fn entry_for_app_id_from_store(
    store: &rexie::Store,
    app_id: &nook_core::AppId,
) -> Result<Option<nook_core::LocalIdentityKeyringEntry>, NookError> {
    let directory = load_directory_for_write(store).await?;
    Ok(load_keyring_for_store(store, &directory)
        .await?
        .entries()
        .iter()
        .find(|entry| entry.app_id() == app_id)
        .cloned())
}

pub(crate) async fn load_selected_entry()
-> Result<Option<nook_core::LocalIdentityKeyringEntry>, NookError> {
    let rexie = storage::open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|error| {
            NookError::IndexedDb(format!("Local identity keyring load error: {error:?}"))
        })?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!(
            "Local identity keyring load store error: {error:?}"
        ))
    })?;
    let entry = selected_entry_from_store(&store).await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!(
            "Local identity keyring load completion error: {error:?}"
        ))
    })?;
    Ok(entry)
}

pub(crate) async fn selected_legacy_signer_requires_authorization() -> Result<bool, NookError> {
    let Some(entry) = load_selected_entry().await? else {
        return Ok(false);
    };
    if entry.has_signing_seed() {
        return Ok(false);
    }
    Ok(indexed_db::idb_get_string(event_db::SIGNING_SEED_KEY)
        .await?
        .is_some())
}

pub(crate) async fn load_entry_for_app_id(
    app_id: &nook_core::AppId,
) -> Result<Option<nook_core::LocalIdentityKeyringEntry>, NookError> {
    let rexie = storage::open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|error| {
            NookError::IndexedDb(format!("Local identity keyring load error: {error:?}"))
        })?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!(
            "Local identity keyring load store error: {error:?}"
        ))
    })?;
    let directory = load_directory_for_write(&store).await?;
    let entry = load_keyring_for_store(&store, &directory)
        .await?
        .entries()
        .iter()
        .find(|entry| entry.app_id() == app_id)
        .cloned();
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!(
            "Local identity keyring load completion error: {error:?}"
        ))
    })?;
    Ok(entry)
}

pub(crate) async fn load_keyring() -> Result<nook_core::LocalIdentityKeyring, NookError> {
    let rexie = storage::open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|error| {
            NookError::IndexedDb(format!("Local identity keyring load error: {error:?}"))
        })?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!(
            "Local identity keyring load store error: {error:?}"
        ))
    })?;
    let directory = load_directory_for_write(&store).await?;
    let keyring = load_keyring_for_store(&store, &directory).await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!(
            "Local identity keyring load completion error: {error:?}"
        ))
    })?;
    Ok(keyring)
}

pub(crate) struct LocalIdentitySelection {
    pub(crate) selected_app_id: nook_core::AppId,
    pub(crate) previous_app_id: Option<nook_core::AppId>,
}

pub(crate) async fn select_local_identity(
    identity_id: nook_core::IdentityId,
) -> Result<LocalIdentitySelection, NookError> {
    let rexie = storage::open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|error| NookError::IndexedDb(format!("Identity switch error: {error:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|error| NookError::IndexedDb(format!("Identity switch store error: {error:?}")))?;
    IdentityTransitionAdmission { store: &store }
        .check()
        .await?;
    let mut directory = load_directory_for_write(&store).await?;
    let keyring = load_keyring_for_store(&store, &directory).await?;
    let previous_app_id = directory
        .selected()
        .ok()
        .and_then(|identity| keyring.entry(&identity.identity_id))
        .map(|entry| entry.app_id().clone());
    let app_id = keyring
        .entry(&identity_id)
        .ok_or_else(|| {
            NookError::Database("Selected identity has no protected local keyring".to_owned())
        })?
        .app_id()
        .clone();
    directory.select(&identity_id).map_err(map_domain_error)?;
    write_identity_directory(&store, &directory).await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Identity switch completion error: {error:?}"))
    })?;
    Ok(LocalIdentitySelection {
        selected_app_id: app_id,
        previous_app_id,
    })
}

#[cfg(test)]
pub(crate) async fn clear_keyring_for_test() -> Result<(), NookError> {
    indexed_db::idb_delete_key(LOCAL_IDENTITY_KEYRING_KEY).await
}
