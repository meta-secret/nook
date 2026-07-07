//! Passkey-PRF wrapping for the browser-persisted X25519 device identity.
//!
//! Browser `navigator.credentials` calls stay in the presentation layer. This
//! module accepts the 32-byte PRF output, derives a domain-separated wrapping
//! key, and owns the versioned authenticated-encryption format persisted by the
//! WASM storage adapter.

use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, KeyInit, Payload, array::Array},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use getrandom::getrandom;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    DeviceIdentitySecret,
    errors::{DeviceKeyProtectionError, DeviceKeyProtectionResult},
};

pub const DEVICE_KEY_PROTECTION_VERSION: u32 = 1;

const PRF_INPUT_LEN: usize = 32;
const PRF_OUTPUT_LEN: usize = 32;
const USER_HANDLE_MAX_LEN: usize = 64;
const CREDENTIAL_ID_MAX_LEN: usize = 1024;
const HKDF_SALT_LEN: usize = 32;
const AES_KEY_LEN: usize = 32;
const AES_GCM_NONCE_LEN: usize = 12;
const KDF_NAME: &str = "hkdf-sha256";
const CIPHER_NAME: &str = "aes-256-gcm";
const HKDF_INFO: &[u8] = b"nook/device-identity-wrap/v1";
const AAD_CONTEXT: &[u8] = b"nook/device-identity-record/v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceKeyProtectionSetup {
    user_handle: [u8; PRF_INPUT_LEN],
    prf_input: [u8; PRF_INPUT_LEN],
}

