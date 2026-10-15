//! Owned keyring transitions preserve the prior usable owner on rejection.
use super::{LocalIdentityKeyring, LocalIdentityKeyringEntry};
use crate::{AppId, MultiDeviceError, WrappedDeviceIdentity};

pub struct WrappedAppKeyReplacement<'a> {
    pub app_id: &'a AppId,
    pub wrapped_app_key: WrappedDeviceIdentity,
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
