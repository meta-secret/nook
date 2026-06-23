//! Glue between `nook_core` data structures and the JS-facing shapes the
//! session manager exposes.
//!
//! Contents:
//! - `records_to_array` — wraps a `Vec<SecretRecord>` into a `js_sys::Array`
//!   of `NookSecretRecord` wasm objects.
//! - `records_to_armored` / `records_to_secret_types` — derive the in-memory
//!   caches we hold on `NookVaultManager` from a freshly-loaded record list.
//! - `content_requires_genesis` / `access_status_for_vault_content` —
//!   pre-flight checks used by `connect` and `assess_vault_connect` to
//!   decide whether the device needs to write a genesis vault or block on
//!   join/approval.
//! - `sync_result_*` — the JS object shapes returned by
//!   `sync_vault_from_storage` (`{changed, ...}`).
//! - `LoadedVault` + `load_stored_vault` — single-shot decryption of a YAML
//!   file into the armored cache + plaintext JSONL session string for the
//!   keys-mode connect path.

use crate::{NookError, NookSecretRecord, NookVaultManager};
use std::collections::HashMap;
use wasm_bindgen::{JsError, JsValue};

pub(crate) fn records_to_array(
    records: Vec<nook_core::SecretRecord>,
) -> Result<js_sys::Array, NookError> {
    let array = js_sys::Array::new();
    for record in records {
        let data = record.data.to_yaml().map_err(NookError::Serialization)?;
        let wasm_record =
            NookSecretRecord::new(record.id, record.secret_type.as_str().to_owned(), data);
        array.push(&JsValue::from(wasm_record));
    }
    Ok(array)
}

pub(crate) fn records_to_armored(
    records: &[nook_core::StoredSecretRecord],
) -> HashMap<String, String> {
    records
        .iter()
        .map(|record| (record.key.clone(), record.value.clone()))
        .collect()
}

pub(crate) fn records_to_secret_types(
    records: &[nook_core::StoredSecretRecord],
) -> HashMap<String, nook_core::SecretType> {
    records
        .iter()
        .filter_map(|record| {
            record
                .secret_type
                .map(|secret_type| (record.key.clone(), secret_type))
        })
        .collect()
}

pub(crate) fn content_requires_genesis(
    content: &str,
    force_genesis: bool,
) -> Result<bool, NookError> {
    if force_genesis {
        return Ok(true);
    }
    if content.trim().is_empty() {
        return Ok(true);
    }
    let format = nook_core::detect_stored_format(content).map_err(NookError::Decryption)?;
    let records = nook_core::deserialize_stored(content, format).map_err(NookError::Decryption)?;
    Ok(!nook_core::vault_has_multi_device_records(&records))
}

pub(crate) fn access_status_for_vault_content(
    content: &str,
    identity: &nook_core::DeviceIdentity,
) -> Result<String, NookError> {
    if content.trim().is_empty() {
        return Ok("new_vault".to_owned());
    }
    let format = nook_core::detect_stored_format(content).map_err(NookError::Decryption)?;
    let records = nook_core::deserialize_stored(content, format).map_err(NookError::Decryption)?;
    if !nook_core::vault_has_multi_device_records(&records) {
        return Ok("new_vault".to_owned());
    }
    Ok(match nook_core::assess_connect_access(&records, identity) {
        nook_core::ConnectAccessStatus::Ready => "ready",
        nook_core::ConnectAccessStatus::NeedsEnrollment => "needs_enrollment",
        nook_core::ConnectAccessStatus::JoinPending => "join_pending",
    }
    .to_owned())
}

pub(crate) fn sync_result_unchanged() -> Result<JsValue, JsError> {
    let obj = js_sys::Object::new();
    js_set(&obj, "changed", &JsValue::FALSE)?;
    Ok(obj.into())
}

pub(crate) fn sync_result_access_status(status: &str) -> Result<JsValue, JsError> {
    let obj = js_sys::Object::new();
    js_set(&obj, "changed", &JsValue::TRUE)?;
    js_set(&obj, "access_status", &JsValue::from_str(status))?;
    Ok(obj.into())
}

pub(crate) fn sync_result_session(
    manager: &NookVaultManager,
    changed: bool,
) -> Result<JsValue, JsError> {
    let obj = js_sys::Object::new();
    js_set(&obj, "changed", &JsValue::from_bool(changed))?;
    js_set(&obj, "secrets", &manager.get_records_as_array()?.into())?;
    js_set(&obj, "pending_joins", &manager.list_pending_joins()?.into())?;
    js_set(&obj, "vault_members", &manager.list_vault_members()?.into())?;
    Ok(obj.into())
}

fn js_set(obj: &js_sys::Object, key: &str, value: &JsValue) -> Result<(), NookError> {
    js_sys::Reflect::set(obj, &JsValue::from_str(key), value).map_err(|_| {
        NookError::Serialization(format!("Failed to set sync result field `{key}`."))
    })?;
    Ok(())
}

pub(crate) fn apply_member_records(
    armored: &mut HashMap<String, String>,
    member_records: &[nook_core::StoredSecretRecord],
) {
    armored.retain(|key, _| !key.starts_with(nook_core::MEMBER_RECORD_PREFIX));
    for record in member_records {
        armored.insert(record.key.clone(), record.value.clone());
    }
}

pub(crate) fn wasm_iso_timestamp() -> String {
    js_sys::Date::new_0().to_iso_string().into()
}

pub(crate) struct LoadedVault {
    pub(crate) jsonl: String,
    pub(crate) armored: HashMap<String, String>,
    pub(crate) secret_types: HashMap<String, nook_core::SecretType>,
    pub(crate) secrets_key: String,
    pub(crate) members_key: String,
}

pub(crate) fn load_stored_vault(
    content: &str,
    identity: &nook_core::DeviceIdentity,
) -> Result<LoadedVault, NookError> {
    let format = nook_core::detect_stored_format(content).map_err(NookError::Decryption)?;
    let stored_records =
        nook_core::deserialize_stored(content, format).map_err(NookError::Decryption)?;
    let secrets_key =
        nook_core::resolve_secrets_key(&stored_records, identity).map_err(NookError::Decryption)?;
    let members_key =
        nook_core::resolve_members_key(&stored_records, identity).map_err(NookError::Decryption)?;
    let crypto = nook_core::VaultCrypto::new(&secrets_key).map_err(NookError::Encryption)?;
    let mut armored = HashMap::with_capacity(stored_records.len());
    for record in &stored_records {
        armored.insert(record.key.clone(), record.value.clone());
    }
    let user_records = nook_core::user_stored_records(&stored_records);
    let db = nook_core::Database::from_stored_records_with_crypto(&user_records, &crypto)
        .map_err(NookError::Decryption)?;
    let jsonl = db.to_jsonl().map_err(NookError::Database)?;
    let secret_types = records_to_secret_types(&stored_records);
    Ok(LoadedVault {
        jsonl,
        armored,
        secret_types,
        secrets_key,
        members_key,
    })
}
