//! Validated public digests, signing keys, and timestamps.

use super::HEX_32_BYTE_LEN;
use crate::errors::{ValidationError, ValidationResult};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// Bare SHA-256 hex digest (64 chars).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Sha256Hex(String);

impl Sha256Hex {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let hex = raw.trim();
        if hex.len() != HEX_32_BYTE_LEN || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::Sha256HexInvalid);
        }
        Ok(Self(hex.to_owned()))
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

impl fmt::Display for Sha256Hex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for Sha256Hex {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for Sha256Hex {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Sha256Hex {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// Ed25519 verifying-key state used by persisted membership and event records.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DeviceSigningPublicKey {
    #[default]
    Unavailable,
    Ed25519Hex(String),
}

impl DeviceSigningPublicKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let hex = raw.trim();
        if hex.is_empty() {
            return Ok(Self::Unavailable);
        }
        if hex.len() != HEX_32_BYTE_LEN || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::DeviceSigningPublicKeyInvalid);
        }
        Ok(Self::Ed25519Hex(hex.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Unavailable => "",
            Self::Ed25519Hex(value) => value,
        }
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        match self {
            Self::Unavailable => String::new(),
            Self::Ed25519Hex(value) => value,
        }
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        if value.is_empty() {
            Self::Unavailable
        } else {
            Self::Ed25519Hex(value)
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self, Self::Unavailable)
    }
}

impl fmt::Display for DeviceSigningPublicKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl AsRef<str> for DeviceSigningPublicKey {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Serialize for DeviceSigningPublicKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for DeviceSigningPublicKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// RFC 3339 timestamp string (`created_at`, `enrolled_at`, `requested_at`, ...).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct IsoTimestamp(String);

impl IsoTimestamp {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let timestamp = raw.trim();
        if timestamp.is_empty() {
            return Err(ValidationError::IsoTimestampInvalid);
        }
        if !timestamp.contains('T') && !timestamp.chars().any(|ch| ch.is_ascii_digit()) {
            return Err(ValidationError::IsoTimestampInvalid);
        }
        Ok(Self(timestamp.to_owned()))
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

impl fmt::Display for IsoTimestamp {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for IsoTimestamp {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for IsoTimestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for IsoTimestamp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_parse_and_serde() -> anyhow::Result<()> {
        let hex = Sha256Hex::from_trusted("deadbeef".repeat(8));
        assert_eq!(Sha256Hex::parse(hex.as_str())?, hex);
        assert!(Sha256Hex::parse("short").is_err());
        let roundtripped: Sha256Hex = serde_json::from_str(&serde_json::to_string(&hex)?)?;
        assert_eq!(roundtripped, hex);
        Ok(())
    }

    #[test]
    fn device_signing_public_key_names_unavailable_and_ed25519_states() -> anyhow::Result<()> {
        assert_eq!(
            DeviceSigningPublicKey::parse("")?,
            DeviceSigningPublicKey::Unavailable
        );
        let key = DeviceSigningPublicKey::from_trusted("ab".repeat(32));
        assert!(matches!(&key, DeviceSigningPublicKey::Ed25519Hex(_)));
        assert_eq!(DeviceSigningPublicKey::parse(key.as_str())?, key);
        assert!(DeviceSigningPublicKey::parse("not-hex").is_err());
        Ok(())
    }

    #[test]
    fn timestamp_and_signing_key_roundtrip_through_serde() -> anyhow::Result<()> {
        let timestamp = IsoTimestamp::parse("2026-07-07T03:00:00Z")?;
        assert_eq!(timestamp.as_str(), "2026-07-07T03:00:00Z");
        assert_eq!(timestamp.as_ref(), timestamp.as_str());
        assert_eq!(timestamp.to_string(), timestamp.as_str());
        assert_eq!(timestamp.clone().into_inner(), timestamp.as_str());
        assert_eq!(
            IsoTimestamp::from_trusted(timestamp.as_str().to_owned()),
            timestamp
        );
        let decoded: IsoTimestamp = serde_json::from_str(&serde_json::to_string(&timestamp)?)?;
        assert_eq!(decoded, timestamp);

        let signing = DeviceSigningPublicKey::parse(&"cd".repeat(32))?;
        assert!(!signing.is_empty());
        assert_eq!(signing.as_ref(), signing.as_str());
        assert_eq!(signing.to_string(), signing.as_str());
        assert_eq!(signing.clone().into_inner(), signing.as_str());
        let decoded: DeviceSigningPublicKey =
            serde_json::from_str(&serde_json::to_string(&signing)?)?;
        assert_eq!(decoded, signing);
        Ok(())
    }
}
