#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Deterministic derivation and stored-identity checks, without browser authorization claims.
use super::protected_identity::DeviceIdentitySecretEncoding;
use super::{
    DETERMINISTIC_IDENTITY_HKDF_INFO, DETERMINISTIC_PRF_INPUT_CONTEXT,
    DETERMINISTIC_SIGNER_HKDF_INFO, DeviceIdentity, DeviceIdentitySecret, DeviceKeyProtectionError,
    DeviceKeyProtectionResult, PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION, PRF_INPUT_LEN,
    PasskeyAssertionRequest, PasskeyDeviceIdentityMaterial, PasskeyDeviceProtectionMode,
    PasskeyRecoveryRequest, SigningSeedHex, WebAuthnCredentialId, WebAuthnPrfInput,
    WebAuthnPrfOutput, WebAuthnUserHandle, WrappedDeviceIdentity,
};
use super::{PasskeyRegistration, PasskeyRegistrationInput};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

pub struct PasskeyIdentityUnlock<'a> {
    pub stored_device_id: &'a str,
    pub prf_output: &'a WebAuthnPrfOutput,
}
pub struct PasskeyRecoveryInput<'a> {
    pub credential_id: &'a WebAuthnCredentialId,
    pub user_handle: &'a WebAuthnUserHandle,
    pub prf_output: &'a WebAuthnPrfOutput,
}
impl WebAuthnPrfInput {
    #[must_use]
    pub fn deterministic() -> Self {
        let digest = Sha256::digest(DETERMINISTIC_PRF_INPUT_CONTEXT);
        let mut input = [0u8; PRF_INPUT_LEN];
        input.copy_from_slice(&digest);
        WebAuthnPrfInput::from_validated(input)
    }
}
impl WebAuthnUserHandle {
    pub fn derive_identity(
        &self,
        prf_output: &WebAuthnPrfOutput,
    ) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
        let user_handle = self;

