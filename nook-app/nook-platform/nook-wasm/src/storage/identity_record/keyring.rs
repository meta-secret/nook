//! Versioned persistence for independently protected local identity keys.

use super::recovery;
use crate::storage;
use crate::storage::{event_db, indexed_db};
use nook_core::{IdentitySelection, LocalIdentityKeyring, LocalIdentityKeyringEntry};
use rexie::TransactionMode;

use crate::{NookError, storage::indexed_db};

use super::{load_directory_for_write, map_domain_error, write_identity_directory};

mod legacy;
mod signing;

pub(crate) use signing::load_or_create_signing_seed_for_app_key;

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

async fn commit_protected_identity(
    store: &rexie::Store,
    directory: &mut nook_core::IdentityDirectory,
    keyring: &mut nook_core::LocalIdentityKeyring,
    app_key: &nook_core::AppKey,
    wrapped_app_key: &nook_core::WrappedDeviceIdentity,
    identity_id: nook_core::IdentityId,
    migrate_legacy_seed: bool,
) -> Result<ProtectedLocalIdentitySave, NookError> {
    let existing = keyring.entry(&identity_id);
    let legacy_signing_public_key =
        signing::member_signing_public_key(directory, &identity_id, app_key.app_id())?;
    let identity_has_vaults = signing::identity_has_vaults(directory, &identity_id)?;
    let (signing_seed, signing_public_key) = signing::signing_material(
        store,
        existing,
        app_key,
        migrate_legacy_seed,
        &legacy_signing_public_key,
        identity_has_vaults,
    )
    .await?;
    let entry = LocalIdentityKeyringEntry::protected(
        identity_id.clone(),
        app_key,
        wrapped_app_key.clone(),
        &signing_seed,
    )
    .map_err(|error| NookError::Database(error.to_string()))?;
    if existing.is_some() {
        keyring
            .replace(entry)
            .map_err(|error| NookError::Database(error.to_string()))?;
    } else {
        keyring
            .insert(entry)
            .map_err(|error| NookError::Database(error.to_string()))?;
    }
    directory
        .set_member_signing_public_key(&identity_id, app_key.app_id(), &signing_public_key)
        .map_err(map_domain_error)?;
    validate_keyring_directory_binding(keyring, directory)?;
    write_keyring(store, keyring).await?;
    write_identity_directory(store, directory).await?;
    legacy::delete_legacy_active_key(store).await?;
    delete_key(store, event_db::SIGNING_SEED_KEY, "Legacy signing seed").await?;
    let identity = directory
        .identities()
        .iter()
        .find(|identity| identity.identity_id == identity_id)
        .cloned()
        .ok_or_else(|| NookError::Database("Protected identity disappeared".to_owned()))?;
    Ok(ProtectedLocalIdentitySave {
        identity,
        signing_seed,
    })
}

async fn ensure_no_pending_identity_transition(store: &rexie::Store) -> Result<(), NookError> {
    let simple_pending = read_string(
        store,
        super::PENDING_SIMPLE_GENESIS_KEY,
        "Pending Simple genesis",
    )
    .await?
    .is_some();
    let sentinel_pending = read_string(
        store,
        indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY,
        "Pending Sentinel genesis",
    )
    .await?
    .is_some();
    let recovery_cleanup_pending = read_string(
        store,
        recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
        "Pending identity recovery cleanup",
    )
    .await?
    .is_some();
    if simple_pending || sentinel_pending || recovery_cleanup_pending {
        return Err(NookError::Database(
            "Pending vault creation or recovery cleanup must finish before changing identities"
                .to_owned(),
        ));
    }
    Ok(())
}

pub(crate) async fn save_existing_protected_identity(
    store: &rexie::Store,
    directory: &mut nook_core::IdentityDirectory,
    app_key: &nook_core::AppKey,
    wrapped_app_key: &nook_core::WrappedDeviceIdentity,
    label: &str,
) -> Result<ProtectedLocalIdentitySave, NookError> {
    ensure_no_pending_identity_transition(store).await?;
    let mut keyring = load_keyring_for_store(store, directory).await?;
    // Recovery can leave identities that are known only through peer members.
    // With no local keyring entry, normal protection setup must bootstrap a new
    // independent local identity instead of trying to enroll in a peer identity.
    let allow_peer_only_bootstrap =
        keyring.entries().is_empty() && matches!(directory.selection(), IdentitySelection::Empty);
    let identity = super::ensure_local_identity_in_directory(
        directory,
        app_key,
        label,
        allow_peer_only_bootstrap,
    )?;
    commit_protected_identity(
        store,
        directory,
        &mut keyring,
        app_key,
        wrapped_app_key,
        identity.identity_id,
        true,
    )
    .await
}

