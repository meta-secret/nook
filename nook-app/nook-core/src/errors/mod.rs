//! Typed errors for the vault stack.

mod database;
mod event;
mod session;
mod vault_epoch;
mod vault_format;
mod vault_sync;

pub use database::{DatabaseError, DatabaseResult};
pub use event::EventError;
pub use nook_auth2::{
    AgeCryptoError, DeviceKeyProtectionError, EnrollmentError, MultiDeviceError, MultiDeviceResult,
    PasswordError, PasswordResult, SecretPayloadError, SecretPayloadResult, ValidationError,
    ValidationResult, VaultCryptoError,
};
pub use session::{SessionError, SessionResult};
pub use vault_epoch::{VaultEpochError, VaultEpochResult};
pub use vault_format::{VaultFormatError, VaultFormatResult};
pub use vault_sync::VaultSyncError;

use thiserror::Error;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultRecoveryErrorKind {
    Other,
    SentinelCeremonyRequired,
    SentinelPasswordUnlockForbidden,
}

/// Classify a boundary error into the recovery action understood by hosts.
/// Message compatibility stays in Rust until the boundary can transport the
/// concrete error enum directly.
#[must_use]
pub fn classify_vault_recovery_error(message: &str) -> VaultRecoveryErrorKind {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("sentinel vault unlock requires an opened-share ceremony")
        || normalized.contains("sentinelceremonyrequired")
    {
        VaultRecoveryErrorKind::SentinelCeremonyRequired
    } else if normalized.contains("password unlock is forbidden for sentinel")
        || normalized.contains("sentinelpasswordunlockforbidden")
    {
        VaultRecoveryErrorKind::SentinelPasswordUnlockForbidden
    } else {
        VaultRecoveryErrorKind::Other
    }
}

pub type VaultResult<T> = Result<T, VaultError>;

#[derive(Debug, Error)]
pub enum ExtensionIdentityHandoffError {
    #[error("Extension identity handoff nonce is invalid.")]
    InvalidNonce,

    #[error("Failed to serialize extension identity handoff.")]
    Serialize(#[source] serde_json::Error),

    #[error("Invalid extension identity handoff.")]
    Deserialize(#[source] serde_json::Error),

    #[error("Extension identity handoff does not match the requested device.")]
    BindingMismatch,
}

#[derive(Debug, Error)]
pub enum VaultError {
    #[error(transparent)]
    ExtensionIdentityHandoff(#[from] ExtensionIdentityHandoffError),

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

#[cfg(test)]
mod recovery_tests {
    use super::*;

    #[test]
    fn sentinel_recovery_errors_are_classified_in_core() {
        assert_eq!(
            classify_vault_recovery_error(
                "Sentinel vault unlock requires an opened-share ceremony; per-device auth envelopes cannot unlock this vault."
            ),
            VaultRecoveryErrorKind::SentinelCeremonyRequired
        );
        assert_eq!(
            classify_vault_recovery_error(
                "Password unlock is forbidden for sentinel vaults; use the opened-share ceremony instead."
            ),
            VaultRecoveryErrorKind::SentinelPasswordUnlockForbidden
        );
        assert_eq!(
            classify_vault_recovery_error("network failed"),
            VaultRecoveryErrorKind::Other
        );
    }
}
