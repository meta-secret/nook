//! Destructive identity and device recovery persistence.

use super::{
    IDENTITY_DIRECTORY_KEY, LEGACY_IDENTITY_RECORD_KEY, RETIRED_APP_IDS_KEY, decode_directory,
    is_identity_reconciliation_key, keyring, load_identity_directory, load_retired_app_ids,
    simple_genesis, write_identity_directory,
};
use crate::{NookError, storage::open_nook_database};

mod cleanup;

pub(crate) use cleanup::{
    LocalIdentityRecovery, PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
    complete_identity_recovery_cleanup, has_pending_identity_recovery_cleanup,
};
use cleanup::{load_pending_recovery_cleanup, write_pending_recovery_cleanup};

struct RecoveryState {
    directory: nook_core::IdentityDirectory,
    keyring: nook_core::LocalIdentityKeyring,
    retired_identity_id: Option<nook_core::IdentityId>,
    retired_app_id: Option<nook_core::AppId>,
    access_profile_keys: Vec<String>,
    clear_reconciliation: bool,
}

struct RecoveryDirectory {
    value: nook_core::IdentityDirectory,
    readable: bool,
}

struct RecoveryMarkerPolicy {
    clear_simple_genesis: bool,
    clear_sentinel_genesis: bool,
}

async fn recovery_reconciliation_keys(store: &rexie::Store) -> Result<Vec<String>, NookError> {
    Ok(store
        .get_all_keys(None, None)
        .await
        .map_err(|error| {
            NookError::IndexedDb(format!("Identity reset key enumeration error: {error:?}"))
        })?
        .into_iter()
        .filter_map(|value| serde_wasm_bindgen::from_value::<String>(value).ok())
        .filter(|key| is_identity_reconciliation_key(key))
        .collect())
}

async fn recovery_directory(store: &rexie::Store) -> Result<RecoveryDirectory, NookError> {
    let directory_key = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Identity reset key error: {error:?}")))?;
    let raw = store
        .get(directory_key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Identity reset read error: {error:?}")))?;
    let (mut directory, readable) =
        match raw.filter(|value| !value.is_undefined() && !value.is_null()) {
            Some(value) => match serde_wasm_bindgen::from_value::<String>(value)
                .ok()
                .and_then(|raw| decode_directory(&raw).ok())
            {
                Some(directory) => (directory, true),
                None => (nook_core::IdentityDirectory::empty(), false),
            },
            // A missing directory cannot prove which identity owns a surviving
            // keyring entry. Route recovery through the same safe full-reset
            // path as corrupt or future-incompatible directory metadata.
            None => (nook_core::IdentityDirectory::empty(), false),
        };
    for app_id in load_retired_app_ids(store).await.unwrap_or_default() {
        directory.retire_app_id(app_id);
    }
    Ok(RecoveryDirectory {
        value: directory,
        readable,
    })
}

async fn persisted_legacy_app_id(store: &rexie::Store) -> Option<nook_core::AppId> {
    crate::storage::indexed_db::read_string_preferring(
        store,
        crate::storage::indexed_db::APP_ID_KEY,
        crate::storage::indexed_db::DEVICE_ID_KEY,
        "Identity reset app id",
    )
    .await
    .ok()
    .flatten()
    .and_then(|raw| nook_core::AppId::parse(&raw).ok())
}

fn access_profile_key(app_id: &nook_core::AppId) -> String {
    format!(
        "{}:{app_id}",
        crate::storage::device_access::DEVICE_ACCESS_PROFILE_KEY
    )
}

async fn build_full_recovery_state(
    store: &rexie::Store,
    mut directory: nook_core::IdentityDirectory,
    keyring: nook_core::LocalIdentityKeyring,
    expected_app_id: Option<&nook_core::AppId>,
) -> Result<RecoveryState, NookError> {
    let persisted_app_id = persisted_legacy_app_id(store).await;
    if let Some(expected) = expected_app_id {
        let target_exists = keyring
            .entries()
            .iter()
            .any(|entry| entry.app_id() == expected)
            || persisted_app_id.as_ref() == Some(expected);
        if !target_exists {
            return Err(NookError::Database(
                "Recovery target changed before confirmation".to_owned(),
            ));
        }
    }
    let app_ids = keyring
        .entries()
        .iter()
        .map(|entry| entry.app_id().clone())
        .chain(persisted_app_id.clone())
        .collect::<Vec<_>>();
    let access_profile_keys = app_ids.iter().map(access_profile_key).collect();
    directory.reset_for_device_recovery(None);
    for app_id in app_ids {
        directory.retire_app_id(app_id);
    }
    directory
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))?;
    Ok(RecoveryState {
        directory,
        keyring: nook_core::LocalIdentityKeyring::empty(),
        retired_identity_id: None,
        retired_app_id: expected_app_id.cloned().or(persisted_app_id),
        access_profile_keys,
        clear_reconciliation: true,
    })
}

