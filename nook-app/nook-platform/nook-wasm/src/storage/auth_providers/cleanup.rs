//! Lifecycle operations for identity-scoped provider snapshots in `nook_auth`.

use super::{AuthProviderDatabase, DB_NAME, NookError, STORE};
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
        let key = AuthProviderDatabase::state_key_for_app_id(app_id);
        store
            .delete(serde_wasm_bindgen::to_value(&key).map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth scoped delete key error", e))
            })?)
            .await
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth scoped delete error", e))
            })?;
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
    use super::super::{ProviderDbWriteSnapshotAt, ProviderSnapshotPublication};
    use super::*;
    use nook_core::{
        ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity, StorageProviderData,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

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

    #[wasm_bindgen_test]
    async fn retiring_an_app_key_removes_only_its_providers() -> anyhow::Result<()> {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let retired = DeviceIdentity::generate()?;
        let kept = DeviceIdentity::generate()?;
        ProviderSnapshotPublication {
            identity: &retired,
            snapshot: &github_snapshot("github_pat_retired"),
        }
        .save()
        .await?;
        let sealed = github_snapshot("github_pat_kept")
            .seal_credentials(&kept)
            .map_err(|rejection| rejection.into_cause())?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(kept.app_id()),
            snapshot: &sealed,
        })
        .await?;

        AuthProviderDatabase::delete_auth_providers_for_app_id(retired.app_id()).await?;

        assert!(
            AuthProviderDatabase::read_raw_snapshot_at(
                &AuthProviderDatabase::state_key_for_app_id(retired.app_id())
            )
            .await?
            .is_null()
        );
        assert_eq!(
            AuthProviderDatabase::load_auth_providers(&kept)
                .await?
                .providers
                .len(),
            1
        );
        AuthProviderDatabase::clear_auth_providers_db().await?;
        Ok(())
    }
}
