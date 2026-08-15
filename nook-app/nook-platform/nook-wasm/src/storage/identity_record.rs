//! Local identity-directory persistence, independent of vault `store_id`.

use std::cell::RefCell;
use std::rc::Rc;

use super::indexed_db::{StringUpdateGuard, StringUpdateResult, idb_update_string};
#[cfg(test)]
use super::indexed_db::{idb_delete_key, idb_get_string, idb_put_string};
use crate::{NookError, storage::open_nook_database};

mod genesis_flow;
mod reconciliation;
pub(crate) mod simple_genesis;
mod staged_genesis;
pub(crate) use genesis_flow::SimpleGenesisCompletion;
pub(crate) use reconciliation::{
    PendingIdentityRotation, abort_prepared_identity_reconciliation,
    commit_identity_reconciliation_checkpoint, commit_identity_reconciliation_epoch,
    load_pending_identity_rotation, mark_identity_reconciliation_pending,
};
use reconciliation::{
    clear_consumed_identity_reconciliation, is_identity_reconciliation_key, resolve_identity_epoch,
};
pub(crate) use simple_genesis::{
    PendingSimpleGenesis, begin_or_resume_simple_genesis, clear_pending_simple_genesis,
    pending_simple_genesis_for_store, persist_simple_genesis_event,
    resume_staged_simple_genesis_signing_seed,
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

pub(crate) struct IdentityHandoffCommit<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    pub(crate) authorizer_signing:
        Option<&'a (nook_core::AppId, nook_core::DeviceSigningPublicKey)>,
    pub(crate) enrollment: &'a crate::manager::PendingExtensionIdentityEnrollment,
    pub(crate) signing_seed: Option<&'a str>,
}

/// Commit the identity-directory membership and its matching event signer in
/// one `IndexedDB` transaction after the complete handoff flow succeeds.
pub(crate) async fn commit_authenticated_identity_handoff(
    input: IdentityHandoffCommit<'_>,
) -> Result<(), NookError> {
    let _ = load_identity_directory().await?;
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|error| NookError::IndexedDb(format!("Handoff transaction error: {error:?}")))?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!("Handoff transaction store error: {error:?}"))
    })?;
    let directory_key = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Handoff key error: {error:?}")))?;
    let directory_value = store.get(directory_key.clone()).await.map_err(|error| {
        NookError::IndexedDb(format!("Handoff directory read error: {error:?}"))
    })?;
    let mut directory = directory_value
        .filter(|value| !value.is_undefined() && !value.is_null())
        .map(|value| {
            let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                NookError::IndexedDb(format!("Handoff directory decode error: {error:?}"))
            })?;
            decode_directory(&raw)
        })
        .transpose()?
        .unwrap_or_else(nook_core::IdentityDirectory::empty);
    let identity_id = match input.enrollment {
        crate::manager::PendingExtensionIdentityEnrollment::VaultCreation { .. } => {
            return Err(NookError::Database(
                "Vault-creation identity must publish with verified genesis.".to_owned(),
            ));
        }
        crate::manager::PendingExtensionIdentityEnrollment::PairedVault {
            authorizer,
            store_id,
        } => directory
            .enroll_app_key_for_owned_vault(authorizer, input.app_key, store_id)
            .map_err(map_domain_error)?,
        crate::manager::PendingExtensionIdentityEnrollment::ExistingVaultImport { store_id } => {
            directory
                .validate_vault_enrollment(input.app_key, store_id)
                .map_err(map_domain_error)?;
            directory
                .identities()
                .iter()
                .find(|identity| identity.owns_vault(store_id))
                .map(|identity| identity.identity_id.clone())
                .ok_or_else(|| {
                    NookError::Database(format!("Imported identity does not own vault {store_id}."))
                })?
        }
    };
    directory
        .set_member_signing_public_key(
            &identity_id,
            input.app_key.app_id(),
            input.signing_public_key,
        )
        .map_err(map_domain_error)?;
    if let Some((app_id, signing_public_key)) = input.authorizer_signing {
        directory
            .set_member_signing_public_key(&identity_id, app_id, signing_public_key)
            .map_err(map_domain_error)?;
    }
    directory.validate().map_err(map_domain_error)?;
    let encoded = serde_json::to_string(&directory)
        .map_err(|error| NookError::IndexedDb(format!("Handoff encode error: {error}")))?;
    let encoded_value = serde_wasm_bindgen::to_value(&encoded)
        .map_err(|error| NookError::IndexedDb(format!("Handoff value error: {error:?}")))?;
    store
        .put(&encoded_value, Some(&directory_key))
        .await
        .map_err(|error| NookError::IndexedDb(format!("Handoff write error: {error:?}")))?;
    if let Some(seed) = input.signing_seed {
        let seed_key = serde_wasm_bindgen::to_value(crate::storage::event_db::SIGNING_SEED_KEY)
            .map_err(|error| NookError::IndexedDb(format!("Handoff seed key error: {error:?}")))?;
        let seed_value = serde_wasm_bindgen::to_value(seed).map_err(|error| {
            NookError::IndexedDb(format!("Handoff seed value error: {error:?}"))
        })?;
        store
            .put(&seed_value, Some(&seed_key))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Handoff seed write error: {error:?}"))
            })?;
    }
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Handoff transaction completion error: {error:?}"))
    })?;
    Ok(())
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

