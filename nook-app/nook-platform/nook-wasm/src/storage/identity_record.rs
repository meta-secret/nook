//! Local identity-directory persistence, independent of vault `store_id`.

use std::cell::RefCell;
use std::rc::Rc;

#[cfg(test)]
use super::indexed_db::idb_put_string;
use super::indexed_db::{
    StringUpdateGuard, StringUpdateResult, idb_delete_key, idb_get_string, idb_update_string,
};
use crate::{NookError, storage::open_nook_database};

mod simple_genesis;
pub(crate) use simple_genesis::{
    PendingSimpleGenesis, begin_or_resume_simple_genesis, clear_pending_simple_genesis,
    pending_simple_genesis_for_store, persist_simple_genesis_event,
};

const IDENTITY_DIRECTORY_KEY: &str = "identity_directory_v1";
const LEGACY_IDENTITY_RECORD_KEY: &str = "identity_record_v1";
const PENDING_IDENTITY_RECONCILIATION_PREFIX: &str = "pending_identity_reconciliation_v1:";

async fn load_or_migrate_identity_directory_raw() -> Result<Option<String>, NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|error| NookError::IndexedDb(format!("Identity migration error: {error:?}")))?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!("Identity migration store error: {error:?}"))
    })?;
    let current_id = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY).map_err(|error| {
        NookError::IndexedDb(format!("Identity directory key error: {error:?}"))
    })?;
    let legacy_id = serde_wasm_bindgen::to_value(LEGACY_IDENTITY_RECORD_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Legacy identity key error: {error:?}")))?;
    let current = store.get(current_id.clone()).await.map_err(|error| {
        NookError::IndexedDb(format!("Identity directory read error: {error:?}"))
    })?;
    if let Some(value) = current.filter(|value| !value.is_undefined() && !value.is_null()) {
        let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
            NookError::IndexedDb(format!("Identity directory value error: {error:?}"))
        })?;
        let _ = decode_directory(&raw)?;
        store.delete(legacy_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Legacy identity delete error: {error:?}"))
        })?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity migration completion error: {error:?}"))
        })?;
        return Ok(Some(raw));
    }
    let legacy = store
        .get(legacy_id.clone())
        .await
        .map_err(|error| NookError::IndexedDb(format!("Legacy identity read error: {error:?}")))?;
    let Some(value) = legacy.filter(|value| !value.is_undefined() && !value.is_null()) else {
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity migration completion error: {error:?}"))
        })?;
        return Ok(None);
    };
    let raw: String = serde_wasm_bindgen::from_value(value)
        .map_err(|error| NookError::IndexedDb(format!("Legacy identity value error: {error:?}")))?;
    let record: nook_core::IdentityRecord = serde_json::from_str(&raw).map_err(|error| {
        NookError::IndexedDb(format!("Legacy identity record decode error: {error}"))
    })?;
    let directory = nook_core::IdentityDirectory::from_legacy_record(record)
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

pub(crate) async fn load_identity_directory() -> Result<nook_core::IdentityDirectory, NookError> {
    let raw = load_or_migrate_identity_directory_raw().await?;
    raw.map_or_else(
        || Ok(nook_core::IdentityDirectory::empty()),
        |raw| decode_directory(&raw),
    )
}

fn decode_directory(raw: &str) -> Result<nook_core::IdentityDirectory, NookError> {
    let directory: nook_core::IdentityDirectory = serde_json::from_str(raw).map_err(|error| {
        NookError::IndexedDb(format!("Identity directory decode error: {error}"))
    })?;
    directory
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))?;
    Ok(directory)
}

pub(crate) async fn update_identity_directory<F, T>(update: F) -> Result<T, NookError>
where
    F: FnOnce(&mut nook_core::IdentityDirectory) -> Result<T, NookError>,
{
    // Complete legacy migration before entering the atomic current-key update.
    let _ = load_identity_directory().await?;
    let result = Rc::new(RefCell::new(None));
    let captured_result = Rc::clone(&result);
    let disposition = idb_update_string(
        IDENTITY_DIRECTORY_KEY,
        StringUpdateGuard::Unconditional,
        move |raw| {
            let mut directory = match raw {
                Some(raw) => decode_directory(&raw)?,
                None => nook_core::IdentityDirectory::empty(),
            };
            let value = update(&mut directory)?;
            directory
                .validate()
                .map_err(|error| NookError::Database(error.to_string()))?;
            let encoded = serde_json::to_string(&directory).map_err(|error| {
                NookError::IndexedDb(format!("Identity directory encode error: {error}"))
            })?;
            *captured_result.borrow_mut() = Some(value);
            Ok(encoded)
        },
    )
    .await?;
    if disposition != StringUpdateResult::Applied {
        return Err(NookError::IndexedDb(
            "Identity directory update was rejected.".to_owned(),
        ));
    }
    result.borrow_mut().take().ok_or_else(|| {
        NookError::IndexedDb("Identity directory update produced no result.".to_owned())
    })
}

