use super::{
    AES_GCM_NONCE_LEN, AES_KEY_LEN, AGE_SECRET_KEY_PREFIX, Aead, Aes256Gcm, Array, Bech32,
    CIPHER_NAME, CREDENTIAL_ID_MAX_LEN, Deserialize, DeviceIdentitySecret,
    DeviceKeyProtectionError, DeviceKeyProtectionResult, Engine, Hkdf, Hrp, KDF_NAME, KeyInit,
    PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION, PASSKEY_WRAPPED_AAD_CONTEXT,
    PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION, PASSKEY_WRAPPING_HKDF_INFO,
    PASSKEY_WRAPPING_SALT_LEN, PIN_AAD_CONTEXT, PIN_DEVICE_KEY_PROTECTION_VERSION, PIN_KDF_NAME,
    PIN_MIN_LEN, PIN_PBKDF2_ITERATIONS, PIN_SALT_LEN, PRF_INPUT_LEN, PRF_OUTPUT_LEN,
    PasskeyDeviceProtectionMode, Payload, Pbkdf2Sha256, Serialize, Sha256, URL_SAFE_NO_PAD,
    USER_HANDLE_MAX_LEN, Zeroize, Zeroizing, fill, pbkdf2_hmac,
};

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
    pub fn device_mode(&self) -> DeviceKeyProtectionResult<&'static str> {
        match self {
            Self::PasskeyDerived(_) => Ok(PasskeyDeviceProtectionMode::Standard.as_str()),
            Self::PasskeyWrappedLocal(_) => Ok(PasskeyDeviceProtectionMode::AntiHacker.as_str()),
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
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
    fill(&mut salt).map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
    fill(&mut nonce).map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;

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
    fill(&mut salt).map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
    fill(&mut nonce).map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;

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
    let aad = build_pin_aad(&salt, &nonce, record.iterations);
    decrypt_device_identity(&key, nonce, &ciphertext, &aad)
}

fn decrypt_device_identity(
    key: &Zeroizing<[u8; 32]>,
    nonce: [u8; AES_GCM_NONCE_LEN],
    ciphertext: &[u8],
    aad: &[u8],
) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                &Array(nonce),
                Payload {
                    msg: ciphertext,
                    aad,
                },
            )
            .map_err(|_| DeviceKeyProtectionError::Decrypt)?,
    );
    let text = std::str::from_utf8(plaintext.as_ref())
        .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
    DeviceIdentitySecret::parse(text).map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)
}

