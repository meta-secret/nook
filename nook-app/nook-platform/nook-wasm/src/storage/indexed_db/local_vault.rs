use super::{
    ACTIVE_VAULT_KEY, Date, IsoTimestamp, NookError, PENDING_NEW_LOCAL_VAULT_KEY, TransactionMode,
    VAULT_REGISTRY_KEY, VaultName, VaultRegistry, VaultRegistryEntry, VaultStoreIdentity,
    idb_delete_key, idb_get_string, idb_put_string, open_nook_database, secret_search_bucket_key,
    secret_search_key, vault_blob_key, vault_cache_key,
};

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

pub(crate) fn label_from_yaml(content: &str) -> Option<String> {
    match nook_core::VaultFormatDocument::new(content).name() {
        Ok(VaultName::Named(name)) => Some(name),
        Ok(VaultName::Unnamed) | Err(_) => None,
    }
}

pub(crate) fn default_registry_label(store_id: &str) -> String {
    nook_core::VaultStoreIdentity::default_name_for_store_id(store_id)
}

pub(crate) async fn load_vault_registry() -> Result<VaultRegistry, NookError> {
    let raw = idb_get_string(VAULT_REGISTRY_KEY).await?;
    let Some(json) = raw else {
        return Ok(VaultRegistry::default());
    };
    let mut registry: VaultRegistry = serde_json::from_str(&json)
        .map_err(|e| NookError::IndexedDb(format!("Vault registry parse error: {e}")))?;
    for entry in &mut registry.vaults {
        if entry.label.trim().is_empty() {
            entry.label = default_registry_label(&entry.store_id);
        }
    }
    Ok(registry)
}

async fn save_vault_registry(registry: &VaultRegistry) -> Result<(), NookError> {
    let json = serde_json::to_string(registry)
        .map_err(|e| NookError::IndexedDb(format!("Vault registry serialize error: {e}")))?;
    idb_put_string(VAULT_REGISTRY_KEY, &json).await
}

pub(crate) async fn get_active_vault_id() -> Result<Option<String>, NookError> {
    idb_get_string(ACTIVE_VAULT_KEY).await
}

pub(crate) async fn set_active_vault_id(store_id: &str) -> Result<(), NookError> {
    idb_put_string(ACTIVE_VAULT_KEY, store_id).await
}

pub(crate) async fn clear_active_vault_id() -> Result<(), NookError> {
    idb_delete_key(ACTIVE_VAULT_KEY).await
}

async fn is_pending_new_local_vault() -> Result<bool, NookError> {
    Ok(idb_get_string(PENDING_NEW_LOCAL_VAULT_KEY).await?.is_some())
}

pub(crate) async fn prepare_new_local_vault_slot() -> Result<(), NookError> {
    idb_put_string(PENDING_NEW_LOCAL_VAULT_KEY, "1").await
}

async fn clear_pending_new_local_vault() -> Result<(), NookError> {
    idb_delete_key(PENDING_NEW_LOCAL_VAULT_KEY).await
}

pub(crate) fn upsert_registry_entry(
    registry: &mut VaultRegistry,
    store_id: &str,
    label: Option<&str>,
    touch_unlock: bool,
) {
    let now = if touch_unlock {
        Some(chrono_lite_now())
    } else {
        None
    };
    if let Some(entry) = registry
        .vaults
        .iter_mut()
        .find(|entry| entry.store_id == store_id)
    {
        if let Some(text) = label {
            entry.label = text.to_owned();
        }
        if touch_unlock {
            entry.last_unlocked_at = now;
        }
        return;
    }
    registry.vaults.push(VaultRegistryEntry {
        store_id: store_id.to_owned(),
        label: label.map_or_else(|| default_registry_label(store_id), str::to_owned),
        last_unlocked_at: now,
    });
}

fn chrono_lite_now() -> nook_core::IsoTimestamp {
    IsoTimestamp::from_trusted(Date::new_0().to_iso_string().into())
}

pub(crate) async fn list_vault_registry_entries() -> Result<Vec<VaultRegistryEntry>, NookError> {
    Ok(load_vault_registry().await?.vaults)
}

pub(crate) async fn load_vault_blob(store_id: &str) -> Result<Option<String>, NookError> {
    idb_get_string(&vault_blob_key(store_id)).await
}

pub(crate) async fn save_vault_blob(store_id: &str, content: &str) -> Result<(), NookError> {
    idb_put_string(&vault_blob_key(store_id), content).await?;
    let mut registry = load_vault_registry().await?;
    upsert_registry_entry(&mut registry, store_id, None, true);
    save_vault_registry(&registry).await?;
    set_active_vault_id(store_id).await?;
    clear_pending_new_local_vault().await
}

