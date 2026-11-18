//! Extension-local transfer of encrypted cache entries synthesized during import.

use crate::storage::indexed_db::SeedSecretSearchCatalogRequest;
use crate::{NookDatabase, NookError, TypedOutput};
use nook_core::{
    DeviceId, DevicePublicKey, DeviceSigningPublicKey, EncodedSearchCatalogHint,
    EncryptedSearchCatalogBucket, EventGraphDeviceAccess, EventGraphDeviceAccessRequest, EventId,
    ImportedSearchCatalogRow, ImportedSearchCatalogRows, SECRET_SEARCH_CATALOG_BUCKET_COUNT,
    SearchCatalogBucketPayload, SearchCatalogHintContext, SearchCatalogHintSignRequest,
    SecretSearchCatalog, SignedSearchCatalogHint, StoreId, SymmetricKey, VaultType,
};
use serde::{Deserialize, Deserializer, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

use super::NookVaultManager;

#[derive(Clone, Default, Deserialize, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum NookEncryptedSearchCatalogHint {
    #[default]
    Absent,
    Sealed {
        encoded: EncodedSearchCatalogHint,
    },
}

impl NookEncryptedSearchCatalogHint {
    // An invalid optional cache never prevents admission of canonical events.
    fn deserialize_advisory<'de, D: Deserializer<'de>>(value: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(value)?;
        Ok(serde_json::from_value(value).unwrap_or_default())
    }
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NookExtensionLocalEventLogUpdate {
    pub(in crate::manager) vault_store_id: StoreId,
    pub(in crate::manager) device_id: DeviceId,
    pub(in crate::manager) device_public_key: DevicePublicKey,
    pub(in crate::manager) device_signing_public_key: DeviceSigningPublicKey,
    #[serde(
        default,
        deserialize_with = "NookEncryptedSearchCatalogHint::deserialize_advisory"
    )]
    pub(in crate::manager) catalog_hint: NookEncryptedSearchCatalogHint,
}

impl NookVaultManager {
    pub(in crate::manager) async fn create_imported_search_catalog_hint(
        &mut self,
        import: ImportedSearchCatalogHintSource,
    ) {
        self.vault.encrypted_search_catalog_hint = NookEncryptedSearchCatalogHint::Absent;
        if !self.application.is_simple() || self.vault.architecture.vault_type != VaultType::Simple
        {
            return;
        }
        match self.prepare_imported_search_catalog_hint(import).await {
            Ok(hint) => self.vault.encrypted_search_catalog_hint = hint,
            Err(_) => {
                tracing::warn!(
                    scope = "wasm-search",
                    action = "prepare-catalog-hint",
                    "could not prepare encrypted catalog hint"
                );
            }
        }
    }

    async fn prepare_imported_search_catalog_hint(
        &mut self,
        import: ImportedSearchCatalogHintSource,
    ) -> Result<NookEncryptedSearchCatalogHint, NookError> {
        let store_id = StoreId::parse(&self.vault.store_id)?;
        let store = NookDatabase::load_local_event_store(store_id.as_str()).await?;
        let graph = store.load_graph(store_id.as_str())?;
        if graph.heads() != [import.committed_event] {
            return Ok(NookEncryptedSearchCatalogHint::Absent);
        }
        let key = SymmetricKey::parse(&self.vault.secrets_key)?;
        let sparse = SecretSearchCatalog::from_imported_rows(ImportedSearchCatalogRows {
            rows: import.rows,
            live: &self.vault.meta.secrets,
            integrity_key: &key,
        })?;
        let crypto = self.vault.crypto.get()?;
        let mut buckets = Vec::new();
        // The signed envelope carries a single event frontier and fixed-size
        // identifiers. Reserve space for its JSON framing and for each bucket key.
        const ENVELOPE_OVERHEAD_BYTES: usize = 512;
        const BUCKET_OVERHEAD_BYTES: usize = 64;
        let mut remaining = EncodedSearchCatalogHint::MAX_BYTES - ENVELOPE_OVERHEAD_BYTES;
        for index in 0..SECRET_SEARCH_CATALOG_BUCKET_COUNT {
            let bucket = index.into();
            if let SearchCatalogBucketPayload::Json(mut json) = sparse.bucket_json(bucket)? {
                // Base64 armor expands the payload by at least one third.
                if BUCKET_OVERHEAD_BYTES + json.len() + json.len().div_ceil(3) > remaining {
                    json.zeroize();
                    return Ok(NookEncryptedSearchCatalogHint::Absent);
                }
                let ciphertext = crypto.encrypt_value(&json);
                json.zeroize();
                let ciphertext = ciphertext?;
                let armor = ciphertext.as_str();
                let escaped_newlines = armor
                    .bytes()
                    .filter(|byte| matches!(byte, b'\n' | b'\r'))
                    .count();
                let needed = armor.len() + escaped_newlines + BUCKET_OVERHEAD_BYTES;
                if needed > remaining {
                    return Ok(NookEncryptedSearchCatalogHint::Absent);
                }
                remaining -= needed;
                buckets.push(EncryptedSearchCatalogBucket { bucket, ciphertext });
            }
        }
        if buckets.is_empty() {
            return Ok(NookEncryptedSearchCatalogHint::Absent);
        }
        let issuer = self.device_identity()?.app_id().clone();
        let signer = self.ensure_signing_identity().await?;
        let encoded = SignedSearchCatalogHint::sign(SearchCatalogHintSignRequest {
            context: SearchCatalogHintContext {
                store_id: &store_id,
                graph: &graph,
            },
            issuer: &issuer,
            signer: &signer,
            buckets,
        })?;
        Ok(NookEncryptedSearchCatalogHint::Sealed { encoded })
    }

