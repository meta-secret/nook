//! IndexedDB-backed storage adapter.
//!
//! Object stores inside `nook_db`:
//! - `vault` — encrypted vault YAML, local metadata, and device identities.
//! - `events` — immutable event bytes keyed by `[store_id, event_id]` strings.
//! - `projections` — encrypted materialized-view cache metadata.
//! - `provider_receipts` — reserved provider event receipt cache.
//! - `outbox` — retryable event appends per provider.
//!
//! Object keys in the `vault` store:
//! - `vault:{store_id}` — encrypted vault YAML for one logical vault.
//! - `vault_registry` — JSON list of locally cached vault metadata.
//! - `active_vault_id` — which `store_id` is currently selected.
//! - `pending_new_local_vault` — when set, local load returns empty so
//!   `connect_fresh` can bootstrap a second vault without overwriting the
//!   previous active blob.
//! - `device_id` / `device_identity_wrapped` — stable browser device identity
//!   metadata for passkey-derived identities or PIN-encrypted identity records.
//! - `vault_cache:{ref}` — per-provider local mirror of remote YAML.
//! - `secret_search_v2:{store_id}:{bucket}` — independently encrypted search
//!   catalog buckets. Searchable metadata is decrypted only while unlocked.
//! - `secret_search:{store_id}` — legacy plaintext catalog key, deleted
//!   unconditionally when that vault opens.
//! - `sentinel_genesis_share:{store_id}:{device_id}` — a core-verified encrypted
//!   Sentinel genesis share delivery for this participant. The delivery is
//!   scoped to the vault and device, but does not yet carry a virtual-identity
//!   binding. Unlike a draft genesis session, it may survive refresh and does
//!   not contain plaintext key material.
mod device_identity;
mod local_vault;
#[path = "sentinel_storage.rs"]
mod sentinel_storage;

use crate::storage::identity_record;
use js_sys::Date;
use nook_core::{AppId, IsoTimestamp, VaultName, VaultStoreIdentity, WrappedDeviceIdentity};
use rexie::TransactionMode;

pub use device_identity::DeviceProtectionDeviceModeState;
#[cfg(test)]
pub(crate) use device_identity::save_wrapped_device_identity;
pub(crate) use device_identity::{
    delete_device_identity_for_recovery, load_legacy_wrapped_device_identity_from_store,
    load_wrapped_device_identity, load_wrapped_device_identity_for_app_id,
};
#[allow(unused_imports)]
pub(crate) use local_vault::{
    clear_active_vault_id, default_registry_label, delete_legacy_secret_search_catalog,
    get_active_vault_id, import_vault_blob, label_from_yaml, list_vault_registry_entries,
    load_from_indexed_db, load_secret_search_catalog_buckets, load_vault_blob,
    load_vault_local_cache, load_vault_registry, prepare_new_local_vault_slot,
    save_secret_search_catalog_buckets, save_to_indexed_db, save_vault_blob, set_active_vault_id,
    set_local_vault_label, store_id_from_yaml, switch_active_vault, upsert_registry_entry,
};

use crate::{NookError, storage::open_nook_database};
use serde::{Deserialize, Serialize};

