//! Descriptive handoff evidence has no access to local protected-key storage.
//! New version-1 rows are populated only by a fresh authenticated handoff.
//! Older installations have no row and remain explicitly unknown. No migration
//! fabricates a passkey from membership or changes existing local wrappers.

use crate::{IdbPutStringRequest, NookDatabase, NookError, StoredStringRecord};
use nook_core::{
    AppId, AppProtectionAppBinding, AppProtectionAppBindingRequest, AppProtectionAssociation,
    AppProtectionDescriptor,
};

pub(crate) struct PeerProtectionStore;

struct PeerProtectionDecodeRequest<'a> {
    app_id: &'a AppId,
    value: &'a str,
}

impl PeerProtectionStore {
    fn key(app_id: &AppId) -> String {
        format!("peer_app_protection_v1:{app_id}")
    }

    pub(crate) async fn save(descriptor: &AppProtectionDescriptor) -> Result<(), NookError> {
        let key = Self::key(&descriptor.app_id);
        let value = serde_json::to_string(descriptor).map_err(NookError::PeerProtectionEncode)?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &key,
            value: &value,
        })
        .await
    }

    pub(crate) async fn load(app_id: &AppId) -> Result<AppProtectionAssociation, NookError> {
        match NookDatabase::idb_get_string(&Self::key(app_id)).await? {
            StoredStringRecord::MissingKey => Ok(AppProtectionAssociation::Unknown),
            StoredStringRecord::Stored(value) => Self::decode(PeerProtectionDecodeRequest {
                app_id,
                value: &value,
            }),
        }
    }

    fn decode(
        request: PeerProtectionDecodeRequest<'_>,
    ) -> Result<AppProtectionAssociation, NookError> {
        let descriptor: AppProtectionDescriptor =
            serde_json::from_str(request.value).map_err(NookError::PeerProtectionDecode)?;
        match (AppProtectionAppBindingRequest {
            observed: &descriptor.app_id,
            expected: request.app_id,
        })
        .classify()
        {
            AppProtectionAppBinding::Matched => Ok(descriptor.association),
            AppProtectionAppBinding::DifferentApp => Err(NookError::AppProtectionBindingMismatch),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::AppKey;

    #[test]
    fn peer_decode_preserves_serde_cause_and_rejects_foreign_app() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let foreign = AppKey::generate()?;
        assert!(matches!(
            PeerProtectionStore::decode(PeerProtectionDecodeRequest {
                app_id: app.app_id(),
                value: "invalid JSON"
            }),
            Err(NookError::PeerProtectionDecode(_))
        ));
        let value = serde_json::to_string(&AppProtectionDescriptor {
            app_id: app.app_id().clone(),
            association: AppProtectionAssociation::PinOrPassphrase,
        })?;
        assert_eq!(
            PeerProtectionStore::decode(PeerProtectionDecodeRequest {
                app_id: app.app_id(),
                value: &value
            })?,
            AppProtectionAssociation::PinOrPassphrase
        );
        assert!(matches!(
            PeerProtectionStore::decode(PeerProtectionDecodeRequest {
                app_id: foreign.app_id(),
                value: &value
            }),
            Err(NookError::AppProtectionBindingMismatch)
        ));
        Ok(())
    }
}
