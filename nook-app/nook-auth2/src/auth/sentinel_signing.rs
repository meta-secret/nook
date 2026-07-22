//! Shared Ed25519 primitives for Sentinel ceremony protocols.

use crate::{DeviceSigningPublicKey, MultiDeviceError, MultiDeviceResult};
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};

pub(super) fn signing_public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
    DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().to_bytes()))
}

pub(super) fn verify_signature(
    public_key: &DeviceSigningPublicKey,
    signature: &str,
    bytes: &[u8],
    invalid: fn() -> MultiDeviceError,
) -> MultiDeviceResult<()> {
    let public: [u8; 32] = hex::decode(public_key.as_str())
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(invalid)?;
    let signature: [u8; 64] = hex::decode(signature)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(invalid)?;
    let verifying_key = VerifyingKey::from_bytes(&public).map_err(|_| invalid())?;
    verifying_key
        .verify(bytes, &Signature::from_bytes(&signature))
        .map_err(|_| invalid())
}
