//! Passkey and PIN protection for browser X25519 device identities.
//!
//! Browser `navigator.credentials` calls stay in the presentation layer. This
//! module accepts the 32-byte PRF output and derives a deterministic age
//! identity from the passkey. PIN fallback still owns a versioned
//! authenticated-encryption format persisted by the WASM storage adapter.

use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, KeyInit, Payload, array::Array},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use bech32::{Bech32, Hrp};
use getrandom::fill;
use hkdf::Hkdf;
use nook_authenticator_domain::PasskeyDeviceProtectionMode;
use pbkdf2::{pbkdf2_hmac, sha2::Sha256 as Pbkdf2Sha256};
use serde::{Deserialize, Deserializer, Serialize, de};
use sha2::Sha256;
use std::fmt;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    DeviceIdentitySecret,
    auth::multi_device::DeviceIdentity,
    errors::{DeviceKeyProtectionError, DeviceKeyProtectionResult},
};

mod registration;
pub use registration::{
    AwaitingPasskeyAssertion, PasskeyRegistration, PasskeyRegistrationInput,
    PasskeyRegistrationOutcome,
};
mod unlock;
pub use unlock::{PasskeyIdentityUnlock, PasskeyRecoveryInput};
mod protected_identity;
pub use protected_identity::*;
mod webauthn_bytes;
pub use webauthn_bytes::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct DeviceKeyProtectionVersion(u32);

impl DeviceKeyProtectionVersion {
    pub const PIN: Self = Self(2);
    pub const PASSKEY_DERIVED: Self = Self(3);
    pub const PASSKEY_WRAPPED_LOCAL: Self = Self(4);

    pub(crate) const fn to_be_bytes(self) -> [u8; size_of::<u32>()] {
        self.0.to_be_bytes()
    }

    fn parse(value: u32) -> Result<Self, &'static str> {
        match value {
            2 => Ok(Self::PIN),
            3 => Ok(Self::PASSKEY_DERIVED),
            4 => Ok(Self::PASSKEY_WRAPPED_LOCAL),
            _ => Err("unsupported device-key protection version"),
        }
    }
}

impl From<DeviceKeyProtectionVersion> for u32 {
    fn from(value: DeviceKeyProtectionVersion) -> Self {
        value.0
    }
}

