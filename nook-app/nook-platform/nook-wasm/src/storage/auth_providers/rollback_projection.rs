//! Ownership and migration policy for the singleton provider rollback projection.

use crate::storage::identity_record;
use rexie::TransactionMode;

use nook_core::{
    DeviceIdentity, open_provider_credentials, provider_credentials_are_presealed,
    seal_provider_credentials,
};

use super::{
    NookError, SCHEMA_KEY, STATE_KEY, STORE, idb_err, open_auth_db, read_raw_snapshot_from_store,
    schema_key_for_app_id, state_key_for_app_id, write_snapshot_to_store,
};

pub(super) async fn may_migrate_legacy_snapshot(
    app_id: &nook_core::AppId,
) -> Result<bool, NookError> {
    let keyring = identity_record::load_keyring().await?;
    Ok(keyring.entries().is_empty()
        || (keyring.entries().len() == 1
            && keyring
                .entries()
                .first()
                .is_some_and(|entry| entry.app_id() == app_id)))
}

pub(super) async fn should_refresh_legacy_projection(
    app_id: &nook_core::AppId,
) -> Result<bool, NookError> {
    let keyring = identity_record::load_keyring().await?;
    Ok(keyring.entries().len() == 1
        && keyring
            .entries()
            .first()
            .is_some_and(|entry| entry.app_id() == app_id))
}

pub(super) fn projections_match(scoped: &serde_json::Value, legacy: &serde_json::Value) -> bool {
    if scoped.is_null() || legacy.is_null() {
        return false;
    }
    nook_core::normalize_auth_snapshot(scoped).snapshot
        == nook_core::normalize_auth_snapshot(legacy).snapshot
}

fn require_compatible_legacy_snapshot(
    scoped: &serde_json::Value,
    legacy: &serde_json::Value,
) -> Result<(), NookError> {
    if scoped.is_null() || legacy.is_null() || projections_match(scoped, legacy) {
        return Ok(());
    }
    Err(NookError::Database(
        "Legacy auth providers conflict with the identity-scoped snapshot; both records were preserved"
            .to_owned(),
    ))
}

pub(super) fn legacy_snapshot_belongs_to_identity(
    identity: &DeviceIdentity,
    scoped: &serde_json::Value,
    legacy: &serde_json::Value,
) -> bool {
    if projections_match(scoped, legacy) {
        return true;
    }
    if legacy.is_null() {
        return false;
    }
    let mut snapshot = nook_core::normalize_auth_snapshot(legacy).snapshot;
    let sealed = snapshot.clone();
    open_provider_credentials(identity, &mut snapshot).is_ok() && snapshot != sealed
}

pub(super) async fn migrate_legacy_auth_providers_for_identity(
    identity: &DeviceIdentity,
) -> Result<(), NookError> {
    let state_key = state_key_for_app_id(identity.app_id());
    let schema_key = schema_key_for_app_id(identity.app_id());
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth migration transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth migration store error", e))?;
    let scoped = read_raw_snapshot_from_store(&store, &state_key).await?;
    let legacy = read_raw_snapshot_from_store(&store, STATE_KEY).await?;
    require_compatible_legacy_snapshot(&scoped, &legacy)?;
    if scoped.is_null() && !legacy.is_null() {
        let mut snapshot = nook_core::normalize_auth_snapshot(&legacy).snapshot;
        open_provider_credentials(identity, &mut snapshot)?;
        seal_provider_credentials(identity, &mut snapshot)?;
        write_snapshot_to_store(&store, &state_key, &schema_key, &snapshot).await?;
        write_snapshot_to_store(&store, STATE_KEY, SCHEMA_KEY, &snapshot).await?;
    }
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth migration completion error", e))
        .map(|_| ())
}

pub(crate) async fn migrate_legacy_auth_providers_for_selected_identity() -> Result<(), NookError> {
    let Some(entry) = identity_record::load_selected_entry().await? else {
        return Ok(());
    };
    if !may_migrate_legacy_snapshot(entry.app_id()).await? {
        return Ok(());
    }
    let state_key = state_key_for_app_id(entry.app_id());
    let schema_key = schema_key_for_app_id(entry.app_id());
    let rexie = open_auth_db().await?;
    let transaction = rexie
        .transaction(&[STORE], TransactionMode::ReadWrite)
        .map_err(|e| idb_err("nook_auth locked migration transaction error", e))?;
    let store = transaction
        .store(STORE)
        .map_err(|e| idb_err("nook_auth locked migration store error", e))?;
    let scoped = read_raw_snapshot_from_store(&store, &state_key).await?;
    let legacy = read_raw_snapshot_from_store(&store, STATE_KEY).await?;
    require_compatible_legacy_snapshot(&scoped, &legacy)?;
    if scoped.is_null() {
        let snapshot = nook_core::normalize_auth_snapshot(&legacy).snapshot;
        if !legacy.is_null() && !provider_credentials_are_presealed(&snapshot) {
            return Err(NookError::Decryption(
                "Legacy auth providers require current identity authorization".to_owned(),
            ));
        }
        if !legacy.is_null() {
            write_snapshot_to_store(&store, &state_key, &schema_key, &snapshot).await?;
            write_snapshot_to_store(&store, STATE_KEY, SCHEMA_KEY, &snapshot).await?;
        }
    }
    transaction
        .done()
        .await
        .map_err(|e| idb_err("nook_auth locked migration completion error", e))
        .map(|_| ())
}
