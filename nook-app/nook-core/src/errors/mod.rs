//! Typed errors for the vault stack.

mod database;
mod event;
mod session;
mod vault_epoch;
mod vault_format;
mod vault_sync;

pub use database::{DatabaseError, DatabaseResult};
pub use event::EventError;
pub use nook_auth::{
    AgeCryptoError, DeviceKeyProtectionError, EnrollmentError, MultiDeviceError, MultiDeviceResult,
    PasswordError, PasswordResult, SecretPayloadError, SecretPayloadResult, ValidationError,
    ValidationResult, VaultCryptoError,
};
pub use session::{SessionError, SessionResult};
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
