#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::session::SessionCatalogAvailability;
use super::{
    NookError, NookVaultManager, SearchCatalogRestore, SearchCatalogState, Zeroize, wasm_bindgen,
};
use crate::storage::indexed_db::SecretSearchBucketMutation;
use crate::{NookDatabase, SaveSecretSearchCatalogBucketsRequest};
use nook_core::{
    AgeArmoredCiphertext, SearchCatalogBucketPayload, SecretSearchCatalog, SymmetricKey,
};

impl SearchCatalogRestore {
    fn restore(buckets: Vec<(u8, String)>, crypto: &nook_core::VaultCrypto) -> Self {
        let mut catalog = SecretSearchCatalog::default();
        for (bucket, ciphertext) in buckets {
            let result = AgeArmoredCiphertext::parse(&ciphertext)
                .map_err(NookError::from)
                .and_then(|ciphertext| {
                    let mut plaintext = crypto.decrypt_value(&ciphertext)?;
                    let result = catalog.restore_bucket_json(bucket.into(), plaintext.as_str());
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
                return Self::Rebuild;
            }
        }
        Self::Restored(catalog)
    }

    async fn load(store_id: &str, crypto: &nook_core::VaultCrypto) -> Self {
        match NookDatabase::load_secret_search_catalog_buckets(store_id).await {
            Ok(buckets) => Self::restore(buckets, crypto),
            Err(error) => {
                tracing::warn!(
                    scope = "wasm-search",
                    action = "load-catalog",
                    reason = %error,
                    "encrypted secret search catalog is unavailable; rebuilding in memory"
                );
                Self::Rebuild
            }
        }
    }
}

struct PreparedSearchCatalogWrite<'a> {
    store_id: &'a str,
    pending_mask: u64,
    writes: Vec<SecretSearchBucketMutation>,
}

impl<'a> PreparedSearchCatalogWrite<'a> {
    fn prepare(
        store_id: &'a str,
        catalog: &nook_core::SecretSearchCatalog,
        crypto: &nook_core::VaultCrypto,
        pending_mask: u64,
    ) -> Result<Self, NookError> {
        let mut writes = Vec::new();
        for bucket in 0..nook_core::SECRET_SEARCH_CATALOG_BUCKET_COUNT {
            if pending_mask & (1_u64 << bucket) == 0 {
                continue;
            }
            let mutation = match catalog.bucket_json(bucket.into())? {
                SearchCatalogBucketPayload::Json(mut json) => {
                    let ciphertext = crypto.encrypt_value(&json)?;
                    json.zeroize();
                    SecretSearchBucketMutation::Write {
                        bucket,
                        ciphertext: ciphertext.as_str().to_owned(),
                    }
                }
                SearchCatalogBucketPayload::Empty => SecretSearchBucketMutation::Delete { bucket },
            };
            writes.push(mutation);
        }
        Ok(Self {
            store_id,
            pending_mask,
            writes,
        })
    }

