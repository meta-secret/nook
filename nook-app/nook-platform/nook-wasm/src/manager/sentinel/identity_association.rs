//! Identity-directory association for Sentinel ceremony lifecycle events.

use crate::NookError;
use crate::storage::indexed_db::load_sentinel_genesis_share_delivery;
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
    let stored_identity_id =
        load_sentinel_genesis_share_delivery(store_id.as_str(), app_key.device_id().as_str())
            .await?
            .map(|stored_json| {
                serde_json::from_str::<StoredSentinelGenesisDelivery>(&stored_json)
                    .map_err(|error| NookError::Serialization(error.to_string()))
            })
            .transpose()?
            .and_then(|stored| stored.identity_id);
    match stored_identity_id {
        Some(identity_id) => Ok(identity_id),
        None => ensure_local_identity(app_key, "Personal").await,
    }
}