impl DeviceKeyProtectionSetup {
    pub fn generate() -> DeviceKeyProtectionResult<Self> {
        let mut user_handle = [0u8; PRF_INPUT_LEN];
        let mut prf_input = [0u8; PRF_INPUT_LEN];
        getrandom(&mut user_handle)
            .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
        getrandom(&mut prf_input)
            .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
        Ok(Self {
            user_handle,
            prf_input,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WrappedDeviceIdentity {
    pub version: u32,
    pub credential_id: String,
    pub user_handle: String,
    pub prf_input: String,
    pub kdf: String,
    pub hkdf_salt: String,
    pub cipher: String,
    pub nonce: String,
    pub ciphertext: String,
}

impl WrappedDeviceIdentity {
    pub fn credential_id_bytes(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        decode_field("credentialId", &self.credential_id)
    }

    pub fn user_handle_bytes(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        decode_field("userHandle", &self.user_handle)
    }

    pub fn prf_input_bytes(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        decode_field("prfInput", &self.prf_input)
    }
}

pub fn wrap_device_identity(
    identity: &DeviceIdentitySecret,
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<WrappedDeviceIdentity> {
    validate_inputs(credential_id, user_handle, prf_input, prf_output)?;

    let mut hkdf_salt = [0u8; HKDF_SALT_LEN];
    let mut nonce = [0u8; AES_GCM_NONCE_LEN];
    getrandom(&mut hkdf_salt)
        .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
    getrandom(&mut nonce)
        .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;

    let key = derive_wrapping_key(prf_output, &hkdf_salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    let aad = build_aad(credential_id, user_handle, prf_input, &hkdf_salt, &nonce);
    let ciphertext = cipher
        .encrypt(
            &Array(nonce),
            Payload {
                msg: identity.as_str().as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| DeviceKeyProtectionError::Encrypt)?;

    Ok(WrappedDeviceIdentity {
        version: DEVICE_KEY_PROTECTION_VERSION,
        credential_id: encode(credential_id),
        user_handle: encode(user_handle),
        prf_input: encode(prf_input),
        kdf: KDF_NAME.to_owned(),
        hkdf_salt: encode(&hkdf_salt),
        cipher: CIPHER_NAME.to_owned(),
        nonce: encode(&nonce),
        ciphertext: encode(&ciphertext),
    })
}

pub fn unwrap_device_identity(
    record: &WrappedDeviceIdentity,
    prf_output: &[u8],
) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
    if record.version != DEVICE_KEY_PROTECTION_VERSION {
        return Err(DeviceKeyProtectionError::UnsupportedVersion(record.version));
    }
    if record.kdf != KDF_NAME || record.cipher != CIPHER_NAME {
        return Err(DeviceKeyProtectionError::UnsupportedParameters);
    }

    let credential_id = record.credential_id_bytes()?;
    let user_handle = record.user_handle_bytes()?;
    let prf_input = record.prf_input_bytes()?;
    let hkdf_salt = decode_fixed::<HKDF_SALT_LEN>("hkdfSalt", &record.hkdf_salt)?;
    let nonce = decode_fixed::<AES_GCM_NONCE_LEN>("nonce", &record.nonce)?;
    let ciphertext = decode_field("ciphertext", &record.ciphertext)?;
    validate_inputs(&credential_id, &user_handle, &prf_input, prf_output)?;

    let key = derive_wrapping_key(prf_output, &hkdf_salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    let aad = build_aad(&credential_id, &user_handle, &prf_input, &hkdf_salt, &nonce);
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

fn validate_inputs(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    prf_output: &[u8],
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
    if prf_output.len() != PRF_OUTPUT_LEN {
        return Err(DeviceKeyProtectionError::PrfOutputInvalid);
    }
    Ok(())
}

fn derive_wrapping_key(
    prf_output: &[u8],
    salt: &[u8],
) -> DeviceKeyProtectionResult<Zeroizing<[u8; AES_KEY_LEN]>> {
    let hkdf = Hkdf::<Sha256>::new(Some(salt), prf_output);
    let mut key = Zeroizing::new([0u8; AES_KEY_LEN]);
    hkdf.expand(HKDF_INFO, key.as_mut())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    Ok(key)
}

fn build_aad(
    credential_id: &[u8],
    user_handle: &[u8],
    prf_input: &[u8],
    hkdf_salt: &[u8],
    nonce: &[u8],
) -> Zeroizing<Vec<u8>> {
    let mut aad = Zeroizing::new(Vec::with_capacity(
        AAD_CONTEXT.len()
            + credential_id.len()
            + user_handle.len()
            + prf_input.len()
            + hkdf_salt.len()
            + nonce.len()
            + 24,
    ));
    aad.extend_from_slice(AAD_CONTEXT);
    append_field(&mut aad, &DEVICE_KEY_PROTECTION_VERSION.to_be_bytes());
    append_field(&mut aad, credential_id);
    append_field(&mut aad, user_handle);
    append_field(&mut aad, prf_input);
    append_field(&mut aad, hkdf_salt);
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

    fn fixture() -> (DeviceIdentitySecret, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
        let identity = DeviceIdentity::generate().unwrap().secret_string();
        (
            identity,
            vec![7u8; 48],
            vec![8u8; 32],
            vec![9u8; 32],
            vec![10u8; 32],
        )
    }

    #[test]
    fn setup_uses_full_length_random_values() {
        let setup = DeviceKeyProtectionSetup::generate().unwrap();
        assert_eq!(setup.user_handle().len(), 32);
        assert_eq!(setup.prf_input().len(), 32);
        assert_ne!(setup.user_handle(), setup.prf_input());
    }

    #[test]
    fn wrap_round_trips_and_serializes_without_plaintext() {
        let (identity, credential_id, user_handle, prf_input, prf_output) = fixture();
        let record = wrap_device_identity(
            &identity,
            &credential_id,
            &user_handle,
            &prf_input,
            &prf_output,
        )
        .unwrap();
        let json = serialize_wrapped_device_identity(&record).unwrap();
        assert!(!json.contains(identity.as_str()));

        let parsed = parse_wrapped_device_identity(&json).unwrap();
        let decrypted = unwrap_device_identity(&parsed, &prf_output).unwrap();
        assert_eq!(decrypted, identity);
        assert_eq!(parsed.credential_id_bytes().unwrap(), credential_id);
        assert_eq!(parsed.user_handle_bytes().unwrap(), user_handle);
        assert_eq!(parsed.prf_input_bytes().unwrap(), prf_input);
    }

    #[test]
    fn wrong_prf_output_does_not_decrypt() {
        let (identity, credential_id, user_handle, prf_input, prf_output) = fixture();
        let record = wrap_device_identity(
            &identity,
            &credential_id,
            &user_handle,
            &prf_input,
            &prf_output,
        )
        .unwrap();
        assert!(matches!(
            unwrap_device_identity(&record, &[99u8; 32]),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
    }

    #[test]
    fn authenticated_metadata_and_ciphertext_reject_tampering() {
        let (identity, credential_id, user_handle, prf_input, prf_output) = fixture();
        let record = wrap_device_identity(
            &identity,
            &credential_id,
            &user_handle,
            &prf_input,
            &prf_output,
        )
        .unwrap();

        let mut metadata_tampered = record.clone();
        metadata_tampered.credential_id = encode(&[42u8; 48]);
        assert!(matches!(
            unwrap_device_identity(&metadata_tampered, &prf_output),
            Err(DeviceKeyProtectionError::Decrypt)
        ));

        let mut ciphertext_tampered = record;
        let mut ciphertext = decode_field("ciphertext", &ciphertext_tampered.ciphertext).unwrap();
        ciphertext[0] ^= 0x80;
        ciphertext_tampered.ciphertext = encode(&ciphertext);
        assert!(matches!(
            unwrap_device_identity(&ciphertext_tampered, &prf_output),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
    }

    #[test]
    fn unsupported_version_and_parameters_fail_closed() {
        let (identity, credential_id, user_handle, prf_input, prf_output) = fixture();
        let record = wrap_device_identity(
            &identity,
            &credential_id,
            &user_handle,
            &prf_input,
            &prf_output,
        )
        .unwrap();

        let mut wrong_version = record.clone();
        wrong_version.version += 1;
        assert!(matches!(
            unwrap_device_identity(&wrong_version, &prf_output),
            Err(DeviceKeyProtectionError::UnsupportedVersion(2))
        ));

        let mut wrong_cipher = record;
        wrong_cipher.cipher = "aes-128-gcm".to_owned();
        assert!(matches!(
            unwrap_device_identity(&wrong_cipher, &prf_output),
            Err(DeviceKeyProtectionError::UnsupportedParameters)
        ));
    }

    #[test]
    fn invalid_input_lengths_are_rejected() {
        let (identity, credential_id, user_handle, prf_input, prf_output) = fixture();
        assert!(matches!(
            wrap_device_identity(&identity, &[], &user_handle, &prf_input, &prf_output),
            Err(DeviceKeyProtectionError::CredentialIdEmpty)
        ));
        assert!(matches!(
            wrap_device_identity(
                &identity,
                &credential_id,
                &[1u8; 65],
                &prf_input,
                &prf_output
            ),
            Err(DeviceKeyProtectionError::UserHandleInvalid)
        ));
        assert!(matches!(
            wrap_device_identity(
                &identity,
                &credential_id,
                &user_handle,
                &[1u8; 31],
                &prf_output
            ),
            Err(DeviceKeyProtectionError::PrfInputInvalid)
        ));
        assert!(matches!(
            wrap_device_identity(
                &identity,
                &credential_id,
                &user_handle,
                &prf_input,
                &[1u8; 31]
            ),
            Err(DeviceKeyProtectionError::PrfOutputInvalid)
        ));
    }
}
