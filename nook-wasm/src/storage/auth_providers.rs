//! `nook_auth` `IndexedDB` persistence for sync-provider credentials.
//!
//! Owns the full non-network load pipeline (normalize → device-key unseal →
//! legacy `localStorage` seed → field migration → re-persist) and seals
//! credential fields (GitHub PAT, OAuth tokens) with this browser's age device
//! identity so nothing sensitive is stored in plaintext. Pure snapshot
//! transforms live in `nook_core`; this module adds the `IndexedDB` I/O, sealing,
//! and browser storage access.

use nook_core::{
    AgeArmoredCiphertext, AuthProvidersSnapshotData, DeviceIdentity, DeviceIdentitySecret,
    NormalizedAuthSnapshot,
};

use crate::NookError;

use super::indexed_db::ensure_device_identity_record;

const DB_NAME: &str = "nook_auth";
const STORE: &str = "auth";
const STATE_KEY: &str = "providers";
/// Marker present in every age-armored ciphertext — sealed fields contain it.
const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";
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

fn is_sealed(value: &str) -> bool {
    value.contains(AGE_ARMOR_MARKER)
}

async fn device_identity() -> Result<DeviceIdentity, NookError> {
    let record = ensure_device_identity_record().await?;
    Ok(DeviceIdentity::from_secret_str(
        &DeviceIdentitySecret::parse(&record.secret)?,
    )?)
}

fn seal_optional(identity: &DeviceIdentity, field: &mut Option<String>) -> Result<(), NookError> {
    let Some(text) = field.clone() else {
        return Ok(());
    };
    if !text.is_empty() && !is_sealed(&text) {
        *field = Some(identity.seal_utf8(&text)?.into_inner());
    }
    Ok(())
}

fn seal_required(identity: &DeviceIdentity, field: &mut String) -> Result<(), NookError> {
    if !field.is_empty() && !is_sealed(field) {
        *field = identity.seal_utf8(field)?.into_inner();
    }
    Ok(())
}

fn seal_snapshot(
    identity: &DeviceIdentity,
    snapshot: &mut AuthProvidersSnapshotData,
) -> Result<(), NookError> {
    for provider in &mut snapshot.providers {
        seal_optional(identity, &mut provider.github_pat)?;
        if let Some(oauth) = provider.oauth_file.as_mut() {
            seal_required(identity, &mut oauth.access_token)?;
            seal_optional(identity, &mut oauth.refresh_token)?;
        }
    }
    Ok(())
}

fn open_optional(
    identity: &DeviceIdentity,
    field: &mut Option<String>,
    had_plaintext: &mut bool,
) -> Result<(), NookError> {
    let Some(text) = field.clone() else {
        return Ok(());
    };
    if text.is_empty() {
        return Ok(());
    }
    if is_sealed(&text) {
        *field = Some(identity.open_utf8(&AgeArmoredCiphertext::parse(&text)?)?);
    } else {
        *had_plaintext = true;
    }
    Ok(())
}

fn open_required(
    identity: &DeviceIdentity,
    field: &mut String,
    had_plaintext: &mut bool,
) -> Result<(), NookError> {
    if !field.is_empty() {
        if is_sealed(field) {
            *field = identity.open_utf8(&AgeArmoredCiphertext::parse(field)?)?;
        } else {
            *had_plaintext = true;
        }
    }
    Ok(())
}

/// Unseal credential fields in place, reporting whether any were still plaintext
/// (legacy/seeded rows) so the caller re-saves them sealed.
fn open_snapshot(
    identity: &DeviceIdentity,
    snapshot: &mut AuthProvidersSnapshotData,
) -> Result<bool, NookError> {
    let mut had_plaintext = false;
    for provider in &mut snapshot.providers {
        open_optional(identity, &mut provider.github_pat, &mut had_plaintext)?;
        if let Some(oauth) = provider.oauth_file.as_mut() {
            open_required(identity, &mut oauth.access_token, &mut had_plaintext)?;
            open_optional(identity, &mut oauth.refresh_token, &mut had_plaintext)?;
        }
    }
    Ok(had_plaintext)
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

/// Full load pipeline: read → unseal → legacy seed → field migration, re-saving
/// (sealed) when anything changed. Returns the decrypted in-memory snapshot plus
/// the legacy active-provider id for the one-time remote vault copy.
pub(crate) async fn load_auth_providers() -> Result<NormalizedAuthSnapshot, NookError> {
    let raw = read_raw_snapshot().await?;
    let normalized = nook_core::normalize_auth_snapshot(&raw);
    let identity = device_identity().await?;
    let mut snapshot = normalized.snapshot;
    let had_plaintext = open_snapshot(&identity, &mut snapshot)?;

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
        save_auth_providers(&snapshot).await?;
    }

    Ok(NormalizedAuthSnapshot {
        snapshot,
        legacy_active_provider_id: normalized.legacy_active_provider_id,
        changed,
    })
}

/// Seal credential fields and persist the snapshot.
pub(crate) async fn save_auth_providers(
    snapshot: &AuthProvidersSnapshotData,
) -> Result<(), NookError> {
    let identity = device_identity().await?;
    let mut sealed = snapshot.clone();
    seal_snapshot(&identity, &mut sealed)?;
    write_snapshot(&sealed).await
}

pub(crate) async fn delete_auth_providers_db() -> Result<(), NookError> {
    rexie::Rexie::delete(DB_NAME)
        .await
        .map_err(|e| idb_err("nook_auth delete error", e))
}
