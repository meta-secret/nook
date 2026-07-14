//! `nook_auth` `IndexedDB` persistence for sync-provider credentials.
//!
//! Owns the full non-network load pipeline (normalize → device-key unseal →
//! legacy `localStorage` seed → field migration → re-persist) and seals
//! credential fields (GitHub PAT, OAuth tokens) with this browser's age device
//! identity so nothing sensitive is stored in plaintext. Pure snapshot
//! transforms live in `nook_core`; this module adds the `IndexedDB` I/O, sealing,
//! and browser storage access.

use nook_core::{
    AuthProvidersSnapshotData, DeviceIdentity, NormalizedAuthSnapshot, open_provider_credentials,
    seal_provider_credentials,
};

use crate::NookError;

const DB_NAME: &str = "nook_auth";
const STORE: &str = "auth";
const STATE_KEY: &str = "providers";
const LEGACY_STORAGE_MODE_KEY: &str = "nook_storage_mode";
const LEGACY_GITHUB_PAT_KEY: &str = "nook_github_pat";

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

fn legacy_local_storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

fn new_id() -> Result<String, NookError> {
    Ok(nook_core::generate_id()?.to_string())
}

fn now_iso() -> String {
    js_sys::Date::new_0().to_iso_string().into()
}

/// Full load pipeline: read, unseal, normalize provider fields, and re-save
/// sealed credentials when anything changed.
pub(crate) async fn load_auth_providers(
    identity: &DeviceIdentity,
) -> Result<NormalizedAuthSnapshot, NookError> {
    let raw = read_raw_snapshot().await?;
    let normalized = nook_core::normalize_auth_snapshot(&raw);
    let mut snapshot = normalized.snapshot;
    let had_plaintext = open_provider_credentials(identity, &mut snapshot)?;

    let mut seeded_legacy = false;
    let legacy_storage = if snapshot.providers.is_empty() {
        legacy_local_storage()
    } else {
        None
    };
    if let Some(storage) = legacy_storage {
        let mode = storage.get_item(LEGACY_STORAGE_MODE_KEY).ok().flatten();
        let pat = storage
            .get_item(LEGACY_GITHUB_PAT_KEY)
            .ok()
            .flatten()
            .unwrap_or_default();
        if let Some(seeded) = nook_core::seed_provider_from_legacy_storage(
            &snapshot,
            mode.as_deref(),
            &pat,
            &new_id()?,
            &now_iso(),
        ) {
            snapshot = seeded;
            seeded_legacy = true;
            let _ = storage.remove_item(LEGACY_STORAGE_MODE_KEY);
            let _ = storage.remove_item(LEGACY_GITHUB_PAT_KEY);
        }
    }

    let (migrated, changed_fields) = nook_core::migrate_provider_fields(&snapshot);
    snapshot = migrated;

    let changed = normalized.changed || had_plaintext || seeded_legacy || changed_fields;
    if changed {
        save_auth_providers(identity, &snapshot).await?;
    }

    Ok(NormalizedAuthSnapshot { snapshot, changed })
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

pub(crate) async fn delete_auth_providers_db() -> Result<(), NookError> {
    rexie::Rexie::delete(DB_NAME)
        .await
        .map_err(|e| idb_err("nook_auth delete error", e))
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod wasm_idb_tests {
    use super::*;
    use nook_core::{OAuthFileConfigData, StorageProviderData};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn github_snapshot(pat: &str) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "gh-wasm".to_owned(),
                provider_type: "github".to_owned(),
                label: "GitHub".to_owned(),
                github_pat: Some(pat.to_owned()),
                github_repo: Some("nook".to_owned()),
                oauth_file: None,
                local_folder: None,
                store_id: None,
                last_synced_version: None,
                last_synced_at: None,
                last_sync_revision: None,
                last_common_content_hash: None,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: None,
        }
    }

    async fn clear_auth_snapshot() {
        write_snapshot(&AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: None,
        })
        .await
        .expect("clear auth snapshot");
    }

    #[wasm_bindgen_test]
    async fn save_seals_github_pat_in_indexed_db() {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate().expect("identity");
        let pat = "github_pat_11WASMtestSECRET";
        save_auth_providers(&identity, &github_snapshot(pat))
            .await
            .expect("save");
        let raw = read_raw_snapshot().await.expect("read raw");
        let stored_pat = raw["providers"][0]["githubPat"]
            .as_str()
            .expect("githubPat");
        assert!(nook_core::is_sealed_credential(stored_pat));
        assert!(!stored_pat.contains("WASMtestSECRET"));
    }

    #[wasm_bindgen_test]
    async fn load_decrypts_sealed_github_pat() {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate().expect("identity");
        let pat = "github_pat_22LOADroundTRIP";
        save_auth_providers(&identity, &github_snapshot(pat))
            .await
            .expect("save");
        let loaded = load_auth_providers(&identity).await.expect("load");
        assert_eq!(
            loaded.snapshot.providers[0].github_pat.as_deref(),
            Some(pat)
        );
    }

    #[wasm_bindgen_test]
    async fn load_upgrades_legacy_plaintext_to_sealed_storage() {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate().expect("identity");
        let pat = "github_pat_33LEGACYplain";
        write_snapshot(&github_snapshot(pat))
            .await
            .expect("write plaintext");
        let loaded = load_auth_providers(&identity).await.expect("load");
        assert_eq!(
            loaded.snapshot.providers[0].github_pat.as_deref(),
            Some(pat)
        );
        let raw = read_raw_snapshot().await.expect("read raw");
        let stored_pat = raw["providers"][0]["githubPat"]
            .as_str()
            .expect("githubPat");
        assert!(nook_core::is_sealed_credential(stored_pat));
        assert!(!stored_pat.contains("LEGACYplain"));
    }

    #[wasm_bindgen_test]
    async fn save_seals_oauth_tokens_in_indexed_db() {
        clear_auth_snapshot().await;
        let identity = DeviceIdentity::generate().expect("identity");
        let access = "ya29.wasm-oauth-access";
        let refresh = "1//wasm-refresh-secret";
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "gd-wasm".to_owned(),
                provider_type: "oauth-file".to_owned(),
                label: "Google Drive".to_owned(),
                github_pat: None,
                github_repo: None,
                oauth_file: Some(OAuthFileConfigData {
                    preset: "google-drive".to_owned(),
                    access_token: access.to_owned(),
                    refresh_token: Some(refresh.to_owned()),
                    expires_at: None,
                    file_id: None,
                    file_name: Some("nook-events".to_owned()),
                    account_email: None,
                    drive_mode: Some(nook_core::GoogleDriveMode::Private),
                    folder_id: None,
                }),
                local_folder: None,
                store_id: None,
                last_synced_version: None,
                last_synced_at: None,
                last_sync_revision: None,
                last_common_content_hash: None,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: None,
        };
        save_auth_providers(&identity, &snapshot)
            .await
            .expect("save");
        let raw = read_raw_snapshot().await.expect("read raw");
        let oauth = &raw["providers"][0]["oauthFile"];
        let stored_access = oauth["accessToken"].as_str().expect("accessToken");
        let stored_refresh = oauth["refreshToken"].as_str().expect("refreshToken");
        assert!(nook_core::is_sealed_credential(stored_access));
        assert!(nook_core::is_sealed_credential(stored_refresh));
        assert!(!stored_access.contains(access));
        assert!(!stored_refresh.contains(refresh));

        let loaded = load_auth_providers(&identity).await.expect("load");
        let loaded_oauth = loaded.snapshot.providers[0]
            .oauth_file
            .as_ref()
            .expect("oauth");
        assert_eq!(loaded_oauth.access_token, access);
        assert_eq!(loaded_oauth.refresh_token.as_deref(), Some(refresh));
    }
}
