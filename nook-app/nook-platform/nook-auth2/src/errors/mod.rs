//! Typed errors for portable vault key-access primitives.

mod age_crypto;
mod device_key_protection;
mod enrollment;
mod multi_device;
mod password;
mod secret_payload;
mod validation;
mod vault_crypto;

pub use age_crypto::AgeCryptoError;
pub use device_key_protection::{DeviceKeyProtectionError, DeviceKeyProtectionResult};
pub use enrollment::{EnrollmentError, EnrollmentResult};
pub use multi_device::{MultiDeviceError, MultiDeviceResult};
pub use password::{PasswordError, PasswordResult};
pub use secret_payload::{SecretPayloadError, SecretPayloadResult};
pub use validation::{ValidationError, ValidationResult};
pub use vault_crypto::{VaultCryptoError, VaultCryptoResult};
