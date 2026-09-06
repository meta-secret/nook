#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! PIN protection retains its existing trimming, randomness, and KDF order.
use super::cipher::{DeviceIdentityAssociatedData, PinAssociatedData};
use super::{
    AES_GCM_NONCE_LEN, AES_KEY_LEN, Aead, Aes256Gcm, Array, CIPHER_NAME, DeviceIdentityProtection,
    DeviceKeyProtectionError, DeviceKeyProtectionResult, KeyInit,
    PIN_DEVICE_KEY_PROTECTION_VERSION, PIN_KDF_NAME, PIN_MIN_LEN, PIN_PBKDF2_ITERATIONS,
    PIN_SALT_LEN, Payload, Pbkdf2Sha256, PinWrappedDeviceIdentity, WrappedDeviceIdentity,
    Zeroizing,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

pub(super) struct ValidatedPin<'a> {
    value: &'a str,
}
pub(super) struct PinWrappingKeyInput<'a> {
    pub(super) salt: &'a [u8],
    pub(super) iterations: u32,
}
impl<'a> ValidatedPin<'a> {
    pub(super) fn parse(pin: &'a str) -> DeviceKeyProtectionResult<Self> {
        let trimmed = pin.trim();
        if trimmed.len() < PIN_MIN_LEN {
            return Err(DeviceKeyProtectionError::PinTooShort);
        }
        Ok(Self { value: trimmed })
    }
    pub(super) fn wrapping_key(
        &self,
        input: &PinWrappingKeyInput<'_>,
    ) -> DeviceKeyProtectionResult<Zeroizing<[u8; AES_KEY_LEN]>> {
        let pin = self.value;
        let PinWrappingKeyInput { salt, iterations } = *input;

        if iterations == 0 {
            return Err(DeviceKeyProtectionError::KeyDerivation);
        }
        let mut key = Zeroizing::new([0u8; AES_KEY_LEN]);
        pbkdf2::pbkdf2_hmac::<Pbkdf2Sha256>(pin.as_bytes(), salt, iterations, key.as_mut());
        Ok(key)
    }
}
impl DeviceIdentityProtection<'_> {
    pub fn with_pin(self, pin: &str) -> DeviceKeyProtectionResult<WrappedDeviceIdentity> {
        let identity = self.identity;

        let pin = ValidatedPin::parse(pin)?;
        let mut salt = [0u8; PIN_SALT_LEN];
        let mut nonce = [0u8; AES_GCM_NONCE_LEN];
        getrandom::fill(&mut salt)
            .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
        getrandom::fill(&mut nonce)
            .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;

        let key = pin.wrapping_key(&PinWrappingKeyInput {
            salt: &salt,
            iterations: PIN_PBKDF2_ITERATIONS,
        })?;
        let cipher = Aes256Gcm::new_from_slice(key.as_ref())
            .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
        let aad = DeviceIdentityAssociatedData::pin(&PinAssociatedData {
            salt: &salt,
            nonce: &nonce,
            iterations: PIN_PBKDF2_ITERATIONS,
        });
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
            iterations: PIN_PBKDF2_ITERATIONS.into(),
            salt: Engine::encode(&URL_SAFE_NO_PAD, salt.as_slice()),
            cipher: CIPHER_NAME.to_owned(),
            nonce: Engine::encode(&URL_SAFE_NO_PAD, nonce.as_slice()),
            ciphertext: Engine::encode(&URL_SAFE_NO_PAD, &ciphertext),
        }))
    }
}
#[cfg(test)]
mod tests {
    use super::super::{
        PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION, PasskeyRecordMetadata, WebAuthnCredentialId,
        WebAuthnPrfInput, WebAuthnUserHandle,
    };
    use super::*;
    use crate::{DeviceIdentity, DeviceKeyDerivationIterations};

