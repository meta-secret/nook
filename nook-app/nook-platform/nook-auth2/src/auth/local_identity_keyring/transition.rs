//! Owned keyring transitions preserve the prior usable owner on rejection.
use super::{LocalIdentityKeyring, LocalIdentityKeyringEntry};
use crate::{
    AgeArmoredCiphertext, AppId, AppKey, DeviceSigningPublicKey, IdentityId, MultiDeviceError,
    WrappedDeviceIdentity,
};

pub struct SigningSeedProtection<'a> {
    pub app_key: &'a AppKey,
    pub signing_seed: &'a str,
}

pub struct WrappedAppKeyReplacement<'a> {
    pub app_id: &'a AppId,
    pub wrapped_app_key: WrappedDeviceIdentity,
}

#[derive(Debug)]
pub struct ProtectedSigningEntry {
    pub entry: LocalIdentityKeyringEntry,
    pub signing_public_key: DeviceSigningPublicKey,
}

#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub struct KeyringEntryRejection {
    pub entry: LocalIdentityKeyringEntry,
    #[source]
    pub cause: MultiDeviceError,
}

impl KeyringEntryRejection {
    pub fn into_cause(self) -> MultiDeviceError {
        self.cause
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{cause}")]
pub struct KeyringRejection {
    pub keyring: LocalIdentityKeyring,
    #[source]
    pub cause: MultiDeviceError,
}

impl KeyringRejection {
    pub fn into_cause(self) -> MultiDeviceError {
        self.cause
    }
}

#[derive(Debug)]
pub struct RemovedLocalIdentityKey {
    pub keyring: LocalIdentityKeyring,
    pub entry: LocalIdentityKeyringEntry,
}

pub struct IdentitySigningSeedProtection<'a> {
    pub identity_id: &'a IdentityId,
    pub material: SigningSeedProtection<'a>,
}

pub(super) struct SealedSigningMaterial {
    pub(super) public_key: DeviceSigningPublicKey,
    pub(super) envelope: AgeArmoredCiphertext,
}

#[derive(Debug)]
pub struct ProtectedIdentityKeyring {
    pub keyring: LocalIdentityKeyring,
    pub signing_public_key: DeviceSigningPublicKey,
}
