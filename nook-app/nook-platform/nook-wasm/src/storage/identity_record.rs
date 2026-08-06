//! Local Identity control-record persistence (independent of vault `store_id`).

use super::indexed_db::{idb_delete_key, idb_get_string, idb_put_string};
use crate::NookError;

const IDENTITY_RECORD_KEY: &str = "identity_record_v1";

pub(crate) async fn load_identity_record() -> Result<Option<nook_core::IdentityRecord>, NookError> {
    let Some(raw) = idb_get_string(IDENTITY_RECORD_KEY).await? else {
        return Ok(None);
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| NookError::IndexedDb(format!("Identity record decode error: {error}")))
}

pub(crate) async fn save_identity_record(
    record: &nook_core::IdentityRecord,
) -> Result<(), NookError> {
    let raw = serde_json::to_string(record)
        .map_err(|error| NookError::IndexedDb(format!("Identity record encode error: {error}")))?;
    idb_put_string(IDENTITY_RECORD_KEY, &raw).await
}

#[allow(dead_code)]
pub(crate) async fn delete_identity_record() -> Result<(), NookError> {
    idb_delete_key(IDENTITY_RECORD_KEY).await
}

/// Ensure a local identity exists for the current app key.
///
/// Vault create requires an identity with at least one app key.
pub(crate) async fn ensure_local_identity_for_app_key(
    app_key: &nook_core::AppKey,
    label: &str,
) -> Result<nook_core::IdentityRecord, NookError> {
    if let Some(existing) = load_identity_record().await? {
        if existing
            .members
            .iter()
            .any(|member| member.app_id == *app_key.app_id())
        {
            return Ok(existing);
        }
        let mut updated = existing;
        updated
            .add_member(nook_core::IdentityMember {
                app_id: app_key.app_id().clone(),
                auth_id: app_key.auth_id(),
                public_key: app_key.public_key(),
                label: None,
            })
            .map_err(|error| NookError::Database(error.to_string()))?;
        save_identity_record(&updated).await?;
        return Ok(updated);
    }
    let record = nook_core::IdentityRecord::create_with_app_key(label, app_key, None)
        .map_err(|error| NookError::Database(error.to_string()))?;
    save_identity_record(&record).await?;
    Ok(record)
}

/// Synthesize an identity from a legacy vault auth envelope when none is stored.
pub(crate) async fn ensure_identity_from_legacy_vault(
    app_key: &nook_core::AppKey,
    store_id: &nook_core::StoreId,
    secrets_envelope: nook_core::AgeArmoredCiphertext,
    members_envelope: nook_core::AgeArmoredCiphertext,
    label: &str,
) -> Result<nook_core::IdentityRecord, NookError> {
    if let Some(existing) = load_identity_record().await? {
        return Ok(existing);
    }
    let member = nook_core::IdentityMember {
        app_id: app_key.app_id().clone(),
        auth_id: app_key.auth_id(),
        public_key: app_key.public_key(),
        label: None,
    };
    let record = nook_core::IdentityRecord::synthesize_from_legacy_vault(
        label,
        member,
        store_id.clone(),
        secrets_envelope,
        members_envelope,
    )
    .map_err(|error| NookError::Database(error.to_string()))?;
    save_identity_record(&record).await?;
    Ok(record)
}
