#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Destructive identity and device recovery persistence.
use crate::IdentityDbWriteIdentityDirectory;
use crate::KeyringDbWriteKeyring;
use crate::storage::indexed_db::StoredStringRecord;
use crate::storage::{device_access, event_db, identity_record, indexed_db};
use crate::{IdbPutStringRequest, NookDatabase};
use crate::{NookError, storage};
use identity_record::{
    IdentityReconciliationStore, LEGACY_IDENTITY_RECORD_KEY, RETIRED_APP_IDS_KEY,
};
use identity_record::{keyring, simple_genesis};
use rexie::Rexie;
use rexie::{Store, Transaction, TransactionMode};
use std::rc::Rc;
mod cleanup;
mod planning;
pub(crate) use cleanup::{LocalIdentityRecovery, PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY};
use planning::{RecoveryPlanning, RecoveryState};
pub(crate) struct LocalIdentityRecoveryRequest {
    pub(crate) expected_app_id: Option<nook_core::AppId>,
}
struct RecoveryMarkerPolicy {
    clear_simple_genesis: bool,
    clear_sentinel_genesis: bool,
}
struct RecoveryMarkers<'a> {
    store: &'a Store,
}
struct RecoveryMarkerKey<'a> {
    key: &'a str,
    context: &'a str,
}
struct RecoveryDeletion {
    reconciliation_keys: Vec<String>,
    access_profile_keys: Vec<String>,
    marker_policy: RecoveryMarkerPolicy,
    clear_compatibility_profile: bool,
}
/// Only admitted transaction-local selections can be persisted. Neither dropping
/// this state nor a pending future adds cleanup or rollback behavior.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::identity_record::recovery::PreparedLocalIdentityRecovery;
/// ```
struct PreparedLocalIdentityRecovery {
    _connection: Rc<Rexie>,
    transaction: Transaction,
    store: Store,
    state: RecoveryState,
    marker_policy: RecoveryMarkerPolicy,
    reconciliation_keys: Vec<String>,
}
impl RecoveryMarkers<'_> {
    async fn reconciliation_keys(&self) -> Result<Vec<String>, NookError> {
        let store = self.store;

        Ok(store
            .get_all_keys(None, None)
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Identity reset key enumeration error: {error:?}"))
            })?
            .into_iter()
            .filter_map(|value| serde_wasm_bindgen::from_value::<String>(value).ok())
            .filter(|key| IdentityReconciliationStore::matches_key(key))
            .collect())
    }
    async fn exists(&self, input: &RecoveryMarkerKey<'_>) -> Result<bool, NookError> {
        let store = self.store;
        let RecoveryMarkerKey { key, context } = *input;
        let key = serde_wasm_bindgen::to_value(key)
            .map_err(|error| NookError::IndexedDb(format!("{context} key error: {error:?}")))?;
        Ok(store
            .get(key)
            .await
            .map_err(|error| NookError::IndexedDb(format!("{context} read error: {error:?}")))?
            .is_some_and(|value| !value.is_undefined() && !value.is_null()))
    }
    async fn policy(&self, state: &RecoveryState) -> Result<RecoveryMarkerPolicy, NookError> {
        let store = self.store;
        let has_pending_simple = self
            .exists(&RecoveryMarkerKey {
                key: simple_genesis::PENDING_SIMPLE_GENESIS_KEY,
                context: "Pending Simple genesis",
            })
            .await?;
        let clear_simple_genesis = if !has_pending_simple {
            false
        } else if state.keyring.entries().is_empty() {
            // Full recovery must remain available even when the genesis marker is
            // legacy, corrupt, or future-incompatible. No local identity survives
            // to own it, so clearing the marker is the only safe outcome.
            true
        } else {
            match NookDatabase::load_pending_genesis(store).await? {
                None => false,
                Some(pending)
                    if state.retired_identity_id.as_ref() == Some(&pending.identity_id) =>
                {
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
        let sentinel_pending = self
            .exists(&RecoveryMarkerKey {
                key: indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY,
                context: "Pending Sentinel genesis",
            })
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
}
impl RecoveryState {
    async fn write(&self, store: &Store) -> Result<(), NookError> {
        let state = self;
        NookDatabase::write_identity_directory(IdentityDbWriteIdentityDirectory {
            store: store,
            directory: &state.directory,
        })
        .await?;
        NookDatabase::write_keyring(KeyringDbWriteKeyring {
            store: store,
            keyring: &state.keyring,
        })
        .await?;
        let retired =
            serde_json::to_string(state.directory.retired_app_ids()).map_err(|error| {
                NookError::IndexedDb(format!("Retired app IDs encode error: {error}"))
            })?;
        let retired = serde_wasm_bindgen::to_value(&retired).map_err(|error| {
            NookError::IndexedDb(format!("Retired app IDs value error: {error:?}"))
        })?;
        let retired_key = serde_wasm_bindgen::to_value(RETIRED_APP_IDS_KEY).map_err(|error| {
            NookError::IndexedDb(format!("Retired app IDs key error: {error:?}"))
        })?;
        store
            .put(&retired, Some(&retired_key))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Retired app IDs write error: {error:?}"))
            })?;
        Ok(())
    }
}
impl RecoveryDeletion {
    fn keys(self) -> Vec<String> {
        let Self {
            reconciliation_keys,
            access_profile_keys,
            marker_policy,
            clear_compatibility_profile,
        } = self;
        let mut keys = reconciliation_keys;
        keys.extend([
            LEGACY_IDENTITY_RECORD_KEY.to_owned(),
            indexed_db::APP_KEY_WRAPPED_KEY.to_owned(),
            indexed_db::APP_ID_KEY.to_owned(),
            indexed_db::WRAPPED_DEVICE_IDENTITY_KEY.to_owned(),
            indexed_db::DEVICE_ID_KEY.to_owned(),
            event_db::SIGNING_SEED_KEY.to_owned(),
        ]);
        if clear_compatibility_profile {
            keys.push(device_access::DEVICE_ACCESS_PROFILE_KEY.to_owned());
        }
        if marker_policy.clear_simple_genesis {
            keys.push(simple_genesis::PENDING_SIMPLE_GENESIS_KEY.to_owned());
        }
        if marker_policy.clear_sentinel_genesis {
            keys.push(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY.to_owned());
        }
        keys.extend(access_profile_keys);
        keys
    }
    async fn delete(self, store: &Store) -> Result<(), NookError> {
        let keys = self.keys();
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
}
impl LocalIdentityRecoveryRequest {
    pub(crate) async fn execute(self) -> Result<LocalIdentityRecovery, NookError> {
        let expected_app_id = self.expected_app_id;
        // Best-effort legacy migration preserves known reconciliation keys. A
        // corrupt or future-incompatible directory must never block destructive
        // device recovery.
        let _ = NookDatabase::load_identity_directory().await;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["vault"], TransactionMode::ReadWrite)
            .map_err(|error| NookError::IndexedDb(format!("Identity reset error: {error:?}")))?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Identity reset store error: {error:?}"))
        })?;
        if let Some(recovery) = LocalIdentityRecovery::load_pending(&store).await? {
            // The identity transaction has already committed. Resume its recorded
            // cleanup target even after reload, when the retired app ID is no
            // longer available to the UI and another surviving identity is selected.
            transaction.done().await.map_err(|error| {
                NookError::IndexedDb(format!("Identity reset resume error: {error:?}"))
            })?;
            return Ok(recovery);
        }
        let state = RecoveryPlanning {
            store: &store,
            expected_app_id: expected_app_id.as_ref(),
        }
        .prepare()
        .await?;
        let markers = RecoveryMarkers { store: &store };
        let marker_policy = markers.policy(&state).await?;
        let reconciliation_keys = if state.clear_reconciliation {
            markers.reconciliation_keys().await?
        } else {
            Vec::new()
        };
        PreparedLocalIdentityRecovery {
            _connection: rexie,
            transaction,
            store,
            state,
            marker_policy,
            reconciliation_keys,
        }
        .persist()
        .await
    }
}
impl PreparedLocalIdentityRecovery {
    async fn persist(self) -> Result<LocalIdentityRecovery, NookError> {
        let Self {
            _connection,
            transaction,
            store,
            state,
            marker_policy,
            reconciliation_keys,
        } = self;
        let recovery = LocalIdentityRecovery {
            retired_app_id: state.retired_app_id.clone(),
            has_remaining_local_identities: !state.keyring.entries().is_empty(),
        };
        state.write(&store).await?;
        RecoveryDeletion {
            reconciliation_keys,
            access_profile_keys: state.access_profile_keys,
            marker_policy,
            clear_compatibility_profile: state.clear_reconciliation,
        }
        .delete(&store)
        .await?;
        recovery.write_pending(&store).await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Identity reset completion error: {error:?}"))
        })?;
        Ok(recovery)
    }
}

