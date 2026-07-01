//! Typed errors for the vault stack.

mod age_crypto;
mod database;
mod enrollment;
mod event;
mod multi_device;
mod password;
mod secret_payload;
mod session;
mod validation;
mod vault_crypto;
mod vault_epoch;
mod vault_format;
mod vault_sync;

pub use age_crypto::AgeCryptoError;
pub use database::{DatabaseError, DatabaseResult};
pub use enrollment::{EnrollmentError, EnrollmentResult};
pub use event::EventError;
pub use multi_device::{MultiDeviceError, MultiDeviceResult};
pub use password::{PasswordError, PasswordResult};
pub use secret_payload::{SecretPayloadError, SecretPayloadResult};
pub use session::{SessionError, SessionResult};
pub use validation::{ValidationError, ValidationResult};
pub use vault_crypto::{VaultCryptoError, VaultCryptoResult};
pub use vault_epoch::{VaultEpochError, VaultEpochResult};
pub use vault_format::{VaultFormatError, VaultFormatResult};
pub use vault_sync::VaultSyncError;

use thiserror::Error;

pub type VaultResult<T> = Result<T, VaultError>;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error(transparent)]
    Event(#[from] EventError),

    #[error(transparent)]
    Enrollment(#[from] EnrollmentError),

    #[error(transparent)]
    Validation(#[from] ValidationError),

    #[error(transparent)]
    VaultCrypto(#[from] VaultCryptoError),

    #[error(transparent)]
    VaultFormat(#[from] VaultFormatError),

    #[error(transparent)]
    SecretPayload(#[from] SecretPayloadError),

    #[error(transparent)]
    Password(#[from] PasswordError),

    #[error(transparent)]
    MultiDevice(#[from] MultiDeviceError),

    #[error(transparent)]
    Database(#[from] DatabaseError),

    #[error(transparent)]
    Session(#[from] SessionError),

    #[error(transparent)]
    VaultSync(#[from] VaultSyncError),

    #[error(transparent)]
    VaultEpoch(#[from] VaultEpochError),

    #[error(transparent)]
    Age(#[from] AgeCryptoError),
}
