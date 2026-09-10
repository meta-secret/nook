use super::VaultUnlockHistory;
use super::{
    ACTIVE_VAULT_KEY, Date, IsoTimestamp, NookError, PENDING_NEW_LOCAL_VAULT_KEY, TransactionMode,
    VAULT_REGISTRY_KEY, VaultName, VaultRegistry, VaultRegistryEntry, VaultStoreIdentity,
};
use crate::storage::indexed_db::StoredStringRecord;
use crate::{IdbPutStringRequest, NookDatabase, SecretSearchBucketKeyRequest};
use nook_core::ActiveVaultScope;

pub(crate) enum RegistryLabelUpdate<'a> {
    PreserveOrDefault,
    Set(&'a str),
}

pub(crate) enum ImportVaultLabel<'a> {
    FromDocument,
    Override(&'a str),
}

/// Named values required by `NookDatabase::upsert_registry_entry`.
pub(crate) struct UpsertRegistryEntryRequest<'a> {
    pub(crate) registry: &'a mut VaultRegistry,
    pub(crate) store_id: &'a str,
    pub(crate) label: RegistryLabelUpdate<'a>,
    pub(crate) touch_unlock: bool,
}

/// Named values required by `NookDatabase::save_vault_blob`.
pub(crate) struct SaveVaultBlobRequest<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) content: &'a str,
}

pub(crate) enum SecretSearchBucketMutation {
    Write { bucket: u8, ciphertext: String },
    Delete { bucket: u8 },
}

impl SecretSearchBucketMutation {
    fn bucket(&self) -> u8 {
        match self {
            Self::Write { bucket, .. } | Self::Delete { bucket } => *bucket,
        }
    }
}

/// Named values required by `NookDatabase::save_secret_search_catalog_buckets`.
pub(crate) struct SaveSecretSearchCatalogBucketsRequest<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) writes: &'a [SecretSearchBucketMutation],
}

/// Named values required by `NookDatabase::set_local_vault_label`.
pub(crate) struct SetLocalVaultLabelRequest<'a> {
    pub(crate) store_id: &'a str,
    pub(crate) label: &'a str,
}

/// Named values required by `NookDatabase::import_vault_blob`.
pub(crate) struct ImportVaultBlobRequest<'a> {
    pub(crate) content: &'a str,
    pub(crate) label: ImportVaultLabel<'a>,
}

/// Presence of an encrypted local vault snapshot or provider cache.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum VaultSnapshotLookup {
    NotStored,
    Stored(String),
}

impl NookDatabase {
    pub(crate) fn store_id_from_yaml(content: &str) -> Result<String, NookError> {
        match nook_core::VaultFormatDocument::new(content)
            .store_id()
            .map_err(|e| NookError::Database(e.to_string()))?
        {
            VaultStoreIdentity::Assigned(store_id) => Ok(store_id),
            VaultStoreIdentity::Unassigned => Err(NookError::Database(
                "Vault YAML is missing store_id.".to_owned(),
            )),
        }
    }
}

impl NookDatabase {
    pub(crate) fn label_from_yaml(content: &str) -> Result<VaultName, NookError> {
        nook_core::VaultFormatDocument::new(content)
            .name()
            .map_err(|error| NookError::Database(error.to_string()))
    }
}

impl NookDatabase {
    pub(crate) fn default_registry_label(store_id: &str) -> String {
        nook_core::VaultStoreIdentity::default_name_for_store_id(store_id)
    }
}

impl NookDatabase {
    pub(crate) async fn load_vault_registry() -> Result<VaultRegistry, NookError> {
        let raw = NookDatabase::idb_get_string(VAULT_REGISTRY_KEY).await?;
        let StoredStringRecord::Stored(json) = raw else {
            return Ok(VaultRegistry::default());
        };
        let mut registry: VaultRegistry = serde_json::from_str(&json)
            .map_err(|e| NookError::IndexedDb(format!("Vault registry parse error: {e}")))?;
        for entry in &mut registry.vaults {
            if entry.label.trim().is_empty() {
                entry.label = NookDatabase::default_registry_label(&entry.store_id);
            }
        }
        Ok(registry)
    }
}

