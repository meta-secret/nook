//! Glue between `nook_core` data structures and typed wasm exports.

use crate::types::{NookVaultSyncResult, joins_to_vec, members_to_vec};
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
    Ok(nook_core::content_requires_genesis(content, force_genesis)?)
}

pub(crate) fn access_status_for_vault_content(
    content: &str,
    identity: &nook_core::DeviceIdentity,
) -> Result<String, NookError> {
    Ok(nook_core::access_status_for_vault_content(
        content, identity,
    )?)
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
    nook_core::apply_member_records(armored, member_records);
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
    let loaded = nook_core::load_stored_vault(content, identity)?;
    Ok(LoadedVault {
        jsonl: loaded.jsonl,
        armored: loaded.armored,
        secret_types: loaded.secret_types,
        secrets_key: loaded.secrets_key,
        members_key: loaded.members_key,
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
    Ok(nook_core::resolve_member_roster(records, members_key)?)
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