pub(crate) async fn delete_legacy_secret_search_catalog(store_id: &str) -> Result<(), NookError> {
    idb_delete_key(&secret_search_key(store_id)).await
}

pub(crate) async fn load_secret_search_catalog_buckets(
    store_id: &str,
) -> Result<Vec<(u8, String)>, NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    let mut buckets = Vec::new();
    for bucket in 0..nook_core::SECRET_SEARCH_CATALOG_BUCKET_COUNT {
        let key = secret_search_bucket_key(store_id, bucket);
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

pub(crate) async fn save_secret_search_catalog_buckets(
    store_id: &str,
    writes: &[(u8, Option<String>)],
) -> Result<(), NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(&["vault"], TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {e:?}")))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {e:?}")))?;
    for (bucket, ciphertext) in writes {
        if *bucket >= nook_core::SECRET_SEARCH_CATALOG_BUCKET_COUNT {
            return Err(NookError::IndexedDb(format!(
                "Secret search bucket {bucket} is out of range."
            )));
        }
        let key = secret_search_bucket_key(store_id, *bucket);
        let id_key = serde_wasm_bindgen::to_value(&key)
            .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
        if let Some(ciphertext) = ciphertext {
            let value = serde_wasm_bindgen::to_value(ciphertext)
                .map_err(|e| NookError::IndexedDb(format!("Serialization error: {e:?}")))?;
            store
                .put(&value, Some(&id_key))
                .await
                .map_err(|e| NookError::IndexedDb(format!("Put error: {e:?}")))?;
        } else {
            store
                .delete(id_key)
                .await
                .map_err(|e| NookError::IndexedDb(format!("Delete error: {e:?}")))?;
        }
    }
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {e:?}")))?;
    Ok(())
}

pub(crate) async fn load_from_indexed_db() -> Result<Option<String>, NookError> {
    if is_pending_new_local_vault().await? {
        return Ok(None);
    }

    let active = get_active_vault_id().await?;
    let Some(store_id) = active.filter(|id| !id.trim().is_empty()) else {
        return Ok(None);
    };
    load_vault_blob(&store_id).await
}

pub(crate) async fn load_vault_local_cache(cache_ref: &str) -> Result<Option<String>, NookError> {
    idb_get_string(&vault_cache_key(cache_ref)).await
}

pub(crate) async fn save_to_indexed_db(content: &str) -> Result<(), NookError> {
    if content.trim().is_empty() {
        return Err(NookError::Database(
            "Refusing to persist empty vault blob.".to_owned(),
        ));
    }
    let store_id = store_id_from_yaml(content)?;
    save_vault_blob(&store_id, content).await
}

pub(crate) async fn set_local_vault_label(store_id: &str, label: &str) -> Result<(), NookError> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err(NookError::Database(
            "Vault label cannot be empty.".to_owned(),
        ));
    }
    let mut registry = load_vault_registry().await?;
    if !registry
        .vaults
        .iter()
        .any(|entry| entry.store_id == store_id)
    {
        return Err(NookError::Database(format!(
            "Vault {store_id} is not registered on this device."
        )));
    }
    upsert_registry_entry(&mut registry, store_id, Some(trimmed), false);
    save_vault_registry(&registry).await?;
    if let Some(content) = load_vault_blob(store_id).await? {
        let named = nook_core::VaultFormatDocument::new(&content).rename(trimmed)?;
        idb_put_string(&vault_blob_key(store_id), named.as_str()).await?;
    }
    Ok(())
}

pub(crate) async fn switch_active_vault(store_id: &str) -> Result<(), NookError> {
    let registry = load_vault_registry().await?;
    if !registry
        .vaults
        .iter()
        .any(|entry| entry.store_id == store_id)
    {
        return Err(NookError::Database(format!(
            "Vault {store_id} is not registered on this device."
        )));
    }
    clear_pending_new_local_vault().await?;
    set_active_vault_id(store_id).await
}

pub(crate) async fn import_vault_blob(
    content: &str,
    label: Option<&str>,
) -> Result<String, NookError> {
    let store_id = store_id_from_yaml(content)?;
    save_vault_blob(&store_id, content).await?;
    let yaml_label = label_from_yaml(content);
    let label = label.or(yaml_label.as_deref());
    if let Some(label) = label {
        let mut registry = load_vault_registry().await?;
        upsert_registry_entry(&mut registry, &store_id, Some(label), false);
        save_vault_registry(&registry).await?;
    }
    Ok(store_id)
}