pub(crate) async fn load_selected_identity() -> Result<Option<nook_core::IdentityRecord>, NookError>
{
    let directory = load_identity_directory().await?;
    match directory.selection() {
        nook_core::IdentitySelection::Empty => Ok(None),
        nook_core::IdentitySelection::Selected(_) => directory
            .selected()
            .cloned()
            .map(Some)
            .map_err(|error| NookError::Database(error.to_string())),
    }
}

/// Ensure the selected identity contains the current app key.
///
/// This preserves the legacy single-installation bootstrap. New cross-installation
/// membership uses the explicit enrollment flow rather than this compatibility path.
pub(crate) async fn ensure_local_identity_for_app_key(
    app_key: &nook_core::AppKey,
    label: &str,
) -> Result<nook_core::IdentityRecord, NookError> {
    let app_key = app_key.clone();
    let label = label.to_owned();
    update_identity_directory(move |directory| {
        if matches!(directory.selection(), nook_core::IdentitySelection::Empty) {
            directory
                .create_identity(&label, &app_key, None)
                .map_err(|error| NookError::Database(error.to_string()))?;
        } else {
            let selected = directory
                .selected_mut()
                .map_err(|error| NookError::Database(error.to_string()))?;
            if !selected
                .members
                .iter()
                .any(|member| member.app_id == *app_key.app_id())
            {
                return Err(NookError::Database(
                    nook_core::MultiDeviceError::IdentityEnrollmentRequired.to_string(),
                ));
            }
        }
        directory
            .selected()
            .cloned()
            .map_err(|error| NookError::Database(error.to_string()))
    })
    .await
}

pub(crate) async fn ensure_unambiguous_identity_for_app_key(
    app_key: &nook_core::AppKey,
    label: &str,
) -> Result<nook_core::IdentityRecord, NookError> {
    let app_key = app_key.clone();
    let label = label.to_owned();
    update_identity_directory(move |directory| {
        let identity_id = match directory
            .identity_for_app_key(&app_key)
            .map_err(|error| NookError::Database(error.to_string()))?
        {
            Some(identity_id) => identity_id,
            None => directory
                .create_identity(&label, &app_key, None)
                .map_err(|error| NookError::Database(error.to_string()))?,
        };
        directory
            .identities()
            .iter()
            .find(|record| record.identity_id == identity_id)
            .cloned()
            .ok_or_else(|| NookError::Database("Identity disappeared during binding.".to_owned()))
    })
    .await
}

/// Associate a legacy vault with an identity without guessing from active selection.
pub(crate) async fn ensure_identity_from_legacy_vault(
    app_key: &nook_core::AppKey,
    store_id: &nook_core::StoreId,
    secrets_envelope: nook_core::AgeArmoredCiphertext,
    members_envelope: nook_core::AgeArmoredCiphertext,
    key_epoch: nook_core::IdentityVaultDekEpoch,
    label: &str,
) -> Result<nook_core::IdentityRecord, NookError> {
    let app_key = app_key.clone();
    let store_id = store_id.clone();
    let label = label.to_owned();
    let epoch_update = identity_epoch_update_for_store(&store_id, key_epoch).await?;
    update_identity_directory(move |directory| {
        let identity_id = directory
            .import_legacy_vault(
                &label,
                &app_key,
                store_id,
                secrets_envelope,
                members_envelope,
                epoch_update,
            )
            .map_err(|error| NookError::Database(error.to_string()))?;
        directory
            .identities()
            .iter()
            .find(|record| record.identity_id == identity_id)
            .cloned()
            .ok_or_else(|| NookError::Database("Imported identity disappeared.".to_owned()))
    })
    .await
}

fn identity_reconciliation_key(store_id: &nook_core::StoreId) -> String {
    format!("{PENDING_IDENTITY_RECONCILIATION_PREFIX}{store_id}")
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingIdentityReconciliation {
    store_id: nook_core::StoreId,
    previous_key_epoch: nook_core::Sha256Hex,
    previous_checkpoint: nook_core::Sha256Hex,
    key_epoch: nook_core::Sha256Hex,
    #[serde(default)]
    checkpoint_state: PendingIdentityReconciliationCheckpoint,
}

#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PendingIdentityReconciliationCheckpoint {
    #[default]
    AwaitingCheckpoint,
    Committed {
        checkpoint: nook_core::Sha256Hex,
    },
}

