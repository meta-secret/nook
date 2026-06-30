//! Key-epoch rotation errors.

use super::multi_device::MultiDeviceError;
use super::vault_crypto::VaultCryptoError;
use thiserror::Error;

pub type VaultEpochResult<T> = Result<T, VaultEpochError>;

#[derive(Debug, Error)]
pub enum VaultEpochError {
    #[error("Secret {key} missing type metadata.")]
    MissingSecretType { key: String },

    #[error(transparent)]
    MultiDevice(#[from] MultiDeviceError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),
}
