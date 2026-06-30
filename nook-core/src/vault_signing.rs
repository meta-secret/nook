//! Ed25519 signing identity for vault events (separate from X25519 encryption keys).

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::format_ed25519_signature;
use crate::format_auth_key_id;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};

const SIGNING_SEED_LEN: usize = 32;

/// Device signing material persisted beside the X25519 identity in `IndexedDB`.
#[derive(Debug, Clone)]
pub struct SigningIdentity {
    signing_key: SigningKey,
}

impl SigningIdentity {
    pub fn generate() -> VaultResult<(Self, String)> {
        let mut seed = [0u8; SIGNING_SEED_LEN];
        getrandom::getrandom(&mut seed)
            .map_err(|error| EventError::SigningSeedGeneration(error.to_string()))?;
        Self::from_seed_hex(&hex::encode(seed))
    }

    pub fn from_seed_hex(seed_hex: &str) -> VaultResult<(Self, String)> {
        let bytes = hex::decode(seed_hex.trim()).map_err(EventError::from)?;
        let seed: [u8; SIGNING_SEED_LEN] = bytes
            .try_into()
            .map_err(|_| EventError::SigningSeedWrongLength)?;
        let signing_key = SigningKey::from_bytes(&seed);
        Ok((Self { signing_key }, hex::encode(seed)))
    }

    pub fn from_seed_hex_stored(seed_hex: &str) -> VaultResult<Self> {
        Ok(Self::from_seed_hex(seed_hex)?.0)
    }

    #[must_use]
    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    #[must_use]
    pub fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    /// `key_{sha256_hex}` actor id derived from the Ed25519 public key.
    pub fn actor_id(&self) -> VaultResult<String> {
        let digest = hex::encode(Sha256::digest(self.verifying_key().as_bytes()));
        Ok(format_auth_key_id(&digest)?)
    }

    #[must_use]
    pub fn sign_bytes(&self, body_bytes: &[u8]) -> String {
        format_ed25519_signature(&self.signing_key.sign(body_bytes))
    }

    pub fn verify_bytes(
        body_bytes: &[u8],
        signature: &str,
        verifying_key: &VerifyingKey,
    ) -> VaultResult<()> {
        crate::event_canonical::verify_body_signature(body_bytes, signature, verifying_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signing_identity_roundtrip() -> VaultResult<()> {
        let (identity, seed) = SigningIdentity::generate()?;
        let restored = SigningIdentity::from_seed_hex_stored(&seed)?;
        assert_eq!(identity.actor_id()?, restored.actor_id()?);
        let body = b"event-body";
        let sig = identity.sign_bytes(body);
        SigningIdentity::verify_bytes(body, &sig, &restored.verifying_key())?;
        Ok(())
    }
}
