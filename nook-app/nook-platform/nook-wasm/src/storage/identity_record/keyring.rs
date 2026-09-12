//! Versioned persistence for independently protected local identity keys.

use crate::IdentityDbWriteIdentityDirectory;
use crate::storage::identity_record::PreviousLocalSelection;
use crate::storage::identity_record::StoredIdentityProtection;
use crate::storage::indexed_db::StoredStringRecord;
use nook_core::LocalIdentityProtection;

use crate::NookDatabase;
use crate::NookError;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage;
use crate::storage::event_db;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage::indexed_db;
use nook_core::{IdentitySelection, LocalIdentityKeyring};
use rexie::TransactionMode;

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

/// Named values required by `NookDatabase::keyring_read_string`.
pub(crate) struct KeyringDbKeyringReadString<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) key: &'a str,
    pub(crate) context: &'a str,
}

/// Named values required by `NookDatabase::keyring_delete_key`.
pub(crate) struct KeyringDbKeyringDeleteKey<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) key: &'a str,
    pub(crate) context: &'a str,
}

/// Named values required by `NookDatabase::validate_keyring_directory_binding`.
#[derive(Clone, Copy)]
pub(crate) struct KeyringDbValidateKeyringDirectoryBinding<'a> {
    pub(crate) keyring: &'a nook_core::LocalIdentityKeyring,
    pub(crate) directory: &'a nook_core::IdentityDirectory,
}

/// Named values required by `NookDatabase::write_keyring`.
pub(crate) struct KeyringDbWriteKeyring<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) keyring: &'a nook_core::LocalIdentityKeyring,
}

/// Named values required by `NookDatabase::load_keyring_for_store`.
pub(crate) struct KeyringDbLoadKeyringForStore<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) directory: &'a nook_core::IdentityDirectory,
}

/// Named values required by `NookDatabase::entry_for_app_id_from_store`.
pub(crate) struct KeyringDbEntryForAppIdFromStore<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) app_id: &'a nook_core::AppId,
}

impl NookDatabase {
    async fn keyring_read_string(
        request: KeyringDbKeyringReadString<'_>,
    ) -> Result<StoredStringRecord, NookError> {
        let KeyringDbKeyringReadString {
            store,
            key,
            context,
        } = request;
        let key = serde_wasm_bindgen::to_value(key)
            .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
        let value = store
            .get(key)
            .await
            .map_err(|error| NookError::IndexedDb(format!("{context} read error: {error:?}")))?;
        match value {
            None => Ok(StoredStringRecord::MissingKey),
            Some(value) if value.is_undefined() || value.is_null() => {
                Ok(StoredStringRecord::MissingKey)
            }
            Some(value) => serde_wasm_bindgen::from_value::<String>(value)
                .map(StoredStringRecord::Stored)
                .map_err(|error| NookError::IndexedDb(format!("{context} value error: {error:?}"))),
        }
    }
}

impl NookDatabase {
    async fn keyring_delete_key(request: KeyringDbKeyringDeleteKey<'_>) -> Result<(), NookError> {
        let KeyringDbKeyringDeleteKey {
            store,
            key,
            context,
        } = request;
        let key = serde_wasm_bindgen::to_value(key)
            .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
        store
            .delete(key)
            .await
            .map_err(|error| NookError::IndexedDb(format!("{context} delete error: {error:?}")))
    }
}

impl NookDatabase {
    fn decode_keyring(raw: &str) -> Result<nook_core::LocalIdentityKeyring, NookError> {
        let keyring: nook_core::LocalIdentityKeyring =
            serde_json::from_str(raw).map_err(|error| {
                NookError::IndexedDb(format!("Local identity keyring decode error: {error}"))
            })?;
        keyring
            .validate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        Ok(keyring)
    }
}

impl NookDatabase {
    pub(super) async fn load_persisted_keyring_for_recovery(
        store: &rexie::Store,
    ) -> Result<nook_core::LocalIdentityKeyring, NookError> {
        match NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
            store,
            key: LOCAL_IDENTITY_KEYRING_KEY,
            context: "Local identity keyring",
        })
        .await?
        {
            StoredStringRecord::Stored(raw) => NookDatabase::decode_keyring(&raw),
            StoredStringRecord::MissingKey => Ok(LocalIdentityKeyring::empty()),
        }
    }
}

impl NookDatabase {
    fn validate_keyring_directory_binding(
        request: KeyringDbValidateKeyringDirectoryBinding<'_>,
    ) -> Result<(), NookError> {
        let KeyringDbValidateKeyringDirectoryBinding { keyring, directory } = request;
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
}

impl NookDatabase {
    pub(super) async fn write_keyring(request: KeyringDbWriteKeyring<'_>) -> Result<(), NookError> {
        let KeyringDbWriteKeyring { store, keyring } = request;
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
}

impl NookDatabase {
    pub(super) async fn load_keyring_for_store(
        request: KeyringDbLoadKeyringForStore<'_>,
    ) -> Result<nook_core::LocalIdentityKeyring, NookError> {
        let KeyringDbLoadKeyringForStore { store, directory } = request;
        let keyring = match NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
            store,
            key: LOCAL_IDENTITY_KEYRING_KEY,
            context: "Local identity keyring",
        })
        .await?
        {
            StoredStringRecord::Stored(raw) => NookDatabase::decode_keyring(&raw)?,
            StoredStringRecord::MissingKey => LocalIdentityKeyring::empty(),
        };
        let migrated = NookDatabase::migrate_legacy_active_key(LegacyIdentityKeyMigration {
            store,
            directory,
            keyring,
        })
        .await?;
        let keyring = migrated.keyring;
        NookDatabase::validate_keyring_directory_binding(
            KeyringDbValidateKeyringDirectoryBinding {
                keyring: &keyring,
                directory,
            },
        )?;
        if matches!(migrated.state, legacy::LegacyKeyMigrationState::Migrated) {
            NookDatabase::write_keyring(KeyringDbWriteKeyring {
                store,
                keyring: &keyring,
            })
            .await?;
        }
        Ok(keyring)
    }
}