impl NookDatabase {
    async fn save_vault_registry(registry: &VaultRegistry) -> Result<(), NookError> {
        let json = serde_json::to_string(registry)
            .map_err(|e| NookError::IndexedDb(format!("Vault registry serialize error: {e}")))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: VAULT_REGISTRY_KEY,
            value: &json,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn get_active_vault_id() -> Result<ActiveVaultScope, NookError> {
        Ok(
            match NookDatabase::idb_get_string(ACTIVE_VAULT_KEY).await? {
                StoredStringRecord::Stored(store_id) => ActiveVaultScope::StoreId(store_id),
                StoredStringRecord::MissingKey => ActiveVaultScope::Unselected,
            },
        )
    }
}

impl NookDatabase {
    pub(crate) async fn set_active_vault_id(store_id: &str) -> Result<(), NookError> {
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: ACTIVE_VAULT_KEY,
            value: store_id,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn clear_active_vault_id() -> Result<(), NookError> {
        NookDatabase::idb_delete_key(ACTIVE_VAULT_KEY).await
    }
}

impl NookDatabase {
    async fn is_pending_new_local_vault() -> Result<bool, NookError> {
        Ok(matches!(
            NookDatabase::idb_get_string(PENDING_NEW_LOCAL_VAULT_KEY).await?,
            StoredStringRecord::Stored(_)
        ))
    }
}

impl NookDatabase {
    pub(crate) async fn prepare_new_local_vault_slot() -> Result<(), NookError> {
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: PENDING_NEW_LOCAL_VAULT_KEY,
            value: "1",
        })
        .await
    }
}

impl NookDatabase {
    async fn clear_pending_new_local_vault() -> Result<(), NookError> {
        NookDatabase::idb_delete_key(PENDING_NEW_LOCAL_VAULT_KEY).await
    }
}

impl NookDatabase {
    pub(crate) fn upsert_registry_entry(request: UpsertRegistryEntryRequest<'_>) {
        let UpsertRegistryEntryRequest {
            registry,
            store_id,
            label,
            touch_unlock,
        } = request;
        let now = if touch_unlock {
            VaultUnlockHistory::Unlocked(NookDatabase::chrono_lite_now())
        } else {
            VaultUnlockHistory::NeverUnlocked
        };
        if let Some(entry) = registry
            .vaults
            .iter_mut()
            .find(|entry| entry.store_id == store_id)
        {
            if let RegistryLabelUpdate::Set(text) = label {
                entry.label = text.to_owned();
            }
            if touch_unlock {
                entry.last_unlocked_at = now;
            }
            return;
        }
        registry.vaults.push(VaultRegistryEntry {
            store_id: store_id.to_owned(),
            label: match label {
                RegistryLabelUpdate::PreserveOrDefault => {
                    NookDatabase::default_registry_label(store_id)
                }
                RegistryLabelUpdate::Set(text) => text.to_owned(),
            },
            last_unlocked_at: now,
        });
    }
}

impl NookDatabase {
    fn chrono_lite_now() -> nook_core::IsoTimestamp {
        IsoTimestamp::from_trusted(Date::new_0().to_iso_string().into())
    }
}

impl NookDatabase {
    pub(crate) async fn list_vault_registry_entries() -> Result<Vec<VaultRegistryEntry>, NookError>
    {
        Ok(NookDatabase::load_vault_registry().await?.vaults)
    }
}

impl NookDatabase {
    pub(crate) async fn load_vault_blob(store_id: &str) -> Result<VaultSnapshotLookup, NookError> {
        Ok(
            match NookDatabase::idb_get_string(&NookDatabase::vault_blob_key(store_id)).await? {
                StoredStringRecord::Stored(content) => VaultSnapshotLookup::Stored(content),
                StoredStringRecord::MissingKey => VaultSnapshotLookup::NotStored,
            },
        )
    }
}

