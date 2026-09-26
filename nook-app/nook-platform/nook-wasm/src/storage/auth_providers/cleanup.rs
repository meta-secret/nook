//! Lifecycle operations for identity-scoped provider snapshots in `nook_auth`.

use super::{
    AuthProviderDatabase, DB_NAME, NookError, ProviderDbReadRawSnapshotFromStore, SCHEMA_KEY,
    STATE_KEY, STORE,
};
use rexie::{Rexie, TransactionMode};

impl AuthProviderDatabase {
    pub(crate) async fn delete_auth_providers_for_app_id(
        app_id: &nook_core::AppId,
    ) -> Result<(), NookError> {
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!(
                    "{}: {:?}",
                    "nook_auth scoped delete transaction error", e
                ))
            })?;
        let store = transaction.store(STORE).map_err(|e| {
            NookError::IndexedDb(format!(
                "{}: {:?}",
                "nook_auth scoped delete store error", e
            ))
        })?;
        let state_key = AuthProviderDatabase::state_key_for_app_id(app_id);
        let scoped = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: &state_key,
            },
        )
        .await?;
        let legacy = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: STATE_KEY,
            },
        )
        .await?;
        let scoped = super::rollback_projection::ProviderSnapshotObservation::from(scoped);
        let legacy = super::rollback_projection::ProviderSnapshotObservation::from(legacy);
        if AuthProviderDatabase::projections_match(super::ProviderDbProjectionsMatch {
            scoped: &scoped,
            legacy: &legacy,
        }) == super::rollback_projection::ProviderProjectionRelation::Equivalent
        {
            for key in [STATE_KEY, SCHEMA_KEY] {
                store
                    .delete(serde_wasm_bindgen::to_value(key).map_err(|e| {
                        NookError::IndexedDb(format!(
                            "{}: {:?}",
                            "nook_auth rollback delete key error", e
                        ))
                    })?)
                    .await
                    .map_err(|e| {
                        NookError::IndexedDb(format!(
                            "{}: {:?}",
                            "nook_auth rollback delete error", e
                        ))
                    })?;
            }
        }
        for key in [
            state_key,
            AuthProviderDatabase::schema_key_for_app_id(app_id),
        ] {
            store
                .delete(serde_wasm_bindgen::to_value(&key).map_err(|e| {
                    NookError::IndexedDb(format!(
                        "{}: {:?}",
                        "nook_auth scoped delete key error", e
                    ))
                })?)
                .await
                .map_err(|e| {
                    NookError::IndexedDb(format!("{}: {:?}", "nook_auth scoped delete error", e))
                })?;
        }
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!(
                "{}: {:?}",
                "nook_auth scoped delete completion error", e
            ))
        })?;
        Ok(())
    }
}

impl AuthProviderDatabase {
    pub(crate) async fn delete_auth_providers_db() -> Result<(), NookError> {
        Rexie::delete(DB_NAME)
            .await
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth delete error", e)))
    }
}

impl AuthProviderDatabase {
    pub(crate) async fn clear_auth_providers_db() -> Result<(), NookError> {
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth clear transaction error", e))
            })?;
        transaction
            .store(STORE)
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth clear store error", e))
            })?
            .clear()
            .await
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth clear error", e)))?;
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!("{}: {:?}", "nook_auth clear completion error", e))
        })?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub mod tests {
    use super::super::ProviderDbWriteSnapshotAt;
    use super::*;
    use nook_core::{
        ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity, StorageProviderData,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    struct ProviderSnapshotCleanupFixture;

    impl ProviderSnapshotCleanupFixture {
        fn github_snapshot(pat: &str) -> AuthProvidersSnapshotData {
            AuthProvidersSnapshotData {
                providers: vec![StorageProviderData::github(
                    "gh-wasm",
                    "GitHub",
                    pat,
                    "nook",
                    "2026-06-24T00:00:00.000Z",
                )],
                active_vault_store_id: ActiveVaultScope::Unselected,
            }
        }
    }

    #[wasm_bindgen_test]
    async fn retiring_identity_removes_only_its_matching_rollback_projection() -> anyhow::Result<()>
    {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let mut owned = ProviderSnapshotCleanupFixture::github_snapshot("github_pat_owned");
        owned = owned
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
            schema_key: &AuthProviderDatabase::schema_key_for_app_id(identity.app_id()),
            snapshot: &owned,
        })
        .await?;
        AuthProviderDatabase::write_snapshot(&owned).await?;

        AuthProviderDatabase::delete_auth_providers_for_app_id(identity.app_id()).await?;

        assert!(AuthProviderDatabase::read_raw_snapshot().await?.is_null());
        assert!(
            AuthProviderDatabase::read_raw_snapshot_at(
                &AuthProviderDatabase::state_key_for_app_id(identity.app_id())
            )
            .await?
            .is_null()
        );

        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
            schema_key: &AuthProviderDatabase::schema_key_for_app_id(identity.app_id()),
            snapshot: &owned,
        })
        .await?;
        let mut competing = ProviderSnapshotCleanupFixture::github_snapshot("github_pat_competing");
        competing = competing
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        AuthProviderDatabase::write_snapshot(&competing).await?;

        AuthProviderDatabase::delete_auth_providers_for_app_id(identity.app_id()).await?;

        assert!(!AuthProviderDatabase::read_raw_snapshot().await?.is_null());
        AuthProviderDatabase::clear_auth_providers_db().await?;
        Ok(())
    }
}