impl NookDatabase {
    pub(super) async fn selected_entry_from_store(
        store: &rexie::Store,
    ) -> Result<StoredIdentityProtection, NookError> {
        let directory = NookDatabase::load_directory_for_write(store).await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store,
            directory: &directory,
        })
        .await?;
        let IdentitySelection::Selected(identity_id) = directory.selection() else {
            return Ok(StoredIdentityProtection::Unprotected);
        };
        Ok(match keyring.entry(identity_id) {
            LocalIdentityProtection::Protected(entry) => {
                StoredIdentityProtection::protected(entry.clone())
            }
            LocalIdentityProtection::Unprotected => StoredIdentityProtection::Unprotected,
        })
    }
}

impl NookDatabase {
    pub(super) async fn entry_for_app_id_from_store(
        request: KeyringDbEntryForAppIdFromStore<'_>,
    ) -> Result<StoredIdentityProtection, NookError> {
        let KeyringDbEntryForAppIdFromStore { store, app_id } = request;
        let directory = NookDatabase::load_directory_for_write(store).await?;
        Ok(
            NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
                store,
                directory: &directory,
            })
            .await?
            .entries()
            .iter()
            .find(|entry| entry.app_id() == app_id)
            .map_or(StoredIdentityProtection::Unprotected, |entry| {
                StoredIdentityProtection::protected(entry.clone())
            }),
        )
    }
}

impl NookDatabase {
    pub(crate) async fn load_selected_entry() -> Result<StoredIdentityProtection, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
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
        let entry = NookDatabase::selected_entry_from_store(&store).await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!(
                "Local identity keyring load completion error: {error:?}"
            ))
        })?;
        Ok(entry)
    }
}

impl NookDatabase {
    pub(crate) async fn selected_legacy_signer_requires_authorization() -> Result<bool, NookError> {
        let StoredIdentityProtection::Protected(entry) =
            NookDatabase::load_selected_entry().await?
        else {
            return Ok(false);
        };
        if entry.has_signing_seed() {
            return Ok(false);
        }
        Ok(matches!(
            NookDatabase::idb_get_string(event_db::SIGNING_SEED_KEY).await?,
            StoredStringRecord::Stored(_)
        ))
    }
}

impl NookDatabase {
    pub(crate) async fn load_entry_for_app_id(
        app_id: &nook_core::AppId,
    ) -> Result<StoredIdentityProtection, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
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
        let directory = NookDatabase::load_directory_for_write(&store).await?;
        let entry = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: &store,
            directory: &directory,
        })
        .await?
        .entries()
        .iter()
        .find(|entry| entry.app_id() == app_id)
        .map_or(StoredIdentityProtection::Unprotected, |entry| {
            StoredIdentityProtection::protected(entry.clone())
        });
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!(
                "Local identity keyring load completion error: {error:?}"
            ))
        })?;
        Ok(entry)
    }
}

impl NookDatabase {
    pub(crate) async fn load_keyring() -> Result<nook_core::LocalIdentityKeyring, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
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
        let directory = NookDatabase::load_directory_for_write(&store).await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: &store,
            directory: &directory,
        })
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!(
                "Local identity keyring load completion error: {error:?}"
            ))
        })?;
        Ok(keyring)
    }
}

pub(crate) struct LocalIdentitySelection {
    pub(crate) selected_app_id: nook_core::AppId,
    pub(crate) previous: PreviousLocalSelection,
}

impl NookDatabase {
    pub(crate) async fn select_local_identity(
        identity_id: nook_core::IdentityId,
    ) -> Result<LocalIdentitySelection, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Identity switch error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity switch store error: {error:?}"))
        })?;
        IdentityTransitionAdmission { store: &store }
            .check()
            .await?;
        let mut directory = NookDatabase::load_directory_for_write(&store).await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: &store,
            directory: &directory,
        })
        .await?;
        let previous = match directory.selected() {
            Ok(identity) => match keyring.entry(&identity.identity_id) {
                LocalIdentityProtection::Protected(entry) => {
                    PreviousLocalSelection::Selected(entry.app_id().clone())
                }
                LocalIdentityProtection::Unprotected => PreviousLocalSelection::Unselected,
            },
            Err(_) => PreviousLocalSelection::Unselected,
        };
        let app_id = keyring
            .entry(&identity_id)
            .require_protected()
            .map_err(NookDatabase::map_domain_error)?
            .app_id()
            .clone();
        directory = directory
            .select(&identity_id)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        NookDatabase::write_identity_directory(IdentityDbWriteIdentityDirectory {
            store: &store,
            directory: &directory,
        })
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity switch completion error: {error:?}"))
        })?;
        Ok(LocalIdentitySelection {
            selected_app_id: app_id,
            previous,
        })
    }
}

#[cfg(test)]
impl NookDatabase {
    pub(crate) async fn clear_keyring_for_test() -> Result<(), NookError> {
        NookDatabase::idb_delete_key(LOCAL_IDENTITY_KEYRING_KEY).await
    }
}

pub(crate) use legacy::LegacyIdentityKeyMigration;
