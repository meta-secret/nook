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
use bech32::{ToBase32, Variant};
use getrandom::getrandom;
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
    pub fn generate() -> DeviceKeyProtectionResult<Self> {
        let mut user_handle = [0u8; PRF_INPUT_LEN];
        getrandom(&mut user_handle)
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
    let mut encoded = encode_age_identity_secret(secret_bytes.as_ref());
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

pub fn resolve_passkey_registration(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: Option<&[u8]>,
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
    prf_output: Option<&[u8]>,
    mode: PasskeyDeviceProtectionMode,
) -> DeviceKeyProtectionResult<PasskeyRegistrationResolution> {
    match prf_output {
        Some(output) => finish_passkey_device_identity_for_mode(
            credential_id,
            user_handle,
            prf_input,
            output,
            mode,
        )
        .map(Box::new)
        .map(PasskeyRegistrationResolution::Complete),
        None => PasskeyAssertionRequest::new(credential_id, prf_input)
            .map(PasskeyRegistrationResolution::NeedsAssertion),
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum WrappedDeviceIdentity {
    PasskeyWrappedLocal(PasskeyWrappedLocalDeviceIdentity),
    PasskeyDerived(PasskeyDerivedDeviceIdentity),
    Pin(PinWrappedDeviceIdentity),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyDerivedDeviceIdentity {
    pub version: u32,
    pub protection: String,
    pub credential_id: String,
    pub user_handle: String,
    pub prf_input: String,
    pub kdf: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyWrappedLocalDeviceIdentity {
    pub version: u32,
    pub protection: String,
    pub device_mode: String,
    pub credential_id: String,
    pub user_handle: String,
    pub prf_input: String,
    pub kdf: String,
    pub hkdf_salt: String,
    pub cipher: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PinWrappedDeviceIdentity {
    pub version: u32,
    pub protection: String,
    pub kdf: String,
    pub iterations: u32,
    pub salt: String,
    pub cipher: String,
    pub nonce: String,
    pub ciphertext: String,
}

impl WrappedDeviceIdentity {
    pub fn credential_id_bytes(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        match self {
            Self::PasskeyDerived(record) => decode_field("credentialId", &record.credential_id),
            Self::PasskeyWrappedLocal(record) => {
                decode_field("credentialId", &record.credential_id)
            }
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }
    }

    pub fn user_handle_bytes(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        match self {
            Self::PasskeyDerived(record) => decode_field("userHandle", &record.user_handle),
            Self::PasskeyWrappedLocal(record) => decode_field("userHandle", &record.user_handle),
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }
    }

    pub fn prf_input_bytes(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        match self {
            Self::PasskeyDerived(record) => decode_field("prfInput", &record.prf_input),
            Self::PasskeyWrappedLocal(record) => decode_field("prfInput", &record.prf_input),
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }
    }

    #[must_use]
    pub fn protection_mode(&self) -> &'static str {
        match self {
            Self::PasskeyDerived(_) | Self::PasskeyWrappedLocal(_) => "passkey",
            Self::Pin(_) => "pin",
        }
    }

    /// Product `device_mode` for passkey-backed protection.
    ///
    /// PIN fallback is not a `device_mode` value (`standard` / `anti-hacker`);
    /// callers that need the storage kind should use [`Self::protection_mode`].
    #[must_use]
    pub fn device_mode(&self) -> Option<&'static str> {
        match self {
            Self::PasskeyDerived(_) => Some(PasskeyDeviceProtectionMode::Standard.as_str()),
            Self::PasskeyWrappedLocal(_) => Some(PasskeyDeviceProtectionMode::AntiHacker.as_str()),
            Self::Pin(_) => None,
        }
    }
}

pub fn passkey_derived_device_identity_record(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
) -> DeviceKeyProtectionResult<WrappedDeviceIdentity> {
    validate_passkey_metadata(credential_id, user_handle, prf_input)?;
    Ok(WrappedDeviceIdentity::PasskeyDerived(
        PasskeyDerivedDeviceIdentity {
            version: PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION,
            protection: "passkey-derived".to_owned(),
            credential_id: encode(credential_id),
            user_handle: encode(user_handle),
            prf_input: encode(prf_input),
            kdf: KDF_NAME.to_owned(),
        },
    ))
}

pub fn passkey_wrapped_device_identity_record(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: &[u8],
    identity: &DeviceIdentitySecret,
) -> DeviceKeyProtectionResult<WrappedDeviceIdentity> {
    validate_passkey_metadata(credential_id, user_handle, prf_input)?;
    validate_recovery_inputs(user_handle, prf_output)?;
    let mut salt = [0u8; PASSKEY_WRAPPING_SALT_LEN];
    let mut nonce = [0u8; AES_GCM_NONCE_LEN];
    getrandom(&mut salt)
        .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
    getrandom(&mut nonce)
        .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;

    let mut record = PasskeyWrappedLocalDeviceIdentity {
        version: PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION,
        protection: "passkey-wrapped-local".to_owned(),
        device_mode: PasskeyDeviceProtectionMode::AntiHacker.as_str().to_owned(),
        credential_id: encode(credential_id),
        user_handle: encode(user_handle),
        prf_input: encode(prf_input),
        kdf: KDF_NAME.to_owned(),
        hkdf_salt: encode(&salt),
        cipher: CIPHER_NAME.to_owned(),
        nonce: encode(&nonce),
        ciphertext: String::new(),
    };
    let key = derive_passkey_wrapping_key(prf_output, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    let aad = build_passkey_wrapped_aad(&record);
    let ciphertext = cipher
        .encrypt(
            &Array(nonce),
            Payload {
                msg: identity.as_str().as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| DeviceKeyProtectionError::Encrypt)?;
    record.ciphertext = encode(&ciphertext);
    Ok(WrappedDeviceIdentity::PasskeyWrappedLocal(record))
}

pub fn wrap_device_identity_with_pin(
    identity: &DeviceIdentitySecret,
    pin: &str,
) -> DeviceKeyProtectionResult<WrappedDeviceIdentity> {
    let pin = validate_pin(pin)?;
    let mut salt = [0u8; PIN_SALT_LEN];
    let mut nonce = [0u8; AES_GCM_NONCE_LEN];
    getrandom(&mut salt)
        .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
    getrandom(&mut nonce)
        .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;

    let key = derive_pin_wrapping_key(pin, &salt, PIN_PBKDF2_ITERATIONS)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    let aad = build_pin_aad(&salt, &nonce, PIN_PBKDF2_ITERATIONS);
    let ciphertext = cipher
        .encrypt(
            &Array(nonce),
            Payload {
                msg: identity.as_str().as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| DeviceKeyProtectionError::Encrypt)?;

    Ok(WrappedDeviceIdentity::Pin(PinWrappedDeviceIdentity {
        version: PIN_DEVICE_KEY_PROTECTION_VERSION,
        protection: "pin".to_owned(),
        kdf: PIN_KDF_NAME.to_owned(),
        iterations: PIN_PBKDF2_ITERATIONS,
        salt: encode(&salt),
        cipher: CIPHER_NAME.to_owned(),
        nonce: encode(&nonce),
        ciphertext: encode(&ciphertext),
    }))
}

pub fn unwrap_device_identity_with_pin(
    record: &WrappedDeviceIdentity,
    pin: &str,
) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
    let WrappedDeviceIdentity::Pin(record) = record else {
        return Err(DeviceKeyProtectionError::UnsupportedParameters);
    };
    let pin = validate_pin(pin)?;
    if record.version != PIN_DEVICE_KEY_PROTECTION_VERSION {
        return Err(DeviceKeyProtectionError::UnsupportedVersion(record.version));
    }
    if record.protection != "pin" || record.kdf != PIN_KDF_NAME || record.cipher != CIPHER_NAME {
        return Err(DeviceKeyProtectionError::UnsupportedParameters);
    }
    if record.iterations == 0 {
        return Err(DeviceKeyProtectionError::UnsupportedParameters);
    }

    let salt = decode_fixed::<PIN_SALT_LEN>("salt", &record.salt)?;
    let nonce = decode_fixed::<AES_GCM_NONCE_LEN>("nonce", &record.nonce)?;
    let ciphertext = decode_field("ciphertext", &record.ciphertext)?;
    let key = derive_pin_wrapping_key(pin, &salt, record.iterations)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    let aad = build_pin_aad(&salt, &nonce, record.iterations);
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                &Array(nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| DeviceKeyProtectionError::Decrypt)?,
    );
    let text = std::str::from_utf8(plaintext.as_ref())
        .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
    DeviceIdentitySecret::parse(text).map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)
}

fn unwrap_passkey_wrapped_device_identity(
    record: &PasskeyWrappedLocalDeviceIdentity,
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
    if record.version != PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION {
        return Err(DeviceKeyProtectionError::UnsupportedVersion(record.version));
    }
    if record.protection != "passkey-wrapped-local"
        || record.device_mode != PasskeyDeviceProtectionMode::AntiHacker.as_str()
        || record.kdf != KDF_NAME
        || record.cipher != CIPHER_NAME
    {
        return Err(DeviceKeyProtectionError::UnsupportedParameters);
    }
    if prf_output.len() != PRF_OUTPUT_LEN {
        return Err(DeviceKeyProtectionError::PrfOutputInvalid);
    }

    let salt = decode_fixed::<PASSKEY_WRAPPING_SALT_LEN>("hkdfSalt", &record.hkdf_salt)?;
    let nonce = decode_fixed::<AES_GCM_NONCE_LEN>("nonce", &record.nonce)?;
    let ciphertext = decode_field("ciphertext", &record.ciphertext)?;
    let key = derive_passkey_wrapping_key(prf_output, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    let aad = build_passkey_wrapped_aad(record);
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                &Array(nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| DeviceKeyProtectionError::Decrypt)?,
    );
    let text = std::str::from_utf8(plaintext.as_ref())
        .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
    DeviceIdentitySecret::parse(text).map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)
}

pub fn serialize_wrapped_device_identity(
    record: &WrappedDeviceIdentity,
) -> DeviceKeyProtectionResult<String> {
    serde_json::to_string(record).map_err(DeviceKeyProtectionError::Serialize)
}

pub fn parse_wrapped_device_identity(
    raw: &str,
) -> DeviceKeyProtectionResult<WrappedDeviceIdentity> {
    serde_json::from_str(raw).map_err(DeviceKeyProtectionError::Parse)
}

fn validate_passkey_metadata(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
) -> DeviceKeyProtectionResult<()> {
    validate_credential_id(credential_id)?;
    validate_user_handle(user_handle)?;
    validate_prf_input(prf_input)?;
    Ok(())
}

fn validate_credential_id(credential_id: &[u8]) -> DeviceKeyProtectionResult<()> {
    if credential_id.is_empty() {
        return Err(DeviceKeyProtectionError::CredentialIdEmpty);
    }
    if credential_id.len() > CREDENTIAL_ID_MAX_LEN {
        return Err(DeviceKeyProtectionError::CredentialIdTooLarge);
    }
    Ok(())
}

fn validate_user_handle(user_handle: &[u8]) -> DeviceKeyProtectionResult<()> {
    if user_handle.is_empty() || user_handle.len() > USER_HANDLE_MAX_LEN {
        return Err(DeviceKeyProtectionError::UserHandleInvalid);
    }
    Ok(())
}

fn validate_prf_input(prf_input: &[u8]) -> DeviceKeyProtectionResult<[u8; PRF_INPUT_LEN]> {
    if prf_input.len() != PRF_INPUT_LEN {
        return Err(DeviceKeyProtectionError::PrfInputInvalid);
    }
    let mut input = [0u8; PRF_INPUT_LEN];
    input.copy_from_slice(prf_input);
    Ok(input)
}

fn validate_recovery_inputs(
    user_handle: &[u8],
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<()> {
    if user_handle.is_empty() || user_handle.len() > USER_HANDLE_MAX_LEN {
        return Err(DeviceKeyProtectionError::UserHandleInvalid);
    }
    if prf_output.len() != PRF_OUTPUT_LEN {
        return Err(DeviceKeyProtectionError::PrfOutputInvalid);
    }
    Ok(())
}

fn derive_pin_wrapping_key(
    pin: &str,
    salt: &[u8],
    iterations: u32,
) -> DeviceKeyProtectionResult<Zeroizing<[u8; AES_KEY_LEN]>> {
    if iterations == 0 {
        return Err(DeviceKeyProtectionError::KeyDerivation);
    }
    let mut key = Zeroizing::new([0u8; AES_KEY_LEN]);
    pbkdf2_hmac::<Pbkdf2Sha256>(pin.as_bytes(), salt, iterations, key.as_mut());
    Ok(key)
}

fn derive_passkey_wrapping_key(
    prf_output: &[u8],
    salt: &[u8],
) -> DeviceKeyProtectionResult<Zeroizing<[u8; AES_KEY_LEN]>> {
    if prf_output.len() != PRF_OUTPUT_LEN || salt.len() != PASSKEY_WRAPPING_SALT_LEN {
        return Err(DeviceKeyProtectionError::KeyDerivation);
    }
    let hkdf = Hkdf::<Sha256>::new(Some(salt), prf_output);
    let mut key = Zeroizing::new([0u8; AES_KEY_LEN]);
    hkdf.expand(PASSKEY_WRAPPING_HKDF_INFO, key.as_mut())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    Ok(key)
}

fn validate_pin(pin: &str) -> DeviceKeyProtectionResult<&str> {
    let trimmed = pin.trim();
    if trimmed.len() < PIN_MIN_LEN {
        return Err(DeviceKeyProtectionError::PinTooShort);
    }
    Ok(trimmed)
}

fn build_pin_aad(salt: &[u8], nonce: &[u8], iterations: u32) -> Zeroizing<Vec<u8>> {
    let mut aad = Zeroizing::new(Vec::with_capacity(
        PIN_AAD_CONTEXT.len() + salt.len() + nonce.len() + 16,
    ));
    aad.extend_from_slice(PIN_AAD_CONTEXT);
    append_field(&mut aad, &PIN_DEVICE_KEY_PROTECTION_VERSION.to_be_bytes());
    append_field(&mut aad, PIN_KDF_NAME.as_bytes());
    append_field(&mut aad, &iterations.to_be_bytes());
    append_field(&mut aad, salt);
    append_field(&mut aad, nonce);
    aad
}

fn build_passkey_wrapped_aad(record: &PasskeyWrappedLocalDeviceIdentity) -> Zeroizing<Vec<u8>> {
    let mut aad = Zeroizing::new(Vec::new());
    aad.extend_from_slice(PASSKEY_WRAPPED_AAD_CONTEXT);
    append_field(&mut aad, &record.version.to_be_bytes());
    append_field(&mut aad, record.protection.as_bytes());
    append_field(&mut aad, record.device_mode.as_bytes());
    append_field(&mut aad, record.credential_id.as_bytes());
    append_field(&mut aad, record.user_handle.as_bytes());
    append_field(&mut aad, record.prf_input.as_bytes());
    append_field(&mut aad, record.kdf.as_bytes());
    append_field(&mut aad, record.hkdf_salt.as_bytes());
    append_field(&mut aad, record.cipher.as_bytes());
    append_field(&mut aad, record.nonce.as_bytes());
    aad
}

fn append_field(target: &mut Vec<u8>, value: &[u8]) {
    let length = u32::try_from(value.len()).unwrap_or(u32::MAX);
    target.extend_from_slice(&length.to_be_bytes());
    target.extend_from_slice(value);
}

fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn encode_age_identity_secret(secret_bytes: &[u8]) -> String {
    let base32 = secret_bytes.to_base32();
    let mut encoded = bech32::encode(AGE_SECRET_KEY_PREFIX, base32, Variant::Bech32)
        .expect("age secret key HRP is valid");
    encoded.make_ascii_uppercase();
    encoded
}

fn decode_field(name: &'static str, encoded: &str) -> DeviceKeyProtectionResult<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| DeviceKeyProtectionError::InvalidField(name))
}

fn decode_fixed<const N: usize>(
    name: &'static str,
    encoded: &str,
) -> DeviceKeyProtectionResult<[u8; N]> {
    let mut bytes = decode_field(name, encoded)?;
    if bytes.len() != N {
        bytes.zeroize();
        return Err(DeviceKeyProtectionError::InvalidField(name));
    }
    let mut fixed = [0u8; N];
    fixed.copy_from_slice(&bytes);
    bytes.zeroize();
    Ok(fixed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeviceIdentity,
        auth::mock_passkey::{
            MemoryPasskeyAuthenticator, MockPasskeyAssertionRequest, MockPasskeyError,
            MockPasskeyRegistration, MockPasskeyRegistrationRequest, MockPasskeyUserAuthorization,
        },
    };

    const TEST_RP_ID: &str = "localhost";

    fn passkey_derived_record(record: &WrappedDeviceIdentity) -> &PasskeyDerivedDeviceIdentity {
        let WrappedDeviceIdentity::PasskeyDerived(inner) = record else {
            panic!("expected passkey-derived record");
        };
        inner
    }

    fn passkey_wrapped_record(
        record: &WrappedDeviceIdentity,
    ) -> &PasskeyWrappedLocalDeviceIdentity {
        let WrappedDeviceIdentity::PasskeyWrappedLocal(inner) = record else {
            panic!("expected passkey-wrapped-local record");
        };
        inner
    }

    #[test]
    fn setup_uses_random_user_handle_and_deterministic_prf_input() {
        let setup = DeviceKeyProtectionSetup::generate().unwrap();
        let other = DeviceKeyProtectionSetup::generate().unwrap();
        assert_eq!(setup.user_handle().len(), 32);
        assert_eq!(setup.prf_input().len(), 32);
        assert_ne!(setup.user_handle(), other.user_handle());
        assert_eq!(setup.prf_input(), deterministic_passkey_prf_input());
        assert_eq!(setup.prf_input(), other.prf_input());
    }

    #[test]
    fn passkey_prf_derives_stable_age_identity() {
        let user_handle = [8u8; 32];
        let prf_output = [10u8; 32];
        let identity = derive_device_identity_from_passkey_prf(&user_handle, &prf_output).unwrap();
        let same = derive_device_identity_from_passkey_prf(&user_handle, &prf_output).unwrap();
        let different_user =
            derive_device_identity_from_passkey_prf(&[9u8; 32], &prf_output).unwrap();
        let different_prf =
            derive_device_identity_from_passkey_prf(&user_handle, &[11u8; 32]).unwrap();

        assert_eq!(identity, same);
        assert_ne!(identity, different_user);
        assert_ne!(identity, different_prf);
        assert!(identity.as_str().starts_with("AGE-SECRET-KEY-"));
    }

    #[test]
    fn passkey_derived_record_stores_only_recovery_metadata() {
        let credential_id = vec![7u8; 48];
        let user_handle = vec![8u8; 32];
        let prf_input = deterministic_passkey_prf_input();
        let record =
            passkey_derived_device_identity_record(&credential_id, &user_handle, &prf_input)
                .unwrap();
        let json = serialize_wrapped_device_identity(&record).unwrap();
        let parsed = parse_wrapped_device_identity(&json).unwrap();

        assert_eq!(parsed.protection_mode(), "passkey");
        assert_eq!(parsed.credential_id_bytes().unwrap(), credential_id);
        assert_eq!(parsed.user_handle_bytes().unwrap(), user_handle);
        assert_eq!(parsed.prf_input_bytes().unwrap(), prf_input);
        assert_eq!(
            passkey_derived_record(&parsed).version,
            PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION
        );
        assert!(!json.contains("ciphertext"));
        assert!(!json.contains("AGE-SECRET-KEY-"));
    }

    #[test]
    fn anti_hacker_record_wraps_random_identity_locally() {
        let credential_id = vec![7u8; 48];
        let user_handle = vec![8u8; 32];
        let prf_input = deterministic_passkey_prf_input();
        let prf_output = [10u8; 32];
        let material = finish_passkey_wrapped_device_identity(
            &credential_id,
            &user_handle,
            &prf_input,
            &prf_output,
        )
        .unwrap();
        let json = serialize_wrapped_device_identity(material.record()).unwrap();
        let parsed = parse_wrapped_device_identity(&json).unwrap();
        let record = passkey_wrapped_record(&parsed);

        assert_eq!(parsed.protection_mode(), "passkey");
        assert_eq!(parsed.device_mode(), Some("anti-hacker"));
        assert_eq!(
            record.version,
            PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION
        );
        assert_eq!(parsed.credential_id_bytes().unwrap(), credential_id);
        assert_eq!(parsed.user_handle_bytes().unwrap(), user_handle);
        assert_eq!(parsed.prf_input_bytes().unwrap(), prf_input);
        assert!(json.contains("ciphertext"));
        assert!(json.contains("nonce"));
        assert!(!json.contains("AGE-SECRET-KEY-"));
        assert_ne!(
            material.identity_secret(),
            &derive_device_identity_from_passkey_prf(&user_handle, &prf_output).unwrap()
        );
    }

    #[test]
    fn anti_hacker_unlock_requires_local_wrapper_and_matching_prf() {
        let credential_id = vec![7u8; 48];
        let user_handle = vec![8u8; 32];
        let prf_input = deterministic_passkey_prf_input();
        let prf_output = [10u8; 32];
        let material = finish_passkey_wrapped_device_identity(
            &credential_id,
            &user_handle,
            &prf_input,
            &prf_output,
        )
        .unwrap();

        let unlocked =
            unlock_passkey_device_identity(material.device_id(), material.record(), &prf_output)
                .unwrap();
        assert_eq!(&unlocked, material.identity_secret());
        assert!(
            unlock_passkey_device_identity(material.device_id(), material.record(), &[11u8; 32])
                .is_err()
        );

        let recovered =
            recover_passkey_device_identity(&credential_id, &user_handle, &prf_output).unwrap();
        assert_ne!(recovered.device_id(), material.device_id());
    }

    fn approved_mock_registration(
        authenticator: &mut MemoryPasskeyAuthenticator,
        setup: &DeviceKeyProtectionSetup,
    ) -> MockPasskeyRegistration {
        authenticator
            .register(
                MockPasskeyRegistrationRequest::new(
                    TEST_RP_ID,
                    "Test passkey",
                    setup.user_handle().to_vec(),
                    setup.prf_input().to_vec(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )
            .unwrap()
    }

    fn complete_mock_registration(
        authenticator: &mut MemoryPasskeyAuthenticator,
    ) -> (
        DeviceKeyProtectionSetup,
        MockPasskeyRegistration,
        PasskeyDeviceIdentityMaterial,
    ) {
        let setup = DeviceKeyProtectionSetup::generate().unwrap();
        let registration = approved_mock_registration(authenticator, &setup);
        let resolution = resolve_passkey_registration(
            registration.credential_id(),
            setup.user_handle(),
            setup.prf_input(),
            Some(registration.prf_output()),
        )
        .unwrap();
        let PasskeyRegistrationResolution::Complete(material) = resolution else {
            panic!("registration should complete from create() PRF output");
        };
        (setup, registration, *material)
    }

    #[test]
    fn passkey_workflow_setup_completes_with_registration_prf() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (setup, registration, material) = complete_mock_registration(&mut authenticator);

        assert_eq!(
            material.record().credential_id_bytes().unwrap(),
            registration.credential_id()
        );
        assert_eq!(
            material.record().user_handle_bytes().unwrap(),
            setup.user_handle()
        );
        assert_eq!(
            material.record().prf_input_bytes().unwrap(),
            setup.prf_input()
        );
        assert_eq!(
            material.identity_secret(),
            &derive_device_identity_from_passkey_prf(
                setup.user_handle(),
                registration.prf_output()
            )
            .unwrap()
        );
    }

    #[test]
    fn mode_aware_registration_creates_wrapped_local_identity() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let setup = DeviceKeyProtectionSetup::generate().unwrap();
        let registration = approved_mock_registration(&mut authenticator, &setup);
        let resolution = resolve_passkey_registration_for_mode(
            registration.credential_id(),
            setup.user_handle(),
            setup.prf_input(),
            Some(registration.prf_output()),
            PasskeyDeviceProtectionMode::AntiHacker,
        )
        .unwrap();
        let PasskeyRegistrationResolution::Complete(material) = resolution else {
            panic!("registration should complete from create() PRF output");
        };
        assert!(matches!(
            material.record(),
            WrappedDeviceIdentity::PasskeyWrappedLocal(_)
        ));
    }

    #[test]
    fn passkey_workflow_prf_missing_registration_falls_back_to_assertion() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let setup = DeviceKeyProtectionSetup::generate().unwrap();
        let registration = approved_mock_registration(&mut authenticator, &setup);
        let resolution = resolve_passkey_registration(
            registration.credential_id(),
            setup.user_handle(),
            setup.prf_input(),
            None,
        )
        .unwrap();

        let PasskeyRegistrationResolution::NeedsAssertion(request) = resolution else {
            panic!("registration without PRF output should request assertion fallback");
        };
        assert_eq!(request.credential_id(), registration.credential_id());
        assert_eq!(request.prf_input(), setup.prf_input());

        let assertion = authenticator
            .authenticate(
                &MockPasskeyAssertionRequest::with_allowed_credential(
                    TEST_RP_ID,
                    request.credential_id().to_vec(),
                    request.prf_input().to_vec(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )
            .unwrap();
        let material = finish_passkey_device_identity(
            assertion.credential_id(),
            setup.user_handle(),
            request.prf_input(),
            assertion.prf_output(),
        )
        .unwrap();

        assert_eq!(
            material.record().credential_id_bytes().unwrap(),
            registration.credential_id()
        );
        assert_eq!(
            material.identity_secret(),
            &derive_device_identity_from_passkey_prf(setup.user_handle(), assertion.prf_output())
                .unwrap()
        );
    }

    #[test]
    fn passkey_workflow_unlock_succeeds_from_stored_metadata() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (_, registration, material) = complete_mock_registration(&mut authenticator);
        let request = passkey_assertion_request(material.record()).unwrap();
        let assertion = authenticator
            .authenticate(
                &MockPasskeyAssertionRequest::with_allowed_credential(
                    TEST_RP_ID,
                    request.credential_id().to_vec(),
                    request.prf_input().to_vec(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )
            .unwrap();

        let unlocked = unlock_passkey_device_identity(
            material.device_id(),
            material.record(),
            assertion.prf_output(),
        )
        .unwrap();

        assert_eq!(assertion.credential_id(), registration.credential_id());
        assert_eq!(&unlocked, material.identity_secret());
    }

    #[test]
    fn passkey_workflow_recovery_reconstructs_metadata_after_local_record_loss() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (_, registration, original) = complete_mock_registration(&mut authenticator);
        let recovery_request = passkey_recovery_request();
        let assertion = authenticator
            .authenticate(
                &MockPasskeyAssertionRequest::discoverable(
                    TEST_RP_ID,
                    recovery_request.prf_input().to_vec(),
                ),
                MockPasskeyUserAuthorization::Approved,
            )
            .unwrap();

        let recovered = recover_passkey_device_identity(
            assertion.credential_id(),
            assertion.user_handle(),
            assertion.prf_output(),
        )
        .unwrap();

        assert_eq!(recovered.device_id(), original.device_id());
        assert_eq!(recovered.identity_secret(), original.identity_secret());
        assert_eq!(
            recovered.record().credential_id_bytes().unwrap(),
            registration.credential_id()
        );
        assert_eq!(
            recovered.record().prf_input_bytes().unwrap(),
            deterministic_passkey_prf_input()
        );
    }

    #[test]
    fn passkey_workflow_denial_blocks_registration_and_assertion() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let setup = DeviceKeyProtectionSetup::generate().unwrap();
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

        let registration = approved_mock_registration(&mut authenticator, &setup);
        let PasskeyRegistrationResolution::NeedsAssertion(request) = resolve_passkey_registration(
            registration.credential_id(),
            setup.user_handle(),
            setup.prf_input(),
            None,
        )
        .unwrap() else {
            panic!("registration without PRF output should request assertion fallback");
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
    }

    #[test]
    fn passkey_workflow_wrong_rp_or_unknown_credential_is_rejected() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (_, registration, material) = complete_mock_registration(&mut authenticator);
        let request = passkey_assertion_request(material.record()).unwrap();

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
    }

    #[test]
    fn passkey_workflow_reconstructs_request_metadata_and_rejects_mismatched_identity() {
        let mut authenticator = MemoryPasskeyAuthenticator::new();
        let (_, registration, material) = complete_mock_registration(&mut authenticator);
        let request = passkey_assertion_request(material.record()).unwrap();

        assert_eq!(request.credential_id(), registration.credential_id());
        assert_eq!(request.prf_input(), deterministic_passkey_prf_input());

        let wrong_output = [99u8; 32];
        assert!(matches!(
            unlock_passkey_device_identity(material.device_id(), material.record(), &wrong_output),
            Err(DeviceKeyProtectionError::DeviceIdentityMismatch)
        ));
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

    #[test]
    fn passkey_derived_record_rejects_invalid_metadata() {
        assert!(matches!(
            passkey_derived_device_identity_record(&[], &[8u8; 32], &[9u8; 32]),
            Err(DeviceKeyProtectionError::CredentialIdEmpty)
        ));
        assert!(matches!(
            passkey_derived_device_identity_record(&[7u8; 48], &[1u8; 65], &[9u8; 32]),
            Err(DeviceKeyProtectionError::UserHandleInvalid)
        ));
        assert!(matches!(
            passkey_derived_device_identity_record(&[7u8; 48], &[8u8; 32], &[1u8; 31]),
            Err(DeviceKeyProtectionError::PrfInputInvalid)
        ));
    }

    #[test]
    fn pin_wrap_round_trips_and_serializes_without_plaintext() {
        let identity = DeviceIdentity::generate().unwrap().secret_string();
        let record = wrap_device_identity_with_pin(&identity, "123456").unwrap();
        let json = serialize_wrapped_device_identity(&record).unwrap();
        assert!(!json.contains(identity.as_str()));
        assert!(json.contains(r#""protection":"pin""#));

        let parsed = parse_wrapped_device_identity(&json).unwrap();
        assert_eq!(parsed.protection_mode(), "pin");
        let decrypted = unwrap_device_identity_with_pin(&parsed, "123456").unwrap();
        assert_eq!(decrypted, identity);
    }

    #[test]
    fn wrong_pin_does_not_decrypt() {
        let identity = DeviceIdentity::generate().unwrap().secret_string();
        let record = wrap_device_identity_with_pin(&identity, "123456").unwrap();
        assert!(matches!(
            unwrap_device_identity_with_pin(&record, "654321"),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
    }

    #[test]
    fn pin_metadata_and_ciphertext_reject_tampering() {
        let identity = DeviceIdentity::generate().unwrap().secret_string();
        let record = wrap_device_identity_with_pin(&identity, "123456").unwrap();

        let mut metadata_tampered = record.clone();
        let WrappedDeviceIdentity::Pin(pin) = &mut metadata_tampered else {
            panic!("expected pin record");
        };
        pin.iterations += 1;
        assert!(matches!(
            unwrap_device_identity_with_pin(&metadata_tampered, "123456"),
            Err(DeviceKeyProtectionError::Decrypt)
        ));

        let mut ciphertext_tampered = record;
        let WrappedDeviceIdentity::Pin(pin) = &mut ciphertext_tampered else {
            panic!("expected pin record");
        };
        let mut ciphertext = decode_field("ciphertext", &pin.ciphertext).unwrap();
        ciphertext[0] ^= 0x80;
        pin.ciphertext = encode(&ciphertext);
        assert!(matches!(
            unwrap_device_identity_with_pin(&ciphertext_tampered, "123456"),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
    }

    #[test]
    fn pin_requires_minimum_length() {
        let identity = DeviceIdentity::generate().unwrap().secret_string();
        assert!(matches!(
            wrap_device_identity_with_pin(&identity, "12345"),
            Err(DeviceKeyProtectionError::PinTooShort)
        ));
        let record = wrap_device_identity_with_pin(&identity, "123456").unwrap();
        assert!(matches!(
            unwrap_device_identity_with_pin(&record, "12345"),
            Err(DeviceKeyProtectionError::PinTooShort)
        ));
    }
}
