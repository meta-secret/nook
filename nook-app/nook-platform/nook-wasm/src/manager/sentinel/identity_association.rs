//! Identity-directory association for Sentinel ceremony lifecycle events.

use crate::NookError;
use crate::storage::indexed_db::{
    load_sentinel_genesis_share_delivery, save_sentinel_genesis_share_delivery,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredSentinelGenesisDelivery {
    pub(super) request: nook_core::SentinelGenesisRequest,
    pub(super) delivery: nook_core::SentinelGenesisShareDelivery,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) identity_id: Option<nook_core::IdentityId>,
}

pub(super) async fn ensure_local_identity(
    app_key: &nook_core::AppKey,
    label: &str,
) -> Result<nook_core::IdentityId, NookError> {
    Ok(
        crate::storage::identity_record::ensure_local_identity_for_app_key(app_key, label)
            .await?
            .identity_id,
    )
}

pub(super) async fn identity_for_unlock(
    app_key: &nook_core::AppKey,
    store_id: &nook_core::StoreId,
) -> Result<nook_core::IdentityId, NookError> {
    let stored_json =
        load_sentinel_genesis_share_delivery(store_id.as_str(), app_key.device_id().as_str())
            .await?;
    if let Some(stored_json) = stored_json {
        let mut stored: StoredSentinelGenesisDelivery = serde_json::from_str(&stored_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        if let Some(identity_id) = stored.identity_id.clone() {
            return Ok(identity_id);
        }
        if stored.delivery.store_id != *store_id {
            return Err(NookError::Database(
                "Stored Sentinel delivery does not match the requested vault.".to_owned(),
            ));
        }
        let _ = nook_core::accept_sentinel_genesis_share_delivery(
            &stored.delivery,
            &stored.request,
            app_key,
        )?;
        let identity = crate::storage::identity_record::ensure_unambiguous_identity_for_app_key(
            app_key, "Personal",
        )
        .await?;
        stored.identity_id = Some(identity.identity_id.clone());
        persist_delivery_identity_binding(&stored, app_key).await?;
        return Ok(identity.identity_id);
    }
    if let Some(identity_id) =
        crate::storage::identity_record::identity_for_sentinel_vault(app_key, store_id).await?
    {
        return Ok(identity_id);
    }
    ensure_local_identity(app_key, "Personal").await
}

pub(super) async fn persist_delivery_identity_binding(
    stored: &StoredSentinelGenesisDelivery,
    app_key: &nook_core::AppKey,
) -> Result<(), NookError> {
    let identity_id = stored.identity_id.as_ref().ok_or_else(|| {
        NookError::Database("Sentinel delivery has no identity binding.".to_owned())
    })?;
    crate::storage::identity_record::associate_sentinel_vault_with_identity(
        identity_id,
        app_key,
        stored.delivery.store_id.clone(),
    )
    .await?;
    let stored_json = serde_json::to_string(stored)
        .map_err(|error| NookError::Serialization(error.to_string()))?;
    save_sentinel_genesis_share_delivery(
        stored.delivery.store_id.as_str(),
        app_key.device_id().as_str(),
        &stored_json,
    )
    .await
}
