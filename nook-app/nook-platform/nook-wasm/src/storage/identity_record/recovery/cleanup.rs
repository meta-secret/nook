//! Crash-resumable cleanup journal for destructive local identity recovery.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage::indexed_db;
use crate::storage::indexed_db::StoredStringRecord;
use crate::{NookDatabase, NookError};
use rexie::TransactionMode;

use super::RetiredInstallation;
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Eq)]
pub(super) enum RecoveryCleanupState {
    Complete,
    Pending(LocalIdentityRecovery),
}

pub(crate) const PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY: &str =
    "pending_local_identity_recovery_cleanup_v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct LocalIdentityRecovery {
    #[serde(default)]
    pub(crate) retired_app_id: RetiredInstallation,
    pub(crate) has_remaining_local_identities: bool,
}

impl LocalIdentityRecovery {
    pub(super) async fn load_pending(
        store: &rexie::Store,
    ) -> Result<RecoveryCleanupState, NookError> {
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
            return Ok(RecoveryCleanupState::Complete);
        };
        let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
            NookError::IndexedDb(format!("Recovery cleanup value error: {error:?}"))
        })?;
        serde_json::from_str(&raw)
            .map(RecoveryCleanupState::Pending)
            .map_err(|error| {
                NookError::IndexedDb(format!("Recovery cleanup decode error: {error}"))
            })
    }

    pub(crate) async fn has_pending() -> Result<bool, NookError> {
        Ok(matches!(
            NookDatabase::idb_get_string(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY).await?,
            StoredStringRecord::Stored(_)
        ))
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
        let rexie = NookDatabase::open_nook_database().await?;
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
        if let RecoveryCleanupState::Pending(pending) = Self::load_pending(&store).await? {
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
    #[cfg(target_arch = "wasm32")]
    use crate::storage::identity_record;
    use nook_core::AppKey;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn completion_preserves_changed_targets_and_clears_only_the_matching_marker()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let recovery = LocalIdentityRecovery {
            retired_app_id: RetiredInstallation::App(app_key.app_id().clone()),
            has_remaining_local_identities: true,
        };
        let database = NookDatabase::open_nook_database().await?;
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
        let original = match NookDatabase::idb_get_string(
            PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
        )
        .await?
        {
            StoredStringRecord::Stored(value) => Ok(value),
            StoredStringRecord::MissingKey => {
                Err(NookError::Database("Cleanup marker is missing.".to_owned()))
            }
        }?;
        assert!(LocalIdentityRecovery::has_pending().await?);
        for changed in [
            LocalIdentityRecovery {
                retired_app_id: RetiredInstallation::Unattributed,
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
                NookDatabase::idb_get_string(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY).await?,
                StoredStringRecord::Stored(original.clone())
            );
        }
        let absent = recovery.clone();
        recovery.complete().await?;
        assert!(!LocalIdentityRecovery::has_pending().await?);
        absent.complete().await?;
        assert!(!LocalIdentityRecovery::has_pending().await?);
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn pending_marker_round_trips_and_treats_null_as_absent() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let recovery = LocalIdentityRecovery {
            retired_app_id: RetiredInstallation::App(app_key.app_id().clone()),
            has_remaining_local_identities: false,
        };
        let database = NookDatabase::open_nook_database().await?;
        let transaction = database
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let store = transaction
            .store("vault")
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let key = serde_wasm_bindgen::to_value(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let null = serde_wasm_bindgen::to_value(&())
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        store
            .put(&null, Some(&key))
            .await
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        assert_eq!(
            LocalIdentityRecovery::load_pending(&store).await?,
            RecoveryCleanupState::Complete
        );
        recovery.write_pending(&store).await?;
        assert_eq!(
            LocalIdentityRecovery::load_pending(&store).await?,
            RecoveryCleanupState::Pending(recovery)
        );
        transaction
            .done()
            .await
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn pending_marker_rejects_malformed_json() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let database = NookDatabase::open_nook_database().await?;
        let transaction = database
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let store = transaction
            .store("vault")
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let key = serde_wasm_bindgen::to_value(PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let malformed = serde_wasm_bindgen::to_value("{not-json")
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        store
            .put(&malformed, Some(&key))
            .await
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let Err(error) = LocalIdentityRecovery::load_pending(&store).await else {
            return Err(NookError::IndexedDb(
                "malformed cleanup marker must be rejected".to_owned(),
            ));
        };
        assert!(
            matches!(error, NookError::IndexedDb(ref message) if message.contains("Recovery cleanup decode error")),
            "unexpected error: {error}"
        );
        transaction
            .done()
            .await
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        NookDatabase::clear_identity_directory_for_test().await
    }
}
