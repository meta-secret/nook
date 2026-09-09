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
mod atomic_string;
mod device_identity;
pub(crate) use atomic_string::{
    GuardedKeyringEntryRequest, IndexedDbFallbackUpdate, IndexedDbMigration, IndexedDbUpdate,
    StringUpdateGuard, StringUpdateResult,
};
mod local_vault;
#[path = "sentinel_storage.rs"]
mod sentinel_storage;

use crate::storage::identity_record;
use crate::{NookDatabase, NookError};
use js_sys::Date;
use nook_core::{AppId, IsoTimestamp, VaultName, VaultStoreIdentity, WrappedDeviceIdentity};
use rexie::TransactionMode;

#[allow(unused_imports)]
pub use device_identity::DeviceProtectionDeviceModeState;

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
pub(crate) use sentinel_storage::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY;

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

/// Named values required by NookDatabase::secret_search_bucket_key.
pub(crate) struct SecretSearchBucketKeyRequest<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) bucket: u8,
}

/// Named values required by NookDatabase::clear_vault_store.
pub(crate) struct ClearVaultStoreRequest<'a> {
    pub(crate) rexie: &'a rexie::Rexie,
    pub(crate) store_name: &'a str,
}

/// Named values required by NookDatabase::read_optional_string_from_store.
pub(crate) struct ReadOptionalStringFromStoreRequest<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) key: &'a str,
    pub(crate) context: &'a str,
}

/// Named values required by NookDatabase::idb_put_string.
pub(crate) struct IdbPutStringRequest<'a> {
    pub(crate) key: &'a str,
    pub(crate) value: &'a str,
}

/// Named values required by NookDatabase::read_string_preferring.
pub(crate) struct ReadStringPreferringRequest<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) preferred_key: &'a str,
    pub(crate) legacy_key: &'a str,
    pub(crate) label: &'a str,
}

impl NookDatabase {
    fn vault_blob_key(store_id: &str) -> String {
        format!("vault:{store_id}")
    }
}

impl NookDatabase {
    fn vault_cache_key(cache_ref: &str) -> String {
        format!("vault_cache:{cache_ref}")
    }
}

impl NookDatabase {
    fn secret_search_key(store_id: &str) -> String {
        format!("secret_search:{store_id}")
    }
}

impl NookDatabase {
    fn secret_search_bucket_key(request: SecretSearchBucketKeyRequest<'_>) -> String {
        let SecretSearchBucketKeyRequest { store_id, bucket } = request;
        format!("secret_search_v2:{store_id}:{bucket:02}")
    }
}

impl NookDatabase {
    pub(crate) async fn clear_vault_db() -> Result<(), NookError> {
        const STORES: [&str; 5] = [
            "vault",
            "events",
            "projections",
            "provider_receipts",
            "outbox",
        ];
        let rexie = NookDatabase::open_nook_database().await?;
        let mut errors = Vec::new();
        for store_name in STORES {
            if let Err(error) = NookDatabase::clear_vault_store(ClearVaultStoreRequest {
                rexie: &rexie,
                store_name: store_name,
            })
            .await
            {
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
}

impl NookDatabase {
    async fn clear_vault_store(request: ClearVaultStoreRequest<'_>) -> Result<(), NookError> {
        let ClearVaultStoreRequest { rexie, store_name } = request;
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
            .map_err(|e| {
                NookError::IndexedDb(format!("nook_db {store_name} clear error: {e:?}"))
            })?;
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!(
                "nook_db {store_name} clear completion error: {e:?}"
            ))
        })?;
        Ok(())
    }
}

impl NookDatabase {
    async fn read_optional_string_from_store(
        request: ReadOptionalStringFromStoreRequest<'_>,
    ) -> Result<Option<String>, NookError> {
        let ReadOptionalStringFromStoreRequest {
            store,
            key,
            context,
        } = request;
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
                .map_err(|error| {
                    NookError::IndexedDb(format!("{context} decode error: {error:?}"))
                }),
        }
    }
}

impl NookDatabase {
    pub(crate) async fn idb_get_string(key: &str) -> Result<Option<String>, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
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
}

