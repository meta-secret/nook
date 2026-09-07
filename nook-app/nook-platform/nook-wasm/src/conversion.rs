//! Glue between `nook_core` data structures and typed wasm exports.

use crate::types::{NookVaultSyncResult, joins_to_vec, members_to_vec};
use crate::{NookError, NookVaultManager};
use js_sys::Date;
use nook_core::SymmetricKey;
use wasm_bindgen::JsError;

pub(crate) fn sync_result_unchanged() -> Result<NookVaultSyncResult, JsError> {
    Ok(NookVaultSyncResult::unchanged())
}

pub(crate) fn sync_result_access_status(
    status: nook_core::VaultAccessStatus,
) -> Result<NookVaultSyncResult, JsError> {
    Ok(NookVaultSyncResult::with_access_status(status))
}

pub(crate) fn sync_result_session(
    manager: &NookVaultManager,
    changed: bool,
) -> Result<NookVaultSyncResult, JsError> {
    Ok(NookVaultSyncResult::session(manager, changed)?)
}

pub(crate) fn wasm_iso_timestamp() -> String {
    Date::new_0().to_iso_string().into()
}

pub(crate) struct LoadedVault {
    pub(crate) meta: nook_core::VaultMetaState,
    pub(crate) secrets_key: nook_core::SymmetricKey,
    pub(crate) members_key: nook_core::SymmetricKey,
}

impl LoadedVault {
    pub(crate) fn unlock(
        content: &str,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<Self, NookError> {
        let loaded = nook_core::VaultContent::new(content).unlock(identity)?;
        Ok(Self {
            meta: loaded.meta,
            secrets_key: loaded.secrets_key,
            members_key: loaded.members_key,
        })
    }
}

pub(crate) fn pending_join_records(
    records: &[nook_core::StoredSecretRecord],
) -> Result<Vec<nook_core::JoinRequest>, NookError> {
    Ok(nook_core::list_join_requests(records)?)
}

pub(crate) fn vault_member_records(
    records: &[nook_core::StoredSecretRecord],
    members_key: &str,
) -> Result<Vec<nook_core::VaultMember>, NookError> {
    Ok(nook_core::resolve_member_roster(
        records,
        &SymmetricKey::parse(members_key)?,
    )?)
}

pub(crate) fn pending_joins_to_vec(
    records: &[nook_core::StoredSecretRecord],
) -> Result<Vec<crate::NookJoinRequest>, NookError> {
    Ok(joins_to_vec(pending_join_records(records)?))
}

pub(crate) fn vault_members_to_vec(
    records: &[nook_core::StoredSecretRecord],
    members_key: &str,
) -> Result<Vec<crate::NookVaultMember>, NookError> {
    Ok(members_to_vec(vault_member_records(records, members_key)?))
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn conversion_helpers_cover_content_and_empty_projection_paths() {
        assert!(
            nook_core::VaultContent::new("not yaml")
                .requires_genesis(false)
                .is_err()
        );
        assert!(sync_result_unchanged().is_ok());
        assert!(sync_result_access_status(nook_core::VaultAccessStatus::Ready).is_ok());
        assert!(wasm_iso_timestamp().ends_with('Z'));
        assert!(pending_join_records(&[]).unwrap().is_empty());
        assert!(pending_joins_to_vec(&[]).unwrap().is_empty());
        assert!(vault_members_to_vec(&[], "not-a-key").is_err());
    }
}
