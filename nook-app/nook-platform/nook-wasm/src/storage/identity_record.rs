//! Local identity-directory persistence, independent of vault `store_id`.

#[cfg(test)]
use super::indexed_db::{idb_delete_key, idb_get_string, idb_put_string};
use crate::{NookError, storage::open_nook_database};

mod genesis_cleanup;
mod genesis_flow;
mod handoff;
mod reconciliation;
mod recovery;
pub(crate) mod simple_genesis;
mod staged_genesis;
pub(crate) use genesis_cleanup::clear_pending_simple_genesis;
pub(crate) use genesis_flow::SimpleGenesisCompletion;
pub(crate) use handoff::{
    ExistingVaultImportCommit, IdentityHandoffCommit, commit_authenticated_identity_handoff,
};
pub(crate) use reconciliation::{
    PendingIdentityRotation, abort_prepared_identity_reconciliation,
    commit_identity_reconciliation_checkpoint, commit_identity_reconciliation_epoch,
    load_pending_identity_rotation, mark_identity_reconciliation_pending,
};
use reconciliation::{
    clear_consumed_identity_reconciliation, is_identity_reconciliation_key, resolve_identity_epoch,
};
pub(crate) use recovery::delete_identity_directory_for_recovery;
pub(crate) use simple_genesis::PENDING_SIMPLE_GENESIS_KEY;
pub(crate) use simple_genesis::{
    PendingSimpleGenesis, begin_or_resume_simple_genesis, pending_simple_genesis_for_store,
    persist_simple_genesis_event, resume_staged_simple_genesis_signing_seed,
};
pub(crate) use staged_genesis::{StagedSimpleGenesisInput, begin_or_resume_staged_simple_genesis};

pub(super) const IDENTITY_DIRECTORY_KEY: &str = "identity_directory_v1";
pub(super) const LEGACY_IDENTITY_RECORD_KEY: &str = "identity_record_v1";
const RETIRED_APP_IDS_KEY: &str = "retired_app_ids_v1";

fn map_domain_error(error: nook_core::MultiDeviceError) -> NookError {
    let message = error.to_string();
    drop(error);
    NookError::Database(message)
}

