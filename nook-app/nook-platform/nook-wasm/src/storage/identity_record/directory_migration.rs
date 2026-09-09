//! Atomic identity-directory and pending-genesis migration.
use super::*;
use crate::{
    IdentityDbMigrateDirectory, IdentityDbMigrateDirectoryInStore, IdentityDbPersistPendingGenesis,
    NookDatabase, NookError,
};
use nook_core::IdentityDirectory;
impl NookDatabase {
    pub(super) async fn load_pending_genesis(
        store: &rexie::Store,
    ) -> Result<Option<PendingSimpleGenesis>, NookError> {
        let pending_id =
            serde_wasm_bindgen::to_value(PENDING_SIMPLE_GENESIS_KEY).map_err(|error| {
                NookError::IndexedDb(format!("Pending genesis key error: {error:?}"))
            })?;
        let pending = store.get(pending_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Pending genesis read error: {error:?}"))
        })?;
        pending
            .filter(|pending| !pending.is_undefined() && !pending.is_null())
            .map(serde_wasm_bindgen::from_value::<String>)
            .transpose()
            .map_err(|error| {
                NookError::IndexedDb(format!("Pending genesis value error: {error:?}"))
            })?
            .map(|raw| PendingSimpleGenesis::decode(&raw))
            .transpose()
    }
}

impl NookDatabase {
    pub(super) fn migrate_staged_genesis_directories(
        pending: &mut PendingSimpleGenesis,
    ) -> Result<bool, NookError> {
        let genesis_flow::PendingSimpleGenesisFlow::Staged(staged) = &mut pending.flow else {
            return Ok(false);
        };
        let legacy_base = staged.base_directory.clone();
        let (base_directory, base_changed) = staged
            .base_directory
            .clone()
            .migrate_legacy_duplicate_app_key_ownership_preserving(&pending.identity_id)
            .map_err(NookDatabase::map_domain_error)?;
        let (directory, directory_changed) = staged
            .directory
            .clone()
            .migrate_legacy_duplicate_app_key_ownership_from_base(
                &legacy_base,
                &pending.identity_id,
            )
            .map_err(NookDatabase::map_domain_error)?;
        staged.base_directory = base_directory;
        staged.directory = directory;
        Ok(base_changed || directory_changed)
    }
}

impl NookDatabase {
    pub(super) async fn persist_pending_genesis(
        request: IdentityDbPersistPendingGenesis<'_>,
    ) -> Result<(), NookError> {
        let IdentityDbPersistPendingGenesis { store, pending } = request;
        let key = serde_wasm_bindgen::to_value(PENDING_SIMPLE_GENESIS_KEY).map_err(|error| {
            NookError::IndexedDb(format!("Pending genesis key error: {error:?}"))
        })?;
        let encoded = pending.encode()?;
        let value = serde_wasm_bindgen::to_value(&encoded).map_err(|error| {
            NookError::IndexedDb(format!("Pending genesis value error: {error:?}"))
        })?;
        store
            .put(&value, Some(&key))
            .await
            .map(|_| ())
            .map_err(|error| {
                NookError::IndexedDb(format!("Pending genesis write error: {error:?}"))
            })
    }
}

impl NookDatabase {
    pub(super) async fn migrate_directory_in_store(
        request: IdentityDbMigrateDirectoryInStore<'_>,
    ) -> Result<(IdentityDirectory, bool), NookError> {
        let IdentityDbMigrateDirectoryInStore { store, directory } = request;
        let mut pending = if directory.has_legacy_duplicate_app_key_ownership() {
            NookDatabase::load_pending_genesis(store).await?
        } else {
            None
        };
        let preserved_identity_id = pending.as_ref().map(|pending| &pending.identity_id);
        let (directory, migrated) = NookDatabase::migrate_directory(IdentityDbMigrateDirectory {
            directory: directory,
            preserved_identity_id: preserved_identity_id,
        })?;
        if let Some(pending) = &mut pending
            && NookDatabase::migrate_staged_genesis_directories(pending)?
        {
            NookDatabase::persist_pending_genesis(IdentityDbPersistPendingGenesis {
                store: store,
                pending: pending,
            })
            .await?;
        }
        Ok((directory, migrated))
    }
}

