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
use pbkdf2::{pbkdf2_hmac, sha2::Sha256 as Pbkdf2Sha256};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    DeviceIdentitySecret,
    auth::multi_device::DeviceIdentity,
    errors::{DeviceKeyProtectionError, DeviceKeyProtectionResult},
};

mod protected_identity;
pub use protected_identity::*;

pub const PIN_DEVICE_KEY_PROTECTION_VERSION: u32 = 2;
pub const PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION: u32 = 3;
pub const PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION: u32 = 4;

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
    user_handle: [u8; PRF_INPUT_LEN],
    prf_input: [u8; PRF_INPUT_LEN],
}

impl DeviceKeyProtectionSetup {
    pub fn new(user_handle: &[u8], prf_input: &[u8]) -> DeviceKeyProtectionResult<Self> {
        let user_handle = validate_prf_input(user_handle)?;
        let prf_input = validate_prf_input(prf_input)?;
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
            user_handle,
            prf_input: deterministic_passkey_prf_input(),
        })
    }

    #[must_use]
    pub fn user_handle(&self) -> &[u8] {
        &self.user_handle
    }

    #[must_use]
    pub fn prf_input(&self) -> &[u8] {
        &self.prf_input
    }
}

#[must_use]
pub fn deterministic_passkey_prf_input() -> [u8; PRF_INPUT_LEN] {
    let digest = Sha256::digest(DETERMINISTIC_PRF_INPUT_CONTEXT);
    let mut input = [0u8; PRF_INPUT_LEN];
    input.copy_from_slice(&digest);
    input
}

pub fn derive_device_identity_from_passkey_prf(
    user_handle: &[u8],
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
    validate_recovery_inputs(user_handle, prf_output)?;
    let hkdf = Hkdf::<Sha256>::new(Some(user_handle), prf_output);
    let mut secret_bytes = Zeroizing::new([0u8; 32]);
    hkdf.expand(DETERMINISTIC_IDENTITY_HKDF_INFO, secret_bytes.as_mut())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    let mut encoded = encode_age_identity_secret(secret_bytes.as_ref())?;
    let secret = DeviceIdentitySecret::parse(&encoded)
        .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity);
    encoded.zeroize();
    secret
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasskeyAssertionRequest {
    credential_id: Vec<u8>,
    prf_input: [u8; PRF_INPUT_LEN],
}

impl PasskeyAssertionRequest {
    pub fn new(credential_id: &[u8], prf_input: &[u8]) -> DeviceKeyProtectionResult<Self> {
        validate_credential_id(credential_id)?;
        let prf_input = validate_prf_input(prf_input)?;
        Ok(Self {
            credential_id: credential_id.to_vec(),
            prf_input,
        })
    }

    #[must_use]
    pub fn credential_id(&self) -> &[u8] {
        &self.credential_id
    }

