//! `SigningIdentity` adapters for the portable Nexus quorum unlock protocol.

use crate::{
    DeviceIdentity, NexusUnlockPolicy, NexusUnlockRequest, NexusUnlockResponse, NexusUnlockSession,
    SigningIdentity, StoreId, StoredSecretRecord,
};

pub fn start_nexus_unlock(
    store_id: StoreId,
    policy: NexusUnlockPolicy,
    records: &[StoredSecretRecord],
    requester_identity: &DeviceIdentity,
    requester_signing: &SigningIdentity,
) -> Result<NexusUnlockSession, crate::MultiDeviceError> {
    nook_auth2::start_nexus_unlock(
        store_id,
        policy,
        records,
        requester_identity,
        requester_signing.signing_key(),
    )
}

pub fn respond_to_nexus_unlock_request(
    request: &NexusUnlockRequest,
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
    signing: &SigningIdentity,
) -> Result<NexusUnlockResponse, crate::MultiDeviceError> {
    nook_auth2::respond_to_nexus_unlock_request(request, records, identity, signing.signing_key())
}
