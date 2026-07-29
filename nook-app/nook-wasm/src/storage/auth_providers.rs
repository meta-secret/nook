//! `nook_auth` `IndexedDB` persistence for sync-provider credentials.
//!
//! Owns the full non-network load pipeline (normalize → device-key unseal) and seals
//! credential fields (GitHub PAT, OAuth tokens) with this browser's age device
//! identity so nothing sensitive is stored in plaintext. Pure snapshot
//! transforms live in `nook_core`; this module adds the `IndexedDB` I/O and sealing.

use nook_core::{
    AuthProvidersSnapshotData, DeviceIdentity, NormalizedAuthSnapshot, open_provider_credentials,
    provider_credentials_are_presealed, seal_provider_credentials,
};

use crate::NookError;

const DB_NAME: &str = "nook_auth";
const STORE: &str = "auth";
const STATE_KEY: &str = "providers";

fn idb_err(context: &str, error: impl std::fmt::Debug) -> NookError {
    NookError::IndexedDb(format!("{context}: {error:?}"))
}

async fn open_auth_db() -> Result<rexie::Rexie, NookError> {
    rexie::Rexie::builder(DB_NAME)
        .version(1)
        .add_object_store(rexie::ObjectStore::new(STORE))
        .build()
        .await
        .map_err(|e| idb_err("nook_auth build error", e))
}

/// Read the raw persisted snapshot object as JSON (`Null` when absent).
async fn read_raw_snapshot() -> Result<serde_json::Value, NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadOnly)
        .map_err(|e| idb_err("nook_auth transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth store error", e))?;
    let key =
        serde_wasm_bindgen::to_value(STATE_KEY).map_err(|e| idb_err("nook_auth key error", e))?;
    let value = store
        .get(key)
        .await
        .map_err(|e| idb_err("nook_auth get error", e))?;
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth transaction done error", e))?;
    match value {
        None => Ok(serde_json::Value::Null),
        Some(val) if val.is_undefined() || val.is_null() => Ok(serde_json::Value::Null),
        Some(val) => {
            serde_wasm_bindgen::from_value(val).map_err(|e| idb_err("nook_auth parse error", e))
        }
    }
}

/// Persist a snapshot object under the `providers` key (structured-clone object,
/// matching the shape the web layer and e2e seeders read directly).
async fn write_snapshot(snapshot: &AuthProvidersSnapshotData) -> Result<(), NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth store error", e))?;
    let key =
        serde_wasm_bindgen::to_value(STATE_KEY).map_err(|e| idb_err("nook_auth key error", e))?;
    let value = serde_wasm_bindgen::to_value(snapshot)
        .map_err(|e| idb_err("nook_auth serialize error", e))?;
    store
        .put(&value, Some(&key))
        .await
        .map_err(|e| idb_err("nook_auth put error", e))?;
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth transaction done error", e))?;
    Ok(())
}

/// Full load pipeline: read, normalize, and unseal the current provider schema.
pub(crate) async fn load_auth_providers(
    identity: &DeviceIdentity,
) -> Result<NormalizedAuthSnapshot, NookError> {
    let raw = read_raw_snapshot().await?;
    let normalized = nook_core::normalize_auth_snapshot(&raw);
    let mut snapshot = normalized.snapshot;
    open_provider_credentials(identity, &mut snapshot)?;
    Ok(NormalizedAuthSnapshot {
        snapshot,
        changed: normalized.changed,
    })
}

/// Seal credential fields and persist the snapshot.
pub(crate) async fn save_auth_providers(
    identity: &DeviceIdentity,
    snapshot: &AuthProvidersSnapshotData,
) -> Result<(), NookError> {
    let mut sealed = snapshot.clone();
    seal_provider_credentials(identity, &mut sealed)?;
    write_snapshot(&sealed).await
}

/// Persist a snapshot whose credential fields are already age-sealed (or empty).
///
/// Extension pairing uses this when the offscreen device session is locked: the
/// website sealed grants for the extension device public key, so import must not
/// require an unlocked private key just to accept the handoff.
pub(crate) async fn save_presealed_auth_providers(
    snapshot: &AuthProvidersSnapshotData,
) -> Result<(), NookError> {
    if !provider_credentials_are_presealed(snapshot) {
        return Err(NookError::Decryption(
            "Presealed auth-provider save rejected plaintext credentials.".to_owned(),
        ));
    }
    let raw = read_raw_snapshot().await?;
    let existing = nook_core::normalize_auth_snapshot(&raw).snapshot;
    if !provider_credentials_are_presealed(&existing) {
        return Err(NookError::Decryption(
            "auth-provider-credential-must-be-encrypted".to_owned(),
        ));
    }
    let merged = nook_core::replace_active_vault_provider_grants(&existing, snapshot);
    write_snapshot(&merged).await
}