/// Forget identity state sealed to the inaccessible app key while preserving
/// encrypted vault projections for password-backed recovery.
async fn reset_identity_and_device_for_recovery() -> Result<(), NookError> {
    // Best-effort legacy migration preserves known reconciliation keys. A
    // corrupt or future-incompatible directory must never block destructive
    // device recovery.
    let _ = load_identity_directory().await;
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|error| NookError::IndexedDb(format!("Identity reset error: {error:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|error| NookError::IndexedDb(format!("Identity reset store error: {error:?}")))?;
    let reconciliation_keys: Vec<String> = store
        .get_all_keys(None, None)
        .await
        .map_err(|error| {
            NookError::IndexedDb(format!("Identity reset key enumeration error: {error:?}"))
        })?
        .into_iter()
        .filter_map(|value| serde_wasm_bindgen::from_value::<String>(value).ok())
        .filter(|key| is_identity_reconciliation_key(key))
        .collect();
    let directory_key = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Identity reset key error: {error:?}")))?;
    let raw = store
        .get(directory_key.clone())
        .await
        .map_err(|error| NookError::IndexedDb(format!("Identity reset read error: {error:?}")))?;
    let mut directory = match raw.filter(|value| !value.is_undefined() && !value.is_null()) {
        Some(value) => {
            let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                NookError::IndexedDb(format!("Identity reset value error: {error:?}"))
            })?;
            decode_directory(&raw).unwrap_or_else(|_| nook_core::IdentityDirectory::empty())
        }
        None => nook_core::IdentityDirectory::empty(),
    };
    for app_id in load_retired_app_ids(&store).await? {
        directory.retire_app_id(app_id);
    }
    let persisted_app_id = super::indexed_db::read_string_preferring(
        &store,
        super::indexed_db::APP_ID_KEY,
        super::indexed_db::DEVICE_ID_KEY,
        "Identity reset app id",
    )
    .await
    .ok()
    .flatten()
    .and_then(|raw| nook_core::AppId::parse(&raw).ok());
    directory.reset_for_device_recovery();
    if let Some(app_id) = persisted_app_id {
        directory.retire_app_id(app_id);
    }
    directory
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))?;
    let encoded = serde_json::to_string(&directory)
        .map_err(|error| NookError::IndexedDb(format!("Identity reset encode error: {error}")))?;
    let value = serde_wasm_bindgen::to_value(&encoded)
        .map_err(|error| NookError::IndexedDb(format!("Identity reset value error: {error:?}")))?;
    let retired = serde_json::to_string(directory.retired_app_ids())
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs encode error: {error}")))?;
    let retired = serde_wasm_bindgen::to_value(&retired)
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs value error: {error:?}")))?;
    let retired_key = serde_wasm_bindgen::to_value(RETIRED_APP_IDS_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs key error: {error:?}")))?;
    store
        .put(&value, Some(&directory_key))
        .await
        .map_err(|error| NookError::IndexedDb(format!("Identity reset write error: {error:?}")))?;
    store
        .put(&retired, Some(&retired_key))
        .await
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs write error: {error:?}")))?;
    for key in reconciliation_keys.into_iter().chain([
        LEGACY_IDENTITY_RECORD_KEY.to_owned(),
        simple_genesis::PENDING_SIMPLE_GENESIS_KEY.to_owned(),
        crate::storage::device_access::DEVICE_ACCESS_PROFILE_KEY.to_owned(),
        super::indexed_db::APP_KEY_WRAPPED_KEY.to_owned(),
        super::indexed_db::APP_ID_KEY.to_owned(),
        super::indexed_db::WRAPPED_DEVICE_IDENTITY_KEY.to_owned(),
        super::indexed_db::DEVICE_ID_KEY.to_owned(),
        super::indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY.to_owned(),
    ]) {
        let key = serde_wasm_bindgen::to_value(&key).map_err(|error| {
            NookError::IndexedDb(format!("Identity reset delete key error: {error:?}"))
        })?;
        store.delete(key).await.map_err(|error| {
            NookError::IndexedDb(format!("Identity reset delete error: {error:?}"))
        })?;
    }
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Identity reset completion error: {error:?}"))
    })?;
    Ok(())
}

