//! Canonical JSON encoding and content-addressed event IDs.
//!
//! Event hashes and signatures are computed over a deterministic JSON
//! representation with lexicographically sorted object keys at every level.
//! Array order is preserved (parent lists are sorted before hashing).

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// Content-addressed event identifier (`sha256:{hex}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventId(pub String);

impl EventId {
    pub fn parse(raw: &str) -> Result<Self, String> {
        let trimmed = raw.trim();
        let hex = trimmed
            .strip_prefix("sha256:")
            .ok_or_else(|| format!("Event id must start with sha256: (got {trimmed:?})"))?;
        if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!(
                "Event id digest must be 64 hex chars (got {hex:?})"
            ));
        }
        Ok(Self(format!("sha256:{hex}")))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn hex_digest(&self) -> &str {
        self.0.strip_prefix("sha256:").unwrap_or(&self.0)
    }

    /// Immutable provider path: `nook-log/v1/events/{shard}/{digest}.event`.
    #[must_use]
    pub fn storage_path(&self) -> String {
        let hex = self.hex_digest();
        let shard = &hex[..2];
        format!("nook-log/v1/events/{shard}/{hex}.event")
    }
}

/// SHA-256 hex digest of arbitrary bytes.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Compute the content-addressed [`EventId`] for canonical event body bytes.
#[must_use]
pub fn event_id_from_body_bytes(body_bytes: &[u8]) -> EventId {
    EventId(format!("sha256:{}", sha256_hex(body_bytes)))
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
pub fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, String> {
    let canonical = canonicalize_json(value);
    serde_json::to_vec(&canonical)
        .map_err(|error| format!("Failed to encode canonical JSON: {error}"))
}

/// Parse an `ed25519:{hex}` signature string.
pub fn parse_ed25519_signature(raw: &str) -> Result<Signature, String> {
    let hex = raw
        .strip_prefix("ed25519:")
        .ok_or_else(|| format!("Signature must start with ed25519: (got {raw:?})"))?;
    let bytes = hex::decode(hex).map_err(|error| format!("Invalid signature hex: {error}"))?;
    let array: [u8; 64] = bytes
        .try_into()
        .map_err(|_| "Ed25519 signature must be 64 bytes".to_owned())?;
    Ok(Signature::from_bytes(&array))
}

/// Format a signature as `ed25519:{hex}`.
#[must_use]
pub fn format_ed25519_signature(signature: &Signature) -> String {
    format!("ed25519:{}", hex::encode(signature.to_bytes()))
}

/// Sign canonical body bytes with an Ed25519 key.
#[must_use]
pub fn sign_body(body_bytes: &[u8], signing_key: &SigningKey) -> String {
    format_ed25519_signature(&signing_key.sign(body_bytes))
}

/// Verify an Ed25519 signature over canonical body bytes.
pub fn verify_body_signature(
    body_bytes: &[u8],
    signature: &str,
    verifying_key: &VerifyingKey,
) -> Result<(), String> {
    let parsed = parse_ed25519_signature(signature)?;
    verifying_key
        .verify(body_bytes, &parsed)
        .map_err(|_| "Event signature verification failed".to_owned())
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
        assert!(a.as_str().starts_with("sha256:"));
        assert_eq!(a.hex_digest().len(), 64);
    }

    #[test]
    fn storage_path_uses_hash_shard() {
        let id = EventId::parse(
            "sha256:7a3e99112233445566778899aabbccddeeff00112233445566778899aabbccdd",
        )
        .unwrap();
        assert_eq!(
            id.storage_path(),
            "nook-log/v1/events/7a/7a3e99112233445566778899aabbccddeeff00112233445566778899aabbccdd.event"
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
}
