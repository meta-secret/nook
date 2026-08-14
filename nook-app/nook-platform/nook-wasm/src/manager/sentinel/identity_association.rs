//! Identity-directory association for Sentinel ceremony lifecycle events.

use crate::NookError;
use crate::storage::indexed_db::{
    load_sentinel_genesis_share_delivery, save_sentinel_genesis_share_delivery,
};
use serde::{Deserialize, Deserializer, Serialize, de::Error as _};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredSentinelGenesisDelivery {
    pub(super) request: nook_core::SentinelGenesisRequest,
    pub(super) delivery: nook_core::SentinelGenesisShareDelivery,
    pub(super) identity_binding: SentinelDeliveryIdentityBinding,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(super) enum SentinelDeliveryIdentityBinding {
    LegacyUnbound,
    Bound {
        #[serde(rename = "identityId")]
        identity_id: nook_core::IdentityId,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSentinelGenesisDeliveryWire {
    request: nook_core::SentinelGenesisRequest,
    delivery: nook_core::SentinelGenesisShareDelivery,
    #[serde(default)]
    identity_binding: Option<SentinelDeliveryIdentityBinding>,
    #[serde(default)]
    identity_id: Option<nook_core::IdentityId>,
}

impl<'de> Deserialize<'de> for StoredSentinelGenesisDelivery {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = StoredSentinelGenesisDeliveryWire::deserialize(deserializer)?;
        let identity_binding =
            migrate_delivery_identity_binding(wire.identity_binding, wire.identity_id)
                .map_err(D::Error::custom)?;
        Ok(Self {
            request: wire.request,
            delivery: wire.delivery,
            identity_binding,
        })
    }
}

fn migrate_delivery_identity_binding(
    current: Option<SentinelDeliveryIdentityBinding>,
    legacy_identity_id: Option<nook_core::IdentityId>,
) -> Result<SentinelDeliveryIdentityBinding, &'static str> {
    Ok(match (current, legacy_identity_id) {
        (Some(binding), None) => binding,
        (None, Some(identity_id)) => SentinelDeliveryIdentityBinding::Bound { identity_id },
        (None, None) => SentinelDeliveryIdentityBinding::LegacyUnbound,
        (Some(_), Some(_)) => {
            return Err("Sentinel delivery has both current and legacy identity binding");
        }
    })
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
        if let SentinelDeliveryIdentityBinding::Bound { identity_id } = &stored.identity_binding {
            return Ok(identity_id.clone());
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
        stored.identity_binding = SentinelDeliveryIdentityBinding::Bound {
            identity_id: identity.identity_id.clone(),
        };
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
    let SentinelDeliveryIdentityBinding::Bound { identity_id } = &stored.identity_binding else {
        return Err(NookError::Database(
            "Sentinel delivery has no identity binding.".to_owned(),
        ));
    };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_delivery_binding_has_named_migration_states() -> anyhow::Result<()> {
        let identity_id = nook_core::IdentityId::generate()?;
        assert!(matches!(
            migrate_delivery_identity_binding(None, None),
            Ok(SentinelDeliveryIdentityBinding::LegacyUnbound)
        ));
        assert!(matches!(
            migrate_delivery_identity_binding(None, Some(identity_id.clone())),
            Ok(SentinelDeliveryIdentityBinding::Bound { identity_id: migrated })
                if migrated == identity_id
        ));
        assert!(
            migrate_delivery_identity_binding(
                Some(SentinelDeliveryIdentityBinding::LegacyUnbound),
                Some(identity_id),
            )
            .is_err()
        );
        Ok(())
    }
}
