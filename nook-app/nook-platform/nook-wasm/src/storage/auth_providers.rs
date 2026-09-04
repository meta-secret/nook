//! `nook_auth` `IndexedDB` persistence for sync-provider credentials.
//!
//! Owns the full non-network load pipeline (normalize → device-key unseal) and seals
//! credential fields (GitHub PAT, OAuth tokens) with this browser's age device
//! identity so nothing sensitive is stored in plaintext. Pure snapshot
//! transforms live in `nook_core`; this module adds the `IndexedDB` I/O and sealing.

mod rollback_projection;

use rexie::{ObjectStore, Rexie, TransactionMode};
use serde_json::Value;
use serde_wasm_bindgen::Serializer;
use std::fmt;

use nook_core::{
    AuthProvidersSnapshotData, DeviceIdentity, NormalizedAuthSnapshot, open_provider_credentials,
    provider_credentials_are_presealed, seal_provider_credentials,
};
use serde::Serialize;

use crate::NookError;

pub(crate) use rollback_projection::migrate_legacy_auth_providers_for_selected_identity;
use rollback_projection::{
    legacy_snapshot_belongs_to_identity, may_migrate_legacy_snapshot,
    migrate_legacy_auth_providers_for_identity, should_refresh_legacy_projection,
};

const DB_NAME: &str = "nook_auth";
const STORE: &str = "auth";
const STATE_KEY: &str = "providers";
const SCHEMA_KEY: &str = "providers-schema";
const STORAGE_SCHEMA_VERSION: u32 = 1;

fn state_key_for_app_id(app_id: &nook_core::AppId) -> String {
    format!("{STATE_KEY}:{app_id}")
}

fn schema_key_for_app_id(app_id: &nook_core::AppId) -> String {
    format!("{SCHEMA_KEY}:{app_id}")
}

fn idb_err(context: &str, error: impl fmt::Debug) -> NookError {
    NookError::IndexedDb(format!("{context}: {error:?}"))
}

async fn open_auth_db() -> Result<rexie::Rexie, NookError> {
    Rexie::builder(DB_NAME)
        .version(1)
        .add_object_store(ObjectStore::new(STORE))
        .build()
        .await
        .map_err(|e| idb_err("nook_auth build error", e))
}

async fn read_raw_snapshot_from_store(
    store: &rexie::Store,
    state_key: &str,
) -> Result<serde_json::Value, NookError> {
    let key =
        serde_wasm_bindgen::to_value(state_key).map_err(|e| idb_err("nook_auth key error", e))?;
    let value = store
        .get(key)
        .await
        .map_err(|e| idb_err("nook_auth get error", e))?;
    match value {
        None => Ok(Value::Null),
        Some(value) if value.is_undefined() || value.is_null() => Ok(Value::Null),
        Some(value) => {
            serde_wasm_bindgen::from_value(value).map_err(|e| idb_err("nook_auth parse error", e))
        }
    }
}

async fn write_snapshot_to_store(
    store: &rexie::Store,
    state_key: &str,
    schema_key: &str,
    snapshot: &AuthProvidersSnapshotData,
) -> Result<(), NookError> {
    let key =
        serde_wasm_bindgen::to_value(state_key).map_err(|e| idb_err("nook_auth key error", e))?;
    let storage_value = nook_core::auth_snapshot_legacy_storage_value(snapshot)
        .map_err(|e| idb_err("nook_auth compatibility projection error", e))?;
    let value = storage_value
        .serialize(&Serializer::json_compatible())
        .map_err(|e| idb_err("nook_auth serialize error", e))?;
    store
        .put(&value, Some(&key))
        .await
        .map_err(|e| idb_err("nook_auth put error", e))?;
    let schema_key =
        serde_wasm_bindgen::to_value(schema_key).map_err(|e| idb_err("schema key error", e))?;
    let schema_value = serde_wasm_bindgen::to_value(&STORAGE_SCHEMA_VERSION)
        .map_err(|e| idb_err("schema version error", e))?;
    store
        .put(&schema_value, Some(&schema_key))
        .await
        .map_err(|e| idb_err("schema version put error", e))?;
    Ok(())
}