impl NookDatabase {
    pub(crate) async fn idb_put_string(request: IdbPutStringRequest<'_>) -> Result<(), NookError> {
        let IdbPutStringRequest { key, value } = request;
        let rexie = NookDatabase::open_nook_database().await?;
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
}

impl NookDatabase {
    pub(crate) async fn idb_delete_key(key: &str) -> Result<(), NookError> {
        NookDatabase::idb_delete_keys(&[key]).await
    }
}

impl NookDatabase {
    pub(super) async fn idb_delete_keys(keys: &[&str]) -> Result<(), NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
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
}

impl NookDatabase {
    pub(crate) async fn read_string_preferring(
        request: ReadStringPreferringRequest<'_>,
    ) -> Result<Option<String>, NookError> {
        let ReadStringPreferringRequest {
            store,
            preferred_key,
            legacy_key,
            label,
        } = request;
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
}

#[cfg(test)]
mod unit_tests {

    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn storage_keys_keep_each_namespace_and_bucket_shape() {
        assert_eq!(NookDatabase::vault_blob_key("store-a"), "vault:store-a");
        assert_eq!(
            NookDatabase::vault_cache_key("remote"),
            "vault_cache:remote"
        );
        assert_eq!(
            NookDatabase::secret_search_key("store-a"),
            "secret_search:store-a"
        );
        assert_eq!(
            NookDatabase::secret_search_bucket_key(SecretSearchBucketKeyRequest {
                store_id: "store-a",
                bucket: 3
            }),
            "secret_search_v2:store-a:03"
        );
    }

    #[wasm_bindgen_test]
    fn registry_upsert_creates_defaults_updates_labels_and_touches_unlocks() {
        let mut registry = VaultRegistry::default();
        NookDatabase::upsert_registry_entry(UpsertRegistryEntryRequest {
            registry: &mut registry,
            store_id: "store_registry01",
            label: None,
            touch_unlock: false,
        });
        assert_eq!(registry.vaults.len(), 1);
        assert!(!registry.vaults[0].label.is_empty());
        assert!(registry.vaults[0].last_unlocked_at.is_none());

        NookDatabase::upsert_registry_entry(UpsertRegistryEntryRequest {
            registry: &mut registry,
            store_id: "store_registry01",
            label: Some(" Work "),
            touch_unlock: false,
        });
        assert_eq!(registry.vaults[0].label, " Work ");
        assert!(registry.vaults[0].last_unlocked_at.is_none());
        NookDatabase::upsert_registry_entry(UpsertRegistryEntryRequest {
            registry: &mut registry,
            store_id: "store_registry02",
            label: Some("Personal"),
            touch_unlock: false,
        });
        assert_eq!(registry.vaults.len(), 2);
    }

