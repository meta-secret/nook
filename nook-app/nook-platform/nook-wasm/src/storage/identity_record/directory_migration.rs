//! Atomic identity-directory and pending-genesis migration.
use super::genesis_flow::PendingSimpleGenesisFlow;
use super::staged_genesis::StagedSimpleGenesisIdentity;
use super::{
    IDENTITY_DIRECTORY_KEY, IdentityMigrationSelection, LEGACY_IDENTITY_RECORD_KEY,
    PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis, TransactionMode,
};
use crate::storage::identity_record::SimpleGenesisProgress;
use crate::storage::indexed_db::StoredStringRecord;
use crate::{
    IdentityDbMigrateDirectory, IdentityDbMigrateDirectoryInStore, IdentityDbPersistPendingGenesis,
    NookDatabase, NookError,
};
#[cfg(test)]
use nook_core::MemberLabelState;
use nook_core::{
    DirectoryLegacyMigration, IdentityDirectory, LegacyDirectoryBase, MigratedIdentityDirectory,
    MultiDeviceError,
};
impl NookDatabase {
    pub(super) async fn load_pending_genesis(
        store: &rexie::Store,
    ) -> Result<SimpleGenesisProgress, NookError> {
        let pending_id =
            serde_wasm_bindgen::to_value(PENDING_SIMPLE_GENESIS_KEY).map_err(|error| {
                NookError::IndexedDb(format!("Pending genesis key error: {error:?}"))
            })?;
        let pending = store.get(pending_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Pending genesis read error: {error:?}"))
        })?;
        let Some(pending) = pending.filter(|pending| !pending.is_undefined() && !pending.is_null())
        else {
            return Ok(SimpleGenesisProgress::NotPending);
        };
        let raw = serde_wasm_bindgen::from_value::<String>(pending).map_err(|error| {
            NookError::IndexedDb(format!("Pending genesis value error: {error:?}"))
        })?;
        PendingSimpleGenesis::decode(&raw).map(SimpleGenesisProgress::pending)
    }
}

pub(super) struct MigratedPendingGenesis {
    pub(super) pending: PendingSimpleGenesis,
    migration: DirectoryLegacyMigration,
}
#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub(super) struct PendingGenesisMigrationRejection {
    pending: PendingSimpleGenesis,
    #[source]
    cause: MultiDeviceError,
}
impl PendingGenesisMigrationRejection {
    pub(super) fn into_cause(self) -> NookError {
        let Self { pending, cause } = self;
        drop(pending);
        NookDatabase::map_domain_error(cause)
    }
}
impl PendingSimpleGenesis {
    #[expect(
        clippy::result_large_err,
        reason = "the rejection retains pending genesis state so the caller can fail without losing secrets"
    )]
    pub(super) fn migrate_directories(
        mut self,
    ) -> Result<MigratedPendingGenesis, PendingGenesisMigrationRejection> {
        let staged = match self.flow {
            PendingSimpleGenesisFlow::Ordinary => {
                return Ok(MigratedPendingGenesis {
                    pending: self,
                    migration: DirectoryLegacyMigration::Unchanged,
                });
            }
            PendingSimpleGenesisFlow::Staged(staged) => staged,
        };
        let candidate = match staged
            .directory
            .prepare_legacy_duplicate_app_key_ownership_from_base(LegacyDirectoryBase {
                base: &staged.base_directory,
                preserved_identity_id: &self.identity_id,
            }) {
            Ok(candidate) => candidate,
            Err(rejected) => {
                self.flow = PendingSimpleGenesisFlow::Staged(StagedSimpleGenesisIdentity {
                    base_directory: staged.base_directory,
                    directory: rejected.directory,
                });
                return Err(PendingGenesisMigrationRejection {
                    pending: self,
                    cause: rejected.cause,
                });
            }
        };
        let base = match staged
            .base_directory
            .prepare_legacy_duplicate_app_key_ownership_preserving(&self.identity_id)
        {
            Ok(base) => base,
            Err(rejected) => {
                self.flow = PendingSimpleGenesisFlow::Staged(StagedSimpleGenesisIdentity {
                    base_directory: rejected.directory,
                    directory: candidate.cancel(),
                });
                return Err(PendingGenesisMigrationRejection {
                    pending: self,
                    cause: rejected.cause,
                });
            }
        };
        let base = base.commit();
        let candidate = candidate.commit();
        let migration = base.migration.combine(candidate.migration);
        self.flow = PendingSimpleGenesisFlow::Staged(StagedSimpleGenesisIdentity {
            base_directory: base.directory,
            directory: candidate.directory,
        });
        Ok(MigratedPendingGenesis {
            pending: self,
            migration,
        })
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
    ) -> Result<MigratedIdentityDirectory, NookError> {
        let IdentityDbMigrateDirectoryInStore { store, directory } = request;
        let pending = if directory.has_legacy_duplicate_app_key_ownership() {
            NookDatabase::load_pending_genesis(store).await?
        } else {
            SimpleGenesisProgress::NotPending
        };
        let selection = match &pending {
            SimpleGenesisProgress::NotPending => IdentityMigrationSelection::DirectorySelection,
            SimpleGenesisProgress::Pending(pending) => {
                IdentityMigrationSelection::PreserveGenesis(&pending.identity_id)
            }
        };
        let migrated = NookDatabase::migrate_directory(IdentityDbMigrateDirectory {
            directory,
            selection,
        })?;
        if let SimpleGenesisProgress::Pending(pending) = pending {
            let migrated_pending = pending
                .migrate_directories()
                .map_err(PendingGenesisMigrationRejection::into_cause)?;
            if migrated_pending.migration == DirectoryLegacyMigration::Merged {
                NookDatabase::persist_pending_genesis(IdentityDbPersistPendingGenesis {
                    store,
                    pending: &migrated_pending.pending,
                })
                .await?;
            }
        }
        Ok(migrated)
    }
}