pub(crate) async fn mark_identity_reconciliation_pending(
    store_id: &nook_core::StoreId,
    previous_key_epoch: &nook_core::Sha256Hex,
    previous_checkpoint: &nook_core::Sha256Hex,
    key_epoch: &nook_core::Sha256Hex,
) -> Result<(), NookError> {
    let pending = PendingIdentityReconciliation {
        store_id: store_id.clone(),
        previous_key_epoch: previous_key_epoch.clone(),
        previous_checkpoint: previous_checkpoint.clone(),
        key_epoch: key_epoch.clone(),
        checkpoint_state: PendingIdentityReconciliationCheckpoint::AwaitingCheckpoint,
    };
    let raw = serde_json::to_string(&pending)
        .map_err(|error| NookError::Serialization(error.to_string()))?;
    super::indexed_db::idb_put_string(&identity_reconciliation_key(store_id), &raw).await
}

pub(crate) async fn commit_identity_reconciliation_checkpoint(
    store_id: &nook_core::StoreId,
    key_epoch: &nook_core::Sha256Hex,
    checkpoint: &nook_core::Sha256Hex,
) -> Result<(), NookError> {
    let expected_store_id = store_id.clone();
    let expected_key_epoch = key_epoch.clone();
    let committed_checkpoint = checkpoint.clone();
    let disposition = idb_update_string(
        &identity_reconciliation_key(store_id),
        StringUpdateGuard::Unconditional,
        move |raw| {
            let raw = raw.ok_or_else(|| {
                NookError::IndexedDb("Identity reconciliation marker disappeared.".to_owned())
            })?;
            let mut pending: PendingIdentityReconciliation = serde_json::from_str(&raw)
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            if pending.store_id != expected_store_id || pending.key_epoch != expected_key_epoch {
                return Err(NookError::IndexedDb(
                    "Identity reconciliation marker changed before checkpoint commit.".to_owned(),
                ));
            }
            pending.checkpoint_state = PendingIdentityReconciliationCheckpoint::Committed {
                checkpoint: committed_checkpoint.clone(),
            };
            serde_json::to_string(&pending)
                .map_err(|error| NookError::Serialization(error.to_string()))
        },
    )
    .await?;
    if disposition != StringUpdateResult::Applied {
        return Err(NookError::IndexedDb(
            "Identity reconciliation checkpoint update was rejected.".to_owned(),
        ));
    }
    Ok(())
}

async fn identity_epoch_update_for_store(
    store_id: &nook_core::StoreId,
    observed: nook_core::IdentityVaultDekEpoch,
) -> Result<nook_core::IdentityVaultDekEpochUpdate, NookError> {
    let Some(raw) = idb_get_string(&identity_reconciliation_key(store_id)).await? else {
        return Ok(nook_core::IdentityVaultDekEpochUpdate::Observe {
            key_epoch: observed,
        });
    };
    let Ok(pending) = serde_json::from_str::<PendingIdentityReconciliation>(&raw) else {
        return Ok(nook_core::IdentityVaultDekEpochUpdate::Observe {
            key_epoch: observed,
        });
    };
    let (observed_epoch, observed_checkpoint) = match &observed {
        nook_core::IdentityVaultDekEpoch::Known {
            key_epoch,
            checkpoint,
        } => (key_epoch, checkpoint),
        nook_core::IdentityVaultDekEpoch::LegacyUnknown => {
            return Ok(nook_core::IdentityVaultDekEpochUpdate::Observe {
                key_epoch: observed,
            });
        }
    };
    let PendingIdentityReconciliationCheckpoint::Committed { checkpoint } =
        pending.checkpoint_state
    else {
        return Ok(nook_core::IdentityVaultDekEpochUpdate::Observe {
            key_epoch: observed,
        });
    };
    if pending.store_id == *store_id
        && pending.key_epoch == *observed_epoch
        && checkpoint == *observed_checkpoint
    {
        return Ok(nook_core::IdentityVaultDekEpochUpdate::Rotate {
            previous_key_epoch: pending.previous_key_epoch,
            previous_checkpoint: pending.previous_checkpoint,
            key_epoch: pending.key_epoch,
            checkpoint,
        });
    }
    Ok(nook_core::IdentityVaultDekEpochUpdate::Observe {
        key_epoch: observed,
    })
}