const ACTIVE_VAULT_KEY: &str = "active_vault_id";
const VAULT_REGISTRY_KEY: &str = "vault_registry";
const PENDING_NEW_LOCAL_VAULT_KEY: &str = "pending_new_local_vault";
pub(crate) const APP_ID_KEY: &str = "app_id";
pub(crate) const APP_KEY_WRAPPED_KEY: &str = "app_key_wrapped";
/// Legacy dual-read key for [`APP_ID_KEY`].
pub(crate) const DEVICE_ID_KEY: &str = "device_id";
/// Legacy dual-read key for [`APP_KEY_WRAPPED_KEY`].
pub(crate) const WRAPPED_DEVICE_IDENTITY_KEY: &str = "device_identity_wrapped";
pub(crate) use sentinel_storage::{
    SENTINEL_GENESIS_FINALIZATION_PENDING_KEY, clear_sentinel_genesis_finalization_pending,
    list_sentinel_genesis_share_deliveries, load_sentinel_genesis_finalization_pending,
    load_sentinel_genesis_share_delivery, save_sentinel_genesis_finalization_pending,
    save_sentinel_genesis_share_delivery,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultRegistryEntry {
    pub store_id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_unlocked_at: Option<nook_core::IsoTimestamp>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultRegistry {
    pub vaults: Vec<VaultRegistryEntry>,
}

fn vault_blob_key(store_id: &str) -> String {
    format!("vault:{store_id}")
}

fn vault_cache_key(cache_ref: &str) -> String {
    format!("vault_cache:{cache_ref}")
}

fn secret_search_key(store_id: &str) -> String {
    format!("secret_search:{store_id}")
}

fn secret_search_bucket_key(store_id: &str, bucket: u8) -> String {
    format!("secret_search_v2:{store_id}:{bucket:02}")
}

pub(crate) async fn clear_vault_db() -> Result<(), NookError> {
    const STORES: [&str; 5] = [
        "vault",
        "events",
        "projections",
        "provider_receipts",
        "outbox",
    ];
    let rexie = open_nook_database().await?;
    let mut errors = Vec::new();
    for store_name in STORES {
        if let Err(error) = clear_vault_store(&rexie, store_name).await {
            errors.push(error.to_string());
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(NookError::IndexedDb(format!(
            "nook_db clear errors: {}",
            errors.join("; ")
        )))
    }
}

async fn clear_vault_store(rexie: &rexie::Rexie, store_name: &str) -> Result<(), NookError> {
    let transaction = rexie
        .transaction(&[store_name], TransactionMode::ReadWrite)
        .map_err(|e| {
            NookError::IndexedDb(format!(
                "nook_db {store_name} clear transaction error: {e:?}"
            ))
        })?;
    transaction
        .store(store_name)
        .map_err(|e| NookError::IndexedDb(format!("nook_db {store_name} store error: {e:?}")))?
        .clear()
        .await
        .map_err(|e| NookError::IndexedDb(format!("nook_db {store_name} clear error: {e:?}")))?;
    transaction.done().await.map_err(|e| {
        NookError::IndexedDb(format!(
            "nook_db {store_name} clear completion error: {e:?}"
        ))
    })?;
    Ok(())
}

async fn read_optional_string_from_store(
    store: &rexie::Store,
    key: &str,
    context: &str,
) -> Result<Option<String>, NookError> {
    let id = serde_wasm_bindgen::to_value(key)
        .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
    let value = store
        .get(id)
        .await
        .map_err(|error| NookError::IndexedDb(format!("{context} read error: {error:?}")))?;
    match value {
        None => Ok(None),
        Some(value) if value.is_undefined() || value.is_null() => Ok(None),
        Some(value) => serde_wasm_bindgen::from_value(value)
            .map(Some)
            .map_err(|error| NookError::IndexedDb(format!("{context} decode error: {error:?}"))),
    }
}

pub(crate) async fn idb_get_string(key: &str) -> Result<Option<String>, NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let id_key = serde_wasm_bindgen::to_value(key)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let value = store
        .get(id_key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    match value {
        None => Ok(None),
        Some(val) if val.is_undefined() || val.is_null() => Ok(None),
        Some(val) => {
            let text: String = serde_wasm_bindgen::from_value(val)
                .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {e:?}")))?;
            Ok(Some(text))
        }
    }
}

pub(crate) async fn idb_put_string(key: &str, value: &str) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let id_key = serde_wasm_bindgen::to_value(key)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    let id_value = serde_wasm_bindgen::to_value(value)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
    store
        .put(&id_value, Some(&id_key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StringUpdateGuard<'a> {
    Unconditional,
    WrappedCredentialFingerprint(&'a str),
    AppWrappedCredentialFingerprint { app_id: &'a str, expected: &'a str },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StringUpdateResult {
    Applied,
    GuardRejected,
}

pub(super) async fn idb_update_string<F>(
    key: &str,
    guard: StringUpdateGuard<'_>,
    update: F,
) -> Result<StringUpdateResult, NookError>
where
    F: FnOnce(Option<String>) -> Result<String, NookError>,
{
    idb_update_string_with_fallback(key, None, guard, |_| true, update).await
}

async fn guarded_keyring_entry(
    store: &rexie::Store,
    guard: StringUpdateGuard<'_>,
) -> Result<(Option<nook_core::LocalIdentityKeyringEntry>, bool), NookError> {
    match guard {
        StringUpdateGuard::WrappedCredentialFingerprint(_) => Ok((
            identity_record::selected_local_keyring_entry_for_store(store).await?,
            true,
        )),
        StringUpdateGuard::AppWrappedCredentialFingerprint { app_id, .. } => {
            let app_id =
                AppId::parse(app_id).map_err(|error| NookError::Database(error.to_string()))?;
            Ok((
                identity_record::local_keyring_entry_for_app_id_from_store(store, &app_id).await?,
                false,
            ))
        }
        StringUpdateGuard::Unconditional => Ok((None, false)),
    }
}

pub(super) async fn idb_update_string_with_fallback<F, P>(
    key: &str,
    fallback_key: Option<&str>,
    guard: StringUpdateGuard<'_>,
    can_adopt_fallback: P,
    update: F,
) -> Result<StringUpdateResult, NookError>
where
    F: FnOnce(Option<String>) -> Result<String, NookError>,
    P: FnOnce(&str) -> bool,
{
    let rexie = open_nook_database().await?;
    // IndexedDB serializes read-write transactions that overlap one object
    // store. Keeping both operations in this transaction prevents two tabs
    // from reading the same profile and later overwriting each other's update.
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|error| {
            NookError::IndexedDb(format!("Atomic string update transaction error: {error:?}"))
        })?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!("Atomic string update store error: {error:?}"))
    })?;
    let (guarded_entry, allow_legacy_guard) = guarded_keyring_entry(&store, guard).await?;
    let expected_fingerprint = match guard {
        StringUpdateGuard::WrappedCredentialFingerprint(expected)
        | StringUpdateGuard::AppWrappedCredentialFingerprint { expected, .. } => Some(expected),
        StringUpdateGuard::Unconditional => None,
    };
    if let Some(expected) = expected_fingerprint {
        let fingerprint = match guarded_entry {
            Some(entry) => entry.wrapped_app_key().credential_id().ok().map(|bytes| {
                nook_core::PasskeyAccessProfile::credential_identifier(bytes.as_ref())
            }),
            None if allow_legacy_guard => read_string_preferring(
                &store,
                APP_KEY_WRAPPED_KEY,
                WRAPPED_DEVICE_IDENTITY_KEY,
                "Atomic string guard",
            )
            .await?
            .and_then(|raw| {
                let wrapped = WrappedDeviceIdentity::parse(&raw).ok()?;
                wrapped.credential_id().ok().map(|bytes| {
                    nook_core::PasskeyAccessProfile::credential_identifier(bytes.as_ref())
                })
            }),
            None => None,
        };
        if fingerprint.as_deref() != Some(expected) {
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!("Atomic string guard completion error: {error:?}"))
            })?;
            return Ok(StringUpdateResult::GuardRejected);
        }
    }
    let id_key = serde_wasm_bindgen::to_value(key).map_err(|error| {
        NookError::IndexedDb(format!("Atomic string update key error: {error:?}"))
    })?;
    let mut current = read_optional_string_from_store(&store, key, "Atomic string update").await?;
    let mut adopted_fallback_key = None;
    if current.is_none()
        && let Some(fallback_key) = fallback_key
    {
        let fallback =
            read_optional_string_from_store(&store, fallback_key, "Atomic string fallback").await?;
        if fallback.as_deref().is_some_and(can_adopt_fallback) {
            current = fallback;
            adopted_fallback_key = Some(fallback_key);
        }
    }
    let updated = update(current)?;
    let updated_value = serde_wasm_bindgen::to_value(&updated).map_err(|error| {
        NookError::IndexedDb(format!("Atomic string update encode error: {error:?}"))
    })?;
    store
        .put(&updated_value, Some(&id_key))
        .await
        .map_err(|error| {
            NookError::IndexedDb(format!("Atomic string update write error: {error:?}"))
        })?;
    if let Some(fallback_key) = adopted_fallback_key {
        let fallback_id = serde_wasm_bindgen::to_value(fallback_key).map_err(|error| {
            NookError::IndexedDb(format!("Atomic string fallback key error: {error:?}"))
        })?;
        store.delete(fallback_id).await.map_err(|error| {
            NookError::IndexedDb(format!("Atomic string fallback delete error: {error:?}"))
        })?;
    }
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Atomic string update completion error: {error:?}"))
    })?;
    Ok(StringUpdateResult::Applied)
}