/// Read the raw persisted snapshot object as JSON (`Null` when absent).
async fn read_raw_snapshot_at(state_key: &str) -> Result<serde_json::Value, NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadOnly)
        .map_err(|e| idb_err("nook_auth transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth store error", e))?;
    let value = read_raw_snapshot_from_store(&store, state_key).await?;
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth transaction done error", e))?;
    Ok(value)
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
async fn read_raw_snapshot() -> Result<serde_json::Value, NookError> {
    read_raw_snapshot_at(STATE_KEY).await
}

/// Persist the rollback-safe schema-1 projection under `providers`.
///
/// The semantic Rust enums remain the in-memory contract. The stored projection
/// deliberately retains the original string-or-absent shape so a previous app
/// build can read provider rows after rollback.
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
async fn write_snapshot_at(
    state_key: &str,
    schema_key: &str,
    snapshot: &AuthProvidersSnapshotData,
) -> Result<(), NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth store error", e))?;
    write_snapshot_to_store(&store, state_key, schema_key, snapshot).await?;
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth transaction done error", e))?;
    Ok(())
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
async fn write_snapshot(snapshot: &AuthProvidersSnapshotData) -> Result<(), NookError> {
    write_snapshot_at(STATE_KEY, SCHEMA_KEY, snapshot).await
}

/// Full load pipeline: read, normalize, and unseal the current provider schema.
pub(crate) async fn load_auth_providers(
    identity: &DeviceIdentity,
) -> Result<NormalizedAuthSnapshot, NookError> {
    let state_key = state_key_for_app_id(identity.app_id());
    let scoped = read_raw_snapshot_at(&state_key).await?;
    let migrate_legacy = scoped.is_null() && may_migrate_legacy_snapshot(identity.app_id()).await?;
    let raw = if migrate_legacy {
        migrate_legacy_auth_providers_for_identity(identity).await?;
        read_raw_snapshot_at(&state_key).await?
    } else {
        scoped
    };
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
    let state_key = state_key_for_app_id(identity.app_id());
    let schema_key = schema_key_for_app_id(identity.app_id());
    let refresh_legacy = should_refresh_legacy_projection(identity.app_id()).await?;
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth save transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth save store error", e))?;
    let scoped = read_raw_snapshot_from_store(&store, &state_key).await?;
    let legacy = read_raw_snapshot_from_store(&store, STATE_KEY).await?;
    let legacy_belongs_to_identity =
        legacy_snapshot_belongs_to_identity(identity, &scoped, &legacy);
    if refresh_legacy && !legacy.is_null() && !legacy_belongs_to_identity {
        return Err(NookError::Database(
            "Legacy auth providers belong to another identity; both records were preserved"
                .to_owned(),
        ));
    }
    let refresh_legacy = refresh_legacy || legacy_belongs_to_identity;
    write_snapshot_to_store(&store, &state_key, &schema_key, &sealed).await?;
    if refresh_legacy {
        write_snapshot_to_store(&store, STATE_KEY, SCHEMA_KEY, &sealed).await?;
    }
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth save completion error", e))
        .map(|_| ())
}

/// Persist a snapshot whose credential fields are already age-sealed (or empty).
///
/// Extension pairing uses this when the offscreen device session is locked: the
/// website sealed grants for the extension device public key, so import must not
/// require an unlocked private key just to accept the handoff.
pub(crate) async fn save_presealed_auth_providers_for_app_id(
    app_id: &nook_core::AppId,
    snapshot: &AuthProvidersSnapshotData,
) -> Result<(), NookError> {
    if !provider_credentials_are_presealed(snapshot) {
        return Err(NookError::Decryption(
            "Presealed auth-provider save rejected plaintext credentials.".to_owned(),
        ));
    }
    let state_key = state_key_for_app_id(app_id);
    let schema_key = schema_key_for_app_id(app_id);
    let migrate_legacy = may_migrate_legacy_snapshot(app_id).await?;
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth presealed transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth presealed store error", e))?;
    let scoped = read_raw_snapshot_from_store(&store, &state_key).await?;
    let legacy = if scoped.is_null() && migrate_legacy {
        read_raw_snapshot_from_store(&store, STATE_KEY).await?
    } else {
        Value::Null
    };
    let raw = if legacy.is_null() {
        scoped
    } else {
        legacy.clone()
    };
    let existing = nook_core::normalize_auth_snapshot(&raw).snapshot;
    if !provider_credentials_are_presealed(&existing) {
        return Err(NookError::Decryption(
            "auth-provider-credential-must-be-encrypted".to_owned(),
        ));
    }
    let merged = nook_core::replace_active_vault_provider_grants(&existing, snapshot);
    write_snapshot_to_store(&store, &state_key, &schema_key, &merged).await?;
    if !legacy.is_null() {
        write_snapshot_to_store(&store, STATE_KEY, SCHEMA_KEY, &merged).await?;
    }
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth presealed completion error", e))
        .map(|_| ())
}

