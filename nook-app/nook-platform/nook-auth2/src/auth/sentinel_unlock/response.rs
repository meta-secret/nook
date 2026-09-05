#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use ed25519_dalek::{Signer, SigningKey};

use super::{
    SentinelUnlockContribution, SentinelUnlockRequest, SentinelUnlockResponse, UNLOCK_VERSION,
    sentinel_signing,
};
use crate::{
    DeviceIdentity, DeviceSigningPublicKey, MultiDeviceError, MultiDeviceResult,
    StoredSecretRecord, encrypt_for_recipient, open_sentinel_share_for_identity,
};

/// A request with a valid signature bound to the supplied expected signing key.
///
/// The caller establishes that key's provenance. This stage does not independently
/// prove membership, freshness, replay protection, or authorization at a later effect.
/// Its consuming response operation opens the participant's local encrypted share.
///
/// The public transition path accepts raw data only through checking:
///
/// ```
/// use nook_auth2::{SentinelUnlockRequest, StoredSecretRecord, DeviceIdentity,
///     DeviceSigningPublicKey, MultiDeviceResult, SentinelUnlockResponse};
/// use ed25519_dalek::SigningKey;
/// let decode = |json: &str| serde_json::from_str::<SentinelUnlockRequest>(json);
/// let respond = |request: SentinelUnlockRequest, records: &[StoredSecretRecord],
///     identity: &DeviceIdentity, signing: &SigningKey, expected: &DeviceSigningPublicKey|
///     -> MultiDeviceResult<SentinelUnlockResponse> {
///     request.check(expected)?.respond(records, identity, signing)
/// };
/// ```
///
/// Raw requests cannot respond before they are checked.
///
/// ```compile_fail,E0599
/// use nook_auth2::{SentinelUnlockRequest, StoredSecretRecord, DeviceIdentity};
/// use ed25519_dalek::SigningKey;
/// let respond = |request: SentinelUnlockRequest, records: &[StoredSecretRecord],
///     identity: &DeviceIdentity, signing: &SigningKey| {
///     request.respond(records, identity, signing)
/// };
/// ```
///
/// A checked request cannot generate a second response after it is consumed.
///
/// ```compile_fail,E0382
/// use nook_auth2::{SentinelUnlockRequest, StoredSecretRecord, DeviceIdentity,
///     DeviceSigningPublicKey, MultiDeviceResult, SentinelUnlockResponse};
/// use ed25519_dalek::SigningKey;
/// let respond = |request: SentinelUnlockRequest, records: &[StoredSecretRecord],
///     identity: &DeviceIdentity, signing: &SigningKey, expected: &DeviceSigningPublicKey|
///     -> MultiDeviceResult<SentinelUnlockResponse> {
///     let checked = request.check(expected)?;
///     checked.respond(records, identity, signing)?;
///     checked.respond(records, identity, signing)
/// };
/// ```
///
/// Unchecked construction is unavailable even when the caller already has raw data.
///
/// ```compile_fail,E0451
/// use nook_auth2::{CheckedSentinelUnlockRequest, SentinelUnlockRequest};
/// let forge = |request: SentinelUnlockRequest| CheckedSentinelUnlockRequest { request };
/// ```
///
/// Deserialization cannot bypass request checking.
///
/// ```compile_fail,E0277
/// use nook_auth2::CheckedSentinelUnlockRequest;
/// let decode = |json: &str| serde_json::from_str::<CheckedSentinelUnlockRequest>(json);
/// ```
pub struct CheckedSentinelUnlockRequest {
    request: SentinelUnlockRequest,
}

impl SentinelUnlockRequest {
    pub fn check(
        self,
        expected_signing_key: &DeviceSigningPublicKey,
    ) -> MultiDeviceResult<CheckedSentinelUnlockRequest> {
        self.validate()?;
        if &self.requester_signing_public_key != expected_signing_key {
            return Err(MultiDeviceError::InvalidSentinelUnlockPayload);
        }
        Ok(CheckedSentinelUnlockRequest { request: self })
    }
}

impl CheckedSentinelUnlockRequest {
    pub fn respond(
        self,
        records: &[StoredSecretRecord],
        identity: &DeviceIdentity,
        signing_key: &SigningKey,
    ) -> MultiDeviceResult<SentinelUnlockResponse> {
        let request = self.request;
        let opened_share = open_sentinel_share_for_identity(records, identity)?;
        if opened_share.threshold != request.policy.threshold
            || opened_share.required_participants != request.policy.required_participants
            || opened_share.device_id != identity.device_id().as_str()
            || u8::from(opened_share.share_index) == 0
            || u8::from(opened_share.share_index) > u8::from(request.policy.required_participants)
        {
            return Err(MultiDeviceError::InvalidSentinelUnlockPayload);
        }
        let participant_signing_public_key = sentinel_signing::signing_public_key(signing_key);
        let contribution = SentinelUnlockContribution {
            version: UNLOCK_VERSION,
            session_id: request.session_id.clone(),
            store_id: request.store_id.clone(),
            policy: request.policy,
            participant_device_id: identity.device_id().clone(),
            participant_signing_public_key: participant_signing_public_key.clone(),
            opened_share,
        };
        let plaintext = serde_json::to_vec(&contribution)
            .map_err(|_| MultiDeviceError::InvalidSentinelUnlockPayload)?;
        let mut response = SentinelUnlockResponse {
            version: UNLOCK_VERSION,
            session_id: request.session_id.clone(),
            store_id: request.store_id.clone(),
            policy: request.policy,
            participant_device_id: identity.device_id().clone(),
            participant_signing_public_key,
            share_index: contribution.opened_share.share_index,
            ciphertext: encrypt_for_recipient(
                &plaintext,
                &request.requester_encryption_public_key,
            )?,
            signature: String::new(),
        };
        response.signature = hex::encode(signing_key.sign(&response.signing_bytes()?).to_bytes());
        Ok(response)
    }
}

impl SentinelUnlockResponse {
    pub(super) fn validate_binding(
        &self,
        request: &SentinelUnlockRequest,
    ) -> MultiDeviceResult<()> {
        if self.version != UNLOCK_VERSION
            || self.session_id != request.session_id
            || self.store_id != request.store_id
            || self.policy != request.policy
            || self.participant_signing_public_key.is_empty()
            || u8::from(self.share_index) == 0
            || u8::from(self.share_index) > u8::from(request.policy.required_participants)
        {
            return Err(MultiDeviceError::InvalidSentinelUnlockSession);
        }
        Ok(())
    }
    pub(super) fn signing_bytes(&self) -> MultiDeviceResult<Vec<u8>> {
        serde_json::to_vec(&(
            self.version,
            &self.session_id,
            &self.store_id,
            self.policy,
            &self.participant_device_id,
            &self.participant_signing_public_key,
            self.share_index,
            &self.ciphertext,
        ))
        .map_err(|_| MultiDeviceError::InvalidSentinelUnlockPayload)
    }
    pub(super) fn verify_signature(&self) -> MultiDeviceResult<()> {
        sentinel_signing::verify_signature(
            &self.participant_signing_public_key,
            &self.signature,
            &self.signing_bytes()?,
            || MultiDeviceError::InvalidSentinelUnlockSignature,
        )
    }
}
