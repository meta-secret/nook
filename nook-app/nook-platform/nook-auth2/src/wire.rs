//! Typed key-access and crypto strings.

use crate::CompactToken;
use crate::errors::{ValidationError, ValidationResult};
use age::x25519::{Identity, Recipient};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};
use std::{fmt, mem};
use zeroize::Zeroize;

mod metadata;
pub use metadata::{DeviceSigningPublicKey, IdentityVaultEventId, IsoTimestamp, Sha256Hex};

const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";
const HEX_32_BYTE_LEN: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SymmetricKey(String);

impl SymmetricKey {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for SymmetricKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for SymmetricKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for SymmetricKey {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AgeArmoredCiphertext(String);

impl AgeArmoredCiphertext {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for AgeArmoredCiphertext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for AgeArmoredCiphertext {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for AgeArmoredCiphertext {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DevicePublicKey(String);

impl DevicePublicKey {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for DevicePublicKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for DevicePublicKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for DevicePublicKey {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct MemberLabel(String);

impl MemberLabel {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for MemberLabel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for MemberLabel {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for MemberLabel {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PasswordEntryId(String);

impl PasswordEntryId {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for PasswordEntryId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for PasswordEntryId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for PasswordEntryId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OpaqueCiphertext(String);

impl OpaqueCiphertext {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for OpaqueCiphertext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for OpaqueCiphertext {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for OpaqueCiphertext {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DecryptedPlaintext(String);

impl DecryptedPlaintext {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for DecryptedPlaintext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for DecryptedPlaintext {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for DecryptedPlaintext {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SigningSeedHex(String);

impl SigningSeedHex {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for SigningSeedHex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for SigningSeedHex {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl serde::Serialize for SigningSeedHex {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl DecryptedPlaintext {
    pub fn zeroize_plaintext(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for DecryptedPlaintext {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DeviceIdentitySecret(String);

impl DeviceIdentitySecret {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(mut self) -> String {
        mem::take(&mut self.0)
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for DeviceIdentitySecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DeviceIdentitySecret([REDACTED])")
    }
}

impl fmt::Display for DeviceIdentitySecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for DeviceIdentitySecret {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for DeviceIdentitySecret {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl Drop for DeviceIdentitySecret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl SymmetricKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let key = raw.trim();
        if key.len() != HEX_32_BYTE_LEN || !key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::SymmetricKeyInvalid);
        }
        Ok(Self(key.to_owned()))
    }

    pub fn generate() -> ValidationResult<Self> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|_| ValidationError::SymmetricKeyInvalid)?;
        Ok(Self(hex::encode(bytes)))
    }
}

impl<'de> Deserialize<'de> for SymmetricKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(D::Error::custom)
    }
}

impl AgeArmoredCiphertext {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        if !raw.contains(AGE_ARMOR_MARKER) {
            return Err(ValidationError::AgeArmoredInvalid);
        }
        Ok(Self(raw.to_owned()))
    }

    #[must_use]
    pub fn from_trusted_armored(value: String) -> Self {
        Self(value)
    }
}

impl<'de> Deserialize<'de> for AgeArmoredCiphertext {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(D::Error::custom)
    }
}

impl DevicePublicKey {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let key = raw.trim();
        key.parse::<Recipient>()
            .map(|_| Self(key.to_owned()))
            .map_err(|_| ValidationError::DevicePublicKeyInvalid)
    }
}

impl<'de> Deserialize<'de> for DevicePublicKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(D::Error::custom)
    }
}

impl DeviceIdentitySecret {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let secret = raw.trim();
        secret
            .parse::<Identity>()
            .map(|_| Self(secret.to_owned()))
            .map_err(|_| ValidationError::DeviceIdentitySecretInvalid)
    }
}

impl<'de> Deserialize<'de> for DeviceIdentitySecret {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(D::Error::custom)
    }
}

impl SigningSeedHex {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let seed = raw.trim();
        if seed.len() != HEX_32_BYTE_LEN || !seed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::SigningSeedInvalid);
        }
        Ok(Self(seed.to_owned()))
    }
}

impl<'de> Deserialize<'de> for SigningSeedHex {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(D::Error::custom)
    }
}

impl PasswordEntryId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let id = raw.trim();
        if id.is_empty() {
            return Err(ValidationError::PasswordEntryIdInvalid);
        }
        CompactToken::parse(id)?;
        Ok(Self(id.to_owned()))
    }
}

impl<'de> Deserialize<'de> for PasswordEntryId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(D::Error::custom)
    }
}

impl<'de> Deserialize<'de> for MemberLabel {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(Self(raw))
    }
}

impl<'de> Deserialize<'de> for OpaqueCiphertext {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(Self(raw))
    }
}

