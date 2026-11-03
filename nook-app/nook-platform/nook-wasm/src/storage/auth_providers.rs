//! `nook_auth` `IndexedDB` persistence for sync-provider credentials.
//!
//! Each app key keeps its own provider snapshot. Credential fields (GitHub
//! PAT, OAuth tokens) are sealed with this browser's age device identity so
//! nothing sensitive is stored in plaintext. Pure snapshot transforms live in
//! `nook_core`; this module adds the `IndexedDB` I/O and sealing.

mod cleanup;
mod publication;
use crate::NookError;
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use publication::ProviderSnapshotStore;
pub(crate) use publication::{
    PresealedProviderMerge, PresealedProviderSnapshotPublication, ProviderSnapshotPublication,
};

use rexie::{ObjectStore, Rexie, TransactionMode};
use serde_json::Value;
use std::ops::Deref;

use nook_core::{AuthProvidersSnapshot, DeviceIdentity, ProviderCredentialRejection};

pub(crate) struct AuthProviderDatabase {
    connection: Rexie,
}
impl Deref for AuthProviderDatabase {
    type Target = Rexie;
    fn deref(&self) -> &Rexie {
        &self.connection
    }
}
const DB_NAME: &str = "nook_auth";
const STORE: &str = "auth";
const STATE_KEY: &str = "providers";

/// Named values required by `AuthProviderDatabase::read_raw_snapshot_from_store`.
pub(crate) struct ProviderDbReadRawSnapshotFromStore<'a> {
    pub(crate) store: &'a rexie::Store,
    pub(crate) state_key: &'a str,
}

/// Named values required by `AuthProviderDatabase::write_snapshot_at`.
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) struct ProviderDbWriteSnapshotAt<'a> {
    pub(crate) state_key: &'a str,
    pub(crate) snapshot: &'a AuthProvidersSnapshot,
}

impl AuthProviderDatabase {
    fn state_key_for_app_id(app_id: &nook_core::AppId) -> String {
        format!("{STATE_KEY}:{app_id}")
    }
}

impl AuthProviderDatabase {
    async fn open_auth_db() -> Result<AuthProviderDatabase, NookError> {
        Rexie::builder(DB_NAME)
            .version(1)
            .add_object_store(ObjectStore::new(STORE))
            .build()
            .await
            .map(|connection| AuthProviderDatabase { connection })
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth build error", e)))
    }
}

impl AuthProviderDatabase {
    async fn read_raw_snapshot_from_store(
        request: ProviderDbReadRawSnapshotFromStore<'_>,
    ) -> Result<serde_json::Value, NookError> {
        let ProviderDbReadRawSnapshotFromStore { store, state_key } = request;
        let key = serde_wasm_bindgen::to_value(state_key)
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth key error", e)))?;
        let value = store
            .get(key)
            .await
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth get error", e)))?;
        match value {
            None => Ok(Value::Null),
            Some(value) if value.is_undefined() || value.is_null() => Ok(Value::Null),
            Some(value) => serde_wasm_bindgen::from_value(value)
                .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth parse error", e))),
        }
    }

    /// Decode a stored snapshot; anything but the current shape is rejected.
    fn decode_stored_snapshot(raw: Value) -> Result<AuthProvidersSnapshot, NookError> {
        AuthProvidersSnapshot::from_storage(raw).map_err(|error| {
            NookError::Serialization(format!("Stored sync providers are unreadable: {error}"))
        })
    }
}

/// Read the raw persisted snapshot object as JSON (`Null` when absent).
impl AuthProviderDatabase {
    async fn read_raw_snapshot_at(state_key: &str) -> Result<serde_json::Value, NookError> {
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadOnly)
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth transaction error", e))
            })?;
        let store = transaction
            .store(STORE)
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth store error", e)))?;
        let value = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key,
            },
        )
        .await?;
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!("{}: {:?}", "nook_auth transaction done error", e))
        })?;
        Ok(value)
    }
}

/// Store a snapshot verbatim, bypassing credential sealing (test fixtures).
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
impl AuthProviderDatabase {
    async fn write_snapshot_at(request: ProviderDbWriteSnapshotAt<'_>) -> Result<(), NookError> {
        let ProviderDbWriteSnapshotAt {
            state_key,
            snapshot,
        } = request;
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth transaction error", e))
            })?;
        let store = transaction
            .store(STORE)
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth store error", e)))?;
        ProviderSnapshotStore {
            store: &store,
            state_key,
        }
        .write(snapshot)
        .await?;
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!("{}: {:?}", "nook_auth transaction done error", e))
        })?;
        Ok(())
    }
}