    #[wasm_bindgen_test]
    fn yaml_projection_fails_closed_and_defaults_unusable_labels() {
        assert!(NookDatabase::store_id_from_yaml("not yaml").is_err());
        assert!(NookDatabase::label_from_yaml("not yaml").is_none());
        assert!(!NookDatabase::default_registry_label("store_registry01").is_empty());
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod sentinel_genesis_storage_tests {
    use rexie::Rexie;

    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn vault_blob_registry_and_pending_slot_keep_local_projection_order()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let store_id = "store_indexeddb01";
        NookDatabase::save_vault_blob(SaveVaultBlobRequest {
            store_id: store_id,
            content: "encrypted-vault",
        })
        .await?;
        assert_eq!(
            NookDatabase::load_vault_blob(store_id).await?.as_deref(),
            Some("encrypted-vault")
        );
        assert_eq!(
            NookDatabase::get_active_vault_id().await?.as_deref(),
            Some(store_id)
        );
        assert_eq!(NookDatabase::list_vault_registry_entries().await?.len(), 1);

        NookDatabase::prepare_new_local_vault_slot().await?;
        assert!(NookDatabase::load_from_indexed_db().await?.is_none());
        NookDatabase::save_vault_blob(SaveVaultBlobRequest {
            store_id: store_id,
            content: "updated-vault",
        })
        .await?;
        assert_eq!(
            NookDatabase::load_from_indexed_db().await?.as_deref(),
            Some("updated-vault")
        );
        NookDatabase::clear_active_vault_id().await?;
        assert!(NookDatabase::load_from_indexed_db().await?.is_none());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn secret_search_buckets_round_trip_and_reject_out_of_range_writes()
    -> Result<(), wasm_bindgen::JsError> {
        let _ = Rexie::delete("nook_db").await;
        let store_id = "store_search01";
        NookDatabase::save_secret_search_catalog_buckets(SaveSecretSearchCatalogBucketsRequest {
            store_id: store_id,
            writes: &[(0, Some("first".to_owned())), (2, Some("third".to_owned()))],
        })
        .await?;
        assert_eq!(
            NookDatabase::load_secret_search_catalog_buckets(store_id).await?,
            vec![(0, "first".to_owned()), (2, "third".to_owned())]
        );
        NookDatabase::save_secret_search_catalog_buckets(SaveSecretSearchCatalogBucketsRequest {
            store_id: store_id,
            writes: &[(0, None)],
        })
        .await?;
        assert_eq!(
            NookDatabase::load_secret_search_catalog_buckets(store_id).await?,
            vec![(2, "third".to_owned())]
        );
        let error = NookDatabase::save_secret_search_catalog_buckets(
            SaveSecretSearchCatalogBucketsRequest {
                store_id: store_id,
                writes: &[(
                    nook_core::SECRET_SEARCH_CATALOG_BUCKET_COUNT,
                    Some("bad".to_owned()),
                )],
            },
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
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: "preferred",
            value: "new-value",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: "legacy",
            value: "old-value",
        })
        .await?;
        let database = NookDatabase::open_nook_database().await?;
        let transaction = database
            .transaction(&["vault"], TransactionMode::ReadOnly)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        let store = transaction
            .store("vault")
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        assert_eq!(
            NookDatabase::read_string_preferring(ReadStringPreferringRequest {
                store: &store,
                preferred_key: "preferred",
                legacy_key: "legacy",
                label: "fixture"
            })
            .await?,
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
        assert!(NookDatabase::save_to_indexed_db(" ").await.is_err());
        assert!(NookDatabase::save_to_indexed_db("not yaml").await.is_err());
        assert!(
            NookDatabase::set_local_vault_label(SetLocalVaultLabelRequest {
                store_id: "missing",
                label: " "
            })
            .await
            .is_err()
        );
        assert!(
            NookDatabase::set_local_vault_label(SetLocalVaultLabelRequest {
                store_id: "missing",
                label: "Known"
            })
            .await
            .is_err()
        );
        assert!(NookDatabase::switch_active_vault("missing").await.is_err());
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

        assert_eq!(
            NookDatabase::import_vault_blob(ImportVaultBlobRequest {
                content: &first,
                label: None
            })
            .await?,
            first_id
        );
        assert_eq!(
            NookDatabase::load_from_indexed_db().await?.as_deref(),
            Some(first.as_str())
        );
        assert_eq!(
            NookDatabase::list_vault_registry_entries().await?[0].label,
            "Original"
        );

        NookDatabase::set_local_vault_label(SetLocalVaultLabelRequest {
            store_id: &first_id,
            label: "  Renamed  ",
        })
        .await?;
        assert_eq!(
            NookDatabase::list_vault_registry_entries().await?[0].label,
            "Renamed"
        );
        let renamed = NookDatabase::load_vault_blob(&first_id)
            .await?
            .expect("renamed vault");
        let renamed_name = nook_core::VaultFormatDocument::new(&renamed)
            .name()
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        assert!(matches!(
            renamed_name,
            nook_core::VaultName::Named(name) if name == "Renamed"
        ));

        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &NookDatabase::secret_search_key(&first_id),
            value: "legacy-catalog",
        })
        .await?;
        NookDatabase::delete_legacy_secret_search_catalog(&first_id).await?;
        assert!(
            NookDatabase::idb_get_string(&NookDatabase::secret_search_key(&first_id))
                .await?
                .is_none()
        );
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &NookDatabase::vault_cache_key("provider-cache"),
            value: "cached-vault",
        })
        .await?;
        assert_eq!(
            NookDatabase::load_vault_local_cache("provider-cache")
                .await?
                .as_deref(),
            Some("cached-vault")
        );

        NookDatabase::prepare_new_local_vault_slot().await?;
        assert!(NookDatabase::load_from_indexed_db().await?.is_none());
        assert_eq!(
            NookDatabase::import_vault_blob(ImportVaultBlobRequest {
                content: &second,
                label: Some("Imported label")
            })
            .await?,
            second_id
        );
        assert_eq!(NookDatabase::list_vault_registry_entries().await?.len(), 2);
        NookDatabase::switch_active_vault(&first_id).await?;
        assert_eq!(
            NookDatabase::load_from_indexed_db().await?.as_deref(),
            Some(renamed.as_str())
        );
        assert!(
            NookDatabase::switch_active_vault("missing-vault")
                .await
                .is_err()
        );
        NookDatabase::clear_vault_db().await?;
        Ok(())
    }
}

pub(crate) use local_vault::{
    ImportVaultBlobRequest, SaveSecretSearchCatalogBucketsRequest, SaveVaultBlobRequest,
    SetLocalVaultLabelRequest, UpsertRegistryEntryRequest,
};

pub(crate) use device_identity::{
    PutWrappedDeviceIdentityRequest, SaveWrappedDeviceIdentityRequest,
};

pub(crate) use sentinel_storage::{
    SentinelDbLoadSentinelGenesisShareDelivery, SentinelDbSaveSentinelGenesisShareDelivery,
    SentinelDbSentinelGenesisShareKey,
};
