#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{
    AES_GCM_NONCE_LEN, AES_KEY_LEN, AGE_SECRET_KEY_PREFIX, Aead, Aes256Gcm, Array, Bech32,
    CIPHER_NAME, Deserialize, DeviceIdentitySecret, DeviceKeyProtectionError,
    DeviceKeyProtectionResult, DeviceKeyProtectionVersion, Engine, Hkdf, Hrp, KDF_NAME, KeyInit,
    PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION, PASSKEY_WRAPPED_AAD_CONTEXT,
    PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION, PASSKEY_WRAPPING_HKDF_INFO,
    PASSKEY_WRAPPING_SALT_LEN, PIN_AAD_CONTEXT, PIN_DEVICE_KEY_PROTECTION_VERSION, PIN_KDF_NAME,
    PIN_MIN_LEN, PIN_PBKDF2_ITERATIONS, PIN_SALT_LEN, PasskeyDeviceProtectionMode, Payload,
    Pbkdf2Sha256, Serialize, Sha256, URL_SAFE_NO_PAD, WebAuthnCredentialId, WebAuthnPrfInput,
    WebAuthnPrfOutput, WebAuthnUserHandle, Zeroize, Zeroizing,
};
use crate::DeviceKeyDerivationIterations;

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
    pub version: DeviceKeyProtectionVersion,
    pub protection: String,
    pub credential_id: String,
    pub user_handle: String,
    pub prf_input: String,
    pub kdf: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyWrappedLocalDeviceIdentity {
    pub version: DeviceKeyProtectionVersion,
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
    pub version: DeviceKeyProtectionVersion,
    pub protection: String,
    pub kdf: String,
    pub iterations: DeviceKeyDerivationIterations,
    pub salt: String,
    pub cipher: String,
    pub nonce: String,
    pub ciphertext: String,
}

impl WrappedDeviceIdentity {
    pub fn credential_id(&self) -> DeviceKeyProtectionResult<WebAuthnCredentialId> {
        let bytes = match self {
            Self::PasskeyDerived(record) => (ProtectionField {
                name: "credentialId",
                encoded: &record.credential_id,
            })
            .decode(),
            Self::PasskeyWrappedLocal(record) => (ProtectionField {
                name: "credentialId",
                encoded: &record.credential_id,
            })
            .decode(),
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }?;
        bytes.try_into()
    }

    pub fn user_handle(&self) -> DeviceKeyProtectionResult<WebAuthnUserHandle> {
        let bytes = match self {
            Self::PasskeyDerived(record) => (ProtectionField {
                name: "userHandle",
                encoded: &record.user_handle,
            })
            .decode(),
            Self::PasskeyWrappedLocal(record) => (ProtectionField {
                name: "userHandle",
                encoded: &record.user_handle,
            })
            .decode(),
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }?;
        bytes.try_into()
    }