pub(crate) async fn clear_identity_reconciliation_pending(
    store_id: &nook_core::StoreId,
) -> Result<(), NookError> {
    super::indexed_db::idb_delete_key(&identity_reconciliation_key(store_id)).await
}

pub(crate) async fn generate_vault_dek_for_identity(
    identity_id: &nook_core::IdentityId,
    app_key: &nook_core::AppKey,
    store_id: nook_core::StoreId,
) -> Result<nook_core::VaultKeys, NookError> {
    let identity_id = identity_id.clone();
    let app_key = app_key.clone();
    update_identity_directory(move |directory| {
        directory
            .open_or_generate_vault_dek_for_identity(&identity_id, &app_key, store_id)
            .map_err(|error| NookError::Database(error.to_string()))
    })
    .await
}

pub(crate) async fn validate_vault_identity_enrollment(
    app_key: &nook_core::AppKey,
    store_id: &nook_core::StoreId,
) -> Result<(), NookError> {
    load_identity_directory()
        .await?
        .validate_vault_enrollment(app_key, store_id)
        .map_err(|error| NookError::Database(error.to_string()))
}

pub(crate) async fn associate_sentinel_vault_with_identity(
    identity_id: &nook_core::IdentityId,
    app_key: &nook_core::AppKey,
    store_id: nook_core::StoreId,
) -> Result<(), NookError> {
    let identity_id = identity_id.clone();
    let app_key = app_key.clone();
    update_identity_directory(move |directory| {
        directory
            .associate_sentinel_vault(&identity_id, &app_key, store_id)
            .map_err(|error| NookError::Database(error.to_string()))?;
        Ok(())
    })
    .await
}

pub(crate) async fn identity_for_sentinel_vault(
    app_key: &nook_core::AppKey,
    store_id: &nook_core::StoreId,
) -> Result<Option<nook_core::IdentityId>, NookError> {
    let directory = load_identity_directory().await?;
    directory
        .identity_for_vault(app_key, store_id)
        .map_err(|error| NookError::Database(error.to_string()))
}

/// Forget identity state sealed to the inaccessible app key while preserving
/// encrypted vault projections for password-backed recovery.
pub(crate) async fn delete_identity_directory_for_recovery() -> Result<(), NookError> {
    update_identity_directory(|directory| {
        directory.reset_for_device_recovery();
        Ok(())
    })
    .await?;
    idb_delete_key(LEGACY_IDENTITY_RECORD_KEY).await?;
    simple_genesis::clear_pending_simple_genesis_for_recovery().await
}