async fn build_recovery_state(
    store: &rexie::Store,
    expected_app_id: Option<&nook_core::AppId>,
) -> Result<RecoveryState, NookError> {
    let recovered_directory = recovery_directory(store).await?;
    if !recovered_directory.readable {
        let keyring = keyring::load_persisted_keyring_for_recovery(store).await?;
        return build_full_recovery_state(
            store,
            recovered_directory.value,
            keyring,
            expected_app_id,
        )
        .await;
    }
    let mut directory = recovered_directory.value;
    let mut keyring = keyring::load_keyring_for_store(store, &directory).await?;
    let target_entry = if keyring.entries().is_empty() {
        None
    } else {
        let expected = expected_app_id.ok_or_else(|| {
            NookError::Database("Recovery requires the initiating app identity".to_owned())
        })?;
        Some(
            keyring
                .entries()
                .iter()
                .find(|entry| entry.app_id() == expected)
                .cloned()
                .ok_or_else(|| {
                    NookError::Database("Recovery target changed before confirmation".to_owned())
                })?,
        )
    };
    let (retired_identity_id, retired_app_id, access_profile_keys) = if let Some(entry) =
        target_entry
    {
        let prior_selection = directory.selection().clone();
        let retired_identity_id = entry.identity_id().clone();
        keyring
            .remove(entry.identity_id())
            .map_err(|error| NookError::Database(error.to_string()))?;
        directory
            .retire_local_identity_key(entry.identity_id(), entry.app_id())
            .map_err(|error| NookError::Database(error.to_string()))?;
        let surviving_selection = match prior_selection {
            nook_core::IdentitySelection::Selected(identity_id)
                if keyring.entry(&identity_id).is_some() =>
            {
                Some(identity_id)
            }
            nook_core::IdentitySelection::Empty | nook_core::IdentitySelection::Selected(_) => None,
        };
        if let Some(identity_id) = surviving_selection {
            directory
                .select(&identity_id)
                .map_err(|error| NookError::Database(error.to_string()))?;
        } else if let Some(next) = keyring.entries().first() {
            directory
                .select(next.identity_id())
                .map_err(|error| NookError::Database(error.to_string()))?;
        } else {
            directory.clear_selection();
        }
        (
            Some(retired_identity_id),
            Some(entry.app_id().clone()),
            vec![access_profile_key(entry.app_id())],
        )
    } else {
        let persisted_app_id = persisted_legacy_app_id(store).await;
        if let Some(expected) = expected_app_id
            && persisted_app_id.as_ref() != Some(expected)
        {
            return Err(NookError::Database(
                "Recovery target changed before confirmation".to_owned(),
            ));
        }
        directory.reset_for_device_recovery(persisted_app_id.clone());
        keyring = nook_core::LocalIdentityKeyring::empty();
        (None, persisted_app_id, Vec::new())
    };
    directory
        .validate()
        .map_err(|error| NookError::Database(error.to_string()))?;
    Ok(RecoveryState {
        clear_reconciliation: keyring.entries().is_empty(),
        directory,
        keyring,
        retired_identity_id,
        retired_app_id,
        access_profile_keys,
    })
}

async fn recovery_key_exists(
    store: &rexie::Store,
    key: &str,
    context: &str,
) -> Result<bool, NookError> {
    let key = serde_wasm_bindgen::to_value(key)
        .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
    Ok(store
        .get(key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("{context} read error: {error:?}")))?
        .is_some_and(|value| !value.is_undefined() && !value.is_null()))
}