pub(crate) async fn delete_auth_providers_db() -> Result<(), NookError> {
    rexie::Rexie::delete(DB_NAME)
        .await
        .map_err(|e| idb_err("nook_auth delete error", e))
}

pub(crate) async fn clear_auth_providers_db() -> Result<(), NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth clear transaction error", e))?;
    transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth clear store error", e))?
        .clear()
        .await
        .map_err(|e| idb_err("nook_auth clear error", e))?;
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth clear completion error", e))?;
    Ok(())
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod wasm_idb_tests {
    use super::*;
    use nook_core::{ICloudMode, OAuthFileConfigData, OauthFilePreset, StorageProviderData};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn github_snapshot_with_id(id: &str, pat: &str) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData::github(
                id,
                "GitHub",
                pat,
                "nook",
                "2026-06-24T00:00:00.000Z",
            )],
            active_vault_store_id: nook_core::ActiveVaultScope::Unselected,
        }
    }

    fn github_snapshot(pat: &str) -> AuthProvidersSnapshotData {
        github_snapshot_with_id("gh-wasm", pat)
    }

    async fn clear_auth_snapshot() -> anyhow::Result<()> {
        write_snapshot(&AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: nook_core::ActiveVaultScope::Unselected,
        })
        .await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn save_seals_github_pat_in_indexed_db() -> anyhow::Result<()> {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_11WASMtestSECRET";
        save_auth_providers(&identity, &github_snapshot(pat)).await?;
        let raw = read_raw_snapshot().await?;
        let stored_pat = raw["providers"][0]["githubPat"].as_str()?;
        assert!(nook_core::is_sealed_credential(stored_pat));
        assert!(!stored_pat.contains("WASMtestSECRET"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn load_decrypts_sealed_github_pat() -> anyhow::Result<()> {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_22LOADroundTRIP";
        save_auth_providers(&identity, &github_snapshot(pat)).await?;
        let loaded = load_auth_providers(&identity).await?;
        assert_eq!(
            loaded.snapshot.providers[0].github_pat.as_deref(),
            Some(pat)
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn load_rejects_plaintext_credentials() -> anyhow::Result<()> {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_33PLAINTEXT";
        write_snapshot(&github_snapshot(pat)).await?;
        assert!(load_auth_providers(&identity).await.is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn save_seals_oauth_tokens_in_indexed_db() -> anyhow::Result<()> {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate()?;
        let access = "ya29.wasm-oauth-access";
        let refresh = "1//wasm-refresh-secret";
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "gd-wasm".to_owned(),
                provider_type: nook_core::StorageProviderType::OauthFile,
                label: "Google Drive".to_owned(),
                github_pat: nook_core::StoredGithubPat::Missing,
                github_repo: nook_core::StoredGithubRepository::DefaultRepository,
                oauth_file: nook_core::StoredOAuthFileConfiguration::configured(
                    OAuthFileConfigData {
                        preset: OauthFilePreset::GoogleDrive,
                        access_token: nook_core::StoredOAuthAccessCredential::AccessToken(
                            access.to_owned(),
                        ),
                        refresh_token: nook_core::StoredOAuthRefreshCredential::Token(
                            refresh.to_owned(),
                        ),
                        expires_at: nook_core::StoredOAuthTokenExpiry::Unknown,
                        file_id: nook_core::StoredOAuthRemoteFileId::Unresolved,
                        file_name: nook_core::StoredOAuthRemoteFileName::FileName(
                            "nook-events".to_owned(),
                        ),
                        account_email: nook_core::StoredOAuthAccountIdentity::Unknown,
                        drive_mode: nook_core::GoogleDriveMode::Private,
                        folder_id: nook_core::StoredGoogleDriveFolder::Root,
                        icloud_mode: ICloudMode::Private,
                        icloud_share_target: nook_core::StoredICloudShareTarget::Personal,
                    },
                ),
                local_folder: nook_core::StoredLocalFolderConfiguration::NotApplicable,
                store_id: nook_core::ProviderVaultScope::Unscoped,
                sync_checkpoint: nook_core::ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: nook_core::ActiveVaultScope::Unselected,
        };
        save_auth_providers(&identity, &snapshot).await?;
        let raw = read_raw_snapshot().await?;
        let oauth = &raw["providers"][0]["oauthFile"];
        let stored_access = oauth["accessToken"].as_str()?;
        let stored_refresh = oauth["refreshToken"].as_str()?;
        assert!(nook_core::is_sealed_credential(stored_access));
        assert!(nook_core::is_sealed_credential(stored_refresh));
        assert!(!stored_access.contains(access));
        assert!(!stored_refresh.contains(refresh));

        let loaded = load_auth_providers(&identity).await?;
        let loaded_oauth = loaded.snapshot.providers[0].oauth_file.as_ref()?;
        assert_eq!(loaded_oauth.access_token, access);
        assert_eq!(loaded_oauth.refresh_token.as_deref(), Some(refresh));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn presealed_save_replaces_active_vault_and_preserves_other_vaults() -> anyhow::Result<()>
    {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate()?;
        let mut existing = github_snapshot_with_id("gh-removed", "github_pat_existing");
        existing.providers[0].store_id =
            nook_core::ProviderVaultScope::StoreId("store-incoming".to_owned());
        let mut retained = github_snapshot_with_id("gh-retained", "github_pat_retained")
            .providers
            .remove(0);
        retained.store_id = nook_core::ProviderVaultScope::StoreId("store-other".to_owned());
        existing.providers.push(retained);
        existing.active_vault_store_id =
            nook_core::ActiveVaultScope::StoreId("store-incoming".to_owned());
        save_auth_providers(&identity, &existing).await?;

        let mut incoming = github_snapshot_with_id("gh-incoming", "github_pat_incoming");
        incoming.active_vault_store_id =
            nook_core::ActiveVaultScope::StoreId("store-incoming".to_owned());
        seal_provider_credentials(&identity, &mut incoming)?;
        save_presealed_auth_providers(&incoming).await?;

        let raw = read_raw_snapshot().await?;
        let stored = nook_core::normalize_auth_snapshot(&raw).snapshot;
        let mut provider_ids = stored
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<Vec<_>>();
        provider_ids.sort_unstable();
        assert_eq!(provider_ids, vec!["gh-incoming", "gh-retained"]);
        assert_eq!(
            stored.active_vault_store_id.as_deref(),
            Some("store-incoming")
        );
        assert!(provider_credentials_are_presealed(&stored));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn presealed_save_rejects_existing_plaintext_provider_rows() -> anyhow::Result<()> {
        clear_auth_snapshot().await;
        write_snapshot(&github_snapshot_with_id(
            "gh-plaintext",
            "github_pat_plaintext",
        ))
        .await?;

        let identity = DeviceIdentity::generate()?;
        let mut incoming = github_snapshot_with_id("gh-incoming", "github_pat_incoming");
        seal_provider_credentials(&identity, &mut incoming)?;
        let result = save_presealed_auth_providers(&incoming).await;
        assert!(matches!(
            result,
            Err(NookError::Decryption(message))
                if message == "auth-provider-credential-must-be-encrypted"
        ));

        let raw = read_raw_snapshot().await?;
        assert_eq!(
            raw["providers"][0]["githubPat"].as_str(),
            Some("github_pat_plaintext")
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn presealed_empty_save_clears_only_the_incoming_vault() -> anyhow::Result<()> {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate()?;
        let mut existing = github_snapshot_with_id("gh-removed", "github_pat_removed");
        existing.providers[0].store_id =
            nook_core::ProviderVaultScope::StoreId("store-incoming".to_owned());
        let mut retained = github_snapshot_with_id("gh-retained", "github_pat_retained")
            .providers
            .remove(0);
        retained.store_id = nook_core::ProviderVaultScope::StoreId("store-other".to_owned());
        existing.providers.push(retained);
        existing.active_vault_store_id =
            nook_core::ActiveVaultScope::StoreId("store-incoming".to_owned());
        save_auth_providers(&identity, &existing).await?;

        save_presealed_auth_providers(&AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: nook_core::ActiveVaultScope::StoreId(
                "store-incoming".to_owned(),
            ),
        })
        .await?;

        let raw = read_raw_snapshot().await?;
        let stored = nook_core::normalize_auth_snapshot(&raw).snapshot;
        assert_eq!(stored.providers.len(), 1);
        assert_eq!(stored.providers[0].id, "gh-retained");
        assert_eq!(
            stored.active_vault_store_id.as_deref(),
            Some("store-incoming")
        );
        Ok(())
    }
}