    #[test]
    fn pin_whitespace_and_minimum_length_keep_byte_semantics() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let record = DeviceIdentityProtection::new(&identity).with_pin(" \t123456\n ")?;
        assert_eq!(record.unwrap_pin("123456")?, identity);
        assert_eq!(record.unwrap_pin("\n123456\t")?, identity);
        assert_eq!(ValidatedPin::parse("  ééé  ")?.value, "ééé");
        assert!(matches!(
            ValidatedPin::parse("éé"),
            Err(DeviceKeyProtectionError::PinTooShort)
        ));
        Ok(())
    }

    #[test]
    fn pin_admission_preserves_variant_pin_version_and_parameter_order() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let mut record = DeviceIdentityProtection::new(&identity).with_pin("123456")?;
        let WrappedDeviceIdentity::Pin(inner) = &mut record else {
            anyhow::bail!("expected PIN record");
        };
        inner.version = PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION;
        inner.salt = "!".to_owned();
        assert!(matches!(
            record.unwrap_pin("short"),
            Err(DeviceKeyProtectionError::PinTooShort)
        ));
        assert!(matches!(
            record.unwrap_pin("123456"),
            Err(DeviceKeyProtectionError::UnsupportedVersion(_))
        ));
        let WrappedDeviceIdentity::Pin(inner) = &mut record else {
            anyhow::bail!("expected PIN record");
        };
        inner.version = PIN_DEVICE_KEY_PROTECTION_VERSION;
        inner.iterations = 0.into();
        assert!(matches!(
            record.unwrap_pin("123456"),
            Err(DeviceKeyProtectionError::UnsupportedParameters)
        ));
        let WrappedDeviceIdentity::Pin(inner) = &mut record else {
            anyhow::bail!("expected PIN record");
        };
        inner.iterations = PIN_PBKDF2_ITERATIONS.into();
        assert!(matches!(
            record.unwrap_pin("123456"),
            Err(DeviceKeyProtectionError::InvalidField("salt"))
        ));
        let json = record.to_json()?;
        assert_eq!(WrappedDeviceIdentity::parse(&json)?, record);
        let credential_id = WebAuthnCredentialId::try_from(vec![7; 48])?;
        let user_handle = WebAuthnUserHandle::try_from(vec![8; 32])?;
        let prf_input = WebAuthnPrfInput::deterministic();
        let other_kind = WrappedDeviceIdentity::passkey_derived(&PasskeyRecordMetadata {
            credential_id: &credential_id,
            user_handle: &user_handle,
            prf_input: &prf_input,
        })?;
        assert!(matches!(
            other_kind.unwrap_pin("short"),
            Err(DeviceKeyProtectionError::UnsupportedParameters)
        ));
        Ok(())
    }

    #[test]
    fn pin_wrap_round_trips_and_serializes_without_plaintext() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let record = DeviceIdentityProtection::new(&identity).with_pin("123456")?;
        let json = record.to_json()?;
        assert!(!json.contains(identity.as_str()));
        assert!(json.contains(r#""protection":"pin""#));

        let parsed = WrappedDeviceIdentity::parse(&json)?;
        assert_eq!(parsed.protection_mode(), "pin");
        let decrypted = parsed.unwrap_pin("123456")?;
        assert_eq!(decrypted, identity);
        Ok(())
    }
    #[test]
    fn wrong_pin_does_not_decrypt() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let record = DeviceIdentityProtection::new(&identity).with_pin("123456")?;
        assert!(matches!(
            record.unwrap_pin("654321"),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
        Ok(())
    }
    #[test]
    fn pin_metadata_and_ciphertext_reject_tampering() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        let record = DeviceIdentityProtection::new(&identity).with_pin("123456")?;

        let mut metadata_tampered = record.clone();
        let WrappedDeviceIdentity::Pin(pin) = &mut metadata_tampered else {
            return Err(anyhow::anyhow!("expected pin record"));
        };
        pin.iterations = DeviceKeyDerivationIterations::from(u32::from(pin.iterations) + 1);
        assert!(matches!(
            metadata_tampered.unwrap_pin("123456"),
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
            ciphertext_tampered.unwrap_pin("123456"),
            Err(DeviceKeyProtectionError::Decrypt)
        ));
        Ok(())
    }
    #[test]
    fn pin_requires_minimum_length() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?.secret_string();
        assert!(matches!(
            DeviceIdentityProtection::new(&identity).with_pin("12345"),
            Err(DeviceKeyProtectionError::PinTooShort)
        ));
        let record = DeviceIdentityProtection::new(&identity).with_pin("123456")?;
        assert!(matches!(
            record.unwrap_pin("12345"),
            Err(DeviceKeyProtectionError::PinTooShort)
        ));
        Ok(())
    }
}
