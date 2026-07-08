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
use zeroize::{Zeroize, Zeroizing};

use crate::{
    DeviceIdentitySecret,
    errors::{DeviceKeyProtectionError, DeviceKeyProtectionResult},
};

pub const PIN_DEVICE_KEY_PROTECTION_VERSION: u32 = 2;
pub const PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION: u32 = 3;

const PRF_INPUT_LEN: usize = 32;
const PRF_OUTPUT_LEN: usize = 32;
const USER_HANDLE_MAX_LEN: usize = 64;
const CREDENTIAL_ID_MAX_LEN: usize = 1024;
const PIN_SALT_LEN: usize = 32;
const PIN_MIN_LEN: usize = 6;
const PIN_PBKDF2_ITERATIONS: u32 = 600_000;
const AES_KEY_LEN: usize = 32;
const AES_GCM_NONCE_LEN: usize = 12;
const KDF_NAME: &str = "hkdf-sha256";
const PIN_KDF_NAME: &str = "pbkdf2-sha256";
const CIPHER_NAME: &str = "aes-256-gcm";
const DETERMINISTIC_PRF_INPUT_CONTEXT: &[u8] = b"nook/passkey-device-prf-input/v1";
const DETERMINISTIC_IDENTITY_HKDF_INFO: &[u8] = b"nook/passkey-derived-age-x25519/v1";
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum WrappedDeviceIdentity {
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
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }
    }

    pub fn user_handle_bytes(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        match self {
            Self::PasskeyDerived(record) => decode_field("userHandle", &record.user_handle),
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }
    }

    pub fn prf_input_bytes(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        match self {
            Self::PasskeyDerived(record) => decode_field("prfInput", &record.prf_input),
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }
    }

    #[must_use]
    pub fn protection_mode(&self) -> &'static str {
        match self {
            Self::PasskeyDerived(_) => "passkey",
            Self::Pin(_) => "pin",
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
    if credential_id.is_empty() {
        return Err(DeviceKeyProtectionError::CredentialIdEmpty);
    }
    if credential_id.len() > CREDENTIAL_ID_MAX_LEN {
        return Err(DeviceKeyProtectionError::CredentialIdTooLarge);
    }
    if user_handle.is_empty() || user_handle.len() > USER_HANDLE_MAX_LEN {
        return Err(DeviceKeyProtectionError::UserHandleInvalid);
    }
    if prf_input.len() != PRF_INPUT_LEN {
        return Err(DeviceKeyProtectionError::PrfInputInvalid);
    }
    Ok(())
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
    use crate::DeviceIdentity;

    fn passkey_derived_record(record: &WrappedDeviceIdentity) -> &PasskeyDerivedDeviceIdentity {
        let WrappedDeviceIdentity::PasskeyDerived(inner) = record else {
            panic!("expected passkey-derived record");
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