async fn load_pending_genesis(
    store: &rexie::Store,
) -> Result<Option<PendingSimpleGenesis>, NookError> {
    let pending_id = serde_wasm_bindgen::to_value(PENDING_SIMPLE_GENESIS_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Pending genesis key error: {error:?}")))?;
    let pending = store
        .get(pending_id)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Pending genesis read error: {error:?}")))?;
    pending
        .filter(|pending| !pending.is_undefined() && !pending.is_null())
        .map(serde_wasm_bindgen::from_value::<String>)
        .transpose()
        .map_err(|error| NookError::IndexedDb(format!("Pending genesis value error: {error:?}")))?
        .map(|raw| simple_genesis::decode_pending_simple_genesis(&raw))
        .transpose()
}

fn migrate_staged_genesis_directories(
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
        .map_err(map_domain_error)?;
    let (directory, directory_changed) = staged
        .directory
        .clone()
        .migrate_legacy_duplicate_app_key_ownership_from_base(&legacy_base, &pending.identity_id)
        .map_err(map_domain_error)?;
    staged.base_directory = base_directory;
    staged.directory = directory;
    Ok(base_changed || directory_changed)
}

async fn persist_pending_genesis(
    store: &rexie::Store,
    pending: &PendingSimpleGenesis,
) -> Result<(), NookError> {
    let key = serde_wasm_bindgen::to_value(PENDING_SIMPLE_GENESIS_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Pending genesis key error: {error:?}")))?;
    let encoded = simple_genesis::encode_pending_simple_genesis(pending)?;
    let value = serde_wasm_bindgen::to_value(&encoded)
        .map_err(|error| NookError::IndexedDb(format!("Pending genesis value error: {error:?}")))?;
    store
        .put(&value, Some(&key))
        .await
        .map(|_| ())
        .map_err(|error| NookError::IndexedDb(format!("Pending genesis write error: {error:?}")))
}

async fn migrate_directory_in_store(
    store: &rexie::Store,
    directory: nook_core::IdentityDirectory,
) -> Result<(nook_core::IdentityDirectory, bool), NookError> {
    let mut pending = if directory.has_legacy_duplicate_app_key_ownership() {
        load_pending_genesis(store).await?
    } else {
        None
    };
    let preserved_identity_id = pending.as_ref().map(|pending| &pending.identity_id);
    let (directory, migrated) = migrate_directory(directory, preserved_identity_id)?;
    if let Some(pending) = &mut pending
        && migrate_staged_genesis_directories(pending)?
    {
        persist_pending_genesis(store, pending).await?;
    }
    Ok((directory, migrated))
}

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
        let persisted_raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
            NookError::IndexedDb(format!("Identity directory value error: {error:?}"))
        })?;
        let directory = decode_directory_value(&persisted_raw)?;
        let (directory, migrated) = migrate_directory_in_store(&store, directory).await?;
        let raw = if migrated {
            let normalized = serde_json::to_string(&directory).map_err(|error| {
                NookError::IndexedDb(format!("Identity directory encode error: {error}"))
            })?;
            let normalized_value = serde_wasm_bindgen::to_value(&normalized).map_err(|error| {
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
    migrate_directory(decode_directory_value(raw)?, None).map(|(directory, _)| directory)
}

fn decode_directory_value(raw: &str) -> Result<nook_core::IdentityDirectory, NookError> {
    serde_json::from_str(raw)
        .map_err(|error| NookError::IndexedDb(format!("Identity directory decode error: {error}")))
}

fn migrate_directory(
    directory: nook_core::IdentityDirectory,
    preserved_identity_id: Option<&nook_core::IdentityId>,
) -> Result<(nook_core::IdentityDirectory, bool), NookError> {
    match preserved_identity_id {
        Some(identity_id) => {
            directory.migrate_legacy_duplicate_app_key_ownership_preserving(identity_id)
        }
        None => directory.migrate_legacy_duplicate_app_key_ownership(),
    }
    .map_err(|error| NookError::Database(error.to_string()))
}

async fn load_directory_for_write(
    store: &rexie::Store,
) -> Result<nook_core::IdentityDirectory, NookError> {
    let current_id = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Identity update key error: {error:?}")))?;
    let current = store
        .get(current_id)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Identity update read error: {error:?}")))?;
    let directory = if let Some(value) =
        current.filter(|value| !value.is_undefined() && !value.is_null())
    {
        let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
            NookError::IndexedDb(format!("Identity update value error: {error:?}"))
        })?;
        decode_directory_value(&raw)?
    } else {
        let legacy_id = serde_wasm_bindgen::to_value(LEGACY_IDENTITY_RECORD_KEY)
            .map_err(|error| NookError::IndexedDb(format!("Legacy update key error: {error:?}")))?;
        let legacy = store.get(legacy_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Legacy identity update read error: {error:?}"))
        })?;
        legacy
            .filter(|value| !value.is_undefined() && !value.is_null())
            .map(serde_wasm_bindgen::from_value::<String>)
            .transpose()
            .map_err(|error| NookError::IndexedDb(format!("Legacy update value error: {error:?}")))?
            .map(|raw| {
                serde_json::from_str(&raw)
                    .map_err(|error| {
                        NookError::IndexedDb(format!("Legacy update decode error: {error}"))
                    })
                    .and_then(|record| {
                        nook_core::IdentityDirectory::from_legacy_record(record)
                            .map_err(map_domain_error)
                    })
            })
            .transpose()?
            .unwrap_or_else(nook_core::IdentityDirectory::empty)
    };
    migrate_directory_in_store(store, directory)
        .await
        .map(|(directory, _)| directory)
}