/// Full load pipeline: read, decode, and unseal this app key's providers.
impl AuthProviderDatabase {
    pub(crate) async fn load_auth_providers(
        identity: &DeviceIdentity,
    ) -> Result<AuthProvidersSnapshot, NookError> {
        let state_key = AuthProviderDatabase::state_key_for_app_id(identity.app_id());
        let raw = AuthProviderDatabase::read_raw_snapshot_at(&state_key).await?;
        Ok(AuthProviderDatabase::decode_stored_snapshot(raw)?
            .open_credentials(identity)
            .map_err(ProviderCredentialRejection::into_cause)?)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod wasm_idb_tests {
    use nook_core::{
        ActiveVaultScope, GoogleDriveAuthorization, GoogleDriveFolderId, GoogleDriveProvider,
        IsoTimestamp, OAuthAccountIdentity, OAuthFileProvider, ProviderCredentialEncoding,
        ProviderVaultScope, StorageProvider, StoredProvider,
    };

    use super::*;
    use crate::test_fixtures::WasmFixture;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn github_snapshot(pat: &str) -> anyhow::Result<AuthProvidersSnapshot> {
        Ok(AuthProvidersSnapshot {
            providers: vec![WasmFixture::github_row("gh-wasm", pat, "nook")?],
            active_vault_store_id: ActiveVaultScope::Unselected,
        })
    }

    fn github_drive_snapshot(
        github_pat: &str,
        access_token: &str,
    ) -> anyhow::Result<AuthProvidersSnapshot> {
        let drive = StorageProvider::never_synced(
            "gd-wasm".to_owned(),
            ProviderVaultScope::Unscoped,
            "2026-06-24T00:00:00.000Z".to_owned(),
            StoredProvider::OauthFile(OAuthFileProvider::GoogleDrive(GoogleDriveProvider {
                authorization: GoogleDriveAuthorization {
                    access_token: WasmFixture::secret(access_token)?,
                    expires_at: IsoTimestamp::parse("2030-01-01T00:00:00Z")?,
                },
                account: OAuthAccountIdentity::Unknown,
                folder_id: GoogleDriveFolderId::parse("vault-folder")?,
            })),
        );
        Ok(AuthProvidersSnapshot {
            providers: vec![
                WasmFixture::github_row("gh-wasm", github_pat, "nook")?,
                drive,
            ],
            active_vault_store_id: ActiveVaultScope::Unselected,
        })
    }

    #[wasm_bindgen_test]
    async fn save_seals_github_pat_in_indexed_db() -> anyhow::Result<()> {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_11WASMtestSECRET";
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &github_snapshot(pat)?,
        }
        .save()
        .await?;
        let raw = AuthProviderDatabase::read_raw_snapshot_at(
            &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
        )
        .await?;
        let stored = AuthProviderDatabase::decode_stored_snapshot(raw)?;
        let stored_pat = WasmFixture::first_github_token(&stored)?;
        assert_eq!(
            ProviderCredentialEncoding::observe(stored_pat),
            ProviderCredentialEncoding::ArmorMarked
        );
        assert!(!stored_pat.expose().contains("WASMtestSECRET"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn load_decrypts_sealed_github_pat() -> anyhow::Result<()> {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_22LOADroundTRIP";
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &github_snapshot(pat)?,
        }
        .save()
        .await?;
        let loaded = AuthProviderDatabase::load_auth_providers(&identity).await?;
        assert_eq!(WasmFixture::first_github_token(&loaded)?.expose(), pat);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn provider_snapshots_are_scoped_to_their_local_app_keys() -> anyhow::Result<()> {
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        ProviderSnapshotPublication {
            identity: &first,
            snapshot: &github_snapshot("github_pat_first")?,
        }
        .save()
        .await?;
        ProviderSnapshotPublication {
            identity: &second,
            snapshot: &github_snapshot("github_pat_second")?,
        }
        .save()
        .await?;

        assert_eq!(
            WasmFixture::first_github_token(
                &AuthProviderDatabase::load_auth_providers(&first).await?
            )?
            .expose(),
            "github_pat_first"
        );
        assert_eq!(
            WasmFixture::first_github_token(
                &AuthProviderDatabase::load_auth_providers(&second).await?
            )?
            .expose(),
            "github_pat_second"
        );
        assert_ne!(
            AuthProviderDatabase::state_key_for_app_id(first.app_id()),
            AuthProviderDatabase::state_key_for_app_id(second.app_id())
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn load_rejects_plaintext_and_unreadable_snapshots() -> anyhow::Result<()> {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
            snapshot: &github_snapshot("github_pat_33PLAINTEXT")?,
        })
        .await?;
        assert!(
            AuthProviderDatabase::load_auth_providers(&identity)
                .await
                .is_err()
        );
        assert!(
            AuthProviderDatabase::decode_stored_snapshot(serde_json::json!({"providers": 1}))
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn save_seals_oauth_tokens_in_indexed_db() -> anyhow::Result<()> {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let github_pat = "github_pat_44WASMgithubSECRET";
        let access = "ya29.wasm-oauth-access";
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &github_drive_snapshot(github_pat, access)?,
        }
        .save()
        .await?;
        let raw = AuthProviderDatabase::read_raw_snapshot_at(
            &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
        )
        .await?;
        for (pointer, plaintext) in [
            ("/providers/0/provider/token", github_pat),
            ("/providers/1/provider/authorization/accessToken", access),
        ] {
            let sealed = raw
                .pointer(pointer)
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("{pointer} should be a string"))?;
            assert_eq!(
                ProviderCredentialEncoding::observe(&WasmFixture::secret(sealed)?),
                ProviderCredentialEncoding::ArmorMarked
            );
            assert!(!sealed.contains(plaintext));
        }

        let loaded = AuthProviderDatabase::load_auth_providers(&identity).await?;
        let [_, drive] = loaded.providers.as_slice() else {
            anyhow::bail!("the loaded snapshot should hold both rows");
        };
        let StoredProvider::OauthFile(OAuthFileProvider::GoogleDrive(drive)) = &drive.provider
        else {
            anyhow::bail!("the second row should be a Google Drive row");
        };
        assert_eq!(drive.authorization.access_token.expose(), access);
        Ok(())
    }
}