async fn recovery_marker_policy(
    store: &rexie::Store,
    state: &RecoveryState,
) -> Result<RecoveryMarkerPolicy, NookError> {
    let has_pending_simple = recovery_key_exists(
        store,
        simple_genesis::PENDING_SIMPLE_GENESIS_KEY,
        "Pending Simple genesis",
    )
    .await?;
    let clear_simple_genesis = if !has_pending_simple {
        false
    } else if state.keyring.entries().is_empty() {
        // Full recovery must remain available even when the genesis marker is
        // legacy, corrupt, or future-incompatible. No local identity survives
        // to own it, so clearing the marker is the only safe outcome.
        true
    } else {
        match super::load_pending_genesis(store).await? {
            None => false,
            Some(pending) if state.retired_identity_id.as_ref() == Some(&pending.identity_id) => {
                true
            }
            Some(pending)
                if state
                    .keyring
                    .entries()
                    .iter()
                    .any(|entry| entry.identity_id() == &pending.identity_id) =>
            {
                false
            }
            Some(_) => {
                return Err(NookError::Database(
                    "Pending Simple genesis has no recoverable identity owner".to_owned(),
                ));
            }
        }
    };
    let sentinel_pending = recovery_key_exists(
        store,
        crate::storage::indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY,
        "Pending Sentinel genesis",
    )
    .await?;
    if sentinel_pending && !state.keyring.entries().is_empty() {
        return Err(NookError::Database(
            "Pending Sentinel genesis must finish before scoped identity recovery".to_owned(),
        ));
    }
    Ok(RecoveryMarkerPolicy {
        clear_simple_genesis,
        clear_sentinel_genesis: sentinel_pending,
    })
}

async fn write_recovery_state(
    store: &rexie::Store,
    state: &RecoveryState,
) -> Result<(), NookError> {
    write_identity_directory(store, &state.directory).await?;
    keyring::write_keyring(store, &state.keyring).await?;
    let retired = serde_json::to_string(state.directory.retired_app_ids())
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs encode error: {error}")))?;
    let retired = serde_wasm_bindgen::to_value(&retired)
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs value error: {error:?}")))?;
    let retired_key = serde_wasm_bindgen::to_value(RETIRED_APP_IDS_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs key error: {error:?}")))?;
    store
        .put(&retired, Some(&retired_key))
        .await
        .map_err(|error| NookError::IndexedDb(format!("Retired app IDs write error: {error:?}")))?;
    Ok(())
}

async fn delete_recovery_keys(
    store: &rexie::Store,
    reconciliation_keys: Vec<String>,
    access_profile_keys: Vec<String>,
    marker_policy: RecoveryMarkerPolicy,
    clear_compatibility_profile: bool,
) -> Result<(), NookError> {
    let mut keys = reconciliation_keys;
    keys.extend([
        LEGACY_IDENTITY_RECORD_KEY.to_owned(),
        crate::storage::indexed_db::APP_KEY_WRAPPED_KEY.to_owned(),
        crate::storage::indexed_db::APP_ID_KEY.to_owned(),
        crate::storage::indexed_db::WRAPPED_DEVICE_IDENTITY_KEY.to_owned(),
        crate::storage::indexed_db::DEVICE_ID_KEY.to_owned(),
        crate::storage::event_db::SIGNING_SEED_KEY.to_owned(),
    ]);
    if clear_compatibility_profile {
        keys.push(crate::storage::device_access::DEVICE_ACCESS_PROFILE_KEY.to_owned());
    }
    if marker_policy.clear_simple_genesis {
        keys.push(simple_genesis::PENDING_SIMPLE_GENESIS_KEY.to_owned());
    }
    if marker_policy.clear_sentinel_genesis {
        keys.push(crate::storage::indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY.to_owned());
    }
    keys.extend(access_profile_keys);
    for key in keys {
        let key = serde_wasm_bindgen::to_value(&key).map_err(|error| {
            NookError::IndexedDb(format!("Identity reset delete key error: {error:?}"))
        })?;
        store.delete(key).await.map_err(|error| {
            NookError::IndexedDb(format!("Identity reset delete error: {error:?}"))
        })?;
    }
    Ok(())
}

/// Forget identity state sealed to the inaccessible app key while preserving
/// encrypted vault projections for password-backed recovery.
async fn reset_identity_and_device_for_recovery(
    expected_app_id: Option<nook_core::AppId>,
) -> Result<LocalIdentityRecovery, NookError> {
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
    if let Some(recovery) = load_pending_recovery_cleanup(&store).await? {
        // The identity transaction has already committed. Resume its recorded
        // cleanup target even after reload, when the retired app ID is no
        // longer available to the UI and another surviving identity is selected.
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity reset resume error: {error:?}"))
        })?;
        return Ok(recovery);
    }
    let state = build_recovery_state(&store, expected_app_id.as_ref()).await?;
    let marker_policy = recovery_marker_policy(&store, &state).await?;
    let reconciliation_keys = if state.clear_reconciliation {
        recovery_reconciliation_keys(&store).await?
    } else {
        Vec::new()
    };
    let recovery = LocalIdentityRecovery {
        retired_app_id: state.retired_app_id.clone(),
        has_remaining_local_identities: !state.keyring.entries().is_empty(),
    };
    write_recovery_state(&store, &state).await?;
    delete_recovery_keys(
        &store,
        reconciliation_keys,
        state.access_profile_keys,
        marker_policy,
        state.clear_reconciliation,
    )
    .await?;
    write_pending_recovery_cleanup(&store, &recovery).await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Identity reset completion error: {error:?}"))
    })?;
    Ok(recovery)
}

