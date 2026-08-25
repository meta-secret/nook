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
use serde::Serialize;

use crate::NookError;

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
        None => Ok(serde_json::Value::Null),
        Some(value) if value.is_undefined() || value.is_null() => Ok(serde_json::Value::Null),
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
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
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

async fn delete_snapshot_from_store(
    store: &rexie::Store,
    state_key: &str,
    schema_key: &str,
) -> Result<(), NookError> {
    for key in [state_key, schema_key] {
        store
            .delete(
                serde_wasm_bindgen::to_value(key)
                    .map_err(|e| idb_err("nook_auth delete key error", e))?,
            )
            .await
            .map_err(|e| idb_err("nook_auth delete error", e))?;
    }
    Ok(())
}

/// Read the raw persisted snapshot object as JSON (`Null` when absent).
async fn read_raw_snapshot_at(state_key: &str) -> Result<serde_json::Value, NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadOnly)
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
async fn write_snapshot_at(
    state_key: &str,
    schema_key: &str,
    snapshot: &AuthProvidersSnapshotData,
) -> Result<(), NookError> {
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
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

async fn may_migrate_legacy_snapshot(app_id: &nook_core::AppId) -> Result<bool, NookError> {
    let keyring = crate::storage::identity_record::load_keyring().await?;
    Ok(keyring.entries().is_empty()
        || (keyring.entries().len() == 1
            && keyring
                .entries()
                .first()
                .is_some_and(|entry| entry.app_id() == app_id)))
}

fn require_safe_legacy_deletion(
    scoped: &serde_json::Value,
    legacy: &serde_json::Value,
) -> Result<(), NookError> {
    if scoped.is_null() || legacy.is_null() {
        return Ok(());
    }
    let scoped = nook_core::normalize_auth_snapshot(scoped).snapshot;
    let legacy = nook_core::normalize_auth_snapshot(legacy).snapshot;
    if scoped == legacy {
        return Ok(());
    }
    Err(NookError::Database(
        "Legacy auth providers conflict with the identity-scoped snapshot; both records were preserved"
            .to_owned(),
    ))
}

pub(crate) async fn migrate_legacy_auth_providers_for_identity(
    identity: &DeviceIdentity,
) -> Result<(), NookError> {
    let state_key = state_key_for_app_id(identity.app_id());
    let schema_key = schema_key_for_app_id(identity.app_id());
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth migration transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth migration store error", e))?;
    let scoped = read_raw_snapshot_from_store(&store, &state_key).await?;
    let legacy = read_raw_snapshot_from_store(&store, STATE_KEY).await?;
    require_safe_legacy_deletion(&scoped, &legacy)?;
    if scoped.is_null() && !legacy.is_null() {
        let mut snapshot = nook_core::normalize_auth_snapshot(&legacy).snapshot;
        open_provider_credentials(identity, &mut snapshot)?;
        seal_provider_credentials(identity, &mut snapshot)?;
        write_snapshot_to_store(&store, &state_key, &schema_key, &snapshot).await?;
    }
    if !legacy.is_null() {
        delete_snapshot_from_store(&store, STATE_KEY, SCHEMA_KEY).await?;
    }
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth migration completion error", e))
        .map(|_| ())
}

pub(crate) async fn migrate_legacy_auth_providers_for_selected_identity() -> Result<(), NookError> {
    let Some(entry) = crate::storage::identity_record::load_selected_entry().await? else {
        return Ok(());
    };
    if !may_migrate_legacy_snapshot(entry.app_id()).await? {
        return Ok(());
    }
    let state_key = state_key_for_app_id(entry.app_id());
    let schema_key = schema_key_for_app_id(entry.app_id());
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth locked migration transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth locked migration store error", e))?;
    let scoped = read_raw_snapshot_from_store(&store, &state_key).await?;
    let legacy = read_raw_snapshot_from_store(&store, STATE_KEY).await?;
    require_safe_legacy_deletion(&scoped, &legacy)?;
    if scoped.is_null() {
        let snapshot = nook_core::normalize_auth_snapshot(&legacy).snapshot;
        if !legacy.is_null() && !provider_credentials_are_presealed(&snapshot) {
            return Err(NookError::Decryption(
                "Legacy auth providers require current identity authorization".to_owned(),
            ));
        }
        if !legacy.is_null() {
            write_snapshot_to_store(&store, &state_key, &schema_key, &snapshot).await?;
        }
    }
    if !legacy.is_null() {
        delete_snapshot_from_store(&store, STATE_KEY, SCHEMA_KEY).await?;
    }
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth locked migration completion error", e))
        .map(|_| ())
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
    write_snapshot_at(
        &state_key_for_app_id(identity.app_id()),
        &schema_key_for_app_id(identity.app_id()),
        &sealed,
    )
    .await
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
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth presealed transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth presealed store error", e))?;
    let scoped = read_raw_snapshot_from_store(&store, &state_key).await?;
    let legacy = if scoped.is_null() && migrate_legacy {
        read_raw_snapshot_from_store(&store, STATE_KEY).await?
    } else {
        serde_json::Value::Null
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
        delete_snapshot_from_store(&store, STATE_KEY, SCHEMA_KEY).await?;
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
        .transaction(&[STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth scoped delete transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth scoped delete store error", e))?;
    for key in [state_key_for_app_id(app_id), schema_key_for_app_id(app_id)] {
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
    async fn legacy_provider_snapshot_is_claimed_before_a_second_identity_is_added()
    -> anyhow::Result<()> {
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let mut legacy = github_snapshot("github_pat_legacy_first");
        seal_provider_credentials(&first, &mut legacy)?;
        write_snapshot(&legacy).await?;

        migrate_legacy_auth_providers_for_identity(&first).await?;
        assert!(read_raw_snapshot().await?.is_null());
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
        crate::storage::identity_record::clear_keyring_for_test().await?;
        crate::storage::identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let mut legacy = github_snapshot("github_pat_legacy");
        seal_provider_credentials(&identity, &mut legacy)?;
        write_snapshot(&legacy).await?;
        let newer = github_snapshot("github_pat_newer");

        let (migration, save) = futures_util::future::join(
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
        assert!(read_raw_snapshot().await?.is_null());
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
        crate::storage::identity_record::clear_keyring_for_test().await?;
        crate::storage::identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let mut legacy = github_snapshot("github_pat_must_survive");
        seal_provider_credentials(&identity, &mut legacy)?;
        write_snapshot(&legacy).await?;
        crate::storage::indexed_db::idb_put_string(
            crate::storage::identity_record::LOCAL_IDENTITY_KEYRING_KEY,
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

        crate::storage::identity_record::clear_keyring_for_test().await?;
        clear_auth_providers_db().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn locked_selected_identity_claims_its_sealed_legacy_snapshot() -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        crate::storage::identity_record::clear_keyring_for_test().await?;
        crate::storage::identity_record::clear_identity_directory_for_test().await?;
        let first = DeviceIdentity::generate()?;
        let wrapped =
            nook_core::wrap_device_identity_with_pin(&first.secret_string(), "first identity pin")?;
        crate::storage::identity_record::save_new_protected_local_identity(
            &first, &wrapped, None, "Personal",
        )
        .await?;
        let mut legacy = github_snapshot("github_pat_locked_legacy");
        seal_provider_credentials(&first, &mut legacy)?;
        write_snapshot(&legacy).await?;

        migrate_legacy_auth_providers_for_selected_identity().await?;

        assert!(read_raw_snapshot().await?.is_null());
        assert_eq!(
            load_auth_providers(&first).await?.snapshot.providers[0]
                .github_pat
                .as_deref(),
            Some("github_pat_locked_legacy")
        );
        clear_auth_providers_db().await?;
        crate::storage::identity_record::clear_keyring_for_test().await?;
        crate::storage::identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn locked_migration_preserves_conflicting_provider_snapshots() -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        crate::storage::identity_record::clear_keyring_for_test().await?;
        crate::storage::identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let wrapped = nook_core::wrap_device_identity_with_pin(
            &identity.secret_string(),
            "provider conflict identity pin",
        )?;
        crate::storage::identity_record::save_new_protected_local_identity(
            &identity, &wrapped, None, "Personal",
        )
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
        crate::storage::identity_record::clear_keyring_for_test().await?;
        crate::storage::identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn locked_presealed_import_preserves_eligible_legacy_grants() -> anyhow::Result<()> {
        clear_auth_providers_db().await?;
        crate::storage::identity_record::clear_keyring_for_test().await?;
        crate::storage::identity_record::clear_identity_directory_for_test().await?;
        let identity = DeviceIdentity::generate()?;
        let wrapped = nook_core::wrap_device_identity_with_pin(
            &identity.secret_string(),
            "legacy provider identity pin",
        )?;
        crate::storage::identity_record::save_new_protected_local_identity(
            &identity, &wrapped, None, "Personal",
        )
        .await?;
        let mut legacy = github_snapshot_with_id("gh-legacy", "github_pat_legacy");
        legacy.providers[0].store_id =
            nook_core::ProviderVaultScope::StoreId("store-legacy".to_owned());
        legacy.active_vault_store_id =
            nook_core::ActiveVaultScope::StoreId("store-legacy".to_owned());
        seal_provider_credentials(&identity, &mut legacy)?;
        write_snapshot(&legacy).await?;

        let mut incoming = github_snapshot_with_id("gh-incoming", "github_pat_incoming");
        incoming.providers[0].store_id =
            nook_core::ProviderVaultScope::StoreId("store-incoming".to_owned());
        incoming.active_vault_store_id =
            nook_core::ActiveVaultScope::StoreId("store-incoming".to_owned());
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
        assert!(read_raw_snapshot().await?.is_null());
        clear_auth_providers_db().await?;
        crate::storage::identity_record::clear_keyring_for_test().await?;
        crate::storage::identity_record::clear_identity_directory_for_test().await?;
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
        existing.providers[0].store_id =
            nook_core::ProviderVaultScope::StoreId("store-incoming".to_owned());
        let mut retained = github_snapshot_with_id("gh-retained", "github_pat_retained")
            .providers
            .remove(0);
        retained.store_id = nook_core::ProviderVaultScope::StoreId("store-other".to_owned());
        existing.providers.push(retained);
        existing.active_vault_store_id =
            nook_core::ActiveVaultScope::StoreId("store-incoming".to_owned());
        seal_provider_credentials(&identity, &mut existing)?;
        write_snapshot_at(
            &state_key_for_app_id(identity.app_id()),
            &schema_key_for_app_id(identity.app_id()),
            &existing,
        )
        .await?;

        let mut incoming = github_snapshot_with_id("gh-incoming", "github_pat_incoming");
        incoming.active_vault_store_id =
            nook_core::ActiveVaultScope::StoreId("store-incoming".to_owned());
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
        existing.providers[0].store_id =
            nook_core::ProviderVaultScope::StoreId("store-incoming".to_owned());
        let mut retained = github_snapshot_with_id("gh-retained", "github_pat_retained")
            .providers
            .remove(0);
        retained.store_id = nook_core::ProviderVaultScope::StoreId("store-other".to_owned());
        existing.providers.push(retained);
        existing.active_vault_store_id =
            nook_core::ActiveVaultScope::StoreId("store-incoming".to_owned());
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
                active_vault_store_id: nook_core::ActiveVaultScope::StoreId(
                    "store-incoming".to_owned(),
                ),
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