pub(super) fn unwrap_passkey_wrapped_device_identity(
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
    let aad = build_passkey_wrapped_aad(record);
    decrypt_device_identity(&key, nonce, &ciphertext, &aad)
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

pub(super) fn validate_credential_id(credential_id: &[u8]) -> DeviceKeyProtectionResult<()> {
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

pub(super) fn validate_prf_input(
    prf_input: &[u8],
) -> DeviceKeyProtectionResult<[u8; PRF_INPUT_LEN]> {
    if prf_input.len() != PRF_INPUT_LEN {
        return Err(DeviceKeyProtectionError::PrfInputInvalid);
    }
    let mut input = [0u8; PRF_INPUT_LEN];
    input.copy_from_slice(prf_input);
    Ok(input)
}

pub(super) fn validate_recovery_inputs(
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

pub(super) fn encode_age_identity_secret(secret_bytes: &[u8]) -> DeviceKeyProtectionResult<String> {
    let hrp = Hrp::parse(AGE_SECRET_KEY_PREFIX)
        .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
    let mut encoded = bech32::encode::<Bech32>(hrp, secret_bytes)
        .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
    encoded.make_ascii_uppercase();
    Ok(encoded)
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
        auth::device_key_protection::{
            derive_device_identity_from_passkey_prf, deterministic_passkey_prf_input,
            finish_passkey_wrapped_device_identity, recover_passkey_device_identity,
            unlock_passkey_device_identity,
        },
    };

    fn passkey_derived_record(
        record: &WrappedDeviceIdentity,
    ) -> anyhow::Result<&PasskeyDerivedDeviceIdentity> {
        match record {
            WrappedDeviceIdentity::PasskeyDerived(inner) => Ok(inner),
            _ => Err(anyhow::anyhow!("expected passkey-derived record")),
        }
    }

    fn passkey_wrapped_record(
        record: &WrappedDeviceIdentity,
    ) -> anyhow::Result<&PasskeyWrappedLocalDeviceIdentity> {
        match record {
            WrappedDeviceIdentity::PasskeyWrappedLocal(inner) => Ok(inner),
            _ => Err(anyhow::anyhow!("expected passkey-wrapped-local record")),
        }
    }

    #[test]
    fn passkey_derived_record_stores_only_recovery_metadata() -> anyhow::Result<()> {
        let credential_id = vec![7u8; 48];
        let user_handle = vec![8u8; 32];
        let prf_input = deterministic_passkey_prf_input();
        let record =
            passkey_derived_device_identity_record(&credential_id, &user_handle, &prf_input)?;
        let json = serialize_wrapped_device_identity(&record)?;
        let parsed = parse_wrapped_device_identity(&json)?;

        assert_eq!(parsed.protection_mode(), "passkey");
        assert_eq!(parsed.credential_id_bytes()?, credential_id);
        assert_eq!(parsed.user_handle_bytes()?, user_handle);
        assert_eq!(parsed.prf_input_bytes()?, prf_input);
        assert_eq!(
            passkey_derived_record(&parsed)?.version,
            PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION
        );
        assert!(!json.contains("ciphertext"));
        assert!(!json.contains("AGE-SECRET-KEY-"));
        Ok(())
    }

    #[test]
    fn anti_hacker_record_wraps_random_identity_locally() -> anyhow::Result<()> {
        let credential_id = vec![7u8; 48];
        let user_handle = vec![8u8; 32];
        let prf_input = deterministic_passkey_prf_input();
        let prf_output = [10u8; 32];
        let material = finish_passkey_wrapped_device_identity(
            &credential_id,
            &user_handle,
            &prf_input,
            &prf_output,
        )?;
        let json = serialize_wrapped_device_identity(material.record())?;
        let parsed = parse_wrapped_device_identity(&json)?;
        let record = passkey_wrapped_record(&parsed)?;

        assert_eq!(parsed.protection_mode(), "passkey");
        assert_eq!(parsed.device_mode()?, "anti-hacker");
        assert_eq!(
            record.version,
            PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION
        );
        assert_eq!(parsed.credential_id_bytes()?, credential_id);
        assert_eq!(parsed.user_handle_bytes()?, user_handle);
        assert_eq!(parsed.prf_input_bytes()?, prf_input);
        assert!(json.contains("ciphertext"));
        assert!(json.contains("nonce"));
        assert!(!json.contains("AGE-SECRET-KEY-"));
        assert_ne!(
            material.identity_secret(),
            &derive_device_identity_from_passkey_prf(&user_handle, &prf_output)?
        );
        Ok(())
    }

    #[test]
    fn anti_hacker_unlock_requires_local_wrapper_and_matching_prf() -> anyhow::Result<()> {
        let credential_id = vec![7u8; 48];
        let user_handle = vec![8u8; 32];
        let prf_input = deterministic_passkey_prf_input();
        let prf_output = [10u8; 32];
        let material = finish_passkey_wrapped_device_identity(
            &credential_id,
            &user_handle,
            &prf_input,
            &prf_output,
        )?;

        let unlocked =
            unlock_passkey_device_identity(material.device_id(), material.record(), &prf_output)?;
        assert_eq!(&unlocked, material.identity_secret());
        assert!(
            unlock_passkey_device_identity(material.device_id(), material.record(), &[11u8; 32])
                .is_err()
        );

        let recovered = recover_passkey_device_identity(&credential_id, &user_handle, &prf_output)?;
        assert_ne!(recovered.device_id(), material.device_id());
        Ok(())
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
    fn pin_wrap_round_trips_and_serializes_without_plaintext() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let record = wrap_device_identity_with_pin(&identity, "123456")?;
        let json = serialize_wrapped_device_identity(&record)?;
        assert!(!json.contains(identity.as_str()));
        assert!(json.contains(r#""protection":"pin""#));

        let parsed = parse_wrapped_device_identity(&json)?;
        assert_eq!(parsed.protection_mode(), "pin");
        let decrypted = unwrap_device_identity_with_pin(&parsed, "123456")?;
        assert_eq!(decrypted, identity);
        Ok(())
    }

    #[test]
    fn wrong_pin_does_not_decrypt() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let record = wrap_device_identity_with_pin(&identity, "123456")?;
        assert!(matches!(
            unwrap_device_identity_with_pin(&record, "654321"),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
        Ok(())
    }

    #[test]
    fn pin_metadata_and_ciphertext_reject_tampering() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let record = wrap_device_identity_with_pin(&identity, "123456")?;

        let mut metadata_tampered = record.clone();
        let WrappedDeviceIdentity::Pin(pin) = &mut metadata_tampered else {
            return Err(anyhow::anyhow!("expected pin record"));
        };
        pin.iterations += 1;
        assert!(matches!(
            unwrap_device_identity_with_pin(&metadata_tampered, "123456"),
            Err(DeviceKeyProtectionError::Decrypt)
        ));

        let mut ciphertext_tampered = record;
        let WrappedDeviceIdentity::Pin(pin) = &mut ciphertext_tampered else {
            return Err(anyhow::anyhow!("expected pin record"));
        };
        let mut ciphertext = URL_SAFE_NO_PAD.decode(&pin.ciphertext)?;
        ciphertext[0] ^= 0x80;
        pin.ciphertext = URL_SAFE_NO_PAD.encode(&ciphertext);
        assert!(matches!(
            unwrap_device_identity_with_pin(&ciphertext_tampered, "123456"),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
        Ok(())
    }

    #[test]
    fn pin_requires_minimum_length() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        assert!(matches!(
            wrap_device_identity_with_pin(&identity, "12345"),
            Err(DeviceKeyProtectionError::PinTooShort)
        ));
        let record = wrap_device_identity_with_pin(&identity, "123456")?;
        assert!(matches!(
            unwrap_device_identity_with_pin(&record, "12345"),
            Err(DeviceKeyProtectionError::PinTooShort)
        ));
        Ok(())
    }
}