pub(super) async fn idb_migrate_string_if<F>(
    source_key: &str,
    target_key: &str,
    can_migrate: F,
) -> Result<(), NookError>
where
    F: FnOnce(&str) -> bool,
{
    let rexie = open_nook_database().await?;
    // The ownership check, conditional copy, and source deletion share one
    // read-write transaction. IndexedDB therefore serializes this migration
    // with profile updates from every tab that touches the vault store.
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration transaction error: {error:?}"
            ))
        })?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!("Atomic string migration store error: {error:?}"))
    })?;
    let source_id = serde_wasm_bindgen::to_value(source_key).map_err(|error| {
        NookError::IndexedDb(format!(
            "Atomic string migration source key error: {error:?}"
        ))
    })?;
    let source = store.get(source_id.clone()).await.map_err(|error| {
        NookError::IndexedDb(format!(
            "Atomic string migration source read error: {error:?}"
        ))
    })?;
    let Some(source) = source.filter(|value| !value.is_undefined() && !value.is_null()) else {
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration completion error: {error:?}"
            ))
        })?;
        return Ok(());
    };
    let source_text: String = serde_wasm_bindgen::from_value(source.clone()).map_err(|error| {
        NookError::IndexedDb(format!("Atomic string migration decode error: {error:?}"))
    })?;
    if !can_migrate(&source_text) {
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration completion error: {error:?}"
            ))
        })?;
        return Ok(());
    }
    let target_id = serde_wasm_bindgen::to_value(target_key).map_err(|error| {
        NookError::IndexedDb(format!(
            "Atomic string migration target key error: {error:?}"
        ))
    })?;
    let target = store.get(target_id.clone()).await.map_err(|error| {
        NookError::IndexedDb(format!(
            "Atomic string migration target read error: {error:?}"
        ))
    })?;
    if let Some(target) = target.filter(|value| !value.is_undefined() && !value.is_null()) {
        let target_text: String = serde_wasm_bindgen::from_value(target).map_err(|error| {
            NookError::IndexedDb(format!(
                "Atomic string migration target decode error: {error:?}"
            ))
        })?;
        if target_text != source_text {
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!(
                    "Atomic string migration completion error: {error:?}"
                ))
            })?;
            return Err(NookError::Database(
                "Legacy and identity-scoped records conflict; both records were preserved"
                    .to_owned(),
            ));
        }
    } else {
        store
            .put(&source, Some(&target_id))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Atomic string migration write error: {error:?}"))
            })?;
    }
    store.delete(source_id).await.map_err(|error| {
        NookError::IndexedDb(format!("Atomic string migration delete error: {error:?}"))
    })?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!(
            "Atomic string migration completion error: {error:?}"
        ))
    })?;
    Ok(())
}

