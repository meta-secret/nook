//! Imported event-log evidence admitted before a pairing grant is refreshed.

use super::{
    ExtensionEventCount, ExtensionPairingGrantApproval, ExtensionPairingStateError,
    StoredExtensionPairingGrant,
};
use nook_auth2::StoreId;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ImportedExtensionEventLog {
    pub vault_store_id: StoreId,
    pub event_count: ExtensionEventCount,
    pub heads: Vec<String>,
    pub access_granted: bool,
}

enum ImportedExtensionAccess {
    Denied,
    Granted,
}

impl From<bool> for ImportedExtensionAccess {
    fn from(granted: bool) -> Self {
        if granted { Self::Granted } else { Self::Denied }
    }
}

impl ImportedExtensionEventLog {
    pub fn admit(self) -> Result<Self, ImportedExtensionEventLogError> {
        if matches!(
            ImportedExtensionAccess::from(self.access_granted),
            ImportedExtensionAccess::Granted
        ) && (self.event_count.is_zero() || self.heads.is_empty())
        {
            return Err(ImportedExtensionEventLogError);
        }
        Ok(self)
    }
}

impl StoredExtensionPairingGrant {
    pub(super) fn from_import(
        grant: ExtensionPairingGrantApproval,
        imported: ImportedExtensionEventLog,
        observed_at: String,
    ) -> Result<Self, ExtensionPairingStateError> {
        if imported.vault_store_id != grant.vault_store_id {
            return Err(ExtensionPairingStateError::ImportedVaultMismatch);
        }
        if matches!(
            ImportedExtensionAccess::from(imported.access_granted),
            ImportedExtensionAccess::Denied
        ) {
            return Err(ExtensionPairingStateError::ImportedAccessDenied);
        }
        Ok(Self {
            vault_type: grant.vault_type,
            device_id: grant.device_id,
            device_public_key: grant.device_public_key,
            device_signing_public_key: grant.device_signing_public_key,
            device_label: grant.device_label,
            vault_store_id: grant.vault_store_id,
            vault_name: grant.vault_name,
            approved_at: grant.approved_at,
            scopes: grant.scopes,
            sync_provider_count: grant.sync_provider_count,
            event_count: imported.event_count,
            event_log_heads: imported.heads,
            last_local_sync_at: observed_at,
        })
    }
}

#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("imported extension event-log evidence is inconsistent")]
pub struct ImportedExtensionEventLogError;
