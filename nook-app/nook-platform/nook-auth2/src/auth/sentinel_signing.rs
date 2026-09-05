//! Shared Ed25519 primitives for Sentinel ceremony protocols.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{DeviceSigningPublicKey, MultiDeviceError, MultiDeviceResult};
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};

impl DeviceSigningPublicKey {
    #[must_use]
    pub(super) fn from_signing_key(signing_key: &SigningKey) -> Self {
        Self::from_trusted(hex::encode(signing_key.verifying_key().to_bytes()))
    }

    pub(super) fn verify_signature(
        &self,
        signature: &str,
        bytes: &[u8],
        invalid: fn() -> MultiDeviceError,
    ) -> MultiDeviceResult<()> {
        let public: [u8; 32] = hex::decode(self.as_str())
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or_else(invalid)?;
        let signature: [u8; 64] = hex::decode(signature)
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or_else(invalid)?;
        let verifying_key = VerifyingKey::from_bytes(&public).map_err(|_| invalid())?;
        verifying_key
            .verify(bytes, &Signature::from_bytes(&signature))
            .map_err(|_| invalid())
    }
}

#[cfg(test)]
mod tests {
    use super::{DeviceSigningPublicKey, MultiDeviceError, SigningKey};
    use ed25519_dalek::Signer;
    use std::mem;

    struct SignedFixture {
        public_key: DeviceSigningPublicKey,
        signature: String,
    }

    impl SignedFixture {
        fn new() -> Self {
            let signing_key = SigningKey::from_bytes(&[7; 32]);
            Self {
                public_key: DeviceSigningPublicKey::from_signing_key(&signing_key),
                signature: hex::encode(signing_key.sign(b"sentinel ceremony").to_bytes()),
            }
        }
    }

    #[test]
    fn derived_public_key_verifies_original_bytes_with_lowercase_hex() -> anyhow::Result<()> {
        let fixture = SignedFixture::new();
        let expected = SigningKey::from_bytes(&[7; 32]).verifying_key().to_bytes();
        assert_eq!(fixture.public_key.as_str(), hex::encode(expected));
        fixture
            .public_key
            .verify_signature(&fixture.signature, b"sentinel ceremony", || {
                MultiDeviceError::InvalidSentinelGenesisSignature
            })?;
        Ok(())
    }

    #[test]
    fn invalid_inputs_preserve_caller_selected_protocol_errors() -> anyhow::Result<()> {
        let fixture = SignedFixture::new();
        let wrong_key = DeviceSigningPublicKey::from_signing_key(&SigningKey::from_bytes(&[8; 32]));
        let malformed_key = DeviceSigningPublicKey::Ed25519Hex("not hex".to_owned());
        let short_key = DeviceSigningPublicKey::Ed25519Hex("00".repeat(31));
        let long_key = DeviceSigningPublicKey::Ed25519Hex("00".repeat(33));
        let short_signature = "00".repeat(63);
        let long_signature = "00".repeat(65);
        let invalid_signature = "00".repeat(64);
        let cases = [
            (
                &fixture.public_key,
                fixture.signature.as_str(),
                b"tampered ceremony".as_slice(),
            ),
            (
                &wrong_key,
                fixture.signature.as_str(),
                b"sentinel ceremony".as_slice(),
            ),
            (
                &malformed_key,
                fixture.signature.as_str(),
                b"sentinel ceremony".as_slice(),
            ),
            (
                &short_key,
                fixture.signature.as_str(),
                b"sentinel ceremony".as_slice(),
            ),
            (
                &long_key,
                fixture.signature.as_str(),
                b"sentinel ceremony".as_slice(),
            ),
            (
                &DeviceSigningPublicKey::Unavailable,
                fixture.signature.as_str(),
                b"sentinel ceremony".as_slice(),
            ),
            (
                &fixture.public_key,
                "not hex",
                b"sentinel ceremony".as_slice(),
            ),
            (
                &fixture.public_key,
                short_signature.as_str(),
                b"sentinel ceremony".as_slice(),
            ),
            (
                &fixture.public_key,
                long_signature.as_str(),
                b"sentinel ceremony".as_slice(),
            ),
            (
                &fixture.public_key,
                invalid_signature.as_str(),
                b"sentinel ceremony".as_slice(),
            ),
        ];
        let errors: [fn() -> MultiDeviceError; 2] = [
            || MultiDeviceError::InvalidSentinelGenesisSignature,
            || MultiDeviceError::InvalidSentinelUnlockSignature,
        ];
        for invalid in errors {
            for (key, signature, bytes) in cases {
                match key.verify_signature(signature, bytes, invalid) {
                    Err(error) => {
                        let expected = invalid();
                        assert_eq!(mem::discriminant(&error), mem::discriminant(&expected));
                        assert_eq!(error.to_string(), expected.to_string());
                    }
                    Ok(()) => anyhow::bail!("invalid signature input was accepted"),
                }
            }
        }
        Ok(())
    }
}
