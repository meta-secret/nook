//! Glue between `nook_core` data structures and typed wasm exports.

use crate::types::{
    NookVaultSyncResult, joins_to_vec, members_to_vec,
};
use crate::{NookError, NookVaultManager};
use std::collections::HashMap;
use wasm_bindgen::JsError;

pub(crate) use crate::types::records_to_vec;

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

pub(crate) fn sync_result_unchanged() -> Result<NookVaultSyncResult, JsError> {
    Ok(NookVaultSyncResult::unchanged())
}

pub(crate) fn sync_result_access_status(status: &str) -> Result<NookVaultSyncResult, JsError> {
    Ok(NookVaultSyncResult::with_access_status(status.to_owned()))
}

pub(crate) fn sync_result_session(
    manager: &NookVaultManager,
    changed: bool,
) -> Result<NookVaultSyncResult, JsError> {
    Ok(NookVaultSyncResult::session(manager, changed)?)
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

pub(crate) fn pending_join_records(
    records: &[nook_core::StoredSecretRecord],
) -> Vec<nook_core::JoinRequest> {
    nook_core::list_join_requests(records)
}

pub(crate) fn vault_member_records(
    records: &[nook_core::StoredSecretRecord],
    members_key: &str,
) -> Result<Vec<nook_core::VaultMember>, NookError> {
    nook_core::resolve_member_roster(records, members_key).map_err(NookError::Decryption)
}

pub(crate) fn pending_joins_to_vec(
    records: &[nook_core::StoredSecretRecord],
) -> Vec<crate::NookJoinRequest> {
    joins_to_vec(pending_join_records(records))
}

pub(crate) fn vault_members_to_vec(
    records: &[nook_core::StoredSecretRecord],
    members_key: &str,
) -> Result<Vec<crate::NookVaultMember>, NookError> {
    Ok(members_to_vec(vault_member_records(records, members_key)?))
}
