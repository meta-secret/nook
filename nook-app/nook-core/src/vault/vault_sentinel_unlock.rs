//! `SigningIdentity` adapters for the portable Nexus quorum unlock protocol.

use crate::{
    DeviceIdentity, SentinelUnlockPolicy, SentinelUnlockRequest, SentinelUnlockResponse,
    SentinelUnlockSession, SigningIdentity, StoreId, StoredSecretRecord,
};

pub fn start_sentinel_unlock(
    store_id: StoreId,
    policy: SentinelUnlockPolicy,
    records: &[StoredSecretRecord],
    requester_identity: &DeviceIdentity,
    requester_signing: &SigningIdentity,
) -> Result<SentinelUnlockSession, crate::MultiDeviceError> {
    nook_auth2::start_sentinel_unlock(
        store_id,
        policy,
        records,
        requester_identity,
        requester_signing.signing_key(),
    )
}

pub fn respond_to_sentinel_unlock_request(
    request: &SentinelUnlockRequest,
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
    signing: &SigningIdentity,
) -> Result<SentinelUnlockResponse, crate::MultiDeviceError> {
    nook_auth2::respond_to_sentinel_unlock_request(
        request,
        records,
        identity,
        signing.signing_key(),
    )
}
