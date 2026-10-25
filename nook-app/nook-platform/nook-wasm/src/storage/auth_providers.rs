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
pub(crate) use publication::{PresealedProviderSnapshotPublication, ProviderSnapshotPublication};

use rexie::{ObjectStore, Rexie, TransactionMode};
use serde_json::Value;
use std::ops::Deref;

use nook_core::{AuthProvidersSnapshotData, DeviceIdentity, ProviderCredentialRejection};

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
    pub(crate) snapshot: &'a AuthProvidersSnapshotData,
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
    fn decode_stored_snapshot(raw: Value) -> Result<AuthProvidersSnapshotData, NookError> {
        AuthProvidersSnapshotData::from_storage(raw).map_err(|error| {
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
    ) -> Result<AuthProvidersSnapshotData, NookError> {
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
        ActiveVaultScope, ProviderCredentialEncoding, ProviderSyncCheckpoint, ProviderVaultScope,
        StorageProviderType, StoredGithubPat, StoredGithubRepository, StoredGoogleDriveFolder,
        StoredICloudShareTarget, StoredLocalFolderConfiguration, StoredOAuthAccessCredential,
        StoredOAuthAccountIdentity, StoredOAuthFileConfiguration, StoredOAuthRefreshCredential,
        StoredOAuthRemoteFileId, StoredOAuthRemoteFileName, StoredOAuthTokenExpiry,
    };

    use super::*;
    use nook_core::{OAuthFileConfigData, OauthFilePreset, StorageProviderData};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

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

    fn github_oauth_snapshot(
        github_pat: &str,
        access_token: &str,
        refresh_token: &str,
    ) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![
                StorageProviderData::github(
                    "gh-wasm",
                    "GitHub",
                    github_pat,
                    "nook",
                    "2026-06-24T00:00:00.000Z",
                ),
                StorageProviderData {
                    id: "gd-wasm".to_owned(),
                    provider_type: StorageProviderType::OauthFile,
                    label: "Google Drive".to_owned(),
                    github_pat: StoredGithubPat::Missing,
                    github_repo: StoredGithubRepository::DefaultRepository,
                    oauth_file: StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                        preset: OauthFilePreset::GoogleDrive,
                        access_token: StoredOAuthAccessCredential::AccessToken(
                            access_token.to_owned(),
                        ),
                        refresh_token: StoredOAuthRefreshCredential::Token(
                            refresh_token.to_owned(),
                        ),
                        expires_at: StoredOAuthTokenExpiry::Unknown,
                        file_id: StoredOAuthRemoteFileId::Unresolved,
                        file_name: StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
                        account_email: StoredOAuthAccountIdentity::Unknown,
                        folder_id: StoredGoogleDriveFolder::FolderId("vault-folder".to_owned()),
                        icloud_share_target: StoredICloudShareTarget::Unbound,
                    }),
                    local_folder: StoredLocalFolderConfiguration::NotApplicable,
                    store_id: ProviderVaultScope::Unscoped,
                    sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                    created_at: "2026-06-24T00:00:00.000Z".to_owned(),
                },
            ],
            active_vault_store_id: ActiveVaultScope::Unselected,
        }
    }

    #[wasm_bindgen_test]
    async fn save_seals_github_pat_in_indexed_db() -> anyhow::Result<()> {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_11WASMtestSECRET";
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &github_snapshot(pat),
        }
        .save()
        .await?;
        let raw = AuthProviderDatabase::read_raw_snapshot_at(
            &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
        )
        .await?;
        let stored = AuthProviderDatabase::decode_stored_snapshot(raw)?;
        let StoredGithubPat::Token(stored_pat) = &stored.providers[0].github_pat else {
            anyhow::bail!("sealed githubPat missing from snapshot");
        };
        assert_eq!(
            ProviderCredentialEncoding::observe(stored_pat),
            ProviderCredentialEncoding::ArmorMarked
        );
        assert!(!stored_pat.contains("WASMtestSECRET"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn load_decrypts_sealed_github_pat() -> anyhow::Result<()> {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_22LOADroundTRIP";
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &github_snapshot(pat),
        }
        .save()
        .await?;
        let loaded = AuthProviderDatabase::load_auth_providers(&identity).await?;
        assert_eq!(
            loaded.providers[0].github_pat,
            StoredGithubPat::Token(pat.to_owned())
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn provider_snapshots_are_scoped_to_their_local_app_keys() -> anyhow::Result<()> {
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        ProviderSnapshotPublication {
            identity: &first,
            snapshot: &github_snapshot("github_pat_first"),
        }
        .save()
        .await?;
        ProviderSnapshotPublication {
            identity: &second,
            snapshot: &github_snapshot("github_pat_second"),
        }
        .save()
        .await?;

        assert_eq!(
            AuthProviderDatabase::load_auth_providers(&first)
                .await?
                .providers[0]
                .github_pat,
            StoredGithubPat::Token("github_pat_first".to_owned())
        );
        assert_eq!(
            AuthProviderDatabase::load_auth_providers(&second)
                .await?
                .providers[0]
                .github_pat,
            StoredGithubPat::Token("github_pat_second".to_owned())
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
            snapshot: &github_snapshot("github_pat_33PLAINTEXT"),
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
        let refresh = "1//wasm-refresh-secret";
        let snapshot = github_oauth_snapshot(github_pat, access, refresh);
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &snapshot,
        }
        .save()
        .await?;
        let raw = AuthProviderDatabase::read_raw_snapshot_at(
            &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
        )
        .await?;
        let raw_github_pat = &raw["providers"][0]["githubPat"];
        assert_eq!(raw_github_pat["state"], "token");
        let stored_github_pat = raw_github_pat["value"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("githubPat value should be a string"))?;
        assert_eq!(
            ProviderCredentialEncoding::observe(stored_github_pat),
            ProviderCredentialEncoding::ArmorMarked
        );
        assert!(!stored_github_pat.contains(github_pat));

        let raw_oauth_config = &raw["providers"][1]["oauthFile"]["config"];
        for (field, plaintext) in [("accessToken", access), ("refreshToken", refresh)] {
            let sealed = raw_oauth_config[field]["value"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("{field} value should be a string"))?;
            assert_eq!(
                ProviderCredentialEncoding::observe(sealed),
                ProviderCredentialEncoding::ArmorMarked
            );
            assert!(!sealed.contains(plaintext));
        }

        let loaded = AuthProviderDatabase::load_auth_providers(&identity).await?;
        let StoredOAuthFileConfiguration::Configured(loaded_oauth) =
            &loaded.providers[1].oauth_file
        else {
            anyhow::bail!("loaded oauth_file configuration missing");
        };
        assert_eq!(
            loaded_oauth.access_token,
            StoredOAuthAccessCredential::AccessToken(access.to_owned())
        );
        assert_eq!(
            loaded_oauth.refresh_token,
            StoredOAuthRefreshCredential::Token(refresh.to_owned())
        );
        Ok(())
    }
}