#[cfg(test)]
mod tests {
    use super::{RecoveryDeletion, RecoveryMarkerPolicy};
    use crate::storage::{device_access, event_db, identity_record, indexed_db};
    use identity_record::simple_genesis;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn scoped_deletion_preserves_shared_profiles_and_genesis_markers() {
        let keys = RecoveryDeletion {
            reconciliation_keys: Vec::new(),
            access_profile_keys: vec!["selected-access-profile".to_owned()],
            marker_policy: RecoveryMarkerPolicy {
                clear_simple_genesis: false,
                clear_sentinel_genesis: false,
            },
            clear_compatibility_profile: false,
        }
        .keys();
        assert_eq!(
            keys,
            vec![
                identity_record::LEGACY_IDENTITY_RECORD_KEY,
                indexed_db::APP_KEY_WRAPPED_KEY,
                indexed_db::APP_ID_KEY,
                indexed_db::WRAPPED_DEVICE_IDENTITY_KEY,
                indexed_db::DEVICE_ID_KEY,
                event_db::SIGNING_SEED_KEY,
                "selected-access-profile",
            ]
        );
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn full_deletion_keeps_exact_key_order_and_selected_profiles() {
        let keys = RecoveryDeletion {
            reconciliation_keys: vec![
                "pending_identity_reconciliation_v1:fixture".to_owned(),
                "pending_identity_reconciliation_v2:fixture".to_owned(),
            ],
            access_profile_keys: vec![
                "first-access-profile".to_owned(),
                "second-access-profile".to_owned(),
            ],
            marker_policy: RecoveryMarkerPolicy {
                clear_simple_genesis: true,
                clear_sentinel_genesis: true,
            },
            clear_compatibility_profile: true,
        }
        .keys();
        assert_eq!(
            keys,
            vec![
                "pending_identity_reconciliation_v1:fixture",
                "pending_identity_reconciliation_v2:fixture",
                identity_record::LEGACY_IDENTITY_RECORD_KEY,
                indexed_db::APP_KEY_WRAPPED_KEY,
                indexed_db::APP_ID_KEY,
                indexed_db::WRAPPED_DEVICE_IDENTITY_KEY,
                indexed_db::DEVICE_ID_KEY,
                event_db::SIGNING_SEED_KEY,
                device_access::DEVICE_ACCESS_PROFILE_KEY,
                simple_genesis::PENDING_SIMPLE_GENESIS_KEY,
                indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY,
                "first-access-profile",
                "second-access-profile",
            ]
        );
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod browser_tests {
    use super::{
        LocalIdentityRecovery, LocalIdentityRecoveryRequest, PreparedLocalIdentityRecovery,
        RecoveryMarkers, RecoveryPlanning,
    };
    use crate::storage::{event_db, identity_record, indexed_db};
    use crate::{NookError, storage};
    use nook_core::IdentityDirectory;
    use rexie::TransactionMode;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct RecoveryFixture {
        directory: String,
    }
    impl RecoveryFixture {
        fn new() -> Result<Self, NookError> {
            Ok(Self {
                directory: serde_json::to_string(&IdentityDirectory::empty())
                    .map_err(|error| NookError::Serialization(error.to_string()))?,
            })
        }
        async fn install(&self) -> Result<(), NookError> {
            NookDatabase::clear_vault_db().await?;
            NookDatabase::idb_put_string(IdbPutStringRequest {
                key: identity_record::IDENTITY_DIRECTORY_KEY,
                value: &self.directory,
            })
            .await?;
            NookDatabase::idb_put_string(IdbPutStringRequest {
                key: event_db::SIGNING_SEED_KEY,
                value: "retained-until-persistence",
            })
            .await
        }
        async fn prepare(&self) -> Result<PreparedLocalIdentityRecovery, NookError> {
            let connection = NookDatabase::open_nook_database().await?;
            let transaction = connection
                .transaction(&["vault"], TransactionMode::ReadWrite)
                .map_err(|error| {
                    NookError::IndexedDb(format!("Fixture transaction error: {error:?}"))
                })?;
            let store = transaction
                .store("vault")
                .map_err(|error| NookError::IndexedDb(format!("Fixture store error: {error:?}")))?;
            let state = RecoveryPlanning {
                store: &store,
                expected_app_id: None,
            }
            .prepare()
            .await?;
            let markers = RecoveryMarkers { store: &store };
            let marker_policy = markers.policy(&state).await?;
            let reconciliation_keys = markers.reconciliation_keys().await?;
            Ok(PreparedLocalIdentityRecovery {
                _connection: connection,
                transaction,
                store,
                state,
                marker_policy,
                reconciliation_keys,
            })
        }
        async fn assert_unpublished(&self) -> Result<(), NookError> {
            assert_eq!(
                NookDatabase::idb_get_string(identity_record::IDENTITY_DIRECTORY_KEY).await?,
                StoredStringRecord::Stored((self.directory.as_str()).to_owned())
            );
            assert_eq!(
                NookDatabase::idb_get_string(event_db::SIGNING_SEED_KEY).await?,
                StoredStringRecord::Stored(("retained-until-persistence").to_owned())
            );
            assert!(!LocalIdentityRecovery::has_pending().await?);
            Ok(())
        }
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn preparation_and_unpolled_persistence_do_not_publish_cleanup() -> Result<(), NookError>
    {
        let fixture = RecoveryFixture::new()?;
        fixture.install().await?;
        {
            let _prepared = fixture.prepare().await?;
        }
        fixture.assert_unpublished().await?;
        {
            let _persistence = fixture.prepare().await?.persist();
        }
        fixture.assert_unpublished().await?;
        let completed = fixture.prepare().await?.persist().await?;
        assert!(!completed.has_remaining_local_identities);
        assert!(LocalIdentityRecovery::has_pending().await?);
        assert!(matches!(
            NookDatabase::idb_get_string(event_db::SIGNING_SEED_KEY).await?,
            StoredStringRecord::MissingKey
        ));
        let resumed = LocalIdentityRecoveryRequest {
            expected_app_id: None,
        }
        .execute()
        .await?;
        assert_eq!(resumed, completed);
        completed.complete().await?;
        NookDatabase::clear_vault_db().await
    }
}
