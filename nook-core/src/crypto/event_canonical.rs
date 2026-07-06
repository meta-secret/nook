//! Canonical JSON encoding and content-addressed event IDs.
//!
//! Event hashes and signatures are computed over a deterministic JSON
//! representation with lexicographically sorted object keys at every level.
//! Array order is preserved (parent lists are sorted before hashing).

use crate::errors::{EventError, VaultResult};
use crate::vault_wire::Sha256Hex;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fmt;

const EVENT_ID_PREFIX: &str = "sha256u:";
const SHA256_BASE64URL_LEN: usize = 43;
const SHA256_BYTES_LEN: usize = 32;

/// Content-addressed event identifier (`sha256u:{base64url_no_pad}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventId(String);

impl EventId {
    pub fn parse(raw: &str) -> VaultResult<Self> {
        let trimmed = raw.trim();
        let encoded = trimmed.strip_prefix(EVENT_ID_PREFIX).ok_or_else(|| {
            EventError::EventIdMissingPrefix {
                raw: trimmed.to_owned(),
            }
        })?;
        if encoded.len() != SHA256_BASE64URL_LEN {
            return Err(EventError::EventIdInvalidDigest {
                hex: encoded.to_owned(),
            }
            .into());
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
            }
            .into());
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

    pub fn from_sha256_hex(hex_digest: &str) -> VaultResult<Self> {
        let bytes = hex::decode(hex_digest).map_err(EventError::from)?;
        let bytes: [u8; SHA256_BYTES_LEN] =
            bytes
                .try_into()
                .map_err(|_| EventError::EventIdInvalidDigest {
                    hex: hex_digest.to_owned(),
                })?;
        Ok(Self::from_sha256_bytes(&bytes))
    }

    #[must_use]
    pub fn from_sha256_bytes(bytes: &[u8; SHA256_BYTES_LEN]) -> Self {
        Self(format!(
            "{EVENT_ID_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(bytes)
        ))
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

impl<'de> Deserialize<'de> for EventId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// Ed25519 signature string (`ed25519:{hex}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Ed25519Signature(String);

impl Ed25519Signature {
    pub fn parse(raw: &str) -> VaultResult<Self> {
        parse_ed25519_signature(raw)?;
        let trimmed = raw.trim();
        Ok(Self(trimmed.to_owned()))
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

impl<'de> Deserialize<'de> for Ed25519Signature {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// SHA-256 hex digest of arbitrary bytes.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> Sha256Hex {
    Sha256Hex::from_trusted(hex::encode(Sha256::digest(bytes)))
}

/// Compute the content-addressed [`EventId`] for canonical event body bytes.
#[must_use]
pub fn event_id_from_body_bytes(body_bytes: &[u8]) -> EventId {
    let digest: [u8; SHA256_BYTES_LEN] = Sha256::digest(body_bytes).into();
    EventId::from_sha256_bytes(&digest)
}

/// Recursively sort object keys for canonical JSON encoding.
pub fn canonicalize_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted = Map::new();
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted.insert(
                    key.clone(),
                    canonicalize_json(map.get(key).expect("key present")),
                );
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize_json).collect()),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => value.clone(),
    }
}

/// Serialize a JSON value to canonical compact UTF-8 bytes.
pub fn canonical_json_bytes(value: &Value) -> VaultResult<Vec<u8>> {
    let canonical = canonicalize_json(value);
    Ok(serde_json::to_vec(&canonical).map_err(EventError::from)?)
}

/// Parse an `ed25519:{hex}` signature string.
pub fn parse_ed25519_signature(raw: &str) -> VaultResult<Signature> {
    let hex = raw
        .strip_prefix("ed25519:")
        .ok_or_else(|| EventError::SignatureMissingPrefix {
            raw: raw.to_owned(),
        })?;
    let bytes = hex::decode(hex).map_err(EventError::from)?;
    let array: [u8; 64] = bytes
        .try_into()
        .map_err(|_| EventError::SignatureWrongLength)?;
    Ok(Signature::from_bytes(&array))
}

/// Format a signature as `ed25519:{hex}`.
#[must_use]
pub fn format_ed25519_signature(signature: &Signature) -> String {
    format!("ed25519:{}", hex::encode(signature.to_bytes()))
}

/// Sign canonical body bytes with an Ed25519 key.
#[must_use]
pub fn sign_body(body_bytes: &[u8], signing_key: &SigningKey) -> Ed25519Signature {
    Ed25519Signature::from_trusted(format_ed25519_signature(&signing_key.sign(body_bytes)))
}

/// Verify an Ed25519 signature over canonical body bytes.
pub fn verify_body_signature(
    body_bytes: &[u8],
    signature: impl AsRef<str>,
    verifying_key: &VerifyingKey,
) -> VaultResult<()> {
    let parsed = parse_ed25519_signature(signature.as_ref())?;
    verifying_key
        .verify(body_bytes, &parsed)
        .map_err(|_| EventError::SignatureVerificationFailed)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_sorts_object_keys() {
        let value = json!({"b": 2, "a": {"d": 4, "c": 3}});
        let bytes = canonical_json_bytes(&value).unwrap();
        assert_eq!(bytes, br#"{"a":{"c":3,"d":4},"b":2}"#);
    }

    #[test]
    fn event_id_is_stable_for_same_body() {
        let body = br#"{"schema_version":1}"#;
        let a = event_id_from_body_bytes(body);
        let b = event_id_from_body_bytes(body);
        assert_eq!(a, b);
        assert!(a.as_str().starts_with("sha256u:"));
        assert_eq!(a.encoded_digest().len(), 43);
    }

    #[test]
    fn storage_path_is_flat_yaml() {
        let id = EventId::parse("sha256u:ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0").unwrap();
        assert_eq!(
            id.storage_path(),
            "nook-log/v1/events/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
        );
    }

    #[test]
    fn ed25519_sign_verify_roundtrip() {
        use ed25519_dalek::SigningKey;
        use rand_core::OsRng;

        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let body = b"canonical-body";
        let sig = sign_body(body, &signing_key);
        verify_body_signature(body, &sig, &verifying_key).unwrap();
    }

    #[test]
    fn event_id_and_signature_serde_roundtrip() {
        let id = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo").unwrap();
        let roundtripped: EventId =
            serde_json::from_str(&serde_json::to_string(&id).unwrap()).unwrap();
        assert_eq!(roundtripped, id);

        let signing_key = ed25519_dalek::SigningKey::generate(&mut rand_core::OsRng);
        let sig = sign_body(b"body", &signing_key);
        let sig_back: Ed25519Signature =
            serde_json::from_str(&serde_json::to_string(&sig).unwrap()).unwrap();
        assert_eq!(sig_back, sig);
        assert!(Ed25519Signature::parse("bad-signature").is_err());
    }
}