    pub(in crate::manager) async fn seed_extension_search_catalog_hint(
        &self,
        request: NookExtensionLocalEventLogUpdate,
    ) -> Result<(), NookError> {
        let NookEncryptedSearchCatalogHint::Sealed { encoded } = request.catalog_hint else {
            return Ok(());
        };
        if self.vault.store_id != request.vault_store_id.as_str() {
            return Err(NookError::Database(
                "Catalog scope did not match.".to_owned(),
            ));
        }
        let store = NookDatabase::load_local_event_store(request.vault_store_id.as_str()).await?;
        let graph = store.load_graph(request.vault_store_id.as_str())?;
        if !EventGraphDeviceAccess::new(&graph).has_access(&EventGraphDeviceAccessRequest {
            expected_device_id: &request.device_id,
            expected_public_key: &request.device_public_key,
            expected_signing_public_key: &request.device_signing_public_key,
        })? {
            return Err(NookError::Decryption(
                "Catalog grant was not current.".to_owned(),
            ));
        }
        let buckets = SignedSearchCatalogHint::admit(
            &encoded,
            SearchCatalogHintContext {
                store_id: &request.vault_store_id,
                graph: &graph,
            },
        )?;
        NookDatabase::seed_secret_search_catalog_if_empty(SeedSecretSearchCatalogRequest {
            store_id: &request.vault_store_id,
            buckets: &buckets,
        })
        .await
    }

    async fn current_extension_search_catalog_hint(
        &self,
        store_id: &StoreId,
    ) -> Result<NookEncryptedSearchCatalogHint, NookError> {
        if !self.application.is_simple()
            || self.vault.architecture.vault_type != VaultType::Simple
            || self.vault.store_id != store_id.as_str()
            || !self.vault.crypto.is_unlocked()
            || self.device.identity_private_key.is_empty()
        {
            return Ok(NookEncryptedSearchCatalogHint::Absent);
        }
        let NookEncryptedSearchCatalogHint::Sealed { encoded } =
            &self.vault.encrypted_search_catalog_hint
        else {
            return Ok(NookEncryptedSearchCatalogHint::Absent);
        };
        let store = NookDatabase::load_local_event_store(store_id.as_str()).await?;
        let graph = store.load_graph(store_id.as_str())?;
        let context = SearchCatalogHintContext {
            store_id,
            graph: &graph,
        };
        if SignedSearchCatalogHint::admit(encoded, context).is_err() {
            return Ok(NookEncryptedSearchCatalogHint::Absent);
        }
        Ok(NookEncryptedSearchCatalogHint::Sealed {
            encoded: encoded.clone(),
        })
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::VaultCrypto;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    async fn encrypted_catalog_seed_is_atomic_and_preserves_established_buckets()
    -> anyhow::Result<()> {
        let store_id = StoreId::generate()?;
        let crypto = VaultCrypto::new(&SymmetricKey::generate()?)?;
        let first = crypto.encrypt_value("first existing bucket format")?;
        let second = crypto.encrypt_value("second existing bucket format")?;
        let request = |buckets| SeedSecretSearchCatalogRequest {
            store_id: &store_id,
            buckets,
        };
        let invalid = [
            EncryptedSearchCatalogBucket {
                bucket: 1.into(),
                ciphertext: first.clone(),
            },
            EncryptedSearchCatalogBucket {
                bucket: 1.into(),
                ciphertext: second.clone(),
            },
        ];
        assert!(
            NookDatabase::seed_secret_search_catalog_if_empty(request(&invalid))
                .await
                .is_err()
        );
        assert!(
            NookDatabase::load_secret_search_catalog_buckets(store_id.as_str())
                .await?
                .is_empty()
        );

        let initial = [EncryptedSearchCatalogBucket {
            bucket: 1.into(),
            ciphertext: first.clone(),
        }];
        NookDatabase::seed_secret_search_catalog_if_empty(request(&initial)).await?;
        let replacement = [
            EncryptedSearchCatalogBucket {
                bucket: 1.into(),
                ciphertext: second.clone(),
            },
            EncryptedSearchCatalogBucket {
                bucket: 2.into(),
                ciphertext: second,
            },
        ];
        NookDatabase::seed_secret_search_catalog_if_empty(request(&replacement)).await?;
        assert_eq!(
            NookDatabase::load_secret_search_catalog_buckets(store_id.as_str()).await?,
            vec![(1, first.into_inner())],
        );
        Ok(())
    }
}

pub(in crate::manager) struct ImportedSearchCatalogHintSource {
    pub(in crate::manager) committed_event: EventId,
    pub(in crate::manager) rows: Vec<ImportedSearchCatalogRow>,
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn export_extension_search_catalog_hint_js(
        &self,
        expected_store_id: &str,
    ) -> Result<tsify::Ts<NookEncryptedSearchCatalogHint>, JsError> {
        let store_id = StoreId::parse(expected_store_id)?;
        let hint = self
            .current_extension_search_catalog_hint(&store_id)
            .await
            .unwrap_or_default();
        Ok(hint.encode()?)
    }
}
