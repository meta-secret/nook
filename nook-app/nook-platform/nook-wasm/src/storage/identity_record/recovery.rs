//! Destructive identity and device recovery persistence.

use super::{
    IDENTITY_DIRECTORY_KEY, LEGACY_IDENTITY_RECORD_KEY, RETIRED_APP_IDS_KEY, decode_directory,
    is_identity_reconciliation_key, load_identity_directory, load_retired_app_ids, simple_genesis,
};
use crate::{NookError, storage::open_nook_database};

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
    // A damaged auxiliary ledger must not trap a user behind an inaccessible
    // device identity. The transaction rewrites a valid ledger below.
    for app_id in load_retired_app_ids(&store).await.unwrap_or_default() {
        directory.retire_app_id(app_id);
    }
    let persisted_app_id = crate::storage::indexed_db::read_string_preferring(
        &store,
        crate::storage::indexed_db::APP_ID_KEY,
        crate::storage::indexed_db::DEVICE_ID_KEY,
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
        crate::storage::indexed_db::APP_KEY_WRAPPED_KEY.to_owned(),
        crate::storage::indexed_db::APP_ID_KEY.to_owned(),
        crate::storage::indexed_db::WRAPPED_DEVICE_IDENTITY_KEY.to_owned(),
        crate::storage::indexed_db::DEVICE_ID_KEY.to_owned(),
        crate::storage::indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY.to_owned(),
        crate::storage::event_db::SIGNING_SEED_KEY.to_owned(),
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
mod tests {
    use super::*;
    use crate::storage::identity_record::{
        begin_or_resume_simple_genesis, clear_identity_directory_for_test,
        ensure_local_identity_for_app_key, generate_vault_dek_for_identity, map_domain_error,
        pending_simple_genesis_for_store, validate_vault_identity_enrollment,
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
        idb_put_string(RETIRED_APP_IDS_KEY, "{corrupt").await?;
        idb_put_string(&marker, "inaccessible-plan").await?;
        idb_put_string(
            crate::storage::indexed_db::APP_KEY_WRAPPED_KEY,
            "inaccessible",
        )
        .await?;
        idb_put_string(crate::storage::event_db::SIGNING_SEED_KEY, &"11".repeat(32)).await?;
        delete_identity_directory_for_recovery().await?;
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
        idb_delete_key("vault_registry").await?;
        clear_identity_directory_for_test().await
    }
}
