#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Parameter-admitted ciphertext is decrypted once, without persistence or browser claims.
use super::pin::{PinWrappingKeyInput, ValidatedPin};
use super::{
    AES_GCM_NONCE_LEN, AGE_SECRET_KEY_PREFIX, Aead, Aes256Gcm, Array, Bech32, CIPHER_NAME,
    DeviceIdentitySecret, DeviceKeyProtectionError, DeviceKeyProtectionResult, Hrp, KDF_NAME,
    KeyInit, PASSKEY_WRAPPED_AAD_CONTEXT, PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION,
    PASSKEY_WRAPPING_SALT_LEN, PIN_AAD_CONTEXT, PIN_DEVICE_KEY_PROTECTION_VERSION, PIN_KDF_NAME,
    PIN_SALT_LEN, PasskeyDeviceProtectionMode, PasskeyKeyInput, PasskeyWrappedLocalDeviceIdentity,
    Payload, WebAuthnPrfOutput, WrappedDeviceIdentity, Zeroize, Zeroizing,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use std::str;

struct PreparedIdentityDecryption {
    key: Zeroizing<[u8; 32]>,
    nonce: [u8; AES_GCM_NONCE_LEN],
    ciphertext: Vec<u8>,
    aad: Zeroizing<Vec<u8>>,
}
impl PreparedIdentityDecryption {
    fn decrypt(self) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
        let Self {
            key,
            nonce,
            ciphertext,
            aad,
        } = self;

        let cipher = Aes256Gcm::new_from_slice(key.as_ref())
            .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
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
        let text = str::from_utf8(plaintext.as_ref())
            .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
        DeviceIdentitySecret::parse(text)
            .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)
    }
}
impl WrappedDeviceIdentity {
    pub fn unwrap_pin(&self, pin: &str) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
        self.prepare_pin(pin)?.decrypt()
    }
    fn prepare_pin(&self, pin: &str) -> DeviceKeyProtectionResult<PreparedIdentityDecryption> {
        let record = self;

        let WrappedDeviceIdentity::Pin(record) = record else {
            return Err(DeviceKeyProtectionError::UnsupportedParameters);
        };
        let pin = ValidatedPin::parse(pin)?;
        if record.version != PIN_DEVICE_KEY_PROTECTION_VERSION {
            return Err(DeviceKeyProtectionError::UnsupportedVersion(record.version));
        }
        if record.protection != "pin" || record.kdf != PIN_KDF_NAME || record.cipher != CIPHER_NAME
        {
            return Err(DeviceKeyProtectionError::UnsupportedParameters);
        }
        if u32::from(record.iterations) == 0 {
            return Err(DeviceKeyProtectionError::UnsupportedParameters);
        }

        let salt = (ProtectionField {
            name: "salt",
            encoded: &record.salt,
        })
        .fixed::<PIN_SALT_LEN>()?;
        let nonce = (ProtectionField {
            name: "nonce",
            encoded: &record.nonce,
        })
        .fixed::<AES_GCM_NONCE_LEN>()?;
        let ciphertext = (ProtectionField {
            name: "ciphertext",
            encoded: &record.ciphertext,
        })
        .decode()?;
        let key = pin.wrapping_key(&PinWrappingKeyInput {
            salt: &salt,
            iterations: record.iterations.into(),
        })?;
        let aad = DeviceIdentityAssociatedData::pin(&PinAssociatedData {
            salt: &salt,
            nonce: &nonce,
            iterations: record.iterations.into(),
        });
        Ok(PreparedIdentityDecryption {
            key,
            nonce,
            ciphertext,
            aad,
        })
    }
}
impl PasskeyWrappedLocalDeviceIdentity {
    pub(in super::super) fn unwrap(
        &self,
        prf_output: &WebAuthnPrfOutput,
    ) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
        self.prepare(prf_output)?.decrypt()
    }
    fn prepare(
        &self,
        prf_output: &WebAuthnPrfOutput,
    ) -> DeviceKeyProtectionResult<PreparedIdentityDecryption> {
        let record = self;

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
        let salt = (ProtectionField {
            name: "hkdfSalt",
            encoded: &record.hkdf_salt,
        })
        .fixed::<PASSKEY_WRAPPING_SALT_LEN>()?;
        let nonce = (ProtectionField {
            name: "nonce",
            encoded: &record.nonce,
        })
        .fixed::<AES_GCM_NONCE_LEN>()?;
        let ciphertext = (ProtectionField {
            name: "ciphertext",
            encoded: &record.ciphertext,
        })
        .decode()?;
        let key = (PasskeyKeyInput {
            prf_output,
            salt: &salt,
        })
        .derive()?;
        let aad = DeviceIdentityAssociatedData::passkey(record);
        Ok(PreparedIdentityDecryption {
            key,
            nonce,
            ciphertext,
            aad,
        })
    }
}
pub(super) struct ProtectionField<'a> {
    pub(super) name: &'static str,
    pub(super) encoded: &'a str,
}
impl ProtectionField<'_> {
    pub(super) fn decode(&self) -> DeviceKeyProtectionResult<Vec<u8>> {
        let Self { name, encoded } = *self;

        URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| DeviceKeyProtectionError::InvalidField(name))
    }
    pub(super) fn fixed<const N: usize>(&self) -> DeviceKeyProtectionResult<[u8; N]> {
        let Self { name, encoded } = *self;

        let mut bytes = (ProtectionField { name, encoded }).decode()?;
        if bytes.len() != N {
            bytes.zeroize();
            return Err(DeviceKeyProtectionError::InvalidField(name));
        }
        let mut fixed = [0u8; N];
        fixed.copy_from_slice(&bytes);
        bytes.zeroize();
        Ok(fixed)
    }
}
pub(super) struct DeviceIdentityAssociatedData(Zeroizing<Vec<u8>>);
pub(super) struct PinAssociatedData<'a> {
    pub(super) salt: &'a [u8],
    pub(super) nonce: &'a [u8],
    pub(super) iterations: u32,
}
impl DeviceIdentityAssociatedData {
    pub(super) fn pin(input: &PinAssociatedData<'_>) -> Zeroizing<Vec<u8>> {
        let PinAssociatedData {
            salt,
            nonce,
            iterations,
        } = *input;

        let mut aad = Self(Zeroizing::new(Vec::with_capacity(
            PIN_AAD_CONTEXT.len() + salt.len() + nonce.len() + 16,
        )));
        aad.0.extend_from_slice(PIN_AAD_CONTEXT);
        aad.append(&PIN_DEVICE_KEY_PROTECTION_VERSION.to_be_bytes());
        aad.append(PIN_KDF_NAME.as_bytes());
        aad.append(&iterations.to_be_bytes());
        aad.append(salt);
        aad.append(nonce);
        aad.0
    }
    pub(super) fn passkey(record: &PasskeyWrappedLocalDeviceIdentity) -> Zeroizing<Vec<u8>> {
        let mut aad = Self(Zeroizing::new(Vec::new()));
        aad.0.extend_from_slice(PASSKEY_WRAPPED_AAD_CONTEXT);
        aad.append(&record.version.to_be_bytes());
        aad.append(record.protection.as_bytes());
        aad.append(record.device_mode.as_bytes());
        aad.append(record.credential_id.as_bytes());
        aad.append(record.user_handle.as_bytes());
        aad.append(record.prf_input.as_bytes());
        aad.append(record.kdf.as_bytes());
        aad.append(record.hkdf_salt.as_bytes());
        aad.append(record.cipher.as_bytes());
        aad.append(record.nonce.as_bytes());
        aad.0
    }
    fn append(&mut self, value: &[u8]) {
        let target = &mut self.0;

        let length = u32::try_from(value.len()).unwrap_or(u32::MAX);
        target.extend_from_slice(&length.to_be_bytes());
        target.extend_from_slice(value);
    }
}
pub(in super::super) struct DeviceIdentitySecretEncoding<'a> {
    pub(in super::super) bytes: &'a [u8],
}
impl DeviceIdentitySecretEncoding<'_> {
    pub(in super::super) fn encode(&self) -> DeviceKeyProtectionResult<String> {
        let secret_bytes = self.bytes;

        let hrp = Hrp::parse(AGE_SECRET_KEY_PREFIX)
            .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
        let mut encoded = bech32::encode::<Bech32>(hrp, secret_bytes)
            .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity)?;
        encoded.make_ascii_uppercase();
        Ok(encoded)
    }
}
#[cfg(test)]
mod tests {
    use super::super::{
        DeviceIdentityProtection, PasskeyProtectionInput, WebAuthnCredentialId, WebAuthnPrfInput,
        WebAuthnUserHandle,
    };
    use super::*;
    use crate::DeviceIdentity;