pub(crate) async fn delete_auth_providers_for_app_id(
    app_id: &nook_core::AppId,
) -> Result<(), NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth scoped delete transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth scoped delete store error", e))?;
    let state_key = state_key_for_app_id(app_id);
    let scoped = read_raw_snapshot_from_store(&store, &state_key).await?;
    let legacy = read_raw_snapshot_from_store(&store, STATE_KEY).await?;
    if rollback_projection::projections_match(&scoped, &legacy) {
        for key in [STATE_KEY, SCHEMA_KEY] {
            store
                .delete(
                    serde_wasm_bindgen::to_value(key)
                        .map_err(|e| idb_err("nook_auth rollback delete key error", e))?,
                )
                .await
                .map_err(|e| idb_err("nook_auth rollback delete error", e))?;
        }
    }
    for key in [state_key, schema_key_for_app_id(app_id)] {
        store
            .delete(
                serde_wasm_bindgen::to_value(&key)
                    .map_err(|e| idb_err("nook_auth scoped delete key error", e))?,
            )
            .await
            .map_err(|e| idb_err("nook_auth scoped delete error", e))?;
    }
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth scoped delete completion error", e))?;
    Ok(())
}

pub(crate) async fn delete_auth_providers_db() -> Result<(), NookError> {
    Rexie::delete(DB_NAME)
        .await
        .map_err(|e| idb_err("nook_auth delete error", e))
}

