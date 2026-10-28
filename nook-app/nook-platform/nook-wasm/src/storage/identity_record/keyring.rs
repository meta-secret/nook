//! Versioned persistence for independently protected local identity keys.

use crate::IdentityDbWriteIdentityDirectory;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::identity_record::PreviousLocalSelection;
use crate::storage::identity_record::StoredIdentityProtection;
use crate::storage::indexed_db::StoredStringRecord;
use nook_core::LocalIdentityProtection;

use crate::NookDatabase;
use crate::NookError;
use nook_core::{IdentitySelection, LocalIdentityKeyring};
use rexie::TransactionMode;

mod protection;
mod signing;

use protection::IdentityTransitionAdmission;
pub(crate) use protection::ProtectedIdentityPublication;

pub(crate) use signing::{LocalIdentitySigner, MemberSigner};

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
        NookDatabase::validate_keyring_directory_binding(
            KeyringDbValidateKeyringDirectoryBinding {
                keyring: &keyring,
                directory,
            },
        )?;
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

/// Named values required by `NookDatabase::rebind_local_identity`.
pub(crate) struct KeyringDbRebindLocalIdentity<'a> {
    pub(crate) local_identity_id: &'a nook_core::IdentityId,
    pub(crate) replicated_identity_id: &'a nook_core::IdentityId,
}

impl NookDatabase {
    /// Rename a local identity to the replicated identity it belongs to. The
    /// directory and keyring change in one transaction.
    pub(crate) async fn rebind_local_identity(
        request: KeyringDbRebindLocalIdentity<'_>,
    ) -> Result<(), NookError> {
        let KeyringDbRebindLocalIdentity {
            local_identity_id,
            replicated_identity_id,
        } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Identity rebind error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity rebind store error: {error:?}"))
        })?;
        IdentityTransitionAdmission { store: &store }
            .check()
            .await?;
        let directory = NookDatabase::load_directory_for_write(&store).await?;
        let keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store: &store,
            directory: &directory,
        })
        .await?;
        let request = nook_core::ReplicatedIdentityAdoption {
            local_identity_id,
            replicated_identity_id,
        };
        let directory = directory
            .adopt_replicated_identity(&request)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        let keyring = keyring
            .rebind_identity(local_identity_id, replicated_identity_id)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.cause))?;
        NookDatabase::write_identity_directory(IdentityDbWriteIdentityDirectory {
            store: &store,
            directory: &directory,
        })
        .await?;
        NookDatabase::write_keyring(KeyringDbWriteKeyring {
            store: &store,
            keyring: &keyring,
        })
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity rebind completion error: {error:?}"))
        })?;
        Ok(())
    }
}

/// Named values required by `NookDatabase::save_added_passkey_identity`.
pub(crate) struct KeyringDbSaveAddedPasskeyIdentity<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) record: &'a nook_core::WrappedDeviceIdentity,
    /// The member's signer, derived from the same passkey as the app key.
    pub(crate) signer: &'a nook_core::SigningSeedHex,
    pub(crate) identity_id: &'a nook_core::IdentityId,
    /// The source's identity logs.
    pub(crate) identity_logs: &'a [nook_core::ProviderIdentityLogEvents],
}

impl NookDatabase {
    /// Add an identity a provider holds under its original id: the addition
    /// is decided against the directory this transaction reads, then the
    /// identity log, the directory, and the passkey-protected keyring entry
    /// are written together. A refusal writes nothing.
    pub(crate) async fn save_added_passkey_identity(
        request: KeyringDbSaveAddedPasskeyIdentity<'_>,
    ) -> Result<nook_core::AddedIdentitySelection, NookError> {
        let KeyringDbSaveAddedPasskeyIdentity {
            app_key,
            record,
            signer,
            identity_id,
            identity_logs,
        } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault", "events"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Identity add error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity add store error: {error:?}"))
        })?;
        let events_store = transaction.store("events").map_err(|error| {
            NookError::IndexedDb(format!("Identity add events store error: {error:?}"))
        })?;
        let directory = NookDatabase::load_directory_for_write(&store).await?;
        let added = nook_core::PasskeyIdentityAddition {
            app_key,
            signer,
            identity_id,
            identity_logs,
            directory: &directory,
        }
        .add()?;
        let label = added
            .directory
            .identities()
            .iter()
            .find(|identity| &identity.identity_id == identity_id)
            .map(|identity| identity.label.clone())
            .ok_or_else(|| NookError::Database("Added identity disappeared".to_owned()))?;
        NookDatabase::put_identity_events(
            &events_store,
            IdentityLogWrite {
                identity_id,
                events: &added.log.storage_bytes()?,
            },
        )
        .await?;
        ProtectedIdentityPublication {
            store: &store,
            directory: added.directory,
            app_key,
            wrapped_app_key: record,
            label: &label,
        }
        .save_added(identity_id.clone(), signer)
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity add completion error: {error:?}"))
        })?;
        Ok(added.selection)
    }
}