    pub fn prf_input(&self) -> DeviceKeyProtectionResult<WebAuthnPrfInput> {
        let bytes = match self {
            Self::PasskeyDerived(record) => (ProtectionField {
                name: "prfInput",
                encoded: &record.prf_input,
            })
            .decode(),
            Self::PasskeyWrappedLocal(record) => (ProtectionField {
                name: "prfInput",
                encoded: &record.prf_input,
            })
            .decode(),
            Self::Pin(_) => Err(DeviceKeyProtectionError::UnsupportedParameters),
        }?;
        bytes.try_into()
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

mod cipher;
mod pin;
use cipher::{DeviceIdentityAssociatedData, ProtectionField};

pub(super) use cipher::DeviceIdentitySecretEncoding;

/// Identity material selected for local protection, without a persistence claim.
/// Each operation borrows the caller's secret; a separate attempt can be constructed explicitly.
///
/// ```
/// use nook_auth2::{DeviceIdentityProtection, DeviceIdentitySecret};
/// let wrap = |identity: &DeviceIdentitySecret| -> anyhow::Result<_> {
///     Ok(DeviceIdentityProtection::new(identity).with_pin("123456")?)
/// };
/// ```
///
/// ```compile_fail,E0382
/// use nook_auth2::DeviceIdentityProtection;
/// let twice = |protection: DeviceIdentityProtection<'_>| -> anyhow::Result<_> {
///     protection.with_pin("123456")?;
///     Ok(protection.with_pin("123456")?)
/// };
/// ```
///
/// ```compile_fail,E0451
/// use nook_auth2::{DeviceIdentityProtection, DeviceIdentitySecret};
/// let fabricate = |identity: &DeviceIdentitySecret| {
///     let _ = DeviceIdentityProtection { identity };
/// };
/// ```
///
/// Cipher preparation is an internal operation, unavailable to external callers.
/// ```compile_fail,E0603
/// use nook_auth2::auth::device_key_protection::protected_identity::cipher::PreparedIdentityDecryption;
/// ```
pub struct DeviceIdentityProtection<'a> {
    identity: &'a DeviceIdentitySecret,
}
pub struct PasskeyRecordMetadata<'a> {
    pub credential_id: &'a WebAuthnCredentialId,
    pub user_handle: &'a WebAuthnUserHandle,
    pub prf_input: &'a WebAuthnPrfInput,
}
pub struct PasskeyProtectionInput<'a> {
    pub credential_id: &'a WebAuthnCredentialId,
    pub user_handle: &'a WebAuthnUserHandle,
    pub prf_input: &'a WebAuthnPrfInput,
    pub prf_output: &'a WebAuthnPrfOutput,
}
impl<'a> DeviceIdentityProtection<'a> {
    #[must_use]
    pub fn new(identity: &'a DeviceIdentitySecret) -> Self {
        Self { identity }
    }
    pub fn with_passkey(
        self,
        input: &PasskeyProtectionInput<'_>,
    ) -> DeviceKeyProtectionResult<WrappedDeviceIdentity> {
        let identity = self.identity;
        let PasskeyProtectionInput {
            credential_id,
            user_handle,
            prf_input,
            prf_output,
        } = *input;

        let mut salt = [0u8; PASSKEY_WRAPPING_SALT_LEN];
        let mut nonce = [0u8; AES_GCM_NONCE_LEN];
        getrandom::fill(&mut salt)
            .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;
        getrandom::fill(&mut nonce)
            .map_err(|error| DeviceKeyProtectionError::RandomBytes(error.to_string()))?;

        let mut record = PasskeyWrappedLocalDeviceIdentity {
            version: PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION,
            protection: "passkey-wrapped-local".to_owned(),
            device_mode: PasskeyDeviceProtectionMode::AntiHacker.as_str().to_owned(),
            credential_id: Engine::encode(&URL_SAFE_NO_PAD, credential_id.as_ref()),
            user_handle: Engine::encode(&URL_SAFE_NO_PAD, user_handle.as_ref()),
            prf_input: Engine::encode(&URL_SAFE_NO_PAD, prf_input.as_ref()),
            kdf: KDF_NAME.to_owned(),
            hkdf_salt: Engine::encode(&URL_SAFE_NO_PAD, salt.as_slice()),
            cipher: CIPHER_NAME.to_owned(),
            nonce: Engine::encode(&URL_SAFE_NO_PAD, nonce.as_slice()),
            ciphertext: String::new(),
        };
        let key = (PasskeyKeyInput {
            prf_output,
            salt: &salt,
        })
        .derive()?;
        let cipher = Aes256Gcm::new_from_slice(key.as_ref())
            .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
        let aad = DeviceIdentityAssociatedData::passkey(&record);
        let ciphertext = cipher
            .encrypt(
                &Array(nonce),
                Payload {
                    msg: identity.as_str().as_bytes(),
                    aad: &aad,
                },
            )
            .map_err(|_| DeviceKeyProtectionError::Encrypt)?;
        record.ciphertext = Engine::encode(&URL_SAFE_NO_PAD, &ciphertext);
        Ok(WrappedDeviceIdentity::PasskeyWrappedLocal(record))
    }
}
impl WrappedDeviceIdentity {
    pub fn passkey_derived(input: &PasskeyRecordMetadata<'_>) -> DeviceKeyProtectionResult<Self> {
        let PasskeyRecordMetadata {
            credential_id,
            user_handle,
            prf_input,
        } = *input;

        Ok(WrappedDeviceIdentity::PasskeyDerived(
            PasskeyDerivedDeviceIdentity {
                version: PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION,
                protection: "passkey-derived".to_owned(),
                credential_id: Engine::encode(&URL_SAFE_NO_PAD, credential_id.as_ref()),
                user_handle: Engine::encode(&URL_SAFE_NO_PAD, user_handle.as_ref()),
                prf_input: Engine::encode(&URL_SAFE_NO_PAD, prf_input.as_ref()),
                kdf: KDF_NAME.to_owned(),
            },
        ))
    }
    pub fn to_json(&self) -> DeviceKeyProtectionResult<String> {
        let record = self;

        serde_json::to_string(record).map_err(DeviceKeyProtectionError::Serialize)
    }
    pub fn parse(raw: &str) -> DeviceKeyProtectionResult<Self> {
        serde_json::from_str(raw).map_err(DeviceKeyProtectionError::Parse)
    }
}
impl PasskeyKeyInput<'_> {
    fn derive(&self) -> DeviceKeyProtectionResult<Zeroizing<[u8; AES_KEY_LEN]>> {
        let PasskeyKeyInput { prf_output, salt } = *self;

        if salt.len() != PASSKEY_WRAPPING_SALT_LEN {
            return Err(DeviceKeyProtectionError::KeyDerivation);
        }
        let hkdf = Hkdf::<Sha256>::new(Some(salt), prf_output.as_ref());
        let mut key = Zeroizing::new([0u8; AES_KEY_LEN]);
        hkdf.expand(PASSKEY_WRAPPING_HKDF_INFO, key.as_mut())
            .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
        Ok(key)
    }
}
struct PasskeyKeyInput<'a> {
    prf_output: &'a WebAuthnPrfOutput,
    salt: &'a [u8],
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeviceIdentity, PasskeyRecoveryRequest, PasskeyRegistration, PasskeyRegistrationInput,
    };

    struct ProtectedRecordFixture<'a> {
        record: &'a WrappedDeviceIdentity,
    }
    impl<'a> ProtectedRecordFixture<'a> {
        fn passkey_derived_record(&self) -> anyhow::Result<&'a PasskeyDerivedDeviceIdentity> {
            match self.record {
                WrappedDeviceIdentity::PasskeyDerived(inner) => Ok(inner),
                _ => Err(anyhow::anyhow!("expected passkey-derived record")),
            }
        }
        fn passkey_wrapped_record(&self) -> anyhow::Result<&'a PasskeyWrappedLocalDeviceIdentity> {
            match self.record {
                WrappedDeviceIdentity::PasskeyWrappedLocal(inner) => Ok(inner),
                _ => Err(anyhow::anyhow!("expected passkey-wrapped-local record")),
            }
        }
    }
    #[test]
    fn passkey_derived_record_stores_only_recovery_metadata() -> anyhow::Result<()> {
        let credential_id = WebAuthnCredentialId::try_from(vec![7u8; 48])?;
        let user_handle = WebAuthnUserHandle::try_from(vec![8u8; 32])?;
        let prf_input = WebAuthnPrfInput::deterministic();
        let record = WrappedDeviceIdentity::passkey_derived(&PasskeyRecordMetadata {
            credential_id: &credential_id,
            user_handle: &user_handle,
            prf_input: &prf_input,
        })?;
        let json = record.to_json()?;
        let parsed = WrappedDeviceIdentity::parse(&json)?;

        assert_eq!(parsed.protection_mode(), "passkey");
        assert_eq!(parsed.credential_id()?, credential_id);
        assert_eq!(parsed.user_handle()?, user_handle);
        assert_eq!(parsed.prf_input()?, prf_input);
        assert_eq!(
            (ProtectedRecordFixture { record: &parsed })
                .passkey_derived_record()?
                .version,
            PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION
        );
        assert!(!json.contains("ciphertext"));
        assert!(!json.contains("AGE-SECRET-KEY-"));
        Ok(())
    }
    #[test]
    fn anti_hacker_record_wraps_random_identity_locally() -> anyhow::Result<()> {
        let credential_id = WebAuthnCredentialId::try_from(vec![7u8; 48])?;
        let user_handle = WebAuthnUserHandle::try_from(vec![8u8; 32])?;
        let prf_input = WebAuthnPrfInput::deterministic();
        let prf_output = WebAuthnPrfOutput::try_from(vec![10u8; 32])?;
        let material = PasskeyRegistration::new(PasskeyRegistrationInput {
            credential_id: &credential_id,
            user_handle: &user_handle,
            prf_input: &prf_input,
            mode: PasskeyDeviceProtectionMode::AntiHacker,
        })
        .complete(&prf_output)?;
        let json = material.record().to_json()?;
        let parsed = WrappedDeviceIdentity::parse(&json)?;
        let record = (ProtectedRecordFixture { record: &parsed }).passkey_wrapped_record()?;

        assert_eq!(parsed.protection_mode(), "passkey");
        assert_eq!(parsed.device_mode()?, "anti-hacker");
        assert_eq!(
            record.version,
            PASSKEY_WRAPPED_LOCAL_DEVICE_KEY_PROTECTION_VERSION
        );
        assert_eq!(parsed.credential_id()?, credential_id);
        assert_eq!(parsed.user_handle()?, user_handle);
        assert_eq!(parsed.prf_input()?, prf_input);
        assert!(json.contains("ciphertext"));
        assert!(json.contains("nonce"));
        assert!(!json.contains("AGE-SECRET-KEY-"));
        assert_ne!(
            material.identity_secret(),
            &user_handle.derive_identity(&prf_output)?
        );
        Ok(())
    }
    #[test]
    fn anti_hacker_unlock_requires_local_wrapper_and_matching_prf() -> anyhow::Result<()> {
        let credential_id = WebAuthnCredentialId::try_from(vec![7u8; 48])?;
        let user_handle = WebAuthnUserHandle::try_from(vec![8u8; 32])?;
        let prf_input = WebAuthnPrfInput::deterministic();
        let prf_output = WebAuthnPrfOutput::try_from(vec![10u8; 32])?;
        let material = PasskeyRegistration::new(PasskeyRegistrationInput {
            credential_id: &credential_id,
            user_handle: &user_handle,
            prf_input: &prf_input,
            mode: PasskeyDeviceProtectionMode::AntiHacker,
        })
        .complete(&prf_output)?;

        let unlocked = material
            .record()
            .unlock_passkey(&crate::PasskeyIdentityUnlock {
                stored_device_id: material.device_id(),
                prf_output: &prf_output,
            })?;
        assert_eq!(&unlocked, material.identity_secret());
        let wrong_output = WebAuthnPrfOutput::try_from(vec![11u8; 32])?;
        assert!(
            (material.record())
                .unlock_passkey(&crate::PasskeyIdentityUnlock {
                    stored_device_id: material.device_id(),
                    prf_output: &wrong_output
                })
                .is_err()
        );

        let recovered =
            PasskeyRecoveryRequest::deterministic().recover(&crate::PasskeyRecoveryInput {
                credential_id: &credential_id,
                user_handle: &user_handle,
                prf_output: &prf_output,
            })?;
        assert_ne!(recovered.device_id(), material.device_id());
        Ok(())
    }
    #[test]
    fn passkey_derived_record_rejects_invalid_metadata() {
        assert!(matches!(
            WebAuthnCredentialId::try_from(Vec::new()),
            Err(DeviceKeyProtectionError::CredentialIdEmpty)
        ));
        assert!(matches!(
            WebAuthnUserHandle::try_from(vec![1u8; 65]),
            Err(DeviceKeyProtectionError::UserHandleInvalid)
        ));
        assert!(matches!(
            WebAuthnPrfInput::try_from(vec![1u8; 31]),
            Err(DeviceKeyProtectionError::PrfInputInvalid)
        ));
    }
}
