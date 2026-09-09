//! Inputs and ownership-bearing outcomes of identity transitions.
use super::{IdentityMember, IdentityRecord, IdentityVaultDekReconciliation};
use crate::{AppId, AppKey, DeviceSigningPublicKey, MultiDeviceError, StoreId, VaultKeys};

#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub struct IdentityRecordRejection {
    pub identity: IdentityRecord,
    #[source]
    pub cause: MultiDeviceError,
}
impl IdentityRecordRejection {
    pub fn into_cause(self) -> MultiDeviceError {
        self.cause
    }
}

pub struct IdentityVaultKeys {
    pub identity: IdentityRecord,
    pub keys: VaultKeys,
}

pub struct IdentityVaultKeyOpening<'a> {
    pub app_key: &'a AppKey,
    pub store_id: StoreId,
}

pub struct IdentityMemberVaultGrant<'a> {
    pub member: &'a IdentityMember,
    pub keys_by_store: &'a [(StoreId, VaultKeys)],
}

pub struct IdentityMemberSigningUpdate<'a> {
    pub app_id: &'a AppId,
    pub signing_public_key: &'a DeviceSigningPublicKey,
}

pub struct IdentityLegacyVaultReconciliation<'a> {
    pub app_key: &'a AppKey,
    pub store_id: &'a StoreId,
    pub reconciliation: &'a IdentityVaultDekReconciliation,
}

pub struct IdentityLegacyVaultImport<'a> {
    pub app_key: &'a AppKey,
    pub store_id: StoreId,
    pub reconciliation: &'a IdentityVaultDekReconciliation,
}