pub(crate) async fn delete_identity_directory_for_recovery() -> Result<(), NookError> {
    reset_identity_and_device_for_recovery().await
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
        let marker_v2 = format!("pending_identity_reconciliation_v2:{store_id}");
        let marker_v1 = format!("pending_identity_reconciliation_v1:{store_id}");
        idb_put_string(&marker_v2, "stale-v2").await?;
        idb_put_string(&marker_v1, "stale-v1").await?;

        delete_identity_directory_for_recovery().await?;

        assert!(idb_get_string(&marker_v2).await?.is_none());
        assert!(idb_get_string(&marker_v1).await?.is_none());

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
    async fn destructive_recovery_bypasses_a_corrupt_identity_directory() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let stale_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let earlier_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        idb_put_string(
            RETIRED_APP_IDS_KEY,
            &serde_json::to_string(&vec![earlier_key.app_id()])
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        )
        .await?;
        idb_put_string(
            "vault_registry",
            &format!(r#"{{"vaults":[{{"store_id":"{store_id}","label":""}}]}}"#),
        )
        .await?;
        let marker = format!("pending_identity_reconciliation_v2:{store_id}");
        idb_put_string(&marker, "inaccessible-plan").await?;
        idb_put_string(IDENTITY_DIRECTORY_KEY, "{future-or-corrupt").await?;
        idb_put_string(
            crate::storage::indexed_db::APP_ID_KEY,
            stale_key.app_id().as_str(),
        )
        .await?;
        idb_put_string(
            crate::storage::indexed_db::APP_KEY_WRAPPED_KEY,
            "inaccessible",
        )
        .await?;

        delete_identity_directory_for_recovery().await?;

        assert!(
            idb_get_string(crate::storage::indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_none()
        );
        assert!(idb_get_string(&marker).await?.is_none());
        let recovered = load_identity_directory().await?;
        assert!(recovered.identities().is_empty());
        assert!(matches!(
            ensure_local_identity_for_app_key(&stale_key, "Stale").await,
            Err(NookError::Database(message)) if message.contains("retired")
        ));
        assert!(
            ensure_local_identity_for_app_key(&earlier_key, "Earlier")
                .await
                .is_err()
        );
        idb_delete_key("vault_registry").await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn destructive_recovery_bypasses_corrupt_indexes_and_deletes_markers()
    -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let marker = format!("pending_identity_reconciliation_v2:{store_id}");
        idb_put_string(IDENTITY_DIRECTORY_KEY, "{corrupt").await?;
        idb_put_string("vault_registry", "{corrupt").await?;
        idb_put_string(&marker, "inaccessible-plan").await?;
        idb_put_string(
            crate::storage::indexed_db::APP_KEY_WRAPPED_KEY,
            "inaccessible",
        )
        .await?;
        delete_identity_directory_for_recovery().await?;
        assert!(
            idb_get_string(crate::storage::indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_none()
        );
        assert!(idb_get_string(&marker).await?.is_none());
        idb_delete_key("vault_registry").await?;
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
    async fn existing_import_handoff_commits_signer_after_vault_ownership() -> Result<(), NookError>
    {
        clear_identity_directory_for_test().await?;
        let app_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let signing_public_key = nook_core::DeviceSigningPublicKey::parse(&"22".repeat(32))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let owner_key = app_key.clone();
        let owner_store_id = store_id.clone();
        update_identity_directory(move |directory| {
            let identity_id = directory
                .create_identity("Imported", &owner_key, None)
                .map_err(map_domain_error)?;
            directory
                .open_or_generate_vault_dek_for_identity(&identity_id, &owner_key, owner_store_id)
                .map_err(map_domain_error)?;
            Ok(())
        })
        .await?;
        let enrollment = crate::manager::PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: store_id.clone(),
        };
        let signing_seed = "33".repeat(32);

        commit_authenticated_identity_handoff(IdentityHandoffCommit {
            app_key: &app_key,
            signing_public_key: &signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: Some(&signing_seed),
        })
        .await?;

        let directory = load_identity_directory().await?;
        let selected = directory.selected().map_err(map_domain_error)?;
        assert!(selected.owns_vault(&store_id));
        assert_eq!(selected.members[0].signing_public_key, signing_public_key);
        assert_eq!(
            crate::storage::event_db::load_signing_seed().await?,
            Some(signing_seed)
        );
        clear_identity_directory_for_test().await?;
        idb_delete_key(crate::storage::event_db::SIGNING_SEED_KEY).await
    }
}