impl NookDatabase {
    pub(crate) async fn save_vault_blob(
        request: SaveVaultBlobRequest<'_>,
    ) -> Result<(), NookError> {
        let SaveVaultBlobRequest { store_id, content } = request;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &NookDatabase::vault_blob_key(store_id),
            value: content,
        })
        .await?;
        let mut registry = NookDatabase::load_vault_registry().await?;
        NookDatabase::upsert_registry_entry(UpsertRegistryEntryRequest {
            registry: &mut registry,
            store_id: store_id,
            label: RegistryLabelUpdate::PreserveOrDefault,
            touch_unlock: true,
        });
        NookDatabase::save_vault_registry(&registry).await?;
        NookDatabase::set_active_vault_id(store_id).await?;
        NookDatabase::clear_pending_new_local_vault().await
    }
}

impl NookDatabase {
    pub(crate) async fn delete_legacy_secret_search_catalog(
        store_id: &str,
    ) -> Result<(), NookError> {
        NookDatabase::idb_delete_key(&NookDatabase::secret_search_key(store_id)).await
    }
}

impl NookDatabase {
    pub(crate) async fn load_secret_search_catalog_buckets(
        store_id: &str,
    ) -> Result<Vec<(u8, String)>, NookError> {
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadOnly)
            .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
        let store = transaction
            .store("vault")
            .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
        let mut buckets = Vec::new();
        for bucket in 0..nook_core::SECRET_SEARCH_CATALOG_BUCKET_COUNT {
            let key = NookDatabase::secret_search_bucket_key(SecretSearchBucketKeyRequest {
                store_id: store_id,
                bucket: bucket,
            });
            let id_key = serde_wasm_bindgen::to_value(&key)
                .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
            let value = store
                .get(id_key)
                .await
                .map_err(|e| NookError::IndexedDb(format!("Get error: {e:?}")))?;
            if let Some(value) = value.filter(|value| !value.is_undefined() && !value.is_null()) {
                let ciphertext = serde_wasm_bindgen::from_value(value)
                    .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {e:?}")))?;
                buckets.push((bucket, ciphertext));
            }
        }
        transaction
            .done()
            .await
            .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
        Ok(buckets)
    }
}

impl NookDatabase {
    pub(crate) async fn save_secret_search_catalog_buckets(
        request: SaveSecretSearchCatalogBucketsRequest<'_>,
    ) -> Result<(), NookError> {
        let SaveSecretSearchCatalogBucketsRequest { store_id, writes } = request;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
        let store = transaction
            .store("vault")
            .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
        for mutation in writes {
            let bucket = mutation.bucket();
            if bucket >= nook_core::SECRET_SEARCH_CATALOG_BUCKET_COUNT {
                return Err(NookError::IndexedDb(format!(
                    "Secret search bucket {bucket} is out of range."
                )));
            }
            let key = NookDatabase::secret_search_bucket_key(SecretSearchBucketKeyRequest {
                store_id: store_id,
                bucket: bucket,
            });
            let id_key = serde_wasm_bindgen::to_value(&key)
                .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
            match mutation {
                SecretSearchBucketMutation::Write { ciphertext, .. } => {
                    let value = serde_wasm_bindgen::to_value(ciphertext)
                        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
                    store
                        .put(&value, Some(&id_key))
                        .await
                        .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
                }
                SecretSearchBucketMutation::Delete { .. } => {
                    store
                        .delete(id_key)
                        .await
                        .map_err(|e| NookError::IndexedDb(format!("Delete error: {e:?}")))?;
                }
            }
        }
        transaction
            .done()
            .await
            .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
        Ok(())
    }
}

impl NookDatabase {
    pub(crate) async fn load_from_indexed_db() -> Result<VaultSnapshotLookup, NookError> {
        if NookDatabase::is_pending_new_local_vault().await? {
            return Ok(VaultSnapshotLookup::NotStored);
        }

        let active = NookDatabase::get_active_vault_id().await?;
        let store_id = match active {
            ActiveVaultScope::StoreId(store_id) if !store_id.trim().is_empty() => store_id,
            ActiveVaultScope::StoreId(_) | ActiveVaultScope::Unselected => {
                return Ok(VaultSnapshotLookup::NotStored);
            }
        };
        NookDatabase::load_vault_blob(&store_id).await
    }
}