#[cfg(test)]
pub(crate) async fn clear_identity_directory_for_test() -> Result<(), NookError> {
    idb_delete_key(IDENTITY_DIRECTORY_KEY).await?;
    idb_delete_key(LEGACY_IDENTITY_RECORD_KEY).await?;
    simple_genesis::clear_pending_simple_genesis_for_test().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn migrates_legacy_record_then_persists_multiple_identities() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let legacy = nook_core::IdentityRecord::create_with_app_key("Personal", &app_key, None)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let legacy_id = legacy.identity_id.clone();
        let raw = serde_json::to_string(&legacy)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        idb_put_string(LEGACY_IDENTITY_RECORD_KEY, &raw).await?;

        let migrated = load_identity_directory().await?;
        assert_eq!(
            migrated.selected().map_err(map_domain_error)?.identity_id,
            legacy_id
        );
        assert!(idb_get_string(LEGACY_IDENTITY_RECORD_KEY).await?.is_none());
        assert!(idb_get_string(IDENTITY_DIRECTORY_KEY).await?.is_some());

        let work_id = update_identity_directory(move |directory| {
            directory
                .create_identity("Work", &app_key, None)
                .map_err(map_domain_error)
        })
        .await?;
        let reloaded = load_identity_directory().await?;
        assert_eq!(reloaded.identities().len(), 2);
        assert_eq!(
            reloaded.selected().map_err(map_domain_error)?.identity_id,
            work_id
        );
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn destructive_recovery_forgets_stale_identity_ownership() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let inaccessible_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let pending = begin_or_resume_simple_genesis(&inaccessible_key, "Personal").await?;
        let store_id = pending.store_id.clone();
        let _ = generate_vault_dek_for_identity(
            &pending.identity_id,
            &inaccessible_key,
            store_id.clone(),
        )
        .await?;

        delete_identity_directory_for_recovery().await?;

        let stale_result = ensure_local_identity_for_app_key(&inaccessible_key, "Stale").await;
        assert!(matches!(
            stale_result,
            Err(NookError::Database(message)) if message.contains("retired")
        ));

        let replacement_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let replacement = ensure_local_identity_for_app_key(&replacement_key, "Recovered").await?;
        assert_ne!(replacement.identity_id, pending.identity_id);
        validate_vault_identity_enrollment(&replacement_key, &store_id).await?;
        assert!(
            pending_simple_genesis_for_store(store_id.as_str())
                .await?
                .is_none()
        );
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn current_directory_wins_over_stale_legacy_record() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let legacy = nook_core::IdentityRecord::create_with_app_key("Legacy", &app_key, None)
            .map_err(map_domain_error)?;
        idb_put_string(
            LEGACY_IDENTITY_RECORD_KEY,
            &serde_json::to_string(&legacy)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        )
        .await?;
        let mut current = nook_core::IdentityDirectory::empty();
        current
            .create_identity("Personal", &app_key, None)
            .map_err(map_domain_error)?;
        current
            .create_identity("Work", &app_key, None)
            .map_err(map_domain_error)?;
        idb_put_string(
            IDENTITY_DIRECTORY_KEY,
            &serde_json::to_string(&current)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        )
        .await?;

        let loaded = load_identity_directory().await?;
        assert_eq!(loaded, current);
        assert!(idb_get_string(LEGACY_IDENTITY_RECORD_KEY).await?.is_none());
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn invalid_current_directory_preserves_legacy_record() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let legacy = nook_core::IdentityRecord::create_with_app_key("Legacy", &app_key, None)
            .map_err(map_domain_error)?;
        idb_put_string(
            LEGACY_IDENTITY_RECORD_KEY,
            &serde_json::to_string(&legacy)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        )
        .await?;
        idb_put_string(IDENTITY_DIRECTORY_KEY, "{invalid-json").await?;

        assert!(load_identity_directory().await.is_err());
        assert!(idb_get_string(LEGACY_IDENTITY_RECORD_KEY).await?.is_some());
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn rotation_reconciliation_requires_the_committed_checkpoint() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let store_id =
            nook_core::StoreId::parse("store_abcdefghijk").map_err(map_validation_error)?;
        let previous_epoch =
            nook_core::Sha256Hex::parse(&"1".repeat(64)).map_err(map_validation_error)?;
        let previous_checkpoint =
            nook_core::Sha256Hex::parse(&"2".repeat(64)).map_err(map_validation_error)?;
        let key_epoch =
            nook_core::Sha256Hex::parse(&"3".repeat(64)).map_err(map_validation_error)?;
        let checkpoint =
            nook_core::Sha256Hex::parse(&"4".repeat(64)).map_err(map_validation_error)?;
        let other_checkpoint =
            nook_core::Sha256Hex::parse(&"5".repeat(64)).map_err(map_validation_error)?;
        mark_identity_reconciliation_pending(
            &store_id,
            &previous_epoch,
            &previous_checkpoint,
            &key_epoch,
        )
        .await?;

        let awaiting = identity_epoch_update_for_store(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch: key_epoch.clone(),
                checkpoint: checkpoint.clone(),
            },
        )
        .await?;
        assert!(matches!(
            awaiting,
            nook_core::IdentityVaultDekEpochUpdate::Observe { .. }
        ));

        commit_identity_reconciliation_checkpoint(&store_id, &key_epoch, &checkpoint).await?;
        let wrong_checkpoint = identity_epoch_update_for_store(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch: key_epoch.clone(),
                checkpoint: other_checkpoint,
            },
        )
        .await?;
        assert!(matches!(
            wrong_checkpoint,
            nook_core::IdentityVaultDekEpochUpdate::Observe { .. }
        ));
        let committed = identity_epoch_update_for_store(
            &store_id,
            nook_core::IdentityVaultDekEpoch::Known {
                key_epoch,
                checkpoint,
            },
        )
        .await?;
        assert!(matches!(
            committed,
            nook_core::IdentityVaultDekEpochUpdate::Rotate { .. }
        ));
        clear_identity_reconciliation_pending(&store_id).await
    }

    fn map_domain_error(error: nook_core::MultiDeviceError) -> NookError {
        NookError::Database(error.to_string())
    }

    fn map_validation_error(error: nook_core::ValidationError) -> NookError {
        NookError::Database(error.to_string())
    }
}