pub(crate) async fn save_new_protected_identity(
    store: &rexie::Store,
    directory: &mut nook_core::IdentityDirectory,
    app_key: &nook_core::AppKey,
    wrapped_app_key: &nook_core::WrappedDeviceIdentity,
    prior_app_key: Option<&nook_core::AppKey>,
    label: &str,
) -> Result<ProtectedLocalIdentitySave, NookError> {
    ensure_no_pending_identity_transition(store).await?;
    let mut keyring = load_keyring_for_store(store, directory).await?;
    signing::protect_selected_legacy_signing_seed(store, directory, &mut keyring, prior_app_key)
        .await?;
    let identity_id = directory
        .create_identity(label, app_key, None)
        .map_err(map_domain_error)?;
    commit_protected_identity(
        store,
        directory,
        &mut keyring,
        app_key,
        wrapped_app_key,
        identity_id,
        false,
    )
    .await
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
    ensure_no_pending_identity_transition(&store).await?;
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

#[cfg(test)]
mod tests {
    use super::super::{recovery, simple_genesis};
    use crate::storage::identity_record;
    use crate::storage::{event_db, indexed_db};
    use nook_core::{AppKey, DeviceSigningPublicKey, LocalIdentityKeyringEntry, SigningIdentity};
    use rexie::Rexie;

    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    async fn create_pin_identity(
        label: &str,
        pin: &str,
        prior_app_key: Option<&nook_core::AppKey>,
    ) -> Result<
        (
            nook_core::AppKey,
            nook_core::WrappedDeviceIdentity,
            ProtectedLocalIdentitySave,
        ),
        NookError,
    > {
        let app_key = AppKey::generate().map_err(map_domain_error)?;
        let wrapped = nook_core::wrap_device_identity_with_pin(&app_key.secret_string(), pin)?;
        let saved = identity_record::save_new_protected_local_identity(
            &app_key,
            &wrapped,
            prior_app_key,
            label,
        )
        .await?;
        Ok((app_key, wrapped, saved))
    }

    #[wasm_bindgen_test]
    async fn distinct_protected_identities_can_be_selected_independently() -> Result<(), NookError>
    {
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;

        let first = identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        let second = identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;

        assert_ne!(first.identity.identity_id, second.identity.identity_id);
        assert_ne!(first_key.app_id(), second_key.app_id());
        let keyring = super::load_keyring().await?;
        assert_eq!(keyring.entries().len(), 2);
        let first_signing_public_key = keyring
            .entry(&first.identity.identity_id)
            .ok_or_else(|| NookError::Database("First keyring entry is missing".to_owned()))?
            .signing_public_key(&first_key)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let second_signing_public_key = keyring
            .entry(&second.identity.identity_id)
            .ok_or_else(|| NookError::Database("Second keyring entry is missing".to_owned()))?
            .signing_public_key(&second_key)
            .map_err(|error| NookError::Database(error.to_string()))?;
        assert_ne!(first_signing_public_key, second_signing_public_key);
        super::select_local_identity(first.identity.identity_id.clone()).await?;
        let selected = super::load_selected_entry()
            .await?
            .ok_or_else(|| NookError::Database("Selected keyring entry is missing".to_owned()))?;
        assert_eq!(selected.app_id(), first_key.app_id());
        assert_eq!(
            selected
                .signing_public_key(&first_key)
                .map_err(|error| NookError::Database(error.to_string()))?,
            SigningIdentity::from_seed_hex_stored(&first.signing_seed)
                .map_err(|error| NookError::Database(error.to_string()))?
                .public_key()
        );

        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn second_identity_requires_legacy_signer_to_be_protected_first() -> Result<(), NookError>
    {
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let first = identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        let mut legacy_keyring = super::load_keyring().await?;
        legacy_keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                first.identity.identity_id.clone(),
                first_key.app_id().clone(),
                first_wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&legacy_keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(LOCAL_IDENTITY_KEYRING_KEY, &encoded).await?;
        let legacy_seed = first.signing_seed.clone();
        indexed_db::idb_put_string(event_db::SIGNING_SEED_KEY, &legacy_seed).await?;

        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        assert!(
            identity_record::save_new_protected_local_identity(
                &second_key,
                &second_wrapped,
                None,
                "Work",
            )
            .await
            .is_err()
        );
        assert_eq!(
            indexed_db::idb_get_string(event_db::SIGNING_SEED_KEY,).await?,
            Some(legacy_seed.clone())
        );
        assert_eq!(super::load_keyring().await?.entries().len(), 1);

        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            Some(&first_key),
            "Work",
        )
        .await?;
        let migrated = super::load_keyring().await?;
        assert_eq!(migrated.entries().len(), 2);
        assert_eq!(
            migrated
                .entry(&first.identity.identity_id)
                .ok_or_else(|| {
                    NookError::Database("Migrated legacy keyring entry is missing".to_owned())
                })?
                .open_signing_seed(&first_key)
                .map_err(|error| NookError::Database(error.to_string()))?,
            Some(legacy_seed)
        );
        assert!(
            indexed_db::idb_get_string(event_db::SIGNING_SEED_KEY,)
                .await?
                .is_none()
        );

        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn stale_legacy_signing_seed_cannot_replace_established_membership()
    -> Result<(), NookError> {
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let (first_key, first_wrapped, first) =
            create_pin_identity("Personal", "first-secret", None).await?;
        let mut legacy_keyring = super::load_keyring().await?;
        legacy_keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                first.identity.identity_id.clone(),
                first_key.app_id().clone(),
                first_wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(
            LOCAL_IDENTITY_KEYRING_KEY,
            &serde_json::to_string(&legacy_keyring)
                .map_err(|error| NookError::Database(error.to_string()))?,
        )
        .await?;
        indexed_db::idb_put_string(event_db::SIGNING_SEED_KEY, &"22".repeat(32)).await?;
        let second_key = AppKey::generate().map_err(map_domain_error)?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;

        let result = identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            Some(&first_key),
            "Work",
        )
        .await;

        assert!(
            matches!(result, Err(NookError::Database(message)) if message.contains("established signing public key"))
        );
        assert_eq!(super::load_keyring().await?.entries().len(), 1);
        let directory = identity_record::load_identity_directory().await?;
        assert_eq!(directory.identities().len(), 1);
        assert_eq!(directory.identities()[0], first.identity);

        indexed_db::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn normal_unlock_promotes_a_seedless_migrated_keyring_entry() -> Result<(), NookError> {
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let (app_key, wrapped, protected) =
            create_pin_identity("Personal", "first-secret", None).await?;
        let mut keyring = super::load_keyring().await?;
        keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                protected.identity.identity_id.clone(),
                app_key.app_id().clone(),
                wrapped,
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(
            LOCAL_IDENTITY_KEYRING_KEY,
            &serde_json::to_string(&keyring)
                .map_err(|error| NookError::Database(error.to_string()))?,
        )
        .await?;
        indexed_db::idb_put_string(event_db::SIGNING_SEED_KEY, &protected.signing_seed).await?;

        let signing_seed = super::load_or_create_signing_seed_for_app_key(&app_key).await?;

        assert_eq!(signing_seed, protected.signing_seed);
        assert!(super::load_keyring().await?.entries()[0].has_signing_seed());
        assert!(
            indexed_db::idb_get_string(event_db::SIGNING_SEED_KEY)
                .await?
                .is_none()
        );
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn legacy_identity_with_signing_evidence_but_no_seed_fails_closed()
    -> Result<(), NookError> {
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        indexed_db::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        let (app_key, wrapped, protected) =
            create_pin_identity("Personal", "first-secret", None).await?;
        let signing_public_key = protected
            .identity
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
            .ok_or_else(|| NookError::Database("Protected identity member is missing".to_owned()))?
            .signing_public_key
            .clone();
        let mut keyring = super::load_keyring().await?;
        keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                protected.identity.identity_id.clone(),
                app_key.app_id().clone(),
                wrapped.clone(),
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(LOCAL_IDENTITY_KEYRING_KEY, &encoded).await?;

        let result =
            identity_record::save_protected_local_identity(&app_key, &wrapped, "Personal").await;

        assert!(
            matches!(result, Err(NookError::Database(message)) if message.contains("established signing seed"))
        );
        let retained = super::load_keyring().await?;
        assert!(!retained.entries()[0].has_signing_seed());
        let directory = identity_record::load_identity_directory().await?;
        assert_eq!(
            directory.identities()[0].members[0].signing_public_key,
            signing_public_key
        );

        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn seedless_pre_vault_legacy_identity_mints_its_first_signer() -> Result<(), NookError> {
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        indexed_db::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        let app_key = AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&app_key.secret_string(), "first-secret")?;
        let protected = identity_record::save_new_protected_local_identity(
            &app_key, &wrapped, None, "Personal",
        )
        .await?;
        let identity_id = protected.identity.identity_id.clone();
        identity_record::update_identity_directory({
            let identity_id = identity_id.clone();
            let app_id = app_key.app_id().clone();
            move |directory| {
                directory
                    .set_member_signing_public_key(
                        &identity_id,
                        &app_id,
                        &DeviceSigningPublicKey::Unavailable,
                    )
                    .map_err(map_domain_error)
            }
        })
        .await?;
        let mut keyring = super::load_keyring().await?;
        keyring
            .replace(LocalIdentityKeyringEntry::legacy(
                identity_id,
                app_key.app_id().clone(),
                wrapped.clone(),
            ))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let encoded = serde_json::to_string(&keyring)
            .map_err(|error| NookError::Database(error.to_string()))?;
        indexed_db::idb_put_string(LOCAL_IDENTITY_KEYRING_KEY, &encoded).await?;

        let promoted =
            identity_record::save_protected_local_identity(&app_key, &wrapped, "Personal").await?;

        assert!(!promoted.signing_seed.is_empty());
        assert!(super::load_keyring().await?.entries()[0].has_signing_seed());
        assert!(matches!(
            promoted.identity.members[0].signing_public_key,
            DeviceSigningPublicKey::Ed25519Hex(_)
        ));

        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn final_identity_creation_transaction_rechecks_pending_genesis() -> Result<(), NookError>
    {
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let first_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        indexed_db::idb_put_string(simple_genesis::PENDING_SIMPLE_GENESIS_KEY, "pending").await?;
        let second_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;

        let result = identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            Some(&first_key),
            "Work",
        )
        .await;

        assert!(matches!(
            result,
            Err(NookError::Database(message)) if message.contains("Pending vault creation")
        ));
        assert_eq!(super::load_keyring().await?.entries().len(), 1);
        indexed_db::idb_delete_key(simple_genesis::PENDING_SIMPLE_GENESIS_KEY).await?;
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn pending_recovery_cleanup_blocks_identity_creation_and_activation()
    -> Result<(), NookError> {
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let (first_key, _, first) = create_pin_identity("Personal", "first-secret", None).await?;
        let (second_key, _, _) =
            create_pin_identity("Work", "second-secret", Some(&first_key)).await?;
        let replacement_key =
            AppKey::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let replacement_wrapped = nook_core::wrap_device_identity_with_pin(
            &replacement_key.secret_string(),
            "replacement-secret",
        )?;
        indexed_db::idb_put_string(
            recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
            "pending",
        )
        .await?;

        let create_result = identity_record::save_new_protected_local_identity(
            &replacement_key,
            &replacement_wrapped,
            Some(&second_key),
            "Replacement",
        )
        .await;
        let activate_result = super::select_local_identity(first.identity.identity_id).await;

        assert!(
            matches!(create_result, Err(NookError::Database(message)) if message.contains("recovery cleanup"))
        );
        assert!(
            matches!(activate_result, Err(NookError::Database(message)) if message.contains("recovery cleanup"))
        );
        assert_eq!(super::load_keyring().await?.entries().len(), 2);

        indexed_db::idb_delete_key(recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY).await?;
        super::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn newer_legacy_wrapper_reconciles_without_losing_signing_seed() -> Result<(), NookError>
    {
        let _ = Rexie::delete("nook_db").await;
        let (app_key, _, protected) = create_pin_identity("Personal", "first-secret", None).await?;
        let replacement_wrapped =
            nook_core::wrap_device_identity_with_pin(&app_key.secret_string(), "new-protection")?;
        indexed_db::save_wrapped_device_identity(app_key.app_id().as_str(), &replacement_wrapped)
            .await?;

        let reconciled = super::load_keyring().await?;
        let entry = reconciled
            .entries()
            .first()
            .ok_or_else(|| NookError::Database("Reconciled keyring entry is missing".to_owned()))?;

        assert_eq!(entry.wrapped_app_key(), &replacement_wrapped);
        assert_eq!(
            entry
                .open_signing_seed(&app_key)
                .map_err(|error| NookError::Database(error.to_string()))?
                .as_deref(),
            Some(protected.signing_seed.as_str())
        );
        assert!(
            indexed_db::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_none()
        );
        let _ = Rexie::delete("nook_db").await;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn invalid_keyring_binding_preserves_legacy_protection() -> Result<(), NookError> {
        let _ = Rexie::delete("nook_db").await;
        let (app_key, wrapped, _) = create_pin_identity("Personal", "first-secret", None).await?;
        indexed_db::save_wrapped_device_identity(app_key.app_id().as_str(), &wrapped).await?;
        identity_record::clear_identity_directory_for_test().await?;
        assert!(super::load_keyring().await.is_err());
        assert!(
            indexed_db::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_some()
        );
        let _ = Rexie::delete("nook_db").await;
        Ok(())
    }
}