        let hkdf = Hkdf::<Sha256>::new(Some(user_handle.as_ref()), prf_output.as_ref());
        let mut secret_bytes = Zeroizing::new([0u8; 32]);
        hkdf.expand(DETERMINISTIC_IDENTITY_HKDF_INFO, secret_bytes.as_mut())
            .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
        let mut encoded = (DeviceIdentitySecretEncoding {
            bytes: secret_bytes.as_ref(),
        })
        .encode()?;
        let secret = DeviceIdentitySecret::parse(&encoded)
            .map_err(|_| DeviceKeyProtectionError::InvalidDeviceIdentity);
        encoded.zeroize();
        secret
    }

    /// The member's Ed25519 event-signing seed, from the same PRF output as
    /// the app key under its own label, so the two keys never coincide.
    pub fn derive_signing_seed(
        &self,
        prf_output: &WebAuthnPrfOutput,
    ) -> DeviceKeyProtectionResult<SigningSeedHex> {
        let hkdf = Hkdf::<Sha256>::new(Some(self.as_ref()), prf_output.as_ref());
        let mut seed_bytes = Zeroizing::new([0u8; 32]);
        hkdf.expand(DETERMINISTIC_SIGNER_HKDF_INFO, seed_bytes.as_mut())
            .map_err(|_| DeviceKeyProtectionError::KeyDerivation)?;
        let encoded = Zeroizing::new(hex::encode(seed_bytes.as_slice()));
        SigningSeedHex::parse(&encoded).map_err(|_| DeviceKeyProtectionError::KeyDerivation)
    }
}
impl WrappedDeviceIdentity {
    pub fn assertion_request(&self) -> DeviceKeyProtectionResult<PasskeyAssertionRequest> {
        let record = self;

        Ok(PasskeyAssertionRequest::new(
            record.credential_id()?,
            record.prf_input()?,
        ))
    }
    pub fn unlock_passkey(
        &self,
        input: &PasskeyIdentityUnlock<'_>,
    ) -> DeviceKeyProtectionResult<DeviceIdentitySecret> {
        let record = self;
        let PasskeyIdentityUnlock {
            stored_device_id,
            prf_output,
        } = *input;

        let secret = match record {
            WrappedDeviceIdentity::PasskeyDerived(inner) => {
                if inner.version != PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION {
                    return Err(DeviceKeyProtectionError::UnsupportedVersion(inner.version));
                }
                let user_handle = record.user_handle()?;
                user_handle.derive_identity(prf_output)?
            }
            WrappedDeviceIdentity::PasskeyWrappedLocal(inner) => inner.unwrap(prf_output)?,
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
}
impl PasskeyRecoveryRequest {
    #[must_use]
    pub fn deterministic() -> Self {
        PasskeyRecoveryRequest {
            prf_input: WebAuthnPrfInput::deterministic(),
        }
    }
    pub fn recover(
        &self,
        input: &PasskeyRecoveryInput<'_>,
    ) -> DeviceKeyProtectionResult<PasskeyDeviceIdentityMaterial> {
        PasskeyRegistration::new(PasskeyRegistrationInput {
            credential_id: input.credential_id,
            user_handle: input.user_handle,
            prf_input: &self.prf_input,
            mode: PasskeyDeviceProtectionMode::Standard,
        })
        .complete(input.prf_output)
    }
}
#[cfg(test)]
mod tests {
    use super::super::{DeviceKeyProtectionVersion, PasskeyMemberSigner};
    use super::*;

    #[test]
    fn unlock_retains_version_before_field_validation_and_stored_identity_check()
    -> anyhow::Result<()> {
        let credential_id = WebAuthnCredentialId::try_from(vec![7; 48])?;
        let user_handle = WebAuthnUserHandle::try_from(vec![8; 32])?;
        let prf_input = WebAuthnPrfInput::deterministic();
        let output = WebAuthnPrfOutput::try_from(vec![10; 32])?;
        let material = PasskeyRegistration::new(PasskeyRegistrationInput {
            credential_id: &credential_id,
            user_handle: &user_handle,
            prf_input: &prf_input,
            mode: PasskeyDeviceProtectionMode::Standard,
        })
        .complete(&output)?;
        let original = material.record().clone();
        assert!(matches!(
            material.record().unlock_passkey(&PasskeyIdentityUnlock {
                stored_device_id: "different-device",
                prf_output: &output,
            }),
            Err(DeviceKeyProtectionError::DeviceIdentityMismatch)
        ));
        assert_eq!(material.record(), &original);
        let mut malformed = original;
        let WrappedDeviceIdentity::PasskeyDerived(inner) = &mut malformed else {
            anyhow::bail!("standard registration must produce a derived record");
        };
        inner.version = DeviceKeyProtectionVersion::PIN;
        inner.user_handle = "!".to_owned();
        assert!(matches!(
            malformed.unlock_passkey(&PasskeyIdentityUnlock {
                stored_device_id: material.device_id(),
                prf_output: &output,
            }),
            Err(DeviceKeyProtectionError::UnsupportedVersion(_))
        ));
        let WrappedDeviceIdentity::PasskeyDerived(inner) = &mut malformed else {
            anyhow::bail!("record kind must remain derived");
        };
        inner.version = PASSKEY_DERIVED_DEVICE_KEY_PROTECTION_VERSION;
        assert!(matches!(
            malformed.unlock_passkey(&PasskeyIdentityUnlock {
                stored_device_id: material.device_id(),
                prf_output: &output,
            }),
            Err(DeviceKeyProtectionError::InvalidField("userHandle"))
        ));
        Ok(())
    }

    #[test]
    fn passkey_prf_derives_stable_age_identity() -> anyhow::Result<()> {
        let user_handle = WebAuthnUserHandle::try_from(vec![8u8; 32])?;
        let prf_output = WebAuthnPrfOutput::try_from(vec![10u8; 32])?;
        let identity = user_handle.derive_identity(&prf_output)?;
        let same = user_handle.derive_identity(&prf_output)?;
        let different_user = WebAuthnUserHandle::try_from(vec![9u8; 32])?;
        let different_prf = WebAuthnPrfOutput::try_from(vec![11u8; 32])?;
        let different_user = different_user.derive_identity(&prf_output)?;
        let different_prf = user_handle.derive_identity(&different_prf)?;

        assert_eq!(identity, same);
        assert_ne!(identity, different_user);
        assert_ne!(identity, different_prf);
        assert!(identity.as_str().starts_with("AGE-SECRET-KEY-"));
        Ok(())
    }

    /// One passkey's registration material, created with a fixed PRF output.
    fn registered(
        mode: PasskeyDeviceProtectionMode,
        prf_output: &WebAuthnPrfOutput,
    ) -> anyhow::Result<PasskeyDeviceIdentityMaterial> {
        Ok(PasskeyRegistration::new(PasskeyRegistrationInput {
            credential_id: &WebAuthnCredentialId::try_from(vec![7; 48])?,
            user_handle: &WebAuthnUserHandle::try_from(vec![8; 32])?,
            prf_input: &WebAuthnPrfInput::deterministic(),
            mode,
        })
        .complete(prf_output)?)
    }

    #[test]
    fn a_passkey_re_derives_the_same_signer_it_created() -> anyhow::Result<()> {
        let prf_output = WebAuthnPrfOutput::try_from(vec![10; 32])?;
        let created = registered(PasskeyDeviceProtectionMode::Standard, &prf_output)?;

        let recovered = PasskeyRecoveryRequest::deterministic().recover(&PasskeyRecoveryInput {
            credential_id: &WebAuthnCredentialId::try_from(vec![7; 48])?,
            user_handle: &WebAuthnUserHandle::try_from(vec![8; 32])?,
            prf_output: &prf_output,
        })?;
        let other = registered(
            PasskeyDeviceProtectionMode::Standard,
            &WebAuthnPrfOutput::try_from(vec![11; 32])?,
        )?;

        assert!(matches!(created.signer(), PasskeyMemberSigner::Derived(_)));
        assert_eq!(recovered.signer(), created.signer());
        assert_eq!(recovered.identity_secret(), created.identity_secret());
        assert_ne!(other.signer(), created.signer());
        Ok(())
    }

    #[test]
    fn the_signer_label_differs_from_the_app_key_label() -> anyhow::Result<()> {
        let prf_output = WebAuthnPrfOutput::try_from(vec![10; 32])?;
        let created = registered(PasskeyDeviceProtectionMode::Standard, &prf_output)?;
        let PasskeyMemberSigner::Derived(seed) = created.signer() else {
            anyhow::bail!("a passkey-derived app key has a derived signer");
        };
        let (_, app_key_bytes) =
            bech32::decode(&created.identity_secret().as_str().to_lowercase())?;

        assert_ne!(
            DETERMINISTIC_SIGNER_HKDF_INFO,
            DETERMINISTIC_IDENTITY_HKDF_INFO
        );
        assert_ne!(hex::decode(seed.as_str())?, app_key_bytes);
        Ok(())
    }

    #[test]
    fn a_passkey_that_wraps_a_random_app_key_leaves_the_signer_to_the_installation()
    -> anyhow::Result<()> {
        let prf_output = WebAuthnPrfOutput::try_from(vec![10; 32])?;

        let wrapped = registered(PasskeyDeviceProtectionMode::AntiHacker, &prf_output)?;

        assert_eq!(wrapped.signer(), &PasskeyMemberSigner::Installation);
        Ok(())
    }

    #[test]
    fn passkey_prf_identity_derivation_rejects_invalid_inputs() {
        assert!(matches!(
            WebAuthnUserHandle::try_from(Vec::new()),
            Err(DeviceKeyProtectionError::UserHandleInvalid)
        ));
        assert!(matches!(
            WebAuthnPrfOutput::try_from(vec![10u8; 31]),
            Err(DeviceKeyProtectionError::PrfOutputInvalid)
        ));
    }
}
