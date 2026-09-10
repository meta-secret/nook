//! Canonical JSON encoding and content-addressed event IDs.
//!
//! Event hashes and signatures are computed over a deterministic JSON
//! representation with lexicographically sorted object keys at every level.
//! Array order is preserved (parent lists are sorted before hashing).

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::{CanonicalEventBodyBytes, EventError, EventResult};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::fmt;

const EVENT_ID_PREFIX: &str = "sha256u:";
const SHA256_BASE64URL_LEN: usize = 43;
const SHA256_BYTES_LEN: usize = 32;

/// Content-addressed event identifier (`sha256u:{base64url_no_pad}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, tsify::Tsify)]
#[tsify(type = "string")]
#[serde(try_from = "String")]
pub struct EventId(String);

impl EventId {
    pub fn parse(raw: &str) -> EventResult<Self> {
        let trimmed = raw.trim();
        let encoded = trimmed.strip_prefix(EVENT_ID_PREFIX).ok_or_else(|| {
            EventError::EventIdMissingPrefix {
                raw: trimmed.to_owned(),
            }
        })?;
        if encoded.len() != SHA256_BASE64URL_LEN {
            return Err(EventError::EventIdInvalidDigest {
                hex: encoded.to_owned(),
            });
        }
        let bytes =
            URL_SAFE_NO_PAD
                .decode(encoded)
                .map_err(|_| EventError::EventIdInvalidDigest {
                    hex: encoded.to_owned(),
                })?;
        if bytes.len() != SHA256_BYTES_LEN {
            return Err(EventError::EventIdInvalidDigest {
                hex: encoded.to_owned(),
            });
        }
        Ok(Self(format!("{EVENT_ID_PREFIX}{encoded}")))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }

    pub fn from_sha256_hex(hex_digest: &str) -> EventResult<Self> {
        let bytes = hex::decode(hex_digest).map_err(EventError::from)?;
        let bytes: [u8; SHA256_BYTES_LEN] =
            bytes
                .try_into()
                .map_err(|_| EventError::EventIdInvalidDigest {
                    hex: hex_digest.to_owned(),
                })?;
        Ok(Self::from_sha256_bytes(&bytes))
    }

    fn from_sha256_bytes(bytes: &[u8; SHA256_BYTES_LEN]) -> Self {
        Self(format!(
            "{EVENT_ID_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(bytes)
        ))
    }

    #[must_use]
    pub fn from_body_bytes(body_bytes: &CanonicalEventBodyBytes) -> Self {
        let digest: [u8; SHA256_BYTES_LEN] = Sha256::digest(body_bytes.as_ref()).into();
        Self::from_sha256_bytes(&digest)
    }

    #[must_use]
    pub fn encoded_digest(&self) -> &str {
        self.0.strip_prefix(EVENT_ID_PREFIX).unwrap_or(&self.0)
    }

    /// Immutable provider path: `nook-log/v1/events/{base64url_digest}.yaml`.
    #[must_use]
    pub fn storage_path(&self) -> String {
        let digest = self.encoded_digest();
        format!("nook-log/v1/events/{digest}.yaml")
    }
}

impl fmt::Display for EventId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for EventId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for EventId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl TryFrom<String> for EventId {
    type Error = EventError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

/// Ed25519 signature string (`ed25519:{hex}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, tsify::Tsify)]
#[tsify(type = "string")]
#[serde(try_from = "String")]
pub struct Ed25519Signature(String);

impl Ed25519Signature {
    pub fn parse(raw: &str) -> EventResult<Self> {
        let hex =
            raw.strip_prefix("ed25519:")
                .ok_or_else(|| EventError::SignatureMissingPrefix {
                    raw: raw.to_owned(),
                })?;
        let bytes = hex::decode(hex).map_err(EventError::from)?;
        let _: [u8; 64] = bytes
            .try_into()
            .map_err(|_| EventError::SignatureWrongLength)?;
        let trimmed = raw.trim();
        Ok(Self(trimmed.to_owned()))
    }

    #[must_use]
    pub fn from_signature(signature: &Signature) -> Self {
        Self(format!("ed25519:{}", hex::encode(signature.to_bytes())))
    }

    #[must_use]
    pub fn sign(body_bytes: &CanonicalEventBodyBytes, signing_key: &SigningKey) -> Self {
        Self::from_signature(&signing_key.sign(body_bytes.as_ref()))
    }