async fn load_retired_app_ids(store: &rexie::Store) -> Result<Vec<nook_core::AppId>, NookError> {
    let key = serde_wasm_bindgen::to_value(RETIRED_APP_IDS_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs key error: {error:?}")))?;
    let Some(value) = store
        .get(key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs read error: {error:?}")))?
        .filter(|value| !value.is_undefined() && !value.is_null())
    else {
        return Ok(Vec::new());
    };
    let raw: String = serde_wasm_bindgen::from_value(value)
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs value error: {error:?}")))?;
    serde_json::from_str(&raw)
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs decode error: {error}")))
}

pub(crate) async fn update_identity_directory<F, T>(update: F) -> Result<T, NookError>
where
    F: FnOnce(&mut nook_core::IdentityDirectory) -> Result<T, NookError>,
{
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|error| NookError::IndexedDb(format!("Identity update error: {error:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|error| NookError::IndexedDb(format!("Identity update store error: {error:?}")))?;
    let current_id = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Identity update key error: {error:?}")))?;
    let legacy_id = serde_wasm_bindgen::to_value(LEGACY_IDENTITY_RECORD_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Legacy update key error: {error:?}")))?;
    let mut directory = load_directory_for_write(&store).await?;
    let value = update(&mut directory)?;
    directory.validate().map_err(map_domain_error)?;
    let encoded = serde_json::to_string(&directory).map_err(|error| {
        NookError::IndexedDb(format!("Identity directory encode error: {error}"))
    })?;
    let encoded = serde_wasm_bindgen::to_value(&encoded)
        .map_err(|error| NookError::IndexedDb(format!("Identity update value error: {error:?}")))?;
    store
        .put(&encoded, Some(&current_id))
        .await
        .map_err(|error| {
            NookError::IndexedDb(format!("Identity directory write error: {error:?}"))
        })?;
    store.delete(legacy_id).await.map_err(|error| {
        NookError::IndexedDb(format!("Legacy identity delete error: {error:?}"))
    })?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Identity update completion error: {error:?}"))
    })?;
    Ok(value)
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

pub(crate) async fn load_identity(
    identity_id: &nook_core::IdentityId,
) -> Result<Option<nook_core::IdentityRecord>, NookError> {
    Ok(load_identity_directory()
        .await?
        .identities()
        .iter()
        .find(|record| record.identity_id == *identity_id)
        .cloned())
}

pub(crate) async fn set_identity_member_signing_public_key(
    identity_id: &nook_core::IdentityId,
    app_id: &nook_core::AppId,
    signing_public_key: &nook_core::DeviceSigningPublicKey,
) -> Result<(), NookError> {
    let identity_id = identity_id.clone();
    let app_id = app_id.clone();
    let signing_public_key = signing_public_key.clone();
    update_identity_directory(move |directory| {
        directory
            .set_member_signing_public_key(&identity_id, &app_id, &signing_public_key)
            .map_err(map_domain_error)
    })
    .await
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

/// Associate a legacy vault with an identity without guessing from active selection.
pub(crate) struct LegacyVaultIdentityInput<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) store_id: &'a nook_core::StoreId,
    pub(crate) secrets_envelope: nook_core::AgeArmoredCiphertext,
    pub(crate) members_envelope: nook_core::AgeArmoredCiphertext,
    pub(crate) key_epoch: nook_core::IdentityVaultDekEpoch,
    pub(crate) verified_previous_key_epoch: Option<nook_core::IdentityVaultEventId>,
    pub(crate) committed_event_ids: Vec<nook_core::IdentityVaultEventId>,
    pub(crate) checkpoint_ancestors: Vec<nook_core::IdentityVaultEventId>,
    pub(crate) authorized_auth_ids: Vec<nook_core::AuthKeyId>,
    pub(crate) label: &'a str,
}

pub(crate) async fn ensure_identity_from_legacy_vault(
    input: LegacyVaultIdentityInput<'_>,
) -> Result<nook_core::IdentityRecord, NookError> {
    let LegacyVaultIdentityInput {
        app_key,
        store_id,
        secrets_envelope,
        members_envelope,
        key_epoch,
        verified_previous_key_epoch,
        committed_event_ids,
        checkpoint_ancestors,
        authorized_auth_ids,
        label,
    } = input;
    let app_key = app_key.clone();
    let store_id = store_id.clone();
    let label = label.to_owned();
    let resolution = resolve_identity_epoch(
        &store_id,
        key_epoch,
        verified_previous_key_epoch,
        &committed_event_ids,
        &checkpoint_ancestors,
    )
    .await?;
    let consumed_marker = resolution.consumed_marker;
    let directory_store_id = store_id.clone();
    let record = update_identity_directory(move |directory| {
        let identity_id = directory
            .import_legacy_vault(
                &label,
                &app_key,
                directory_store_id,
                nook_core::IdentityVaultDekReconciliation {
                    secrets_envelope,
                    members_envelope,
                    epoch_update: resolution.update,
                    authorized_auth_ids,
                },
            )
            .map_err(|error| NookError::Database(error.to_string()))?;
        directory
            .identities()
            .iter()
            .find(|record| record.identity_id == identity_id)
            .cloned()
            .ok_or_else(|| NookError::Database("Imported identity disappeared.".to_owned()))
    })
    .await?;
    if let Some(consumed_marker) = consumed_marker {
        clear_consumed_identity_reconciliation(&store_id, &consumed_marker).await?;
    }
    Ok(record)
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

#[cfg(test)]
pub(crate) async fn clear_identity_directory_for_test() -> Result<(), NookError> {
    idb_delete_key(IDENTITY_DIRECTORY_KEY).await?;
    idb_delete_key(LEGACY_IDENTITY_RECORD_KEY).await?;
    idb_delete_key(RETIRED_APP_IDS_KEY).await?;
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

        let work_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let work_id = update_identity_directory(move |directory| {
            directory
                .create_identity("Work", &work_key, None)
                .map_err(map_domain_error)
        })
        .await?;
        let reloaded = load_identity_directory().await?;
        assert_eq!(reloaded.identities().len(), 2);
        assert_eq!(
            reloaded.selected().map_err(map_domain_error)?.identity_id,
            work_id
        );
        let snapshot = crate::identity_record::load_identity_directory_snapshot()
            .await
            .map_err(|error| NookError::Database(format!("{error:?}")))?;
        assert_eq!(snapshot.length(), 2);
        assert_eq!(
            snapshot.selection_kind(),
            crate::identity_record::NookIdentityDirectorySelectionKind::Selected
        );
        assert_eq!(
            snapshot
                .selected_identity_id()
                .map_err(|error| NookError::Database(format!("{error:?}")))?,
            work_id.as_str()
        );
        let selected = snapshot
            .identity(1)
            .map_err(|error| NookError::Database(format!("{error:?}")))?;
        assert_eq!(selected.label(), "Work");
        assert_eq!(selected.members().len(), 1);
        assert!(selected.vault_store_ids().is_empty());
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn normalizes_persisted_duplicate_app_key_owners_without_losing_vaults()
    -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let mut legacy = nook_core::IdentityDirectory::empty();
        legacy
            .create_identity("Personal", &app_key, None)
            .map_err(map_domain_error)?;
        let store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let expected = legacy
            .open_or_generate_vault_dek(&app_key, store_id.clone())
            .map_err(map_domain_error)?;
        let selected_id = legacy
            .create_identity("Work", &app_key, None)
            .map_err(map_domain_error)?;
        let legacy_raw = serde_json::to_string(&legacy)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        idb_put_string(IDENTITY_DIRECTORY_KEY, &legacy_raw).await?;

        let mut migrated = load_identity_directory().await?;

        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(
            migrated.selected().map_err(map_domain_error)?.identity_id,
            selected_id
        );
        assert_eq!(
            migrated
                .open_or_generate_vault_dek(&app_key, store_id)
                .map_err(map_domain_error)?,
            expected
        );
        let normalized_raw = idb_get_string(IDENTITY_DIRECTORY_KEY)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Normalized directory is missing.".to_owned()))?;
        assert_ne!(normalized_raw, legacy_raw);
        let normalized: nook_core::IdentityDirectory = serde_json::from_str(&normalized_raw)
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        normalized.validate().map_err(map_domain_error)?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn migration_preserves_identity_referenced_by_pending_genesis() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let mut legacy = nook_core::IdentityDirectory::empty();
        let pending_identity_id = legacy
            .create_identity("Pending genesis", &app_key, None)
            .map_err(map_domain_error)?;
        let selected_identity_id = legacy
            .create_identity("Selected", &app_key, None)
            .map_err(map_domain_error)?;
        assert_ne!(pending_identity_id, selected_identity_id);
        idb_put_string(
            IDENTITY_DIRECTORY_KEY,
            &serde_json::to_string(&legacy)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        )
        .await?;
        let store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let pending_raw = serde_json::json!({
            "storeId": store_id,
            "identityId": pending_identity_id,
        })
        .to_string();
        idb_put_string(PENDING_SIMPLE_GENESIS_KEY, &pending_raw).await?;

        let migrated = load_identity_directory().await?;

        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(
            migrated.selected().map_err(map_domain_error)?.identity_id,
            pending_identity_id
        );
        let pending = pending_simple_genesis_for_store(store_id.as_str())
            .await?
            .ok_or_else(|| NookError::Database("Pending genesis marker is missing.".to_owned()))?;
        assert_eq!(pending.identity_id, pending_identity_id);
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn migration_normalizes_staged_genesis_snapshots_atomically() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let mut legacy = nook_core::IdentityDirectory::empty();
        let pending_identity_id = legacy
            .create_identity("Pending genesis", &app_key, None)
            .map_err(map_domain_error)?;
        legacy
            .create_identity("Selected", &app_key, None)
            .map_err(map_domain_error)?;
        let store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let mut candidate = legacy.clone();
        candidate
            .open_or_generate_vault_dek_for_identity(
                &pending_identity_id,
                &app_key,
                store_id.clone(),
            )
            .map_err(map_domain_error)?;
        let pending = PendingSimpleGenesis {
            store_id: store_id.clone(),
            identity_id: pending_identity_id.clone(),
            created_at: nook_core::IsoTimestamp::parse("2026-08-15T00:00:00.000Z")
                .map_err(|error| NookError::Database(error.to_string()))?,
            event_state: simple_genesis::PendingSimpleGenesisEvent::AwaitingEvent,
            flow: genesis_flow::PendingSimpleGenesisFlow::Staged(
                staged_genesis::StagedSimpleGenesisIdentity {
                    base_directory: legacy.clone(),
                    directory: candidate,
                },
            ),
        };
        idb_put_string(
            IDENTITY_DIRECTORY_KEY,
            &serde_json::to_string(&legacy)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        )
        .await?;
        idb_put_string(
            PENDING_SIMPLE_GENESIS_KEY,
            &simple_genesis::encode_pending_simple_genesis(&pending)?,
        )
        .await?;

        let migrated = load_identity_directory().await?;
        let normalized_raw = idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
            .await?
            .ok_or_else(|| NookError::Database("Staged marker is missing.".to_owned()))?;
        let normalized = simple_genesis::decode_pending_simple_genesis(&normalized_raw)?;
        let staged = normalized
            .staged_identity()
            .ok_or_else(|| NookError::Database("Staged snapshots are missing.".to_owned()))?;
        assert_eq!(migrated.identities().len(), 1);
        assert_eq!(staged.base_directory.identities().len(), 1);
        assert_eq!(staged.directory.identities().len(), 1);
        clear_pending_simple_genesis(SimpleGenesisCompletion::Staged {
            pending: &normalized,
            signing_seed: "staged-migration-signing-seed",
        })
        .await?;
        let published = load_identity_directory().await?;
        assert!(
            published
                .selected()
                .map_err(map_domain_error)?
                .owns_vault(&store_id)
        );
        idb_delete_key(crate::storage::event_db::SIGNING_SEED_KEY).await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn valid_directory_ignores_malformed_pending_genesis_marker() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let mut directory = nook_core::IdentityDirectory::empty();
        let identity_id = directory
            .create_identity("Personal", &app_key, None)
            .map_err(map_domain_error)?;
        idb_put_string(
            IDENTITY_DIRECTORY_KEY,
            &serde_json::to_string(&directory)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        )
        .await?;
        let malformed_marker = "{\"futureFormat\":true}";
        idb_put_string(PENDING_SIMPLE_GENESIS_KEY, malformed_marker).await?;

        let loaded = load_identity_directory().await?;

        assert_eq!(
            loaded.selected().map_err(map_domain_error)?.identity_id,
            identity_id
        );
        assert_eq!(
            idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await?.as_deref(),
            Some(malformed_marker)
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
        let work_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        current
            .create_identity("Work", &work_key, None)
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
}