    async fn persist(self, pending_mask: &mut u64) -> Result<(), NookError> {
        NookDatabase::save_secret_search_catalog_buckets(SaveSecretSearchCatalogBucketsRequest {
            store_id: self.store_id,
            writes: &self.writes,
        })
        .await?;
        *pending_mask &= !self.pending_mask;
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    pub(in crate::manager) async fn purge_legacy_plaintext_search_catalog(
        &self,
    ) -> Result<(), NookError> {
        if self.vault.store_id.is_empty() {
            return Ok(());
        }
        NookDatabase::delete_legacy_secret_search_catalog(&self.vault.store_id).await
    }

    pub(crate) async fn prepare_secret_search_catalog(&mut self) -> Result<(), NookError> {
        if self.vault.store_id.is_empty() {
            return Err(NookError::Database(
                "Vault store id is unavailable for search.".to_owned(),
            ));
        }
        let store_id = self.vault.store_id.clone();
        if matches!(
            self.vault.catalog_availability(),
            SessionCatalogAvailability::Restore
        ) {
            let crypto = self.vault.crypto.get()?;
            let restored = SearchCatalogRestore::load(&store_id, crypto).await;
            self.vault.search_catalog = match restored {
                SearchCatalogRestore::Restored(catalog) => SearchCatalogState::Ready(catalog),
                SearchCatalogRestore::Rebuild => {
                    SearchCatalogState::Ready(SecretSearchCatalog::default())
                }
            };
            self.vault.search_catalog_store_id.clone_from(&store_id);
            self.vault.search_catalog_dirty = true;
        }

        if self.vault.search_catalog_dirty {
            let crypto = self.vault.crypto.get()?;
            let integrity_key = SymmetricKey::parse(&self.vault.secrets_key)?;
            let outcome = self.vault.search_catalog.get_mut()?.reconcile(
                &self.vault.meta.secrets,
                crypto,
                &integrity_key,
            )?;
            self.vault.search_catalog_dirty = false;
            for bucket in outcome.changed_buckets() {
                let bucket = u8::from(bucket);
                self.vault.search_catalog_pending_bucket_mask |= 1_u64 << bucket;
            }
            tracing::info!(
                scope = "wasm-search",
                action = "reconcile-catalog",
                added = usize::from(outcome.added),
                updated = usize::from(outcome.updated),
                removed = usize::from(outcome.removed),
                count = self.vault.meta.secrets.len(),
                "in-memory secret search catalog reconciled"
            );
        }

        let pending_mask = self.vault.search_catalog_pending_bucket_mask;
        if pending_mask != 0 {
            let crypto = self.vault.crypto.get()?;
            let catalog = self.vault.search_catalog.get()?;
            let prepared =
                PreparedSearchCatalogWrite::prepare(&store_id, catalog, crypto, pending_mask)?;
            if let Err(error) = prepared
                .persist(&mut self.vault.search_catalog_pending_bucket_mask)
                .await
            {
                tracing::warn!(
                    scope = "wasm-search",
                    action = "save-catalog",
                    reason = %error,
                    "encrypted secret search catalog could not be cached; continuing in memory"
                );
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manager::VaultCryptoState;
    use nook_core::VaultCrypto;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct CatalogFixture {
        catalog: SecretSearchCatalog,
        crypto: VaultCrypto,
    }

    impl CatalogFixture {
        fn new() -> anyhow::Result<Self> {
            let key = SymmetricKey::parse(&"ab".repeat(32))?;
            Ok(Self {
                catalog: SecretSearchCatalog::default(),
                crypto: VaultCrypto::new(&key)?,
            })
        }

        fn prepare<'a>(
            &self,
            store_id: &'a str,
            mask: u64,
        ) -> Result<PreparedSearchCatalogWrite<'a>, NookError> {
            PreparedSearchCatalogWrite::prepare(store_id, &self.catalog, &self.crypto, mask)
        }
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn preparation_selects_only_pending_empty_bucket_deletions() -> anyhow::Result<()> {
        let fixture = CatalogFixture::new()?;
        let prepared = fixture.prepare("store_catalogtest", (1 << 1) | (1 << 3))?;
        assert_eq!(prepared.store_id, "store_catalogtest");
        assert_eq!(prepared.pending_mask, (1 << 1) | (1 << 3));
        assert!(matches!(
            prepared.writes.as_slice(),
            [
                SecretSearchBucketMutation::Delete { bucket: 1 },
                SecretSearchBucketMutation::Delete { bucket: 3 }
            ]
        ));
        assert!(fixture.prepare("store_catalogtest", 0)?.writes.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn malformed_ciphertext_and_bucket_json_require_rebuild() -> anyhow::Result<()> {
        let fixture = CatalogFixture::new()?;
        assert!(matches!(
            SearchCatalogRestore::restore(Vec::new(), &fixture.crypto),
            SearchCatalogRestore::Restored(_)
        ));
        let malformed_json = fixture.crypto.encrypt_value("invalid bucket json")?;
        for ciphertext in [
            "invalid ciphertext".to_owned(),
            malformed_json.as_str().to_owned(),
        ] {
            assert!(matches!(
                SearchCatalogRestore::restore(vec![(0, ciphertext)], &fixture.crypto),
                SearchCatalogRestore::Rebuild
            ));
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn persistence_deletes_captured_buckets_and_retains_unrelated_pending_bits()
    -> anyhow::Result<()> {
        let fixture = CatalogFixture::new()?;
        let store_id = nook_core::StoreId::generate()?;
        let ciphertext = fixture.crypto.encrypt_value("{}")?.as_str().to_owned();
        NookDatabase::save_secret_search_catalog_buckets(SaveSecretSearchCatalogBucketsRequest {
            store_id: store_id.as_str(),
            writes: &[
                SecretSearchBucketMutation::Write {
                    bucket: 1,
                    ciphertext: ciphertext.clone(),
                },
                SecretSearchBucketMutation::Write {
                    bucket: 3,
                    ciphertext: ciphertext.clone(),
                },
                SecretSearchBucketMutation::Write {
                    bucket: 5,
                    ciphertext: ciphertext.clone(),
                },
            ],
        })
        .await?;
        let prepared = fixture.prepare(store_id.as_str(), (1 << 1) | (1 << 3))?;
        let mut pending = (1 << 1) | (1 << 3) | (1 << 5);
        prepared.persist(&mut pending).await?;
        assert_eq!(pending, 1 << 5);
        assert_eq!(
            NookDatabase::load_secret_search_catalog_buckets(store_id.as_str()).await?,
            vec![(5, ciphertext)]
        );
        NookDatabase::save_secret_search_catalog_buckets(SaveSecretSearchCatalogBucketsRequest {
            store_id: store_id.as_str(),
            writes: &[SecretSearchBucketMutation::Delete { bucket: 5 }],
        })
        .await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn manager_catalog_guards_rebuild_invalid_cache_and_purge_legacy_data()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        assert!(manager.prepare_secret_search_catalog().await.is_err());

        let keys = nook_core::VaultKeys::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        manager.vault.store_id = store_id.to_string();
        manager.vault.secrets_key = keys.secrets_key.as_str().to_owned();
        manager.vault.crypto = VaultCryptoState::Unlocked(VaultCrypto::new(&keys.secrets_key)?);
        NookDatabase::save_secret_search_catalog_buckets(SaveSecretSearchCatalogBucketsRequest {
            store_id: store_id.as_str(),
            writes: &[SecretSearchBucketMutation::Write {
                bucket: 0,
                ciphertext: "not-encrypted".to_owned(),
            }],
        })
        .await?;

        manager.prepare_secret_search_catalog().await?;
        assert!(manager.vault.search_catalog.is_ready());
        assert_eq!(manager.vault.search_catalog_pending_bucket_mask, 0);
        manager.purge_legacy_plaintext_search_catalog().await?;

        NookDatabase::save_secret_search_catalog_buckets(SaveSecretSearchCatalogBucketsRequest {
            store_id: store_id.as_str(),
            writes: &[SecretSearchBucketMutation::Delete { bucket: 0 }],
        })
        .await?;
        Ok(())
    }
}