impl fmt::Display for DeviceKeyProtectionVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for DeviceKeyProtectionVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(u32::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

pub const PIN_DEVICE_KEY_PROTECTION_VERSION: DeviceKeyProtectionVersion =
    DeviceKeyProtectionVersion::PIN;
pub const PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION: DeviceKeyProtectionVersion =
    DeviceKeyProtectionVersion::PASSKEY_DERIVED;
pub const PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION: DeviceKeyProtectionVersion =
    DeviceKeyProtectionVersion::PASSKEY_WRAPPED_LOCAL;

const PRF_INPUT_LEN: usize = 32;
const PRF_OUTPUT_LEN: usize = 32;
const USER_HANDLE_MAX_LEN: usize = 64;
const CREDENTIAL_ID_MAX_LEN: usize = 1024;
const PIN_SALT_LEN: usize = 32;
const PASSKEY_WRAPPING_SALT_LEN: usize = 32;
const PIN_MIN_LEN: usize = 6;
const PIN_PBKDF2_ITERATIONS: u32 = 600_000;
const AES_KEY_LEN: usize = 32;
const AES_GCM_NONCE_LEN: usize = 12;
const KDF_NAME: &str = "hkdf-sha256";
const PIN_KDF_NAME: &str = "pbkdf2-sha256";
const CIPHER_NAME: &str = "aes-256-gcm";
const DETERMINISTIC_PRF_INPUT_CONTEXT: &[u8] = b"nook/passkey-device-prf-input/v1";
const DETERMINISTIC_IDENTITY_HKDF_INFO: &[u8] = b"nook/passkey-derived-age-x25519/v1";
const PASSKEY_WRAPPING_HKDF_INFO: &[u8] = b"nook/passkey-wrapped-local-age-x25519/v1";
const PASSKEY_WRAPPED_AAD_CONTEXT: &[u8] = b"nook/device-identity-passkey-wrapped-local/v1";
const PIN_AAD_CONTEXT: &[u8] = b"nook/device-identity-pin-record/v2";
const AGE_SECRET_KEY_PREFIX: &str = "age-secret-key-";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceKeyProtectionSetup {
    user_handle: WebAuthnUserHandle,
    prf_input: WebAuthnPrfInput,
}

impl DeviceKeyProtectionSetup {
    pub fn new(
        user_handle: WebAuthnUserHandle,
        prf_input: WebAuthnPrfInput,
    ) -> DeviceKeyProtectionResult<Self> {
        if user_handle.as_ref().len() != PRF_INPUT_LEN {
            return Err(DeviceKeyProtectionError::UserHandleInvalid);
        }
        Ok(Self {
            user_handle,
            prf_input,
        })
    }

    pub fn generate() -> DeviceKeyProtectionResult<Self> {
        let mut user_handle = [0u8; PRF_INPUT_LEN];
        fill(&mut user_handle)
            .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
        Ok(Self {
            user_handle: user_handle.to_vec().try_into()?,
            prf_input: WebAuthnPrfInput::deterministic(),
        })
    }

    #[must_use]
    pub fn user_handle(&self) -> &WebAuthnUserHandle {
        &self.user_handle
    }

    #[must_use]
    pub fn prf_input(&self) -> &WebAuthnPrfInput {
        &self.prf_input
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasskeyAssertionRequest {
    credential_id: WebAuthnCredentialId,
    prf_input: WebAuthnPrfInput,
}

impl PasskeyAssertionRequest {
    #[must_use]
    pub fn new(credential_id: WebAuthnCredentialId, prf_input: WebAuthnPrfInput) -> Self {
        Self {
            credential_id,
            prf_input,
        }
    }

    #[must_use]
    pub fn credential_id(&self) -> &WebAuthnCredentialId {
        &self.credential_id
    }

    #[must_use]
    pub fn prf_input(&self) -> &WebAuthnPrfInput {
        &self.prf_input
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasskeyRecoveryRequest {
    prf_input: WebAuthnPrfInput,
}

impl PasskeyRecoveryRequest {
    #[must_use]
    pub fn prf_input(&self) -> &WebAuthnPrfInput {
        &self.prf_input
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct PasskeyDeviceIdentityMaterial {
    device_id: String,
    identity_secret: DeviceIdentitySecret,
    record: WrappedDeviceIdentity,
}

impl fmt::Debug for PasskeyDeviceIdentityMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PasskeyDeviceIdentityMaterial")
            .field("device_id", &self.device_id)
            .field("identity_secret", &"<redacted>")
            .field("record", &self.record)
            .finish()
    }
}

impl PasskeyDeviceIdentityMaterial {
    #[must_use]
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    #[must_use]
    pub fn identity_secret(&self) -> &DeviceIdentitySecret {
        &self.identity_secret
    }

    #[must_use]
    pub fn record(&self) -> &WrappedDeviceIdentity {
        &self.record
    }

    #[must_use]
    pub fn into_identity_secret(self) -> DeviceIdentitySecret {
        self.identity_secret
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PasskeyRegistrationResolution {
    Complete(Box<PasskeyDeviceIdentityMaterial>),
    NeedsAssertion(PasskeyAssertionRequest),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PasskeyRegistrationPrfOutput {
    Unavailable,
    Available(WebAuthnPrfOutput),
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn setup_uses_random_user_handle_and_deterministic_prf_input() -> anyhow::Result<()> {
        let setup = DeviceKeyProtectionSetup::generate()?;
        let other = DeviceKeyProtectionSetup::generate()?;
        assert_eq!(setup.user_handle().as_ref().len(), 32);
        assert_eq!(setup.prf_input().as_ref().len(), 32);
        assert_ne!(setup.user_handle(), other.user_handle());
        assert_eq!(setup.prf_input(), &WebAuthnPrfInput::deterministic());
        assert_eq!(setup.prf_input(), other.prf_input());
        Ok(())
    }

    #[test]
    fn setup_rejects_material_outside_the_rust_owned_contract() -> anyhow::Result<()> {
        let setup = DeviceKeyProtectionSetup::new(
            WebAuthnUserHandle::try_from(vec![7u8; 32])?,
            WebAuthnPrfInput::try_from(vec![7u8; 32])?,
        )?;
        assert_eq!(setup.user_handle().as_ref(), &[7u8; 32]);
        assert_eq!(setup.prf_input().as_ref(), &[7u8; 32]);
        assert!(WebAuthnUserHandle::try_from(Vec::new()).is_err());
        assert!(WebAuthnPrfInput::try_from(vec![8u8; 31]).is_err());
        let oversized = WebAuthnUserHandle::try_from(vec![8u8; 33])?;
        assert!(
            DeviceKeyProtectionSetup::new(oversized, WebAuthnPrfInput::deterministic()).is_err()
        );
        Ok(())
    }

    #[test]
    fn device_key_protection_version_validates_serde_input() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::from_str::<DeviceKeyProtectionVersion>("2")?,
            DeviceKeyProtectionVersion::PIN
        );
        assert_eq!(
            serde_json::from_str::<DeviceKeyProtectionVersion>("4")?,
            DeviceKeyProtectionVersion::PASSKEY_WRAPPED_LOCAL
        );
        assert!(serde_json::from_str::<DeviceKeyProtectionVersion>("1").is_err());
        assert!(serde_json::from_str::<DeviceKeyProtectionVersion>("4294967296").is_err());
        Ok(())
    }
}