impl NookDatabase {
    pub(super) async fn load_or_migrate_identity_directory_raw()
    -> Result<StoredStringRecord, NookError> {
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
            let MigratedIdentityDirectory {
                directory,
                migration,
            } = NookDatabase::migrate_directory_in_store(IdentityDbMigrateDirectoryInStore {
                store: &store,
                directory,
            })
            .await?;
            let raw = if migration == DirectoryLegacyMigration::Merged {
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
            return Ok(StoredStringRecord::Stored(raw));
        }
        let legacy = store.get(legacy_id.clone()).await.map_err(|error| {
            NookError::IndexedDb(format!("Legacy identity read error: {error:?}"))
        })?;
        let Some(value) = legacy.filter(|value| !value.is_undefined() && !value.is_null()) else {
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!("Identity migration completion error: {error:?}"))
            })?;
            return Ok(StoredStringRecord::MissingKey);
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
        Ok(StoredStringRecord::Stored(raw))
    }
}
#[cfg(test)]
mod tests {
    use crate::IdbPutStringRequest;
    use crate::storage::event_db;
    use crate::storage::identity_record::{
        SimpleGenesisCompletion, genesis_flow, simple_genesis, staged_genesis,
    };
    use nook_core::{DirectoryOwnedVaultOpening, IdentityCreation, IdentityVaultKeyOpening};

    use super::*;
    use nook_core::{AppKey, IsoTimestamp};
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    async fn migration_preserves_identity_referenced_by_pending_genesis() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut legacy = IdentityDirectory::empty();
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Pending genesis",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let pending_identity_id = resolved_identity.identity_id;
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Selected",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let selected_identity_id = resolved_identity.identity_id;
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
            .require_pending()
            .map_err(|_| NookError::IndexedDb("Pending genesis marker is missing.".to_owned()))?;
        assert_eq!(pending.identity_id, pending_identity_id);
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn migration_normalizes_staged_genesis_snapshots_atomically() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut legacy = IdentityDirectory::empty();
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Pending genesis",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let pending_identity_id = resolved_identity.identity_id;
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Selected",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let mut candidate = legacy.clone();
        let opened_identity = candidate
            .open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                identity_id: &pending_identity_id,
                vault: IdentityVaultKeyOpening {
                    app_key: &app_key,
                    store_id: store_id.clone(),
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        candidate = opened_identity.directory;
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
        let normalized_raw = match NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await? {
            StoredStringRecord::Stored(value) => Ok(value),
            StoredStringRecord::MissingKey => {
                Err(NookError::Database("Staged marker is missing.".to_owned()))
            }
        }?;
        let normalized = PendingSimpleGenesis::decode(&normalized_raw)?;
        let staged = normalized
            .require_staged_identity()
            .map_err(|_| NookError::Database("Staged snapshots are missing.".to_owned()))?;
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