    #[must_use]
    pub fn prf_input(&self) -> &[u8] {
        &self.prf_input
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasskeyRecoveryRequest {
    prf_input: [u8; PRF_INPUT_LEN],
}

impl PasskeyRecoveryRequest {
    #[must_use]
    pub fn prf_input(&self) -> &[u8] {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyDeviceProtectionMode {
    Standard,
    AntiHacker,
}

impl PasskeyDeviceProtectionMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::AntiHacker => "anti-hacker",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyRegistrationPrfOutput<'a> {
    Unavailable,
    Available(&'a [u8]),
}

pub fn resolve_passkey_registration(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: PasskeyRegistrationPrfOutput<'_>,
) -> DeviceKeyProtectionResult<PasskeyRegistrationResolution> {
    resolve_passkey_registration_for_mode(
        credential_id,
        user_handle,
        prf_input,
        prf_output,
        PasskeyDeviceProtectionMode::Standard,
    )
}

pub fn resolve_passkey_registration_for_mode(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: PasskeyRegistrationPrfOutput<'_>,
    mode: PasskeyDeviceProtectionMode,
) -> DeviceKeyProtectionResult<PasskeyRegistrationResolution> {
    match prf_output {
        PasskeyRegistrationPrfOutput::Available(output) => finish_passkey_device_identity_for_mode(
            credential_id,
            user_handle,
            prf_input,
            output,
            mode,
        )
        .map(Box::new)
        .map(PasskeyRegistrationResolution::Complete),
        PasskeyRegistrationPrfOutput::Unavailable => {
            PasskeyAssertionRequest::new(credential_id, prf_input)
                .map(PasskeyRegistrationResolution::NeedsAssertion)
        }
    }
}

pub fn finish_passkey_device_identity_for_mode(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: &[u8],
    mode: PasskeyDeviceProtectionMode,
) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
    match mode {
        PasskeyDeviceProtectionMode::Standard => {
            finish_passkey_device_identity(credential_id, user_handle, prf_input, prf_output)
        }
        PasskeyDeviceProtectionMode::AntiHacker => finish_passkey_wrapped_device_identity(
            credential_id,
            user_handle,
            prf_input,
            prf_output,
        ),
    }
}

pub fn finish_passkey_device_identity(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
    let identity_secret = derive_device_identity_from_passkey_prf(user_handle, prf_output)?;
    let identity = DeviceIdentity::from_secret_str(&identity_secret)
        .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
    let record = passkey_derived_device_identity_record(credential_id, user_handle, prf_input)?;
    Ok(PasskeyDeviceIdentityMaterial {
        device_id: identity.device_id().to_string(),
        identity_secret,
        record,
    })
}

pub fn finish_passkey_wrapped_device_identity(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
    validate_recovery_inputs(user_handle, prf_output)?;
    let identity =
        DeviceIdentity::generate().map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
    let identity_secret = identity.secret_string();
    let record = passkey_wrapped_device_identity_record(
        credential_id,
        user_handle,
        prf_input,
        prf_output,
        &identity_secret,
    )?;
    Ok(PasskeyDeviceIdentityMaterial {
        device_id: identity.device_id().to_string(),
        identity_secret,
        record,
    })
}

pub fn passkey_assertion_request(
    record: &WrappedDeviceIdentity,
) -> DeviceKeyProtectionResult<PasskeyAssertionRequest> {
    PasskeyAssertionRequest::new(&record.credential_id_bytes()?, &record.prf_input_bytes()?)
}

#[must_use]
pub fn passkey_recovery_request() -> PasskeyRecoveryRequest {
    PasskeyRecoveryRequest {
        prf_input: deterministic_passkey_prf_input(),
    }
}

pub fn recover_passkey_device_identity(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
    finish_passkey_device_identity(
        credential_id,
        user_handle,
        &deterministic_passkey_prf_input(),
        prf_output,
    )
}

pub fn unlock_passkey_device_identity(
    stored_device_id: &str,
    record: &WrappedDeviceIdentity,
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
    let secret = match record {
        WrappedDeviceIdentity::PasskeyDerived(_) => {
            let user_handle = record.user_handle_bytes()?;
            derive_device_identity_from_passkey_prf(&user_handle, prf_output)?
        }
        WrappedDeviceIdentity::PasskeyWrappedLocal(inner) => {
            unwrap_passkey_wrapped_device_identity(inner, prf_output)?
        }
        WrappedDeviceIdentity::Pin(_) => {
            return Err(DeviceKeyProtectionError::UnsupportedParameters);
        }
    };
    let identity = DeviceIdentity::from_secret_str(&secret)
        .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
    if identity.device_id().as_str() != stored_device_id {
        return Err(DeviceKeyProtectionError::DeviceIdentityMismatch);
    }
    Ok(secret)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mock_passkey::{
        MemoryPasskeyAuthenticator, MockPasskeyAssertionRequest, MockPasskeyError,
        MockPasskeyRegistration, MockPasskeyRegistrationRequest, MockPasskeyUserAuthorization,
    };

    const TEST_RP_ID: &str = "localhost";

    #[test]
    fn setup_uses_random_user_handle_and_deterministic_prf_input() -> anyhow::Result<()> {
        let setup = DeviceKeyProtectionSetup::generate()?;
        let other = DeviceKeyProtectionSetup::generate()?;
        assert_eq!(setup.user_handle().len(), 32);
        assert_eq!(setup.prf_input().len(), 32);
        assert_ne!(setup.user_handle(), other.user_handle());
        assert_eq!(setup.prf_input(), deterministic_passkey_prf_input());
        assert_eq!(setup.prf_input(), other.prf_input());
        Ok(())
    }

    #[test]
    fn setup_rejects_material_outside_the_rust_owned_contract() -> anyhow::Result<()> {
        let valid = [7u8; 32];
        let setup = DeviceKeyProtectionSetup::new(&valid, &valid)?;
        assert_eq!(setup.user_handle(), valid);
        assert_eq!(setup.prf_input(), valid);
        assert!(DeviceKeyProtectionSetup::new(&[], &valid).is_err());
        assert!(DeviceKeyProtectionSetup::new(&valid, &[8u8; 31]).is_err());
        Ok(())
    }

    #[test]
    fn passkey_prf_derives_stable_age_identity() -> anyhow::Result<()> {
        let user_handle = [8u8; 32];
        let prf_output = [10u8; 32];
        let identity = derive_device_identity_from_passkey_prf(&user_handle, &prf_output)?;
        let same = derive_device_identity_from_passkey_prf(&user_handle, &prf_output)?;
        let different_user = derive_device_identity_from_passkey_prf(&[9u8; 32], &prf_output)?;
        let different_prf = derive_device_identity_from_passkey_prf(&user_handle, &[11u8; 32])?;

        assert_eq!(identity, same);
        assert_ne!(identity, different_user);
        assert_ne!(identity, different_prf);
        assert!(identity.as_str().starts_with("AGE-SECRET-KEY-"));
        Ok(())
    }

    fn approved_mock_registration(
        authenticator: &mut MemoryPasskeyAuthenticator,
        setup: &DeviceKeyProtectionSetup,
    ) -> anyhow::Result<MockPasskeyRegistration> {
        Ok(authenticator.register(
            MockPasskeyRegistrationRequest::new(
                TEST_RP_ID,
                "Test passkey",
                setup.user_handle().to_vec(),
                setup.prf_input().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        )?)
    }

    fn complete_mock_registration(
        authenticator: &mut MemoryPasskeyAuthenticator,
    ) -> anyhow::Result<(
        DeviceKeyProtectionSetup,
        MockPasskeyRegistration,
        PasskeyDeviceIdentityMaterial,
    )> {
        let setup = DeviceKeyProtectionSetup::generate()?;
        let registration = approved_mock_registration(authenticator, &setup)?;
        let resolution = resolve_passkey_registration(
            registration.credential_id(),
            setup.user_handle(),
            setup.prf_input(),
            PasskeyRegistrationPrfOutput::Available(registration.prf_output()),
        )?;
        let PasskeyRegistrationResolution::Complete(material) = resolution else {
            return Err(anyhow::anyhow!(
                "registration should complete from create() PRF output"
            ));
        };
        Ok((setup, registration, *material))
    }

    #[test]
    fn passkey_workflow_setup_completes_with_registration_prf() -> anyhow::Result<()> {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (setup, registration, material) = complete_mock_registration(&mut authenticator)?;

        assert_eq!(
            material.record().credential_id_bytes()?,
            registration.credential_id()
        );
        assert_eq!(material.record().user_handle_bytes()?, setup.user_handle());
        assert_eq!(material.record().prf_input_bytes()?, setup.prf_input());
        assert_eq!(
            material.identity_secret(),
            &derive_device_identity_from_passkey_prf(
                setup.user_handle(),
                registration.prf_output()
            )?
        );
        Ok(())
    }

    #[test]
    fn mode_aware_registration_creates_wrapped_local_identity() -> anyhow::Result<()> {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let setup = DeviceKeyProtectionSetup::generate()?;
        let registration = approved_mock_registration(&mut authenticator, &setup)?;
        let resolution = resolve_passkey_registration_for_mode(
            registration.credential_id(),
            setup.user_handle(),
            setup.prf_input(),
            PasskeyRegistrationPrfOutput::Available(registration.prf_output()),
            PasskeyDeviceProtectionMode::AntiHacker,
        )?;
        let PasskeyRegistrationResolution::Complete(material) = resolution else {
            return Err(anyhow::anyhow!(
                "registration should complete from create() PRF output"
            ));
        };
        assert!(matches!(
            material.record(),
            WrappedDeviceIdentity::PasskeyWrappedLocal(_)
        ));
        Ok(())
    }

    #[test]
    fn passkey_workflow_prf_missing_registration_falls_back_to_assertion() -> anyhow::Result<()> {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let setup = DeviceKeyProtectionSetup::generate()?;
        let registration = approved_mock_registration(&mut authenticator, &setup)?;
        let resolution = resolve_passkey_registration(
            registration.credential_id(),
            setup.user_handle(),
            setup.prf_input(),
            PasskeyRegistrationPrfOutput::Unavailable,
        )?;

        let PasskeyRegistrationResolution::NeedsAssertion(request) = resolution else {
            return Err(anyhow::anyhow!(
                "registration without PRF output should request assertion fallback"
            ));
        };
        assert_eq!(request.credential_id(), registration.credential_id());
        assert_eq!(request.prf_input(), setup.prf_input());

        let assertion = authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                TEST_RP_ID,
                request.credential_id().to_vec(),
                request.prf_input().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        )?;
        let material = finish_passkey_device_identity(
            assertion.credential_id(),
            setup.user_handle(),
            request.prf_input(),
            assertion.prf_output(),
        )?;

        assert_eq!(
            material.record().credential_id_bytes()?,
            registration.credential_id()
        );
        assert_eq!(
            material.identity_secret(),
            &derive_device_identity_from_passkey_prf(setup.user_handle(), assertion.prf_output())?
        );
        Ok(())
    }

    #[test]
    fn passkey_workflow_unlock_succeeds_from_stored_metadata() -> anyhow::Result<()> {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (_, registration, material) = complete_mock_registration(&mut authenticator)?;
        let request = passkey_assertion_request(material.record())?;
        let assertion = authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                TEST_RP_ID,
                request.credential_id().to_vec(),
                request.prf_input().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        )?;

        let unlocked = unlock_passkey_device_identity(
            material.device_id(),
            material.record(),
            assertion.prf_output(),
        )?;

        assert_eq!(assertion.credential_id(), registration.credential_id());
        assert_eq!(&unlocked, material.identity_secret());
        Ok(())
    }

    #[test]
    fn passkey_workflow_recovery_reconstructs_metadata_after_local_record_loss()
    -> anyhow::Result<()> {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (_, registration, original) = complete_mock_registration(&mut authenticator)?;
        let recovery_request = passkey_recovery_request();
        let assertion = authenticator.authenticate(
            &MockPasskeyAssertionRequest::discoverable(
                TEST_RP_ID,
                recovery_request.prf_input().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        )?;

        let recovered = recover_passkey_device_identity(
            assertion.credential_id(),
            assertion.user_handle(),
            assertion.prf_output(),
        )?;

        assert_eq!(recovered.device_id(), original.device_id());
        assert_eq!(recovered.identity_secret(), original.identity_secret());
        assert_eq!(
            recovered.record().credential_id_bytes()?,
            registration.credential_id()
        );
        assert_eq!(
            recovered.record().prf_input_bytes()?,
            deterministic_passkey_prf_input()
        );
        Ok(())
    }

    #[test]
    fn passkey_workflow_denial_blocks_registration_and_assertion() -> anyhow::Result<()> {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let setup = DeviceKeyProtectionSetup::generate()?;
        let denied_registration = authenticator.register(
            MockPasskeyRegistrationRequest::new(
                TEST_RP_ID,
                "Denied",
                setup.user_handle().to_vec(),
                setup.prf_input().to_vec(),
            ),
            MockPasskeyUserAuthorization::Denied,
        );
        assert!(matches!(
            denied_registration,
            Err(MockPasskeyError::AuthorizationDenied)
        ));

        let registration = approved_mock_registration(&mut authenticator, &setup)?;
        let PasskeyRegistrationResolution::NeedsAssertion(request) = resolve_passkey_registration(
            registration.credential_id(),
            setup.user_handle(),
            setup.prf_input(),
            PasskeyRegistrationPrfOutput::Unavailable,
        )?
        else {
            return Err(anyhow::anyhow!(
                "registration without PRF output should request assertion fallback"
            ));
        };
        let denied_assertion = authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                TEST_RP_ID,
                request.credential_id().to_vec(),
                request.prf_input().to_vec(),
            ),
            MockPasskeyUserAuthorization::Denied,
        );

        assert!(matches!(
            denied_assertion,
            Err(MockPasskeyError::AuthorizationDenied)
        ));
        Ok(())
    }

    #[test]
    fn passkey_workflow_wrong_rp_or_unknown_credential_is_rejected() -> anyhow::Result<()> {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (_, registration, material) = complete_mock_registration(&mut authenticator)?;
        let request = passkey_assertion_request(material.record())?;

        let wrong_rp = authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                "example.com",
                request.credential_id().to_vec(),
                request.prf_input().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        );
        let unknown_credential = authenticator.authenticate(
            &MockPasskeyAssertionRequest::with_allowed_credential(
                TEST_RP_ID,
                vec![44; registration.credential_id().len()],
                request.prf_input().to_vec(),
            ),
            MockPasskeyUserAuthorization::Approved,
        );

        assert!(matches!(wrong_rp, Err(MockPasskeyError::RpIdMismatch)));
        assert!(matches!(
            unknown_credential,
            Err(MockPasskeyError::NoMatchingCredential)
        ));
        Ok(())
    }

    #[test]
    fn passkey_workflow_reconstructs_request_metadata_and_rejects_mismatched_identity()
    -> anyhow::Result<()> {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (_, registration, material) = complete_mock_registration(&mut authenticator)?;
        let request = passkey_assertion_request(material.record())?;

        assert_eq!(request.credential_id(), registration.credential_id());
        assert_eq!(request.prf_input(), deterministic_passkey_prf_input());

        let wrong_output = [99u8; 32];
        assert!(matches!(
            unlock_passkey_device_identity(material.device_id(), material.record(), &wrong_output),
            Err(DeviceKeyProtectionError::DeviceIdentityMismatch)
        ));
        Ok(())
    }

    #[test]
    fn passkey_prf_identity_derivation_rejects_invalid_inputs() {
        assert!(matches!(
            derive_device_identity_from_passkey_prf(&[], &[10u8; 32]),
            Err(DeviceKeyProtectionError::UserHandleInvalid)
        ));
        assert!(matches!(
            derive_device_identity_from_passkey_prf(&[8u8; 32], &[10u8; 31]),
            Err(DeviceKeyProtectionError::PrfOutputInvalid)
        ));
    }
}
