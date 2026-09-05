//! `SigningIdentity` adapters for the portable Sentinel quorum unlock protocol.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{
    DeviceIdentity, DeviceSigningPublicKey, MultiDeviceError, SentinelUnlockPolicy,
    SentinelUnlockRequest, SentinelUnlockResponse, SentinelUnlockSession, SigningIdentity, StoreId,
    StoredSecretRecord,
};

/// Sentinel signing operations for the event-log-owned identity.
pub trait SentinelUnlockSigning {
    fn start_sentinel_unlock(
        &self,
        store_id: StoreId,
        policy: SentinelUnlockPolicy,
        records: &[StoredSecretRecord],
        requester_identity: &DeviceIdentity,
    ) -> Result<SentinelUnlockSession, MultiDeviceError>;

    fn respond_to_sentinel_unlock_request(
        &self,
        request: SentinelUnlockRequest,
        records: &[StoredSecretRecord],
        identity: &DeviceIdentity,
        authorized_requester_signing_key: &DeviceSigningPublicKey,
    ) -> Result<SentinelUnlockResponse, MultiDeviceError>;
}

impl SentinelUnlockSigning for SigningIdentity {
    fn start_sentinel_unlock(
        &self,
        store_id: StoreId,
        policy: SentinelUnlockPolicy,
        records: &[StoredSecretRecord],
        requester_identity: &DeviceIdentity,
    ) -> Result<SentinelUnlockSession, MultiDeviceError> {
        SentinelUnlockSession::start(
            store_id,
            policy,
            records,
            requester_identity,
            self.signing_key(),
        )
    }

    fn respond_to_sentinel_unlock_request(
        &self,
        request: SentinelUnlockRequest,
        records: &[StoredSecretRecord],
        identity: &DeviceIdentity,
        authorized_requester_signing_key: &DeviceSigningPublicKey,
    ) -> Result<SentinelUnlockResponse, MultiDeviceError> {
        request.check(authorized_requester_signing_key)?.respond(
            records,
            identity,
            self.signing_key(),
        )
    }
}