impl NookDatabase {
    pub(super) async fn load_or_migrate_identity_directory_raw() -> Result<Option<String>, NookError>
    {
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Identity migration error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity migration store error: {error:?}"))
        })?;
        let current_id = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY).map_err(|error| {
            NookError::IndexedDb(format!("Identity directory key error: {error:?}"))
        })?;
        let legacy_id =
            serde_wasm_bindgen::to_value(LEGACY_IDENTITY_RECORD_KEY).map_err(|error| {
                NookError::IndexedDb(format!("Legacy identity key error: {error:?}"))
            })?;
        let current = store.get(current_id.clone()).await.map_err(|error| {
            NookError::IndexedDb(format!("Identity directory read error: {error:?}"))
        })?;
        if let Some(value) = current.filter(|value| !value.is_undefined() && !value.is_null()) {
            let persisted_raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                NookError::IndexedDb(format!("Identity directory value error: {error:?}"))
            })?;
            let directory = NookDatabase::decode_directory_value(&persisted_raw)?;
            let (directory, migrated) =
                NookDatabase::migrate_directory_in_store(IdentityDbMigrateDirectoryInStore {
                    store: &store,
                    directory: directory,
                })
                .await?;
            let raw = if migrated {
                let normalized = serde_json::to_string(&directory).map_err(|error| {
                    NookError::IndexedDb(format!("Identity directory encode error: {error}"))
                })?;
                let normalized_value =
                    serde_wasm_bindgen::to_value(&normalized).map_err(|error| {
                        NookError::IndexedDb(format!("Identity directory value error: {error:?}"))
                    })?;
                store
                    .put(&normalized_value, Some(&current_id))
                    .await
                    .map_err(|error| {
                        NookError::IndexedDb(format!("Identity directory write error: {error:?}"))
                    })?;
                normalized
            } else {
                persisted_raw
            };
            store.delete(legacy_id).await.map_err(|error| {
                NookError::IndexedDb(format!("Legacy identity delete error: {error:?}"))
            })?;
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!("Identity migration completion error: {error:?}"))
            })?;
            return Ok(Some(raw));
        }
        let legacy = store.get(legacy_id.clone()).await.map_err(|error| {
            NookError::IndexedDb(format!("Legacy identity read error: {error:?}"))
        })?;
        let Some(value) = legacy.filter(|value| !value.is_undefined() && !value.is_null()) else {
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!("Identity migration completion error: {error:?}"))
            })?;
            return Ok(None);
        };
        let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
            NookError::IndexedDb(format!("Legacy identity value error: {error:?}"))
        })?;
        let record: nook_core::IdentityRecord = serde_json::from_str(&raw).map_err(|error| {
            NookError::IndexedDb(format!("Legacy identity record decode error: {error}"))
        })?;
        let directory = IdentityDirectory::from_legacy_record(record)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let raw = serde_json::to_string(&directory).map_err(|error| {
            NookError::IndexedDb(format!("Identity directory encode error: {error}"))
        })?;
        let value = serde_wasm_bindgen::to_value(&raw).map_err(|error| {
            NookError::IndexedDb(format!("Identity directory value error: {error:?}"))
        })?;
        store
            .put(&value, Some(&current_id))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Identity directory write error: {error:?}"))
            })?;
        store.delete(legacy_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Legacy identity delete error: {error:?}"))
        })?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity migration completion error: {error:?}"))
        })?;
        Ok(Some(raw))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::AppKey;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    async fn migration_preserves_identity_referenced_by_pending_genesis() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut legacy = IdentityDirectory::empty();
        let pending_identity_id = legacy
            .create_identity("Pending genesis", &app_key, None)
            .map_err(NookDatabase::map_domain_error)?;
        let selected_identity_id = legacy
            .create_identity("Selected", &app_key, None)
            .map_err(NookDatabase::map_domain_error)?;
        assert_ne!(pending_identity_id, selected_identity_id);
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&legacy)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        })
        .await?;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let pending_raw = serde_json::json!({
            "storeId": store_id,
            "identityId": pending_identity_id,
        })
        .to_string();
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: PENDING_SIMPLE_GENESIS_KEY,
            value: &pending_raw,
        })
        .await?;

        let migrated = NookDatabase::load_identity_directory().await?;

        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(
            migrated
                .selected()
                .map_err(NookDatabase::map_domain_error)?
                .identity_id,
            pending_identity_id
        );
        let pending = PendingSimpleGenesis::load_for_store(store_id.as_str())
            .await?
            .ok_or_else(|| NookError::Database("Pending genesis marker is missing.".to_owned()))?;
        assert_eq!(pending.identity_id, pending_identity_id);
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn migration_normalizes_staged_genesis_snapshots_atomically() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut legacy = IdentityDirectory::empty();
        let pending_identity_id = legacy
            .create_identity("Pending genesis", &app_key, None)
            .map_err(NookDatabase::map_domain_error)?;
        legacy
            .create_identity("Selected", &app_key, None)
            .map_err(NookDatabase::map_domain_error)?;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let mut candidate = legacy.clone();
        candidate
            .open_or_generate_vault_dek_for_identity(
                &pending_identity_id,
                &app_key,
                store_id.clone(),
            )
            .map_err(NookDatabase::map_domain_error)?;
        let pending = PendingSimpleGenesis {
            store_id: store_id.clone(),
            identity_id: pending_identity_id.clone(),
            created_at: IsoTimestamp::parse("2026-08-15T00:00:00.000Z")
                .map_err(|error| NookError::Database(error.to_string()))?,
            event_state: simple_genesis::PendingSimpleGenesisEvent::AwaitingEvent,
            flow: genesis_flow::PendingSimpleGenesisFlow::Staged(
                staged_genesis::StagedSimpleGenesisIdentity {
                    base_directory: legacy.clone(),
                    directory: candidate,
                },
            ),
        };
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&legacy)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: PENDING_SIMPLE_GENESIS_KEY,
            value: &pending.encode()?,
        })
        .await?;

        let migrated = NookDatabase::load_identity_directory().await?;
        let normalized_raw = NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
            .await?
            .ok_or_else(|| NookError::Database("Staged marker is missing.".to_owned()))?;
        let normalized = PendingSimpleGenesis::decode(&normalized_raw)?;
        let staged = normalized
            .staged_identity()
            .ok_or_else(|| NookError::Database("Staged snapshots are missing.".to_owned()))?;
        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(staged.base_directory.identities().len(), 1);
        assert_eq!(staged.directory.identities().len(), 1);
        SimpleGenesisCompletion::Staged {
            pending: &normalized,
            signing_seed: "staged-migration-signing-seed",
        }
        .clear_pending()
        .await?;
        let published = NookDatabase::load_identity_directory().await?;
        assert!(
            published
                .selected()
                .map_err(NookDatabase::map_domain_error)?
                .owns_vault(&store_id)
        );
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        NookDatabase::clear_identity_directory_for_test().await
    }
}
