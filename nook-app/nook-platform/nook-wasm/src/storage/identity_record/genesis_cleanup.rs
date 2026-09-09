//! Atomic publication and cleanup for completed Simple-vault genesis.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::IdentityDbMigrateDirectory;
use crate::storage::event_db;
use crate::{NookDatabase, NookError};
use nook_core::{IdentityDirectory, StagedIdentityRebase};
use rexie::TransactionMode;

use super::{
    IDENTITY_DIRECTORY_KEY, PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis,
    SimpleGenesisCompletion,
};

impl SimpleGenesisCompletion<'_> {
    async fn publish_staged_identity(
        &self,
        store: &rexie::Store,
        pending: &mut PendingSimpleGenesis,
    ) -> Result<(), NookError> {
        let directory_id =
            serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY).map_err(|error| {
                NookError::IndexedDb(format!("Genesis identity key error: {error:?}"))
            })?;
        let current = store.get(directory_id.clone()).await.map_err(|error| {
            NookError::IndexedDb(format!("Genesis identity read error: {error:?}"))
        })?;
        let current = current
            .filter(|value| !value.is_undefined() && !value.is_null())
            .map(|value| {
                let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                    NookError::IndexedDb(format!("Genesis identity decode error: {error:?}"))
                })?;
                NookDatabase::decode_directory_value(&raw)
            })
            .transpose()?
            .unwrap_or_else(IdentityDirectory::empty);
        let migrate_staged = current.has_legacy_duplicate_app_key_ownership()
            || pending.staged_identity().is_some_and(|staged| {
                staged
                    .base_directory
                    .has_legacy_duplicate_app_key_ownership()
            });
        let (current, _) = NookDatabase::migrate_directory(IdentityDbMigrateDirectory {
            directory: current,
            preserved_identity_id: Some(&pending.identity_id),
        })?;
        if migrate_staged {
            NookDatabase::migrate_staged_genesis_directories(pending)?;
        }
        let staged = pending.staged_identity().ok_or_else(|| {
            NookError::IndexedDb("Staged genesis identity state disappeared.".to_owned())
        })?;
        let directory = if current == staged.base_directory {
            let candidate = staged.directory.clone();
            candidate
                .validate()
                .map_err(NookDatabase::map_domain_error)?;
            candidate
        } else {
            current
                .rebase_staged_vault_creation(StagedIdentityRebase {
                    base: &staged.base_directory,
                    candidate: &staged.directory,
                    identity_id: &pending.identity_id,
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?
        };
        let encoded = serde_json::to_string(&directory).map_err(|error| {
            NookError::IndexedDb(format!("Genesis identity encode error: {error}"))
        })?;
        let encoded = serde_wasm_bindgen::to_value(&encoded).map_err(|error| {
            NookError::IndexedDb(format!("Genesis identity value error: {error:?}"))
        })?;
        store
            .put(&encoded, Some(&directory_id))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Genesis identity write error: {error:?}"))
            })?;
        let signing_seed = self.staged_signing_seed().ok_or_else(|| {
            NookError::IndexedDb(
                "Staged genesis completion is missing its signing seed.".to_owned(),
            )
        })?;
        let seed_key =
            serde_wasm_bindgen::to_value(event_db::SIGNING_SEED_KEY).map_err(|error| {
                NookError::IndexedDb(format!("Genesis signing key error: {error:?}"))
            })?;
        let seed_value = serde_wasm_bindgen::to_value(signing_seed).map_err(|error| {
            NookError::IndexedDb(format!("Genesis signing value error: {error:?}"))
        })?;
        store
            .put(&seed_value, Some(&seed_key))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Genesis signing write error: {error:?}"))
            })?;
        Ok(())
    }

    pub(crate) async fn clear_pending(self) -> Result<(), NookError> {
        let completed = self.pending();
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Genesis cleanup error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Genesis cleanup store error: {error:?}"))
        })?;
        let id = serde_wasm_bindgen::to_value(PENDING_SIMPLE_GENESIS_KEY)
            .map_err(|error| NookError::IndexedDb(format!("Genesis key error: {error:?}")))?;
        let current = store.get(id.clone()).await.map_err(|error| {
            NookError::IndexedDb(format!("Genesis cleanup read error: {error:?}"))
        })?;
        if let Some(current) = current.filter(|value| !value.is_undefined() && !value.is_null()) {
            let raw: String = serde_wasm_bindgen::from_value(current).map_err(|error| {
                NookError::IndexedDb(format!("Genesis cleanup decode error: {error:?}"))
            })?;
            let mut pending = PendingSimpleGenesis::decode(&raw)?;
            if pending.store_id == completed.store_id
                && pending.identity_id == completed.identity_id
                && pending.created_at == completed.created_at
            {
                if pending.is_staged() {
                    self.publish_staged_identity(&store, &mut pending).await?;
                }
                store.delete(id).await.map_err(|error| {
                    NookError::IndexedDb(format!("Genesis cleanup delete error: {error:?}"))
                })?;
            }
        }
        transaction.done().await.map(|_| ()).map_err(|error| {
            NookError::IndexedDb(format!("Genesis cleanup completion error: {error:?}"))
        })
    }
}