    struct EncryptedIdentityFixture {
        identity: DeviceIdentitySecret,
        record: PasskeyWrappedLocalDeviceIdentity,
        output: WebAuthnPrfOutput,
    }
    impl EncryptedIdentityFixture {
        fn new() -> anyhow::Result<Self> {
            let identity = DeviceIdentity::generate()?.secret_string();
            let credential_id = WebAuthnCredentialId::try_from(vec![7; 48])?;
            let user_handle = WebAuthnUserHandle::try_from(vec![8; 32])?;
            let prf_input = WebAuthnPrfInput::deterministic();
            let output = WebAuthnPrfOutput::try_from(vec![10; 32])?;
            let wrapped =
                DeviceIdentityProtection::new(&identity).with_passkey(&PasskeyProtectionInput {
                    credential_id: &credential_id,
                    user_handle: &user_handle,
                    prf_input: &prf_input,
                    prf_output: &output,
                })?;
            let WrappedDeviceIdentity::PasskeyWrappedLocal(record) = wrapped else {
                anyhow::bail!("expected passkey-wrapped record");
            };
            Ok(Self {
                identity,
                record,
                output,
            })
        }
    }

    enum AuthenticatedMetadata {
        Credential,
        UserHandle,
        PrfInput,
        Salt,
        Nonce,
    }
    impl AuthenticatedMetadata {
        fn tamper(&self, record: &mut PasskeyWrappedLocalDeviceIdentity) -> anyhow::Result<()> {
            let encoded = match self {
                Self::Credential => &record.credential_id,
                Self::UserHandle => &record.user_handle,
                Self::PrfInput => &record.prf_input,
                Self::Salt => &record.hkdf_salt,
                Self::Nonce => &record.nonce,
            };
            let mut bytes = Engine::decode(&URL_SAFE_NO_PAD, encoded)?;
            bytes[0] ^= 0x80;
            let encoded = match self {
                Self::Credential => &mut record.credential_id,
                Self::UserHandle => &mut record.user_handle,
                Self::PrfInput => &mut record.prf_input,
                Self::Salt => &mut record.hkdf_salt,
                Self::Nonce => &mut record.nonce,
            };
            *encoded = Engine::encode(&URL_SAFE_NO_PAD, &bytes);
            Ok(())
        }
    }

