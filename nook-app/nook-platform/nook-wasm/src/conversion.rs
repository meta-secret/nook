//! Glue between `nook_core` data structures and typed wasm exports.

use crate::NookJoinRequest;
use crate::NookVaultMember;
use crate::types::NookVaultSyncResult;
use crate::{NookError, NookVaultManager};
use js_sys::Date;
use nook_core::{ResolveMemberRosterRequest, SymmetricKey, VaultMember};
use wasm_bindgen::JsError;

/// Named values required by NookVaultSyncResult::sync_result_session.
pub(crate) struct SyncResultSessionRequest<'a> {
    pub(crate) manager: &'a NookVaultManager,
    pub(crate) changed: bool,
}

impl NookVaultSyncResult {
    pub(crate) fn sync_result_unchanged() -> Result<NookVaultSyncResult, JsError> {
        Ok(NookVaultSyncResult::unchanged())
    }
}

impl NookVaultSyncResult {
    pub(crate) fn sync_result_access_status(
        status: nook_core::VaultAccessStatus,
    ) -> Result<NookVaultSyncResult, JsError> {
        Ok(NookVaultSyncResult::with_access_status(status))
    }
}

impl NookVaultSyncResult {
    pub(crate) fn sync_result_session(
        request: SyncResultSessionRequest<'_>,
    ) -> Result<NookVaultSyncResult, JsError> {
        let SyncResultSessionRequest { manager, changed } = request;
        Ok(NookVaultSyncResult::session(manager, changed)?)
    }
}

/// One browser clock observation, kept typed until the JS/storage text edge.
pub(crate) struct BrowserTimestamp {
    value: nook_core::IsoTimestamp,
}
impl BrowserTimestamp {
    pub(crate) fn now() -> Self {
        Self {
            value: nook_core::IsoTimestamp::from_trusted(Date::new_0().to_iso_string().into()),
        }
    }
    pub(crate) fn into_iso_string(self) -> String {
        self.value.into_inner()
    }
}

pub(crate) struct LoadedVault {
    pub(crate) meta: nook_core::VaultMetaState,
    pub(crate) secrets_key: nook_core::SymmetricKey,
    pub(crate) members_key: nook_core::SymmetricKey,
}

/// Named values required by LoadedVault::unlock.
pub(crate) struct LoadedVaultUnlockRequest<'a> {
    pub(crate) content: &'a str,
    pub(crate) identity: &'a nook_core::DeviceIdentity,
}

impl LoadedVault {
    pub(crate) fn unlock(request: LoadedVaultUnlockRequest<'_>) -> Result<Self, NookError> {
        let LoadedVaultUnlockRequest { content, identity } = request;
        let loaded = nook_core::VaultContent::new(content)
            .unlock(identity)?
            .into_material();
        Ok(Self {
            meta: loaded.meta,
            secrets_key: loaded.secrets_key,
            members_key: loaded.members_key,
        })
    }
}

impl NookJoinRequest {
    pub(crate) fn pending_join_records(
        records: &[nook_core::StoredSecretRecord],
    ) -> Result<Vec<nook_core::JoinRequest>, NookError> {
        Ok(nook_core::VaultRecordView::new(records).list_join_requests()?)
    }
}

/// Named values required by NookVaultMember::vault_member_records.
pub(crate) struct VaultMemberRecordsRequest<'a> {
    pub(crate) records: &'a [nook_core::StoredSecretRecord],
    pub(crate) members_key: &'a str,
}

/// Named values required by NookVaultMember::vault_members_to_vec.
pub(crate) struct VaultMemberProjectionRequest<'a> {
    pub(crate) records: &'a [nook_core::StoredSecretRecord],
    pub(crate) members_key: &'a str,
}

impl NookVaultMember {
    pub(crate) fn vault_member_records(
        request: VaultMemberRecordsRequest<'_>,
    ) -> Result<Vec<nook_core::VaultMember>, NookError> {
        let VaultMemberRecordsRequest {
            records,
            members_key,
        } = request;
        Ok(VaultMember::resolve_member_roster(
            ResolveMemberRosterRequest {
                records: records,
                members_key: &SymmetricKey::parse(members_key)?,
            },
        )?)
    }
}

impl NookJoinRequest {
    pub(crate) fn pending_joins_to_vec(
        records: &[nook_core::StoredSecretRecord],
    ) -> Result<Vec<crate::NookJoinRequest>, NookError> {
        Ok(NookJoinRequest::joins_to_vec(
            NookJoinRequest::pending_join_records(records)?,
        ))
    }
}

impl NookVaultMember {
    pub(crate) fn vault_members_to_vec(
        request: VaultMemberProjectionRequest<'_>,
    ) -> Result<Vec<crate::NookVaultMember>, NookError> {
        let VaultMemberProjectionRequest {
            records,
            members_key,
        } = request;
        Ok(NookVaultMember::members_to_vec(
            NookVaultMember::vault_member_records(VaultMemberRecordsRequest {
                records: records,
                members_key: members_key,
            })?,
        ))
    }
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
                .requires_genesis(nook_core::VaultGenesisIntent::DetectExisting)
                .is_err()
        );
        assert!(NookVaultSyncResult::sync_result_unchanged().is_ok());
        assert!(
            NookVaultSyncResult::sync_result_access_status(nook_core::VaultAccessStatus::Ready)
                .is_ok()
        );
        assert!(BrowserTimestamp::now().into_iso_string().ends_with('Z'));
        assert!(
            NookJoinRequest::pending_join_records(&[])
                .unwrap()
                .is_empty()
        );
        assert!(
            NookJoinRequest::pending_joins_to_vec(&[])
                .unwrap()
                .is_empty()
        );
        assert!(
            NookVaultMember::vault_members_to_vec(VaultMemberProjectionRequest {
                records: &[],
                members_key: "not-a-key"
            })
            .is_err()
        );
    }
}