    pub fn verify(
        &self,
        body_bytes: &CanonicalEventBodyBytes,
        verifying_key: &VerifyingKey,
    ) -> EventResult<()> {
        let hex = self.as_str().strip_prefix("ed25519:").ok_or_else(|| {
            EventError::SignatureMissingPrefix {
                raw: self.as_str().to_owned(),
            }
        })?;
        let bytes = hex::decode(hex).map_err(EventError::from)?;
        let array: [u8; 64] = bytes
            .try_into()
            .map_err(|_| EventError::SignatureWrongLength)?;
        verifying_key
            .verify(body_bytes.as_ref(), &Signature::from_bytes(&array))
            .map_err(|_| EventError::SignatureVerificationFailed)?;
        Ok(())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for Ed25519Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for Ed25519Signature {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for Ed25519Signature {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl TryFrom<String> for Ed25519Signature {
    type Error = EventError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::signing_key;
    use serde_json::json;

    #[test]
    fn canonical_json_sorts_object_keys() -> anyhow::Result<()> {
        let value = json!({"b": 2, "a": {"d": 4, "c": 3}});
        let bytes = CanonicalEventBodyBytes::from_json(&value)?;
        assert_eq!(bytes.as_ref(), br#"{"a":{"c":3,"d":4},"b":2}"#);
        Ok(())
    }

    #[test]
    fn event_id_is_stable_for_same_body() {
        let body = br#"{"schema_version":1}"#.to_vec().into();
        let a = EventId::from_body_bytes(&body);
        let b = EventId::from_body_bytes(&body);
        assert_eq!(a, b);
        assert!(a.as_str().starts_with("sha256u:"));
        assert_eq!(a.encoded_digest().len(), 43);
    }

    #[test]
    fn storage_path_is_flat_yaml() -> anyhow::Result<()> {
        let id = EventId::parse("sha256u:ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0")?;
        assert_eq!(
            id.storage_path(),
            "nook-log/v1/events/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
        );
        Ok(())
    }

    #[test]
    fn ed25519_sign_verify_roundtrip() -> anyhow::Result<()> {
        let signing_key = signing_key();
        let verifying_key = signing_key.verifying_key();
        let body = b"canonical-body".to_vec().into();
        let sig = Ed25519Signature::sign(&body, &signing_key);
        sig.verify(&body, &verifying_key)?;
        Ok(())
    }

    #[test]
    fn event_id_and_signature_serde_roundtrip() -> anyhow::Result<()> {
        let id = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let roundtripped: EventId = serde_json::from_str(&serde_json::to_string(&id)?)?;
        assert_eq!(roundtripped, id);

        let signing_key = signing_key();
        let sig = Ed25519Signature::sign(&b"body".to_vec().into(), &signing_key);
        let sig_back: Ed25519Signature = serde_json::from_str(&serde_json::to_string(&sig)?)?;
        assert_eq!(sig_back, sig);
        assert!(Ed25519Signature::parse("bad-signature").is_err());
        Ok(())
    }

    #[test]
    fn event_id_typed_boundary_rejects_every_malformed_digest_shape() -> anyhow::Result<()> {
        assert!(matches!(
            serde_json::from_str::<EventId>("\"not-an-event-id\""),
            Err(_)
        ));
        assert!(matches!(
            EventId::parse("sha256u:short"),
            Err(EventError::EventIdInvalidDigest { .. })
        ));
        assert!(matches!(
            EventId::parse(&format!("sha256u:{}", "!".repeat(43))),
            Err(EventError::EventIdInvalidDigest { .. })
        ));
        assert!(EventId::from_sha256_hex("not-hex").is_err());
        assert!(matches!(
            EventId::from_sha256_hex("00"),
            Err(EventError::EventIdInvalidDigest { .. })
        ));

        let trusted =
            EventId::from_trusted("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw".to_owned());
        assert_eq!(trusted.as_ref(), trusted.as_str());
        assert_eq!(trusted.to_string(), trusted.as_str());
        assert_eq!(trusted.clone().into_inner(), trusted.as_str());
        Ok(())
    }

    #[test]
    fn signature_typed_boundary_rejects_malformed_and_unverified_values() -> anyhow::Result<()> {
        assert!(matches!(
            serde_json::from_str::<Ed25519Signature>("\"bad-signature\""),
            Err(_)
        ));
        assert!(Ed25519Signature::parse("ed25519:not-hex").is_err());
        assert!(matches!(
            Ed25519Signature::parse("ed25519:00"),
            Err(EventError::SignatureWrongLength)
        ));

        let signing_key = signing_key();
        let body = CanonicalEventBodyBytes::from_json(&json!({"value": 1}))?;
        let invalid = Ed25519Signature::from_trusted(format!("ed25519:{}", "00".repeat(64)));
        assert!(matches!(
            invalid.verify(&body, &signing_key.verifying_key()),
            Err(EventError::SignatureVerificationFailed)
        ));
        assert_eq!(invalid.as_ref(), invalid.as_str());
        assert_eq!(invalid.to_string(), invalid.as_str());
        assert_eq!(invalid.clone().into_inner(), invalid.as_str());
        Ok(())
    }
}