    #[test]
    fn prepared_decryption_retains_exact_ciphertext_and_survives_source_changes()
    -> anyhow::Result<()> {
        let mut fixture = EncryptedIdentityFixture::new()?;
        let original = fixture.record.clone();
        {
            let prepared = fixture.record.prepare(&fixture.output)?;
            assert_eq!(
                prepared.ciphertext,
                Engine::decode(&URL_SAFE_NO_PAD, &original.ciphertext)?
            );
            assert_eq!(
                prepared.nonce.as_slice(),
                Engine::decode(&URL_SAFE_NO_PAD, &original.nonce)?
            );
            assert_eq!(
                prepared.aad.as_slice(),
                DeviceIdentityAssociatedData::passkey(&original).as_slice()
            );
        }
        assert_eq!(fixture.record, original);
        let prepared = fixture.record.prepare(&fixture.output)?;
        fixture.record.ciphertext.clear();
        fixture.record.protection.clear();
        assert_eq!(prepared.decrypt()?, fixture.identity);
        assert!(matches!(
            fixture.record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::UnsupportedParameters)
        ));
        Ok(())
    }

    #[test]
    fn preparation_does_not_claim_prf_authentication() -> anyhow::Result<()> {
        let fixture = EncryptedIdentityFixture::new()?;
        let wrong_output = WebAuthnPrfOutput::try_from(vec![11; 32])?;
        let prepared = fixture.record.prepare(&wrong_output)?;
        assert!(matches!(
            prepared.decrypt(),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
        assert_eq!(
            fixture.record.prepare(&fixture.output)?.decrypt()?,
            fixture.identity
        );
        Ok(())
    }

    #[test]
    fn passkey_ciphertext_binds_credential_user_prf_salt_and_nonce() -> anyhow::Result<()> {
        let fixture = EncryptedIdentityFixture::new()?;
        for field in [
            AuthenticatedMetadata::Credential,
            AuthenticatedMetadata::UserHandle,
            AuthenticatedMetadata::PrfInput,
            AuthenticatedMetadata::Salt,
            AuthenticatedMetadata::Nonce,
        ] {
            let mut tampered = fixture.record.clone();
            field.tamper(&mut tampered)?;
            assert!(matches!(
                tampered.prepare(&fixture.output)?.decrypt(),
                Err(DeviceKeyProtectionError::Decrypt)
            ));
        }
        Ok(())
    }

    #[test]
    fn passkey_admission_retains_parameter_and_field_error_precedence() -> anyhow::Result<()> {
        let fixture = EncryptedIdentityFixture::new()?;
        let mut record = fixture.record.clone();
        record.version = PIN_DEVICE_KEY_PROTECTION_VERSION;
        record.protection.clear();
        record.hkdf_salt = "!".to_owned();
        record.nonce = "!".to_owned();
        record.ciphertext = "!".to_owned();
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::UnsupportedVersion(_))
        ));
        record.version = PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION;
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::UnsupportedParameters)
        ));
        record.protection.clone_from(&fixture.record.protection);
        record.device_mode.clear();
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::UnsupportedParameters)
        ));
        record.device_mode.clone_from(&fixture.record.device_mode);
        record.kdf.clear();
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::UnsupportedParameters)
        ));
        record.kdf.clone_from(&fixture.record.kdf);
        record.cipher.clear();
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::UnsupportedParameters)
        ));
        record.cipher.clone_from(&fixture.record.cipher);
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::InvalidField("hkdfSalt"))
        ));
        record.hkdf_salt = Engine::encode(&URL_SAFE_NO_PAD, [0u8; PASSKEY_WRAPPING_SALT_LEN - 1]);
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::InvalidField("hkdfSalt"))
        ));
        record.hkdf_salt.clone_from(&fixture.record.hkdf_salt);
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::InvalidField("nonce"))
        ));
        record.nonce.clone_from(&fixture.record.nonce);
        assert!(matches!(
            record.prepare(&fixture.output),
            Err(DeviceKeyProtectionError::InvalidField("ciphertext"))
        ));
        let wrapped = WrappedDeviceIdentity::PasskeyWrappedLocal(record);
        assert_eq!(WrappedDeviceIdentity::parse(&wrapped.to_json()?)?, wrapped);
        Ok(())
    }

    #[test]
    fn pin_preparation_can_end_without_changing_the_record() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let record = DeviceIdentityProtection::new(&identity).with_pin("123456")?;
        let before = record.clone();
        {
            let _prepared = record.prepare_pin("123456")?;
        }
        assert_eq!(record, before);
        assert_eq!(record.prepare_pin("123456")?.decrypt()?, identity);
        Ok(())
    }

    #[test]
    fn age_identity_encoding_preserves_legacy_known_answer() -> anyhow::Result<()> {
        let secret_bytes = [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31,
        ];
        assert_eq!(
            (DeviceIdentitySecretEncoding {
                bytes: &secret_bytes
            })
            .encode()?,
            "AGE-SECRET-KEY-1QQQSYQCYQ5RQWZQFPG9SCRGWPUGPZYSNZS23V9CCRYDPK8QARC0SWRYDWG"
        );
        Ok(())
    }
}