pub(crate) async fn idb_delete_key(key: &str) -> Result<(), NookError> {
    idb_delete_keys(&[key]).await
}

pub(super) async fn idb_delete_keys(keys: &[&str]) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    for key in keys {
        let id_key = serde_wasm_bindgen::to_value(key)
            .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
        store
            .delete(id_key)
            .await
            .map_err(|e| NookError::IndexedDb(format!("Delete error: {e:?}")))?;
    }
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

pub(crate) async fn read_string_preferring(
    store: &rexie::Store,
    preferred_key: &str,
    legacy_key: &str,
    label: &str,
) -> Result<Option<String>, NookError> {
    for key_name in [preferred_key, legacy_key] {
        let key = serde_wasm_bindgen::to_value(key_name)
            .map_err(|error| NookError::IndexedDb(format!("{label} key error: {error:?}")))?;
        let value = store
            .get(key)
            .await
            .map_err(|error| NookError::IndexedDb(format!("{label} read error: {error:?}")))?;
        if let Some(value) = value.filter(|entry| !entry.is_undefined() && !entry.is_null()) {
            let decoded: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                NookError::IndexedDb(format!("{label} decode error: {error:?}"))
            })?;
            return Ok(Some(decoded));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod unit_tests {
    use super::local_vault::{
        default_registry_label, label_from_yaml, store_id_from_yaml, upsert_registry_entry,
    };
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn storage_keys_keep_each_namespace_and_bucket_shape() {
        assert_eq!(vault_blob_key("store-a"), "vault:store-a");
        assert_eq!(vault_cache_key("remote"), "vault_cache:remote");
        assert_eq!(secret_search_key("store-a"), "secret_search:store-a");
        assert_eq!(
            secret_search_bucket_key("store-a", 3),
            "secret_search_v2:store-a:03"
        );
    }

    #[wasm_bindgen_test]
    fn registry_upsert_creates_defaults_updates_labels_and_touches_unlocks() {
        let mut registry = VaultRegistry::default();
        upsert_registry_entry(&mut registry, "store_registry01", None, false);
        assert_eq!(registry.vaults.len(), 1);
        assert!(!registry.vaults[0].label.is_empty());
        assert!(registry.vaults[0].last_unlocked_at.is_none());

        upsert_registry_entry(&mut registry, "store_registry01", Some(" Work "), false);
        assert_eq!(registry.vaults[0].label, " Work ");
        assert!(registry.vaults[0].last_unlocked_at.is_none());
        upsert_registry_entry(&mut registry, "store_registry02", Some("Personal"), false);
        assert_eq!(registry.vaults.len(), 2);
    }

    #[wasm_bindgen_test]
    fn yaml_projection_fails_closed_and_defaults_unusable_labels() {
        assert!(store_id_from_yaml("not yaml").is_err());
        assert!(label_from_yaml("not yaml").is_none());
        assert!(!default_registry_label("store_registry01").is_empty());
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod sentinel_genesis_storage_tests {
    use rexie::Rexie;

    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn atomic_string_migration_preserves_conflicting_records()
    -> Result<(), wasm_bindgen::JsError> {
        const SOURCE_KEY: &str = "test-legacy-profile-conflict";
        const TARGET_KEY: &str = "test-scoped-profile-conflict";
        idb_put_string(SOURCE_KEY, "legacy-value").await?;
        idb_put_string(TARGET_KEY, "scoped-value").await?;

        let result = idb_migrate_string_if(SOURCE_KEY, TARGET_KEY, |_| true).await;

        assert!(result.is_err());
        assert_eq!(
            idb_get_string(SOURCE_KEY).await?.as_deref(),
            Some("legacy-value")
        );
        assert_eq!(
            idb_get_string(TARGET_KEY).await?.as_deref(),
            Some("scoped-value")
        );
        idb_delete_keys(&[SOURCE_KEY, TARGET_KEY]).await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn atomic_update_adopts_and_removes_legacy_fallback() -> Result<(), wasm_bindgen::JsError>
    {
        const SOURCE_KEY: &str = "test-legacy-profile-adoption";
        const TARGET_KEY: &str = "test-scoped-profile-adoption";
        idb_put_string(SOURCE_KEY, "legacy-value").await?;
        idb_delete_key(TARGET_KEY).await?;

        let result = idb_update_string_with_fallback(
            TARGET_KEY,
            Some(SOURCE_KEY),
            StringUpdateGuard::Unconditional,
            |_| true,
            |current| Ok(format!("{}-updated", current.unwrap_or_default())),
        )
        .await?;

        assert_eq!(result, StringUpdateResult::Applied);
        assert!(idb_get_string(SOURCE_KEY).await?.is_none());
        assert_eq!(
            idb_get_string(TARGET_KEY).await?.as_deref(),
            Some("legacy-value-updated")
        );
        idb_delete_key(TARGET_KEY).await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn vault_blob_registry_and_pending_slot_keep_local_projection_order()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let store_id = "store_indexeddb01";
        save_vault_blob(store_id, "encrypted-vault").await?;
        assert_eq!(
            load_vault_blob(store_id).await?.as_deref(),
            Some("encrypted-vault")
        );
        assert_eq!(get_active_vault_id().await?.as_deref(), Some(store_id));
        assert_eq!(list_vault_registry_entries().await?.len(), 1);

        prepare_new_local_vault_slot().await?;
        assert!(load_from_indexed_db().await?.is_none());
        save_vault_blob(store_id, "updated-vault").await?;
        assert_eq!(
            load_from_indexed_db().await?.as_deref(),
            Some("updated-vault")
        );
        clear_active_vault_id().await?;
        assert!(load_from_indexed_db().await?.is_none());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn secret_search_buckets_round_trip_and_reject_out_of_range_writes()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let store_id = "store_search01";
        save_secret_search_catalog_buckets(
            store_id,
            &[(0, Some("first".to_owned())), (2, Some("third".to_owned()))],
        )
        .await?;
        assert_eq!(
            load_secret_search_catalog_buckets(store_id).await?,
            vec![(0, "first".to_owned()), (2, "third".to_owned())]
        );
        save_secret_search_catalog_buckets(store_id, &[(0, None)]).await?;
        assert_eq!(
            load_secret_search_catalog_buckets(store_id).await?,
            vec![(2, "third".to_owned())]
        );
        let error = save_secret_search_catalog_buckets(
            store_id,
            &[(
                nook_core::SECRET_SEARCH_CATALOG_BUCKET_COUNT,
                Some("bad".to_owned()),
            )],
        )
        .await
        .expect_err("out-of-range search bucket must fail closed");
        assert!(matches!(error, NookError::IndexedDb(message) if message.contains("out of range")));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn preferred_storage_value_wins_over_legacy_fallback() -> Result<(), wasm_bindgen::JsError>
    {
        let _ = Rexie::delete("nook_db").await;
        idb_put_string("preferred", "new-value").await?;
        idb_put_string("legacy", "old-value").await?;
        let database = open_nook_database().await?;
        let transaction = database
            .transaction(&["vault"], TransactionMode::ReadOnly)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        let store = transaction
            .store("vault")
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        assert_eq!(
            read_string_preferring(&store, "preferred", "legacy", "fixture").await?,
            Some("new-value".to_owned())
        );
        transaction
            .done()
            .await
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn local_vault_validation_rejects_empty_or_unknown_updates()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        assert!(save_to_indexed_db(" ").await.is_err());
        assert!(save_to_indexed_db("not yaml").await.is_err());
        assert!(set_local_vault_label("missing", " ").await.is_err());
        assert!(set_local_vault_label("missing", "Known").await.is_err());
        assert!(switch_active_vault("missing").await.is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn local_vault_import_label_switch_and_legacy_cleanup()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let first_id = nook_core::StoreId::generate()?.to_string();
        let second_id = nook_core::StoreId::generate()?.to_string();
        let first = nook_core::VaultRecordSet::serialize_yaml_with_unlock_and_name(
            &[],
            &nook_core::VaultUnlock::Keys,
            &[],
            nook_core::VaultStoreIdentityRef::Assigned(&first_id),
            nook_core::VaultNameRef::Named("Original"),
            nook_core::VaultVersionWrite::Initial,
        )?
        .into_inner();
        let second = nook_core::VaultRecordSet::serialize_yaml_with_unlock_and_name(
            &[],
            &nook_core::VaultUnlock::Keys,
            &[],
            nook_core::VaultStoreIdentityRef::Assigned(&second_id),
            nook_core::VaultNameRef::Named("Imported"),
            nook_core::VaultVersionWrite::Initial,
        )?
        .into_inner();

        assert_eq!(import_vault_blob(&first, None).await?, first_id);
        assert_eq!(
            load_from_indexed_db().await?.as_deref(),
            Some(first.as_str())
        );
        assert_eq!(list_vault_registry_entries().await?[0].label, "Original");

        set_local_vault_label(&first_id, "  Renamed  ").await?;
        assert_eq!(list_vault_registry_entries().await?[0].label, "Renamed");
        let renamed = load_vault_blob(&first_id).await?.expect("renamed vault");
        let renamed_name = nook_core::VaultFormatDocument::new(&renamed)
            .name()
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        assert!(matches!(
            renamed_name,
            nook_core::VaultName::Named(name) if name == "Renamed"
        ));

        idb_put_string(&secret_search_key(&first_id), "legacy-catalog").await?;
        delete_legacy_secret_search_catalog(&first_id).await?;
        assert!(
            idb_get_string(&secret_search_key(&first_id))
                .await?
                .is_none()
        );
        idb_put_string(&vault_cache_key("provider-cache"), "cached-vault").await?;
        assert_eq!(
            load_vault_local_cache("provider-cache").await?.as_deref(),
            Some("cached-vault")
        );

        prepare_new_local_vault_slot().await?;
        assert!(load_from_indexed_db().await?.is_none());
        assert_eq!(
            import_vault_blob(&second, Some("Imported label")).await?,
            second_id
        );
        assert_eq!(list_vault_registry_entries().await?.len(), 2);
        switch_active_vault(&first_id).await?;
        assert_eq!(
            load_from_indexed_db().await?.as_deref(),
            Some(renamed.as_str())
        );
        assert!(switch_active_vault("missing-vault").await.is_err());
        clear_vault_db().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn atomic_update_and_migration_noop_paths_are_explicit()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        assert_eq!(
            idb_update_string("current", StringUpdateGuard::Unconditional, |value| {
                Ok(format!("{}-updated", value.unwrap_or_default()))
            })
            .await?,
            StringUpdateResult::Applied
        );
        assert_eq!(
            idb_get_string("current").await?.as_deref(),
            Some("-updated")
        );

        idb_put_string("fallback", "legacy").await?;
        assert_eq!(
            idb_update_string_with_fallback(
                "target",
                Some("fallback"),
                StringUpdateGuard::Unconditional,
                |_| false,
                |value| Ok(value.unwrap_or_else(|| "fresh".to_owned())),
            )
            .await?,
            StringUpdateResult::Applied
        );
        assert_eq!(idb_get_string("target").await?.as_deref(), Some("fresh"));
        assert_eq!(idb_get_string("fallback").await?.as_deref(), Some("legacy"));

        idb_migrate_string_if("missing-source", "missing-target", |_| true).await?;
        idb_put_string("blocked-source", "legacy").await?;
        idb_migrate_string_if("blocked-source", "blocked-target", |_| false).await?;
        assert_eq!(
            idb_get_string("blocked-source").await?.as_deref(),
            Some("legacy")
        );

        let bad_guard = idb_update_string(
            "guarded",
            StringUpdateGuard::AppWrappedCredentialFingerprint {
                app_id: "not-an-app-id",
                expected: "fingerprint",
            },
            |_| Ok("should-not-write".to_owned()),
        )
        .await;
        assert!(bad_guard.is_err());

        let database = open_nook_database().await?;
        let transaction = database
            .transaction(&["vault"], TransactionMode::ReadOnly)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        let store = transaction
            .store("vault")
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        assert_eq!(
            read_string_preferring(&store, "missing-preferred", "fallback", "legacy").await?,
            Some("legacy".to_owned())
        );
        transaction
            .done()
            .await
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        clear_vault_db().await?;
        Ok(())
    }
}
