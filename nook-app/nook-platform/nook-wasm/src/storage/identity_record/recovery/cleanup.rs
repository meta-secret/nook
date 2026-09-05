//! Crash-resumable cleanup journal for destructive local identity recovery.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::storage::indexed_db;
use rexie::TransactionMode;

use crate::{NookError, storage::open_nook_database};
use serde::{Deserialize, Serialize};

pub(crate) const PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY: &str =
    "pending_local_identity_recovery_cleanup_v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct LocalIdentityRecovery {
    pub(crate) retired_app_id: Option<nook_core::AppId>,
    pub(crate) has_remaining_local_identities: bool,
}

impl LocalIdentityRecovery {
    pub(super) async fn load_pending(store: &rexie::Store) -> Result<Option<Self>, NookError> {
        let key = serde_wasm_bindgen::to_value(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
            .map_err(|error| {
                NookError::IndexedDb(format!("Recovery cleanup key error: {error:?}"))
            })?;
        let Some(value) = store
            .get(key)
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Recovery cleanup read error: {error:?}"))
            })?
            .filter(|value| !value.is_undefined() && !value.is_null())
        else {
            return Ok(None);
        };
        let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup value error: {error:?}"))
        })?;
        serde_json::from_str(&raw).map(Some).map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup decode error: {error}"))
        })
    }

    pub(crate) async fn has_pending() -> Result<bool, NookError> {
        Ok(
            indexed_db::idb_get_string(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
                .await?
                .is_some(),
        )
    }

    pub(super) async fn write_pending(&self, store: &rexie::Store) -> Result<(), NookError> {
        let raw = serde_json::to_string(self).map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup encode error: {error}"))
        })?;
        let key = serde_wasm_bindgen::to_value(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
            .map_err(|error| {
                NookError::IndexedDb(format!("Recovery cleanup key error: {error:?}"))
            })?;
        let value = serde_wasm_bindgen::to_value(&raw).map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup value error: {error:?}"))
        })?;
        store.put(&value, Some(&key)).await.map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup write error: {error:?}"))
        })?;
        Ok(())
    }

    pub(crate) async fn complete(self) -> Result<(), NookError> {
        let rexie = open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Recovery cleanup completion error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!(
                "Recovery cleanup completion store error: {error:?}"
            ))
        })?;
        if let Some(pending) = Self::load_pending(&store).await? {
            if pending != self {
                return Err(NookError::Database(
                    "Recovery cleanup target changed before completion".to_owned(),
                ));
            }
            let key = serde_wasm_bindgen::to_value(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
                .map_err(|error| {
                    NookError::IndexedDb(format!("Recovery cleanup delete key error: {error:?}"))
                })?;
            store.delete(key).await.map_err(|error| {
                NookError::IndexedDb(format!("Recovery cleanup delete error: {error:?}"))
            })?;
        }
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup completion error: {error:?}"))
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::identity_record;
    use nook_core::AppKey;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn completion_preserves_changed_targets_and_clears_only_the_matching_marker()
    -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let recovery = LocalIdentityRecovery {
            retired_app_id: Some(app_key.app_id().clone()),
            has_remaining_local_identities: true,
        };
        let database = open_nook_database().await?;
        let transaction = database
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let store = transaction
            .store("vault")
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        recovery.write_pending(&store).await?;
        transaction
            .done()
            .await
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let original = indexed_db::idb_get_string(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
            .await?
            .ok_or_else(|| NookError::Database("Cleanup marker is missing.".to_owned()))?;
        assert!(LocalIdentityRecovery::has_pending().await?);
        for changed in [
            LocalIdentityRecovery {
                retired_app_id: None,
                ..recovery.clone()
            },
            LocalIdentityRecovery {
                has_remaining_local_identities: false,
                ..recovery.clone()
            },
        ] {
            match changed.complete().await {
                Err(NookError::Database(message)) => {
                    assert_eq!(message, "Recovery cleanup target changed before completion");
                }
                Err(error) => return Err(error),
                Ok(()) => {
                    return Err(NookError::Database(
                        "Changed cleanup target was accepted.".to_owned(),
                    ));
                }
            }
            assert_eq!(
                indexed_db::idb_get_string(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
                    .await?
                    .as_ref(),
                Some(&original)
            );
        }
        let absent = recovery.clone();
        recovery.complete().await?;
        assert!(!LocalIdentityRecovery::has_pending().await?);
        absent.complete().await?;
        assert!(!LocalIdentityRecovery::has_pending().await?);
        identity_record::clear_identity_directory_for_test().await
    }
}
