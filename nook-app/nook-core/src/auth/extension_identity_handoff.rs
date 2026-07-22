//! One-time, encrypted transfer of an unlocked extension device identity.

use crate::{
    AgeArmoredCiphertext, DeviceId, DeviceIdentity, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, ExtensionIdentityHandoffError, SigningIdentity, VaultResult,
    encrypt_for_recipient,
};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

const HANDOFF_VERSION: u8 = 1;
const MAX_NONCE_LEN: usize = 128;

#[derive(Serialize, Deserialize)]
struct ExtensionIdentityHandoffPayload {
    version: u8,
    nonce: String,
    device_id: DeviceId,
    device_public_key: DevicePublicKey,
    device_signing_public_key: DeviceSigningPublicKey,
    identity_private_key: DeviceIdentitySecret,
    signing_seed: SensitiveSigningSeed,
}

#[derive(Serialize, Deserialize)]
#[serde(transparent)]
struct SensitiveSigningSeed(String);

impl Drop for SensitiveSigningSeed {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

pub struct ExtensionIdentityHandoffMaterial {
    identity: DeviceIdentity,
    signing_seed: SensitiveSigningSeed,
}

impl ExtensionIdentityHandoffMaterial {
    #[must_use]
    pub fn into_parts(mut self) -> (DeviceIdentity, String) {
        let signing_seed = std::mem::take(&mut self.signing_seed.0);
        (self.identity, signing_seed)
    }
}

fn validate_nonce(nonce: &str) -> Result<(), ExtensionIdentityHandoffError> {
    if nonce.is_empty() || nonce.len() > MAX_NONCE_LEN || nonce.chars().any(char::is_whitespace) {
        return Err(ExtensionIdentityHandoffError::InvalidNonce);
    }
    Ok(())
}

pub fn seal_extension_identity_handoff(
    identity: &DeviceIdentity,
    signing_seed: &str,
    recipient_public_key: &DevicePublicKey,
    nonce: &str,
) -> VaultResult<AgeArmoredCiphertext> {
    validate_nonce(nonce)?;
    let signing = SigningIdentity::from_seed_hex_stored(signing_seed)?;
    let payload = ExtensionIdentityHandoffPayload {
        version: HANDOFF_VERSION,
        nonce: nonce.to_owned(),
        device_id: identity.device_id().clone(),
        device_public_key: identity.public_key(),
        device_signing_public_key: signing.public_key(),
        identity_private_key: identity.secret_string(),
        signing_seed: SensitiveSigningSeed(signing_seed.to_owned()),
    };
    let plaintext = Zeroizing::new(
        serde_json::to_string(&payload).map_err(ExtensionIdentityHandoffError::Serialize)?,
    );
    Ok(encrypt_for_recipient(
        plaintext.as_bytes(),
        recipient_public_key,
    )?)
}

pub fn open_extension_identity_handoff(
    recipient_identity: &DeviceIdentity,
    envelope: &AgeArmoredCiphertext,
    expected_nonce: &str,
    expected_device_id: &DeviceId,
    expected_device_public_key: &DevicePublicKey,
    expected_device_signing_public_key: &DeviceSigningPublicKey,
) -> VaultResult<ExtensionIdentityHandoffMaterial> {
    validate_nonce(expected_nonce)?;
    let plaintext = Zeroizing::new(recipient_identity.open_utf8(envelope)?);
    let payload: ExtensionIdentityHandoffPayload =
        serde_json::from_str(&plaintext).map_err(ExtensionIdentityHandoffError::Deserialize)?;
    let identity = DeviceIdentity::from_secret_str(&payload.identity_private_key)?;
    let signing = SigningIdentity::from_seed_hex_stored(&payload.signing_seed.0)?;

    if payload.version != HANDOFF_VERSION
        || payload.nonce != expected_nonce
        || payload.device_id != *expected_device_id
        || payload.device_public_key != *expected_device_public_key
        || payload.device_signing_public_key != *expected_device_signing_public_key
        || identity.device_id() != expected_device_id
        || identity.public_key() != *expected_device_public_key
        || signing.public_key() != *expected_device_signing_public_key
    {
        return Err(ExtensionIdentityHandoffError::BindingMismatch.into());
    }

    Ok(ExtensionIdentityHandoffMaterial {
        identity,
        signing_seed: payload.signing_seed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handoff_fixture() -> VaultResult<(
        DeviceIdentity,
        SigningIdentity,
        DeviceIdentity,
        AgeArmoredCiphertext,
    )> {
        let extension_identity = DeviceIdentity::generate()?;
        let (_, signing_seed) = SigningIdentity::generate()?;
        let signing = SigningIdentity::from_seed_hex_stored(signing_seed.as_str())?;
        let recipient = DeviceIdentity::generate()?;
        let envelope = seal_extension_identity_handoff(
            &extension_identity,
            signing_seed.as_str(),
            &recipient.public_key(),
            "nonce-123",
        )?;
        Ok((extension_identity, signing, recipient, envelope))
    }

    #[test]
    fn handoff_roundtrips_and_preserves_both_device_keys() -> VaultResult<()> {
        let (extension_identity, signing, recipient, envelope) = handoff_fixture()?;

        let opened = open_extension_identity_handoff(
            &recipient,
            &envelope,
            "nonce-123",
            extension_identity.device_id(),
            &extension_identity.public_key(),
            &signing.public_key(),
        )?;
        let (opened_identity, opened_signing_seed) = opened.into_parts();
        assert_eq!(opened_identity.device_id(), extension_identity.device_id());
        assert_eq!(
            opened_identity.public_key(),
            extension_identity.public_key()
        );
        assert_eq!(
            SigningIdentity::from_seed_hex_stored(opened_signing_seed.as_str())?.public_key(),
            signing.public_key()
        );
        Ok(())
    }

    #[test]
    fn handoff_rejects_nonce_or_public_key_mismatch() -> VaultResult<()> {
        let (extension_identity, signing, recipient, envelope) = handoff_fixture()?;

        assert!(
            open_extension_identity_handoff(
                &recipient,
                &envelope,
                "other-nonce",
                extension_identity.device_id(),
                &extension_identity.public_key(),
                &signing.public_key(),
            )
            .is_err()
        );
        let other_identity = DeviceIdentity::generate()?;
        assert!(
            open_extension_identity_handoff(
                &recipient,
                &envelope,
                "nonce-123",
                extension_identity.device_id(),
                &other_identity.public_key(),
                &signing.public_key(),
            )
            .is_err()
        );
        Ok(())
    }
}