pub(crate) async fn clear_auth_providers_db() -> Result<(), NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadWrite)
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
    use crate::storage::{identity_record, indexed_db};
    use futures_util::future;
    use nook_core::{
        ActiveVaultScope, GoogleDriveMode, ProviderSyncCheckpoint, ProviderVaultScope,
        StorageProviderType, StoredGithubPat, StoredGithubRepository, StoredGoogleDriveFolder,
        StoredICloudShareTarget, StoredLocalFolderConfiguration, StoredOAuthAccessCredential,
        StoredOAuthAccountIdentity, StoredOAuthFileConfiguration, StoredOAuthRefreshCredential,
        StoredOAuthRemoteFileId, StoredOAuthRemoteFileName, StoredOAuthTokenExpiry,
    };

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
            active_vault_store_id: ActiveVaultScope::Unselected,
        }
    }

    fn github_snapshot(pat: &str) -> AuthProvidersSnapshotData {
        github_snapshot_with_id("gh-wasm", pat)
    }

    fn empty_snapshot() -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: ActiveVaultScope::Unselected,
        }
    }

    async fn clear_auth_snapshot() -> anyhow::Result<()> {
        write_snapshot(&AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: ActiveVaultScope::Unselected,
        })
        .await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn save_seals_github_pat_in_indexed_db() -> anyhow::Result<()> {
        clear_auth_snapshot().await?;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_11WASMtestSECRET";
        save_auth_providers(&identity, &github_snapshot(pat)).await?;
        let raw = read_raw_snapshot_at(&state_key_for_app_id(identity.app_id())).await?;
        let stored_pat = raw["providers"][0]["githubPat"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("sealed githubPat missing from snapshot"))?;
        assert!(nook_core::is_sealed_credential(stored_pat));
        assert!(!stored_pat.contains("WASMtestSECRET"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn load_decrypts_sealed_github_pat() -> anyhow::Result<()> {
        clear_auth_snapshot().await?;
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
    async fn credential_free_rollback_projection_accepts_the_first_remote_provider()
    -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let wrapped = nook_core::wrap_device_identity_with_pin(
            &identity.secret_string(),
            "credential free projection pin",
        )?;
        identity_record::save_new_protected_local_identity(&identity, &wrapped, None, "Personal")
            .await?;

        save_auth_providers(&identity, &empty_snapshot()).await?;
        save_auth_providers(&identity, &github_snapshot("github_pat_first_remote")).await?;

        assert_eq!(
            load_auth_providers(&identity).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_first_remote")
        );
        assert!(rollback_projection::projections_match(
            &read_raw_snapshot_at(&state_key_for_app_id(identity.app_id())).await?,
            &read_raw_snapshot().await?,
        ));
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn retiring_identity_removes_only_its_matching_rollback_projection() -> anyhow::Result<()>
    {
        clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let mut owned = github_snapshot("github_pat_owned");
        seal_provider_credentials(&identity, &mut owned)?;
        write_snapshot_at(
            &state_key_for_app_id(identity.app_id()),
            &schema_key_for_app_id(identity.app_id()),
            &owned,
        )
        .await?;
        write_snapshot(&owned).await?;

        delete_auth_providers_for_app_id(identity.app_id()).await?;

        assert!(read_raw_snapshot().await?.is_null());
        assert!(
            read_raw_snapshot_at(&state_key_for_app_id(identity.app_id()))
                .await?
                .is_null()
        );

        write_snapshot_at(
            &state_key_for_app_id(identity.app_id()),
            &schema_key_for_app_id(identity.app_id()),
            &owned,
        )
        .await?;
        let mut competing = github_snapshot("github_pat_competing");
        seal_provider_credentials(&identity, &mut competing)?;
        write_snapshot(&competing).await?;

        delete_auth_providers_for_app_id(identity.app_id()).await?;

        assert!(!read_raw_snapshot().await?.is_null());
        clear_auth_providers_db().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn provider_snapshots_are_scoped_to_their_local_app_keys() -> anyhow::Result<()> {
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        save_auth_providers(&first, &github_snapshot("github_pat_first")).await?;
        save_auth_providers(&second, &github_snapshot("github_pat_second")).await?;

        assert_eq!(
            load_auth_providers(&first).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_first")
        );
        assert_eq!(
            load_auth_providers(&second).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_second")
        );
        assert_ne!(
            state_key_for_app_id(first.app_id()),
            state_key_for_app_id(second.app_id())
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn presealed_snapshot_uses_explicit_recipient_app_id() -> anyhow::Result<()> {
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let mut first_existing = github_snapshot("github_pat_first_old");
        let mut second_existing = github_snapshot("github_pat_second");
        seal_provider_credentials(&first, &mut first_existing)?;
        seal_provider_credentials(&second, &mut second_existing)?;
        write_snapshot_at(
            &state_key_for_app_id(first.app_id()),
            &schema_key_for_app_id(first.app_id()),
            &first_existing,
        )
        .await?;
        write_snapshot_at(
            &state_key_for_app_id(second.app_id()),
            &schema_key_for_app_id(second.app_id()),
            &second_existing,
        )
        .await?;
        let mut incoming = github_snapshot("github_pat_first_new");
        seal_provider_credentials(&first, &mut incoming)?;

        save_presealed_auth_providers_for_app_id(first.app_id(), &incoming).await?;

        let first_loaded = load_auth_providers(&first).await?;
        let second_loaded = load_auth_providers(&second).await?;
        assert_eq!(
            first_loaded.snapshot.providers[0].github_pat.as_deref(),
            Some("github_pat_first_new")
        );
        assert_eq!(
            second_loaded.snapshot.providers[0].github_pat.as_deref(),
            Some("github_pat_second")
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn legacy_provider_snapshot_keeps_a_rollback_projection_before_a_second_identity()
    -> anyhow::Result<()> {
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let mut legacy = github_snapshot("github_pat_legacy_first");
        seal_provider_credentials(&first, &mut legacy)?;
        write_snapshot(&legacy).await?;

        migrate_legacy_auth_providers_for_identity(&first).await?;
        let mut rollback = nook_core::normalize_auth_snapshot(&read_raw_snapshot().await?).snapshot;
        open_provider_credentials(&first, &mut rollback)?;
        assert_eq!(
            rollback.providers[0].github_pat.as_deref(),
            Some("github_pat_legacy_first")
        );
        save_auth_providers(&second, &github_snapshot("github_pat_second")).await?;

        assert_eq!(
            load_auth_providers(&first).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_legacy_first")
        );
        assert_eq!(
            load_auth_providers(&second).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_second")
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn concurrent_legacy_migration_never_overwrites_a_newer_scoped_save() -> anyhow::Result<()>
    {
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let mut legacy = github_snapshot("github_pat_legacy");
        seal_provider_credentials(&identity, &mut legacy)?;
        write_snapshot(&legacy).await?;
        let newer = github_snapshot("github_pat_newer");

        let (migration, save) = future::join(
            migrate_legacy_auth_providers_for_identity(&identity),
            save_auth_providers(&identity, &newer),
        )
        .await;
        migration?;
        save?;

        assert_eq!(
            load_auth_providers(&identity).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_newer")
        );
        let mut rollback = nook_core::normalize_auth_snapshot(&read_raw_snapshot().await?).snapshot;
        open_provider_credentials(&identity, &mut rollback)?;
        assert_eq!(
            rollback.providers[0].github_pat.as_deref(),
            Some("github_pat_newer")
        );
        clear_auth_providers_db().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn conflicting_legacy_and_scoped_snapshots_are_both_preserved() -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        save_auth_providers(&identity, &github_snapshot("github_pat_scoped_newer")).await?;
        let mut legacy = github_snapshot("github_pat_legacy_competing");
        seal_provider_credentials(&identity, &mut legacy)?;
        write_snapshot(&legacy).await?;

        let result = migrate_legacy_auth_providers_for_identity(&identity).await;

        assert!(result.is_err());
        assert!(!read_raw_snapshot().await?.is_null());
        assert_eq!(
            load_auth_providers(&identity).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_scoped_newer")
        );
        clear_auth_providers_db().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn corrupt_keyring_blocks_legacy_provider_migration_without_data_loss()
    -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let mut legacy = github_snapshot("github_pat_must_survive");
        seal_provider_credentials(&identity, &mut legacy)?;
        write_snapshot(&legacy).await?;
        indexed_db::idb_put_string(
            identity_record::LOCAL_IDENTITY_KEYRING_KEY,
            "corrupt-keyring",
        )
        .await?;

        assert!(load_auth_providers(&identity).await.is_err());
        assert!(!read_raw_snapshot().await?.is_null());
        assert!(
            read_raw_snapshot_at(&state_key_for_app_id(identity.app_id()))
                .await?
                .is_null()
        );

        identity_record::clear_keyring_for_test().await?;
        clear_auth_providers_db().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn locked_selected_identity_claims_its_sealed_legacy_snapshot() -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let first = DeviceIdentity::generate()?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&first.secret_string(), "first identity pin")?;
        identity_record::save_new_protected_local_identity(&first, &wrapped, None, "Personal")
            .await?;
        let mut legacy = github_snapshot("github_pat_locked_legacy");
        seal_provider_credentials(&first, &mut legacy)?;
        write_snapshot(&legacy).await?;

        migrate_legacy_auth_providers_for_selected_identity().await?;

        let mut rollback = nook_core::normalize_auth_snapshot(&read_raw_snapshot().await?).snapshot;
        open_provider_credentials(&first, &mut rollback)?;
        assert_eq!(
            rollback.providers[0].github_pat.as_deref(),
            Some("github_pat_locked_legacy")
        );
        assert_eq!(
            load_auth_providers(&first).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_locked_legacy")
        );
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn locked_migration_preserves_conflicting_provider_snapshots() -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let wrapped = nook_core::wrap_device_identity_with_pin(
            &identity.secret_string(),
            "provider conflict identity pin",
        )?;
        identity_record::save_new_protected_local_identity(&identity, &wrapped, None, "Personal")
            .await?;
        save_auth_providers(&identity, &github_snapshot("github_pat_scoped_newer")).await?;
        let mut legacy = github_snapshot("github_pat_legacy_competing");
        seal_provider_credentials(&identity, &mut legacy)?;
        write_snapshot(&legacy).await?;

        let result = migrate_legacy_auth_providers_for_selected_identity().await;

        assert!(result.is_err());
        assert!(!read_raw_snapshot().await?.is_null());
        assert_eq!(
            load_auth_providers(&identity).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_scoped_newer")
        );
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn locked_presealed_import_preserves_eligible_legacy_grants() -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let wrapped = nook_core::wrap_device_identity_with_pin(
            &identity.secret_string(),
            "legacy provider identity pin",
        )?;
        identity_record::save_new_protected_local_identity(&identity, &wrapped, None, "Personal")
            .await?;
        let mut legacy = github_snapshot_with_id("gh-legacy", "github_pat_legacy");
        legacy.providers[0].store_id = ProviderVaultScope::StoreId("store-legacy".to_owned());
        legacy.active_vault_store_id = ActiveVaultScope::StoreId("store-legacy".to_owned());
        seal_provider_credentials(&identity, &mut legacy)?;
        write_snapshot(&legacy).await?;

        let mut incoming = github_snapshot_with_id("gh-incoming", "github_pat_incoming");
        incoming.providers[0].store_id = ProviderVaultScope::StoreId("store-incoming".to_owned());
        incoming.active_vault_store_id = ActiveVaultScope::StoreId("store-incoming".to_owned());
        seal_provider_credentials(&identity, &mut incoming)?;

        save_presealed_auth_providers_for_app_id(identity.app_id(), &incoming).await?;

        let raw = read_raw_snapshot_at(&state_key_for_app_id(identity.app_id())).await?;
        let stored = nook_core::normalize_auth_snapshot(&raw).snapshot;
        let mut provider_ids = stored
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<Vec<_>>();
        provider_ids.sort_unstable();
        assert_eq!(provider_ids, vec!["gh-incoming", "gh-legacy"]);
        assert!(provider_credentials_are_presealed(&stored));
        let rollback = nook_core::normalize_auth_snapshot(&read_raw_snapshot().await?).snapshot;
        let mut rollback_provider_ids = rollback
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<Vec<_>>();
        rollback_provider_ids.sort_unstable();
        assert_eq!(rollback_provider_ids, vec!["gh-incoming", "gh-legacy"]);
        clear_auth_providers_db().await?;
        identity_record::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn load_rejects_plaintext_credentials() -> anyhow::Result<()> {
        clear_auth_snapshot().await?;
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_33PLAINTEXT";
        write_snapshot(&github_snapshot(pat)).await?;
        assert!(load_auth_providers(&identity).await.is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn save_seals_oauth_tokens_in_indexed_db() -> anyhow::Result<()> {
        clear_auth_snapshot().await?;
        let identity = DeviceIdentity::generate()?;
        let access = "ya29.wasm-oauth-access";
        let refresh = "1//wasm-refresh-secret";
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "gd-wasm".to_owned(),
                provider_type: StorageProviderType::OauthFile,
                label: "Google Drive".to_owned(),
                github_pat: StoredGithubPat::Missing,
                github_repo: StoredGithubRepository::DefaultRepository,
                oauth_file: StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                    preset: OauthFilePreset::GoogleDrive,
                    access_token: StoredOAuthAccessCredential::AccessToken(access.to_owned()),
                    refresh_token: StoredOAuthRefreshCredential::Token(refresh.to_owned()),
                    expires_at: StoredOAuthTokenExpiry::Unknown,
                    file_id: StoredOAuthRemoteFileId::Unresolved,
                    file_name: StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
                    account_email: StoredOAuthAccountIdentity::Unknown,
                    drive_mode: GoogleDriveMode::Private,
                    folder_id: StoredGoogleDriveFolder::Root,
                    icloud_mode: ICloudMode::Private,
                    icloud_share_target: StoredICloudShareTarget::Personal,
                }),
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::Unscoped,
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        save_auth_providers(&identity, &snapshot).await?;
        let raw = read_raw_snapshot_at(&state_key_for_app_id(identity.app_id())).await?;
        let oauth = &raw["providers"][0]["oauthFile"];
        let stored_access = oauth["accessToken"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("sealed accessToken missing from snapshot"))?;
        let stored_refresh = oauth["refreshToken"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("sealed refreshToken missing from snapshot"))?;
        assert!(nook_core::is_sealed_credential(stored_access));
        assert!(nook_core::is_sealed_credential(stored_refresh));
        assert!(!stored_access.contains(access));
        assert!(!stored_refresh.contains(refresh));

        let loaded = load_auth_providers(&identity).await?;
        let loaded_oauth = loaded.snapshot.providers[0]
            .oauth_file
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("loaded oauth_file configuration missing"))?;
        assert_eq!(loaded_oauth.access_token.as_deref(), Some(access));
        assert_eq!(loaded_oauth.refresh_token.as_deref(), Some(refresh));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn presealed_save_replaces_active_vault_and_preserves_other_vaults() -> anyhow::Result<()>
    {
        clear_auth_snapshot().await?;
        let identity = DeviceIdentity::generate()?;
        let mut existing = github_snapshot_with_id("gh-removed", "github_pat_existing");
        existing.providers[0].store_id = ProviderVaultScope::StoreId("store-incoming".to_owned());
        let mut retained = github_snapshot_with_id("gh-retained", "github_pat_retained")
            .providers
            .remove(0);
        retained.store_id = ProviderVaultScope::StoreId("store-other".to_owned());
        existing.providers.push(retained);
        existing.active_vault_store_id = ActiveVaultScope::StoreId("store-incoming".to_owned());
        seal_provider_credentials(&identity, &mut existing)?;
        write_snapshot_at(
            &state_key_for_app_id(identity.app_id()),
            &schema_key_for_app_id(identity.app_id()),
            &existing,
        )
        .await?;

        let mut incoming = github_snapshot_with_id("gh-incoming", "github_pat_incoming");
        incoming.active_vault_store_id = ActiveVaultScope::StoreId("store-incoming".to_owned());
        seal_provider_credentials(&identity, &mut incoming)?;
        save_presealed_auth_providers_for_app_id(identity.app_id(), &incoming).await?;

        let raw = read_raw_snapshot_at(&state_key_for_app_id(identity.app_id())).await?;
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
        clear_auth_snapshot().await?;
        let identity = DeviceIdentity::generate()?;
        write_snapshot_at(
            &state_key_for_app_id(identity.app_id()),
            &schema_key_for_app_id(identity.app_id()),
            &github_snapshot_with_id("gh-plaintext", "github_pat_plaintext"),
        )
        .await?;
        let mut incoming = github_snapshot_with_id("gh-incoming", "github_pat_incoming");
        seal_provider_credentials(&identity, &mut incoming)?;
        let result = save_presealed_auth_providers_for_app_id(identity.app_id(), &incoming).await;
        assert!(matches!(
            result,
            Err(NookError::Decryption(message))
                if message == "auth-provider-credential-must-be-encrypted"
        ));

        let raw = read_raw_snapshot_at(&state_key_for_app_id(identity.app_id())).await?;
        assert_eq!(
            raw["providers"][0]["githubPat"].as_str(),
            Some("github_pat_plaintext")
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn presealed_empty_save_clears_only_the_incoming_vault() -> anyhow::Result<()> {
        clear_auth_snapshot().await?;
        let identity = DeviceIdentity::generate()?;
        let mut existing = github_snapshot_with_id("gh-removed", "github_pat_removed");
        existing.providers[0].store_id = ProviderVaultScope::StoreId("store-incoming".to_owned());
        let mut retained = github_snapshot_with_id("gh-retained", "github_pat_retained")
            .providers
            .remove(0);
        retained.store_id = ProviderVaultScope::StoreId("store-other".to_owned());
        existing.providers.push(retained);
        existing.active_vault_store_id = ActiveVaultScope::StoreId("store-incoming".to_owned());
        seal_provider_credentials(&identity, &mut existing)?;
        write_snapshot_at(
            &state_key_for_app_id(identity.app_id()),
            &schema_key_for_app_id(identity.app_id()),
            &existing,
        )
        .await?;

        save_presealed_auth_providers_for_app_id(
            identity.app_id(),
            &AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId("store-incoming".to_owned()),
            },
        )
        .await?;

        let raw = read_raw_snapshot_at(&state_key_for_app_id(identity.app_id())).await?;
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