pub(crate) async fn delete_identity_directory_for_recovery(
    expected_app_id: Option<nook_core::AppId>,
) -> Result<LocalIdentityRecovery, NookError> {
    reset_identity_and_device_for_recovery(expected_app_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::identity_record::{
        begin_or_resume_simple_genesis, clear_identity_directory_for_test,
        ensure_local_identity_for_app_key, generate_vault_dek_for_identity, map_domain_error,
        pending_simple_genesis_for_store, update_identity_directory,
        validate_vault_identity_enrollment,
    };
    use crate::storage::indexed_db::{idb_delete_key, idb_get_string, idb_put_string};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

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
        idb_put_string(
            crate::storage::indexed_db::APP_ID_KEY,
            inaccessible_key.app_id().as_str(),
        )
        .await?;

        let recovery =
            delete_identity_directory_for_recovery(Some(inaccessible_key.app_id().clone())).await?;

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
        complete_identity_recovery_cleanup(&recovery).await?;
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

        let recovery =
            delete_identity_directory_for_recovery(Some(stale_key.app_id().clone())).await?;

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
        complete_identity_recovery_cleanup(&recovery).await?;
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
        idb_put_string(RETIRED_APP_IDS_KEY, "{corrupt").await?;
        idb_put_string(&marker, "inaccessible-plan").await?;
        idb_put_string(
            crate::storage::indexed_db::APP_KEY_WRAPPED_KEY,
            "inaccessible",
        )
        .await?;
        idb_put_string(crate::storage::event_db::SIGNING_SEED_KEY, &"11".repeat(32)).await?;
        let recovery = delete_identity_directory_for_recovery(None).await?;
        assert!(
            idb_get_string(crate::storage::indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_none()
        );
        assert!(
            idb_get_string(crate::storage::event_db::SIGNING_SEED_KEY)
                .await?
                .is_none()
        );
        assert!(idb_get_string(&marker).await?.is_none());
        let recovered = load_identity_directory().await?;
        assert!(recovered.retired_app_ids().is_empty());
        complete_identity_recovery_cleanup(&recovery).await?;
        idb_delete_key("vault_registry").await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn recovery_targets_the_initiating_identity_not_the_shared_selection()
    -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let second_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        let first = super::super::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        let second = super::super::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;
        let unrelated_store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let unrelated_marker = format!("pending_identity_reconciliation_v2:{unrelated_store_id}");
        idb_put_string(&unrelated_marker, "remaining-identity-plan").await?;
        idb_put_string(
            crate::storage::device_access::DEVICE_ACCESS_PROFILE_KEY,
            "companion-access-evidence",
        )
        .await?;
        assert_eq!(
            load_identity_directory().await?.selection(),
            &nook_core::IdentitySelection::Selected(second.identity.identity_id.clone())
        );

        let recovery =
            delete_identity_directory_for_recovery(Some(first_key.app_id().clone())).await?;
        let retried_recovery =
            delete_identity_directory_for_recovery(Some(first_key.app_id().clone())).await?;
        assert_eq!(retried_recovery, recovery);

        let resumed_after_reload =
            delete_identity_directory_for_recovery(Some(second_key.app_id().clone())).await?;
        assert_eq!(resumed_after_reload, recovery);

        let directory = load_identity_directory().await?;
        assert_eq!(directory.identities().len(), 1);
        assert_eq!(
            directory.identities()[0].identity_id,
            second.identity.identity_id
        );
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        let remaining_keyring = keyring::load_keyring().await?;
        assert_eq!(remaining_keyring.entries().len(), 1);
        assert_eq!(remaining_keyring.entries()[0].app_id(), second_key.app_id());
        assert_ne!(first.identity.identity_id, second.identity.identity_id);
        assert_eq!(
            idb_get_string(&unrelated_marker).await?,
            Some("remaining-identity-plan".to_owned())
        );
        assert_eq!(
            idb_get_string(crate::storage::device_access::DEVICE_ACCESS_PROFILE_KEY).await?,
            Some("companion-access-evidence".to_owned())
        );

        complete_identity_recovery_cleanup(&recovery).await?;
        idb_delete_key(&unrelated_marker).await?;
        idb_delete_key(crate::storage::device_access::DEVICE_ACCESS_PROFILE_KEY).await?;
        keyring::clear_keyring_for_test().await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn scoped_recovery_preserves_a_different_surviving_selection() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let second_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let third_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        let third_wrapped =
            nook_core::wrap_device_identity_with_pin(&third_key.secret_string(), "third-secret")?;
        let first = super::super::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        super::super::save_new_protected_local_identity(&second_key, &second_wrapped, None, "Work")
            .await?;
        let third = super::super::save_new_protected_local_identity(
            &third_key,
            &third_wrapped,
            None,
            "Family",
        )
        .await?;

        let recovery =
            delete_identity_directory_for_recovery(Some(first_key.app_id().clone())).await?;

        let directory = load_identity_directory().await?;
        assert_eq!(directory.identities().len(), 2);
        assert_eq!(
            directory.selection(),
            &nook_core::IdentitySelection::Selected(third.identity.identity_id)
        );
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        assert_ne!(
            first.identity.identity_id,
            directory.identities()[0].identity_id
        );
        complete_identity_recovery_cleanup(&recovery).await?;
        keyring::clear_keyring_for_test().await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn corrupt_directory_with_valid_keyring_uses_safe_full_reset() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let second_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        super::super::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        super::super::save_new_protected_local_identity(&second_key, &second_wrapped, None, "Work")
            .await?;
        idb_put_string(IDENTITY_DIRECTORY_KEY, "{future-or-corrupt").await?;

        let recovery =
            delete_identity_directory_for_recovery(Some(first_key.app_id().clone())).await?;

        assert!(!recovery.has_remaining_local_identities);
        assert!(keyring::load_keyring().await?.entries().is_empty());
        let directory = load_identity_directory().await?;
        assert!(directory.identities().is_empty());
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        assert!(directory.retired_app_ids().contains(second_key.app_id()));
        complete_identity_recovery_cleanup(&recovery).await?;
        keyring::clear_keyring_for_test().await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn missing_directory_with_valid_keyring_uses_safe_full_reset() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let second_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        super::super::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        super::super::save_new_protected_local_identity(&second_key, &second_wrapped, None, "Work")
            .await?;
        idb_delete_key(IDENTITY_DIRECTORY_KEY).await?;

        let recovery =
            delete_identity_directory_for_recovery(Some(first_key.app_id().clone())).await?;

        assert!(!recovery.has_remaining_local_identities);
        assert!(keyring::load_keyring().await?.entries().is_empty());
        let directory = load_identity_directory().await?;
        assert!(directory.identities().is_empty());
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        assert!(directory.retired_app_ids().contains(second_key.app_id()));
        complete_identity_recovery_cleanup(&recovery).await?;
        keyring::clear_keyring_for_test().await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn recovery_rejects_a_corrupt_keyring_without_replacing_the_directory()
    -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let second_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        super::super::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        super::super::save_new_protected_local_identity(&second_key, &second_wrapped, None, "Work")
            .await?;
        let directory_before = idb_get_string(IDENTITY_DIRECTORY_KEY)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Identity directory is missing".to_owned()))?;
        idb_put_string(keyring::LOCAL_IDENTITY_KEYRING_KEY, "{future-or-corrupt").await?;

        let result =
            delete_identity_directory_for_recovery(Some(second_key.app_id().clone())).await;

        assert!(matches!(
            result,
            Err(NookError::IndexedDb(message)) if message.contains("keyring decode")
        ));
        assert_eq!(
            idb_get_string(IDENTITY_DIRECTORY_KEY).await?,
            Some(directory_before)
        );
        assert_eq!(
            idb_get_string(keyring::LOCAL_IDENTITY_KEYRING_KEY).await?,
            Some("{future-or-corrupt".to_owned())
        );
        keyring::clear_keyring_for_test().await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn scoped_recovery_preserves_simple_genesis_owned_by_a_remaining_identity()
    -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let second_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        let first = super::super::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        let pending = begin_or_resume_simple_genesis(&first_key, "Personal").await?;
        assert_eq!(pending.identity_id, first.identity.identity_id);
        super::super::save_new_protected_local_identity(&second_key, &second_wrapped, None, "Work")
            .await?;

        let recovery =
            delete_identity_directory_for_recovery(Some(second_key.app_id().clone())).await?;

        let preserved = pending_simple_genesis_for_store(pending.store_id.as_str())
            .await?
            .ok_or_else(|| NookError::IndexedDb("Pending Simple genesis was erased".to_owned()))?;
        assert_eq!(preserved.identity_id, first.identity.identity_id);
        complete_identity_recovery_cleanup(&recovery).await?;
        keyring::clear_keyring_for_test().await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn peer_only_identity_does_not_block_replacement_local_protection()
    -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let local_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&local_key.secret_string(), "local-secret")?;
        let saved =
            super::super::save_new_protected_local_identity(&local_key, &wrapped, None, "Personal")
                .await?;
        let peer_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let identity_id = saved.identity.identity_id.clone();
        update_identity_directory(move |directory| {
            directory
                .selected_mut()
                .map_err(map_domain_error)?
                .add_member(nook_core::IdentityMember {
                    app_id: peer_key.app_id().clone(),
                    auth_id: peer_key.auth_id(),
                    public_key: peer_key.public_key(),
                    signing_public_key: nook_core::DeviceSigningPublicKey::Unavailable,
                    label: None,
                })
                .map_err(map_domain_error)
        })
        .await?;

        let recovery =
            delete_identity_directory_for_recovery(Some(local_key.app_id().clone())).await?;

        let recovered_directory = load_identity_directory().await?;
        assert_eq!(
            recovered_directory.selection(),
            &nook_core::IdentitySelection::Empty
        );
        assert_eq!(recovered_directory.identities().len(), 1);
        assert_eq!(recovered_directory.identities()[0].identity_id, identity_id);
        complete_identity_recovery_cleanup(&recovery).await?;
        let replacement_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let replacement_wrapped = nook_core::wrap_device_identity_with_pin(
            &replacement_key.secret_string(),
            "replacement-secret",
        )?;
        let replacement = super::super::save_protected_local_identity(
            &replacement_key,
            &replacement_wrapped,
            "Recovered",
        )
        .await?;
        assert_ne!(replacement.identity.identity_id, identity_id);
        keyring::clear_keyring_for_test().await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn scoped_recovery_rejects_an_unattributed_sentinel_marker() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let second_key = nook_core::AppKey::generate().map_err(map_domain_error)?;
        let first_wrapped =
            nook_core::wrap_device_identity_with_pin(&first_key.secret_string(), "first-secret")?;
        let second_wrapped =
            nook_core::wrap_device_identity_with_pin(&second_key.secret_string(), "second-secret")?;
        super::super::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        super::super::save_new_protected_local_identity(&second_key, &second_wrapped, None, "Work")
            .await?;
        idb_put_string(
            crate::storage::indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY,
            "{}",
        )
        .await?;

        let result =
            delete_identity_directory_for_recovery(Some(second_key.app_id().clone())).await;

        assert!(matches!(
            result,
            Err(NookError::Database(message)) if message.contains("Sentinel")
        ));
        assert_eq!(keyring::load_keyring().await?.entries().len(), 2);
        assert_eq!(
            idb_get_string(crate::storage::indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY)
                .await?,
            Some("{}".to_owned())
        );
        idb_delete_key(crate::storage::indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY)
            .await?;
        keyring::clear_keyring_for_test().await?;
        clear_identity_directory_for_test().await
    }
}