impl NookDatabase {
    pub(crate) async fn load_vault_local_cache(
        cache_ref: &str,
    ) -> Result<VaultSnapshotLookup, NookError> {
        Ok(
            match NookDatabase::idb_get_string(&NookDatabase::vault_cache_key(cache_ref)).await? {
                StoredStringRecord::Stored(content) => VaultSnapshotLookup::Stored(content),
                StoredStringRecord::MissingKey => VaultSnapshotLookup::NotStored,
            },
        )
    }
}

impl NookDatabase {
    pub(crate) async fn save_to_indexed_db(content: &str) -> Result<(), NookError> {
        if content.trim().is_empty() {
            return Err(NookError::Database(
                "Refusing to persist empty vault blob.".to_owned(),
            ));
        }
        let store_id = NookDatabase::store_id_from_yaml(content)?;
        NookDatabase::save_vault_blob(SaveVaultBlobRequest {
            store_id: &store_id,
            content: content,
        })
        .await
    }
}

impl NookDatabase {
    pub(crate) async fn set_local_vault_label(
        request: SetLocalVaultLabelRequest<'_>,
    ) -> Result<(), NookError> {
        let SetLocalVaultLabelRequest { store_id, label } = request;
        let trimmed = label.trim();
        if trimmed.is_empty() {
            return Err(NookError::Database(
                "Vault label cannot be empty.".to_owned(),
            ));
        }
        let mut registry = NookDatabase::load_vault_registry().await?;
        if !registry
            .vaults
            .iter()
            .any(|entry| entry.store_id == store_id)
        {
            return Err(NookError::Database(format!(
                "Vault {store_id} is not registered on this device."
            )));
        }
        NookDatabase::upsert_registry_entry(UpsertRegistryEntryRequest {
            registry: &mut registry,
            store_id: store_id,
            label: RegistryLabelUpdate::Set(trimmed),
            touch_unlock: false,
        });
        NookDatabase::save_vault_registry(&registry).await?;
        if let VaultSnapshotLookup::Stored(content) =
            NookDatabase::load_vault_blob(store_id).await?
        {
            let named = nook_core::VaultFormatDocument::new(&content).rename(trimmed)?;
            NookDatabase::idb_put_string(IdbPutStringRequest {
                key: &NookDatabase::vault_blob_key(store_id),
                value: named.as_str(),
            })
            .await?;
        }
        Ok(())
    }
}

impl NookDatabase {
    pub(crate) async fn switch_active_vault(store_id: &str) -> Result<(), NookError> {
        let registry = NookDatabase::load_vault_registry().await?;
        if !registry
            .vaults
            .iter()
            .any(|entry| entry.store_id == store_id)
        {
            return Err(NookError::Database(format!(
                "Vault {store_id} is not registered on this device."
            )));
        }
        NookDatabase::clear_pending_new_local_vault().await?;
        NookDatabase::set_active_vault_id(store_id).await
    }
}

impl NookDatabase {
    pub(crate) async fn import_vault_blob(
        request: ImportVaultBlobRequest<'_>,
    ) -> Result<String, NookError> {
        let ImportVaultBlobRequest { content, label } = request;
        let store_id = NookDatabase::store_id_from_yaml(content)?;
        NookDatabase::save_vault_blob(SaveVaultBlobRequest {
            store_id: &store_id,
            content: content,
        })
        .await?;
        let label = match label {
            ImportVaultLabel::FromDocument => NookDatabase::label_from_yaml(content)?,
            ImportVaultLabel::Override(label) => VaultName::Named(label.to_owned()),
        };
        if let VaultName::Named(label) = label {
            let mut registry = NookDatabase::load_vault_registry().await?;
            NookDatabase::upsert_registry_entry(UpsertRegistryEntryRequest {
                registry: &mut registry,
                store_id: &store_id,
                label: RegistryLabelUpdate::Set(&label),
                touch_unlock: false,
            });
            NookDatabase::save_vault_registry(&registry).await?;
        }
        Ok(store_id)
    }
}
