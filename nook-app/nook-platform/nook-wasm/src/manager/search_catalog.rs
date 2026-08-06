use super::{
    NookError, NookVaultManager, SearchCatalogRestore, SearchCatalogState, Zeroize, wasm_bindgen,
};

fn restore_secret_search_catalog(
    buckets: Vec<(u8, String)>,
    crypto: &nook_core::VaultCrypto,
) -> SearchCatalogRestore {
    let mut catalog = nook_core::SecretSearchCatalog::default();
    for (bucket, ciphertext) in buckets {
        let result = nook_core::AgeArmoredCiphertext::parse(&ciphertext)
            .map_err(NookError::from)
            .and_then(|ciphertext| {
                let mut plaintext = crypto.decrypt_value(&ciphertext)?;
                let result = catalog.restore_bucket_json(bucket, plaintext.as_str());
                plaintext.zeroize_plaintext();
                result.map_err(NookError::from)
            });
        if let Err(error) = result {
            tracing::warn!(
                scope = "wasm-search",
                action = "discard-catalog",
                reason = %error,
                "discarding an invalid encrypted secret search catalog"
            );
            return SearchCatalogRestore::Rebuild;
        }
    }
    SearchCatalogRestore::Restored(catalog)
}

async fn load_encrypted_secret_search_catalog(
    store_id: &str,
    crypto: &nook_core::VaultCrypto,
) -> SearchCatalogRestore {
    match crate::storage::indexed_db::load_secret_search_catalog_buckets(store_id).await {
        Ok(buckets) => restore_secret_search_catalog(buckets, crypto),
        Err(error) => {
            tracing::warn!(
                scope = "wasm-search",
                action = "load-catalog",
                reason = %error,
                "encrypted secret search catalog is unavailable; rebuilding in memory"
            );
            SearchCatalogRestore::Rebuild
        }
    }
}

fn encrypt_secret_search_catalog_buckets(
    catalog: &nook_core::SecretSearchCatalog,
    crypto: &nook_core::VaultCrypto,
    pending_mask: u64,
) -> Result<Vec<(u8, Option<String>)>, NookError> {
    let mut writes = Vec::new();
    for bucket in 0..nook_core::SECRET_SEARCH_CATALOG_BUCKET_COUNT {
        if pending_mask & (1_u64 << bucket) == 0 {
            continue;
        }
        let ciphertext = match catalog.bucket_json(bucket)? {
            nook_core::SearchCatalogBucketPayload::Json(mut json) => {
                let ciphertext = crypto.encrypt_value(&json)?;
                json.zeroize();
                Some(ciphertext.as_str().to_owned())
            }
            nook_core::SearchCatalogBucketPayload::Empty => None,
        };
        writes.push((bucket, ciphertext));
    }
    Ok(writes)
}

#[wasm_bindgen]
impl NookVaultManager {
    pub(in crate::manager) async fn purge_legacy_plaintext_search_catalog(
        &self,
    ) -> Result<(), NookError> {
        if self.vault.store_id.is_empty() {
            return Ok(());
        }
        crate::storage::indexed_db::delete_legacy_secret_search_catalog(&self.vault.store_id).await
    }

    pub(crate) async fn prepare_secret_search_catalog(&mut self) -> Result<(), NookError> {
        if self.vault.store_id.is_empty() {
            return Err(NookError::Database(
                "Vault store id is unavailable for search.".to_owned(),
            ));
        }
        let store_id = self.vault.store_id.clone();
        if self.vault.search_catalog_store_id != store_id || !self.vault.search_catalog.is_ready() {
            let crypto = self.vault.crypto.get()?;
            let restored = load_encrypted_secret_search_catalog(&store_id, crypto).await;
            self.vault.search_catalog = match restored {
                SearchCatalogRestore::Restored(catalog) => SearchCatalogState::Ready(catalog),
                SearchCatalogRestore::Rebuild => {
                    SearchCatalogState::Ready(nook_core::SecretSearchCatalog::default())
                }
            };
            self.vault.search_catalog_store_id.clone_from(&store_id);
            self.vault.search_catalog_dirty = true;
        }

        if self.vault.search_catalog_dirty {
            let crypto = self.vault.crypto.get()?;
            let integrity_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
            let outcome = self.vault.search_catalog.get_mut()?.reconcile(
                &self.vault.meta.secrets,
                crypto,
                &integrity_key,
            )?;
            self.vault.search_catalog_dirty = false;
            for bucket in outcome.changed_buckets() {
                self.vault.search_catalog_pending_bucket_mask |= 1_u64 << bucket;
            }
            tracing::info!(
                scope = "wasm-search",
                action = "reconcile-catalog",
                added = outcome.added,
                updated = outcome.updated,
                removed = outcome.removed,
                count = self.vault.meta.secrets.len(),
                "in-memory secret search catalog reconciled"
            );
        }

        let pending_mask = self.vault.search_catalog_pending_bucket_mask;
        if pending_mask != 0 {
            let crypto = self.vault.crypto.get()?;
            let catalog = self.vault.search_catalog.get()?;
            let writes = encrypt_secret_search_catalog_buckets(catalog, crypto, pending_mask)?;
            if let Err(error) =
                crate::storage::indexed_db::save_secret_search_catalog_buckets(&store_id, &writes)
                    .await
            {
                tracing::warn!(
                    scope = "wasm-search",
                    action = "save-catalog",
                    reason = %error,
                    "encrypted secret search catalog could not be cached; continuing in memory"
                );
            } else {
                self.vault.search_catalog_pending_bucket_mask &= !pending_mask;
            }
        }
        Ok(())
    }
}
