//! Identity transition admission before protected publication.
use super::*;
pub(in super::super) struct IdentityTransitionAdmission<'a> {
    pub(in super::super) store: &'a Store,
}
impl IdentityTransitionAdmission<'_> {
    pub(in super::super) async fn check(self) -> Result<(), NookError> {
        let simple_pending = NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
            store: self.store,
            key: PENDING_SIMPLE_GENESIS_KEY,
            context: "Pending Simple genesis",
        })
        .await?;
        let sentinel_pending = NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
            store: self.store,
            key: indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY,
            context: "Pending Sentinel genesis",
        })
        .await?;
        let recovery_cleanup_pending =
            NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
                store: self.store,
                key: recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
                context: "Pending identity recovery cleanup",
            })
            .await?;
        if simple_pending.is_some()
            || sentinel_pending.is_some()
            || recovery_cleanup_pending.is_some()
        {
            return Err(NookError::Database(
                "Pending vault creation or recovery cleanup must finish before changing identities"
                    .to_owned(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::identity_record::simple_genesis;
    use rexie::TransactionMode;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn later_marker_read_failure_precedes_pending_rejection() -> Result<(), NookError> {
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: simple_genesis::PENDING_SIMPLE_GENESIS_KEY,
            value: "pending",
        })
        .await?;
        let db = NookDatabase::open_nook_database().await?;
        let transaction = db
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Marker test transaction error: {error:?}"))
            })?;
        let store = transaction
            .store("vault")
            .map_err(|error| NookError::IndexedDb(format!("Marker test store error: {error:?}")))?;
        let key =
            serde_wasm_bindgen::to_value(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY)
                .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        let malformed = serde_wasm_bindgen::to_value(&Vec::<String>::new())
            .map_err(|error| NookError::IndexedDb(error.to_string()))?;
        store
            .put(&malformed, Some(&key))
            .await
            .map_err(|error| NookError::IndexedDb(format!("Marker test write error: {error:?}")))?;
        let result = IdentityTransitionAdmission { store: &store }.check().await;
        assert!(
            matches!(result, Err(NookError::IndexedDb(message)) if message.starts_with("Pending Sentinel genesis value error:"))
        );
        assert_eq!(
            NookDatabase::keyring_read_string(KeyringDbKeyringReadString {
                store: &store,
                key: simple_genesis::PENDING_SIMPLE_GENESIS_KEY,
                context: "Test pending"
            })
            .await?
            .as_deref(),
            Some("pending")
        );
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Marker test completion error: {error:?}"))
        })?;
        NookDatabase::idb_delete_key(simple_genesis::PENDING_SIMPLE_GENESIS_KEY).await?;
        NookDatabase::idb_delete_key(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY).await
    }
}
