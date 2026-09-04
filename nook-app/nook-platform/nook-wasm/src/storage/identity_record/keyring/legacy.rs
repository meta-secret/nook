//! Compatibility migration for the pre-keyring active app key fields.

use nook_core::{AppId, LocalIdentityKeyringEntry};

use crate::{NookError, storage::indexed_db};

use super::{delete_key, validate_keyring_directory_binding, write_keyring};

pub(super) async fn delete_legacy_active_key(store: &rexie::Store) -> Result<(), NookError> {
    for key in [
        indexed_db::APP_ID_KEY,
        indexed_db::DEVICE_ID_KEY,
        indexed_db::APP_KEY_WRAPPED_KEY,
        indexed_db::WRAPPED_DEVICE_IDENTITY_KEY,
    ] {
        delete_key(store, key, "Legacy active app key").await?;
    }
    Ok(())
}

pub(super) async fn migrate_legacy_active_key(
    store: &rexie::Store,
    directory: &nook_core::IdentityDirectory,
    keyring: &mut nook_core::LocalIdentityKeyring,
) -> Result<bool, NookError> {
    let wrapped = indexed_db::read_string_preferring(
        store,
        indexed_db::APP_KEY_WRAPPED_KEY,
        indexed_db::WRAPPED_DEVICE_IDENTITY_KEY,
        "Legacy wrapped app key",
    )
    .await?;
    let app_id = indexed_db::read_string_preferring(
        store,
        indexed_db::APP_ID_KEY,
        indexed_db::DEVICE_ID_KEY,
        "Legacy app id",
    )
    .await?;
    let Some(wrapped) = wrapped else {
        if app_id.is_some() {
            return Err(NookError::IndexedDb(
                "Legacy app id exists without a wrapped app key".to_owned(),
            ));
        }
        return Ok(false);
    };
    let app_id = AppId::parse(app_id.as_deref().unwrap_or_default())
        .map_err(|error| NookError::Database(error.to_string()))?;
    let wrapped = nook_core::parse_wrapped_device_identity(&wrapped)?;

    if let Some(existing) = keyring
        .entries()
        .iter()
        .find(|entry| entry.app_id() == &app_id)
        .cloned()
    {
        validate_keyring_directory_binding(keyring, directory)?;
        if existing.wrapped_app_key() != &wrapped {
            let mut reconciled = existing;
            reconciled
                .replace_wrapped_app_key(&app_id, wrapped)
                .map_err(|error| NookError::Database(error.to_string()))?;
            keyring
                .replace(reconciled)
                .map_err(|error| NookError::Database(error.to_string()))?;
            write_keyring(store, keyring).await?;
        }
        delete_legacy_active_key(store).await?;
        return Ok(true);
    }

    let identity_id = directory
        .identities()
        .iter()
        .find(|identity| identity.has_app_id(&app_id))
        .map(|identity| identity.identity_id.clone());
    let Some(identity_id) = identity_id else {
        if directory.identities().is_empty() {
            return Ok(false);
        }
        return Err(NookError::Database(
            "Legacy protected app key has no identity owner".to_owned(),
        ));
    };
    keyring
        .insert(LocalIdentityKeyringEntry::legacy(
            identity_id,
            app_id,
            wrapped,
        ))
        .map_err(|error| NookError::Database(error.to_string()))?;
    write_keyring(store, keyring).await?;
    delete_legacy_active_key(store).await?;
    Ok(true)
}