/// Alias for compact URL-safe base64 ids (`generate_id` — 11 chars).
pub type Url64EncodedString = CompactToken;

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;
    use age::secrecy::ExposeSecret;
    use age::x25519::Identity;

    #[test]
    fn symmetric_key_roundtrip_and_generate() -> anyhow::Result<()> {
        let key = SymmetricKey::generate()?;
        assert_eq!(key.as_str().len(), 64);
        assert_eq!(SymmetricKey::parse(key.as_str())?, key);
        assert_eq!(key.to_string(), key.as_str());
        assert_eq!(key.into_inner().len(), 64);
        Ok(())
    }

    #[test]
    fn age_armored_accepts_valid_armor() -> anyhow::Result<()> {
        let armor = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n-----END AGE ENCRYPTED FILE-----";
        let parsed = AgeArmoredCiphertext::parse(armor)?;
        assert_eq!(parsed.as_str(), armor);
        let trusted = AgeArmoredCiphertext::from_trusted_armored(armor.to_owned());
        assert_eq!(parsed, trusted);
        Ok(())
    }

    #[test]
    fn device_keys_parse_from_generated_identity() -> anyhow::Result<()> {
        let identity = Identity::generate();
        let public = identity.to_public().to_string();
        let secret = identity.to_string().expose_secret().to_owned();
        let pk = DevicePublicKey::parse(&public)?;
        assert_eq!(pk.as_str(), public);
        let sk = DeviceIdentitySecret::parse(&secret)?;
        assert_eq!(sk.as_str(), secret);
        assert_eq!(format!("{sk:?}"), "DeviceIdentitySecret([REDACTED])");
        Ok(())
    }

    #[test]
    fn password_entry_id_requires_compact_token() -> anyhow::Result<()> {
        let id = PasswordEntryId::parse("pwdentry001")?;
        assert_eq!(PasswordEntryId::parse(id.as_str())?, id);
        assert!(PasswordEntryId::parse("").is_err());
        assert!(PasswordEntryId::parse("too-long-token-value").is_err());
        Ok(())
    }

    #[test]
    fn invalid_key_and_ciphertext_strings_fail_validation() -> anyhow::Result<()> {
        assert!(SymmetricKey::parse("short").is_err());
        assert!(SymmetricKey::parse(&"zz".repeat(32)).is_err());
        assert!(AgeArmoredCiphertext::parse("plain text").is_err());
        assert!(DevicePublicKey::parse("not-an-age-recipient").is_err());
        assert!(DeviceIdentitySecret::parse("not-an-age-secret").is_err());
        assert!(SigningSeedHex::parse("short").is_err());
        assert!(SigningSeedHex::parse(&"zz".repeat(32)).is_err());
        assert!(IsoTimestamp::parse("").is_err());
        assert!(IsoTimestamp::parse("not-a-date").is_err());
        Ok(())
    }

    #[test]
    fn string_newtypes_expose_display_as_ref_and_inner_values() -> anyhow::Result<()> {
        let seed_hex = "ab".repeat(32);
        let seed = SigningSeedHex::parse(&seed_hex)?;
        assert_eq!(seed.as_str(), seed_hex);
        assert_eq!(seed.as_ref(), seed_hex);
        assert_eq!(seed.to_string(), seed_hex);
        assert_eq!(serde_json::to_string(&seed)?, format!("\"{seed_hex}\""));
        assert_eq!(seed.clone().into_inner(), seed_hex);

        let trusted_seed = SigningSeedHex::from_trusted(seed_hex.clone());
        assert_eq!(trusted_seed, seed);

        let label = MemberLabel::from_trusted("Laptop".to_owned());
        assert_eq!(label.as_str(), "Laptop");
        assert_eq!(label.as_ref(), "Laptop");
        assert_eq!(label.to_string(), "Laptop");
        assert_eq!(label.clone().into_inner(), "Laptop");
        let decoded_label: MemberLabel = serde_json::from_str("\"Laptop\"")?;
        assert_eq!(decoded_label, label);

        let opaque = OpaqueCiphertext::from_trusted("sealed".to_owned());
        assert_eq!(opaque.as_str(), "sealed");
        assert_eq!(opaque.as_ref(), "sealed");
        assert_eq!(opaque.to_string(), "sealed");
        assert_eq!(opaque.clone().into_inner(), "sealed");
        let decoded_opaque: OpaqueCiphertext = serde_json::from_str("\"sealed\"")?;
        assert_eq!(decoded_opaque, opaque);

        let plaintext = DecryptedPlaintext::from_trusted("secret".to_owned());
        assert_eq!(plaintext.as_str(), "secret");
        assert_eq!(plaintext.as_ref(), "secret");
        assert_eq!(plaintext.to_string(), "secret");
        assert_eq!(plaintext.into_inner(), "secret");
        Ok(())
    }

    #[test]
    fn device_identity_secret_can_be_unwrapped_without_debug_leak() -> anyhow::Result<()> {
        let identity = Identity::generate();
        let secret = identity.to_string().expose_secret().to_owned();
        let wrapped = DeviceIdentitySecret::parse(&secret)?;
        assert_eq!(wrapped.as_ref(), secret);
        assert_eq!(wrapped.to_string(), secret);
        assert_eq!(format!("{wrapped:?}"), "DeviceIdentitySecret([REDACTED])");
        assert_eq!(serde_json::to_string(&wrapped)?, format!("\"{secret}\""));
        assert_eq!(wrapped.into_inner(), secret);
        Ok(())
    }
}
